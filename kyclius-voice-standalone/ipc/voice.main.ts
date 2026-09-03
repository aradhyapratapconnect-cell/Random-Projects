/**
 * Main-process IPC registration (06 section 2). Every command is validated
 * (hand-rolled guards here; zod in the real app) before any engine call, and
 * unknown channels are rejected. In Electron, `registerVoiceIpc(ipcMain, ...)`
 * is called from main; the demo harness drives `createVoiceCommandDispatcher`
 * directly to prove the same handlers run without Electron.
 *
 * Request/response shapes per channel are pinned by VoiceCommandRequestMap /
 * VoiceCommandResponseMap in voice.channels.ts.
 */
import type { VoiceManager } from '../voice/core/VoiceManager.ts';
import type { ProviderRegistry } from '../voice/core/ProviderRegistry.ts';
import { VOICE_COMMAND_CHANNELS, VOICE_COMMAND_CHANNEL_LIST } from './voice.channels.ts';
import type {
  SpeakControlAction,
  VoiceCommandChannel,
  VoiceSnapshot,
} from './voice.channels.ts';
import type { VoiceMode } from '../voice/types/canonical.ts';

export interface IpcMainLike {
  handle(channel: string, handler: (payload: unknown) => unknown | Promise<unknown>): void;
}

export type VoiceCommandHandler = (payload: Record<string, unknown> | undefined) => unknown;
export type VoiceCommandDispatcher = Record<VoiceCommandChannel, VoiceCommandHandler>;

function assertMode(p: Record<string, unknown> | undefined, channel: string): VoiceMode {
  const mode = p?.mode;
  if (mode !== 'ptt' && mode !== 'handsFree') {
    throw new Error(`[voice] invalid mode for ${channel}: ${String(mode)}`);
  }
  return mode;
}

function assertString(p: Record<string, unknown> | undefined, key: string, channel: string): string {
  const v = p?.[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`[voice] missing ${key} for ${channel}`);
  }
  return v;
}

function assertAction(p: Record<string, unknown> | undefined): SpeakControlAction {
  const action = p?.action;
  if (action !== 'pause' && action !== 'resume' && action !== 'stop') {
    throw new Error(`[voice] invalid speakControl action: ${String(action)}`);
  }
  return action;
}

export function createVoiceCommandDispatcher(opts: {
  manager: VoiceManager;
  registry: ProviderRegistry;
}): VoiceCommandDispatcher {
  const { manager, registry } = opts;
  const snapshot = (): VoiceSnapshot => ({
    state: manager.state as VoiceSnapshot['state'],
    detail: undefined,
    sessionId: manager.sessions.current?.id ?? null,
    activeStt: manager.activeEngines().stt,
    activeTts: manager.activeEngines().tts,
    degradedStt: manager.degradation.get('stt'),
    degradedTts: manager.degradation.get('tts'),
  });
  return {
    [VOICE_COMMAND_CHANNELS.getState]: () => snapshot(),
    [VOICE_COMMAND_CHANNELS.startListening]: (p) => manager.startListening(assertMode(p, 'voice:startListening')),
    [VOICE_COMMAND_CHANNELS.stopListening]: (p) => {
      void assertString(p, 'sessionId', 'voice:stopListening');
      manager.stopVoice();
    },
    [VOICE_COMMAND_CHANNELS.sendTranscript]: (p) => {
      void assertString(p, 'sessionId', 'voice:sendTranscript');
      manager.sendTranscript();
    },
    [VOICE_COMMAND_CHANNELS.cancelSession]: (p) => {
      const sessionId = assertString(p, 'sessionId', 'voice:cancelSession');
      manager.sessions.cancel(sessionId);
      manager.stopVoice();
    },
    [VOICE_COMMAND_CHANNELS.speak]: (p) => manager.speak(assertString(p, 'text', 'voice:speak')),
    [VOICE_COMMAND_CHANNELS.speakControl]: (p) => {
      const action = assertAction(p);
      if (action === 'pause') manager.ttsEngine.pause();
      else if (action === 'resume') manager.ttsEngine.resume();
      else manager.stopVoice();
    },
    [VOICE_COMMAND_CHANNELS.confirmAction]: (p) => {
      void assertString(p, 'sessionId', 'voice:confirmAction');
      manager.confirm(p?.approved === true);
    },
    [VOICE_COMMAND_CHANNELS.getMicrophones]: () => manager.micManager.listDevices().then((devices) => ({ devices })),
    [VOICE_COMMAND_CHANNELS.setMicrophone]: () => {
      /* device selection lands with real capture backends */
    },
    [VOICE_COMMAND_CHANNELS.getProviders]: () => ({ rows: registry.all() }),
    [VOICE_COMMAND_CHANNELS.setProviderEnabled]: (p) => {
      const providerId = assertString(p, 'providerId', 'voice:setProviderEnabled');
      registry.setEnabled(providerId, p?.enabled === true);
    },
    [VOICE_COMMAND_CHANNELS.setDefaultProvider]: (p) => {
      const providerId = assertString(p, 'providerId', 'voice:setDefaultProvider');
      registry.setDefault(providerId);
    },
    [VOICE_COMMAND_CHANNELS.health]: () => ({
      stt: manager.activeEngines().stt,
      tts: manager.activeEngines().tts,
      degradedStt: manager.degradation.isDegraded('stt'),
      degradedTts: manager.degradation.isDegraded('tts'),
    }),
  };
}

export function registerVoiceIpc(ipcMain: IpcMainLike, dispatcher: VoiceCommandDispatcher): void {
  for (const channel of VOICE_COMMAND_CHANNEL_LIST) {
    ipcMain.handle(channel, (payload: unknown) => dispatcher[channel](payload as Record<string, unknown>));
  }
}
