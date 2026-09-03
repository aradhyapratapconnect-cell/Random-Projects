/**
 * DegradationController (HC6): translates "no usable engine" into a specific,
 * persistent, actionable user-facing banner. Capability-scoped: broken STT
 * never disables TTS. Never silent, never a transient toast.
 * Source: kycelius-voice-v6/08-sessions-and-errors.md section 4.
 */
import type { DegradedInfo, ErrorCode } from '../types/errors.ts';
import type { EventBus } from './EventBus.ts';

type VoiceCapability = 'stt' | 'tts';

export class DegradationController {
  private degraded = new Map<VoiceCapability, DegradedInfo>();
  private bus: EventBus;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  enter(capability: VoiceCapability, code: ErrorCode, message: string, actions: string[]): DegradedInfo {
    const info: DegradedInfo = { capability, code, message, actions };
    this.degraded.set(capability, info);
    this.bus.emit('degraded', info);
    return info;
  }

  /** One-click recovery (T13): re-resolution succeeded; clear the affordance. */
  clear(capability: VoiceCapability, restoredTo: string): void {
    if (this.degraded.delete(capability)) {
      this.bus.emit('provider', { capability, from: 'degraded', to: restoredTo, reason: 'recovered: voice restored' });
    }
  }

  get(capability: VoiceCapability): DegradedInfo | null {
    return this.degraded.get(capability) ?? null;
  }

  isDegraded(capability: VoiceCapability): boolean {
    return this.degraded.has(capability);
  }
}
