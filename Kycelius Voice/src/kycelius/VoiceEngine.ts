import { TypedEvents } from './events';
import { AudioCapture, encodeWav } from './audio/AudioCapture';
import { VadDetector } from './audio/vad';
import { WhisperEngine } from './stt/WhisperEngine';
import { WebSpeechEngine } from './stt/WebSpeechEngine';
import { ServerSTTEngine } from './stt/ServerSTTEngine';
import { BrowserTTSEngine } from './tts/BrowserTTSEngine';
import { SapiTTSEngine } from './tts/SapiTTSEngine';
import { ServerTTSEngine } from './tts/ServerTTSEngine';
import type {
  ISTTEngine,
  ITTSEngine,
  ModelProgress,
  STTEngineConfig,
  TTSEngineConfig,
  TranscriptSegment,
  VadConfig,
  VoiceEngineEvents,
  VoiceEngineState,
} from './types';

export interface VoiceEngineOptions {
  stt: STTEngineConfig;
  tts: TTSEngineConfig;
  vad?: Partial<VadConfig>;
}

const DEFAULT_VAD: VadConfig = {
  // 0.008 (not 0.015): mics with noiseSuppression+AGC often output speech
  // RMS of only ~0.003-0.012 — a higher fixed threshold means the VAD
  // never opens and transcription silently never happens.
  threshold: 0.008,
  silenceMs: 1400,
  minSpeechMs: 250,
};

/**
 * ════════════════════════════════════════════════════════════════════
 *  Kycelius Voice Engine
 * ════════════════════════════════════════════════════════════════════
 *  Unified, provider-agnostic speech engine:
 *
 *    Mic -> AudioWorklet PCM -> VAD -> STT (Whisper/WebSpeech/Server)
 *                                -> Text  ->  TTS (Browser/SAPI/Server)
 *
 *  Usage:
 *    const engine = new VoiceEngine({ stt: {...}, tts: {...} });
 *    engine.on('final', seg => console.log(seg.text));
 *    await engine.startListening({ handsFree: true });
 *    await engine.speak('Hello, world.');
 *
 *  It is UI-agnostic — drop it into any React/Electron/plain app.
 */
export class VoiceEngine extends TypedEvents<VoiceEngineEvents> {
  private stt: ISTTEngine;
  private tts: ITTSEngine;
  private capture: AudioCapture | null = null;
  private vad: VadDetector;

  private state: VoiceEngineState = 'idle';
  private listening = false;
  private handsFree = false;
  private utterance: Float32Array[] = [];
  private utteranceSamples = 0;
  private transcribing = false;
  private segmentSeq = 0;
  private wasListeningBeforeSpeak = false;
  private disposed = false;

  constructor(private options: VoiceEngineOptions) {
    super();
    this.vad = new VadDetector({ ...DEFAULT_VAD, ...options.vad });
    this.stt = this.createSTT(options.stt);
    this.tts = this.createTTS(options.tts);
  }

  // ── Public API ───────────────────────────────────────────────────────

  /** Begin capturing mic audio. `handsFree` uses VAD to auto-detect utterances. */
  async startListening(opts: { handsFree?: boolean } = {}): Promise<void> {
    if (this.disposed) {
      const err = new Error('VoiceEngine was destroyed — create a new instance');
      console.error('[kycelius]', err.message);
      this.emit('error', err);
      return;
    }
    if (this.listening) return;
    this.handsFree = opts.handsFree ?? true;

    this.setState('initializing');
    try {
      await this.ensureSTT();

      if (!this.capture) {
        this.capture = new AudioCapture({
          sampleRate: 16000,
          vad: { ...DEFAULT_VAD, ...this.options.vad },
          onChunk: (chunk, level) => this.handleChunk(chunk, level),
        });
      }
      await this.capture.start();

      // Streaming STT (WebSpeech) runs its own recognizer alongside capture
      if (this.stt.startStreaming) {
        this.stt.startStreaming({
          onPartial: (text) => this.emitPartial(text),
          onFinal: (text) => this.emitFinal(text),
          onError: (err) => this.emit('error', err),
        });
      }

      this.listening = true;
      this.setState('listening');
    } catch (err) {
      this.setState('error');
      this.emit(
        'error',
        err instanceof Error ? err : new Error(`Failed to start listening: ${String(err)}`),
      );
    }
  }

  /** Stop capturing. Any buffered (un-finalized) speech is transcribed first. */
  async stopListening(): Promise<void> {
    if (!this.listening) return;
    this.listening = false;
    this.stt.stopStreaming?.();

    const hadUtterance = this.utterance.length > 0;
    // Finalize in BOTH modes: hands-free stop should never silently
    // discard audio the user spoke.
    if (hadUtterance && !this.transcribing) {
      await this.finalizeUtterance();
    }

    this.capture?.stop();
    this.utterance = [];
    this.utteranceSamples = 0;
    this.vad.reset();
    if (this.state !== 'error') this.setState('idle');
  }

  /** Speak text through the active TTS engine (pauses mic to avoid echo loops). */
  async speak(text: string): Promise<void> {
    if (!text.trim() || this.disposed) return;
    if (this.listening) {
      this.wasListeningBeforeSpeak = true;
      await this.stopListening();
    }

    this.setState('speaking');
    this.emit('speakStart', text);
    try {
      await this.tts.speak(text, {
        rate: this.options.tts.rate,
        pitch: this.options.tts.pitch,
        voice: this.options.tts.voice,
      });
    } catch (err) {
      this.emit(
        'error',
        err instanceof Error ? err : new Error(`TTS failed: ${String(err)}`),
      );
    } finally {
      this.emit('speakEnd', undefined);
      if (this.wasListeningBeforeSpeak && !this.disposed) {
        this.wasListeningBeforeSpeak = false;
        void this.startListening({ handsFree: this.handsFree });
      } else if (this.state === 'speaking') {
        this.setState('idle');
      }
    }
  }

  stopSpeaking(): void {
    this.tts.stop();
  }

  /** Hot-swap the STT backend at runtime. */
  async setSTT(config: STTEngineConfig): Promise<void> {
    const wasListening = this.listening;
    if (wasListening) await this.stopListening();
    await this.stt.dispose();
    this.options.stt = config;
    this.stt = this.createSTT(config);
    if (wasListening) await this.startListening({ handsFree: this.handsFree });
  }

  /** Hot-swap the TTS backend at runtime. */
  setTTS(config: TTSEngineConfig): void {
    this.tts.dispose();
    this.options.tts = config;
    this.tts = this.createTTS(config);
  }

  setVadConfig(cfg: Partial<VadConfig>): void {
    this.options.vad = { ...DEFAULT_VAD, ...this.options.vad, ...cfg };
    this.vad.setConfig({ ...DEFAULT_VAD, ...this.options.vad });
    this.capture?.setVadConfig({ ...DEFAULT_VAD, ...this.options.vad });
  }

  /** AnalyserNode for waveform visualization (null when not listening). */
  getAnalyser(): AnalyserNode | null {
    return this.capture?.getAnalyser() ?? null;
  }

  /** The effective VAD energy gate right now (for tuning UIs). */
  getVadGate(): number {
    return this.capture?.getVadGate() ?? this.vad.currentGate;
  }

  getState(): VoiceEngineState {
    return this.state;
  }

  get sttProvider(): string {
    return this.stt.provider;
  }

  get ttsProvider(): string {
    return this.tts.provider;
  }

  async destroy(): Promise<void> {
    this.disposed = true;
    await this.stopListening();
    await this.stt.dispose();
    this.tts.dispose();
    this.capture = null;
    this.removeAll();
  }

  // ── Internals ────────────────────────────────────────────────────────

  private handleChunk(chunk: Float32Array, level: number): void {
    this.emit('level', level);

    if (!this.listening) return;

    if (this.stt.startStreaming) {
      // Streaming engines (WebSpeech) drive their own endpoints — nothing to buffer
      return;
    }

    const vadResult = this.capture?.evalVad(level);

    if (this.handsFree && vadResult) {
      switch (vadResult) {
        case 'speech':
          if (this.utterance.length === 0) {
            console.debug('[kycelius] VAD: speech start', { level, gate: this.getVadGate() });
            this.emit('speechStart', undefined);
          }
          this.utterance.push(chunk);
          this.utteranceSamples += chunk.length;
          // Safety valve: force-finalize very long utterances (12 s) so a
          // noisy room can never buffer forever without transcribing.
          if (this.utteranceSamples >= 16000 * 12) {
            console.debug('[kycelius] VAD: max utterance length — force finalizing');
            this.emit('speechEnd', undefined);
            void this.finalizeUtterance();
          }
          break;
        case 'utterance-end':
          console.debug('[kycelius] VAD: utterance end', {
            samples: this.utteranceSamples,
            seconds: (this.utteranceSamples / 16000).toFixed(2),
          });
          this.emit('speechEnd', undefined);
          void this.finalizeUtterance();
          break;
        case 'silence':
        default:
          break;
      }
    } else if (!this.handsFree) {
      // Push-to-talk: buffer everything while listening
      this.utterance.push(chunk);
      this.utteranceSamples += chunk.length;
    }
  }

  private async finalizeUtterance(): Promise<void> {
    if (this.transcribing || this.utterance.length === 0) return;
    if (!this.stt.transcribe) {
      this.utterance = [];
      return;
    }

    this.transcribing = true;
    const started = performance.now();

    // WhisperEngine transfers the underlying buffer, so flatten a private copy
    const totalSamples = this.utteranceSamples;
    const total = this.utterance.reduce((n, c) => n + c.length, 0);
    const pcm = new Float32Array(total);
    let off = 0;
    let peak = 0;
    for (const c of this.utterance) {
      pcm.set(c, off);
      for (let i = 0; i < c.length; i++) {
        const a = Math.abs(c[i]);
        if (a > peak) peak = a;
      }
      off += c.length;
    }
    this.utterance = [];
    this.utteranceSamples = 0;

    console.debug(
      `[kycelius] transcribing ${(totalSamples / 16000).toFixed(2)}s of audio ` +
        `(peak ${peak.toFixed(3)})`,
    );

    this.setState('processing');
    try {
      const text = await this.stt.transcribe(pcm, 16000);
      if (text) {
        this.emitFinal(text, performance.now() - started);
      }
    } catch (err) {
      this.emit(
        'error',
        err instanceof Error ? err : new Error(`STT failed: ${String(err)}`),
      );
    } finally {
      this.transcribing = false;
      if (this.listening) {
        this.setState('listening');
      } else if (this.state === 'processing') {
        this.setState('idle');
      }
    }
  }

  private emitPartial(text: string): void {
    const seg: TranscriptSegment = {
      id: `seg-${this.segmentSeq}`,
      text,
      isFinal: false,
      source: this.stt.provider,
      timestamp: Date.now(),
    };
    this.emit('partial', seg);
  }

  private emitFinal(text: string, latencyMs?: number): void {
    const seg: TranscriptSegment = {
      id: `seg-${this.segmentSeq++}`,
      text,
      isFinal: true,
      source: this.stt.provider,
      timestamp: Date.now(),
      latencyMs,
    };
    this.emit('final', seg);
  }

  private ensureSTT(): Promise<void> {
    if (this.stt.ready) return Promise.resolve();
    this.emit('modelProgress', { status: 'initializing' } as ModelProgress);
    return this.stt.initialize((p) => this.emit('modelProgress', p));
  }

  private setState(s: VoiceEngineState): void {
    this.state = s;
    this.emit('state', s);
  }

  private createSTT(cfg: STTEngineConfig): ISTTEngine {
    switch (cfg.provider) {
      case 'whisper-local':
        return new WhisperEngine(
          cfg.whisperModel ?? 'onnx-community/whisper-base',
          cfg.language ?? 'en',
        );
      case 'webspeech':
        return new WebSpeechEngine();
      case 'server':
        return new ServerSTTEngine(cfg.serverUrl ?? '', cfg.apiKey ?? '');
      default:
        throw new Error(`Unknown STT provider: ${cfg.provider}`);
    }
  }

  private createTTS(cfg: TTSEngineConfig): ITTSEngine {
    switch (cfg.provider) {
      case 'browser':
        return new BrowserTTSEngine();
      case 'sapi':
        return new SapiTTSEngine();
      case 'server':
        return new ServerTTSEngine(cfg.serverUrl ?? '', cfg.apiKey ?? '');
      default:
        throw new Error(`Unknown TTS provider: ${cfg.provider}`);
    }
  }
}

export { encodeWav };
