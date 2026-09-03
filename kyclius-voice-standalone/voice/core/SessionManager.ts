/**
 * Session manager (08 §1-§2). A session is the unit of cancellation; every
 * async hop captures (sessionId, generation) and re-checks before applying.
 */
import type { CanonicalVoiceState } from '../types/canonical.ts';
import type { VoiceSession } from '../types/session.ts';

function newId(): string {
  return `vs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class SessionManager {
  private sessions = new Map<string, VoiceSession>();
  private currentId: string | null = null;

  create(now = Date.now()): VoiceSession {
    const session: VoiceSession = {
      id: newId(),
      createdAtMs: now,
      state: 'idle',
      transcript: [],
      aiResponse: null,
      cancelled: false,
      interrupted: false,
      generation: 1,
      outcome: 'completed',
    };
    this.sessions.set(session.id, session);
    this.currentId = session.id;
    return session;
  }

  get current(): VoiceSession | null {
    return this.currentId ? this.sessions.get(this.currentId) ?? null : null;
  }

  get(id: string): VoiceSession | null {
    return this.sessions.get(id) ?? null;
  }

  setState(id: string, state: CanonicalVoiceState): void {
    const s = this.sessions.get(id);
    if (s) s.state = state;
  }

  /** Bumped on every interrupt/cancel/retry — stale async work is dropped. */
  bumpGeneration(id: string): number {
    const s = this.sessions.get(id);
    if (!s) return -1;
    return ++s.generation;
  }

  /** Guard used before applying any async result. Returns false if stale. */
  isCurrent(id: string, generation: number): boolean {
    const s = this.sessions.get(id);
    return !!s && !s.cancelled && s.generation === generation;
  }

  interrupt(id: string, now = Date.now()): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.interrupted = true;
    s.interruptedAtMs = now;
    s.outcome = 'interrupted';
    this.bumpGeneration(id);
  }

  cancel(id: string, now = Date.now()): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.cancelled = true;
    s.outcome = 'cancelled';
    s.endedAtMs = now;
    this.bumpGeneration(id);
  }

  end(id: string, outcome: VoiceSession['outcome'], now = Date.now()): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.outcome = outcome;
    s.endedAtMs = now;
    if (this.currentId === id) this.currentId = null;
  }

  /** Force-cancel sessions with no activity for `timeoutMs` (30s in prod). */
  expireIdle(timeoutMs: number, now = Date.now()): string[] {
    const expired: string[] = [];
    for (const s of this.sessions.values()) {
      if (!s.endedAtMs && now - s.createdAtMs > timeoutMs) {
        this.cancel(s.id, now);
        expired.push(s.id);
      }
    }
    return expired;
  }
}
