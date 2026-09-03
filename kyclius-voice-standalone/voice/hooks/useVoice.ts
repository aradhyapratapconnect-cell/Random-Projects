/**
 * useVoice - full control surface (composer, command bar, settings).
 * The renderer commands; main decides. Never touches permission logic.
 */
import { useSyncExternalStore } from 'react';
import { voiceStore } from './voiceStore.ts';

export interface UseVoiceResult {
  state: ReturnType<typeof voiceStore.getSnapshot>['state'];
  detail: ReturnType<typeof voiceStore.getSnapshot>['detail'];
  degraded: ReturnType<typeof voiceStore.getSnapshot>['degraded'];
  error: ReturnType<typeof voiceStore.getSnapshot>['error'];
  activeStt: string | null;
  activeTts: string | null;
  sessionId: string | null;
  start(mode: 'ptt' | 'handsFree'): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  pauseSpeaking(): Promise<void>;
  resumeSpeaking(): Promise<void>;
  stopSpeaking(): Promise<void>;
  confirm(approved: boolean): Promise<void>;
}

function bridge(): NonNullable<Window['kycliusVoice']> {
  const b = window.kycliusVoice;
  if (!b) throw new Error('window.kycliusVoice is not available - preload bridge missing');
  return b;
}

export function useVoice(): UseVoiceResult {
  const snap = useSyncExternalStore(voiceStore.subscribe, voiceStore.getSnapshot);
  return {
    state: snap.state,
    detail: snap.detail,
    degraded: snap.degraded,
    error: snap.error,
    activeStt: snap.activeStt,
    activeTts: snap.activeTts,
    sessionId: snap.sessionId,
    start: (mode) => bridge().startListening(mode).then(() => undefined),
    stop: () => {
      const id = snap.sessionId;
      return id ? bridge().cancelSession(id) : Promise.resolve();
    },
    cancel: () => {
      const id = snap.sessionId;
      return id ? bridge().cancelSession(id) : Promise.resolve();
    },
    pauseSpeaking: () => bridge().speakControl('pause'),
    resumeSpeaking: () => bridge().speakControl('resume'),
    stopSpeaking: () => bridge().speakControl('stop'),
    confirm: (approved) => {
      const id = snap.sessionId;
      return id ? bridge().confirmAction(id, approved) : Promise.resolve();
    },
  };
}
