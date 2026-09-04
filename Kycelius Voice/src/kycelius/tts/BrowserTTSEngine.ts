import type { ITTSEngine, TtsOptions } from '../types';

/**
 * Kycelius Voice — Browser TTS engine (Chromium speechSynthesis).
 * Uses the OS-installed neural voices with zero setup.
 */
export class BrowserTTSEngine implements ITTSEngine {
  readonly provider = 'browser' as const;

  private current: SpeechSynthesisUtterance | null = null;

  initialize(): Promise<void> {
    if (!('speechSynthesis' in window)) {
      return Promise.reject(new Error('speechSynthesis is not available'));
    }
    // Chrome loads voices asynchronously — wait for them
    return new Promise((resolve) => {
      if (speechSynthesis.getVoices().length > 0) return resolve();
      const done = () => resolve();
      speechSynthesis.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 1500); // safety net
    });
  }

  async speak(text: string, options: TtsOptions): Promise<void> {
    this.stop();
    return new Promise((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = Math.max(0.1, Math.min(10, options.rate));
      u.pitch = Math.max(0, Math.min(2, options.pitch));

      if (options.voice) {
        const match = speechSynthesis
          .getVoices()
          .find((v) => v.name === options.voice || v.voiceURI === options.voice);
        if (match) {
          u.voice = match;
          u.lang = match.lang;
        }
      }

      u.onend = () => {
        this.current = null;
        resolve();
      };
      u.onerror = (e) => {
        this.current = null;
        if (e.error === 'interrupted' || e.error === 'canceled') return resolve();
        reject(new Error(`Browser TTS error: ${e.error}`));
      };

      this.current = u;
      speechSynthesis.speak(u);
    });
  }

  stop(): void {
    try {
      speechSynthesis.cancel();
    } catch {
      /* noop */
    }
    this.current = null;
  }

  dispose(): void {
    this.stop();
  }
}
