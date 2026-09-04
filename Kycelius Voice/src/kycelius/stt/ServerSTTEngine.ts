import type { ISTTEngine, ModelProgress } from '../types';
import { encodeWav } from '../audio/AudioCapture';

/**
 * Kycelius Voice — Server STT engine.
 * Works with any OpenAI-compatible endpoint:
 *   POST {serverUrl}/audio/transcriptions  (multipart: file, model, language)
 * e.g. Groq, LM Studio, LocalAI, whisper.cpp server, OpenAI.
 */
export class ServerSTTEngine implements ISTTEngine {
  readonly provider = 'server' as const;

  private _ready = false;
  private _model: string;

  constructor(
    private serverUrl: string,
    private apiKey = '',
    model = 'whisper-1',
  ) {
    this._model = model;
  }

  get ready(): boolean {
    return this._ready && !!this.serverUrl;
  }

  initialize(_onProgress?: (p: ModelProgress) => void): Promise<void> {
    if (!this.serverUrl) {
      return Promise.reject(new Error('Server STT: no server URL configured'));
    }
    this._ready = true;
    return Promise.resolve();
  }

  async transcribe(audio: Float32Array, sampleRate: number): Promise<string> {
    const wav = encodeWav([audio], sampleRate);
    const form = new FormData();
    form.append('file', wav, 'utterance.wav');
    form.append('model', this._model);
    form.append('response_format', 'json');

    const headers: Record<string, string> = {};
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.serverUrl.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers,
      body: form,
    });

    if (!res.ok) {
      throw new Error(`Server STT failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { text?: string };
    return (data.text ?? '').trim();
  }

  async dispose(): Promise<void> {
    this._ready = false;
  }
}
