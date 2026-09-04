# 05 — Audio Pipeline

## 1. Overview and Data Flow

The Audio Layer is independent of React (it never imports renderer code) and independent of providers (STT/TTS adapters consume its outputs; playback consumes its queue). One authority per direction:

```
INPUT (capture side)
  MicManager (device + permission + lifecycle)
     └─▶ AudioCapture (native backend, per-OS)
           └─▶ 20 ms frames, 16 kHz mono PCM16
                 ├─▶ AudioProcessor ─▶ resample / NS / AGC ─▶ Vad
                 │                                            │ speech-start / level / speech-end
                 │                                            ▼
                 └─▶ UtteranceRing (in-memory, HC8) ──▶ STTEngine adapters

OUTPUT (playback side)
  TTSEngine (synth jobs, 24 kHz mono PCM16)
     └─▶ AudioQueue (bounded, ordered, gapless)
           └─▶ AudioPlayer (device routing, ducking, fade)
                 └─▶ OS audio out
```

Communication model: **push pipelines with bounded hand-offs**. Capture frames are pushed; VAD emits events; the utterance ring is pulled by the STT adapter. On the output side, synth jobs push PCM chunks into AudioQueue; AudioPlayer pulls. Every hand-off is bounded, so backpressure is always a queue signal, never an unbounded buffer.

## 2. MicManager

- **Device enumeration** (name, id, default flag) via the native backend; exposed to settings through IPC (`voice:microphone:list`).
- **Permission probe + request** (§09): request only at first arm, never at app start. `systemPreferences.askForMediaAccess('microphone')` on macOS; Windows/Linux policy varies — handled in the permission module.
- **Capture sessions:** `open({ deviceId, sampleRate: 16000, frameMs: 20 })` returns a session handle with `close()`. Only one input session is live at a time; concurrent open requests coalesce.
- **Device events:** unplugged/default-changed mid-session => session ends gracefully, state surfaces as `error` with code `MIC/DEVICE_LOST` and the ladder re-runs (STT §6).

## 3. AudioCapture

- Per-OS native backends behind one interface: WASAPI (Windows), CoreAudio (macOS), ALSA/PulseAudio (Linux). Preferred implementation: `naudiodon`/PortAudio-class binding; fallback: OS CLI tools (`sox`/`arecord`/`ffmpeg -f avfoundation`) — the interface hides which.
- Contract: 16 kHz, mono, PCM16, 20 ms frames (320 samples). Capture devices are resampled **at the edge** so every downstream component sees one canonical format.
- Capture never writes to disk; frames are handed to the processor and ring in memory (HC8).

## 4. AudioBuffer (UtteranceRing)

- Fixed-capacity ring (default 60 s per utterance, `maxUtteranceMs`) — speech longer than the cap forces finalization (STT §3).
- **Memory-only guarantee (HC8):** no file handles anywhere in the audio path; on `dispose`/session end the buffer is overwritten with zeros before release (belt-and-braces against heap preservation).
- Exposes `readRange(ms)` for the STT adapter's rolling partial decode and `readAll()` at speech-end for the final pass.

## 5. AudioProcessor

Runs per-frame on the capture thread-adjacent worker; chain order matters:

1. **Sample-rate normalization** — resample device rate -> 16 kHz at the edge (capture contract).
2. **Noise suppression** — RNNoise-class model (onnxruntime-node, same runtime as VAD) with a bypass toggle; measurable win for whisper accuracy in noisy rooms.
3. **Automatic gain control** — target RMS −23 dBFS, clamp +12 dB boost max; keeps VAD threshold meaningful across mics.
4. **Level tap** — emits RMS 0..1 at 30 Hz to the engine event bus; this is what drives the renderer waveform (the renderer sees levels, not audio — ADR-002).

## 6. VAD

- **Primary: silero-vad v5** via onnxruntime-node in main (ADR-003): ~30 ms frames, probability stream, hysteresis on entry/exit probabilities.
- **Fallback: energy gate** (RMS + adaptive noise floor) — always warm, used while the ONNX runtime loads and if it fails, so VAD is never a single point of failure for the degraded ladder.
- Emits: `speech_start`, `speech_end`, `level`, `speech_probability` (for debugging UI in settings).

## 7. AudioQueue + AudioPlayer

- **AudioQueue** (owned with TTS §5): bounded PCM job queue; ordering by sentenceId; 15 ms crossfades; drains to the player.
- **AudioPlayer**: WASAPI/CoreAudio/ALSA output; sample-rate 24 kHz canonical; `play(job)`, `pause/resume`, `stop(fadeMs)`, `setDevice(id)`, `duck(db)`.
- Device-lost mid-playback => graceful switch to new default + notice event; playback never hard-fails on device churn.

## 8. Communication Summary

| Link | Mechanism | Bounded by |
|---|---|---|
| Capture -> Processor -> VAD | push frames | frame size (20 ms) |
| VAD -> Engine | events | — |
| Ring -> STT adapter | pull reads | ring capacity |
| TTS -> Queue | push PCM chunks | queue capacity (8 jobs / 60 s) |
| Queue -> Player | pull | — |
| Engine -> Renderer | IPC events | rate-limited (level 30 Hz, partials coalesced 150 ms) |

## 9. Persistence Guarantee (HC8)

There is no code path in this layer that can write audio: no `fs` import in `voice/audio/**` (lint-enforced), no IPC surface accepts audio payloads from the renderer, and the host protocol carries frames over localhost sockets only. The only artifacts ever persisted are transcript rows (§09).
