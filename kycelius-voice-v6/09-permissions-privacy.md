# 09 — Permissions and Privacy

## 1. Principles

1. **Ask only when needed.** No permission prompt at app start, no prompt on settings pages. The mic permission is requested at the first `voice:startListening` invocation (T1) — the moment the user expresses intent to speak.
2. **Local by default.** With zero configuration, no audio ever leaves the machine and no account/key exists.
3. **Text-only persistence.** Raw audio is never written to disk anywhere in the system (HC8), local or cloud.
4. **User-visible and user-removable.** Everything the system remembers is visible in-app and deletable.

## 2. Permission Matrix

| Resource | When requested | How | Denial behavior |
|---|---|---|---|
| Microphone | First arm of listening; re-request via settings | macOS `systemPreferences.askForMediaAccess`; Windows: privacy settings deep-link; Linux: documentation | `MIC/PERMISSION_DENIED` inline on composer + retry affordance; typed input unaffected |
| Output audio device | Never — no permission model on any supported OS | — | — |
| Cloud STT/TTS endpoints | Never auto; used only if the user created + enabled a `custom.cloud.*` row | — | Network/auth errors ladder to local (HC6) |

Renderer-side media permission requests are mechanically denied (06 §5.2) — the only mic path is main-process capture.

## 3. Local-Only Processing Mode

A single global setting: **"Process voice locally only."** (default: ON until the user enables a cloud row; flipping the toggle off merely *permits* cloud rows to run — the user still must create one.)

When ON:
- `ProviderResolver` ignores `custom.cloud.*` rows entirely (they render as "skipped — local-only mode" in settings).
- The settings copy states exactly what local means: audio stays in RAM, models run on-device, nothing is uploaded.
- The status line marks the active engine with a local/cloud badge at all times, so the user can verify claims without trusting them.

## 4. Data Lifecycle

| Artifact | Where it lives | Lifetime | Removable by user |
|---|---|---|---|
| Raw audio (mic + synthesized) | RAM only | Duration of utterance / synth job | N/A (never persisted) |
| Partial transcripts | RAM (session) | Session lifetime | Dies with session |
| Final transcripts | DB transcript rows (existing app storage) | Until deleted | Per-item delete + "delete all voice history" |
| AI responses | Existing chat storage | Existing app policy | Existing app deletion |
| Provider API keys | `providers.api_key` (encrypted, existing scheme) | Until removed | Row delete |
| Model binaries (faster-whisper, Kokoro) | Disk cache, app-managed | Until removed | "Remove local models" button |

**Cloud egress contract (HC8 applied to cloud):** for `custom.cloud.stt`, the utterance is encoded to WAV in memory, sent over TLS, and the buffer is zeroed after the response; only the returned text is stored. For `custom.cloud.tts`, only the sentence text is sent; returned audio is queued, played, and freed — never written. The settings page for a cloud row shows a one-line, honest note: the provider may retain data per its own policy; Kyclius retains only the transcript.

## 5. Settings Surface

- Voice providers section (rows: enable/disable, set default, edit schema fields, test/probe button with result).
- Devices: microphone + output pickers with live level meters.
- Language, VAD/endpoint tuning, confidence floor.
- Privacy: local-only toggle, voice history list with delete controls, "remove local models".
- Diagnostics: ladder view per capability, host health, last errors with codes.
