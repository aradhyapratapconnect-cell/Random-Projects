/**
 * useListening - narrow slice for mic affordances on ordinary elements (HC1).
 * start() never touches permission logic: it invokes the command and renders
 * whatever main decides (granted, denied, degraded).
 */
import { useEffect, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { voiceStore } from './voiceStore.ts';
import type { CanonicalVoiceState } from '../types/canonical.ts';

export interface UseListeningResult {
  isListening: boolean;
  mode: 'ptt' | 'handsFree' | null;
  didntCatch: boolean;
  partial: string | null;
  start(mode: 'ptt' | 'handsFree'): Promise<void>;
  stop(): Promise<void>;
}

export function useListening(): UseListeningResult {
  const snap = useSyncExternalStore(voiceStore.subscribe, voiceStore.getSnapshot);
  const [mode, setMode] = useState<'ptt' | 'handsFree' | null>(null);
  const isListening = snap.state === 'listening';
  const didntCatch = snap.detail?.sub === 'listening.didnt_catch';
  return {
    isListening,
    mode,
    didntCatch,
    partial: snap.partial,
    start: (m) => {
      setMode(m);
      return window.kycliusVoice?.startListening(m).then(() => undefined) ?? Promise.resolve();
    },
    stop: () => {
      const id = snap.sessionId;
      setMode(null);
      return id && window.kycliusVoice ? window.kycliusVoice.stopListening(id) : Promise.resolve();
    },
  };
}

/** Level ref: 30 Hz updates without re-rendering (07 section 2). */
export function useListeningLevel(direction: 'in' | 'out'): { current: number } {
  const ref = useRef(0);
  useEffect(() => {
    const b = window.kycliusVoice;
    if (!b) return;
    return b.on('level', (p) => {
      const ev = p as { direction: 'in' | 'out'; rms: number };
      if (ev.direction === direction) ref.current = ev.rms;
    });
  }, [direction]);
  return ref;
}

export type { CanonicalVoiceState };
