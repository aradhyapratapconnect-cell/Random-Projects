/**
 * VoiceComposerIndicator - the actual UI element showing voice state (HC1).
 * Voice state lives ONLY on ordinary composer elements: a 1.5 px accent glow
 * ring on the composer frame, an inline waveform strip, and a mic/stop button.
 * There is no blob, no orb, no mascot, no floating character anywhere.
 * `glowFor` is the single place state maps to visuals (07 section 4).
 */
import { useVoice } from '../../voice/hooks/useVoice.ts';
import { useListening } from '../../voice/hooks/useListening.ts';
import { useSpeaking } from '../../voice/hooks/useSpeaking.ts';
import { WaveformStrip } from './WaveformStrip.tsx';
import { VoiceStatusLine } from './VoiceStatusLine.tsx';
import type { CanonicalVoiceState } from '../../voice/types/canonical.ts';

/** Pure Tailwind class map - auditable against the affordance contract. */
export function glowFor(state: CanonicalVoiceState): string {
  switch (state) {
    case 'idle':
      return 'ring-1 ring-white/10';
    case 'listening':
      return 'ring-[1.5px] ring-sky-400/70 animate-[kyclius-pulse_2s_ease-in-out_infinite]';
    case 'thinking':
      return 'ring-[1.5px] ring-violet-400/60 animate-[kyclius-shimmer_1.6s_linear_infinite]';
    case 'awaiting_confirmation':
      return 'ring-[1.5px] ring-amber-400/70';
    case 'executing':
      return 'ring-[1.5px] ring-amber-300/50';
    case 'speaking':
      return 'ring-[1.5px] ring-emerald-400/70';
    case 'error':
      return 'ring-1 ring-white/10';
    default:
      return 'ring-1 ring-white/10';
  }
}

export function VoiceComposerIndicator(): JSX.Element {
  const { state, degraded, error } = useVoice();
  const listening = useListening();
  const speaking = useSpeaking();

  const source = state === 'speaking' ? 'out' : 'in';

  return (
    <div
      className={[
        'composer relative rounded-xl border border-white/10 bg-neutral-900/60 px-3 py-2 transition-shadow',
        glowFor(state),
        degraded ? 'composer--degraded ring-amber-400/40' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-voice-state={state}
    >
      <WaveformStrip source={source} active={state === 'listening' || state === 'speaking'} />
      <div className="flex items-center gap-2">
        <input
          className="min-w-0 flex-1 bg-transparent text-sm text-neutral-200 outline-none placeholder:text-neutral-500"
          placeholder={
            state === 'listening' && listening.partial
              ? listening.partial
              : 'Type a message, or use the mic'
          }
          readOnly
          aria-label="Message composer"
        />
        {state === 'speaking' ? (
          <button
            type="button"
            onClick={() => void speaking.stop()}
            className="rounded-full bg-emerald-500/15 p-2 text-emerald-300 hover:bg-emerald-500/25"
            aria-label="Stop playback"
            title="Stop playback"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="3" y="3" width="10" height="10" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void listening.start('ptt')}
            className="rounded-full bg-neutral-800 p-2 text-neutral-300 hover:bg-neutral-700"
            aria-label="Start voice input"
            title="Start voice input"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="6" y="2" width="4" height="8" rx="2" />
              <path d="M4 8a4 4 0 0 0 8 0h1.5a5.5 5.5 0 0 1-4.75 5.45V15h-1.5v-2.55A5.5 5.5 0 0 1 2.5 8H4z" />
            </svg>
          </button>
        )}
      </div>
      <VoiceStatusLine degraded={degraded} error={error} state={state} />
    </div>
  );
}
