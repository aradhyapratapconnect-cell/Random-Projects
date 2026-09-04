import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';

const SOURCE_LABEL: Record<string, string> = {
  'whisper-local': 'Whisper',
  webspeech: 'WebSpeech',
  server: 'Server',
};

export function TranscriptPanel() {
  const segments = useAppStore((s) => s.segments);
  const partial = useAppStore((s) => s.partial);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [segments.length, partial]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
        <span className="text-xs font-medium tracking-widest text-slate-400 uppercase">
          Transcript
        </span>
        <button
          onClick={() => useAppStore.getState().clearTranscript()}
          className="rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-white/5 hover:text-slate-300"
        >
          Clear
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {segments.length === 0 && !partial && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-slate-600">
              Transcribed speech will appear here…
            </p>
          </div>
        )}

        {segments.map((seg) => (
          <div key={seg.id} className="group">
            <div className="mb-0.5 flex items-center gap-2">
              <span className="rounded bg-kyc-500/10 px-1.5 py-0.5 font-mono text-[10px] text-kyc-300">
                {SOURCE_LABEL[seg.source] ?? seg.source}
              </span>
              <span className="text-[10px] text-slate-600">
                {new Date(seg.timestamp).toLocaleTimeString()}
              </span>
              {seg.latencyMs != null && (
                <span className="text-[10px] text-slate-700">{Math.round(seg.latencyMs)}ms</span>
              )}
            </div>
            <p className="text-[15px] leading-relaxed text-slate-200">{seg.text}</p>
          </div>
        ))}

        {partial && (
          <div>
            <div className="mb-0.5 flex items-center gap-2">
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                live
              </span>
            </div>
            <p className="text-[15px] leading-relaxed text-slate-400 italic">{partial}…</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
