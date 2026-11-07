"""What the Creator kept and what it cut: the source transcript around each segment of a plan.

The view is built from the segments as `render.timeline` snaps them, not the raw plan, so the
words it marks as kept are the words the rendered video actually plays.
"""

import json

from . import FOOTAGE_DIR
from .plan import EditPlan, Segment
from .render import timeline
from .transcribe import _cache_path
from .transcribe import words as all_words

CONTEXT_S = 30.0  # seconds of source shown on each side of a kept segment


def _inside(w: dict, seg: Segment) -> bool:
    # The same rule render.timeline uses to decide which words a segment plays.
    return w["start"] >= seg.start and w["end"] <= seg.end


def build(plan: EditPlan, transcript: dict, context: float = CONTEXT_S) -> dict:
    """One block per kept segment, in play order, each holding the source words within `context`
    seconds of it. A word's `segment` is the index of the segment that plays it (this block's or
    another's), or None if no segment does; `kept` is whether any segment does.
    """
    words = all_words(transcript)
    segs, _ = timeline(plan, words)
    blocks = []
    for i, seg in enumerate(segs):
        lo, hi = seg.start - context, seg.end + context
        out = []
        for w in words:
            if w["end"] <= lo or w["start"] >= hi:
                continue
            owner = i if _inside(w, seg) else next((j for j, s in enumerate(segs) if _inside(w, s)), None)
            out.append({"word": w["word"], "start": w["start"], "end": w["end"], "kept": owner is not None, "segment": owner})
        blocks.append({"index": i, "start": round(seg.start, 2), "end": round(seg.end, 2), "words": out})
    starts = [s.start for s in segs]
    return {
        "title": plan.title,
        "hook": plan.hook.strip(),  # the renderer draws no hook when it is only whitespace
        "context_s": context,
        "kept_s": round(sum(s.end - s.start for s in segs), 2),
        "reordered": starts != sorted(starts),  # the Creator may play source out of order on purpose
        "segments": blocks,
    }


class NotCached(LookupError):
    """The footage has no cached transcript, so showing the view would mean running Whisper."""


def for_video(video: dict, context: float = CONTEXT_S) -> dict:
    """The view for a stored video (store.get_video), from the cached transcript only.

    It never transcribes: a cache miss inside a GET would run Whisper for minutes while holding
    transcribe's lock, stalling the Creator's jobs. Raises FileNotFoundError if the footage is
    gone and NotCached if it has no transcript.
    """
    plan = EditPlan.model_validate(video["plan"])
    cache = _cache_path(FOOTAGE_DIR / video["footage"])  # stats the footage: FileNotFoundError if gone
    if not cache.exists():
        raise NotCached(video["footage"])
    return build(plan, json.loads(cache.read_text(encoding="utf-8")), context)
