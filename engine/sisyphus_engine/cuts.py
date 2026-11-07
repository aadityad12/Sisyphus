"""What the Creator kept and what it cut: the source transcript around each segment of a plan.

The view is built from the cut points the renderer used: the plan's rendered_segments, stored at
render time, or for videos rendered before that field existed, the segments as `render.timeline`
snaps them today. Words count as kept by `render.plays`, the renderer's own rule, so the words
marked kept are the words the video plays.
"""

import json

from . import FOOTAGE_DIR
from .plan import EditPlan, Segment
from .render import plays, timeline
from .transcribe import _cache_path
from .transcribe import words as all_words

CONTEXT_S = 30.0  # seconds of source shown on each side of a kept segment


def build(plan: EditPlan, transcript: dict, context: float = CONTEXT_S, rendered: list[Segment] | None = None) -> dict:
    """One block per kept segment, in play order, each holding the source words within `context`
    seconds of it. A word's `segment` is the index of the segment that plays it (this block's or
    another's), or None if no segment does; `kept` is whether any segment does. `rendered` is
    the cut points the video was rendered with; without it they are snapped from the plan.
    """
    words = all_words(transcript)
    segs = rendered or timeline(plan, words)[0]
    blocks = []
    for i, seg in enumerate(segs):
        lo, hi = seg.start - context, seg.end + context
        out = []
        for w in words:
            if w["end"] <= lo or w["start"] >= hi:
                continue
            owner = i if plays(w, seg) else next((j for j, s in enumerate(segs) if plays(w, s)), None)
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
    rendered = [Segment.model_validate(s) for s in video["plan"].get("rendered_segments") or []]
    return build(plan, json.loads(cache.read_text(encoding="utf-8")), context, rendered or None)
