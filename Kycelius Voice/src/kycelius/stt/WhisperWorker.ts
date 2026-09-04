/// <reference lib="webworker" />
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

/**
 * Kycelius Voice — Local Whisper worker.
 * Runs OpenAI Whisper fully on-device via Transformers.js (ONNX runtime,
 * WebGPU when available with WASM fallback). Audio never leaves the machine.
 */

// Never phone home for anything except the model files themselves (Hugging Face CDN)
env.allowLocalModels = false;

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let currentModel: string | null = null;
let loading: Promise<void> | null = null;

interface LoadMsg {
  type: 'load';
  model: string;
  language?: string;
}

interface TranscribeMsg {
  type: 'transcribe';
  id: number;
  audio: Float32Array;
  language?: string;
}

type WorkerMsg = LoadMsg | TranscribeMsg;

async function load(model: string): Promise<void> {
  if (transcriber && currentModel === model) return;
  if (loading && currentModel === model) return loading;

  currentModel = model;
  loading = (async () => {
    self.postMessage({ type: 'progress', status: 'loading-model', file: model, progress: 0 });

    // Prefer WebGPU, fall back to WASM automatically
    let device: 'webgpu' | 'wasm' = 'wasm';
    try {
      if ('gpu' in navigator) {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (adapter) device = 'webgpu';
      }
    } catch {
      device = 'wasm';
    }

    transcriber = (await (pipeline as any)(
      'automatic-speech-recognition',
      model,
      {
        dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
        device,
        progress_callback: (info: any) => {
        if (info.status === 'progress' && info.total) {
          self.postMessage({
            type: 'progress',
            status: 'downloading',
            file: info.file,
            progress: info.loaded / info.total,
          });
        } else if (info.status === 'ready' || info.status === 'done') {
          self.postMessage({ type: 'progress', status: 'ready', file: info.file, progress: 1 });
        }
        },
      },
    ));

    // Warm-up inference so the first real utterance isn't slow.
    // Must be ~1s of audible signal: pure/short silence makes Whisper's
    // decoder emit zero tokens -> "token_ids must not be an empty array".
    const warm = new Float32Array(16000); // 1s @ 16 kHz
    for (let i = 0; i < warm.length; i++) {
      warm[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / 16000);
    }
    try {
      await transcriber!(warm, { return_timestamps: false });
    } catch (warmErr) {
      // Warm-up is best-effort — never fail initialization over it
      console.warn('[kycelius] whisper warm-up skipped:', warmErr);
    }

    self.postMessage({ type: 'ready', device });
  })();

  return loading;
}

self.onmessage = async (e: MessageEvent<WorkerMsg>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      await load(msg.model);
      return;
    }
    if (msg.type === 'transcribe') {
      if (!transcriber) await load(currentModel ?? 'onnx-community/whisper-base');

      // Whisper's decoder throws "token_ids must not be an empty array" on
      // (near-)silent or ultra-short input — skip it gracefully instead.
      let peak = 0;
      for (let i = 0; i < msg.audio.length; i++) {
        const a = Math.abs(msg.audio[i]);
        if (a > peak) peak = a;
      }
      const isTranscribable = msg.audio.length >= 3200 && peak > 1e-4; // >=0.2s with signal
      if (!isTranscribable) {
        self.postMessage({ type: 'result', id: msg.id, text: '' });
        return;
      }

      try {
        const out = await transcriber!(msg.audio, {
          return_timestamps: false,
          chunk_length_s: 30,
          stride_length_s: 5,
          language: msg.language && msg.language !== 'auto' ? msg.language : undefined,
        });
        const text = (out as { text: string }).text?.trim() ?? '';
        self.postMessage({ type: 'result', id: msg.id, text });
      } catch (transcribeErr) {
        const message = String(transcribeErr);
        if (/empty array|token_ids|no tokens/i.test(message)) {
          // Degenerate input edge case — treat as silence, not a failure
          self.postMessage({ type: 'result', id: msg.id, text: '' });
        } else {
          throw transcribeErr;
        }
      }
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: (msg as any).id, message: String(err) });
  }
};
