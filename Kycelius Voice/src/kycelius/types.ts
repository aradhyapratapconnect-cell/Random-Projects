/**
 * Kycelius Voice — shared engine types.
 * Provider-agnostic contracts so STT/TTS backends can be swapped freely.
 */

export type STTProvider = 'whisper-local' | 'webspeech' | 'server';
export type TTSProvider = 'browser' | 'sapi' | 'server';

export type VoiceEngineState =
  | 'idle'
  | 'initializing'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'error';

export interface TranscriptSegment {
  id: string;
  text: string;
  isFinal: boolean;
  source: STTProvider;
  timestamp: number;
  /** confidence 0..1 when the backend reports one */
  confidence?: number;
  /** wall-clock ms from speech start to final result */
  latencyMs?: number;
}

export interface VadConfig {
  /** RMS energy threshold (0..1) above the adaptive noise floor */
  threshold: number;
  /** how long silence (ms) ends an utterance in hands-free mode */
  silenceMs: number;
  /** minimum speech duration (ms) before an utterance is accepted */
  minSpeechMs: number;
}

export interface TtsOptions {
  rate: number;
  pitch: number;
  voice?: string;
}

export interface STTEngineConfig {
  provider: STTProvider;
  whisperModel?: string;
  language?: string;
  serverUrl?: string;
  apiKey?: string;
}

export interface TTSEngineConfig {
  provider: TTSProvider;
  voice?: string;
  rate: number;
  pitch: number;
  serverUrl?: string;
  apiKey?: string;
}

export interface ModelProgress {
  status: string;
  /** 0..1 when determinable */
  progress?: number;
  file?: string;
}

/** Every event the unified VoiceEngine emits */
export interface VoiceEngineEvents {
  state: VoiceEngineState;
  partial: TranscriptSegment;
  final: TranscriptSegment;
  /** live mic RMS level, 0..1, ~30 Hz */
  level: number;
  /** VAD crossed into speech */
  speechStart: void;
  /** VAD decided the utterance ended */
  speechEnd: void;
  speakStart: string;
  speakEnd: void;
  modelProgress: ModelProgress;
  error: Error;
}

export interface ISTTEngine {
  readonly provider: STTProvider;
  /** Load models / warm up. Reports download progress when applicable. */
  initialize(onProgress?: (p: ModelProgress) => void): Promise<void>;
  readonly ready: boolean;
  /** Buffer-based transcription (whisper-local, server). */
  transcribe?(audio: Float32Array, sampleRate: number): Promise<string>;
  /** Streaming recognition (webspeech). */
  startStreaming?(handlers: {
    onPartial: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (err: Error) => void;
  }): void;
  stopStreaming?(): void;
  dispose(): Promise<void>;
}

export interface ITTSEngine {
  readonly provider: TTSProvider;
  initialize(): Promise<void>;
  /** Speak text; resolves when playback finishes. */
  speak(text: string, options: TtsOptions): Promise<void>;
  stop(): void;
  dispose(): void;
}
