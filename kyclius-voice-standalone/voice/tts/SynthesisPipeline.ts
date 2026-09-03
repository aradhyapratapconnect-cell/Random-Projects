/**
 * SynthesisPipeline (04 section 4): turns a sentence stream into an ordered,
 * cancellable stream of synth jobs. Max 2 in-flight synth jobs (S_i playing,
 * S_i+1 synthesizing) hides provider latency between sentences.
 */
import type { EventBus } from '../core/EventBus.ts';
import { delay } from '../core/timing.ts';
import type { PlaybackJob, PlaybackQueue } from '../audio/PlaybackQueue.ts';
import type { TTSProvider } from './TTSProvider.ts';

export interface SynthSpec {
  sessionId: string;
  sentenceId: number;
  text: string;
}

export interface SynthesisPipelineOptions {
  bus: EventBus;
  queue: PlaybackQueue;
  getProvider: () => TTSProvider;
  voice?: string;
  speed: number;
  pitch: number;
}

export class SynthesisPipeline {
  private opts: SynthesisPipelineOptions;
  private maxInflight = 2;
  private inflight = 0;
  private waiting: SynthSpec[] = [];
  private cancelledSessions = new Set<string>();
  /** Fired when the audio queue accepts the job (T3 gate). */
  onSentenceAccepted: ((sentenceId: number) => void) | null = null;

  constructor(opts: SynthesisPipelineOptions) {
    this.opts = opts;
  }

  get hasOutstanding(): boolean {
    return this.inflight > 0 || this.waiting.length > 0;
  }

  get waitingCount(): number {
    return this.waiting.length;
  }

  submit(spec: SynthSpec): boolean {
    if (this.cancelledSessions.has(spec.sessionId)) return true; // stale; drop
    this.waiting.push(spec);
    this.schedule();
    return true;
  }

  private schedule(): void {
    while (this.inflight < this.maxInflight && this.waiting.length > 0) {
      const spec = this.waiting.shift()!;
      this.inflight++;
      void this.run(spec);
    }
  }

  private async run(spec: SynthSpec): Promise<void> {
    try {
      if (this.cancelledSessions.has(spec.sessionId)) return;
      const provider = this.opts.getProvider();
      const chunks = [];
      for await (const chunk of provider.synthesize({
        text: spec.text,
        voice: this.opts.voice,
        speed: this.opts.speed,
        pitch: this.opts.pitch,
        sessionId: spec.sessionId,
        sentenceId: spec.sentenceId,
      })) {
        if (this.cancelledSessions.has(spec.sessionId)) return;
        chunks.push(chunk);
      }
      if (this.cancelledSessions.has(spec.sessionId)) return;
      const job: PlaybackJob = {
        sessionId: spec.sessionId,
        sentenceId: spec.sentenceId,
        sentence: spec.text,
        chunks,
        state: 'synthesizing',
      };
      // Bounded queue (04 section 3 backpressure): when full, hold the job's
      // text/PCM (cheap, in RAM) and retry - the LLM stream is never paused;
      // audio is the bounded resource. Never drops a sentence.
      let accepted = this.opts.queue.enqueue(job);
      while (!accepted && !this.cancelledSessions.has(spec.sessionId)) {
        await delay(15);
        accepted = this.opts.queue.enqueue(job);
      }
      if (accepted) this.onSentenceAccepted?.(spec.sentenceId);
    } catch (err) {
      this.opts.bus.emit('error', {
        code: 'TTS/ENGINE_FAILED',
        message: 'Speech output failed: ' + (err instanceof Error ? err.message : String(err)),
        recoverable: true,
        actions: ['Retry'],
        sessionId: spec.sessionId,
        cause: err,
      });
    } finally {
      this.inflight--;
      this.schedule();
    }
  }

  /** Barge-in / stop: abort everything not yet playing (04 section 4). */
  cancelAll(sessionId: string): void {
    this.cancelledSessions.add(sessionId);
    this.waiting = this.waiting.filter((s) => s.sessionId !== sessionId);
  }

  resetCancellations(): void {
    this.cancelledSessions.clear();
  }
}
