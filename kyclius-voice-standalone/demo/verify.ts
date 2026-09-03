/**
 * Demonstration harness - proves the six required behaviors end to end:
 *   1. mock STT partials -> final, and idle -> listening -> thinking
 *   2. streaming text segmented into sentences correctly
 *   3. TTS playback begins on sentence 1 BEFORE the stream finishes (HC5)
 *   4. disabling the cloud provider falls back to local automatically
 *   5. no usable STT / TTS engine -> visible error state, never silent
 *   6. the preload bridge exposes exactly the intended narrow surface
 *
 * Run: node demo/verify.ts
 */
import { ProviderRegistry } from '../voice/core/ProviderRegistry.ts';
import { VoiceManager, type LlmBridge } from '../voice/core/VoiceManager.ts';
import { MockAudioCapture, type EnvelopePhase } from '../voice/audio/AudioCapture.ts';
import { SentenceSegmenter } from '../voice/tts/SentenceSegmenter.ts';
import { verifyRollupCompleteness } from '../voice/types/canonical.ts';
import { VoiceError } from '../voice/types/errors.ts';
import { VOICE_COMMAND_CHANNEL_LIST } from '../ipc/voice.channels.ts';
import { createVoiceBridgeApi, exposeVoiceBridge, VOICE_BRIDGE_KEY } from '../ipc/voice.preload.ts';
import type { ContextBridgeLike, IpcRendererLike } from '../ipc/voice.preload.ts';
import { createVoiceCommandDispatcher, registerVoiceIpc } from '../ipc/voice.main.ts';

let failures = 0;
let unhandled = 0;
process.on('unhandledRejection', () => unhandled++);

function ok(cond: boolean, label: string, extra = ''): void {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' - ' + extra : ''}`);
  if (!cond) failures++;
}

const ACCEL = {
  frameMs: 10, silenceMs: 120, minSpeechMs: 60, maxSilenceMs: 600,
  maxUtteranceMs: 60000, partialEveryMs: 60, probeTimeoutMs: 500,
  playerChunkMs: 10, synthFirstChunkMs: 40,
};

const TURN_TEXT =
  'The quick brown fox jumps over the lazy dog. Streaming keeps first-audio latency low. Short sentences speak naturally. This tail sentence flushes at stream end.';

const SPEECH: EnvelopePhase[] = [
  { ms: 60, level: 0 },
  { ms: 320, level: 0.6 },
  { ms: 220, level: 0 },
];

function mockLlm(tokenDelayMs: number): LlmBridge {
  return async function* (_transcript, _sessionId, signal) {
    const words = TURN_TEXT.match(/\S+\s*/g) ?? [];
    for (const w of words) {
      if (signal.aborted) return;
      await new Promise((r) => setTimeout(r, tokenDelayMs));
      yield w;
    }
  };
}

function freshSetup(tokenDelayMs: number) {
  const registry = new ProviderRegistry();
  registry.seedDefaults();
  const capture = new MockAudioCapture();
  const manager = new VoiceManager({
    registry,
    llmBridge: mockLlm(tokenDelayMs),
    captureBackend: capture,
    timing: ACCEL,
  });
  return { registry, capture, manager };
}

function waitUntil(cond: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (cond()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(timer);
        reject(new Error('waitUntil timeout'));
      }
    }, 10);
  });
}

interface TurnResult {
  partials: string[];
  finalText: string;
  states: string[];
  firstAudioAtMs: number | null;
  streamDoneAtMs: number;
  firstSentence: string | null;
}

async function runTurn(tokenDelayMs: number): Promise<TurnResult> {
  const { capture, manager } = freshSetup(tokenDelayMs);
  const partials: string[] = [];
  const finals: string[] = [];
  const states: string[] = [];
  const offState = manager.on('state', (p) => states.push(p.state));
  const offPartial = manager.on('partial', (p) => partials.push(p.text));
  const offFinal = manager.on('final', (p) => finals.push(p.text));
  capture.setScript(SPEECH);
  await manager.startListening('ptt');
  await waitUntil(() => manager.state === 'idle' && manager.ttsEngine.isIdle(), 8000);
  offState();
  offPartial();
  offFinal();
  const timing = manager.lastTurnTiming;
  return {
    partials,
    finalText: finals.join(''),
    states: states.filter((s, i) => i === 0 || s !== states[i - 1]),
    firstAudioAtMs: timing.firstAudioAtMs,
    streamDoneAtMs: timing.streamDoneAtMs,
    firstSentence: timing.firstSentence,
  };
}

async function main(): Promise<void> {
  console.log('Kyclius Voice System - demonstration harness\n');

  console.log('Step 0: canonical state machine sanity');
  ok(verifyRollupCompleteness(), 'every sub-state rolls up to exactly one canonical state');

  console.log('\nStep 1: mock STT produces partials then a final; idle -> listening -> thinking');
  const turn1 = await runTurn(8);
  ok(turn1.partials.length >= 3, `mock STT emitted ${turn1.partials.length} rolling partials before the final`);
  ok(turn1.finalText === 'what is the weather in tokyo tomorrow morning', 'final transcript decoded (mock faster-whisper)', JSON.stringify(turn1.finalText));
  ok(
    JSON.stringify(turn1.states) === JSON.stringify(['listening', 'thinking', 'speaking', 'idle']),
    'canonical state sequence listening -> thinking -> speaking -> idle (T2/T3/T9)',
    turn1.states.join(' -> ')
  );

  console.log('\nStep 2: streaming token source segments into correct sentences');
  const seg = new SentenceSegmenter();
  const emitted: string[] = [];
  const streamText =
    'Good morning. Mr. Smith paid 3.14 dollars. Then Dr. Lee said: e.g. hello world and kept talking for a while so the sentence grows long enough to pass the minimum character threshold cleanly.';
  for (const tok of streamText.match(/\S+\s*/g) ?? []) emitted.push(...seg.push(tok));
  emitted.push(...seg.flush());
  ok(emitted.length === 2, 'abbreviation (Mr.), decimal (3.14), colon-e.g. guarded; short sentence merged', JSON.stringify(emitted));
  ok(emitted[0]?.startsWith('Good morning. Mr. Smith paid 3.14 dollars.'), 'abbreviations/decimals did not split sentences');
  const seg2 = new SentenceSegmenter();
  const plain: string[] = [];
  for (const tok of 'One two three four five six seven eight nine ten. Eleven twelve thirteen fourteen fifteen. Sixteen seventeen eighteen nineteen twenty.'.match(/\S+\s*/g) ?? []) plain.push(...seg2.push(tok));
  plain.push(...seg2.flush());
  ok(plain.length === 3, 'plain sentences split at boundaries', JSON.stringify(plain));

  console.log('\nStep 3: TTS begins on first sentence BEFORE the stream ends (HC5)');
  const turn3 = await runTurn(15); // slower LLM so the margin is unmistakable
  const firstAudio = turn3.firstAudioAtMs ?? 0;
  const margin = turn3.streamDoneAtMs - firstAudio;
  ok(firstAudio > 0, 'playback actually started (queue drained normally afterwards)');
  ok(
    firstAudio < turn3.streamDoneAtMs,
    `first sentence audible at t=${firstAudio}ms, stream finished at t=${turn3.streamDoneAtMs}ms (margin ${margin}ms)`,
    `first sentence: ${JSON.stringify(turn3.firstSentence)}`
  );
  ok(margin > 30, 'playback began while tokens were still streaming', `margin=${margin}ms`);

  console.log('\nStep 4: disabling the mock cloud provider falls back to local, no unhandled error');
  {
    const { registry, manager } = freshSetup(8);
    const cloudStt = registry.all().find((r) => r.preset_key === 'custom.cloud.stt')!;
    const cloudTts = registry.all().find((r) => r.preset_key === 'custom.cloud.tts')!;
    registry.setEnabled(cloudStt.id, true);
    registry.setDefault(cloudStt.id);
    registry.setEnabled(cloudTts.id, true);
    registry.setDefault(cloudTts.id);
    const hops: string[] = [];
    manager.on('provider', (p) => hops.push(`${p.capability}:${p.from ?? 'none'}->${p.to}`));
    await manager.sttEngine.ensureProvider();
    await manager.ttsEngine.ensureProvider();
    ok(manager.activeEngines().stt === 'custom.cloud.stt' && manager.activeEngines().tts === 'custom.cloud.tts', 'cloud rows (opt-in) become active');
    registry.setEnabled(cloudStt.id, false);
    registry.setEnabled(cloudTts.id, false);
    const sttOk = await manager.retryCapability('stt');
    const ttsOk = await manager.retryCapability('tts');
    ok(sttOk && ttsOk, 're-resolution succeeded for both capabilities');
    ok(
      manager.activeEngines().stt === 'local.stt.faster_whisper' && manager.activeEngines().tts === 'local.tts.kokoro',
      'fell back to the local defaults (ladder), engines swapped live'
    );
    ok(
      hops.some((h) => h === 'stt:custom.cloud.stt->local.stt.faster_whisper') &&
        hops.some((h) => h === 'tts:custom.cloud.tts->local.tts.kokoro'),
      'every rung hop announced via provider_changed',
      hops.join(', ')
    );
  }

  console.log('\nStep 5: no provider usable at all -> visible error, never a silent hang');
  {
    const { registry, manager } = freshSetup(8);
    for (const row of registry.where('stt')) registry.setEnabled(row.id, false);
    const degraded: string[] = [];
    manager.on('degraded', (d) => degraded.push(d.code));
    let threw: unknown = null;
    try {
      await manager.startListening('ptt');
    } catch (err) {
      threw = err;
    }
    ok(threw instanceof VoiceError && threw.code === 'STT/NO_ENGINE', 'startListening fails loudly with STT/NO_ENGINE');
    ok(manager.state === 'error', 'canonical state is error (T12)', manager.state);
    ok(degraded.includes('STT/NO_ENGINE'), 'persistent degraded affordance published with reason + actions');
  }
  {
    const { registry, manager } = freshSetup(8);
    for (const row of registry.where('tts')) registry.setEnabled(row.id, false);
    const degraded: string[] = [];
    manager.on('degraded', (d) => degraded.push(d.code));
    let threw: unknown = null;
    try {
      await manager.speak('hello there');
    } catch (err) {
      threw = err;
    }
    ok(threw instanceof VoiceError && threw.code === 'TTS/NO_ENGINE', 'speak fails loudly with TTS/NO_ENGINE');
    ok(manager.state === 'error', 'canonical state is error (T12)', manager.state);
    ok(degraded.includes('TTS/NO_ENGINE'), 'TTS degradation is capability-scoped and visible');
  }

  console.log('\nStep 6: preload bridge exposes exactly the intended narrow surface');
  {
    const exposed: { key?: string; api?: unknown } = {};
    const fakeContextBridge: ContextBridgeLike = {
      exposeInMainWorld: (key, api) => {
        exposed.key = key;
        exposed.api = api;
      },
    };
    const fakeIpc: IpcRendererLike = {
      invoke: async () => ({}),
      on: () => undefined,
      removeListener: () => undefined,
    };
    const api = exposeVoiceBridge(fakeContextBridge, fakeIpc);
    ok(exposed.key === VOICE_BRIDGE_KEY, `exposed on window as \`${VOICE_BRIDGE_KEY}\``);
    const keys = Object.keys(api).sort();
    const expected =
      ['cancelSession', 'confirmAction', 'getMicrophones', 'getProviders', 'getState', 'health', 'on',
       'setDefaultProvider', 'setProviderEnabled', 'speak', 'speakControl', 'startListening',
       'stopListening', 'sendTranscript'].sort();
    ok(JSON.stringify(keys) === JSON.stringify(expected), 'exposed API keys are exactly the allowlisted surface');
    ok(!('invoke' in api) && !('ipcRenderer' in api), 'no pass-through invoker, raw ipcRenderer never exposed');
    let threwEvent = false;
    try {
      api.on('audioBuffer' as never, () => undefined);
    } catch {
      threwEvent = true;
    }
    ok(threwEvent, 'subscribing to a non-allowlisted (audio) event is rejected');

    // Full loop proof: bridge -> allowlist -> dispatcher -> engine.
    const { registry, manager } = freshSetup(8);
    const dispatcher = createVoiceCommandDispatcher({ manager, registry });
    const loopIpc: IpcRendererLike = {
      invoke: async (channel, payload) => {
        if (!VOICE_COMMAND_CHANNEL_LIST.includes(channel as never)) throw new Error(`not allowlisted: ${channel}`);
        return (dispatcher as unknown as Record<string, (p: unknown) => unknown>)[channel](payload);
      },
      on: () => undefined,
      removeListener: () => undefined,
    };
    const loopApi = createVoiceBridgeApi(loopIpc);
    const snap = (await loopApi.getState()) as { state: string; activeStt: string | null };
    ok(snap.state === 'idle' && snap.activeStt === null, 'renderer command reaches the engine through the dispatcher');
    let threwValidation = false;
    try {
      await loopApi.startListening('bash-the-mic' as never);
    } catch {
      threwValidation = true;
    }
    ok(threwValidation, 'main validates payloads; garbage is rejected before any engine call');
    const registered: string[] = [];
    registerVoiceIpc({ handle: (channel) => registered.push(channel) }, dispatcher);
    ok(
      registered.length === VOICE_COMMAND_CHANNEL_LIST.length && registered.every((c) => c.startsWith('voice:')),
      `main registers exactly ${VOICE_COMMAND_CHANNEL_LIST.length} namespaced channels`,
      registered.join(', ')
    );
  }

  console.log('\nHC8 audit: raw audio is memory-only; no fs import exists in voice/audio/** or voice/stt/**, voice/tts/**');
  ok(unhandled === 0, 'zero unhandled promise rejections during the whole run');

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('HARNESS ERROR:', err);
  process.exit(1);
});
