"""Find the speaker's face in a stretch of footage, so a crop can be centred and sized on it.

Added 2026-11-07 after the Creator, placing crop_x from four small stills, kept missing the speaker:
off by ~150 px on a talk's speaker inset, and on the empty chair in a two-shot. OpenCV's Haar detector
is crude but finds both a full-frame face and a ~60 px inset on 1280x720 frames.
"""

import re
import subprocess
from functools import lru_cache
from pathlib import Path
from statistics import median

import cv2
import numpy as np

from .media import ffmpeg

W, H = 1280, 720  # detection frame size; results are fractions of the frame
_detector = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")


def _gray_frame(footage: Path, t: float) -> np.ndarray | None:
    raw = subprocess.run(
        [ffmpeg(), "-v", "error", "-ss", f"{t:.2f}", "-i", str(footage), "-frames:v", "1",
         "-vf", f"scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True,
    ).stdout
    if len(raw) != W * H:
        return None
    return np.frombuffer(raw, np.uint8).reshape(H, W)


@lru_cache(maxsize=512)
def locate(footage: Path, start: float, end: float, samples: int = 4) -> tuple[float, float, float] | None:
    """The main face in [start, end]: (centre x, centre y, height), each a fraction of the frame, or None."""
    found = []
    for k in range(samples):
        img = _gray_frame(footage, start + (end - start) * (k + 0.5) / samples)
        if img is None:
            continue
        faces = _detector.detectMultiScale(img, scaleFactor=1.1, minNeighbors=5, minSize=(18, 18))
        if len(faces):
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])  # the largest face is the speaker, usually
            found.append(((x + w / 2) / W, (y + h / 2) / H, h / H))
    if not found:
        return None
    return tuple(median(v[i] for v in found) for i in range(3))


def crop_on_face(face: tuple[float, float, float], src_w: int, src_h: int, out_w: int, out_h: int,
                 face_share: float) -> tuple[int, int, int, int]:
    """A crop (w, h, x, y) in source pixels with the output's aspect ratio, sized so the face is about
    `face_share` of its height (zoom limited to 1-4x), the face centred across and a little above the middle."""
    cx, cy, fh = face
    crop_h = min(src_h, max(src_h / 4, fh * src_h / face_share))
    crop_w = min(src_w, crop_h * out_w / out_h)
    crop_h = crop_w * out_h / out_w if crop_w < crop_h * out_w / out_h else crop_h
    x = min(max(cx * src_w - crop_w / 2, 0), src_w - crop_w)
    y = min(max(cy * src_h - 0.4 * crop_h, 0), src_h - crop_h)
    even = lambda v: int(v) // 2 * 2  # noqa: E731 - x264 wants even sizes
    return even(crop_w), even(crop_h), even(x), even(y)


@lru_cache(maxsize=512)
def shots(footage: Path, start: float, end: float, threshold: float = 0.2, min_len: float = 0.5) -> list[tuple[float, float]]:
    """Camera shots in [start, end] as (from, to) seconds relative to start, split at scene changes.
    Shots shorter than min_len are merged into the one before."""
    out = subprocess.run(
        [ffmpeg(), "-hide_banner", "-ss", f"{start:.2f}", "-t", f"{end - start:.2f}", "-i", str(footage), "-an",
         "-vf", f"scale=320:-2,select=gt(scene\\,{threshold}),showinfo", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    ).stderr
    cuts = [float(t) for t in re.findall(r"pts_time:([\d.]+)", out)]
    bounds = [0.0]
    for c in cuts:
        if c - bounds[-1] >= min_len and (end - start) - c >= min_len:
            bounds.append(c)
    bounds.append(end - start)
    return list(zip(bounds[:-1], bounds[1:]))
