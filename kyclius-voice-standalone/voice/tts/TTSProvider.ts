/**
 * TTS provider abstraction (04 section 1). Every TTS backend implements this
 * interface and is constructed from a providers-table row (HC3). Providers
 * return raw PCM chunks (24 kHz mono PCM16), never container files, so the
 * Audio Layer owns buffering uniformly.
 */
import type { Health, ProviderRow } from '../types/provider.ts';
import type { PcmChunk } from '../audio/AudioPlayer.ts';

export interface VoiceInfo {
  id: string;
  language: string;
  gender?: string;
}

export interface SynthesizeRequest {
  text: string;
  voice?: string;
  speed: number; // 0.5-2.0
  pitch: number; // 0.5-1.5
  sessionId: string;
  sentenceId: number;
}

export interface TTSProvider {
  readonly row: ProviderRow;
  probe(timeoutMs: number): Promise<Health>;
  listVoices(): Promise<VoiceInfo[]>;
  synthesize(req: SynthesizeRequest): AsyncIterable<PcmChunk>;
  cancel(sentenceId: number): void;
  dispose(): Promise<void>;
}
