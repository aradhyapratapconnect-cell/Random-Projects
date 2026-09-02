"""
Pentrons Voice Server
=====================
Local STT (speech-to-text) + TTS (text-to-speech) microservice for the
Electron/React assistant. Run once in a terminal; the app talks to it over HTTP.

Endpoints
---------
GET  /health        -> status + loaded engines
POST /stt           -> multipart audio file ("file") | JSON {"text", "language"}
POST /tts           -> JSON {"text", "rate"?} | audio/wav (or audio/mp3 fallback)
WS   /ws/stt        -> stream mic audio; send binary chunks, receive transcripts

Environment variables
---------------------
VOICE_STT_MODEL     whisper size: tiny|base|small|medium (default: small)
VOICE_TTS_MODEL     optional path to a Piper voice folder
VOICE_MODELS_DIR    where models are stored (default: ./models)
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

import engines

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("voice-server")

MAX_STREAM_SECONDS = 15  # safety cap for one WS utterance


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm the TTS engine at boot (STT stays lazy - it is the heavy one).
    try:
        engines.get_tts()
    except Exception:
        log.exception("TTS engine unavailable at startup; /tts will fail.")
    yield


app = FastAPI(title="Pentrons Voice Server", version="1.0.0", lifespan=lifespan)

# The Electron app may be served from file:// or http://localhost:* - allow all.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TTSRequest(BaseModel):
    text: str
    rate: float = 1.0  # 1.0 = normal speed, 1.5 = faster, 0.8 = slower


class STTResponse(BaseModel):
    text: str
    language: str | None = None
    probability: float | None = None  # language-detection confidence
    confidence: float | None = None   # transcription confidence (0..1)


@app.get("/")
async def root():
    return {
        "service": "Pentrons Voice Server",
        "status": "running",
        "endpoints": {
            "GET /health": "server + engine status",
            "POST /stt": "multipart audio file -> {text, language}",
            "POST /tts": "JSON {text, rate} -> audio/wav",
            "WS /ws/stt": "stream mic audio, receive transcripts",
        },
        "docs": "/docs",
    }


@app.get("/test")
async def test_page():
    """Interactive browser test page (mic + speakers) at http://127.0.0.1:8756/test"""
    return FileResponse(Path(__file__).parent / "test.html")


@app.get("/health")
async def health():
    return {"status": "ok",
            "stt_loaded": engines._transcriber is not None,
            "stt_model": os.getenv("VOICE_STT_MODEL", "small"),
            "tts": engines.get_tts().name}


@app.post("/stt", response_model=STTResponse)
async def stt(file: UploadFile = File(...), language: str | None = None):
    """Transcribe an uploaded audio file (wav/webm/mp3/ogg/m4a...)."""
    data = await file.read()
    text, info = await asyncio.to_thread(
        engines.get_transcriber().transcribe_bytes, data, language
    )
    return STTResponse(text=text, language=info.get("language"),
                       probability=info.get("probability"),
                       confidence=info.get("confidence"))


@app.post("/tts")
async def tts(req: TTSRequest):
    """Convert text to speech. Returns audio/wav (Piper) or audio/mp3 (edge fallback)."""
    synth = engines.get_tts()
    audio = await asyncio.to_thread(synth.synthesize_bytes, req.text, max(req.rate, 0.1))
    media = "audio/wav" if isinstance(synth, engines.PiperSynthesizer) else "audio/mp3"
    return Response(content=audio, media_type=media)


@app.websocket("/ws/stt")
async def ws_stt(ws: WebSocket):
    """
    Streaming STT. Protocol:
      - client -> server: binary frames (any container the browser produces,
        e.g. webm/opus from MediaRecorder) or JSON text frames
      - client -> server JSON {"action": "flush"} -> server transcribes what
        it has buffered so far and clears it
      - server -> client JSON {"type": "transcript", "text": "..."} or {"type": "error", ...}
    Binary frames are also auto-flushed when > MAX_STREAM_SECONDS of audio
    accumulates (approximated by byte count).
    """
    await ws.accept()
    log.info("WebSocket STT client connected.")
    buffer = bytearray()
    transcriber = engines.get_transcriber()

    async def flush():
        if not buffer:
            return
        data = bytes(buffer)
        buffer.clear()
        try:
            text, info = await asyncio.to_thread(transcriber.transcribe_bytes, data)
            await ws.send_json({"type": "transcript", "text": text,
                                "language": info.get("language"),
                                "confidence": info.get("confidence")})
        except Exception as e:
            log.exception("WS transcription failed")
            await ws.send_json({"type": "error", "message": str(e)})

    try:
        while True:
            msg = await ws.receive()
            if msg.get("bytes") is not None:
                buffer.extend(msg["bytes"])
                # ~32 kB/s for webm/opus -> flush past the safety cap
                if len(buffer) > 32_000 * MAX_STREAM_SECONDS:
                    await flush()
            elif msg.get("text") is not None:
                try:
                    action = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                if action.get("action") == "flush":
                    await flush()
                elif action.get("action") == "reset":
                    buffer.clear()
                    await ws.send_json({"type": "reset"})
            elif msg.get("type") == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        pass
    finally:
        log.info("WebSocket STT client disconnected.")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(__import__("os").getenv("PORT", "8756")))
