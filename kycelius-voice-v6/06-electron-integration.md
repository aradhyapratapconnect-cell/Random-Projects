# 06 — Electron Integration

## 1. Process Responsibilities

| Process | Responsibilities | Forbidden |
|---|---|---|
| **Main** | Voice Engine (manager, state machine, sessions, STT/TTS, audio); host supervision; provider resolution; persistence (transcripts only); permission requests; LLM bridging | — (this is the authority) |
| **Preload** | Expose the narrow `window.kycliusVoice` API via `contextBridge`; typed channel allowlist; no logic | Reaching beyond its allowlist; exposing `ipcRenderer` raw |
| **Renderer** | React UI; voice hooks; rendering state/transcripts/levels; invoking commands | Audio processing, device access, file/process access, raw IPC (HC7) |
| **Engine Host (sidecar)** | Model inference (faster-whisper, Kokoro) over the Host Protocol | Touching the renderer, the DB, or the network beyond configured cloud calls made **by main on behalf of providers** — actually the host does not make cloud calls at all; cloud adapters live in main |

## 2. IPC Commands (renderer -> main, `ipcRenderer.invoke`)

All channels are namespaced `voice:` and validated (zod) in main before any engine call.

| Channel | Payload | Returns | Notes |
|---|---|---|---|
| `voice:getState` | — | `{ state, detail?, activeStt, activeTts, degraded? }` | Bootstrap/reconnect |
| `voice:startListening` | `{ mode: 'ptt' | 'handsFree' }` | `{ sessionId }` | Triggers permission flow if needed (§09) |
| `voice:stopListening` | `{ sessionId }` | `void` | |
| `voice:sendTranscript` | `{ sessionId }` | `void` | PTT release equivalent of T2 |
| `voice:cancelSession` | `{ sessionId }` | `void` | Stop/interrupt from UI |
| `voice:speak` | `{ text, opts? }` | `{ sessionId }` | Speak arbitrary text (e.g. replay) |
| `voice:speakControl` | `{ action: 'pause' | 'resume' | 'stop' }` | `void` | Transport (04 §6) |
| `voice:confirmAction` | `{ sessionId, approved: boolean }` | `void` | T5/T6 |
| `voice:getMicrophones` / `voice:setMicrophone` | `{ deviceId? }` | `{ devices }` / `void` | MicManager |
| `voice:getOutputs` / `voice:setOutput` | `{ deviceId? }` | `{ devices }` / `void` | AudioPlayer |
| `voice:getProviders` / `voice:setProviderEnabled` / `voice:setDefaultProvider` | row-scoped | rows/settings | Thin wrappers over the existing providers-table service |
| `voice:health` | — | `{ stt, tts, host }` | Settings diagnostics page |
| `voice:deleteTranscript` | `{ transcriptId }` | `void` | §09 right-to-removal |

## 3. IPC Events (main -> renderer, `webContents.send`)

All events funnel through one typed bus; the renderer store subscribes once (`VoiceProvider`) and distributes via React context/zustand.

| Channel | Payload | Consumer |
|---|---|---|
| `voice:state` | `{ state, detail?, sessionId }` | State machine UI (HC2 vocabulary only) |
| `voice:partial` | `{ sessionId, text }` | Transcript chip (coalesced ≤150 ms) |
| `voice:final` | `{ sessionId, text, confidence? }` | Composer fill / chat message |
| `voice:level` | `{ direction: 'in'|'out', rms }` | Waveform strip (30 Hz) |
| `voice:speaking` | `{ sessionId, sentenceId, sentence }` | Speaker icon + live caption chip |
| `voice:queue` | `{ depth, durationMs }` | Queue affordance (optional) |
| `voice:provider` | `{ capability, from, to, reason? }` | Status line |
| `voice:degraded` | `{ capability, code, message, actions[] }` | Persistent composer affordance (HC6) |
| `voice:error` | `{ sessionId?, code, message, recoverable, actions[] }` | Error affordance |
| `voice:permission` | `{ kind, status }` | Settings + inline prompts |
| `voice:confirmation` | `{ sessionId, proposal }` | Inline confirm UI (T4) |
| `voice:modelProgress` | `{ capability, status, progress? }` | First-use model download UI |

Rules: events never carry audio buffers; every event carries `sessionId` where one exists so the renderer can drop stale turns the same way main does.

## 4. Preload Bridge (the only door)

```ts
// src/preload/voiceBridge.ts — allowlisted, validated, minimal
contextBridge.exposeInMainWorld('kycliusVoice', {
  getState:      () => invoke('voice:getState'),
  startListening: (mode: VoiceMode) => invoke('voice:startListening', { mode }),
  stopListening: (sessionId: string) => invoke('voice:stopListening', { sessionId }),
  speak:         (text: string, opts?: SpeakOpts) => invoke('voice:speak', { text, opts }),
  speakControl:  (action: SpeakControl) => invoke('voice:speakControl', { action }),
  confirmAction: (sessionId: string, approved: boolean) =>
                   invoke('voice:confirmAction', { sessionId, approved }),
  cancelSession: (sessionId: string) => invoke('voice:cancelSession', { sessionId }),
  devices: { microphones: ..., outputs: ... },
  on: (event: VoiceEventName, cb: (p: VoiceEventPayload) => void) => { /* subscribe */ },
});
```

- Explicit allowlist — no dynamic channel names, no pass-through invoker, `ipcRenderer` itself is never exposed.
- Every payload is schema-validated in **main** (the bridge is a convenience, not a trust boundary).
- The full TypeScript surface lives in `voice/types/events.ts` and is shared with the renderer — one source of truth, drift caught at compile time.

## 5. Security Boundaries (HC7)

1. `contextIsolation: true`, `sandbox: true` (renderer), `nodeIntegration: false` — non-negotiable, verified by a CI check against the BrowserWindow config.
2. Renderer has **no microphone permission path at all**: `session.setPermissionRequestHandler` **denies** `media` requests from the renderer; capture exists only in main. This makes HC7 mechanically enforced rather than stylistic.
3. Channel allowlist + zod validation on every command; unknown channels rejected and logged.
4. Engine Host: localhost-only bind, random port, per-launch bearer token, token never leaves main (renderer never talks to the host directly).
5. API keys decrypt only in main; encrypted bytes never appear in IPC payloads or renderer state; settings UI shows masked keys.
6. CSP for the renderer forbids remote code; all voice UI is local. Cloud adapters perform their own fetches in main with pinned TLS defaults.
7. Audio (HC8) never crosses the renderer bridge in either direction — see `05` §9.
