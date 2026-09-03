/**
 * CustomCloudSttAdapter (03 section 5.3): generic BYOK slot, OpenAI-compatible
 * POST {base_url}/audio/transcriptions. Final-only (no streaming endpoint).
 * HC8 egress contract: utterance is encoded to WAV in memory, sent over TLS,
 * and the buffer is zeroed after the response; only the returned text persists.
 */
import type { Health, ProviderRow } from '../../types/provider.ts';
import { decryptProviderKey } from '../../types/provider.ts';
import type { STTProvider, SttSink, SttStreamConfig } from '../STTProvider.ts';

export function encodeWavInMemory(frames: Int16Array[], sampleRate: number): Buffer {
  const totalSamples = frames.reduce((n, f) => n + f.length, 0);
  const dataSize = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (const f of frames) {
    for (let i = 0; i < f.length; i++) {
      buffer.writeInt16LE(f[i], offset);
      offset += 2;
    }
  }
  return buffer;
}

export interface CustomCloudSttOptions {
  fetchImpl?: typeof fetch;
  /** Demo/diagnostic override so no network is needed to exercise the path. */
  healthOverride?: Health;
}

export class CustomCloudSttProvider implements STTProvider {
  readonly row: ProviderRow;
  private healthOverride: Health | null;
  private fetchImpl: typeof fetch;
  private sink: SttSink | null = null;
  private cfg: SttStreamConfig | null = null;
  private utterance: Int16Array[] = [];

  constructor(row: ProviderRow, opts?: CustomCloudSttOptions) {
    this.row = row;
    this.healthOverride = opts?.healthOverride ?? null;
    this.fetchImpl = opts?.fetchImpl ?? fetch;
  }

  async probe(timeoutMs: number): Promise<Health> {
    if (this.healthOverride) return this.healthOverride;
    try {
      const res = await this.fetchImpl(`${this.row.base_url}/models`, { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok ? { status: 'healthy' } : { status: 'unhealthy', detail: `HTTP ${res.status}` };
    } catch (err) {
      return { status: 'unhealthy', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  startStream(cfg: SttStreamConfig, sink: SttSink): void {
    this.cfg = cfg;
    this.sink = sink;
    this.utterance = [];
  }

  /** Cloud slot is final-only: accumulate utterance PCM in memory for the POST. */
  feed(frame: Int16Array, rms: number, atMs: number): void {
    void rms;
    void atMs;
    this.utterance.push(frame);
  }

  finalize(): void {
    void this.transcribeFinal();
  }

  private async transcribeFinal(): Promise<void> {
    const sink = this.sink;
    const cfg = this.cfg;
    if (!sink || !cfg) return;
    let wav: Buffer | null = encodeWavInMemory(this.utterance, cfg.sampleRate);
    this.utterance.length = 0;
    try {
      const res = await this.fetchImpl(`${this.row.base_url}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${decryptProviderKey(this.row) ?? ''}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          audio: wav.toString('base64'),
          model: this.row.default_model ?? 'whisper-1',
          language: cfg.language,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      // HC8: zero the utterance buffer once the response is in.
      if (wav) { wav.fill(0); wav = null; }
      if (res.status === 401 || res.status === 403) {
        sink.onError({ code: 'STT/CLOUD_AUTH', sessionId: cfg.sessionId });
        return;
      }
      if (!res.ok) {
        sink.onError({ code: 'STT/CLOUD_NETWORK', cause: `HTTP ${res.status}`, sessionId: cfg.sessionId });
        return;
      }
      const json = (await res.json()) as { text?: string };
      sink.onFinal({
        text: json.text ?? '',
        confidence: 0.9,
        sessionId: cfg.sessionId,
        atMs: Date.now(),
      });
    } catch (err) {
      sink.onError({ code: 'STT/CLOUD_NETWORK', cause: err, sessionId: cfg.sessionId });
    }
  }

  stopStream(): void {
    this.sink = null;
    this.cfg = null;
    this.utterance.length = 0;
  }

  async dispose(): Promise<void> {
    this.stopStream();
  }
}
