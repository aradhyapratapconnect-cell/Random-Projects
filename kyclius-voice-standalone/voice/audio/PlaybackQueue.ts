/**
 * PlaybackQueue (04 section 5): bounded, ordered PCM job queue feeding the
 * player. Ordered by sentenceId; queue-gate re-checks session liveness right
 * before playback (08 section 2 mechanism 3) so no orphan job can play after
 * an interrupt. PCM lives in RAM only and is released on done (HC8).
 */
import type { EventBus } from '../core/EventBus.ts';
import type { AudioPlayer, PcmChunk } from './AudioPlayer.ts';

export interface PlaybackJob {
  sessionId: string;
  sentenceId: number;
  sentence: string;
  chunks: PcmChunk[];
  state: 'synthesizing' | 'ready' | 'playing' | 'done' | 'cancelled';
}

export interface PlaybackQueueOptions {
  bus: EventBus;
  player: AudioPlayer;
  maxJobs: number;
  isSessionLive(sessionId: string): boolean;
}

export class PlaybackQueue {
  private jobs: PlaybackJob[] = [];
  private current: PlaybackJob | null = null;
  private opts: PlaybackQueueOptions;
  private drainListeners: Array<() => void> = [];

  constructor(opts: PlaybackQueueOptions) {
    this.opts = opts;
  }

  get depth(): number {
    return this.jobs.length + (this.current ? 1 : 0);
  }

  get isPlaying(): boolean {
    return this.current !== null;
  }

  get playingSentence(): string | null {
    return this.current?.sentence ?? null;
  }

  /** Returns false when full -> caller (segmenter side) holds the text. */
  enqueue(job: PlaybackJob): boolean {
    if (!this.opts.isSessionLive(job.sessionId)) {
      job.state = 'cancelled';
      return false;
    }
    if (this.jobs.length >= this.opts.maxJobs) return false;
    job.state = 'ready';
    this.jobs.push(job);
    this.emitQueue();
    void this.pump();
    return true;
  }

  private async pump(): Promise<void> {
    if (this.current) return; // one pump loop owns playback
    while (this.jobs.length > 0) {
      const job = this.jobs.shift()!;
      // Queue-gate re-check (stale-turn protection).
      if (!this.opts.isSessionLive(job.sessionId) || job.state === 'cancelled') {
        job.state = 'cancelled';
        continue;
      }
      this.current = job;
      job.state = 'playing';
      this.opts.bus.emit('speaking', {
        sessionId: job.sessionId,
        sentenceId: job.sentenceId,
        sentence: job.sentence,
      });
      await this.opts.player.play(job);
      job.state = 'done';
      job.chunks = []; // free PCM promptly (HC8)
      this.current = null;
      this.emitQueue();
    }
    this.emitQueue();
    this.notifyDrained();
  }

  /** Drop queued (not-yet-playing) jobs; current sentence fades via player.stop(). */
  clearPending(): void {
    for (const job of this.jobs.splice(0)) job.state = 'cancelled';
    this.emitQueue();
  }

  clearAll(): void {
    this.clearPending();
    this.opts.player.stop();
    if (this.current) {
      this.current.state = 'cancelled';
      this.current = null;
    }
  }

  onDrained(cb: () => void): () => void {
    this.drainListeners.push(cb);
    return () => {
      this.drainListeners = this.drainListeners.filter((x) => x !== cb);
    };
  }

  private notifyDrained(): void {
    for (const cb of [...this.drainListeners]) cb();
  }

  private emitQueue(): void {
    this.opts.bus.emit('queue', { depth: this.depth, durationMs: 0 });
  }
}
