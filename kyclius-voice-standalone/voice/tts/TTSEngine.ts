/**
 * TTSEngine (04): facade over the active provider. Owns the streaming sentence
 * pipeline: SentenceSegmenter -> SynthesisPipeline -> PlaybackQueue ->
 * AudioPlayer. HC5 is a pipeline property: synthesis and playback of sentence 1
 * begin while the LLM is still streaming tokens for sentences 2..n.
 */
import type { EventBus } from '../core/EventBus.ts';
import type { ProviderResolver } from '../core/ProviderResolver.ts';
import type { VoiceTimingConfig } from '../types/canonical.ts';
import { PRESET_KEYS, type ProviderRow } from '../types/provider.ts';
import { AudioPlayer } from '../audio/AudioPlayer.ts';
import { PlaybackQueue } from '../audio/PlaybackQueue.ts';
import { delay } from '../core/timing.ts';
import { SentenceSegmenter } from './SentenceSegmenter.ts';
import { SynthesisPipeline } from './SynthesisPipeline.ts';
import type { TTSProvider } from './TTSProvider.ts';
import { MockKokoroProvider } from './adapters/MockKokoroProvider.ts';
import { SystemTtsProvider } from './adapters/SystemTtsProvider.ts';
import { CustomCloudTtsProvider } from './adapters/CustomCloudTtsProvider.ts';

export function createTtsAdapter(row: ProviderRow, timing: VoiceTimingConfig): TTSProvider {
  switch (row.preset_key) {
    case PRESET_KEYS.customCloudTts:
      // Simulated health so the generic cloud path runs with no network here.
      return new CustomCloudTtsProvider(row, { healthOverride: { status: 'healthy', detail: 'simulated cloud endpoint (mock)' } });
    case PRESET_KEYS.systemTts:
      return new SystemTtsProvider(row);
    default:
      return new MockKokoroProvider(row, { firstChunkMs: timing.synthFirstChunkMs });
  }
}

export class TTSEngine {
  private bus: EventBus;
  private resolver: ProviderResolver;
  private timing: VoiceTimingConfig;
  private adapters = new Map<string, TTSProvider>();
  private provider: TTSProvider | null = null;
  private player: AudioPlayer;
  private queue: PlaybackQueue;
  private pipeline: SynthesisPipeline;
  private sentenceCounter = 0;
  private firstAcceptedFired = false;
  isSessionLive: (sessionId: string) => boolean;
  /** Fired when the audio queue accepts the FIRST sentence (T3). */
  onFirstSentenceAccepted: (() => void) | null = null;

  constructor(bus: EventBus, resolver: ProviderResolver, timing: VoiceTimingConfig, isSessionLive: (sessionId: string) => boolean) {
    this.bus = bus;
    this.resolver = resolver;
    this.timing = timing;
    this.isSessionLive = isSessionLive;
    this.player = new AudioPlayer(bus, timing.playerChunkMs);
    this.queue = new PlaybackQueue({
      bus,
      player: this.player,
      maxJobs: 8,
      isSessionLive,
    });
    this.pipeline = new SynthesisPipeline({
      bus,
      queue: this.queue,
      getProvider: () => this.provider!,
      speed: 1,
      pitch: 1,
    });
    this.pipeline.onSentenceAccepted = () => {
      if (!this.firstAcceptedFired) {
        this.firstAcceptedFired = true;
        this.onFirstSentenceAccepted?.();
      }
    };
  }

  async ensureProvider(): Promise<TTSProvider> {
    if (this.provider) return this.provider;
    const { adapter } = await this.resolver.resolve('tts', (r) => this.buildAdapter(r));
    this.provider = adapter as TTSProvider;
    return this.provider;
  }

  /** Forces a fresh ladder walk (T13 retry / fallback re-resolution). */
  async reResolve(): Promise<TTSProvider> {
    this.provider = null;
    return this.ensureProvider();
  }

  private buildAdapter(row: ProviderRow): TTSProvider {
    const existing = this.adapters.get(row.id);
    if (existing) return existing;
    const created = createTtsAdapter(row, this.timing);
    this.adapters.set(row.id, created);
    return created;
  }

  activePresetKey(): string | null {
    return this.resolver.activePresetKey('tts');
  }

  /** Queue drained AND pipeline idle AND stream consumed (T9 gate). */
  isIdle(): boolean {
    return !this.pipeline.hasOutstanding && !this.queue.isPlaying && this.queue.depth === 0;
  }

  get playingSentence(): string | null {
    return this.queue.playingSentence;
  }

  /** Non-streaming path (voice:speak). Submits, then resolves on drain. */
  async speakText(text: string, sessionId: string): Promise<void> {
    await this.ensureProvider();
    const segmenter = new SentenceSegmenter();
    const sentences = [...segmenter.push(text), ...segmenter.flush()];
    for (const sentence of sentences) {
      if (!this.isSessionLive(sessionId)) return;
      this.pipeline.submit({ sessionId, sentenceId: ++this.sentenceCounter, text: sentence });
    }
    await this.waitForDrain();
  }

  /**
   * Streaming path (HC5). Consumes the token stream, submitting each completed
   * sentence for synthesis immediately. Returns when the STREAM ends (all
   * sentences submitted) - NOT when playback finishes; drain is observed by the
   * manager via queue events so T3/T9 stay independent.
   */
  async speakFromTokenStream(
    tokens: AsyncIterable<string>,
    sessionId: string,
    onToken?: (token: string) => void,
  ): Promise<void> {
    await this.ensureProvider();
    const segmenter = new SentenceSegmenter();
    for await (const token of tokens) {
      onToken?.(token);
      for (const sentence of segmenter.push(token)) {
        if (!this.isSessionLive(sessionId)) return;
        this.pipeline.submit({ sessionId, sentenceId: ++this.sentenceCounter, text: sentence });
      }
    }
    // Stream end: flush the tail immediately.
    for (const sentence of segmenter.flush()) {
      if (!this.isSessionLive(sessionId)) return;
      this.pipeline.submit({ sessionId, sentenceId: ++this.sentenceCounter, text: sentence });
    }
  }

  /** Resolves when queue drained AND no synth jobs outstanding. */
  async waitForDrain(): Promise<void> {
    if (this.isIdle()) return;
    await new Promise<void>((resolve) => {
      const off = this.bus.on('queue', () => {
        if (this.isIdle()) {
          off();
          resolve();
        }
      });
    });
  }

  /** Barge-in / stop: teardown <= 200 ms target. */
  hardStop(sessionId: string): void {
    this.pipeline.cancelAll(sessionId);
    this.queue.clearAll(); // includes player.stop() fade
  }

  pause(): void {
    this.player.pause();
  }

  resume(): void {
    this.player.resume();
  }

  /** Used by tests/diagnostics: wait until everything drains. */
  async drainAll(): Promise<void> {
    while (!this.isIdle()) await delay(5);
  }
}
