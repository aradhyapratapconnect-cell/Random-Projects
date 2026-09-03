/**
 * STT provider abstraction (03 section 1). Every STT backend - local
 * faster-whisper, System, or the generic custom cloud slot - implements this
 * one interface and is constructed from a providers-table row (HC3).
 */
import type { ErrorCode } from '../types/errors.ts';
import type { Health, ProviderRow } from '../types/provider.ts';

export interface SttStreamConfig {
  sessionId: string;
  language: string;   // BCP-47; 'auto' allowed for local whisper
  sampleRate: number; // engine receives 16 kHz mono PCM16 (normalized upstream)
  frameMs: number;
  model: string | null; // from row.default_model
}

export interface SttSink {
  onPartial(p: { text: string; sessionId: string; atMs: number }): void;
  onFinal(p: { text: string; confidence: number; sessionId: string; atMs: number }): void;
  onError(p: { code: ErrorCode; cause?: unknown; sessionId: string }): void;
  onModelProgress(p: { status: string; progress?: number }): void;
}

export interface STTProvider {
  readonly row: ProviderRow;
  probe(timeoutMs: number): Promise<Health>;
  startStream(cfg: SttStreamConfig, sink: SttSink): void;
  /** One canonical 16 kHz mono PCM16 frame in (AudioProcessor output). */
  feed(frame: Int16Array, rms: number, atMs: number): void;
  finalize(): void;
  stopStream(): void;
  dispose(): Promise<void>;
}
