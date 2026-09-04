# 11 — Scalability, Future Expansion, and Implementation Roadmap

## 1. Scalability Strategy

The architecture scales along four independent axes, each behind a seam that already exists:

| Axis | Mechanism | Why it does not require rewrites |
|---|---|---|
| **New providers** | Add a row to the shared `providers` table + (if a new shape is needed) one adapter class | Resolution, fallback, settings UI, and IPC are provider-agnostic (HC3) |
| **New engines (local)** | New adapter over the Host Protocol, or a pure-Node adapter — same `STTProvider`/`TTSProvider` interfaces | The engine host is an implementation detail behind provider interfaces (ADR-001) |
| **More capabilities** | The `capability` column already generalizes beyond `llm|stt|tts` (e.g. a future `diarize`) — new resolvers reuse the same table, health model, and ladder | Session/state machine code never special-cases capabilities |
| **More UI surfaces** | Hooks + the canonical state are the only contract; a future command palette or status bar consumes the same store slice | React never owns engine logic, so new surfaces are pure consumers |

Performance scaling notes: STT is frame-fed and utterance-scoped (memory bounded by `maxUtteranceMs`); TTS is sentence-scoped with a bounded queue; the engine host isolates model memory from the app process; VAD/DSP run on the ONNX runtime with fixed small models. No component's memory or CPU grows with conversation length.

## 2. Future Expansion Plan (in estimated order)

1. **Wake word** ("Hey Kyclius") — a new always-on VAD consumer feeding `start(handsFree)`; no engine changes.
2. **Voice commands / intent layer** — consumes final transcripts before LLM dispatch; slots into `LLMBridge` as a pre-hook.
3. **Chatterbox default upgrade path** — already a preset row; promotion is a settings flip once quality passes review.
4. **Streaming cloud STT** — if the custom cloud slot's endpoint supports WS streaming, the adapter upgrades partials for cloud users; interface unchanged.
5. **Diarization / multi-voice reading** — TTS jobs gain a `speakerTag`; queue and player already handle per-job voice params.
6. **Verified named cloud presets** (Deepgram/ElevenLabs/Cartesia etc.) — only after vendor verification; each is one new preset row + adapter, per HC4's boundary.
7. **On-device fine-tuned Whisper** — drop-in via the host (new model directory), no protocol change.

## 3. Implementation Roadmap

Phases are independently shippable; each ends with an explicit exit gate. Rough sizing assumes one senior engineer.

### Phase 0 — Foundations (3–4 days)
- `voice/types/**`: canonical states + sub-state roll-up map, event payloads, error codes, session shape, provider row types.
- CI lint rule: no `fs` in `voice/audio/**`; exhaustive sub-state roll-up compile check.
- **Exit gate:** types compile; a state-machine unit suite passes over the transition table (02 §3).

### Phase 1 — Audio Layer (5–7 days)
- MicManager, AudioCapture backends (start: WASAPI — Windows first), ring buffer, processor chain, silero VAD + energy fallback, AudioPlayer + AudioQueue.
- **Exit gate:** loopback test (capture → process → queue → player) on Windows/macOS/Linux CI or hardware matrix; 30 Hz level events verified; zero disk writes (HC8 audit).

### Phase 2 — STT local (4–5 days)
- Engine Host scaffold (spawn, health, token, backoff), FasterWhisperAdapter, SilenceDetector, partial/final streaming.
- **Exit gate:** push-to-talk transcript round trip; "didn't catch that" watchdog verified; host crash → restart → visible degradation verified.

### Phase 3 — TTS local + queue (5–6 days)
- KokoroAdapter, SentenceSegmenter, SynthesisPipeline, PlaybackQueue, transport controls, output device selection.
- **Exit gate:** offline text → gapless speech; pause/resume/stop; bounded-queue backpressure test.

### Phase 4 — Streaming end-to-end (5–7 days) ⭐ the HC5 phase
- LLMBridge into the existing `src/main/llm` runtime; segmenter-on-token-stream; T3 timing wired; barge-in teardown (02 §4.3) with session generation guards.
- **Exit gate:** measured first-audio ≤ 1.5 s on a streaming answer; barge-in mic-open ≤ 200 ms; stale-event race suite (interrupt during synth/LLM/playback) all green.

### Phase 5 — State machine hardening + errors (4–5 days)
- Full transition table enforcement, DegradationController + ladders both capabilities, error taxonomy + recovery behaviors, session timeouts.
- **Exit gate:** fault-injection matrix (kill host, revoke permission, unplug devices, bad key) → every case produces the specific message + action from `08` §3; no silent states.

### Phase 6 — React integration (4–5 days)
- VoiceProvider/store, four hooks, ComposerVoiceAffordance, VoiceStatusLine, settings section, transcript chips.
- **Exit gate:** affordance contract review (HC1 checklist); 30 Hz waveform without React re-render storms; degraded/error affordances persistent + actionable.

### Phase 7 — Providers + privacy (3–4 days)
- Custom cloud STT/TTS adapters, provider row CRUD in settings, local-only mode, transcript history UI with deletion, model manager.
- **Exit gate:** BYOK cloud round trip through the generic preset; egress audit (text-only for STT; audio freed post-play); deletion verified end-to-end.

### Phase 8 — Integration & reconciliation into Kyclius (5–7 days) ← final phase
- Graft per the mapping table (`01` §3): `src/main/voice/**` replaces the current broken `src/main/voice/` contents (deleted, not wrapped); `LLMBridge.ts` added to `src/main/llm/`; `voiceIpc.ts` registered in `src/main/ipc/`; preload merged; renderer feature folder + components added.
- Re-point the old voice IPC channel names or remove their callers; migrate any existing transcript rows; remove the old engine's dependencies (WebSpeech, transformers.js worker, SAPI service) from the bundle.
- Ship behind the existing feature-flag mechanism; default-on after one beta cycle.
- **Exit gate:** Kyclius builds + runs with no `src/kycelius/` voice remnants; constraint compliance matrix re-audited against the merged codebase; perf budgets (`10` §2) re-measured inside the real app; QA sign-off on all eight hard constraints.

### Post-integration backlog
- Wake word, voice commands, Chatterbox promotion, streaming cloud STT (§2).
