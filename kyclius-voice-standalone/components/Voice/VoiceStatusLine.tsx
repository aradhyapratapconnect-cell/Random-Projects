/**
 * VoiceStatusLine: inline status/error text ON the composer. Degradation and
 * errors are persistent and actionable (HC6) - never a toast, never silence.
 */
import type { CanonicalVoiceState } from '../../voice/types/canonical.ts';
import type { DegradedInfo, VoiceErrorInfo } from '../../voice/types/errors.ts';

export interface VoiceStatusLineProps {
  state: CanonicalVoiceState;
  degraded: DegradedInfo | null;
  error: VoiceErrorInfo | null;
}

const STATE_LABELS: Record<CanonicalVoiceState, string> = {
  idle: '',
  listening: 'Listening',
  thinking: 'Thinking...',
  awaiting_confirmation: 'Waiting for your confirmation',
  executing: 'Running',
  speaking: 'Speaking',
  error: 'Voice problem',
};

export function VoiceStatusLine({ state, degraded, error }: VoiceStatusLineProps): JSX.Element {
  const banner = degraded ?? null;
  const problem = error ?? null;
  return (
    <div className="mt-1 flex min-h-[16px] items-center gap-2 text-[11px] leading-4">
      {banner ? (
        <>
          <span className="text-amber-300">{banner.message}</span>
          {banner.actions.includes('Retry') ? (
            <button type="button" className="rounded bg-amber-500/15 px-1.5 text-amber-200 hover:bg-amber-500/25">
              Retry
            </button>
          ) : null}
        </>
      ) : problem ? (
        <span className="text-neutral-400">{problem.message}</span>
      ) : state === 'listening' ? (
        <span className="text-sky-300/80">Listening - tap the mic or speak now</span>
      ) : (
        <span className="text-neutral-500">{STATE_LABELS[state]}</span>
      )}
    </div>
  );
}
