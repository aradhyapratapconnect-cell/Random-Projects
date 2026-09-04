import { useAppStore } from '../store/appStore';

const STATE_LABEL: Record<string, { text: string; color: string }> = {
  idle: { text: 'Idle', color: 'bg-slate-500' },
  initializing: { text: 'Initializing', color: 'bg-amber-400 animate-pulse' },
  listening: { text: 'Listening', color: 'bg-kyc-400 animate-pulse' },
  processing: { text: 'Transcribing', color: 'bg-amber-400 animate-pulse' },
  speaking: { text: 'Speaking', color: 'bg-fuchsia-400 animate-pulse' },
  error: { text: 'Error', color: 'bg-rose-500' },
};

export function StatusBar({ device }: { device: string | null }) {
  const engineState = useAppStore((s) => s.engineState);
  const settings = useAppStore((s) => s.settings);
  const info = STATE_LABEL[engineState] ?? STATE_LABEL.idle;

  const sttLabel =
    settings.sttProvider === 'whisper-local'
      ? `Whisper (${settings.whisperModel.split('/').pop()}${device ? ` · ${device}` : ''})`
      : settings.sttProvider === 'webspeech'
        ? 'Web Speech'
        : 'Server STT';

  const ttsLabel =
    settings.ttsProvider === 'browser'
      ? 'Browser'
      : settings.ttsProvider === 'sapi'
        ? 'Windows SAPI'
        : 'Server TTS';

  return (
    <div className="flex items-center gap-4 border-t border-white/5 bg-black/30 px-4 py-2 font-mono text-[11px] text-slate-500">
      <span className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${info.color}`} />
        <span className="text-slate-300">{info.text}</span>
      </span>
      <span className="text-slate-700">|</span>
      <span>STT: <span className="text-slate-400">{sttLabel}</span></span>
      <span className="text-slate-700">|</span>
      <span>TTS: <span className="text-slate-400">{ttsLabel}</span></span>
      <span className="ml-auto">Kycelius Voice · MIT</span>
    </div>
  );
}
