# Pentrons Voice Server - Custom STT + TTS for your Electron/React app

A local voice backend for your AI assistant:

- **STT**: faster-whisper (OpenAI Whisper port, runs on CPU, fully offline)
- **TTS**: Piper (offline, fast, natural voice) with an automatic online fallback
- **Client**: dependency-free TypeScript SDK + React hook for Electron/React

Your app never touches Python. You run the server once in a terminal; the
Electron app talks to it over `http://127.0.0.1:8756` like any other API.

```
Electron/React app (TypeScript)
        |  HTTP + WebSocket (localhost)
        v
voice-server (Python, FastAPI)  ->  STT: faster-whisper
                                ->  TTS: Piper (offline WAV)
```

## 1. Start the server (one-time setup + every session)

```powershell
cd voice-server
python download_voices.py      # one-time: offline TTS voice (~63 MB)
pip install -r requirements.txt
python main.py                 # serves on http://127.0.0.1:8756
```

Pick a Whisper size with the `VOICE_STT_MODEL` env var:
`tiny` (fastest, ok) | `base` | `small` (default, good) | `medium` (best, slow on CPU).

## 2. Use it in your app

Copy the `client/` folder into your project (or publish it as an npm package).

```tsx
import { useVoice } from "./client/src";

function Assistant() {
  const { ready, listening, speaking, transcript, error,
          toggleListening, speak } = useVoice({
    onTranscript: (r) => {
      // r.text is what the user said - pipe it to your LLM here,
      // then call speak(reply) to answer out loud.
      speak(`You said: ${r.text}`);
    },
  });

  if (!ready) return <p>Voice server starting...</p>;

  return (
    <div>
      <button onClick={toggleListening} disabled={speaking}>
        {listening ? "Stop" : "Talk"}
      </button>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <p>You said: {transcript}</p>
    </div>
  );
}
```

Or use the SDK directly (main process or anywhere):

```ts
import { VoiceClient } from "./client/src";
const voice = new VoiceClient();                 // default http://127.0.0.1:8756
await voice.health();
const { text } = await voice.transcribe(audioBlob);  // speech -> text
await voice.speak("Hello!");                          // text -> speech out loud
```

### Electron notes
- The renderer needs mic permission: on Electron >= 22, handle
  `session.setPermissionRequestHandler` to allow `media` for your app.
- If you load the app from `file://`, keep CORS as-is (server allows all origins).
- To ship the server with your app, bundle Python + `voice-server/` and spawn
  `python main.py` from the main process at startup (kill it on quit).

## API reference

| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/health` | - | `{ status, stt_loaded, tts }` |
| POST | `/stt?language=en` | multipart `file` = audio (wav/webm/mp3/ogg/m4a) | `{ text, language, probability }` |
| POST | `/tts` | `{ "text": "...", "rate": 1.0 }` | `audio/wav` (or mp3 fallback) |
| WS | `/ws/stt` | binary audio frames; JSON `{"action":"flush"}` to transcribe | `{"type":"transcript","text":"..."}` |

## Files

```
voice-server/
  main.py             FastAPI app (REST + WebSocket)
  engines.py          STT/TTS engine loading + synthesis
  download_voices.py  one-time offline voice downloader
  requirements.txt
client/
  src/VoiceClient.ts  SDK (transcribe / synthesize / speak / streamTranscribe)
  src/useVoice.ts     React hook (start/stop/toggle listening, speak, state)
  src/index.ts
  package.json / tsconfig.json   (npm run build -> dist/)
examples/
  AssistantDemo.tsx   copy-paste demo component
```

## Training a truly custom model later

This stack is production-practical. If you later want a voice cloned to your
own sound / accent:
- **TTS**: fine-tune Piper (it is open and cheap to fine-tune on ~1-5 h of
  recorded speech) - the server only needs the resulting `.onnx` files,
  drop-in via `VOICE_TTS_MODEL`.
- **STT**: fine-tune Whisper (e.g. with HuggingFace `transformers`) and swap
  `engines.Transcriber` for your checkpoint - the API contract stays identical.
