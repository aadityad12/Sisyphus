"""Thin ffmpeg/ffprobe helpers."""

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np

_WINGET_FFMPEG = (
    Path.home()
    / "AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
    / "ffmpeg-9.0.2-full_build/bin"
)


def _tool(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    candidate = _WINGET_FFMPEG / f"{name}.exe"
    if candidate.exists():
        return str(candidate)
    raise RuntimeError(f"{name} not found on PATH")


def ffmpeg() -> str:
    return _tool("ffmpeg")


def probe(path: Path) -> dict:
    """Duration (s), width, height and fps of a video."""
    out = subprocess.run(
        [_tool("ffprobe"), "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True,
        text=True,
        check=True,
    )
    info = json.loads(out.stdout)
    video = next((s for s in info["streams"] if s["codec_type"] == "video"), {})
    num, _, den = video.get("r_frame_rate", "30/1").partition("/")
    return {
        "duration": float(info["format"]["duration"]),
        "width": int(video.get("width", 0)),
        "height": int(video.get("height", 0)),
        "fps": float(num) / float(den or 1),
    }


def load_audio(path: Path, sr: int = 16000) -> np.ndarray:
    """Decode mono float32 audio. faster-whisper wants an array, not a path (its `av` call breaks here)."""
    out = subprocess.run(
        [ffmpeg(), "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True,
        check=True,
    )
    return np.frombuffer(out.stdout, dtype=np.float32).copy()


def frame_at(path: Path, t: float, out: Path, width: int = 480) -> Path:
    subprocess.run(
        [ffmpeg(), "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", str(path), "-frames:v", "1",
         "-vf", f"scale={width}:-2", str(out)],
        check=True,
    )
    return out
