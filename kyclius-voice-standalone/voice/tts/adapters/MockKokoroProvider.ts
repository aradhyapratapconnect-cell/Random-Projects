/**
 * MOCK local TTS provider (clearly labeled). Simulates local.tts.kokoro:
 * first-chunk latency then a stream of 24 kHz mono PCM16 chunks whose count
 * scales with text length. Interface-compatible with the real Kokoro adapter.
 */
import type { Health, ProviderRow } from '../../types/provider.ts';
import type { PcmChunk } from '../../audio/AudioPlayer.ts';
import type { SynthesizeRequest, TTSProvider, VoiceInfo } from '../TTSProvider.ts';
import { delay } from '../../core/timing.ts';

function mockPcm(seed: number, sampleRate = 24000): Int16Array {
  const data = new Int16Array(Math.round(sampleRate * 0.02)); // 20 ms of tone
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.round(Math.sin((seed * 7 + i) * 0.1) * 9000);
  }
  return data;
}

export class MockKokoroProvider implements TTSProvider {
  readonly row: ProviderRow;
  private firstChunkMs: number;
  private cancelled = new Set<number>();

  constructor(row: ProviderRow, opts?: { firstChunkMs?: number }) {
    this.row = row;
    this.firstChunkMs = opts?.firstChunkMs ?? 150;
  }

  async probe(timeoutMs: number): Promise<Health> {
    void timeoutMs;
    await delay(1);
    return { status: 'healthy', detail: 'simulated Kokoro-82M (mock)' };
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return [
      { id: 'af_heart', language: 'en-US', gender: 'female' },
      { id: 'am_michael', language: 'en-US', gender: 'male' },
    ];
  }

  async *synthesize(req: SynthesizeRequest): AsyncIterable<PcmChunk> {
    const chunkCount = Math.max(2, Math.ceil(req.text.length / 40));
    await delay(this.firstChunkMs); // simulated Kokoro first-chunk latency
    for (let i = 0; i < chunkCount; i++) {
      if (this.cancelled.has(req.sentenceId)) return;
      yield { data: mockPcm(req.sentenceId * 31 + i), sampleRate: 24000 };
    }
  }

  cancel(sentenceId: number): void {
    this.cancelled.add(sentenceId);
  }

  async dispose(): Promise<void> {
    this.cancelled.clear();
  }
}
