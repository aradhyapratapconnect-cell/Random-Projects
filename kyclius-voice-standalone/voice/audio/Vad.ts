/**
 * VAD (05 section 6): energy-gate implementation. This is the always-warm
 * fallback from the architecture (silero is the primary in production); in this
 * standalone build the energy gate IS the VAD, which exercises the identical
 * event contract: speech_start / speech_end / level.
 */
import { frameRms } from './AudioProcessor.ts';

export interface VadOptions {
  threshold: number;   // RMS 0..1 speech gate
  frameMs: number;
  silenceMs: number;   // silence that ends an utterance (endpointing)
  onSpeechStart(atMs: number): void;
  onSpeechEnd(atMs: number, utteranceMs: number): void;
  onLevel(rms: number, atMs: number): void;
}

export class Vad {
  private opts: VadOptions;
  private inSpeech = false;
  private aboveCount = 0;
  private silentMs = 0;
  private utteranceStart = 0;

  constructor(opts: VadOptions) {
    this.opts = opts;
  }

  feed(frame: Int16Array, atMs: number): void {
    const rms = frameRms(frame);
    this.opts.onLevel(rms, atMs);
    if (!this.inSpeech) {
      if (rms > this.opts.threshold) {
        this.aboveCount++;
        if (this.aboveCount >= 2) {
          this.inSpeech = true;
          this.silentMs = 0;
          this.utteranceStart = atMs;
          this.opts.onSpeechStart(atMs);
        }
      } else {
        this.aboveCount = 0;
      }
    } else if (rms <= this.opts.threshold) {
      this.silentMs += this.opts.frameMs;
      if (this.silentMs >= this.opts.silenceMs) {
        const utteranceMs = atMs - this.utteranceStart + this.opts.frameMs;
        this.inSpeech = false;
        this.aboveCount = 0;
        this.silentMs = 0;
        this.opts.onSpeechEnd(atMs, utteranceMs);
      }
    } else {
      this.silentMs = 0;
    }
  }

  get isSpeaking(): boolean {
    return this.inSpeech;
  }

  reset(): void {
    this.inSpeech = false;
    this.aboveCount = 0;
    this.silentMs = 0;
  }
}
