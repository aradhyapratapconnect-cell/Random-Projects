/**
 * ProviderResolver (01 section 5.2): reads the shared providers table, probes
 * health, walks the fallback ladder, and announces every rung hop.
 * Resolution algorithm (verbatim from the architecture):
 *   1. rows = enabled rows, is_default first, then ladder order
 *   2. probe each; first healthy wins -> emit provider_changed
 *   3. none healthy -> DegradationController.enter + VoiceError NO_ENGINE
 */
import type { Health, PresetKey, ProviderRow } from '../types/provider.ts';
import { STT_LADDER, TTS_LADDER } from '../types/provider.ts';
import { VoiceError } from '../types/errors.ts';
import type { EventBus } from './EventBus.ts';
import type { DegradationController } from './DegradationController.ts';
import type { ProviderRegistry } from './ProviderRegistry.ts';

type VoiceCapability = 'stt' | 'tts';

export interface Probeable {
  probe(timeoutMs: number): Promise<Health>;
}

export type AdapterFactory = (row: ProviderRow) => Probeable;

export interface ActiveResolution {
  row: ProviderRow;
  adapter: Probeable;
}

const LADDERS: Record<VoiceCapability, readonly PresetKey[]> = {
  stt: STT_LADDER,
  tts: TTS_LADDER,
};

export class ProviderResolver {
  private bus: EventBus;
  private registry: ProviderRegistry;
  private degradation: DegradationController;
  private probeTimeoutMs: number;

  constructor(bus: EventBus, registry: ProviderRegistry, degradation: DegradationController, probeTimeoutMs: number) {
    this.bus = bus;
    this.registry = registry;
    this.degradation = degradation;
    this.probeTimeoutMs = probeTimeoutMs;
  }

  /** Default row first, then remaining enabled rows in ladder order. */
  private orderRows(capability: VoiceCapability): ProviderRow[] {
    const rows = this.registry.where(capability, true);
    const ladder = LADDERS[capability];
    const rank = (r: ProviderRow): number => {
      const i = ladder.indexOf(r.preset_key);
      return i === -1 ? ladder.length : i;
    };
    return rows.sort((x, y) => {
      if (x.is_default !== y.is_default) return x.is_default ? -1 : 1;
      return rank(x) - rank(y);
    });
  }

  activePresetKey(capability: VoiceCapability): string | null {
    const id = this.activeRowId(capability);
    const row = id ? this.registry.get(id) : null;
    return row ? row.preset_key : null;
  }

  private activeRowId(capability: VoiceCapability): string | null {
    return this.activeRowIdMap.get(capability) ?? null;
  }

  private activeRowIdMap = new Map<VoiceCapability, string>();

  async resolve(capability: VoiceCapability, factory: AdapterFactory): Promise<ActiveResolution> {
    const rows = this.orderRows(capability);
    for (const row of rows) {
      const adapter = factory(row);
      let health: Health;
      try {
        health = await adapter.probe(this.probeTimeoutMs);
      } catch (err) {
        health = { status: 'unhealthy', detail: err instanceof Error ? err.message : String(err) };
      }
      if (health.status === 'healthy') {
        const prevId = this.activeRowId(capability);
        if (prevId !== row.id) {
          this.activeRowIdMap.set(capability, row.id);
          const prevRow = prevId ? this.registry.get(prevId) : null;
          this.bus.emit('provider', {
            capability,
            from: prevRow ? prevRow.preset_key : (this.degradation.isDegraded(capability) ? 'degraded' : null),
            to: row.preset_key,
          });
        }
        if (this.degradation.isDegraded(capability)) {
          this.degradation.clear(capability, row.preset_key);
        }
        return { row, adapter };
      }
      // Ladder hop: announce it (08 section 4 rule 1).
      const curId = this.activeRowId(capability);
      const curRow = curId ? this.registry.get(curId) : null;
      this.bus.emit('provider', {
        capability,
        from: curRow ? curRow.preset_key : null,
        to: row.preset_key,
        reason: `probe ${health.status}${health.detail ? `: ${health.detail}` : ''}`,
      });
    }
    const code = capability === 'stt' ? 'STT/NO_ENGINE' : 'TTS/NO_ENGINE';
    const message = capability === 'stt'
      ? 'Voice input is unavailable: no enabled speech provider passed its health check. You can keep typing.'
      : 'Speech output is unavailable: no enabled speech provider passed its health check. Responses will be text-only.';
    this.degradation.enter(capability, code, message, ['Retry', 'Open voice settings']);
    throw new VoiceError({ code, message, recoverable: true, actions: ['Retry', 'Open voice settings'] });
  }
}
