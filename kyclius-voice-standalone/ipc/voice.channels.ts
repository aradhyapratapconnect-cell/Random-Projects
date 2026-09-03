/**
 * Typed IPC channel definitions (06 sections 2-3). All channels are namespaced
 * `voice:` and validated in main before any engine call. The allowlist here is
 * the single source of truth for both the preload bridge and main handlers.
 */
import type { CanonicalVoiceState, SubState, VoiceMode } from '../voice/types/canonical.ts';
import type { DegradedInfo, VoiceErrorInfo } from '../voice/types/errors.ts';
import type { ProviderRow } from '../voice/types/provider.ts';
import type { ConfirmationEvent, QueueEvent, SpeakingEvent, StateEvent } from '../voice/types/events.ts';

export const VOICE_COMMAND_CHANNELS = {
  getState: 'voice:getState',
  startListening: 'voice:startListening',
  stopListening: 'voice:stopListening',
  sendTranscript: 'voice:sendTranscript',
  cancelSession: 'voice:cancelSession',
  speak: 'voice:speak',
  speakControl: 'voice:speakControl',
  confirmAction: 'voice:confirmAction',
  getMicrophones: 'voice:getMicrophones',
  setMicrophone: 'voice:setMicrophone',
  getProviders: 'voice:getProviders',
  setProviderEnabled: 'voice:setProviderEnabled',
  setDefaultProvider: 'voice:setDefaultProvider',
  health: 'voice:health',
} as const;

export type VoiceCommandChannel = (typeof VOICE_COMMAND_CHANNELS)[keyof typeof VOICE_COMMAND_CHANNELS];

export const VOICE_COMMAND_CHANNEL_LIST: readonly VoiceCommandChannel[] =
  Object.values(VOICE_COMMAND_CHANNELS);

export type SpeakControlAction = 'pause' | 'resume' | 'stop';

export interface VoiceSnapshot {
  state: CanonicalVoiceState;
  detail?: { canonical: CanonicalVoiceState; sub: SubState };
  sessionId: string | null;
  activeStt: string | null;
  activeTts: string | null;
  degradedStt: DegradedInfo | null;
  degradedTts: DegradedInfo | null;
}

export interface VoiceHealthReport {
  stt: string | null;
  tts: string | null;
  degradedStt: boolean;
  degradedTts: boolean;
}

/** request -> response shapes per channel (compile-time checked in main). */
export interface VoiceCommandRequestMap {
  'voice:getState': undefined;
  'voice:startListening': { mode: VoiceMode };
  'voice:stopListening': { sessionId: string };
  'voice:sendTranscript': { sessionId: string };
  'voice:cancelSession': { sessionId: string };
  'voice:speak': { text: string };
  'voice:speakControl': { action: SpeakControlAction };
  'voice:confirmAction': { sessionId: string; approved: boolean };
  'voice:getMicrophones': undefined;
  'voice:setMicrophone': { deviceId?: string };
  'voice:getProviders': undefined;
  'voice:setProviderEnabled': { providerId: string; enabled: boolean };
  'voice:setDefaultProvider': { providerId: string };
  'voice:health': undefined;
}

export interface VoiceCommandResponseMap {
  'voice:getState': VoiceSnapshot;
  'voice:startListening': { sessionId: string };
  'voice:stopListening': void;
  'voice:sendTranscript': void;
  'voice:cancelSession': void;
  'voice:speak': { sessionId: string };
  'voice:speakControl': void;
  'voice:confirmAction': void;
  'voice:getMicrophones': { devices: Array<{ id: string; name: string; isDefault: boolean }> };
  'voice:setMicrophone': void;
  'voice:getProviders': { rows: ProviderRow[] };
  'voice:setProviderEnabled': void;
  'voice:setDefaultProvider': void;
  'voice:health': VoiceHealthReport;
}

export type VoiceEventEnvelope =
  | { type: 'state'; payload: StateEvent }
  | { type: 'speaking'; payload: SpeakingEvent }
  | { type: 'queue'; payload: QueueEvent }
  | { type: 'confirmation'; payload: ConfirmationEvent }
  | { type: 'degraded'; payload: DegradedInfo }
  | { type: 'error'; payload: VoiceErrorInfo }
  | { type: 'provider'; payload: { capability: 'stt' | 'tts'; from: string | null; to: string | null; reason?: string } }
  | { type: 'partial'; payload: { sessionId: string; text: string } }
  | { type: 'final'; payload: { sessionId: string; text: string; confidence?: number } }
  | { type: 'level'; payload: { direction: 'in' | 'out'; rms: number } }
  | { type: 'modelProgress'; payload: { capability: 'stt' | 'tts'; status: string; progress?: number } };
