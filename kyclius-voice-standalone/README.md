# Kyclius Voice System — Standalone Build (v6 architecture, runnable)

This is the **runnable implementation** of the Kyclius Voice System STT+TTS
foundation (architecture: `kycelius-voice-v6/` doc set, v6). It is a standalone
workspace: every external dependency that cannot run here (microphone device,
model weights, cloud API endpoints, Electron itself) is replaced by a
clearly-labeled mock that still exercises the real code paths around it.

## What is here

```
voice/
  core/       VoiceManager (orchestrator), StateMachine (T1-T14 transition table,
              illegal transitions throw), SessionManager (generation counters,
              staleness guards), ProviderRegistry (shared `providers` table, in-memory),
              ProviderResolver (probe + fallback ladder + provider_changed),
              DegradationController (HC6), EventBus (typed engine bus)
  stt/        STTProvider interface, STTEngine facade, adapters:
              MockFasterWhisperProvider (local default, simulated decode with
              rolling partials + final + confidence), CustomCloudSttProvider
              (generic OpenAI-compatible slot, in-memory WAV egress, buffer zeroed),
              SystemSttProvider (reports `unsupported` honestly)
  tts/        TTSProvider interface, TTSEngine, SentenceSegmenter (incremental,
              abbreviation/decimal/initial guards, min/max clamps, markdown fence
              skipping, flush), SynthesisPipeline (max 2 in-flight, backpressure),
              adapters: MockKokoroProvider, CustomCloudTtsProvider, SystemTtsProvider
  audio/      MicManager (T1 guards), MockAudioCapture (16 kHz mono PCM16 frames),
              UtteranceRing (memory-only, zeroized on release), AudioProcessor (AGC
              + 30 Hz level tap), Vad (energy gate), PlaybackQueue (bounded, ordered,
              queue-gate re-check), AudioPlayer (timed mock playback)
  hooks/      VoiceProvider + store, useVoice, useListening, useSpeaking, useTranscript
  types/      canonical 7-state vocabulary + compile-enforced sub-state roll-up,
              ProviderRow (HC3 table shape), session model, error taxonomy, event map
ipc/          voice.channels.ts (typed allowlist), voice.preload.ts (narrow
              contextBridge surface), voice.main.ts (validated dispatcher + registration)
components/Voice/  VoiceComposerIndicator (glow map + mic/stop on the composer),
              WaveformStrip (rAF, no React re-renders), VoiceStatusLine (persistent,
              actionable degradation text)
demo/verify.ts     the proof harness (below)
```

Grafting map for the Kyclius repo is in `kycelius-voice-v6/01` section 3:
`voice/core|stt|tts|audio` -> `src/main/voice/**`, `ipc/voice.main.ts` ->
`src/main/ipc/voiceIpc.ts`, `ipc/voice.preload.ts` -> preload bundle,
`voice/hooks` + `components/Voice` -> renderer.

## Hard-constraint compliance

| # | Constraint | Where it is enforced in code |
|---|---|---|
| 1 | No blob/orb/mascot | `components/Voice/*` render state only as composer glow (pure `glowFor` Tailwind map), waveform strip, mic/stop icon. Grep audit: zero matches. |
| 2 | Canonical 7-state machine | `voice/types/canonical.ts` + `voice/core/StateMachine.ts`. Transitions validated against the T1-T14 table; illegal transitions throw `IllegalTransitionError`. Sub-states exist only via the compile-time `ROLLUP` record (a sub-state that can't map to one canonical state is a type error) plus a runtime check in the harness. |
| 3 | Providers are table rows | `ProviderRow` interface + `ProviderRegistry`; engines are constructed from rows via `preset_key`, never enums. |
| 4 | Local-first, cloud opt-in | Seed defaults enable local rows; `custom.cloud.*` rows ship disabled. `ProviderResolver.resolve` walks the ladder (cloud if enabled+healthy -> local -> system) and announces every hop. Wired and asserted in harness step 4. |
| 5 | Streaming is mandatory | `SentenceSegmenter` runs on the token stream; `SynthesisPipeline` + `PlaybackQueue` start synthesis/playback of sentence 1 while later tokens are still arriving. Harness step 3 asserts the timing relationship with real clocks. |
| 6 | Never silently dead | Ladder exhaustion -> `DegradationController.enter` (persistent, capability-scoped banner + actions) + `T12` error state. Harness step 5 asserts both STT and TTS exhaustion paths. |
| 7 | Renderer never gets OS access | `ipc/voice.preload.ts` exposes exactly 14 named methods + an allowlisted `on()`; no pass-through invoker, raw `ipcRenderer` never exposed, non-allowlisted channels/events rejected. Asserted in step 6. |
| 8 | Raw audio never persisted | No `fs` import anywhere under `voice/` (grep audit = 0); UtteranceRing is zeroized on release; cloud STT zeroes its WAV buffer after the response; PCM chunks are freed when a job finishes. |

## How to verify this works

Requirements: Node.js >= 23.6 (uses native TypeScript type-stripping; no build
step, no runtime dependencies). Optional dev deps only for typechecking.

```bash
npm install        # dev tooling only (typescript, react types)
npm run typecheck  # strict tsc --noEmit over everything
npm run verify     # or: node demo/verify.ts
```

`node demo/verify.ts` runs the six proofs in order and prints PASS/FAIL per
check (exit code 0 only when all pass). Expected output:

1. **STT partials -> final, idle -> listening -> thinking.** A scripted mock
   microphone feeds real 16 kHz PCM16 frames through AGC + VAD; the mock
   faster-whisper adapter emits 5 rolling partials, then a final transcript
   (`"what is the weather in tokyo tomorrow morning"`, confidence 0.87), and the
   state machine is asserted to have walked exactly
   `listening -> thinking -> speaking -> idle` (T2/T3/T9).
2. **Sentence segmentation of a token stream.** `"Good morning. Mr. Smith paid
   3.14 dollars. ..."` is fed word-by-word: `Mr.`, `3.14`, `Dr.`, `e.g.`, and
   `said:` are correctly NOT treated as sentence ends, short fragments merge
   into the next sentence (min-40-chars rule), and plain text splits exactly at
   real boundaries.
3. **HC5 streaming playback timing.** A second full turn with a slow (15 ms/token)
   mock LLM prints the measured relationship, e.g. `first sentence audible at
   t=...ms, stream finished at t=...ms (margin ~300ms)` — playback of sentence 1
   verifiably begins while tokens are still streaming, asserted with `margin > 30ms`.
4. **Cloud fallback.** Enabling the generic cloud rows makes them active; disabling
   them re-resolves both capabilities to `local.stt.faster_whisper` /
   `local.tts.kokoro` automatically, with each ladder hop announced via
   `provider_changed` (the harness asserts the exact hop events).
5. **No provider usable.** With all STT rows disabled, `startListening` throws
   `STT/NO_ENGINE`, the canonical state becomes `error` (T12), and a persistent
   degraded banner is published; the same is asserted for TTS (`TTS/NO_ENGINE`,
   capability-scoped). No silent hang, no crash, zero unhandled rejections.
6. **Narrow preload surface.** The bridge is installed against fake
   `contextBridge`/`ipcRenderer` fakes; the test asserts the exposed key set is
   exactly the 14 allowlisted methods, that no `invoke`/`ipcRenderer` pass-through
   exists, that subscribing to a non-allowlisted (audio) event throws, that main
   validates payloads (garbage mode rejected), and that main registers exactly the
   14 `voice:*` channels. A full bridge -> allowlist -> dispatcher -> engine
   round-trip (`getState`) is exercised.

A final line prints `ALL CHECKS PASSED` (31 checks across the six steps).

## Deliberate mocks (clearly labeled in code)

- `MockAudioCapture` — scripted loudness envelope through the real frame contract.
- `MockFasterWhisperProvider` — simulated decode (scripted transcript, rolling
  partials, confidence 0.87).
- `MockKokoroProvider` — simulated first-chunk latency + PCM chunks scaled to text length.
- Cloud providers — probe/synthesize paths are real (fetch-shaped, abortable,
  in-memory WAV encode/zeroize) but run with a simulated health override so no
  network is needed.
- `SystemSttProvider` — honestly reports `unsupported` (per 03 section 5.2), which
  is what makes the ladder's final rung demonstrable.

## Known deviations (smallest possible)

- `idle -> speaking` is allowed under trigger `T3.speak_command` (the
  `voice:speak` command, 06 section 2) — the transition table in 02 section 3
  only models the LLM-answer path. Commented in `StateMachine.ts`.
- Real-time pacing: capture frames are emitted at event-loop speed (accelerated),
  while playback uses real timed ticks so the HC5 assertion uses genuine clocks.
- Barge-in (T11) teardown is implemented (`VoiceManager.interrupt`, queue-gate
  re-check, generation bump, LLM abort, <=200ms path) but not exercised by the
  six required steps.
