/**
 * Shared provider registry — an in-memory mock of the existing `providers`
 * table (HC3). Rows only; no voice-specific columns, no vendor enum.
 * Later this is swapped for the real DB-backed service behind the same surface.
 */
import type { Capability, ProviderRow } from '../types/provider.ts';
import { PRESET_KEYS, fakeEncryptKey } from '../types/provider.ts';

export class ProviderRegistry {
  private rows: ProviderRow[] = [];
  private nextId = 1;

  seedDefaults(): void {
    // Local-first defaults (HC4): local rows are enabled + default out of the box.
    // Cloud rows exist as opt-in slots: created but disabled until the user opts in.
    this.upsert({
      capability: 'stt',
      preset_key: PRESET_KEYS.customCloudStt,
      display_name: 'Custom cloud STT',
      schema: JSON.stringify({ type: 'object', properties: { language: { type: 'string' } } }),
      base_url: 'https://example.invalid/v1',
      api_key_encrypted: fakeEncryptKey('sk-demo-not-a-real-key'),
      default_model: 'whisper-1',
      enabled: false,
      is_default: false,
    });
    this.upsert({
      capability: 'stt',
      preset_key: PRESET_KEYS.localSttFasterWhisper,
      display_name: 'Local Whisper (faster-whisper)',
      schema: JSON.stringify({ type: 'object', properties: { model: { enum: ['large-v3-turbo', 'small'] } } }),
      base_url: null,
      api_key_encrypted: null,
      default_model: 'large-v3-turbo',
      enabled: true,
      is_default: true,
    });
    this.upsert({
      capability: 'stt',
      preset_key: PRESET_KEYS.systemStt,
      display_name: 'System dictation',
      schema: JSON.stringify({ type: 'object', properties: {} }),
      base_url: null,
      api_key_encrypted: null,
      default_model: null,
      enabled: true,
      is_default: false,
    });
    this.upsert({
      capability: 'tts',
      preset_key: PRESET_KEYS.customCloudTts,
      display_name: 'Custom cloud TTS',
      schema: JSON.stringify({ type: 'object', properties: { voice: { type: 'string' } } }),
      base_url: 'https://example.invalid/v1',
      api_key_encrypted: fakeEncryptKey('sk-demo-not-a-real-key'),
      default_model: 'tts-1',
      enabled: false,
      is_default: false,
    });
    this.upsert({
      capability: 'tts',
      preset_key: PRESET_KEYS.localTtsKokoro,
      display_name: 'Local Kokoro-82M',
      schema: JSON.stringify({ type: 'object', properties: { voice: { type: 'string' } } }),
      base_url: null,
      api_key_encrypted: null,
      default_model: 'kokoro-82M-v1.0',
      enabled: true,
      is_default: true,
    });
    this.upsert({
      capability: 'tts',
      preset_key: PRESET_KEYS.systemTts,
      display_name: 'System voices (SAPI/AVSpeech)',
      schema: JSON.stringify({ type: 'object', properties: {} }),
      base_url: null,
      api_key_encrypted: null,
      default_model: null,
      enabled: true,
      is_default: false,
    });
  }

  upsert(row: Omit<ProviderRow, 'id'>): ProviderRow {
    const existing = this.rows.find((r) => r.capability === row.capability && r.preset_key === row.preset_key);
    if (existing) {
      Object.assign(existing, row);
      return existing;
    }
    const created: ProviderRow = { id: `prov_${this.nextId++}`, ...row };
    this.rows.push(created);
    return created;
  }

  all(): ProviderRow[] {
    return [...this.rows];
  }

  where(capability: Capability, enabledOnly = false): ProviderRow[] {
    return this.rows.filter((r) => r.capability === capability && (!enabledOnly || r.enabled));
  }

  get(id: string): ProviderRow | null {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  setEnabled(id: string, enabled: boolean): void {
    const row = this.get(id);
    if (!row) throw new Error(`provider row ${id} not found`);
    row.enabled = enabled;
  }

  setDefault(id: string): void {
    const row = this.get(id);
    if (!row) throw new Error(`provider row ${id} not found`);
    for (const r of this.rows) {
      if (r.capability === row.capability) r.is_default = r.id === id;
    }
  }
}
