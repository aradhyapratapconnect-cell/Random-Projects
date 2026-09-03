/**
 * useSpeaking - narrow slice for output affordances. The active speaker icon
 * doubles as the stop control (04 section 6): a runaway answer is one click.
 */
import { useSyncExternalStore } from 'react';
import { voiceStore } from './voiceStore.ts';

export interface UseSpeakingResult {
  isSpeaking: boolean;
  isPaused: boolean;
  sentence: string | null;
  levelOut: number;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

export function useSpeaking(): UseSpeakingResult {
  const snap = useSyncExternalStore(voiceStore.subscribe, voiceStore.getSnapshot);
  const isPaused = snap.detail?.sub === 'speaking.paused';
  return {
    isSpeaking: snap.state === 'speaking',
    isPaused,
    sentence: snap.speakingSentence,
    levelOut: snap.levelOut,
    pause: () => window.kycliusVoice?.speakControl('pause') ?? Promise.resolve(),
    resume: () => window.kycliusVoice?.speakControl('resume') ?? Promise.resolve(),
    stop: () => window.kycliusVoice?.speakControl('stop') ?? Promise.resolve(),
  };
}
