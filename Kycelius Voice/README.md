# Kycelius Voice

> Advanced, open-source **STT + TTS voice engine** for the Kycelius AI assistant.
> Built with **Electron - React - TypeScript - Tailwind CSS**.

Kycelius Voice gives your AI assistant ears and a mouth. It ships as a complete
Electron app *and* as a **UI-agnostic TypeScript engine** (`src/kycelius/`) you can
drop into any project.

## Features

| Area | Capabilities |
|---|---|
| **STT (Speech-to-Text)** | **Local Whisper** via Transformers.js (on-device, private, WebGPU-accelerated) - **Web Speech API** (streaming partials) - **Server**: any OpenAI-compatible endpoint (Groq, LM Studio, LocalAI, whisper.cpp, OpenAI) |
| **TTS (Text-to-Speech)** | **Browser/system neural voices** - **Windows SAPI** (100% offline, via main-process IPC) - **Server**: OpenAI-compatible `/audio/speech` |
| **Listening modes** | Hands-free with **adaptive VAD** (auto speech-end detection) - Push-to-talk (hold Space) |
| **Engine** | Unified event-driven API, hot-swappable backends at runtime, echo-safe speak/pause loop, zero-copy audio pipeline (AudioWorklet -> transferable buffers) |
| **UI** | Real-time waveform visualizer, live transcript, model download progress, full settings drawer, persistent preferences |

## Getting started

````
npm install
npm run dev      # Vite dev server + Electron (HMR)
npm run build    # Production renderer + main build
npm run start    # Build and launch the Electron app
npm run dist     # Package installers (electron-builder)
````

> First launch of **Local Whisper** downloads the ONNX model (~40-250 MB) from
> Hugging Face, then caches it for offline use.

## Using the engine in your own app

The engine core has **zero UI dependencies** - import it anywhere:

````ts
import { VoiceEngine } from './src/kycelius';

const engine = new VoiceEngine({
  stt: { provider: 'whisper-local', whisperModel: 'onnx-community/whisper-base', language: 'en' },
  tts: { provider: 'sapi', voice: 'Microsoft David Desktop', rate: 1, pitch: 1 },
});

engine.on('partial', (seg) => console.log('...', seg.text));
engine.on('final',   (seg) => {
  console.log('OK', seg.text);
  // Plug your assistant in here:
  //   const reply = await myAI(seg.text);
  //   engine.speak(reply);
});
engine.on('state',  (s) => console.log('state:', s));
engine.on('error',  (e) => console.error(e));

await engine.startListening({ handsFree: true });
// await engine.stopListening();
// await engine.speak('Hello, world.');
// await engine.setSTT({ provider: 'webspeech' });  // hot-swap at runtime
// engine.destroy();
````

### Events

| Event | Payload | Fired when |
|---|---|---|
| `state` | `VoiceEngineState` | idle / initializing / listening / processing / speaking / error |
| `partial` | `TranscriptSegment` | interim transcription (streaming engines) |
| `final` | `TranscriptSegment` | finalized utterance |
| `level` | `number` | mic RMS level (~30 Hz, for visualizers) |
| `speechStart` / `speechEnd` | - | VAD transitions (hands-free) |
| `speakStart` / `speakEnd` | `string` / - | TTS playback boundaries |
| `modelProgress` | `ModelProgress` | Whisper model download progress |
| `error` | `Error` | any engine failure |

## Architecture

````
Renderer (React + Tailwind)
  src/kycelius/VoiceEngine      <- the reusable core
    audio/AudioCapture          getUserMedia + AudioWorklet PCM
    audio/vad.ts                adaptive energy VAD
    stt/  Whisper (Web Worker + WebGPU) | WebSpeech | Server
    tts/  Browser | Windows SAPI (IPC) | Server
        |  contextBridge (secure IPC)
Main process (Electron)
  electron/main.ts              window, IPC, single-instance
  services/sapi.ts              offline System.Speech synthesis -> WAV bytes
  services/settings.ts          JSON settings persistence (userData)
````

## Privacy

- **Local Whisper** and **Windows SAPI** run 100% on your machine - no audio ever leaves it.
- Web Speech API and Server backends explicitly opt into third-party services;
  keys are stored locally in `userData/kycelius-voice-settings.json`.

## Roadmap ideas

- Silero VAD (neural) behind the existing VAD interface
- Wake-word detection ("Hey Kycelius")
- Piper / Coqui local neural TTS backends
- Word-level timestamps & diarization via Whisper

## License

[MIT](./LICENSE) - free for personal and commercial use. Contributions welcome!
