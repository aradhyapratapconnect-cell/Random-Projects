# 08 — Sessions, Race Protection, and Errors

## 1. Voice Session Model

A session is one end-to-end voice interaction and the unit of cancellation. Everything the engine does is attributed to exactly one session.

```ts
// src/main/voice/types/session.ts
interface VoiceSession {
  id: string;                       // ULID; monotonic, sortable
  createdAtMs: number;
  state: CanonicalVoiceState;       // session-scoped mirror of the machine
  transcript: TranscriptSegment[];  // partials + finals (derived text only, HC8)
  aiResponse: { full: string; spokenUpTo: number /* sentenceId */ } | null;
  pendingAction?: { proposalId: string; label: string };  // awaiting_confirmation
  cancelled: boolean;
  interrupted: boolean; interruptedAtMs?: number;         // barge-in (T11)
  generation: number;               // bumped on every interrupt/cancel/retry
  endedAtMs?: number;
  outcome: 'completed' | 'cancelled' | 'interrupted' | 'failed';
}
```

Only the final transcript and AI response text are persisted (transcript history, user-visible and removable — §09). Partial transcripts live in memory for the session's lifetime and die with it.

## 2. Preventing Stale Asynchronous Operations

The failure class this kills: user interrupts, but a slow STT finalization / LLM chunk / synth job from the *old* turn lands afterward and hijacks the UI or the speaker.

**Three mechanisms, applied at every async hop:**

1. **Generation counters.** Every async context captures `(sessionId, generation)` at start. Before applying any result — STT final, LLM token, synth chunk, queue drain — the owner re-checks against `SessionManager.current`. Mismatch => drop silently (engine-side) and log at debug. The UI-level guard is the same check mirrored in `voiceStore.pushFinal` via `sessionId`.

2. **AbortController wiring.** Each session owns an `AbortController`. Its signal is threaded into: the STT stream close, the LLM stream (`LLMBridge.abort`), every synth job fetch, and the playback queue drain. Cancellation is cooperative and immediate — nothing is "left running".

3. **Queue-gate re-check.** The PlaybackQueue re-validates session liveness immediately before each sentence enters the player (04 §4). This closes the last race window between "cancel accepted" and "job already handed to the OS mixer".

```
time ──────────────────────────────────────────────────────────────▶
S1: [STT]────[LLM stream]────[speak s1]────[speak s2]────
                       ▲ barge-in here
                       │ generation 1 -> 2; S1 aborted at every hop;
                       │ queued s2 dropped; mixer sentence fades 80 ms
S2:                [STT]────[LLM stream]────[speak s1']────
```

Sessions are also self-expiring: any session with no activity for `sessionTimeoutMs` (30 s) is force-cancelled — the engine can never leak a half-open turn.

## 3. Error Taxonomy

Every error has a stable code, a non-technical message, and at least one action. No generic "something went wrong" — if we cannot be specific, we have not finished the error handling.

| Code | Trigger | User-facing message (template) | Automatic recovery |
|---|---|---|---|
| `MIC/PERMISSION_DENIED` | OS denies mic | "Microphone access is off for Kyclius. Enable it in <OS settings path>." + [Open settings] | None (user action) |
| `MIC/DEVICE_MISSING` | No input device | "No microphone found. Plug one in or pick another input." + [Check devices] | Re-probe on device-change events |
| `MIC/DEVICE_LOST` | Unplugged mid-session | "Your microphone was disconnected." | Auto-reopen on default device |
| `STT/ENGINE_FAILED` | Adapter exception | "Speech recognition crashed: <engine>. Switched to <fallback>." | Ladder re-run (§4) |
| `STT/NO_ENGINE` | Ladder exhausted | "Voice input is unavailable: <reason>. You can keep typing." + [Retry] | Degraded mode (persistent) |
| `STT/LOW_CONFIDENCE` | Final < floor | "Did you say '…'?" + inline [Correct] | No dispatch to LLM |
| `STT/DIDNT_CATCH` | maxSilence timeout | "Didn't catch that — try speaking again." | Re-arm capture |
| `STT/CLOUD_AUTH` / `STT/CLOUD_NETWORK` | Cloud slot 401/timeout | "<display_name> rejected the API key / is unreachable. Using <fallback>." | Ladder re-run |
| `TTS/ENGINE_FAILED` | Adapter exception | "Speech output crashed: <engine>. Switched to <fallback>." | Ladder re-run |
| `TTS/NO_ENGINE` | Ladder exhausted | "Speech output is unavailable: <reason>. Responses are text-only." + [Retry] | Degraded mode (persistent) |
| `TTS/PLAYBACK_FAILED` | Output device error | "Audio output failed: <device>. Switched to <device>." | Auto-switch device |
| `HOST/CRASHED` | Sidecar died | "The local voice engine restarted." | Supervised restart + backoff (3x, then ladder) |
| `LLM/STREAM_FAILED` | AI runtime error | "The reply failed to generate." | Session fails cleanly; text path unaffected |

Errors map to T12 (`error`) only when the ladder is exhausted; everything else is handled inside the current state with a notice. Even in `error`, the rest of Kyclius keeps working: typed input and text replies are never blocked by voice failures.

## 4. Degradation Ladder (HC6)

Both ladders (STT §6 in `03`, TTS §8 in `04`) share one controller and one rule set:

1. Every hop announces itself (`voice:provider` + status line).
2. Exhaustion is persistent and visible on the composer (amber affordance + reason + actions) — never a transient toast, never silence.
3. Degradation is capability-scoped: broken STT never disables TTS and vice versa.
4. One-click recovery: `[Retry]` re-runs `ProviderResolver.resolve`; successful recovery clears the affordance with a brief "Voice restored" note (T13).

## 5. Recovery Strategy Details

- **Transient faults** (network, device churn): automatic retry with exponential backoff (1 s, 2 s, 4 s; cap 30 s) while the session is live; ladder re-run on final failure.
- **Host crash:** supervisor restarts the sidecar; in-flight utterances are re-processed if the capture session is still open, else the user sees "didn't catch that" rather than a hang.
- **Provider flapping** (>3 failures in 60 s): the row is quarantined for 5 minutes and the ladder skips it; settings shows the quarantine reason.
- **Permission recovery:** after the user grants access in OS settings, the device-change/permission events re-trigger the T1 guards automatically.
- **All recovery state is observable:** `voice:health` powers a diagnostics view showing each capability's ladder, current rung, and last probe result.
