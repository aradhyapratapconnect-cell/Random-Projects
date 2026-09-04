import { useEffect, useState } from 'react';
import { useVoiceEngine } from './hooks/useVoiceEngine';
import { useAppStore } from './store/appStore';
import { WaveformVisualizer } from './components/WaveformVisualizer';
import { TranscriptPanel } from './components/TranscriptPanel';
import { ControlBar } from './components/ControlBar';
import { StatusBar } from './components/StatusBar';
import { SettingsPanel } from './components/SettingsPanel';

export default function App() {
  const engine = useVoiceEngine();
  const engineState = useAppStore((s) => s.engineState);
  const error = useAppStore((s) => s.error);
  const modelProgress = useAppStore((s) => s.modelProgress);
  const whisperDevice = useAppStore((s) => s.whisperDevice);
  const level = useAppStore((s) => s.level);
  const vadGate = useAppStore((s) => s.vadGate);
  const autoSpeak = useAppStore((s) => s.settings.autoSpeak);
  const handsFree = useAppStore((s) => s.settings.handsFree);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Speak every final transcript back when auto-speak is enabled.
  // ★ This is the hook point where your assistant's reply pipeline plugs in:
  //   seg.text -> your AI -> reply text -> engine.speak(reply)
  useEffect(() => {
    const off = engine.on('final', (seg) => {
      if (autoSpeak) void engine.speak(seg.text);
    });
    return off;
  }, [engine, autoSpeak]);

  // Test-TTS events from the settings drawer
  useEffect(() => {
    const handler = (e: Event) => void engine.speak((e as CustomEvent<string>).detail);
    window.addEventListener('kycelius:speak', handler);
    return () => window.removeEventListener('kycelius:speak', handler);
  }, [engine]);

  const listening = engineState === 'listening';
  const speaking = engineState === 'speaking';
  const processing = engineState === 'processing';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-void-950 text-slate-200">
      {/* Ambient background glows */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-kyc-500/10 blur-[120px]" />
        <div className="absolute right-0 bottom-0 h-72 w-72 rounded-full bg-fuchsia-500/5 blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-kyc-400 to-kyc-700 shadow-lg shadow-kyc-500/20">
            <svg viewBox="0 0 24 24" fill="none" stroke="#020409" strokeWidth="2.4" className="h-5 w-5">
              <path strokeLinecap="round" d="M3.5 12h2l2-6 3 12 3-9 2 3h5" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg leading-tight font-semibold tracking-tight text-white">
              Kycelius <span className="text-kyc-400">Voice</span>
            </h1>
            <p className="text-[11px] text-slate-500">Open-source speech engine for your assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {whisperDevice && (
            <span className="hidden rounded-full border border-white/10 px-3 py-1 font-mono text-[10px] text-slate-400 sm:block">
              {whisperDevice === 'webgpu' ? '⚡ WebGPU' : 'WASM'}
            </span>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
            title="Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.6 3.6 10 6a6 6 0 0 0-1.4.8l-2.2-.9-2.4 4.1 1.9 1.4a6 6 0 0 0 0 1.6l-1.9 1.4 2.4 4.1 2.2-.9c.4.3.9.6 1.4.8l.4 2.4h4.8l.4-2.4c.5-.2 1-.5 1.4-.8l2.2.9 2.4-4.1-1.9-1.4a6 6 0 0 0 0-1.6l1.9-1.4-2.4-4.1-2.2.9A6 6 0 0 0 14 6l.4-2.4h-4.8Z" />
              <circle cx="12" cy="12" r="2.6" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col gap-4 px-5 pb-4">
        {/* Orb + waveform */}
        <section className="relative flex flex-col items-center justify-center rounded-3xl border border-white/5 bg-white/[0.02] px-8 py-8">
          <div className="relative mb-6">
            <div
              className={`h-24 w-24 rounded-full bg-gradient-to-br from-kyc-300 via-kyc-500 to-kyc-800 ${
                listening ? 'animate-pulse-ring shadow-[0_0_60px_rgba(54,211,255,0.5)]' : 'opacity-60'
              } ${speaking ? 'animate-pulse-ring shadow-[0_0_60px_rgba(232,121,249,0.5)]' : ''}`}
              style={{
                transform: `scale(${1 + Math.min(level * 2.2, 0.6)})`,
                transition: 'transform 80ms linear',
              }}
            />
            <div className="absolute inset-0 rounded-full bg-kyc-400/20 blur-2xl" />
          </div>

          <p className="mb-5 h-5 text-sm text-slate-400">
            {listening
              ? handsFree
                ? 'Listening… just talk (hands-free)'
                : 'Listening… hold Space or the mic'
              : processing
                ? 'Transcribing…'
                : speaking
                  ? 'Kycelius is speaking…'
                  : 'Press the mic to start'}
          </p>

          <WaveformVisualizer engine={engine} listening={listening} speaking={speaking} />

          {/* Live VAD meter: mic level vs. the gate speech must cross */}
          {listening && (
            <div className="mt-4 w-full max-w-md">
              <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-[width] duration-75 ${
                    level > vadGate ? 'bg-kyc-400' : 'bg-slate-600'
                  }`}
                  style={{ width: `${Math.min(100, level * 500)}%` }}
                />
                {/* Gate marker */}
                <div
                  className="absolute top-0 h-full w-0.5 bg-rose-400"
                  style={{ left: `${Math.min(99.5, vadGate * 500)}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
                <span className={level > vadGate ? 'text-kyc-300' : 'text-slate-600'}>
                  {level > vadGate ? '● speech detected' : 'below gate — speak louder / lower VAD threshold'}
                </span>
                <span>
                  level {(level * 1000).toFixed(1)}‰ · gate {(vadGate * 1000).toFixed(1)}‰
                </span>
              </div>
            </div>
          )}

          {/* Model download progress */}
          {modelProgress && (
            <div className="mt-4 w-full max-w-md">
              <div className="mb-1 flex justify-between text-xs text-slate-500">
                <span>Downloading {modelProgress.file ?? 'model'}…</span>
                <span>
                  {modelProgress.progress != null
                    ? `${Math.round(modelProgress.progress * 100)}%`
                    : ''}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-kyc-400 to-kyc-600 transition-all"
                  style={{ width: `${Math.round((modelProgress.progress ?? 0) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </section>

        {/* Transcript */}
        <section className="min-h-0 flex-1">
          <TranscriptPanel />
        </section>

        {/* Error toast */}
        {error && (
          <div className="flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">
            <span className="truncate">{error}</span>
            <button
              onClick={() => useAppStore.getState().setError(null)}
              className="ml-3 shrink-0 text-rose-400 hover:text-rose-200"
            >
              ✕
            </button>
          </div>
        )}

        <ControlBar engine={engine} />
      </main>

      <StatusBar device={whisperDevice} />

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
