# 02 — Voice State Machine

## 1. Canonical States (HC2 — settled vocabulary)

The UI observes exactly these seven states and nothing else:

| State | Meaning | Primary UI affordance (on ordinary elements, HC1) |
|---|---|---|
| `idle` | Voice system ready, nothing in flight | No glow; mic icon available on composer |
| `listening` | Mic open, capturing; VAD active | Composer glow (calm pulse) + live waveform strip |
| `thinking` | Final transcript sent; awaiting/streaming AI response | Glow shifts to "working" shimmer; partial answer text streams |
| `awaiting_confirmation` | AI proposed a tool/action; needs explicit yes/no | Inline confirm affordance on the pending message |
| `executing` | Approved tool/action running | Status-line progress on the pending message |
| `speaking` | TTS audio actively playing (or queued) | Speaker icon animates; waveform shows output level; barge-in armed |
| `error` | Voice subsystem failure requiring awareness | Inline error text + recover action on status line — never a modal takeover |

These are **UI states**, not process states. The engine may do many things inside one canonical state (loading models, buffering audio, waiting for VAD). Internal detail lives in sub-states (§4).

## 2. Transition Diagram

```
             ┌───────────────────────────────────────────────────────┐
             │           (voice disabled / stopped / T14)             │
             ▼                                                       │
       ┌────────┐  user arms mic (PTT or hands-free)             ┌──┴──────┐
┌─────▶│  idle  │──────────────────────────────┬────────────────▶│speaking │
│      └────┬───┘                              │                 └──┬──────┘
│           │ permission/device failure        │ VAD speech-end     │ barge-in
│           ▼                                  ▼ (utterance)        │ (talk-over)
│      ┌────────┐                        ┌──────────┐               │
│      │ error  │◀──── recovery fails ───│ thinking │◀──────────────┤
│      └───┬────┘                        └────┬─────┘               │
│           │ recovery succeeds               │ AI proposes tool    │
│           └───────▶ back to prior state    ▼                     │
│                                   ┌──────────────────────┐       │
│        user approves/rejects      │awaiting_confirmation │       │
│    ┌──────────────────────────────└──────────┬───────────┘       │
│    │                                          │ approved          │
│    ▼                                          ▼                   │
│ ┌────────────┐  action completes; TTS of    ┌────────────┐        │
│ │ thinking   │  result begins               │ executing  │────────┤
│ └────────────┘◀─────────────────────────────└────────────┘        │
│                                                                   │
└────────── speaking ends (queue drained) ──────────────────────────┘
```

## 3. Complete Transition Table

| # | From | To | Trigger | Guard | Effects |
|---|---|---|---|---|---|
| T1 | `idle` | `listening` | User arms mic (hotkey, button, hands-free toggle) | Mic permission granted AND >=1 capture device AND >=1 usable STT provider (else T12) | MicManager opens capture; VAD arms; partials stream |
| T2 | `listening` | `thinking` | VAD speech-end (silence >= `silenceMs`) OR PTT released | Utterance >= `minSpeechMs` (else -> T10) | Capture stops (or keeps rolling in continuous mode); final transcript dispatched to LLMBridge |
| T3 | `thinking` | `speaking` | First complete sentence segmented from the streamed AI response | Audio queue accepted the job | Synthesis + playback start **while the LLM is still streaming** (HC5) |
| T4 | `thinking` | `awaiting_confirmation` | LLMBridge reports a pending tool/action proposal | — | Audio finishes current sentence, then playback pauses; confirm UI inline |
| T5 | `awaiting_confirmation` | `executing` | User approves (click, or spoken "yes" routed as text input) | — | Tool invoked through the main app's existing action path |
| T6 | `awaiting_confirmation` | `thinking` | User rejects or edits | — | Rejection fed back as user input; no action executed |
| T7 | `executing` | `speaking` | Action completes with a speakable result | — | Result enters the TTS pipeline (streamed if it streams) |
| T8 | `executing` | `idle` | Action completes; result rendered as text only | — | Affordances reset |
| T9 | `speaking` | `idle` | Queue drained AND LLM stream consumed AND segmenter flushed | — | Session closed; output released/unducked |
| T10 | `listening` | `listening` | Silence timeout, no valid utterance ("didn't catch that") | `maxSilenceMs` exceeded pre-speech | Visible hint on status line; capture continues hands-free, disarms in PTT |
| T11 | `speaking` | `listening` | **Barge-in**: user speech while speaking, or PTT pressed | Barge-in enabled (default on) | Interrupt teardown (4.3); mic opens immediately; session marked interrupted |
| T12 | any (except `error`) | `error` | Failure with no remaining fallback (HC6 ladder exhausted) | — | DegradationController publishes specific reason + recovery action |
| T13 | `error` | prior state (or `idle`) | Recovery succeeds (user or automatic) | Health probe passes | Error cleared with inline "recovered" note |
| T14 | any | `idle` | User stops voice / session closed / app suspends | — | All sessions cancelled; capture + playback torn down |

**Invariants**

- Only VoiceManager mutates state; transitions are validated against this table. Illegal transitions throw `IllegalTransitionError` — loud in development; logged + clamped to `idle` with an error event in production.
- `speaking` and `listening` never coexist at the UI level; barge-in is a transition (T11), not an overlap. Internally they may overlap ~150-200 ms during teardown (4.3).
- Every state carries a current `sessionId`; events without a matching live session are dropped (`08` section 2 staleness guard).

## 4. Internal Sub-States (flagged proposal per HC2)

The following are **proposed additions** — internal only, never surfaced as new user-facing states. Each rolls up to exactly one canonical state for UI observation. Any future sub-state must be added here with a roll-up mapping before use.

### 4.1 Sub-state registry

| Internal sub-state | Rolls up to | Why it exists | UI-visible effect (within canonical state) |
|---|---|---|---|
| `listening.awaiting_speech` | `listening` | Mic open, VAD armed, nothing said yet vs. actively capturing | Waveform flat vs. active |
| `listening.didnt_catch` | `listening` | T10 fired; distinct from hard error so listening continues | Inline hint "Didn't catch that — try again" |
| `thinking.awaiting_first_token` | `thinking` | LLM connected, no tokens yet ("slow LLM" vs "dead LLM") | Shimmer without text |
| `thinking.streaming` | `thinking` | Tokens flowing; sentences being segmented | Text streams in |
| `speaking.interrupting` | `speaking` | Barge-in accepted; teardown in progress (~150 ms). The only sub-state where speaking/listening overlap internally | Icon spin-down; no new sentences enqueued |
| `speaking.paused` | `speaking` | User paused playback | Icon static; queue retained |
| `error.recovering` | `error` | Automatic recovery in progress (host restart backoff) | Status line: "Retrying…" + reason |

### 4.2 Mapping rule (compile-time enforced)

```ts
// The renderer-facing event NEVER invents new user-facing states:
type CanonicalVoiceState = 'idle'|'listening'|'thinking'|'awaiting_confirmation'
                          |'executing'|'speaking'|'error';

// Sub-states ride alongside as explicitly non-normative detail:
interface VoiceStatePayload {
  state: CanonicalVoiceState;   // <- the only vocabulary UIs may branch on
  detail?: SubStateRef;         // e.g. { canonical: 'speaking', sub: 'interrupting' }
}

// Enforced exhaustiveness: a sub-state that cannot map to exactly one
// canonical state is a compile error, not a silent new UI state.
const ROLLUP: Record<SubState, CanonicalVoiceState> = {
  'listening.awaiting_speech': 'listening',
  'listening.didnt_catch':     'listening',
  'thinking.awaiting_first_token': 'thinking',
  'thinking.streaming':        'thinking',
  'speaking.interrupting':     'speaking',
  'speaking.paused':           'speaking',
  'error.recovering':          'error',
};
```

### 4.3 Barge-in teardown sequence (`speaking.interrupting`)

```
1. VAD speech detected while queue playing (or PTT pressed)
2. VoiceManager cancels the session's audio future:
     PlaybackQueue.clear(pending)       <- queued, not-yet-playing sentences dropped
     AudioPlayer.stop(fadeMs=80)        <- currently playing sentence fades out
     SynthesisPipeline.cancel(inflight) <- synth jobs aborted (host WS closed)
3. LLMBridge.abort(sessionId)           <- LLM stream cancelled if still open
4. state: speaking -> (speaking.interrupting) -> listening
   (UI observes a single T11 transition; detail carries 'interrupting')
5. SessionManager marks session { interrupted: true, interruptedAtMs }
```

Target: speech detection to mic-open **<= 200 ms**. This is why the interrupt path clears queues directly instead of awaiting provider `dispose()`.

## 5. What Deliberately Did NOT Change

- No new user-facing states. `initializing` and `processing` from the old prototype are gone: initialization shows as provider progress **within** `idle` (status line), and "processing" is now the accurate `thinking`/`executing` split.
- `awaiting_confirmation` and `executing` are canonical because the main app's tool flow already distinguishes them; voice mirrors, never redefines, that flow.
