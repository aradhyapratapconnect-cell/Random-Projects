/**
 * VoiceProvider (07 section 1): ONE bridge subscription; distributes via the
 * store. No component subscribes to IPC directly.
 */
import { useEffect, type ReactNode } from 'react';
import { voiceStore } from './voiceStore.ts';
import type { KycliusVoiceBridge } from '../../ipc/voice.preload.ts';
import type { VoiceEventMap } from '../types/events.ts';

declare global {
  interface Window {
    kycliusVoice?: KycliusVoiceBridge;
  }
}

export function VoiceProvider(_props: { children: ReactNode }): null {
  useEffect(() => {
    const bridge = window.kycliusVoice;
    if (!bridge) return;
    const unsubs: Array<() => void> = [
      bridge.on('state', (p) => voiceStore.applyState(p as VoiceEventMap['state'])),
      bridge.on('partial', (p) => voiceStore.pushPartial(p as VoiceEventMap['partial'])),
      bridge.on('final', (p) => voiceStore.pushFinal(p as VoiceEventMap['final'])),
      bridge.on('level', (p) => voiceStore.setLevel(p as VoiceEventMap['level'])),
      bridge.on('speaking', (p) => voiceStore.setSpeaking(p as VoiceEventMap['speaking'])),
      bridge.on('provider', (p) => {
        const ev = p as VoiceEventMap['provider'];
        // The status line always names the active engine.
        void ev;
      }),
      bridge.on('degraded', (p) => voiceStore.setDegraded(p as VoiceEventMap['degraded'])),
      bridge.on('error', (p) => voiceStore.setError(p as VoiceEventMap['error'])),
    ];
    // Refresh the engine names once at mount (bootstrap/reconnect).
    void bridge.getState().then((s) => voiceStore.setEngines(s.activeStt, s.activeTts)).catch(() => undefined);
    return () => {
      for (const u of unsubs) u();
    };
  }, []);
  return null;
}
