import { create } from 'zustand';
import type {
  ModelProgress,
  TranscriptSegment,
  VoiceEngineState,
} from '../kycelius/types';

export interface AppSettings {
  sttProvider: 'whisper-local' | 'webspeech' | 'server';
  ttsProvider: 'browser' | 'sapi' | 'server';
  whisperModel: string;
  whisperLanguage: string;
  sttServerUrl: string;
  sttApiKey: string;
  ttsServerUrl: string;
  ttsApiKey: string;
  ttsModel: string;
  ttsVoice: string;
  ttsRate: number;
  ttsPitch: number;
  vadThreshold: number;
  vadSilenceMs: number;
  handsFree: boolean;
  autoSpeak: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  sttProvider: 'whisper-local',
  ttsProvider: 'browser',
  whisperModel: 'onnx-community/whisper-base',
  whisperLanguage: 'en',
  sttServerUrl: '',
  sttApiKey: '',
  ttsServerUrl: '',
  ttsApiKey: '',
  ttsModel: 'tts-1',
  ttsVoice: '',
  ttsRate: 1.0,
  ttsPitch: 1.0,
  vadThreshold: 0.008,
  vadSilenceMs: 1400,
  handsFree: true,
  autoSpeak: false,
};

interface AppState {
  engineState: VoiceEngineState;
  segments: TranscriptSegment[];
  partial: string;
  level: number;
  error: string | null;
  modelProgress: ModelProgress | null;
  whisperDevice: string | null;
  /** Live effective VAD gate (energy level speech must cross) */
  vadGate: number;
  settings: AppSettings;
  settingsLoaded: boolean;
  sapiVoices: string[];

  setEngineState: (s: VoiceEngineState) => void;
  pushSegment: (seg: TranscriptSegment) => void;
  setPartial: (text: string) => void;
  setLevel: (level: number) => void;
  setVadGate: (gate: number) => void;
  setError: (msg: string | null) => void;
  setModelProgress: (p: ModelProgress | null) => void;
  setWhisperDevice: (d: string | null) => void;
  patchSettings: (patch: Partial<AppSettings>) => void;
  loadSettings: () => Promise<void>;
  loadSapiVoices: () => Promise<void>;
  clearTranscript: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  engineState: 'idle',
  segments: [],
  partial: '',
  level: 0,
  error: null,
  modelProgress: null,
  whisperDevice: null,
  vadGate: 0,
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  sapiVoices: [],

  setEngineState: (engineState) => set({ engineState }),
  pushSegment: (seg) =>
    set((s) => ({
      segments: [...s.segments.slice(-199), seg],
      partial: '',
    })),
  setPartial: (partial) => set({ partial }),
  setLevel: (level) => set({ level }),
  setVadGate: (vadGate) => set({ vadGate }),
  setError: (error) => set({ error }),
  setModelProgress: (modelProgress) => set({ modelProgress }),
  setWhisperDevice: (whisperDevice) => set({ whisperDevice }),

  patchSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    // Persist through the Electron bridge (silently no-ops in plain browser)
    void window.kycelius?.settings.set(patch as Record<string, unknown>);
  },

  loadSettings: async () => {
    try {
      const stored = (await window.kycelius?.settings.get()) as Partial<AppSettings> | undefined;
      set({ settings: { ...DEFAULT_SETTINGS, ...stored }, settingsLoaded: true });
    } catch {
      set({ settingsLoaded: true });
    }
  },

  loadSapiVoices: async () => {
    try {
      const voices = (await window.kycelius?.sapi.listVoices()) ?? [];
      set({ sapiVoices: voices });
    } catch {
      set({ sapiVoices: [] });
    }
  },

  clearTranscript: () => set({ segments: [], partial: '' }),
}));
