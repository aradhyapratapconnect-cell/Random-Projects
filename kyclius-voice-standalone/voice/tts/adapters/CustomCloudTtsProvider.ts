/**
 * CustomCloudTtsAdapter (04 HC4): generic BYOK slot, OpenAI-compatible
 * POST {base_url}/audio/speech. Returned audio is decoded to PCM in-flight,
 * queued, played, and freed - never written to disk (HC8).
 */
import type { Health, ProviderRow } from '../../types/provider.ts';
import { decryptProviderKey } from '../../types/provider.ts';
import type { PcmChunk } from '../../audio/AudioPlayer.ts';
import type { SynthesizeRequest, TTSProvider, VoiceInfo } from '../TTSProvider.ts';

export interface CustomCloudTtsOptions {
  fetchImpl?: typeof fetch;
  healthOverride?: Health;
}

export class CustomCloudTtsProvider implements TTSProvider {
  readonly row: ProviderRow;
  private healthOverride: Health | null;
  private fetchImpl: typeof fetch;
  private aborts = new Map<number, AbortController>();

  constructor(row: ProviderRow, opts?: CustomCloudTtsOptions) {
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

  async listVoices(): Promise<VoiceInfo[]> {
    return [{ id: this.row.default_model ?? 'tts-1', language: 'en-US' }];
  }

  async *synthesize(req: SynthesizeRequest): AsyncIterable<PcmChunk> {
    const ac = new AbortController();
    this.aborts.set(req.sentenceId, ac);
    try {
      const res = await this.fetchImpl(`${this.row.base_url}/audio/speech`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${decryptProviderKey(this.row) ?? ''}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.row.default_model ?? 'tts-1',
          input: req.text,
          voice: req.voice ?? 'alloy',
          speed: req.speed,
        }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Standalone simplification (clearly labeled): the returned container is
      // treated as opaque bytes and chunked to PCM-shaped buffers; the real
      // adapter decodes MP3/OGG to PCM in-flight. Nothing touches disk.
      const bytes = Buffer.from(await res.arrayBuffer());
      const chunkBytes = 960; // 480 samples * 2 bytes
      for (let off = 0; off < bytes.length; off += chunkBytes) {
        if (ac.signal.aborted) return;
        const slice = bytes.subarray(off, Math.min(off + chunkBytes, bytes.length));
        const data = new Int16Array(Math.ceil(slice.length / 2));
        for (let i = 0; i < data.length; i++) data[i] = slice.readInt16LE(i * 2);
        yield { data, sampleRate: 24000 };
      }
    } finally {
      this.aborts.delete(req.sentenceId);
    }
  }

  cancel(sentenceId: number): void {
    this.aborts.get(sentenceId)?.abort();
    this.aborts.delete(sentenceId);
  }

  async dispose(): Promise<void> {
    this.aborts.clear();
  }
}
