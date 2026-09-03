/**
 * AudioPlayer (05 section 7): output-side playback. Mock backend: consumes PCM
 * chunks with real timed ticks so playback-vs-stream timing is observable.
 * Real build swaps in WASAPI/CoreAudio behind the same calls.
 */
import type { EventBus } from '../core/EventBus.ts';
import { delay } from '../core/timing.ts';
import { frameRms } from './AudioProcessor.ts';

export interface PcmChunk {
  data: Int16Array;
  sampleRate: number;
}

export interface PlayableJob {
  sessionId: string;
  sentenceId: number;
  chunks: PcmChunk[];
}

export class AudioPlayer {
  private bus: EventBus;
  private chunkMs: number;
  private stopFlag = false;
  private pausedFlag = false;
  private waiters: Array<() => void> = [];
  private active = false;

  constructor(bus: EventBus, chunkMs: number) {
    this.bus = bus;
    this.chunkMs = chunkMs;
  }

  get isPlaying(): boolean {
    return this.active;
  }

  async play(job: PlayableJob): Promise<void> {
    this.active = true;
    this.stopFlag = false;
    this.pausedFlag = false;
    try {
      for (const chunk of job.chunks) {
        if (this.stopFlag) return;
        while (this.pausedFlag && !this.stopFlag) {
          await new Promise<void>((r) => this.waiters.push(r));
        }
        this.bus.emit('level', { direction: 'out', rms: frameRms(chunk.data) });
        await delay(this.chunkMs);
      }
    } finally {
      this.active = false;
    }
  }

  stop(): void {
    this.stopFlag = true;
    this.pausedFlag = false;
    this.flushWaiters();
  }

  pause(): void {
    this.pausedFlag = true;
  }

  resume(): void {
    this.pausedFlag = false;
    this.flushWaiters();
  }

  private flushWaiters(): void {
    for (const w of this.waiters.splice(0)) w();
  }
}
