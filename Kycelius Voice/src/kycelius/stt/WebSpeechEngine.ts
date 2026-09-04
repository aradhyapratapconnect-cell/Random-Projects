import type { ISTTEngine, ModelProgress } from '../types';

/**
 * Kycelius Voice — Web Speech API STT engine (Chromium SpeechRecognition).
 *
 * Streaming with interim results — the lowest-latency option, at the cost
 * of sending audio to the OS/browser speech service.
 */
export class WebSpeechEngine implements ISTTEngine {
  readonly provider = 'webspeech' as const;

  private recognition: any = null;
  private handlers: {
    onPartial: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (err: Error) => void;
  } | null = null;
  private shouldRun = false;
  private restartTimer: number | null = null;

  get ready(): boolean {
    return !!this.recognition;
  }

  initialize(_onProgress?: (p: ModelProgress) => void): Promise<void> {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      return Promise.reject(new Error('Web Speech API is not available in this environment'));
    }
    return Promise.resolve();
  }

  startStreaming(handlers: {
    onPartial: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (err: Error) => void;
  }): void {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      handlers.onError(new Error('Web Speech API is not available'));
      return;
    }

    this.handlers = handlers;
    this.shouldRun = true;
    this.spawn(SR);
  }

  private spawn(SR: any): void {
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';

    rec.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (!text) continue;
        if (result.isFinal) {
          this.handlers?.onFinal(text);
        } else {
          this.handlers?.onPartial(text);
        }
      }
    };
    rec.onerror = (event: any) => {
      // 'no-speech' is normal in continuous mode; ignore non-fatal codes
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      this.handlers?.onError(new Error(`Web Speech error: ${event.error}`));
    };
    rec.onend = () => {
      // Chromium ends the session periodically — auto-restart while active
      if (this.shouldRun) {
        this.restartTimer = window.setTimeout(() => {
          if (this.shouldRun) this.spawn(SR);
        }, 250);
      }
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch {
      // start() throws if already started — safe to ignore
    }
  }

  stopStreaming(): void {
    this.shouldRun = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    try {
      this.recognition?.stop();
    } catch {
      /* noop */
    }
    this.recognition = null;
    this.handlers = null;
  }

  async dispose(): Promise<void> {
    this.stopStreaming();
  }
}
