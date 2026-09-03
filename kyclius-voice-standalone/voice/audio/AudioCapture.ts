/**
 * AudioCapture: per-OS native backends behind one interface. In this standalone
 * build only the clearly-labeled mock backend runs (no real microphone device),
 * but it emits the exact contract the real WASAPI/CoreAudio backend must honor:
 * 16 kHz mono PCM16 frames of `frameMs` each, pushed to `onFrame`.
 * HC8: frames are in-memory buffers handed to the pipeline; never written to disk.
 */
export interface CaptureSession {
  close(): void;
}

export interface CaptureStartOptions {
  sampleRate: number;
  frameMs: number;
  onFrame(frame: Int16Array, atMs: number): void;
}

export interface AudioCaptureBackend {
  start(options: CaptureStartOptions): Promise<CaptureSession>;
}

export interface EnvelopePhase {
  ms: number;   // duration of the phase
  level: number; // 0..1 speech amplitude (0 = silence)
}

/**
 * MOCK CAPTURE BACKEND (clearly labeled). Plays a scripted loudness envelope
 * through the real frame contract so VAD/STT code paths run unmodified.
 */
export class MockAudioCapture implements AudioCaptureBackend {
  private script: EnvelopePhase[] = [];

  setScript(envelope: EnvelopePhase[]): void {
    this.script = envelope;
  }

  async start(options: CaptureStartOptions): Promise<CaptureSession> {
    const { sampleRate, frameMs, onFrame } = options;
    const samples = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
    const session = {
      closed: false,
      close: (): void => {
        session.closed = true;
      },
    };
    let phase = 0;
    let phaseElapsedMs = 0;
    let sampleIndex = 0;
    const tick = (): void => {
      if (session.closed) return;
      const ph = this.script[phase];
      if (!ph) return; // script finished; frames stop (session remains open)
      const frame = new Int16Array(samples);
      if (ph.level > 0) {
        for (let i = 0; i < samples; i++) {
          frame[i] = Math.round(Math.sin((sampleIndex + i) * 0.05) * ph.level * 12000);
        }
      }
      onFrame(frame, sampleIndex);
      sampleIndex += samples;
      phaseElapsedMs += frameMs;
      if (phaseElapsedMs >= ph.ms) {
        phase++;
        phaseElapsedMs = 0;
      }
      // Accelerated emission (not real-time): VAD endpointing counts frame
      // milliseconds, so the scripted utterance completes in event-loop time.
      setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
    return session;
  }
}
