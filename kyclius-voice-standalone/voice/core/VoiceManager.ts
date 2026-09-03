/**
 * VoiceManager (01 section 2): the orchestrator. Owns the canonical state
 * machine, session lifecycle, fallback/degradation policy, and arbitration
 * between listening and speaking (barge-in). React never talks to this
 * directly - only through the IPC bridge (HC7).
 */
import { EventBus } from './EventBus.ts';
import { StateMachine } from './StateMachine.ts';
import { SessionManager } from './SessionManager.ts';
import { ProviderRegistry } from './ProviderRegistry.ts';
import { ProviderResolver } from './ProviderResolver.ts';
import { DegradationController } from './DegradationController.ts';
import { STTEngine } from '../stt/STTEngine.ts';
import { TTSEngine } from '../tts/TTSEngine.ts';
import { MicManager } from '../audio/MicManager.ts';
import { MockAudioCapture, type AudioCaptureBackend, type CaptureSession } from '../audio/AudioCapture.ts';
import { AudioProcessor } from '../audio/AudioProcessor.ts';
import { Vad } from '../audio/Vad.ts';
import { UtteranceRing } from '../audio/AudioBuffer.ts';
import type { VoiceMode, VoiceTimingConfig } from '../types/canonical.ts';
import type { VoiceEventName, VoiceEventPayload } from '../types/events.ts';
import { VoiceError } from '../types/errors.ts';

export const DEFAULT_TIMING: VoiceTimingConfig = {
  frameMs: 20,
  silenceMs: 700,
  minSpeechMs: 250,
  maxSilenceMs: 8000,
  maxUtteranceMs: 60000,
  partialEveryMs: 300,
  probeTimeoutMs: 3000,
  playerChunkMs: 12,
  synthFirstChunkMs: 150,
};

const MIN_CONFIDENCE = 0.45;

/** Adapter over the EXISTING LLM runtime; voice never calls providers directly. */
export type LlmBridge = (
  transcript: string,
  sessionId: string,
  signal: AbortSignal,
) => AsyncIterable<string>;

export interface VoiceManagerOptions {
  registry: ProviderRegistry;
  llmBridge: LlmBridge;
  timing?: Partial<VoiceTimingConfig>;
  captureBackend?: AudioCaptureBackend;
  micManager?: MicManager;
}

export interface TurnTiming {
  firstAudioAtMs: number | null;
  streamDoneAtMs: number;
  firstSentence: string | null;
}

export class VoiceManager {
  readonly bus = new EventBus();
  readonly stateMachine: StateMachine;
  readonly sessions = new SessionManager();
  readonly degradation: DegradationController;
  readonly resolver: ProviderResolver;
  readonly sttEngine: STTEngine;
  readonly ttsEngine: TTSEngine;
  readonly micManager: MicManager;
  lastTurnTiming: TurnTiming = { firstAudioAtMs: null, streamDoneAtMs: 0, firstSentence: null };

  private opts: VoiceManagerOptions;
  private timing: VoiceTimingConfig;
  private processor = new AudioProcessor();
  private vad: Vad | null = null;
  private ring: UtteranceRing | null = null;
  private capture: CaptureSession | null = null;
  private noSpeechTimer: ReturnType<typeof setTimeout> | null = null;
  private llmAbort: AbortController | null = null;
  private llmDone = false;
  private streamDoneAtMs = 0;
  private firstAudioAtMs: number | null = null;
  private firstSentenceText: string | null = null;
  private listeningSessionId: string | null = null;

  constructor(opts: VoiceManagerOptions) {
    this.opts = opts;
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
    this.stateMachine = new StateMachine(this.bus);
    this.degradation = new DegradationController(this.bus);
    this.resolver = new ProviderResolver(this.bus, opts.registry, this.degradation, this.timing.probeTimeoutMs);
    this.sttEngine = new STTEngine(this.bus, this.resolver, this.timing);
    this.micManager = new MicManager(opts.captureBackend ?? new MockAudioCapture());
    this.ttsEngine = new TTSEngine(this.bus, this.resolver, this.timing, (id) => this.isSessionLive(id));
    this.ttsEngine.onFirstSentenceAccepted = () => {
      if (this.stateMachine.state === 'thinking') {
        this.stateMachine.transition('speaking', 'T3.first_sentence_segmented');
        const s = this.sessions.current;
        if (s) this.sessions.setState(s.id, 'speaking');
      }
    };
    this.bus.on('speaking', (p) => {
      if (this.firstAudioAtMs === null) {
        this.firstAudioAtMs = Date.now();
        this.firstSentenceText = p.sentence;
      }
    });
    this.bus.on('queue', () => this.maybeFinishTurn());
  }

  get state(): string {
    return this.stateMachine.state;
  }

  on<K extends VoiceEventName>(event: K, handler: (p: VoiceEventPayload<K>) => void): () => void {
    return this.bus.on(event, handler);
  }

  isSessionLive(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    return !!s && !s.cancelled && !s.interrupted && !s.endedAtMs;
  }

  activeEngines(): { stt: string | null; tts: string | null } {
    return { stt: this.sttEngine.activePresetKey(), tts: this.ttsEngine.activePresetKey() };
  }

  /** T1: user arms mic. Guards: mic device + permission + usable STT provider. */
  async startListening(mode: VoiceMode = 'ptt'): Promise<{ sessionId: string }> {
    void mode;
    if (this.stateMachine.state === 'listening' && this.listeningSessionId) {
      return { sessionId: this.listeningSessionId };
    }
    try {
      await this.sttEngine.ensureProvider();
      const devices = await this.micManager.listDevices();
      if (devices.length === 0) {
        throw new VoiceError({
          code: 'MIC/DEVICE_MISSING',
          message: 'No microphone found. Plug one in or pick another input.',
          recoverable: true,
          actions: ['Check devices'],
        });
      }
    } catch (err) {
      // T12: ladder exhausted or hard guard failed -> visible error state.
      this.stateMachine.transition('error', 'T12.voice_subsystem_failure');
      throw err;
    }

    const session = this.sessions.create();
    this.listeningSessionId = session.id;
    this.stateMachine.setSessionId(session.id);
    this.stateMachine.transition('listening', 'T1.user_arms_mic', 'listening.awaiting_speech');
    this.sessions.setState(session.id, 'listening');

    this.ring = new UtteranceRing(this.timing.maxUtteranceMs, this.timing.frameMs);
    this.vad = new Vad({
      threshold: 0.05,
      frameMs: this.timing.frameMs,
      silenceMs: this.timing.silenceMs,
      onSpeechStart: (atMs) => this.handleSpeechStart(atMs),
      onSpeechEnd: (atMs, utteranceMs) => this.handleSpeechEnd(atMs, utteranceMs),
      onLevel: (rms) => this.bus.emit('level', { direction: 'in', rms }),
    });
    this.capture = await this.micManager.open({
      sampleRate: 16000,
      frameMs: this.timing.frameMs,
      onFrame: (frame, atMs) => this.handleFrame(frame, atMs),
    });
    this.armNoSpeechWatchdog();
    return { sessionId: session.id };
  }

  private handleFrame(frame: Int16Array, atMs: number): void {
    if (!this.vad || !this.ring) return;
    const { frame: processed, rms } = this.processor.process(frame);
    this.ring.push(frame); // in-memory only (HC8)
    this.vad.feed(processed, atMs);
    this.sttEngine.feed(processed, rms, atMs);
  }

  private handleSpeechStart(atMs: number): void {
    void atMs;
    const session = this.sessions.current;
    if (!session) return;
    this.clearNoSpeechWatchdog();
    const gen = session.generation;
    void this.sttEngine
      .beginSession(
        {
          sessionId: session.id,
          language: 'auto',
          sampleRate: 16000,
          frameMs: this.timing.frameMs,
          model: this.sttEngine.activeModel,
        },
        {
          onPartial: (p) => {
            if (!this.sessions.isCurrent(p.sessionId, gen)) return; // stale guard
            session.transcript.push({ text: p.text, final: false, atMs: p.atMs });
            this.bus.emit('partial', { sessionId: p.sessionId, text: p.text });
          },
          onFinal: (p) => this.handleFinalTranscript(p),
          onError: (p) => {
            this.bus.emit('error', {
              code: p.code,
              message: 'Speech recognition error.',
              recoverable: true,
              actions: ['Retry'],
              sessionId: p.sessionId,
              cause: p.cause,
            });
          },
          onModelProgress: (p) =>
            this.bus.emit('modelProgress', { capability: 'stt', status: p.status, progress: p.progress }),
        },
      )
      .catch((err) => {
        this.bus.emit('error', {
          code: 'STT/ENGINE_FAILED',
          message: 'Speech recognition failed to start.',
          recoverable: true,
          actions: ['Retry'],
          cause: err,
        });
      });
  }

  private handleSpeechEnd(atMs: number, utteranceMs: number): void {
    void atMs;
    if (utteranceMs < this.timing.minSpeechMs) {
      // T10: too short (coughs/clicks) - discard, keep listening.
      this.ring?.zeroize();
      this.stateMachine.transition('listening', 'T10.didnt_catch', 'listening.didnt_catch');
      this.armNoSpeechWatchdog();
      return;
    }
    this.sttEngine.finalize(); // sink.onFinal -> handleFinalTranscript
  }

  private handleFinalTranscript(p: { text: string; confidence: number; sessionId: string; atMs: number }): void {
    const session = this.sessions.get(p.sessionId);
    if (!session || session.cancelled) return;
    this.ring?.zeroize(); // HC8: audio dies with the utterance
    if (p.confidence < MIN_CONFIDENCE) {
      this.bus.emit('error', {
        code: 'STT/LOW_CONFIDENCE',
        message: `Did you say "${p.text}"?`,
        recoverable: true,
        actions: ['Correct'],
        sessionId: p.sessionId,
      });
      return; // never dispatch a wrong request to the LLM (03 section 2)
    }
    session.transcript.push({ text: p.text, final: true, atMs: p.atMs, confidence: p.confidence });
    this.bus.emit('final', { sessionId: p.sessionId, text: p.text, confidence: p.confidence });
    if (this.stateMachine.state === 'listening') {
      this.stateMachine.transition('thinking', 'T2.utterance_finalized', 'thinking.awaiting_first_token');
      this.sessions.setState(p.sessionId, 'thinking');
    }
    void this.dispatchToLlm(p.text, p.sessionId, session.generation);
  }

  private async dispatchToLlm(text: string, sessionId: string, gen: number): Promise<void> {
    this.firstAudioAtMs = null;
    this.firstSentenceText = null;
    this.llmDone = false;
    this.llmAbort = new AbortController();
    const signal = this.llmAbort.signal;
    const sessions = this.sessions;
    // Stale-guard wrapper: a token from a superseded turn is dropped.
    async function* guarded(src: AsyncIterable<string>): AsyncIterable<string> {
      for await (const t of src) {
        if (!sessions.isCurrent(sessionId, gen)) return;
        yield t;
      }
    }
    try {
      let response = '';
      await this.ttsEngine.speakFromTokenStream(
        guarded(this.opts.llmBridge(text, sessionId, signal)),
        sessionId,
        (token) => {
          response += token;
        },
      );
      this.streamDoneAtMs = Date.now();
      this.llmDone = true;
      const session = sessions.get(sessionId);
      if (session) session.aiResponse = { full: response, spokenUpTo: 0 };
      this.maybeFinishTurn();
    } catch (err) {
      if (signal.aborted) return; // barge-in/stop; session already handled
      this.bus.emit('error', {
        code: 'LLM/STREAM_FAILED',
        message: 'The reply failed to generate.',
        recoverable: true,
        actions: ['Retry'],
        sessionId,
        cause: err,
      });
      this.stateMachine.transition('error', 'T12.voice_subsystem_failure');
    }
  }

  private maybeFinishTurn(): void {
    const session = this.sessions.current;
    if (!session || !this.llmDone) return;
    if (!this.ttsEngine.isIdle()) return;
    if (this.stateMachine.state === 'speaking') {
      this.lastTurnTiming = {
        firstAudioAtMs: this.firstAudioAtMs,
        streamDoneAtMs: this.streamDoneAtMs,
        firstSentence: this.firstSentenceText,
      };
      this.stateMachine.transition('idle', 'T9.queue_drained');
      this.sessions.end(session.id, 'completed');
      this.stateMachine.setSessionId(null);
      this.listeningSessionId = null;
    }
  }

  /** voice:speak - speak arbitrary text (e.g. replay) from idle. */
  async speak(text: string): Promise<{ sessionId: string }> {
    const session = this.sessions.create();
    this.stateMachine.setSessionId(session.id);
    try {
      await this.ttsEngine.ensureProvider();
    } catch (err) {
      this.stateMachine.transition('error', 'T12.voice_subsystem_failure');
      this.sessions.end(session.id, 'failed');
      throw err;
    }
    this.stateMachine.transition('speaking', 'T3.speak_command');
    this.firstAudioAtMs = null;
    this.firstSentenceText = null;
    this.llmDone = true; // no LLM stream in this path
    try {
      await this.ttsEngine.speakText(text, session.id);
    } catch (err) {
      this.sessions.end(session.id, 'failed');
      this.stateMachine.transition('error', 'T12.voice_subsystem_failure');
      throw err;
    }
    this.maybeFinishTurn();
    return { sessionId: session.id };
  }

  /** T11 barge-in: user talks over playback (or presses PTT). */
  async interrupt(): Promise<void> {
    if (this.stateMachine.state !== 'speaking') return;
    const session = this.sessions.current;
    if (!session) return;
    this.stateMachine.flagSub('speaking.interrupting');
    this.sessions.interrupt(session.id);
    this.ttsEngine.hardStop(session.id); // queue cleared + fade + synth aborted
    this.llmAbort?.abort();
    this.stateMachine.clearSub();
    this.stateMachine.transition('listening', 'T11.barge_in');
    this.sessions.setState(session.id, 'listening');
  }

  /** T4/T5/T6: tool-proposal confirmation flow. */
  proposeAction(label: string): void {
    const session = this.sessions.current;
    if (!session || this.stateMachine.state !== 'thinking') return;
    session.pendingAction = { proposalId: `act_${session.id}`, label };
    this.stateMachine.transition('awaiting_confirmation', 'T4.tool_proposed');
    this.bus.emit('confirmation', { sessionId: session.id, proposal: session.pendingAction });
  }

  confirm(approved: boolean): void {
    const session = this.sessions.current;
    if (!session || this.stateMachine.state !== 'awaiting_confirmation') return;
    if (approved) {
      this.stateMachine.transition('executing', 'T5.approved');
      this.sessions.setState(session.id, 'executing');
    } else {
      this.stateMachine.transition('thinking', 'T6.rejected');
    }
  }

  /** Called by the app when an approved action completes (T7/T8). */
  actionCompleted(resultText: string | null): void {
    const session = this.sessions.current;
    if (!session || this.stateMachine.state !== 'executing') return;
    if (resultText) {
      this.stateMachine.transition('speaking', 'T7.action_complete_tts_begins');
      void this.ttsEngine.speakText(resultText, session.id);
    } else {
      this.stateMachine.transition('idle', 'T8.action_complete_no_tts');
      this.sessions.end(session.id, 'completed');
    }
  }

  /** T13 one-click recovery: re-run resolution for a capability. */
  async retryCapability(capability: 'stt' | 'tts'): Promise<boolean> {
    try {
      if (capability === 'stt') await this.sttEngine.ensureProvider();
      else await this.ttsEngine.reResolve();
      this.stateMachine.recover();
      return true;
    } catch {
      return false;
    }
  }

  /** PTT release: finalize the in-flight utterance (T2). */
  sendTranscript(): void {
    if (this.stateMachine.state !== 'listening') return;
    if (this.vad?.isSpeaking) {
      this.sttEngine.finalize();
    } else {
      this.stopVoice();
    }
  }

  /** T14: user stops voice / session closed. */
  stopVoice(): void {
    const session = this.sessions.current;
    if (session && !session.endedAtMs) this.sessions.cancel(session.id);
    this.clearNoSpeechWatchdog();
    this.llmAbort?.abort();
    if (session) this.ttsEngine.hardStop(session.id);
    this.capture?.close();
    this.micManager.close();
    this.capture = null;
    this.vad = null;
    this.ring = null;
    this.listeningSessionId = null;
    if (this.stateMachine.isLegal('idle')) {
      this.stateMachine.transition('idle', 'T14.stopped');
    }
  }

  private armNoSpeechWatchdog(): void {
    this.clearNoSpeechWatchdog();
    this.noSpeechTimer = setTimeout(() => {
      // T10: silence before any speech -> "didn't catch that", never a hang.
      this.stateMachine.transition('listening', 'T10.didnt_catch', 'listening.didnt_catch');
      this.bus.emit('error', {
        code: 'STT/DIDNT_CATCH',
        message: "Didn't catch that - try speaking again.",
        recoverable: true,
        actions: [],
      });
      this.stateMachine.clearSub();
      this.armNoSpeechWatchdog();
    }, this.timing.maxSilenceMs);
  }

  private clearNoSpeechWatchdog(): void {
    if (this.noSpeechTimer) {
      clearTimeout(this.noSpeechTimer);
      this.noSpeechTimer = null;
    }
  }

  async dispose(): Promise<void> {
    this.stopVoice();
  }
}
