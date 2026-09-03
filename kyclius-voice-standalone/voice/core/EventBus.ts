/**
 * Minimal typed event bus used inside the engine (main process side).
 * Mirrors the prototype's typed emitter; the renderer subscribes through the
 * preload bridge, never to this bus directly.
 */
import type { VoiceEventName, VoiceEventPayload } from '../types/events.ts';

type Handler<K extends VoiceEventName> = (payload: VoiceEventPayload<K>) => void;

export class EventBus {
  private handlers = new Map<VoiceEventName, Set<Handler<VoiceEventName>>>();

  on<K extends VoiceEventName>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<VoiceEventName>);
    return () => { set?.delete(handler as Handler<VoiceEventName>); };
  }

  emit<K extends VoiceEventName>(event: K, payload: VoiceEventPayload<K>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) {
      try {
        (h as Handler<K>)(payload);
      } catch (err) {
        // A UI listener must never be able to break the engine loop.
        console.error(`[voice] event handler for '${event}' threw`, err);
      }
    }
  }

  wait<K extends VoiceEventName>(event: K, predicate?: (p: VoiceEventPayload<K>) => boolean): Promise<VoiceEventPayload<K>> {
    return new Promise((resolve) => {
      const off = this.on(event, (p) => {
        if (!predicate || predicate(p)) {
          off();
          resolve(p);
        }
      });
    });
  }
}
