/**
 * The only voice state React reads (07 section 1). One subscription in
 * VoiceProvider; components consume slices through the hooks. Level values are
 * exposed via refs-plus-subscription so 30 Hz updates never re-render React.
 */
import type { CanonicalVoiceState, SubState } from '../types/canonical.ts';
import type { DegradedInfo, VoiceErrorInfo } from '../types/errors.ts';
import type { VoiceEventMap } from '../types/events.ts';

export interface VoiceStoreState {
  state: CanonicalVoiceState;
  detail: { canonical: CanonicalVoiceState; sub: SubState } | null;
  sessionId: string | null;
  partial: string | null;
  finalTranscript: string | null;
  confidence: number | null;
  speakingSentence: string | null;
  levelIn: number;
  levelOut: number;
  degraded: DegradedInfo | null;
  error: VoiceErrorInfo | null;
  activeStt: string | null;
  activeTts: string | null;
}

export class VoiceStore {
  private state: VoiceStoreState = {
    state: 'idle',
    detail: null,
    sessionId: null,
    partial: null,
    finalTranscript: null,
    confidence: null,
    speakingSentence: null,
    levelIn: 0,
    levelOut: 0,
    degraded: null,
    error: null,
    activeStt: null,
    activeTts: null,
  };
  private listeners = new Set<() => void>();

  getSnapshot = (): VoiceStoreState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<VoiceStoreState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  applyState(p: VoiceEventMap['state']): void {
    this.set({ state: p.state, detail: p.detail ?? null, sessionId: p.sessionId });
  }

  pushPartial(p: VoiceEventMap['partial']): void {
    if (p.sessionId !== this.state.sessionId) return; // stale-turn guard
    this.set({ partial: p.text });
  }

  pushFinal(p: VoiceEventMap['final']): void {
    if (p.sessionId !== this.state.sessionId) return;
    this.set({ finalTranscript: p.text, confidence: p.confidence ?? null, partial: null });
  }

  setSpeaking(p: VoiceEventMap['speaking']): void {
    this.set({ speakingSentence: p.sentence });
  }

  /** Levels bypass React state (rAF-driven waveform); kept for diagnostics. */
  setLevel(p: VoiceEventMap['level']): void {
    this.set(p.direction === 'in' ? { levelIn: p.rms } : { levelOut: p.rms });
  }

  setDegraded(d: VoiceEventMap['degraded']): void {
    this.set({ degraded: d });
  }

  setError(e: VoiceEventMap['error']): void {
    this.set({ error: e });
  }

  setEngines(stt: string | null, tts: string | null): void {
    this.set({ activeStt: stt, activeTts: tts });
  }
}

export const voiceStore = new VoiceStore();
