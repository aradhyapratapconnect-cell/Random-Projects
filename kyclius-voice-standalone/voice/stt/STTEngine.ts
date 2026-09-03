/**
 * STTEngine (03 section 1): facade owning exactly one active provider instance,
 * chosen by ProviderResolver. Constructed from providers-table rows (HC3).
 */
import type { EventBus } from '../core/EventBus.ts';
import type { ProviderResolver } from '../core/ProviderResolver.ts';
import type { VoiceTimingConfig } from '../types/canonical.ts';
import { PRESET_KEYS, type ProviderRow } from '../types/provider.ts';
import { MockFasterWhisperProvider } from './adapters/MockFasterWhisperProvider.ts';
import { CustomCloudSttProvider } from './adapters/CustomCloudSttProvider.ts';
import { SystemSttProvider } from './adapters/SystemSttProvider.ts';
import type { STTProvider, SttSink, SttStreamConfig } from './STTProvider.ts';

export function createSttAdapter(row: ProviderRow, timing: VoiceTimingConfig): STTProvider {
  switch (row.preset_key) {
    case PRESET_KEYS.customCloudStt:
      // Simulated health so the generic cloud path runs with no network here.
      return new CustomCloudSttProvider(row, { healthOverride: { status: 'healthy', detail: 'simulated cloud endpoint (mock)' } });
    case PRESET_KEYS.systemStt:
      return new SystemSttProvider(row);
    default:
      return new MockFasterWhisperProvider(row, { partialEveryMs: timing.partialEveryMs });
  }
}

export class STTEngine {
  private resolver: ProviderResolver;
  private timing: VoiceTimingConfig;
  private adapters = new Map<string, STTProvider>();
  private active: STTProvider | null = null;
  private activeRow: ProviderRow | null = null;

  constructor(_bus: EventBus, resolver: ProviderResolver, timing: VoiceTimingConfig) {
    this.resolver = resolver;
    this.timing = timing;
  }

  get activeModel(): string | null {
    return this.activeRow?.default_model ?? null;
  }

  async ensureProvider(): Promise<STTProvider> {
    const { row, adapter } = await this.resolver.resolve('stt', (r) => this.buildAdapter(r));
    this.activeRow = row;
    return adapter as STTProvider;
  }

  private buildAdapter(row: ProviderRow): STTProvider {
    const existing = this.adapters.get(row.id);
    if (existing) return existing;
    const created = createSttAdapter(row, this.timing);
    this.adapters.set(row.id, created);
    return created;
  }

  async beginSession(cfg: SttStreamConfig, sink: SttSink): Promise<STTProvider> {
    const provider = await this.ensureProvider();
    this.stopStream();
    this.active = provider;
    provider.startStream(cfg, sink);
    return provider;
  }

  feed(frame: Int16Array, rms: number, atMs: number): void {
    this.active?.feed(frame, rms, atMs);
  }

  finalize(): void {
    this.active?.finalize();
  }

  stopStream(): void {
    this.active?.stopStream();
    this.active = null;
  }

  activePresetKey(): string | null {
    return this.resolver.activePresetKey('stt');
  }
}
