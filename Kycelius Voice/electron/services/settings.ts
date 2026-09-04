import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export type KyceliusSettings = Record<string, unknown> & {
  sttProvider?: string;
  ttsProvider?: string;
  whisperModel?: string;
  whisperLanguage?: string;
  sttServerUrl?: string;
  ttsServerUrl?: string;
  sttApiKey?: string;
  ttsApiKey?: string;
  ttsVoice?: string;
  ttsRate?: number;
  ttsPitch?: number;
  vadThreshold?: number;
  vadSilenceMs?: number;
  autoSpeak?: boolean;
  continuous?: boolean;
};

/**
 * Tiny JSON settings store persisted in the Electron userData directory.
 * Zero dependencies, survives app updates, safe against corrupt files.
 */
export class SettingsStore {
  private readonly file: string;
  private cache: KyceliusSettings;

  private readonly defaults: KyceliusSettings = {
    sttProvider: 'whisper-local',
    ttsProvider: 'browser',
    whisperModel: 'onnx-community/whisper-base',
    whisperLanguage: 'en',
    sttServerUrl: '',
    ttsServerUrl: '',
    sttApiKey: '',
    ttsApiKey: '',
    ttsVoice: '',
    ttsRate: 1.0,
    ttsPitch: 1.0,
    vadThreshold: 0.008,
    vadSilenceMs: 1400,
    autoSpeak: false,
    continuous: true,
  };

  constructor() {
    this.file = path.join(app.getPath('userData'), 'kycelius-voice-settings.json');
    this.cache = { ...this.defaults, ...this.read() };
    this.migrate();
    this.write(this.cache);
  }

  all(): KyceliusSettings {
    return { ...this.cache };
  }

  set(patch: Partial<KyceliusSettings>): void {
    this.cache = { ...this.cache, ...patch };
    this.write(this.cache);
  }

  private read(): KyceliusSettings {
    try {
      if (fs.existsSync(this.file)) {
        return JSON.parse(fs.readFileSync(this.file, 'utf-8')) as KyceliusSettings;
      }
    } catch (err) {
      console.warn('[kycelius] settings file corrupt, resetting:', err);
    }
    return {};
  }

  /**
   * Versioned migrations for previously persisted defaults.
   * v1.0.1: the original VAD threshold (0.015) was above the speech RMS of
   * many noise-suppressed mics, which made hands-free detection silently
   * never trigger. Migrate it to the corrected default.
   */
  private migrate(): void {
    if (this.cache.vadThreshold === 0.015) {
      this.cache.vadThreshold = 0.008;
      console.log('[kycelius] migrated vadThreshold 0.015 -> 0.008');
    }
  }

  private write(data: KyceliusSettings): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[kycelius] failed to persist settings:', err);
    }
  }
}
