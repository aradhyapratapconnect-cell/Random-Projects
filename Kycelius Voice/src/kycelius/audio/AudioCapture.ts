import type { VadConfig } from '../types';
import { VadDetector, rms } from './vad';

/**
 * Inline copy of public/pcm-capture.js — used when the app runs from
 * file:// (packaged Electron) where the dev-server path doesn't exist.
 * Keep in sync with public/pcm-capture.js.
 */
const PCM_CAPTURE_WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(512);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    let i = 0;
    while (i < channel.length) {
      const space = this.buffer.length - this.offset;
      const take = Math.min(space, channel.length - i);
      this.buffer.set(channel.subarray(i, i + take), this.offset);
      this.offset += take;
      i += take;
      if (this.offset === this.buffer.length) {
        const out = this.buffer;
        this.port.postMessage(out, [out.buffer]);
        this.buffer = new Float32Array(512);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
`;

export interface AudioCaptureOptions {
  sampleRate?: number;
  vad?: VadConfig;
  onChunk: (chunk: Float32Array, rmsLevel: number) => void;
}

/**
 * Microphone capture pipeline:
 *
 *   getUserMedia (16 kHz mono, echo-cancelled)
 *      -> AudioWorklet ('pcm-capture')  -> PCM chunks -> engine / VAD
 *      -> AnalyserNode                  -> waveform visualization
 */
export class AudioCapture {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private vad: VadDetector | null = null;

  readonly sampleRate: number;

  constructor(private options: AudioCaptureOptions) {
    this.sampleRate = options.sampleRate ?? 16000;
    if (options.vad) this.vad = new VadDetector(options.vad);
  }

  setVadConfig(cfg: VadConfig): void {
    this.options.vad = cfg;
    this.vad?.setConfig(cfg);
  }

  async start(): Promise<void> {
    if (this.stream) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: this.sampleRate,
      },
      video: false,
    });

    this.ctx = new AudioContext({ sampleRate: this.sampleRate });

    // Load the worklet from an inline blob — identical behavior in the dev
    // browser, Electron dev, app:// (packaged) and any http(s) origin, with
    // no dependency on public-path or protocol details.
    const blob = new Blob([PCM_CAPTURE_WORKLET_SOURCE], {
      type: 'application/javascript',
    });
    const blobUrl = URL.createObjectURL(blob);
    try {
      await this.ctx.audioWorklet.addModule(blobUrl);
    } catch (err) {
      throw new Error(
        `Failed to load AudioWorklet module: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    this.source = this.ctx.createMediaStreamSource(this.stream);

    this.worklet = new AudioWorkletNode(this.ctx, 'pcm-capture');
    this.worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const chunk = e.data;
      this.options.onChunk(chunk, rms(chunk));
    };

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.75;

    this.source.connect(this.worklet);
    this.source.connect(this.analyser);
    // Intentionally NOT connecting worklet/analyser to destination (no echo loop)
  }

  stop(): void {
    this.worklet?.port.close();
    this.worklet?.disconnect();
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.worklet = null;
    this.source = null;
    this.analyser = null;
    this.stream = null;
    this.ctx = null;
    this.vad?.reset();
  }

  get isCapturing(): boolean {
    return !!this.stream;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  /** Current effective VAD gate (null when the VAD is inactive). */
  getVadGate(): number | null {
    return this.vad ? this.vad.currentGate : null;
  }

  /** Feed a chunk through the VAD; returns the current VAD state or null. */
  evalVad(chunkRms: number): ReturnType<VadDetector['update']> | null {
    if (!this.vad) return null;
    return this.vad.update(chunkRms, performance.now());
  }
}

/** Encode raw mono PCM frames into a WAV Blob (for server STT endpoints). */
export function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const pcm = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    pcm.set(c, off);
    off += c.length;
  }

  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeStr = (pos: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(pos + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcm.length * 2, true);

  let pos = 44;
  for (let i = 0; i < pcm.length; i++, pos += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
