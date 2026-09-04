import type { ISTTEngine, ModelProgress } from '../types';

/**
 * Kycelius Voice — Local Whisper STT engine.
 *
 * Proxies a dedicated Web Worker running Transformers.js so the UI thread
 * never blocks while models download or inference runs.
 */
export class WhisperEngine implements ISTTEngine {
  readonly provider = 'whisper-local' as const;

  private worker: Worker | null = null;
  private pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private progressCb: ((p: ModelProgress) => void) | null = null;
  private _ready = false;
  private device: string = 'wasm';

  constructor(
    private model = 'onnx-community/whisper-base',
    private language = 'en',
  ) {}

  get ready(): boolean {
    return this._ready;
  }

  get computeDevice(): string {
    return this.device;
  }

  initialize(onProgress?: (p: ModelProgress) => void): Promise<void> {
    this.progressCb = onProgress ?? null;
    if (this.worker && this._ready) return Promise.resolve();

    this.worker = new Worker(new URL('./WhisperWorker.ts', import.meta.url), { type: 'module' });

    return new Promise((resolve, reject) => {
      const worker = this.worker!;
      const timeout = setTimeout(() => reject(new Error('Whisper model load timed out')), 300_000);

      worker.onmessage = (e: MessageEvent<any>) => {
        const msg = e.data;
        switch (msg.type) {
          case 'progress':
            this.progressCb?.(msg);
            break;
          case 'ready':
            this.device = msg.device ?? 'wasm';
            this._ready = true;
            clearTimeout(timeout);
            resolve();
            break;
          case 'result': {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            p?.resolve(msg.text);
            break;
          }
          case 'error': {
            const p = this.pending.get(msg.id);
            if (p) {
              this.pending.delete(msg.id);
              p.reject(new Error(msg.message));
            } else {
              clearTimeout(timeout);
              reject(new Error(msg.message));
            }
            break;
          }
        }
      };
      worker.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error(`Whisper worker crashed: ${e.message}`));
      };

      worker.postMessage({ type: 'load', model: this.model, language: this.language });
    });
  }

  transcribe(audio: Float32Array, _sampleRate: number): Promise<string> {
    if (!this.worker) throw new Error('WhisperEngine not initialized');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // Transfer the buffer (zero-copy)
      this.worker!.postMessage({ type: 'transcribe', id, audio, language: this.language }, [
        audio.buffer,
      ]);
    });
  }

  async dispose(): Promise<void> {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this._ready = false;
  }
}
