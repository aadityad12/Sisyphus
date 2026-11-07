"""Reviewer: decides whether a Creator video is good enough, or sends it back."""

from dataclasses import dataclass
from pathlib import Path

from . import load_skills


@dataclass
class Review:
    approved: bool
    reason: str


def review(video: Path, brief: str) -> Review:
    skills = load_skills("reviewer")
    raise NotImplementedError("Reviewer not built yet")
