/**
 * Minimal strongly-typed event emitter used by the Kycelius engine.
 */
export class TypedEvents<Events extends object> {
  private listeners = new Map<keyof Events, Set<(payload: any) => void>>();

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  once<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
  }

  off<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.listeners.get(event)?.forEach((h) => {
      try {
        h(payload);
      } catch (err) {
        console.error(`[kycelius] listener error on '${String(event)}'`, err);
      }
    });
  }

  removeAll(): void {
    this.listeners.clear();
  }
}
