import type { KyceliusSettings } from '../../electron/services/settings';

declare global {
  interface Window {
    kycelius?: {
      isElectron: boolean;
      settings: {
        get(): Promise<Record<string, unknown>>;
        set(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
      };
      sapi: {
        listVoices(): Promise<string[]>;
        speak(req: {
          text: string;
          voice?: string;
          rate?: number;
          pitch?: number;
        }): Promise<ArrayBuffer>;
      };
      appInfo(): Promise<{
        version: string;
        electron: string;
        chrome: string;
        node: string;
        platform: string;
        isDev: boolean;
      }>;
    };
  }
}

export type { KyceliusSettings };
