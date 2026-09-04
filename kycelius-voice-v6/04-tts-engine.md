# 04 — TTS Engine

HC5 (streaming sentence playback) is the center of gravity of this engine. Everything exists to answer one question: **how fast can the first complete sentence of a still-streaming LLM response reach the speaker?**

## 1. Provider Interface

```ts
// src/main/voice/tts/TTSEngine.ts
interface TTSProvider {
  readonly row: ProviderRow;                 // providers-table row (HC3)
  probe(timeoutMs: number): Promise<Health>;
  listVoices(): Promise<VoiceInfo[]>;        // voice id + language + gender metadata
  synthesize(
    req: { text: string; voice?: string; speed: number; pitch: number;
           sessionId: string; sentenceId: number },
  ): AsyncIterable<PcmChunk>;                // 24 kHz mono PCM16 chunks, streamed
  cancel(sentenceId: number): void;          // abort an in-flight synth job
  dispose(): Promise<void>;
}
```

- `speed` and `pitch` are normalized 0.5–2.0 / 0.5–1.5 and translated per provider (Kokoro: length-scale + internal pitch handling; cloud: vendor params via the generic preset's `schema`).
- Voice selection is a **per-provider schema field** stored on the row's settings — the provider registry stays generic (HC3); Kokoro voice ids (`af_heart`, `am_michael`, …) never leak into the table shape.
- Providers return **raw PCM**, not container files, so the Audio Layer owns buffering/crossfade/format uniformly. Adapters decode anything containerized (cloud MP3/OGG) to PCM in-flight.

## 2. Streaming Sentence Playback — the core loop

```
LLM token stream (still generating ───────────────────────────────────▶)
   │                          │                          │
   ▼ t0+120ms                 ▼                          ▼
SentenceSegmenter emits S1  emits S2                 emits Sn  (flush at end)
   │
   ├─ t0+~150ms: SynthesisPipeline.submit(S1)  ── synth starts IMMEDIATELY
   │              (Kokoro first-chunk latency ~100-200ms)
   │
   └─ t0+~350ms: AudioPlayer begins S1  ◀── USER HEARS FIRST SENTENCE HERE
                                            while the LLM is still streaming
                                            tokens for sentences 2..n

S2 synth overlaps S1 playback (pipeline parallelism);
S3, S4… queue behind; ordering enforced by sentenceId.
```

Measured against the complaint this design exists to fix ("the app waits for the whole answer, then speaks"): the first audio lands roughly **one sentence-generation + one synth-latency** after the first token — typically 0.5–1.5 s — instead of full-response + synth.

## 3. SentenceSegmenter

Incremental, single-pass, runs in main on the token stream:

- **Boundaries:** `. ! ? …` followed by whitespace/end; hard newlines; `:` introducing a list item.
- **Guarded non-boundaries:** abbreviations (`Mr.`, `e.g.`, `vs.`, …), decimal numbers (`3.14`), URLs, ellipses mid-sentence, single-letter initials. A small table + look-back window; false positives cost little (slightly longer sentence), false negatives are avoided.
- **Markdown stripping:** prose is spoken; fenced code blocks are held back and rendered visually only — TTS says "…and here is the code" style summaries only if the app opts in. Inline code/links are reduced to their text.
- **Length clamps:** sentences longer than `maxChars` (280) are split at clause punctuation; segments shorter than `minChars` (40) attach to the next sentence — this prevents staccato synthesis of tiny fragments.
- **Flush:** on LLM stream end, `flush()` emits the tail immediately.
- **Backpressure:** if `PlaybackQueue` reports full, the segmenter keeps buffering text (text is cheap) and the **LLM stream is never paused**; audio is the bounded resource.

## 4. SynthesisPipeline

Turns a sentence stream into an ordered, cancellable stream of synth jobs:

```ts
interface SynthJob {
  sessionId: string;
  sentenceId: number;       // strictly increasing; playback order = sort key
  text: string;             // already markdown-stripped, length-clamped
  voice?: string; speed: number; pitch: number;
  state: 'queued' | 'synthesizing' | 'ready' | 'playing' | 'done' | 'cancelled';
}
```

- **Concurrency:** max 2 in-flight synth jobs (S_i playing, S_i+1 synthesizing). This hides provider latency entirely: audio never waits for synth between sentences.
- **Cancellation:** `cancel(sessionId)` drains everything not yet `playing`. Barge-in uses this path (02 §4.3) — no orphan jobs can ever start playing after an interrupt because the queue gate re-checks session liveness right before playback.
- **Dedupe:** identical (sentenceId, text) resubmissions (LLM provider retries) collapse to the existing job.

## 5. PlaybackQueue

- **Bounded:** 8 jobs or 60 s of audio, whichever first. Full queue => drop nothing, buffer text (§3 backpressure) — audio memory stays capped (HC8: queue is PCM in RAM, freed on `done`).
- **Ordered:** jobs play in `sentenceId` order; a slow sentence N+1 never reorders ahead of N, and a fast N+2 never plays before N+1 is `ready` (1-job lookahead window keeps speech natural).
- **Gapless:** adjacent jobs crossfade 15 ms; identical voice/speed means sentence joins are imperceptible.
- **Events:** `sentence_started`, `sentence_finished`, `queue_drained` -> state machine T9.
- **Priority lane:** pre-speech earcons (e.g. "listening" cue) use `priority: interrupt` and jump the queue.

## 6. Transport Semantics

| Control | Effect |
|---|---|
| Pause | AudioPlayer suspends (fade 30 ms); queue + synth frozen; state stays `speaking` (`speaking.paused`) |
| Resume | Reverse of pause; position preserved |
| Stop | Queue cleared, current sentence stopped, pipeline cancelled; session closes; state -> `idle` |
| Interrupt (barge-in) | Stop + immediate mic open (T11); teardown <= 200 ms (02 §4.3) |

Stop/Interrupt are always available — while speaking, the composer affordance doubles as the stop control (click the active speaker icon), so a runaway answer is one click away.

## 7. Output Device Management

- Device enumeration + selection via `AudioPlayer` (main process, ADR-002); default device follows OS changes live (device-lost => graceful switch + `provider_changed`-style notice).
- **Ducking:** while TTS plays, any user-initiated system audio media key/PTT input ducks output by -12 dB rather than stopping it, unless barge-in triggers.
- Output device is a global voice setting, not a provider field — it survives provider swaps.

## 8. Fallback Ladder (HC6 — never silently dead)

```
custom cloud row (if enabled + healthy)
  -> local Kokoro-82M (default)
     -> Chatterbox (local upgrade slot; also the Kokoro-quality step-up)
        -> system.tts (SAPI 5 / AVSpeech / speech-dispatcher)
           -> DEGRADED: voice output off — status line + composer show:
              "Speech output is unavailable: <specific reason>.
               Responses will be text-only. [Retry] [Open voice settings]"
```

Same rules as STT: every hop is announced, degradation is persistent and actionable, and recovery is one click (T13). A response that was fully generated but could not be spoken is **never lost** — it is already rendered as text.
