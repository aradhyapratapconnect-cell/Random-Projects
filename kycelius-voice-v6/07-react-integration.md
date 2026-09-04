# 07 — React Integration

React is a consumer. It renders state, issues commands, and never touches audio, devices, or providers. All engine contact goes through `window.kycliusVoice` (06 §4).

## 1. Provider + Store

```tsx
// src/renderer/voice/hooks/VoiceProvider.tsx
// ONE bridge subscription; distributes via zustand slice. No component subscribes to IPC directly.
export function VoiceProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const unsubs = [
      window.kycliusVoice.on('state',     s => voiceStore.setState(s)),
      window.kycliusVoice.on('partial',   p => voiceStore.pushPartial(p)),
      window.kycliusVoice.on('final',     f => voiceStore.pushFinal(f)),
      window.kycliusVoice.on('level',     l => voiceStore.setLevel(l)),   // 30 Hz
      window.kycliusVoice.on('speaking',  s => voiceStore.setSpeaking(s)),
      window.kycliusVoice.on('degraded',  d => voiceStore.setDegraded(d)),
      window.kycliusVoice.on('error',     e => voiceStore.setError(e)),
    ];
    return () => unsubs.forEach(u => u());
  }, []);
  return null;
}
```

Store slice shape (`voiceStore.ts`) — the only voice state React reads:

```ts
interface VoiceStore {
  state: CanonicalVoiceState;          // HC2 vocabulary, nothing else
  detail?: SubStateRef;
  sessionId: string | null;
  partial: string | null;              // live partial transcript
  finalTranscript: string | null;
  speakingSentence: string | null;     // sentence being spoken (caption chip)
  levelIn: number; levelOut: number;   // 0..1, 30 Hz, for waveforms
  degraded: DegradedInfo | null;       // persistent, actionable (HC6)
  error: VoiceError | null;
}
```

## 2. Hooks

```ts
// useVoice — full control surface (composer, command bar, settings)
const {
  state, detail, degraded, error,
  start, stop, cancel,                 // session controls
  pauseSpeaking, resumeSpeaking, stopSpeaking,
  confirm, reject,                     // awaiting_confirmation (T5/T6)
  activeStt, activeTts,                // display names for the status line
} = useVoice();

// useListening — narrow slice for mic affordances
const { isListening, levelIn, mode, start, stop, didntCatch } = useListening();

// useSpeaking — narrow slice for output affordances
const { isSpeaking, isPaused, sentence, levelOut, pause, resume, stop } = useSpeaking();

// useTranscript — transcript stream with session staleness already applied
const { partial, final, confidence, reset } = useTranscript();
```

Rules encoded in the hooks:

- `useListening().start` never touches permission logic — it invokes the command and renders whatever main decides (granted, denied, degraded).
- High-frequency values (`levelIn/levelOut`) are exposed as refs-plus-subscription rather than state that re-renders React at 30 Hz; the waveform strip animates via a direct DOM/rAF write inside `ComposerVoiceAffordance`.
- All hook state is already session-filtered; stale-turn events never reach components.

## 3. Voice Affordance Contract (HC1 — no blob, no orb, no mascot, ever)

Kyclius removed `OrisonNatureBlob` deliberately. Voice state therefore lives **on ordinary elements the user already looks at** — primarily the message composer / command bar. The contract below is the only sanctioned way to render voice state:

| Canonical state | Composer affordance | Elsewhere |
|---|---|---|
| `idle` | Mic icon, default color, no glow | — |
| `listening` | 1.5 px accent-glow ring, calm pulse; waveform strip (input RMS) inline above the text field; live partial as placeholder text in the field | Status line: "Listening — <engine name>" |
| `thinking` | Glow shifts to shimmer (no pulse); waveform flattens; partial answer streams as a normal chat message | Status line: "Thinking…" |
| `awaiting_confirmation` | Glow pauses; inline Approve/Reject buttons on the pending message | — |
| `executing` | Glow carries a subtle progress tint; inline progress text on the pending message | — |
| `speaking` | Speaker icon on the composer animates; waveform strip switches to output RMS; click = stop (always available) | Spoken sentence shown as caption chip on the streaming message |
| `error` | Glow drops to neutral; inline error text + action button on the status line | Settings deep-link |

**Explicitly forbidden** (design review checklist item): standalone floating characters, orbs, blobs, mascots, animated "assistant avatars", ambient-scene overlays, full-screen listening visualizers. If a future proposal needs a visual that cannot fit inside an ordinary element, it is a product decision to revisit HC1 — not something this system does quietly.

## 4. Component Sketches

```tsx
function ComposerVoiceAffordance() {
  const { state, degraded, error } = useVoice();
  const { levelIn, levelOut } = useListeningLevelRefs();
  return (
    <div className={cn('composer', glowFor(state), degraded && 'composer--degraded')}>
      <WaveformStrip ref={waveformRef} source={state === 'speaking' ? 'out' : 'in'} />
      <MicButton />            {/* or Stop button while speaking */}
      <VoiceStatusLine />      {/* engine name, didn't-catch, errors, retry */}
    </div>
  );
}
```

`glowFor(state)` is a pure Tailwind class map — the only place state maps to visuals, easy to audit against the contract in review. The degraded/error affordance is persistent (not a toast) until resolved, per HC6.
