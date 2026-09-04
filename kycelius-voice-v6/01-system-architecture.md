?# 01 — System Architecture

## 1. High-Level Architecture

Three hard boundaries define the system. Nothing crosses a boundary except through the documented protocol.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ RENDERER (sandboxed, contextIsolation: true, nodeIntegration: false)        │
│                                                                             │
│  React UI ── Tailwind components                                            │
│  ├── Message composer / command bar   ← voice affordances live HERE         │
│  │    (glow, waveform strip, speaker icon — no characters, no blobs)        │
│  ├── voice hooks: useVoice / useListening / useSpeaking / useTranscript     │
│  └── window.kycliusVoice  (preload bridge — the ONLY door, see 06)          │
└───────────────▲─────────────────────────────────────────┬───────────────────┘
                │ typed events (state, transcript, level,  │ typed commands
                │ error, queue) — never audio buffers      │ (start/stop/speak/…)
┌───────────────┴─────────────────────────────────────────▼───────────────────┐
│ ELECTRON MAIN PROCESS  ── security + lifecycle authority                    │
│                                                                             │
│  ┌─────────────────────────── VOICE ENGINE (independent subsystem) ───────┐ │
│  │  VoiceManager (orchestrator)                                           │ │
│  │    ├── StateMachine            (canonical 7 states)                    │ │
│  │    ├── SessionManager          (sessions, cancellation, race guard)    │ │
│  │    ├── ProviderResolver        (reads shared `providers` table)        │ │
│  │    ├── HealthMonitor           (liveness, fallback ladder)             │ │
│  │    └── DegradationController   (visible failure, never silent)         │ │
│  │                                                                        │ │
│  │  STT Engine ── provider-backed recognition (partial/final streaming)   │ │
│  │  TTS Engine ── sentence segmenter → synth jobs → audio queue           │ │
│  │  Audio Layer ─ MicManager · Capture · DSP chain · VAD · Player         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  LLMBridge ── thin adapter into the EXISTING src/main/llm runtime           │
│  PersistenceBridge ── existing DB layer: `providers` rows, transcripts only │
└──────────────┬───────────────────────────────────────────▲──────────────────┘
               │ Host Protocol (localhost HTTP + WS,       │ health / model
               │ random port + per-launch token)           │ progress
┌──────────────▼───────────────────────────────────────────┴──────────────────┐
│ LOCAL ENGINE HOST (supervised sidecar, bundled runtime)                     │
│  faster-whisper STT (large-v3-turbo / small)  ·  Kokoro-82M TTS             │
│  (Chatterbox slot)  — lazy model load, in-memory audio only                 │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        └── Optional: "Custom cloud STT/TTS" providers (BYOK; text-only egress
            for STT; synthesized audio returns, is played, never persisted)
```

**Boundary rules**

1. **Renderer ⟷ Main:** typed commands in, typed events out. The renderer never receives PCM or encoded audio — only state, transcripts, and a 30 Hz RMS level for the waveform. This makes constraint 7 trivially auditable: no audio data crosses the bridge at all.
2. **Main ⟷ Engine Host:** the Host Protocol (§4). Main supervises host lifecycle; the host is stateless across requests (all session context lives in Main).
3. **Voice Engine ⟷ LLM:** via `LLMBridge`, an adapter over the existing `src/main/llm` runtime. The voice system never invokes model providers directly — streamed tokens arrive as an async iterable it can consume.

## 2. Component Responsibilities

| Component | Owns | Explicitly does NOT own |
|---|---|---|
| **VoiceManager** | The canonical state machine; session lifecycle; fallback/degradation policy; arbitration between listening and speaking (barge-in policy) | Audio DSP details; model loading; UI |
| **StateMachine** | Legal transitions, sub-state bookkeeping, transition listeners | Any I/O |
| **SessionManager** | Session IDs, generation counters, cancellation tokens, timestamps, staleness guards | Business logic of the turn |
| **ProviderResolver** | Reading the shared `providers` table, decrypting keys, building engine instances from rows, health checks, fallback chains | Choosing product defaults (the table's `is_default` does) |
| **STTEngine** | Partial/final transcript streaming, language config, VAD hand-off, per-provider adapters | Playback; persistence |
| **TTS Engine** | Sentence segmentation, synthesis job pipeline, playback queue, transport (pause/resume/stop/interrupt) | STT; transcript storage |
| **Audio Layer** | Device enumeration/selection, capture, resampling, noise suppression, gain, VAD, output queue, playback, ducking | Recognition; synthesis |
| **LLMBridge** | Sending a final transcript to the existing AI runtime; consuming the token stream; surfacing `awaiting_confirmation`/`executing` tool phases | Prompt construction; provider selection (the main app's job) |
| **DegradationController** | Translating "no usable engine" into a specific user-facing banner + affordance state | Hiding failures |

## 3. Folder Structure and Mapping to Kyclius

The structure below is written **to be grafted onto the existing Kyclius layout** (`src/main/voice/`, `src/main/llm/`, `src/renderer/components/`). Every folder names its destination; nothing is a parallel universe.

```
kycelius-voice-v6/                      <- this standalone repo, mirrors final layout
├── src/
│   ├── main/
│   │   ├── voice/                      -> grafts onto EXISTING src/main/voice/
│   │   │   ├── core/
│   │   │   │   ├── VoiceManager.ts       · orchestrator: state machine + policy
│   │   │   │   ├── StateMachine.ts       · canonical transitions, sub-states
│   │   │   │   ├── SessionManager.ts     · sessions, generation counters, aborts
│   │   │   │   ├── ProviderResolver.ts   · providers-table -> engine instances
│   │   │   │   ├── HealthMonitor.ts      · liveness probes, watchdogs
│   │   │   │   ├── DegradationController.ts
│   │   │   │   └── events.ts             · engine event bus (typed)
│   │   │   ├── stt/
│   │   │   │   ├── STTEngine.ts          · facade over active provider
│   │   │   │   ├── SilenceDetector.ts    · "didn't catch that" timeout logic
│   │   │   │   └── adapters/
│   │   │   │       ├── FasterWhisperAdapter.ts   (Local Engine Host)
│   │   │   │       ├── SystemSttAdapter.ts       (OS dictation hand-off)
│   │   │   │       └── CustomCloudSttAdapter.ts  (generic OpenAI-compatible)
│   │   │   ├── tts/
│   │   │   │   ├── TTSEngine.ts          · facade over active provider
│   │   │   │   ├── SentenceSegmenter.ts  · incremental, abbreviation-aware
│   │   │   │   ├── SynthesisPipeline.ts  · per-sentence jobs, ordering
│   │   │   │   ├── PlaybackQueue.ts      · bounded queue, priorities, interrupt
│   │   │   │   └── adapters/
│   │   │   │       ├── KokoroAdapter.ts          (Local Engine Host)
│   │   │   │       ├── ChatterboxAdapter.ts      (local upgrade slot)
│   │   │   │       ├── SystemTtsAdapter.ts       (SAPI / AVSpeech / speech-dispatcher)
│   │   │   │       └── CustomCloudTtsAdapter.ts  (generic OpenAI-compatible)
│   │   │   ├── audio/
│   │   │   │   ├── MicManager.ts         · devices, permissions, capture sessions
│   │   │   │   ├── AudioCapture.ts       · native capture backend (per-OS)
│   │   │   │   ├── AudioBuffer.ts        · ring buffer, in-memory ONLY (HC8)
│   │   │   │   ├── AudioProcessor.ts     · resample, noise suppression, AGC
│   │   │   │   ├── Vad.ts                · silero-vad (onnxruntime-node) + energy fallback
│   │   │   │   ├── AudioQueue.ts         · playback queue fed by TTS
│   │   │   │   └── AudioPlayer.ts        · output backend, ducking, device routing
│   │   │   ├── hooks/                    -> (renderer-side; see below)
│   │   │   └── types/
│   │   │       ├── canonical.ts          · the 7 states + sub-states (HC2)
│   │   │       ├── providers.ts          · shared providers-table row types
│   │   │       ├── events.ts             · engine <-> renderer event payloads
│   │   │       ├── errors.ts             · error-code taxonomy
│   │   │       └── session.ts            · VoiceSession shape
│   │   ├── llm/                          -> EXISTING src/main/llm/ (not copied)
│   │   │   └── LLMBridge.ts              · ONLY new file: adapter consumed by voice
│   │   └── ipc/
│   │       └── voiceIpc.ts               -> grafts onto EXISTING src/main/ipc/
│   ├── preload/
│   │   └── voiceBridge.ts                -> existing preload; adds namespaced API
│   ├── renderer/                         -> EXISTING src/renderer/
│   │   ├── voice/
│   │   │   ├── hooks/                    · useVoice / useListening / useSpeaking /
│   │   │   │                             · useTranscript + VoiceProvider.tsx
│   │   │   └── store/voiceStore.ts       · state slice fed by bridge events
│   │   └── components/Voice/             -> EXISTING components/ tree
│   │       ├── ComposerVoiceAffordance.tsx · glow + waveform ON the composer (HC1)
│   │       ├── VoiceStatusLine.tsx         · inline status/error text
│   │       ├── VoiceSettingsSection.tsx    · provider rows, devices, language
│   │       └── TranscriptChips.tsx         · inline partial/final chips
│   └── host/                             -> Local Engine Host (bundled sidecar)
│       ├── server.py                     · FastAPI: /health /stt/stream /tts/stream
│       ├── engines/whisper_engine.py     · faster-whisper
│       ├── engines/kokoro_engine.py      · Kokoro-82M (Chatterbox slot)
│       └── protocol.md                   · governed, versioned Host Protocol
```

Note: `voice/hooks/` in the request outline lands in the renderer (`src/renderer/voice/hooks/`) because hooks are React-only; the main-process engine has no hooks. The `ai/` folder from the outline maps onto the existing `src/main/llm/` — voice adds exactly one file (`LLMBridge.ts`) rather than a parallel AI stack.

### Mapping summary (reconciliation targets)

| v6 folder | Lands in Kyclius as | Note |
|---|---|---|
| `src/main/voice/**` | `src/main/voice/**` (existing dir, expanded) | The current broken implementation inside `src/main/voice/` is **deleted, not wrapped**; its IPC channel names are re-registered by `voiceIpc.ts`. |
| `src/main/llm/LLMBridge.ts` | `src/main/llm/` | One adapter file added to the existing LLM runtime; zero changes to its provider selection. |
| `src/main/ipc/voiceIpc.ts` | `src/main/ipc/` | Follows the existing per-feature IPC registration pattern. |
| `src/preload/voiceBridge.ts` | existing preload bundle | Adds `window.kycliusVoice` alongside existing contextBridge APIs. |
| `src/renderer/voice/**` | `src/renderer/` | New; mirrors existing renderer feature-folder conventions. |
| `src/renderer/components/Voice/**` | `src/renderer/components/` | Ordinary Tailwind components; nothing overlaying the ambient scenery (HC1). |
| `src/host/**` | packaged resource spawned by main | Replaces the `Py voice` ad-hoc server; protocol is versioned. |

## 4. Local Engine Host (ADR-001)

faster-whisper (CTranslate2) and Kokoro are Python-native; the Electron main process is Node. Two viable strategies:

- **(a) Pure-Node inference** via `onnxruntime-node` (Whisper ONNX export, `kokoro-js`). Fewer processes — but Whisper export tooling is brittle and Chatterbox has no Node runtime at all.
- **(b) Supervised Python sidecar** (chosen): a bundled, versioned host process exposing a localhost HTTP+WS protocol on a random port with a per-launch bearer token. Main spawns it, health-checks it, restarts it with backoff, and kills it on quit.

**Decision: (b).** Rationale: matches the proven `Py voice` pattern; isolates heavy deps (ctranslate2, ONNX TTS); a host crash can never take down main (the engine degrades visibly instead, HC6); the protocol seam makes any future engine — including a pure-Node one — a drop-in adapter change. The adapters are deliberately host-agnostic: the Host Protocol is an implementation detail behind the provider interfaces.

Host rules:

- Binds `127.0.0.1` only; rejects requests without the launch token.
- Lazy-loads models (startup < 1 s; first use pays model cost, reported as progress events).
- Holds audio strictly in memory (HC8); never writes buffers to disk.
- `GET /health` -> `{ status, stt_loaded, tts_loaded, models, version }` (drives HealthMonitor).

## 5. Provider Registry (HC3, HC4)

### 5.1 Shared table, zero schema divergence

Voice providers are rows in the **existing** `providers` table — the same shape as `llm` rows:

```ts
// src/main/voice/types/providers.ts — mirrors the existing table exactly
type Capability = 'llm' | 'stt' | 'tts';

interface ProviderRow {
  id: string;                        // existing PK
  capability: Capability;            // 'stt' | 'tts' for voice rows
  preset_key: string;                // see 5.3
  display_name: string;
  schema: string;                    // JSON-schema string for this preset's settings
  base_url: string | null;           // cloud presets only; local/system = null
  api_key_encrypted: string | null;  // existing encryption; decrypted only in main
  default_model: string | null;      // e.g. 'large-v3-turbo', 'kokoro-82M-v1.0:af_heart'
  enabled: boolean;
  is_default: boolean;               // one default per capability
}
```

No voice-specific columns, no parallel table, no vendor enum. A **cloud voice provider is never required**: with no enabled cloud row (or an unhealthy one), the resolver falls back to the local default row (ladder in `08` §4).

### 5.2 Resolution algorithm

```
resolve(capability):
  rows = providers.where(capability, enabled)
  1. row = rows.find(is_default)
  2. if !row.healthy -> for each other enabled row (local default, then system):
       probe(row, timeout=3s) -> first healthy wins; emit provider_changed(why)
  3. if none healthy -> DegradationController.enter(capability, reason)
       STT: typed input remains; TTS: text-only output remains — both visible
```

Every resolution emits `provider_changed`, so the status line always names the active engine — the user is never left guessing which voice is speaking or which ear is listening.

### 5.3 Preset keys (settled — no named cloud vendors)

| preset_key | capability | base_url | default_model | Notes |
|---|---|---|---|---|
| `local.stt.faster_whisper` | stt | — | `large-v3-turbo` | Free default; `small` is the built-in step-down surfaced in settings |
| `system.stt` | stt | — | — | OS-native dictation hand-off; last-resort input |
| `custom.cloud.stt` | stt | user URL | user model | Single generic OpenAI-compatible `/audio/transcriptions`-shaped slot (HC4) |
| `local.tts.kokoro` | tts | — | `kokoro-82M-v1.0` | Free default; voice id carried in model suffix or schema |
| `local.tts.chatterbox` | tts | — | — | Free local upgrade; same adapter seam |
| `system.tts` | tts | — | — | SAPI 5 (Win) / AVSpeech (macOS) / speech-dispatcher (Linux) |
| `custom.cloud.tts` | tts | user URL | user voice | Single generic OpenAI-compatible `/audio/speech`-shaped slot (HC4) |

Deepgram/ElevenLabs/Cartesia remain illustrative only — they would be added later as additional preset rows if and when verified; nothing in the architecture assumes them.

## 6. ADR Index

| ADR | Decision | Rationale |
|---|---|---|
| 001 | Bundled Python Local Engine Host behind an adapter seam | Isolates heavy inference; crash-proof main; future engines are drop-ins (§4) |
| 002 | All capture **and** playback in main; renderer receives levels, never audio | Strongest reading of HC7; simplifies device routing + ducking |
| 003 | VAD (silero via onnxruntime-node) in main; energy-gate fallback | VAD must run while host/STT is still loading; drives barge-in latency |
| 004 | Session = unit of cancellation; generation counters on every async hop | Kills stale-response races deterministically (`08` §2) |
| 005 | Sentence-level streaming TTS with bounded queue + backpressure contract | HC5 is a pipeline property, not a feature flag (`04`) |
| 006 | Provider rows, not enums; generic cloud presets only | HC3/HC4 verbatim |
