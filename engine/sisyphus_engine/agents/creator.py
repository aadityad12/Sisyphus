"""Creator: makes and edits short-form videos from raw footage plus a brief.

How it edits is still open (see VISION.md, "Open: how the Creator edits").
"""

from pathlib import Path

from . import load_skills


def create(footage: Path, brief: str) -> Path:
    """Produce a short-form video and return its path."""
    skills = load_skills("creator")
    raise NotImplementedError("Creator not built yet")
