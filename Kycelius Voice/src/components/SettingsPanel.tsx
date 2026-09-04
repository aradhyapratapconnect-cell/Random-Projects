import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import type { AppSettings } from '../store/appStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

const WHISPER_MODELS = [
  { id: 'onnx-community/whisper-tiny.en', label: 'Whisper tiny.en — fastest (~40 MB)' },
  { id: 'onnx-community/whisper-base', label: 'Whisper base — balanced (~80 MB)' },
  { id: 'onnx-community/whisper-small', label: 'Whisper small — accurate (~250 MB)' },
];

const LANGUAGES = ['en', 'es', 'fr', 'de', 'hi', 'ja', 'ko', 'pt', 'ru', 'zh', 'auto'];

export function SettingsPanel({ open, onClose }: Props) {
  const settings = useAppStore((s) => s.settings);
  const patch = useAppStore((s) => s.patchSettings);
  const sapiVoices = useAppStore((s) => s.sapiVoices);
  const [ttsTestText, setTtsTestText] = useState('Kycelius voice engine is online.');

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    patch({ [key]: value } as Partial<AppSettings>);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* Drawer */}
      <aside
        className={`fixed top-0 right-0 z-50 flex h-full w-[420px] max-w-[92vw] flex-col border-l border-white/10 bg-void-900 transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <h2 className="text-sm font-semibold tracking-widest text-slate-200 uppercase">
            Voice Settings
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path strokeLinecap="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* ── STT ─────────────────────────────────────────────── */}
          <Section title="Speech-to-Text">
            <Select
              label="Engine"
              value={settings.sttProvider}
              onChange={(v) => set('sttProvider', v as AppSettings['sttProvider'])}
              options={[
                { value: 'whisper-local', label: 'Local Whisper (private, on-device)' },
                { value: 'webspeech', label: 'Web Speech API (streaming)' },
                { value: 'server', label: 'Server (OpenAI-compatible)' },
              ]}
            />

            {settings.sttProvider === 'whisper-local' && (
              <>
                <Select
                  label="Model"
                  value={settings.whisperModel}
                  onChange={(v) => set('whisperModel', v)}
                  options={WHISPER_MODELS.map((m) => ({ value: m.id, label: m.label }))}
                />
                <Select
                  label="Language"
                  value={settings.whisperLanguage}
                  onChange={(v) => set('whisperLanguage', v)}
                  options={LANGUAGES.map((l) => ({ value: l, label: l }))}
                />
                <p className="text-xs text-slate-600">
                  Models download once from Hugging Face and are then cached in the app.
                </p>
              </>
            )}

            {settings.sttProvider === 'server' && (
              <>
                <Input
                  label="Base URL"
                  placeholder="https://api.groq.com/openai/v1"
                  value={settings.sttServerUrl}
                  onChange={(v) => set('sttServerUrl', v)}
                />
                <Input
                  label="API key (optional)"
                  type="password"
                  placeholder="gsk_…"
                  value={settings.sttApiKey}
                  onChange={(v) => set('sttApiKey', v)}
                />
              </>
            )}
          </Section>

          {/* ── TTS ─────────────────────────────────────────────── */}
          <Section title="Text-to-Speech">
            <Select
              label="Engine"
              value={settings.ttsProvider}
              onChange={(v) => set('ttsProvider', v as AppSettings['ttsProvider'])}
              options={[
                { value: 'browser', label: 'Browser voices (system neural)' },
                { value: 'sapi', label: 'Windows SAPI (offline)' },
                { value: 'server', label: 'Server (OpenAI-compatible)' },
              ]}
            />

            {settings.ttsProvider === 'sapi' && (
              <Select
                label="SAPI voice"
                value={settings.ttsVoice}
                onChange={(v) => set('ttsVoice', v)}
                options={[
                  { value: '', label: 'System default' },
                  ...sapiVoices.map((v) => ({ value: v, label: v })),
                ]}
              />
            )}

            {settings.ttsProvider === 'server' && (
              <>
                <Input
                  label="Base URL"
                  placeholder="https://api.openai.com/v1"
                  value={settings.ttsServerUrl}
                  onChange={(v) => set('ttsServerUrl', v)}
                />
                <Input
                  label="API key"
                  type="password"
                  placeholder="sk-…"
                  value={settings.ttsApiKey}
                  onChange={(v) => set('ttsApiKey', v)}
                />
                <Input
                  label="Voice"
                  placeholder="alloy, nova, shimmer…"
                  value={settings.ttsVoice}
                  onChange={(v) => set('ttsVoice', v)}
                />
              </>
            )}

            <Slider
              label={`Rate — ${settings.ttsRate.toFixed(1)}×`}
              min={0.5}
              max={2}
              step={0.05}
              value={settings.ttsRate}
              onChange={(v) => set('ttsRate', v)}
            />
            <Slider
              label={`Pitch — ${settings.ttsPitch.toFixed(1)}×`}
              min={0.5}
              max={1.5}
              step={0.05}
              value={settings.ttsPitch}
              onChange={(v) => set('ttsPitch', v)}
            />
          </Section>

          {/* ── Listening ───────────────────────────────────────── */}
          <Section title="Listening">
            <Toggle
              label="Hands-free (VAD auto-stop)"
              hint="Off = push-to-talk (hold Space)"
              value={settings.handsFree}
              onChange={(v) => set('handsFree', v)}
            />
            <Toggle
              label="Auto-speak replies"
              hint="Speak every final transcript back (demo of the reply loop)"
              value={settings.autoSpeak}
              onChange={(v) => set('autoSpeak', v)}
            />
            <Slider
              label={`VAD threshold — ${settings.vadThreshold.toFixed(3)}`}
              min={0.005}
              max={0.08}
              step={0.001}
              value={settings.vadThreshold}
              onChange={(v) => set('vadThreshold', v)}
            />
            <Slider
              label={`Silence to stop — ${settings.vadSilenceMs} ms`}
              min={500}
              max={3000}
              step={100}
              value={settings.vadSilenceMs}
              onChange={(v) => set('vadSilenceMs', v)}
            />
          </Section>

          {/* ── TTS test ────────────────────────────────────────── */}
          <Section title="Test TTS">
            <textarea
              value={ttsTestText}
              onChange={(e) => setTtsTestText(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-200 outline-none focus:border-kyc-500/60"
            />
            <button
              onClick={() => {
                // Routed through the global speak handler in App
                window.dispatchEvent(
                  new CustomEvent('kycelius:speak', { detail: ttsTestText }),
                );
              }}
              className="w-full rounded-lg bg-kyc-500/15 py-2 text-sm font-medium text-kyc-300 transition hover:bg-kyc-500/25"
            >
              ▶ Speak test text
            </button>
          </Section>
        </div>
      </aside>
    </>
  );
}

// ── Small building blocks ─────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-semibold tracking-widest text-kyc-400/80 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

const inputCls =
  'w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-kyc-500/60';

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-slate-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-void-900">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
    </label>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-kyc-400"
      />
    </label>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button onClick={() => onChange(!value)} className="flex w-full items-center justify-between text-left">
      <span>
        <span className="block text-sm text-slate-300">{label}</span>
        {hint && <span className="block text-xs text-slate-600">{hint}</span>}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          value ? 'bg-kyc-500' : 'bg-white/10'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            value ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}
