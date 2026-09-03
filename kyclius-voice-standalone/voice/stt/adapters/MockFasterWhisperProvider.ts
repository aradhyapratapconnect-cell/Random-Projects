/**
 * MOCK local STT provider (clearly labeled). Simulates the
 * local.stt.faster_whisper adapter against the Local Engine Host: emits rolling
 * partials while speech is ongoing and a full final decode at speech-end with
 * token-weighted confidence. Interface-compatible with the real adapter, which
 * streams WS frames to the host; here the "decode" is a scripted transcript.
 */
import type { Health, ProviderRow } from '../../types/provider.ts';
import type { STTProvider, SttSink, SttStreamConfig } from '../STTProvider.ts';
import { delay } from '../../core/timing.ts';

export class MockFasterWhisperProvider implements STTProvider {
  readonly row: ProviderRow;
  private sink: SttSink | null = null;
  private cfg: SttStreamConfig | null = null;
  private words: string[];
  private partialEveryMs: number;
  private speechMs = 0;
  private partialsEmitted = 0;

  constructor(row: ProviderRow, opts?: { transcript?: string; partialEveryMs?: number }) {
    this.row = row;
    this.words = (opts?.transcript ?? 'what is the weather in tokyo tomorrow morning').split(/\s+/);
    this.partialEveryMs = opts?.partialEveryMs ?? 120;
  }

  async probe(timeoutMs: number): Promise<Health> {
    void timeoutMs;
    await delay(1);
    return { status: 'healthy', detail: 'simulated faster-whisper (mock)' };
  }

  startStream(cfg: SttStreamConfig, sink: SttSink): void {
    this.cfg = cfg;
    this.sink = sink;
    this.speechMs = 0;
    this.partialsEmitted = 0;
    sink.onModelProgress({ status: 'loaded (simulated faster-whisper, mock)' });
  }

  feed(frame: Int16Array, rms: number, atMs: number): void {
    void atMs;
    void frame;
    if (!this.sink || !this.cfg || rms < 0.02) return;
    this.speechMs += this.cfg.frameMs;
    while (this.speechMs >= (this.partialsEmitted + 1) * this.partialEveryMs) {
      this.partialsEmitted++;
      const words = Math.min(this.words.length, Math.max(1, this.partialsEmitted));
      this.sink.onPartial({
        text: this.words.slice(0, words).join(' '),
        sessionId: this.cfg.sessionId,
        atMs: Date.now(),
      });
    }
  }

  /** Full decode at VAD speech-end (higher accuracy than partials). */
  finalize(): void {
    if (!this.sink || !this.cfg) return;
    this.sink.onFinal({
      text: this.words.join(' '),
      confidence: 0.87,
      sessionId: this.cfg.sessionId,
      atMs: Date.now(),
    });
  }

  stopStream(): void {
    this.sink = null;
    this.cfg = null;
  }

  async dispose(): Promise<void> {
    this.stopStream();
  }
}
