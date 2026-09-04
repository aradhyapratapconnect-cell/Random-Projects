/**
 * ════════════════════════════════════════════════════════════════════
 *  Kycelius Voice — public library API
 * ════════════════════════════════════════════════════════════════════
 *  Import from here when embedding the engine into your own app:
 *
 *    import { VoiceEngine } from '@/kycelius';
 *
 *  The engine has zero UI dependencies — it is a pure TypeScript
 *  module usable from React, Electron, or any web context.
 */
export { VoiceEngine } from './VoiceEngine';
export { AudioCapture, encodeWav } from './audio/AudioCapture';
export { VadDetector, rms } from './audio/vad';
export { TypedEvents } from './events';
export { WhisperEngine } from './stt/WhisperEngine';
export { WebSpeechEngine } from './stt/WebSpeechEngine';
export { ServerSTTEngine } from './stt/ServerSTTEngine';
export { BrowserTTSEngine } from './tts/BrowserTTSEngine';
export { SapiTTSEngine } from './tts/SapiTTSEngine';
export { ServerTTSEngine } from './tts/ServerTTSEngine';

export type {
  ISTTEngine,
  ITTSEngine,
  ModelProgress,
  STTEngineConfig,
  TTSEngineConfig,
  TranscriptSegment,
  TtsOptions,
  VadConfig,
  VoiceEngineEvents,
  VoiceEngineState,
  STTProvider,
  TTSProvider,
} from './types';
