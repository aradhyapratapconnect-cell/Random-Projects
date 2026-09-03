/**
 * AudioProcessor (05 section 5): per-frame processing chain. In this standalone
 * build the chain is an energy-normalizing AGC pass plus the 30 Hz level tap
 * that feeds the renderer waveform (the renderer sees levels, never audio).
 * RNNoise-class NS is a settings-gated bypass here; the seam is unchanged.
 */
export function frameRms(frame: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i] / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / Math.max(1, frame.length));
}

export class AudioProcessor {
  private targetRms: number;
  private maxGain: number;

  constructor(targetRms = 0.07, maxGain = 4) {
    this.targetRms = targetRms;
    this.maxGain = maxGain;
  }

  /** AGC pass (in place) + returns RMS 0..1 for the level tap. */
  process(frame: Int16Array): { frame: Int16Array; rms: number } {
    const rms = frameRms(frame);
    if (rms > 1e-6) {
      const gain = Math.min(this.maxGain, Math.max(1, this.targetRms / rms));
      if (gain > 1.001) {
        for (let i = 0; i < frame.length; i++) {
          const v = frame[i] * gain;
          frame[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
        }
      }
    }
    return { frame, rms };
  }
}
