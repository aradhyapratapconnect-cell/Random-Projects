# 03 — STT Engine

## 1. Provider Interface

Every STT backend — local faster-whisper, System, or the generic custom cloud slot — implements one interface and is constructed **from a `providers` table row** (HC3), never from a hardcoded enum:

```ts
// src/main/voice/stt/STTEngine.ts
interface STTProvider {
  readonly row: ProviderRow;              // the providers-table row this instance serves
  probe(timeoutMs: number): Promise<Health>;
  startStream(cfg: SttStreamConfig, sink: SttSink): void;
  stopStream(): void;
  dispose(): Promise<void>;
}

interface SttStreamConfig {
  sessionId: string;
  language: string;            // BCP-47; 'auto' allowed for local whisper
  sampleRate: number;          // engine receives 16 kHz mono PCM16 (normalized upstream)
  model: string | null;        // from row.default_model (e.g. 'large-v3-turbo')
}

interface SttSink {
  onPartial(p: { text: string; sessionId: string; atMs: number }): void;
  onFinal(p: { text: string; confidence?: number; sessionId: string; atMs: number }): void;
  onError(p: { code: ErrorCode; cause?: unknown; sessionId: string }): void;
  onModelProgress(p: { status: string; progress?: number }): void;  // first-use model download/load
}
```

`STTEngine` (the facade) owns exactly one active provider instance at a time, chosen by `ProviderResolver`. Switching providers is a live swap: finish the in-flight utterance on the old provider, then stream on the new one.

## 2. Recognition Pipeline

```
MicManager -> AudioCapture (16k mono PCM16 frames, 20 ms)
    -> AudioProcessor (NS + AGC)
    -> Vad ------------------- speech-start: open utterance buffer
    |                          speech-end:  close utterance -> final STT pass
    -> UtteranceRing (in-memory only, HC8)
    -> STTEngine (active provider adapter)
          |-- partials while VAD says speech is ongoing
          |-- onFinal(confidence) -> SessionManager -> LLMBridge
```

- **Partial transcripts** stream while the user is still speaking. faster-whisper runs a rolling decode on the utterance buffer every ~300 ms of new speech and re-emits the stable prefix; the renderer renders this as a live chip in the composer area.
- **Final transcript** is produced at VAD speech-end with one full decode of the utterance (higher accuracy than the partials), plus token-weighted confidence.
- If final confidence < `minConfidence` (default 0.45) the engine does not guess: it emits the `low_confidence` hint so the UI can show "Did you say '…'?" inline on the composer rather than dispatching a wrong request to the LLM.

## 3. Endpoints, Silence, and "Didn't Catch That"

| Parameter | Default | Purpose |
|---|---|---|
| `vad.threshold` | 0.5 (silero prob) | Speech vs. non-speech gate |
| `minSpeechMs` | 250 | Below this, an utterance is discarded (coughs, clicks) |
| `silenceMs` | 700 | Silence that ends an utterance (endpointing) |
| `maxSilenceMs` | 8000 | **Silence before any speech** -> "didn't catch that" (T10) |
| `maxUtteranceMs` | 60000 | Hard cap; forces finalization to bound memory (HC8) |

The failure mode the old system had — listening forever, silently — is structurally impossible: `maxSilenceMs` and `maxUtteranceMs` are watchdog timers owned by `SilenceDetector` in main, independent of provider health. When they fire, the state machine transitions T10 (`listening` self-loop) and the status line shows **"Didn't catch that — try speaking again."** In hands-free mode capture re-arms automatically; in push-to-talk it disarms and waits for the user.

## 4. Continuous Listening

Hands-free mode keeps capture open across turns. After T2 (`listening` -> `thinking`) the engine enters echo-suppression mode:

- Mic continues capturing but VAD is gated down while `speaking` (the system must not transcribe itself).
- On T11 barge-in (user speech above threshold while gated), teardown runs (02 §4.3) and listening resumes.
- Continuous mode is opt-in per session (hotkey-hold is the default interaction); the composer affordance always shows which mode is live.

## 5. Provider Adapters

### 5.1 FasterWhisperAdapter (local default — `local.stt.faster_whisper`)

- Talks to the Local Engine Host over the Host Protocol WS (`/stt/stream`): binary 16 kHz PCM16 frames in; JSON `{type: partial|final|progress, ...}` out.
- Model from `row.default_model`: **large-v3-turbo** default; **small** is the exposed step-down (settings UI on the row, per the row `schema`).
- First-use model download/load streams `onModelProgress` to the UI ("Downloading speech model, 43%") — never a silent freeze.
- Greedy decode (`beam=1`) for live turns; `condition_on_previous_text=false` per utterance so errors never propagate across turns.

### 5.2 SystemSttAdapter (`system.stt` — last-resort input)

- Hand-off, not capture: opens the OS dictation surface (Windows: Win+H via `shell:` activation; macOS: dictation intent; Linux: documented manual step) and listens for paste-in of recognized text where the OS supports it.
- Capability-probed at startup; the probe result feeds the degradation ladder (§6). Where the OS offers no automation path, the adapter reports `unsupported` rather than pretending.

### 5.3 CustomCloudSttAdapter (`custom.cloud.stt` — generic BYOK slot)

- Shape: OpenAI-compatible `POST {base_url}/audio/transcriptions` with `file`, `model`, `language`; Bearer key from the row (decrypted in main only).
- **Text-only egress (HC8):** the request body contains the utterance PCM encoded to WAV in memory; the buffer is zeroed after the response. Cloud providers may log server-side (their policy, surfaced in settings as a one-line privacy note) — but Kyclius persists nothing but the returned text.
- Partials: if the endpoint advertises no streaming (typical), partials come from the local VAD-free rolling decode only when a local engine is also configured; otherwise the cloud slot is final-only and the UI labels it "final result at sentence end".

## 6. Fallback Ladder (HC6 — never silently dead)

```
cloud row (if enabled + healthy)
  -> local faster-whisper (default)
     -> faster-whisper small (step-down, if large fails to load: VRAM/RAM)
        -> system.stt (OS dictation)
           -> DEGRADED: voice input off — composer shows:
              "Voice input is unavailable: <specific reason>.
               You can keep typing. [Retry] [Open voice settings]"
```

- Every rung hop emits `provider_changed {from, to, reason}` -> status line.
- The degraded state is a **first-class UI state on the composer** (subtle amber affordance), not a toast that disappears. It persists until input works again (T13).
- `Retry` re-runs `ProviderResolver.resolve('stt')`; `Open voice settings` deep-links to the provider row editor.

## 7. Configuration Surface

Language (BCP-47, per-row), device (MicManager selection, §05), model size, VAD thresholds, endpoint timeouts, confidence floor. All persisted as normal app settings; the provider row holds provider-specific fields only, described by its `schema`.
