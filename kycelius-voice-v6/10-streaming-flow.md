# 10 — End-to-End Streaming Flow

## 1. Full Sequence (with HC5 timing made unambiguous)

```
USER            AUDIO LAYER        STT ENGINE       VOICE MANAGER      LLM RUNTIME         TTS ENGINE        AUDIO OUT
 │ speak           │                  │                 │                  │                  │                │
 ├──────────────▶ │ capture 20ms f.  │                 │                  │                  │                │
 │                ├─ VAD: speech_start ─▶ rolling decode ─▶ partial text ──▶ composer chip      │                │
 │                │                  │  (every ~300ms) │ (listening)      │                  │                │
 │ stop speaking  │                  │                 │                  │                  │                │
 │                ├─ VAD: speech_end │                 │                  │                  │                │
 │                │   final decode ─▶ onFinal(text) ─▶ T2: thinking      │                  │                │
 │                │                  │                 ├─ send transcript ▶ stream tokens      │                │
 │                │                  │                 │                  │── token ─┐       │                │
 │                │                  │                 │◀─────────────────┘  (LLM STILL STREAMING) │                │
 │                │                  │                 │  segmenter: sentence 1 complete           │                │
 │                │                  │                 ├──────────────────────────────── synth(S1) ─▶ PCM chunks ─▶ ▶ FIRST
 │                │                  │                 │                    (T3: speaking)         │   queued       │ AUDIO OUT
 │                │                  │                 │                  │── token ──▶ segmenter: S2            (≈0.5-1.5s
 │                │                  │                 ├──────────────────────────────── synth(S2)              after first
 │                │                  │                 │◀─ S1 playing, S2 synthesizing, S3+ text still arriving ▀─┘  token)
 │                │                  │                 │                  │── final token ─▶ flush tail         │
 │                │                  │                 │                  ▼                  ▼                │
 │                │                  │                 │            stream done       queue drains ─▶ ▶ ▶ T9: idle
```

The box between "first token" and "final token" is the point of the whole design: **synthesis and playback of sentence 1 begin while the LLM is still generating sentence 3+.** Playback never waits for stream completion.

## 2. Latency Budget (targets)

| Segment | Budget | Dominated by |
|---|---|---|
| Speech start → VAD fire | ≤ 60 ms | silero on 30 ms frames |
| Speech end → final transcript | ≤ 400 ms | faster-whisper greedy decode of utterance |
| First token → first complete sentence | text-length dependent | LLM speed |
| Sentence → first PCM chunk | ≤ 250 ms | Kokoro first-chunk latency |
| PCM chunk → speaker | ≤ 20 ms | player buffer |
| **Barge-in: speech → mic open** | **≤ 200 ms** | queue clear + 80 ms fade (02 §4.3) |
| Partial transcript cadence | 150 ms (coalesced) | IPC rate limiting |

## 3. Event Correlation

Every hop in the sequence carries `(sessionId, generation)`, so the renderer's composer chip, the streaming message, and the spoken-sentence caption can never mix turns — even if the user interrupts and starts a new session mid-flight (`08` §2).
