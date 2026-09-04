import type { ITTSEngine, TtsOptions } from '../types';

/**
 * Kycelius Voice — Server TTS engine.
 * Works with any OpenAI-compatible endpoint:
 *   POST {serverUrl}/audio/speech  (json: model, voice, input) -> audio/mpeg
 * e.g. OpenAI, Groq (PlayAI), LocalAI, Kokoro-FastAPI.
 */
export class ServerTTSEngine implements ITTSEngine {
  readonly provider = 'server' as const;

  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;

  constructor(
    private serverUrl: string,
    private apiKey = '',
    private model = 'tts-1',
    private defaultVoice = 'alloy',
  ) {}

  initialize(): Promise<void> {
    if (!this.serverUrl) {
      return Promise.reject(new Error('Server TTS: no server URL configured'));
    }
    return Promise.resolve();
  }

  async speak(text: string, options: TtsOptions): Promise<void> {
    this.stop();

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.serverUrl.replace(/\/$/, '')}/audio/speech`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        input: text,
        voice: options.voice || this.defaultVoice,
        speed: options.rate,
        response_format: 'mp3',
      }),
    });

    if (!res.ok) {
      throw new Error(`Server TTS failed (${res.status}): ${await res.text()}`);
    }

    const blob = await res.blob();
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
        reject(new Error('Server TTS audio playback failed'));
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
