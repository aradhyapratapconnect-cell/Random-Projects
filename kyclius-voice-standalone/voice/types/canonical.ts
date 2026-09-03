/**
 * Canonical voice state vocabulary (HC2) + flagged internal sub-states.
 *
 * The renderer may ONLY branch on `CanonicalVoiceState`. Sub-states exist for
 * engine bookkeeping and ride alongside as `detail`; each must roll up to
 * exactly one canonical state — enforced at compile time by the ROLLUP record
 * type and at runtime by `verifyRollupCompleteness()`.
 * Source: kycelius-voice-v6/02-state-machine.md §1, §4.
 */

export const CANONICAL_VOICE_STATES = [
  'idle',
  'listening',
  'thinking',
  'awaiting_confirmation',
  'executing',
  'speaking',
  'error',
] as const;

export type CanonicalVoiceState = (typeof CANONICAL_VOICE_STATES)[number];

export const SUB_STATES = [
  'listening.awaiting_speech',
  'listening.didnt_catch',
  'thinking.awaiting_first_token',
  'thinking.streaming',
  'speaking.interrupting',
  'speaking.paused',
  'error.recovering',
] as const;

export type SubState = (typeof SUB_STATES)[number];

/** Compile-time enforced: a sub-state that cannot map to exactly one canonical state is an error. */
export const ROLLUP: Record<SubState, CanonicalVoiceState> = {
  'listening.awaiting_speech': 'listening',
  'listening.didnt_catch': 'listening',
  'thinking.awaiting_first_token': 'thinking',
  'thinking.streaming': 'thinking',
  'speaking.interrupting': 'speaking',
  'speaking.paused': 'speaking',
  'error.recovering': 'error',
};

/** Runtime completeness check (used by the demo harness). */
export function verifyRollupCompleteness(): boolean {
  const keys = new Set<string>(Object.keys(ROLLUP));
  if (keys.size !== SUB_STATES.length) return false;
  return SUB_STATES.every((s) => keys.has(s) && CANONICAL_VOICE_STATES.includes(ROLLUP[s]));
}

/** The renderer-facing event payload. Never invents new user-facing states. */
export interface VoiceStatePayload {
  state: CanonicalVoiceState;
  detail?: { canonical: CanonicalVoiceState; sub: SubState };
  sessionId: string | null;
}

export type VoiceMode = 'ptt' | 'handsFree';

/** Tunable engine timing. Real defaults per the architecture; the demo harness uses accelerated values. */
export interface VoiceTimingConfig {
  frameMs: number;        // capture frame size (default 20)
  silenceMs: number;      // silence that ends an utterance (endpointing, default 700)
  minSpeechMs: number;    // utterances shorter than this are discarded (default 250)
  maxSilenceMs: number;   // silence before ANY speech -> "didn't catch that" (default 8000)
  maxUtteranceMs: number; // hard utterance cap (default 60000)
  partialEveryMs: number; // rolling partial decode cadence (default 300)
  probeTimeoutMs: number; // provider health probe timeout (default 3000)
  playerChunkMs: number;  // simulated playback time per PCM chunk in the mock player
  synthFirstChunkMs: number; // simulated first-chunk synth latency of mock providers
}
