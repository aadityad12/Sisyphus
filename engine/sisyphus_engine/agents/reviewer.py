"""Reviewer: decides whether a Creator video is good enough, or sends it back.

It watches the rendered MP4 (sent inline to the model), sees a strip of stills taken from it, and reads
what is said in the clip on the output timeline plus the Creator's edit plan. Its standards are its
skill files in `skills/reviewer/`, which the Auditor improves.

With `ref`, it reviews with its skills as they were at that Git ref. A shadow A/B of a Creator change
passes the Reviewer's ref from the start of the experiment, so the judge stays frozen while it runs.
"""

import base64
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

from openai import BadRequestError

from .. import llm
from ..media import frame_at, probe
from ..plan import EditPlan
from .. import styles as style_lib
from ..render import timeline
from ..transcribe import words as all_words
from . import load_skills

log = logging.getLogger(__name__)

# Failure tags the Reviewer may attach. The Auditor clusters failures on these and on the reason.
TAGS = ("hook", "pacing", "framing", "captions", "audio", "off_brief", "length", "ending", "off_style")

# Send the MP4 itself (the model sees cuts, audio and caption timing), plus stills. Inline limit is 50 MB.
SEND_VIDEO = os.environ.get("SISYPHUS_REVIEWER_VIDEO", "1") != "0"
MAX_INLINE_VIDEO = 45 * 1024 * 1024
N_FRAMES = 6

SYSTEM = """You are the Reviewer in SIsyphus, a self-improving video editing system. A Creator agent cuts a \
long talk or podcast into one vertical (9:16) short-form clip that answers a one-line brief. You decide \
whether the clip is good enough to show to people, or send it back to the Creator.

You are given the clip itself when possible, stills sampled from it with their timestamps, what is said \
in the clip with timestamps on the clip's own timeline, and the Creator's edit plan (which source ranges it \
kept, its on-screen hook, layout and caption settings).

Judge the clip a viewer would see, not the Creator's intentions. Be a demanding but fair editor: approve \
a clip only if you would post it as is. When you send a clip back, the reason must say what is wrong, \
where (timestamps on the clip's timeline, like 0:07), and what would fix it, so the Creator can learn \
from it. When you approve, say briefly what works and what, if anything, is weakest.

Tags name what is wrong, and only that: an approved clip may have none.
- hook: the first 3 seconds don't make a viewer want to keep watching.
- pacing: dead air, rambling, filler, or cuts that feel too slow or too abrupt.
- framing: the speaker or the important visual is cropped out, off-center, or the layout is wrong.
- captions: captions are wrong, unreadable, badly timed or cover something important.
- audio: words cut in half at a cut, pops, a jump in volume, or an unintelligible stretch.
- off_brief: the clip doesn't deliver what the brief asked for.
- length: much longer or shorter than the brief asked for.
- ending: the clip stops mid-thought or without a payoff.
- off_style: the clip doesn't look or feel like the editing style it was made in.

Each clip was edited in one or more editing styles (brain rot, polished, artsy, ...), named in the edit plan. Judge it as a clip in those styles: frantic cuts are the point of one style and a flaw in another. Your standards for each style follow your general standards and take precedence over them where they disagree. The general standards that don't depend on style (a hook, a finished ending, the subject in frame, readable captions) still apply to every clip.

Your standards follow. Apply them.

"""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["approved", "tags", "reason"],
    "properties": {
        "approved": {"type": "boolean"},
        "tags": {"type": "array", "items": {"type": "string", "enum": list(TAGS)}},
        "reason": {"type": "string"},
    },
}


@dataclass
class Review:
    approved: bool
    reason: str
    tags: list[str] = field(default_factory=list)


def _clock(t: float) -> str:
    return f"{int(t // 60)}:{t % 60:04.1f}"


def _video_part(video: Path) -> dict | None:
    if not SEND_VIDEO or video.stat().st_size > MAX_INLINE_VIDEO:
        return None
    data = base64.b64encode(video.read_bytes()).decode()
    return {"type": "video_url", "video_url": {"url": f"data:video/mp4;base64,{data}"}}


def _spoken(plan: EditPlan, transcript: dict) -> str:
    """What is said in the clip, as lines on the output timeline, starting a line at each cut."""
    segs, tl_words = timeline(plan, all_words(transcript))
    cut_times, t = [], 0.0
    for s in segs:
        cut_times.append(t)
        t += s.end - s.start
    lines: list[str] = []
    cur: list[dict] = []
    next_cut = 1
    for w in tl_words:
        at_cut = next_cut < len(cut_times) and w["start"] >= cut_times[next_cut]
        if cur and (at_cut or len(cur) >= 14):
            lines.append(f"[{_clock(cur[0]['start'])}] {' '.join(x['word'] for x in cur)}")
            cur = []
        if at_cut:
            lines.append(f"--- cut at {_clock(cut_times[next_cut])} ---")
            next_cut += 1
        cur.append(w)
    if cur:
        lines.append(f"[{_clock(cur[0]['start'])}] {' '.join(x['word'] for x in cur)}")
    return "\n".join(lines) or "(no speech)"


def _plan_text(plan: EditPlan) -> str:
    ranges = ", ".join(f"{s.start:.1f}-{s.end:.1f}s" for s in plan.segments)
    return (
        f"Source ranges kept, in order: {ranges}\n"
        f"Hook text (first 3s): {plan.hook or '(none)'}\n"
        f"Layout: {plan.layout}, crop_x {plan.crop_x:.2f}; captions: {plan.caption_style}, "
        f"{plan.caption_words} words at a time\n"
        f"Editing styles: {', '.join(plan.styles) or '(none named)'}\n"
        f"Creator's rationale: {plan.rationale or '(none)'}"
    )


def review(
    video: Path,
    brief: str,
    plan: dict | EditPlan | None = None,
    transcript: dict | None = None,
    ref: str | None = None,
    model: str | None = None,
) -> Review:
    """Approve the clip or send it back. `transcript` is the source footage's transcript."""
    skills = load_skills("reviewer", ref)
    info = probe(video)
    duration = info["duration"]

    text = [f"Brief: {brief}", f"Clip: {duration:.1f}s, {info['width']}x{info['height']}"]
    if plan is not None:
        plan = plan if isinstance(plan, EditPlan) else EditPlan.model_validate(plan)
        if plan.styles:
            # The Reviewer's own standards for these styles, at its own (possibly frozen) ref.
            skills += "\n\n# Your standards for this clip's styles\n\n" + style_lib.for_agent("reviewer", plan.styles, ref)
        text.append("Edit plan:\n" + _plan_text(plan))
        if transcript is not None:
            text.append("What is said in the clip (clip timeline):\n" + _spoken(plan, transcript))

    frames_dir = video.parent / "review_frames"
    frames_dir.mkdir(exist_ok=True)
    stills: list[dict] = []
    times = [duration * (i + 0.5) / N_FRAMES for i in range(N_FRAMES)]
    times[0] = min(1.0, duration / 2)  # the hook frame
    for i, t in enumerate(times):
        stills.append({"type": "text", "text": f"Still at {_clock(t)}:"})
        stills.append(llm.image_part(frame_at(video, t, frames_dir / f"{i}.jpg", width=360)))

    base = [{"type": "text", "text": "\n\n".join(text)}]
    video_part = _video_part(video)
    content = [*base, *stills] if video_part is None else [*base, video_part, *stills]
    out = _ask(SYSTEM + skills, content, model)
    if _thin(out["reason"]):
        # The Auditor learns from the reason, so a bare tag like "framing" (seen 2026-11-07) is not enough.
        log.warning("reviewer: reason %r is too thin; asking once more", out["reason"])
        nudge = {"type": "text", "text": (
            "Your reason must be one to three full sentences: what is wrong or what works, where "
            "(clip timestamps like 0:07), and what would fix it. A tag name alone is not a reason."
        )}
        try:
            again = _ask(SYSTEM + skills, [*content, nudge], model)
        except Exception:  # the first verdict is still usable: never lose it to an optional retry
            log.exception("reviewer: re-asking for a fuller reason failed; keeping the first verdict")
        else:
            if not _thin(again["reason"]):
                out = again

    tags = [t for t in dict.fromkeys(out.get("tags", [])) if t in TAGS]
    return Review(approved=bool(out["approved"]), reason=out["reason"].strip(), tags=tags)


def _thin(reason: str) -> bool:
    r = reason.strip().strip(".").lower()
    return len(r) < 15 or r in TAGS


def _ask(system: str, content: list[dict], model: str | None) -> dict:
    """One review call. If the model refuses the inline video, review from the stills alone."""
    try:
        return llm.complete_json(system, content, SCHEMA, "review", model=model)
    except BadRequestError as exc:
        if not any(p.get("type") == "video_url" for p in content):
            raise
        log.warning("reviewer: model rejected the inline video (%s); reviewing from stills", exc)
        stills_only = [p for p in content if p.get("type") != "video_url"]
        return llm.complete_json(system, stills_only, SCHEMA, "review", model=model)
