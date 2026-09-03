/**
 * Live view of the microphone pipeline (demo/watch.ts).
 *
 * No physical mic in this standalone build: MockAudioCapture SYNTHESIZES the
 * same 16 kHz mono PCM16 frames a real device would emit (silence, then
 * speech-level frames, then silence) and pushes them through the UNTOUCHED real
 * pipeline: AudioProcessor (AGC) -> Vad (energy gate) -> UtteranceRing ->
 * STTEngine -> MockFasterWhisperProvider -> VoiceManager state machine -> LLM
 * -> TTS -> playback. This proves the whole path works; a real WASAPI/CoreAudio
 * backend drops in behind the same capture interface.
 *
 * Run: node demo/watch.ts
 */
import { ProviderRegistry } from '../voice/core/ProviderRegistry.ts';
import { VoiceManager } from '../voice/core/VoiceManager.ts';
import { MockAudioCapture } from '../voice/audio/AudioCapture.ts';

const ACCEL = {
  frameMs: 10, silenceMs: 120, minSpeechMs: 60, maxSilenceMs: 600,
  maxUtteranceMs: 60000, partialEveryMs: 60, probeTimeoutMs: 500,
  playerChunkMs: 10, synthFirstChunkMs: 40,
};

async function main(): Promise<void> {
  const registry = new ProviderRegistry();
  registry.seedDefaults();
  const capture = new MockAudioCapture();
  const manager = new VoiceManager({
    registry,
    captureBackend: capture,
    timing: ACCEL,
    llmBridge: async function* (_t, _s, sig) {
      const text =
        'The quick brown fox jumps over the lazy dog. Streaming keeps first-audio latency low. Short sentences speak naturally.';
      for (const w of text.match(/\S+\s*/g) ?? []) {
        if (sig.aborted) return;
        await new Promise((r) => setTimeout(r, 12));
        yield w;
      }
    },
  });

  manager.on('state', (p) => console.log('  state   :', p.state, p.detail?.sub ?? ''));
  manager.on('level', (p) => {
    if (p.direction === 'in') process.stdout.write('\r  mic rms : ' + p.rms.toFixed(2) + '   ');
  });
  manager.on('partial', (p) => console.log('\n  partial :', JSON.stringify(p.text)));
  manager.on('final', (p) => console.log('  FINAL   :', JSON.stringify(p.text), '- confidence', p.confidence?.toFixed(2)));
  manager.on('provider', (p) => console.log('  engine  :', p.capability, (p.from ?? '(none)'), '->', p.to, p.reason ?? ''));
  manager.on('speaking', (p) => console.log('  SPEAKING:', p.sentence));
  manager.on('error', (p) => console.log('  error   :', p.code, p.message));
  manager.on('degraded', (p) => console.log('  degraded:', p.code, p.message));

  // The scripted voice: 80ms silence, ~340ms of speech-level frames, then
  // 240ms silence so VAD endpointing fires (silenceMs = 120).
  capture.setScript([
    { ms: 80, level: 0 },
    { ms: 340, level: 0.6 },
    { ms: 240, level: 0 },
  ]);

  console.log('Arming the mic (T1: idle -> listening)...');
  await manager.startListening('ptt');

  await new Promise<void>((resolve) => {
    const t = setInterval(() => {
      if (manager.state === 'idle' && manager.ttsEngine.isIdle()) {
        clearInterval(t);
        resolve();
      }
    }, 10);
  });
  console.log('\nDone - turn completed, queue drained.');
  process.exit(0);
}

main().catch((e) => {
  console.error('WATCH ERROR:', e);
  process.exit(1);
});
