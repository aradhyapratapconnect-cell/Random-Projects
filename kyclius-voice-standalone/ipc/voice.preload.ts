/**
 * Preload bridge (06 section 4) - the ONLY door between renderer and engine.
 * Explicit allowlist: no dynamic channel names, no pass-through invoker, and
 * `ipcRenderer` itself is never exposed. In a real Electron preload this file
 * is imported and `exposeVoiceBridge(contextBridge, ipcRenderer)` is called;
 * the demo harness drives it with fakes and asserts the exposed surface.
 */
import { VOICE_COMMAND_CHANNELS, VOICE_COMMAND_CHANNEL_LIST } from './voice.channels.ts';
import type {
  SpeakControlAction,
  VoiceCommandChannel,
  VoiceEventEnvelope,
  VoiceSnapshot,
} from './voice.channels.ts';
import { VOICE_EVENT_NAMES } from '../voice/types/events.ts';
import type { VoiceMode } from '../voice/types/canonical.ts';

export const VOICE_BRIDGE_KEY = 'kycliusVoice' as const;

export interface IpcRendererLike {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, listener: (payload: unknown) => void): void;
  removeListener(channel: string, listener: (payload: unknown) => void): void;
}

export interface ContextBridgeLike {
  exposeInMainWorld(key: string, api: unknown): void;
}

export type VoiceEventNameForBridge = VoiceEventEnvelope['type'];

export interface KycliusVoiceBridge {
  getState(): Promise<VoiceSnapshot>;
  startListening(mode: VoiceMode): Promise<{ sessionId: string }>;
  stopListening(sessionId: string): Promise<void>;
  sendTranscript(sessionId: string): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
  speak(text: string): Promise<{ sessionId: string }>;
  speakControl(action: SpeakControlAction): Promise<void>;
  confirmAction(sessionId: string, approved: boolean): Promise<void>;
  getMicrophones(): Promise<{ devices: Array<{ id: string; name: string; isDefault: boolean }> }>;
  getProviders(): Promise<{ rows: Array<Record<string, unknown>> }>;
  setProviderEnabled(providerId: string, enabled: boolean): Promise<void>;
  setDefaultProvider(providerId: string): Promise<void>;
  health(): Promise<{ stt: string | null; tts: string | null; degradedStt: boolean; degradedTts: boolean }>;
  on(event: VoiceEventNameForBridge, cb: (payload: unknown) => void): () => void;
}

/** Builds the narrow API object against any ipcRenderer-shaped source. */
export function createVoiceBridgeApi(ipc: IpcRendererLike): KycliusVoiceBridge {
  const invoke = async (
    channel: VoiceCommandChannel,
    payload?: unknown,
  ): Promise<unknown> => {
    // Hard allowlist check: the bridge is a convenience, main remains the
    // trust boundary (06 section 4).
    if (!VOICE_COMMAND_CHANNEL_LIST.includes(channel)) {
      throw new Error(`[voice] channel not allowlisted: ${String(channel)}`);
    }
    return ipc.invoke(channel, payload);
  };
  return {
    getState: () => invoke(VOICE_COMMAND_CHANNELS.getState) as Promise<VoiceSnapshot>,
    startListening: (mode) => invoke(VOICE_COMMAND_CHANNELS.startListening, { mode }) as Promise<{ sessionId: string }>,
    stopListening: (sessionId) => invoke(VOICE_COMMAND_CHANNELS.stopListening, { sessionId }).then(() => undefined),
    sendTranscript: (sessionId) => invoke(VOICE_COMMAND_CHANNELS.sendTranscript, { sessionId }).then(() => undefined),
    cancelSession: (sessionId) => invoke(VOICE_COMMAND_CHANNELS.cancelSession, { sessionId }).then(() => undefined),
    speak: (text) => invoke(VOICE_COMMAND_CHANNELS.speak, { text }) as Promise<{ sessionId: string }>,
    speakControl: (action) => invoke(VOICE_COMMAND_CHANNELS.speakControl, { action }).then(() => undefined),
    confirmAction: (sessionId, approved) =>
      invoke(VOICE_COMMAND_CHANNELS.confirmAction, { sessionId, approved }).then(() => undefined),
    getMicrophones: () => invoke(VOICE_COMMAND_CHANNELS.getMicrophones) as Promise<{ devices: Array<{ id: string; name: string; isDefault: boolean }> }>,
    getProviders: () => invoke(VOICE_COMMAND_CHANNELS.getProviders) as Promise<{ rows: Array<Record<string, unknown>> }>,
    setProviderEnabled: (providerId, enabled) =>
      invoke(VOICE_COMMAND_CHANNELS.setProviderEnabled, { providerId, enabled }).then(() => undefined),
    setDefaultProvider: (providerId) =>
      invoke(VOICE_COMMAND_CHANNELS.setDefaultProvider, { providerId }).then(() => undefined),
    health: () => invoke(VOICE_COMMAND_CHANNELS.health) as Promise<{ stt: string | null; tts: string | null; degradedStt: boolean; degradedTts: boolean }>,
    on: (event, cb) => {
      if (!VOICE_EVENT_NAMES.includes(event as never)) {
        throw new Error(`[voice] event not allowlisted: ${String(event)}`);
      }
      const wrapped = (payload: unknown): void => cb(payload);
      ipc.on(event, wrapped);
      return () => ipc.removeListener(event, wrapped);
    },
  };
}

export function exposeVoiceBridge(
  contextBridge: ContextBridgeLike,
  ipcRenderer: IpcRendererLike,
): KycliusVoiceBridge {
  const api = createVoiceBridgeApi(ipcRenderer);
  contextBridge.exposeInMainWorld(VOICE_BRIDGE_KEY, api);
  return api;
}

/** Inside a real Electron preload: expose and return; elsewhere: no-op. */
export function tryAutoExpose(): KycliusVoiceBridge | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const cb = g.contextBridge as ContextBridgeLike | undefined;
  const ipcr = g.ipcRenderer as IpcRendererLike | undefined;
  if (cb && ipcr) return exposeVoiceBridge(cb, ipcr);
  return null;
}
