import type { VadConfig } from '../types';

export type VadState = 'silence' | 'speech' | 'utterance-end';

/**
 * Energy-based Voice Activity Detector with an adaptive noise floor
 * and hysteresis. Runs at chunk-rate (~30 Hz) on the main thread.
 *
 * The adaptive floor lets it work in both quiet rooms and noisy
 * environments without manual tuning. (Swap point for a Silero VAD
 * neural model — the interface is identical.)
 */
export class VadDetector {
  private noiseFloor = 0.01;
  private speaking = false;
  private speechStartTime = 0;
  private lastVoiceTime = 0;

  constructor(private cfg: VadConfig) {}

  setConfig(cfg: VadConfig): void {
    this.cfg = cfg;
  }

  reset(): void {
    this.speaking = false;
    this.speechStartTime = 0;
    this.lastVoiceTime = 0;
  }

  /** Feed one RMS level; returns the resulting VAD transition/state. */
  update(rms: number, now: number): VadState {
    // Adapt noise floor slowly while silent (EMA), fast enough to track HVAC/fans
    if (!this.speaking) {
      this.noiseFloor = this.noiseFloor * 0.97 + rms * 0.03;
    }

    // Speech gate = fixed threshold OR 2.6x the learned floor
    const gate = Math.max(this.cfg.threshold, this.noiseFloor * 2.6);

    if (!this.speaking) {
      if (rms > gate) {
        this.speaking = true;
        this.speechStartTime = now;
        this.lastVoiceTime = now;
        return 'speech';
      }
      return 'silence';
    }

    // Currently speaking
    if (rms > gate * 0.6) {
      this.lastVoiceTime = now; // hysteresis: louder-than-floor counts as voice
      return 'speech';
    }

    if (now - this.lastVoiceTime >= this.cfg.silenceMs) {
      this.speaking = false;
      // Reject blips/coughs shorter than minSpeechMs
      if (now - this.speechStartTime < this.cfg.minSpeechMs) {
        return 'silence';
      }
      return 'utterance-end';
    }
    return 'speech';
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  get currentNoiseFloor(): number {
    return this.noiseFloor;
  }

  /** The effective energy gate speech must cross right now. */
  get currentGate(): number {
    return Math.max(this.cfg.threshold, this.noiseFloor * 2.6);
  }
}

/** Root-mean-square of a PCM frame, normalized to 0..1 (samples are -1..1). */
export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    sum += frame[i] * frame[i];
  }
  return Math.sqrt(sum / frame.length);
}
