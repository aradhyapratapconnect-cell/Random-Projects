/**
 * useTranscript - transcript stream with session staleness already applied
 * (the store drops events from non-current sessions).
 */
import { useSyncExternalStore } from 'react';
import { voiceStore } from './voiceStore.ts';

export interface UseTranscriptResult {
  partial: string | null;
  final: string | null;
  confidence: number | null;
  reset(): void;
}

export function useTranscript(): UseTranscriptResult {
  const snap = useSyncExternalStore(voiceStore.subscribe, voiceStore.getSnapshot);
  return {
    partial: snap.partial,
    final: snap.finalTranscript,
    confidence: snap.confidence,
    reset: () => voiceStore.applyState({ state: 'idle', sessionId: null }),
  };
}
