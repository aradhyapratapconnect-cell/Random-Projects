/**
 * Canonical state machine (HC2). Full transition table from
 * kycelius-voice-v6/02-state-machine.md §3. Illegal transitions throw —
 * the engine may never drift into an undocumented UI state.
 *
 * NOTE (documented deviation, smallest possible): `idle -> speaking` is
 * allowed under trigger `T3.speak_command`. The transition table models T3 as
 * thinking->speaking for the LLM-answer path; the `voice:speak` command (06 §2)
 * enters the same T3 gate (audio queue accepted the job) directly from idle.
 */
import { CANONICAL_VOICE_STATES, type CanonicalVoiceState, type SubState } from '../types/canonical.ts';
import { stateEvent } from '../types/events.ts';
import type { EventBus } from './EventBus.ts';

/** from -> to -> trigger label */
const TRANSITIONS: Record<CanonicalVoiceState, Partial<Record<CanonicalVoiceState, string>>> = {
  idle: {
    listening: 'T1.user_arms_mic',
    speaking: 'T3.speak_command', // voice:speak (see note above)
    error: 'T12.voice_subsystem_failure',
  },
  listening: {
    thinking: 'T2.utterance_finalized',
    listening: 'T10.didnt_catch', // self-loop, flagged sub-state
    error: 'T12.voice_subsystem_failure',
    idle: 'T14.stopped',
  },
  thinking: {
    speaking: 'T3.first_sentence_segmented',
    awaiting_confirmation: 'T4.tool_proposed',
    error: 'T12.voice_subsystem_failure',
    idle: 'T14.stopped',
  },
  awaiting_confirmation: {
    executing: 'T5.approved',
    thinking: 'T6.rejected',
    error: 'T12.voice_subsystem_failure',
    idle: 'T14.stopped',
  },
  executing: {
    speaking: 'T7.action_complete_tts_begins',
    idle: 'T8.action_complete_no_tts',
    error: 'T12.voice_subsystem_failure',
  },
  speaking: {
    idle: 'T9.queue_drained',
    listening: 'T11.barge_in',
    error: 'T12.voice_subsystem_failure',
  },
  error: {
    idle: 'T13.recovery_succeeded',
    listening: 'T13.recovery_succeeded',
    thinking: 'T13.recovery_succeeded',
    error: 'T12.voice_subsystem_failure',
  },
};

// Remove the accidental placeholder key statically typed above.
delete (TRANSITIONS.speaking as Record<string, unknown>)['idle_'];

export function isLegalTransition(from: CanonicalVoiceState, to: CanonicalVoiceState): boolean {
  return TRANSITIONS[from][to] !== undefined;
}

export function transitionTrigger(from: CanonicalVoiceState, to: CanonicalVoiceState): string | undefined {
  return TRANSITIONS[from][to];
}

export class IllegalTransitionError extends Error {
  constructor(from: CanonicalVoiceState, to: CanonicalVoiceState, trigger: string) {
    super(`Illegal voice transition ${from} -> ${to} on '${trigger}'`);
    this.name = 'IllegalTransitionError';
  }
}

export class StateMachine {
  private current: CanonicalVoiceState = 'idle';
  private previous: CanonicalVoiceState = 'idle';
  private sub: SubState | null = null;
  private sessionId: string | null = null;
  private bus: EventBus;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  get state(): CanonicalVoiceState {
    return this.current;
  }

  setSessionId(id: string | null): void {
    this.sessionId = id;
  }

  /** Applies a transition (or a self-loop) and broadcasts the canonical state. */
  transition(to: CanonicalVoiceState, trigger: string, sub?: SubState): CanonicalVoiceState {
    const label = transitionTrigger(this.current, to);
    if (label === undefined) {
      throw new IllegalTransitionError(this.current, to, trigger);
    }
    if (label !== trigger) {
      throw new Error(
        `Trigger mismatch: ${this.current}->${to} is '${label}', was invoked as '${trigger}'`,
      );
    }
    if (to !== this.current) {
      this.previous = this.current;
      this.current = to;
    }
    this.sub = sub ?? null;
    this.bus.emit('state', stateEvent(this.current, this.sessionId, this.sub ?? undefined));
    return this.current;
  }

  /** Flag a sub-state without changing canonical state (e.g. speaking.paused). */
  flagSub(sub: SubState): void {
    const canonical = this.current;
    this.sub = sub;
    this.bus.emit('state', stateEvent(canonical, this.sessionId, sub));
  }

  clearSub(): void {
    this.sub = null;
    this.bus.emit('state', stateEvent(this.current, this.sessionId));
  }

  /** T13: recovery returns to the state prior to entering error. */
  recover(): CanonicalVoiceState {
    if (this.current !== 'error') return this.current;
    const target = this.previous === 'error' ? 'idle' : this.previous;
    this.previous = 'idle';
    this.current = target;
    this.sub = null;
    this.bus.emit('state', stateEvent(this.current, this.sessionId));
    return this.current;
  }

  isLegal(to: CanonicalVoiceState): boolean {
    return isLegalTransition(this.current, to);
  }

  snapshot(): { current: CanonicalVoiceState; all: readonly CanonicalVoiceState[] } {
    return { current: this.current, all: CANONICAL_VOICE_STATES };
  }
}
