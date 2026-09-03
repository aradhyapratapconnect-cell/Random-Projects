/**
 * SystemTtsAdapter (04 section 8 rung): SAPI 5 (Win) / AVSpeech (macOS) /
 * speech-dispatcher (Linux). Clearly-labeled mock in this standalone build.
 */
import type { Health, ProviderRow } from '../../types/provider.ts';
import type { PcmChunk } from '../../audio/AudioPlayer.ts';
import type { SynthesizeRequest, TTSProvider, VoiceInfo } from '../TTSProvider.ts';
import { delay } from '../../core/timing.ts';

export class SystemTtsProvider implements TTSProvider {
  readonly row: ProviderRow;

  constructor(row: ProviderRow) {
    this.row = row;
  }

  async probe(timeoutMs: number): Promise<Health> {
    void timeoutMs;
    await delay(1);
    return { status: 'healthy', detail: 'simulated system voices (mock)' };
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return [{ id: 'system-default', language: 'en-US' }];
  }

  async *synthesize(req: SynthesizeRequest): AsyncIterable<PcmChunk> {
    void req;
    for (let i = 0; i < 3; i++) {
      yield { data: new Int16Array(480), sampleRate: 24000 };
    }
  }

  cancel(): void {}

  async dispose(): Promise<void> {}
}
