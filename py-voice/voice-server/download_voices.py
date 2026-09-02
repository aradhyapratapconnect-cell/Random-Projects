"""
One-time downloader for an offline Piper voice.

Usage:  python download_voices.py [VOICE_NAME]
        (default VOICE_NAME = en_US-lessac-medium, ~63 MB)

Browse voices at: https://huggingface.co/rhasspy/piper-voices/tree/main/v1
"""
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/{parts}/{voice}.onnx{suffix}?download=true"
VOICES_ROOT = Path(__file__).parent / "models" / "voices"


def parts_for(name: str) -> str:
    lang, speaker, quality = name.rsplit("-", 2)
    language_code, _region = lang.split("_", 1)
    return f"{language_code}/{lang}/{speaker}/{quality}"


def download(url: str, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url.split(chr(63))[0]} -> {dest}")
    urllib.request.urlretrieve(url, dest)


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "en_US-lessac-medium"
    parts = parts_for(name)
    voice_dir = VOICES_ROOT / name
    jobs = [
        (BASE.format(parts=parts, voice=name, suffix=""), voice_dir / f"{name}.onnx"),
        (BASE.format(parts=parts, voice=name, suffix=".json"), voice_dir / f"{name}.onnx.json"),
    ]
    with ThreadPoolExecutor(max_workers=2) as ex:
        for f in ex.map(lambda j: download(*j), jobs):
            print(f"Done: {f}")
    print("Voice installed. Restart the server and TTS will run fully offline.")


if __name__ == "__main__":
    main()

