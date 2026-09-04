import type { ITTSEngine, TtsOptions } from '../types';

interface KyceliusBridge {
  sapi: {
    speak(req: { text: string; voice?: string; rate?: number; pitch?: number }): Promise<ArrayBuffer>;
  };
}

/**
 * Kycelius Voice — Windows SAPI TTS engine (fully offline).
 * The main process synthesizes via System.Speech, returns WAV bytes,
 * and we play them through a Blob URL.
 */
export class SapiTTSEngine implements ITTSEngine {
  readonly provider = 'sapi' as const;

  private bridge: KyceliusBridge | null = null;
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;

  initialize(): Promise<void> {
    this.bridge = (window as any).kycelius ?? null;
    if (!this.bridge) {
      return Promise.reject(new Error('SAPI TTS requires the Electron app (no kycelius bridge)'));
    }
    return Promise.resolve();
  }

  async speak(text: string, options: TtsOptions): Promise<void> {
    this.stop();
    if (!this.bridge) throw new Error('SAPI TTS not initialized');

    const wav = await this.bridge.sapi.speak({
      text,
      voice: options.voice || undefined,
      rate: options.rate,
      pitch: options.pitch,
    });

    const blob = new Blob([wav], { type: 'audio/wav' });
    this.url = URL.createObjectURL(blob);
    this.audio = new Audio(this.url);

    return new Promise<void>((resolve, reject) => {
      const a = this.audio!;
      a.onended = () => {
        this.stop();
        resolve();
      };
      a.onerror = () => {
        this.stop();
        reject(new Error('SAPI audio playback failed'));
      };
      void a.play().catch((err) => {
        this.stop();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
  }

  dispose(): void {
    this.stop();
  }
}
