/**
 * Shared `providers` table shape (HC3). Voice providers are rows — the same
 * shape as `llm` rows — never an enum, never a parallel table.
 * Source: kycelius-voice-v6/01-system-architecture.md §5.
 */

export type Capability = 'llm' | 'stt' | 'tts';

/** Settled preset keys — generic cloud slots only, no named vendors (HC4). */
export const PRESET_KEYS = {
  localSttFasterWhisper: 'local.stt.faster_whisper',
  systemStt: 'system.stt',
  customCloudStt: 'custom.cloud.stt',
  localTtsKokoro: 'local.tts.kokoro',
  localTtsChatterbox: 'local.tts.chatterbox',
  systemTts: 'system.tts',
  customCloudTts: 'custom.cloud.tts',
} as const;

export type PresetKey = (typeof PRESET_KEYS)[keyof typeof PRESET_KEYS];

export interface ProviderRow {
  id: string;
  capability: Capability;
  preset_key: PresetKey;
  display_name: string;
  schema: string;                    // JSON-schema string describing this preset's settings
  base_url: string | null;           // cloud presets only; local/system = null
  api_key_encrypted: string | null;  // decrypted only in main
  default_model: string | null;
  enabled: boolean;
  is_default: boolean;               // one default per capability
}

export type HealthStatus = 'healthy' | 'unhealthy' | 'unsupported';

export interface Health {
  status: HealthStatus;
  detail?: string;
}

/** Fallback ladders (03 §6 / 04 §8). Order matters: cloud (opt-in) -> local default -> system. */
export const STT_LADDER: readonly PresetKey[] = [
  PRESET_KEYS.customCloudStt,
  PRESET_KEYS.localSttFasterWhisper,
  PRESET_KEYS.systemStt,
];

export const TTS_LADDER: readonly PresetKey[] = [
  PRESET_KEYS.customCloudTts,
  PRESET_KEYS.localTtsKokoro,
  PRESET_KEYS.localTtsChatterbox,
  PRESET_KEYS.systemTts,
];

/**
 * In-memory mock of the app's encrypted-at-rest key scheme. Real Kyclius uses
 * the existing DB encryption; this fake is symmetric and only ever applied in
 * "main" (resolver) code — renderer code never sees either form.
 */
export function fakeEncryptKey(plain: string): string {
  return Buffer.from(plain, 'utf8').toString('base64');
}

/** Main-process-only decryption of a provider row key. */
export function decryptProviderKey(row: ProviderRow): string | null {
  if (!row.api_key_encrypted) return null;
  return Buffer.from(row.api_key_encrypted, 'base64').toString('utf8');
}
