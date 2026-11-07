"""What the Creator kept and what it cut: the source transcript around each segment of a plan.

The view is built from the segments as `render.timeline` snaps them, not the raw plan, so the
words it marks as kept are the words the rendered video actually plays.
"""

from . import FOOTAGE_DIR
from .plan import EditPlan, Segment
from .render import timeline
from .transcribe import transcribe
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
        "hook": plan.hook,
        "context_s": context,
        "kept_s": round(sum(s.end - s.start for s in segs), 2),
        "reordered": starts != sorted(starts),  # the Creator may play source out of order on purpose
        "segments": blocks,
    }


def for_video(video: dict, context: float = CONTEXT_S) -> dict:
    """The view for a stored video (store.get_video). Raises FileNotFoundError if its footage is gone."""
    plan = EditPlan.model_validate(video["plan"])
    return build(plan, transcribe(FOOTAGE_DIR / video["footage"]), context)
