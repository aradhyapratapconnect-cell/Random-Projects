/**
 * Error taxonomy (HC6): every error has a stable code, a non-technical message,
 * and at least one action. No generic "something went wrong".
 * Source: kycelius-voice-v6/08-sessions-and-errors.md §3.
 */

export type ErrorCode =
  | 'MIC/PERMISSION_DENIED'
  | 'MIC/DEVICE_MISSING'
  | 'MIC/DEVICE_LOST'
  | 'STT/ENGINE_FAILED'
  | 'STT/NO_ENGINE'
  | 'STT/LOW_CONFIDENCE'
  | 'STT/DIDNT_CATCH'
  | 'STT/CLOUD_AUTH'
  | 'STT/CLOUD_NETWORK'
  | 'TTS/ENGINE_FAILED'
  | 'TTS/NO_ENGINE'
  | 'TTS/PLAYBACK_FAILED'
  | 'HOST/CRASHED'
  | 'LLM/STREAM_FAILED';

export interface VoiceErrorInfo {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
  actions: string[];
  sessionId?: string;
  cause?: unknown;
}

export class VoiceError extends Error implements VoiceErrorInfo {
  readonly code: ErrorCode;
  readonly recoverable: boolean;
  readonly actions: string[];
  readonly sessionId?: string;
  readonly cause?: unknown;

  constructor(info: VoiceErrorInfo) {
    super(info.message);
    this.name = 'VoiceError';
    this.code = info.code;
    this.recoverable = info.recoverable;
    this.actions = info.actions;
    this.sessionId = info.sessionId;
    this.cause = info.cause;
  }
}

/** Persistent, capability-scoped degradation banner (never a transient toast). */
export interface DegradedInfo {
  capability: 'stt' | 'tts';
  code: ErrorCode;
  message: string;
  actions: string[];
}
