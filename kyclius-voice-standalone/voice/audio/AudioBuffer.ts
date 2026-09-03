/**
 * UtteranceRing (05 section 4): fixed-capacity in-memory utterance buffer.
 * HC8: no file handles anywhere in the audio path; on end-of-utterance the
 * buffer is zeroed before release (belt-and-braces against heap preservation).
 */
export class UtteranceRing {
  private frames: Int16Array[] = [];
  private capacityMs: number;
  private frameMs: number;

  constructor(capacityMs: number, frameMs: number) {
    this.capacityMs = capacityMs;
    this.frameMs = frameMs;
  }

  push(frame: Int16Array): void {
    this.frames.push(frame);
    const maxFrames = Math.ceil(this.capacityMs / this.frameMs);
    while (this.frames.length > maxFrames) this.frames.shift();
  }

  get durationMs(): number {
    return this.frames.length * this.frameMs;
  }

  readAll(): Int16Array[] {
    return [...this.frames];
  }

  /** HC8 belt-and-braces: zero before release. */
  zeroize(): void {
    for (const f of this.frames) f.fill(0);
    this.frames.length = 0;
  }
}
