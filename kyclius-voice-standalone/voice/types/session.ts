/**
 * Voice session model — one end-to-end voice interaction; the unit of
 * cancellation. Source: kycelius-voice-v6/08-sessions-and-errors.md §1.
 */
import type { CanonicalVoiceState } from './canonical.ts';

export interface TranscriptSegment {
  text: string;
  final: boolean;
  atMs: number;
  confidence?: number;
}

export interface PendingAction {
  proposalId: string;
  label: string;
}

export interface VoiceSession {
  id: string;
  createdAtMs: number;
  state: CanonicalVoiceState;
  transcript: TranscriptSegment[];
  aiResponse: { full: string; spokenUpTo: number } | null;
  pendingAction?: PendingAction;
  cancelled: boolean;
  interrupted: boolean;
  interruptedAtMs?: number;
  generation: number;
  endedAtMs?: number;
  outcome: 'completed' | 'cancelled' | 'interrupted' | 'failed';
}
