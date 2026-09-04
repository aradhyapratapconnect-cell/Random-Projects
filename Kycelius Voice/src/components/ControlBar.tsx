import { useEffect } from 'react';
import type { VoiceEngine } from '../kycelius';
import { useAppStore } from '../store/appStore';

interface Props {
  engine: VoiceEngine;
}

export function ControlBar({ engine }: Props) {
  const engineState = useAppStore((s) => s.engineState);
  const handsFree = useAppStore((s) => s.settings.handsFree);
  const listening = engineState === 'listening' || engineState === 'initializing' || engineState === 'processing';
  const speaking = engineState === 'speaking';

  const toggleMic = () => {
    if (listening) {
      void engine.stopListening();
    } else {
      void engine.startListening({ handsFree });
    }
  };

  // Spacebar push-to-talk when hands-free is off
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || handsFree) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      if (!listening) void engine.startListening({ handsFree: false });
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || handsFree) return;
      if (listening) void engine.stopListening();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [engine, listening, handsFree]);

  return (
    <div className="flex items-center justify-center gap-4">
      {/* Push-to-talk hint */}
      {!handsFree && (
        <span className="hidden font-mono text-xs text-slate-600 sm:block">
          hold [Space] to talk
        </span>
      )}

      {/* Mic button */}
      <button
        onClick={toggleMic}
        disabled={speaking}
        className={`relative flex h-16 w-16 items-center justify-center rounded-full transition-all duration-300 disabled:opacity-40 ${
          listening
            ? 'bg-gradient-to-br from-kyc-400 to-kyc-600 shadow-[0_0_40px_rgba(54,211,255,0.4)]'
            : 'bg-white/5 hover:bg-white/10'
        }`}
        title={listening ? 'Stop listening' : 'Start listening'}
      >
        {listening && (
          <span className="absolute inset-0 animate-pulse-ring rounded-full border-2 border-kyc-400/60" />
        )}
        {listening ? (
          <StopIcon className="h-6 w-6 text-void-950" />
        ) : (
          <MicIcon className="h-6 w-6 text-kyc-300" />
        )}
      </button>

      {/* Stop speaking button */}
      {speaking && (
        <button
          onClick={() => engine.stopSpeaking()}
          className="flex h-11 items-center gap-2 rounded-full bg-rose-500/10 px-5 text-sm text-rose-300 transition hover:bg-rose-500/20"
        >
          <StopIcon className="h-4 w-4" /> Stop speaking
        </button>
      )}
    </div>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
