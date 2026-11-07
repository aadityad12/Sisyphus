"""Word-level transcripts with faster-whisper, cached per footage file."""

import hashlib
import json
import logging
import threading
from pathlib import Path

from . import RUNS_DIR
from .media import load_audio

log = logging.getLogger(__name__)
_model = None
_lock = threading.Lock()
MODEL_SIZE = "small.en"


def _load_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        try:
            _model = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")
            log.info("whisper on cuda")
        except Exception as exc:  # no usable CUDA/cuDNN: fall back to CPU
            log.warning("whisper cuda unavailable (%s), using cpu", exc)
            _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
    return _model


def _cache_path(footage: Path) -> Path:
    stat = footage.stat()
    key = hashlib.sha1(f"{footage.resolve()}|{stat.st_size}|{stat.st_mtime_ns}".encode()).hexdigest()[:16]
    return RUNS_DIR / "transcripts" / f"{footage.stem}-{key}.json"


def transcribe(footage: Path) -> dict:
    """Return {"segments": [{start, end, text, words: [{start, end, word}]}]}."""
    cache = _cache_path(footage)
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    with _lock:
        if cache.exists():
            return json.loads(cache.read_text(encoding="utf-8"))
        audio = load_audio(footage)
        model = _load_model()
        try:
            segments, _ = model.transcribe(audio, word_timestamps=True, vad_filter=True)
            segments = list(segments)
        except RuntimeError as exc:
            # CUDA can load but still fail at first use (missing cuDNN/cuBLAS DLLs).
            if "cu" not in str(exc).lower():
                raise
            global _model
            from faster_whisper import WhisperModel

            log.warning("whisper cuda failed at runtime (%s), using cpu", exc)
            _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
            segments = list(_model.transcribe(audio, word_timestamps=True, vad_filter=True)[0])
        result = {
            "segments": [
                {
                    "start": round(s.start, 2),
                    "end": round(s.end, 2),
                    "text": s.text.strip(),
                    "words": [
                        {"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip()}
                        for w in (s.words or [])
                    ],
                }
                for s in segments
            ]
        }
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(result), encoding="utf-8")
        return result


def words(transcript: dict) -> list[dict]:
    return [w for s in transcript["segments"] for w in s["words"]]


def as_prompt_text(transcript: dict) -> str:
    """Timestamped lines for the Creator's prompt: `[12.34-15.80] text`."""
    return "\n".join(f"[{s['start']:.2f}-{s['end']:.2f}] {s['text']}" for s in transcript["segments"])
