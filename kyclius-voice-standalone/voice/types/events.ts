/**
 * Typed engine -> renderer event bus (main -> renderer IPC events).
 * Events NEVER carry audio buffers (ADR-002, HC7, HC8) -- only state,
 * transcripts, RMS levels, and provider/degradation notices.
 * Source: kycelius-voice-v6/06-electron-integration.md section 3.
 */
import type { VoiceStatePayload, SubState } from './canonical.ts';
import type { DegradedInfo, VoiceErrorInfo } from './errors.ts';

export interface StateEvent extends VoiceStatePayload {}
export interface PartialEvent { sessionId: string; text: string }
export interface FinalEvent { sessionId: string; text: string; confidence?: number }
export interface LevelEvent { direction: 'in' | 'out'; rms: number }
export interface SpeakingEvent { sessionId: string; sentenceId: number; sentence: string }
export interface QueueEvent { depth: number; durationMs: number }
export interface ProviderEvent { capability: 'stt' | 'tts'; from: string | null; to: string | null; reason?: string }
export interface ModelProgressEvent { capability: 'stt' | 'tts'; status: string; progress?: number }
export type ConfirmationEvent = { sessionId: string; proposal: { proposalId: string; label: string } };

export interface VoiceEventMap {
  state: StateEvent;
  partial: PartialEvent;
  final: FinalEvent;
  level: LevelEvent;
  speaking: SpeakingEvent;
  queue: QueueEvent;
  provider: ProviderEvent;
  degraded: DegradedInfo;
  error: VoiceErrorInfo;
  modelProgress: ModelProgressEvent;
  confirmation: ConfirmationEvent;
}

export const VOICE_EVENT_NAMES = Object.keys({
  state: 1, partial: 1, final: 1, level: 1, speaking: 1,
  queue: 1, provider: 1, degraded: 1, error: 1, modelProgress: 1, confirmation: 1,
}) as VoiceEventName[];

export type VoiceEventName = keyof VoiceEventMap;
export type VoiceEventPayload<K extends VoiceEventName> = VoiceEventMap[K];

/** Roll-up helper: sub-state detail may never introduce a new canonical state. */
export function stateEvent(
  state: VoiceStatePayload['state'],
  sessionId: string | null,
  sub?: SubState,
): StateEvent {
  return sub
    ? { state, sessionId, detail: { canonical: state, sub } }
    : { state, sessionId };
}
