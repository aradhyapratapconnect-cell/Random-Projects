?# Kyclius Voice System — Foundation Architecture (v6)

**Status:** Approved for implementation planning
**Version:** 6.0 (supersedes renderer-engine prototype `Kycelius Voice` and sidecar experiment `Py voice`)
**Scope:** STT + TTS foundation for the Kyclius desktop assistant (Electron + React + TypeScript + Tailwind)

## 1. Purpose

This document set defines the complete foundation architecture for the Kyclius Voice System: a dedicated, independent Voice Engine that owns microphone input, speech recognition, speech synthesis, playback, interruption, permissions, and session handling — while React controls only the UI.

This is **not** a demo. It is a production subsystem design: provider-driven, local-first, streaming-first, failure-visible, and structured so future capabilities (barge-in tuning, voice commands, diarization, wake words) slot in without rewrites.

It is built **outside** the main Kyclius app and will later replace the currently broken TTS/STT implementation. `11-roadmap.md` §6 defines the explicit integration/reconciliation phase.

## 2. Relationship to Existing Work

| Prior artifact | What it established | v6 disposition |
|---|---|---|
| `Kycelius Voice/` prototype (`src/kycelius/`) | Renderer-resident engine; WebSpeech + transformers.js Whisper worker; SAPI TTS; typed event emitter | **Replaced.** Engine moves to the main process. Its `VoiceEngineState` enum is superseded by the canonical 7-state machine; `WebSpeechEngine` is dropped; SAPI becomes a `system.tts` provider row. |
| `Py voice/` sidecar (FastAPI, faster-whisper + Piper/edge-tts) | Proved the local sidecar pattern: lazy model load, WS audio streaming, confidence scoring, offline fallback | **Absorbed and formalized.** Becomes the bundled **Local Engine Host** (`01` §4). STT stays faster-whisper; TTS moves Piper → Kokoro-82M per the settled product decision; the ad-hoc API becomes the governed, versioned Host Protocol. |

## 3. Hard Constraints — Compliance Matrix

These eight decisions are settled for Kyclius. The architecture is built around them; nothing here revisits them.

| # | Constraint | Where honored |
|---|---|---|
| 1 | No blob/orb/mascot anywhere; voice state lives on ordinary UI elements (composer glow, waveform, speaker icon). | `07` §3 (Voice Affordance Contract) |
| 2 | Canonical states exactly `idle \| listening \| thinking \| awaiting_confirmation \| executing \| speaking \| error`; internal sub-states flagged + mapped. | `02` (full machine, flagged sub-states, roll-up map) |
| 3 | Providers are rows in the shared `providers` table (`capability`, `preset_key`, `display_name`, `schema`, `base_url`, encrypted `api_key`, `default_model`, `enabled`, `is_default`); no parallel voice provider system; no named cloud-vendor presets. | `01` §5 (Provider Registry) |
| 4 | Local-first; cloud is opt-in BYOK via a single generic "Custom cloud STT/TTS" preset. STT: faster-whisper large-v3-turbo (small step-down) + System fallback. TTS: Kokoro-82M, Chatterbox as free local upgrade. | `03`, `04`, `01` §5.3 |
| 5 | Streaming mandatory: TTS plays from the first complete sentence of a streamed LLM response. | `04` (segmentation + audio queue are the TTS core); `10` (timing diagram) |
| 6 | Never silently dead; no usable engine ⇒ visible degradation with a specific reason. | `08` §4 (degradation ladder) |
| 7 | Renderer never gets unrestricted Node/OS access; mic/FS/process work in main; renderer reaches the engine only via a narrow `contextBridge` API. | `06` §4 + §3. Renderer never receives audio buffers at all. |
| 8 | Raw audio never persisted; in-memory only; only transcripts written; applies to local and cloud alike. | `05` §6; `09` §4 (cloud egress contract) |

## 4. Document Map

| Doc | Contents |
|---|---|
| `01-system-architecture.md` | High-level architecture, components, folder structure + Kyclius mapping, provider registry, ADR index |
| `02-state-machine.md` | Canonical 7 states, transition table, flagged sub-states with roll-up mapping, barge-in teardown |
| `03-stt-engine.md` | STT provider abstraction, partial/final transcripts, VAD, silence timeout, continuous listening, fallback ladder |
| `04-tts-engine.md` | TTS provider abstraction, streaming sentence playback (core), audio queue, transport controls, fallback ladder |
| `05-audio-pipeline.md` | Mic manager, capture, buffers, processing, audio queue, player; component communication |
| `06-electron-integration.md` | Main/preload/renderer responsibilities, IPC commands & events, security boundaries |
| `07-react-integration.md` | `useVoice/useListening/useSpeaking/useTranscript`; affordance contract (HC1) |
| `08-sessions-and-errors.md` | Session model, race protection, error taxonomy, degradation ladder, recovery |
| `09-permissions-privacy.md` | Permission model, local-only processing, transcript lifecycle, cloud egress contract |
| `10-streaming-flow.md` | End-to-end flow with unambiguous sentence-level TTS timing vs. streaming LLM |
| `11-roadmap.md` | Scalability, future expansion, phased plan ending in Kyclius reconciliation |

## 5. Glossary

- **Voice Engine** — the independent subsystem (main process + engine host) that does all voice work.
- **Voice Manager** — the orchestrator; owns the state machine, sessions, fallback policy.
- **STT/TTS Engine** — provider-backed recognition and synthesis services inside the engine.
- **Audio Layer** — capture, processing, queueing, playback; independent of React and providers.
- **Local Engine Host** — supervised sidecar process running heavy local models.
- **Provider** — one row of the shared `providers` table; a usable STT/TTS backend configuration.
- **Session** — one end-to-end voice interaction; the unit of cancellation.
- **Canonical state** — one of the seven user-facing voice states; the only vocabulary the UI observes.
- **Degradation** — a visible, explained reduction of capability, never silence.
