"""
Voice engines: STT (faster-whisper) and TTS (Piper, with edge-tts fallback).

The server lazily loads models on first use so startup stays fast.
"""
import asyncio
import io
import logging
import math
import os
import wave
from pathlib import Path

log = logging.getLogger("voice-server")

MODELS_DIR = Path(os.getenv("VOICE_MODELS_DIR", Path(__file__).parent / "models"))

# --------------------------------------------------------------------------
# STT
# --------------------------------------------------------------------------
class Transcriber:
    """Speech-to-text using faster-whisper (CTranslate2, CPU friendly)."""

    def __init__(self, model_size: str = "base", device: str = "cpu",
                 compute_type: str = "int8"):
        from faster_whisper import WhisperModel

        # More CPU threads = faster transcription on multi-core machines.
        self.cpu_threads = int(os.getenv("VOICE_CPU_THREADS", "4"))
        log.info("Loading STT model '%s' (cpu_threads=%d, this happens once)...",
                 model_size, self.cpu_threads)
        self.model = WhisperModel(model_size, device=device,
                                  compute_type=compute_type, cpu_threads=self.cpu_threads,
                                  download_root=str(MODELS_DIR))
        self.name = model_size
        log.info("STT model loaded.")

    def transcribe_bytes(self, data: bytes, language: str | None = None):
        """Transcribe raw audio bytes (wav/webm/mp3/... - decoded via PyAV).

        Returns (text, info) where info includes:
          language      - detected language code
          probability   - confidence of the language detection
          confidence    - token-weighted transcription confidence (0..1),
                          derived from average token log-probabilities
        """
        # beam_size=1 (greedy) is ~2-4x faster than beam search with barely
        # any accuracy loss for short voice-assistant phrases. Set
        # VOICE_STT_BEAM=5 if you prefer maximum accuracy over speed.
        beam_size = int(os.getenv("VOICE_STT_BEAM", "1"))
        segments, info = self.model.transcribe(
            io.BytesIO(data),
            language=language,
            vad_filter=True,               # skip silence automatically
            beam_size=beam_size,
            best_of=beam_size,
            condition_on_previous_text=False,  # avoid error-propagation between segments
        )
        texts = []
        logprob_tokens = []  # (avg_logprob, n_tokens) per segment
        for seg in segments:
            t = seg.text.strip()
            if not t:
                continue
            texts.append(t)
            try:
                logprob_tokens.append((seg.avg_logprob, max(len(seg.tokens), 1)))
            except AttributeError:
                pass
        text = " ".join(texts)
        if logprob_tokens:
            total = sum(n for _, n in logprob_tokens)
            confidence = math.exp(sum(lp * n for lp, n in logprob_tokens) / total)
        else:
            confidence = 0.0
        return text, {"language": info.language,
                      "probability": info.language_probability,
                      "confidence": round(confidence, 4)}


# --------------------------------------------------------------------------
# TTS
# --------------------------------------------------------------------------
class PiperSynthesizer:
    """Offline text-to-speech using Piper (ONNX)."""

    def __init__(self, voice_dir: Path):
        try:
            from piper import PiperVoice  # type: ignore
        except ImportError as e:
            raise RuntimeError("piper-tts is not installed") from e

        onnx = next(voice_dir.glob("*.onnx"))
        self.voice = PiperVoice.load(str(onnx))
        self.sample_rate = self.voice.config.sample_rate
        self.name = voice_dir.name
        log.info("Loaded Piper voice '%s' (%d Hz).", self.name, self.sample_rate)

    def synthesize_bytes(self, text: str, length_scale: float = 1.0) -> bytes:
        """Return a complete WAV file as bytes."""
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)  # 16-bit
            wav.setframerate(self.sample_rate)
            # piper >= 1.3 exposes synthesize_wav(Wave_write); older exposes
            # synthesize(text, wav_file). Support both.
            if hasattr(self.voice, "synthesize_wav"):
                from piper import SynthesisConfig  # type: ignore
                cfg = SynthesisConfig(length_scale=length_scale)
                self.voice.synthesize_wav(text, wav, syn_config=cfg)
            else:
                self.voice.synthesize(text, wav)
        return buf.getvalue()


class EdgeSynthesizer:
    """Online fallback TTS (Microsoft Edge voices). Requires internet."""

    def __init__(self, voice: str = "en-US-AriaNeural"):
        self.voice = voice
        self.name = f"edge:{voice}"
        self.sample_rate = 24000

    def synthesize_bytes(self, text: str, length_scale: float = 1.0) -> bytes:
        import edge_tts  # type: ignore

        async def run() -> bytes:
            communicate = edge_tts.Communicate(text, self.voice, rate=f"{int((1/length_scale - 1) * 100):+d}%")
            chunks = []
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    chunks.append(chunk["data"])
            return b"".join(chunks)

        # edge-tts returns MP3; wrap in a thread so FastAPI stays responsive.
        return asyncio.run(run()) if False else _run_sync(run())


def _run_sync(coro):
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        return ex.submit(asyncio.run, coro).result()


def get_synthesizer():
    """Pick the best available TTS engine: Piper (offline) > edge-tts (online)."""
    voice_dir_env = os.getenv("VOICE_TTS_MODEL")
    candidates = []
    if voice_dir_env:
        candidates.append(Path(voice_dir_env))
    voices_root = MODELS_DIR / "voices"
    if voices_root.exists():
        candidates.extend(sorted(voices_root.iterdir()))

    for cand in candidates:
        if cand.is_dir() and any(cand.glob("*.onnx")):
            try:
                return PiperSynthesizer(cand)
            except Exception:
                log.exception("Failed to load Piper voice at %s", cand)

    try:
        synth = EdgeSynthesizer()
        log.warning("No local Piper voice found - using online edge-tts fallback. "
                    "Run download_voices.py for offline TTS.")
        return synth
    except Exception as e:  # pragma: no cover
        raise RuntimeError("No TTS engine available. Install piper-tts or edge-tts.") from e


# --------------------------------------------------------------------------
# Lazy singletons
# --------------------------------------------------------------------------
_transcriber = None
_synthesizer = None


def get_transcriber() -> Transcriber:
    global _transcriber
    if _transcriber is None:
        _transcriber = Transcriber(os.getenv("VOICE_STT_MODEL", "base"))
    return _transcriber


def get_tts():
    global _synthesizer
    if _synthesizer is None:
        _synthesizer = get_synthesizer()
    return _synthesizer
