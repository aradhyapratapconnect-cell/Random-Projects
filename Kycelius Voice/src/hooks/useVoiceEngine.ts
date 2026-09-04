import { useEffect, useMemo } from 'react';
import { VoiceEngine } from '../kycelius';
import { useAppStore } from '../store/appStore';

/**
 * Single VoiceEngine instance bound to the app store.
 * Hot-swaps STT/TTS backends whenever relevant settings change.
 */
export function useVoiceEngine(): VoiceEngine {
  const engine = useMemo(() => {
    const s = useAppStore.getState().settings;
    return new VoiceEngine({
      stt: {
        provider: s.sttProvider,
        whisperModel: s.whisperModel,
        language: s.whisperLanguage,
        serverUrl: s.sttServerUrl,
        apiKey: s.sttApiKey,
      },
      tts: {
        provider: s.ttsProvider,
        voice: s.ttsVoice,
        rate: s.ttsRate,
        pitch: s.ttsPitch,
      },
      vad: { threshold: s.vadThreshold, silenceMs: s.vadSilenceMs },
    });
  }, []);

  // Wire engine events into the store (once)
  useEffect(() => {
    const offs = [
      engine.on('state', (s) => useAppStore.getState().setEngineState(s)),
      engine.on('partial', (seg) => useAppStore.getState().setPartial(seg.text)),
      engine.on('final', (seg) => useAppStore.getState().pushSegment(seg)),
      engine.on('level', (level) => useAppStore.getState().setLevel(level)),
      engine.on('modelProgress', (p) =>
        useAppStore.getState().setModelProgress(p.status === 'ready' ? null : p),
      ),
      engine.on('error', (err) => useAppStore.getState().setError(err.message)),
    ];

    // Report the Whisper compute device (WebGPU vs WASM) once loaded
    const deviceTimer = window.setInterval(() => {
      const stt = (engine as unknown as { stt?: { computeDevice?: string } }).stt;
      if (stt?.computeDevice) {
        useAppStore.getState().setWhisperDevice(stt.computeDevice);
      }
    }, 2000);

    // Poll the effective VAD gate so the UI can show mic level vs. gate
    const gateTimer = window.setInterval(() => {
      useAppStore.getState().setVadGate(engine.getVadGate());
    }, 250);
    const stopDeviceTimer = window.setTimeout(() => clearInterval(deviceTimer), 120_000);

    // Load persisted settings + SAPI voice list on mount
    void useAppStore.getState().loadSettings();
    void useAppStore.getState().loadSapiVoices();

    return () => {
      offs.forEach((off) => off());
      clearInterval(deviceTimer);
      clearInterval(gateTimer);
      clearTimeout(stopDeviceTimer);
      // Deliberately NOT destroying the engine here: the VoiceEngine holds
      // long-lived media resources (mic, WASM worker) and lives for the
      // whole app session. Destroying on effect cleanup breaks re-runs.
    };
  }, [engine]);

  // ── Hot-swap backends when settings change (individual scalar selectors,
  //    never arrays, to keep zustand v5 snapshots stable) ────────────────
  const sttProvider = useAppStore((s) => s.settings.sttProvider);
  const whisperModel = useAppStore((s) => s.settings.whisperModel);
  const whisperLanguage = useAppStore((s) => s.settings.whisperLanguage);
  const sttServerUrl = useAppStore((s) => s.settings.sttServerUrl);
  const sttApiKey = useAppStore((s) => s.settings.sttApiKey);

  useEffect(() => {
    void engine.setSTT({
      provider: sttProvider,
      whisperModel,
      language: whisperLanguage,
      serverUrl: sttServerUrl,
      apiKey: sttApiKey,
    });
  }, [engine, sttProvider, whisperModel, whisperLanguage, sttServerUrl, sttApiKey]);

  const ttsProvider = useAppStore((s) => s.settings.ttsProvider);
  const ttsVoice = useAppStore((s) => s.settings.ttsVoice);
  const ttsRate = useAppStore((s) => s.settings.ttsRate);
  const ttsPitch = useAppStore((s) => s.settings.ttsPitch);
  const ttsServerUrl = useAppStore((s) => s.settings.ttsServerUrl);
  const ttsApiKey = useAppStore((s) => s.settings.ttsApiKey);

  useEffect(() => {
    engine.setTTS({
      provider: ttsProvider,
      voice: ttsVoice,
      rate: ttsRate,
      pitch: ttsPitch,
      serverUrl: ttsServerUrl,
      apiKey: ttsApiKey,
    });
  }, [engine, ttsProvider, ttsVoice, ttsRate, ttsPitch, ttsServerUrl, ttsApiKey]);

  const vadThreshold = useAppStore((s) => s.settings.vadThreshold);
  const vadSilenceMs = useAppStore((s) => s.settings.vadSilenceMs);
  useEffect(() => {
    engine.setVadConfig({ threshold: vadThreshold, silenceMs: vadSilenceMs });
  }, [engine, vadThreshold, vadSilenceMs]);

  return engine;
}
