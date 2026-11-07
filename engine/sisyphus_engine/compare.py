"""Head-to-head: the frozen Reviewer watches two edits of the same brief and says which is better.

VISION.md: for a Creator change, "a frozen copy of the current Reviewer compares the old and new videos".
Pass/fail alone proved too blunt on 2026-11-07: three changes in a row tied (2/3 v 2/3, 1/3 v 1/3,
1/4 v 1/4) because the Reviewer sent back both arms, each for several reasons, so a better clip that
still had one flaw scored the same as a worse one. When pass counts tie, these comparisons decide.

The two clips are shown in random order, labelled A and B, so position can't pick the winner.
"""

import base64
import random
from pathlib import Path

from . import llm
from .agents import load_skills

SYSTEM = """You are the Reviewer in SIsyphus, a video editing system. Two vertical short-form clips were cut \
from the same source for the same one-line brief. Watch both and decide which one is better to post, by your \
standards below: hook, framing, captions, pacing, a complete ending, and how well it answers the brief. \
Judge only what is on screen and in the audio. Say "same" only if neither is meaningfully better.

Your standards:

"""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["better", "reason"],
    "properties": {
        "better": {"type": "string", "enum": ["A", "B", "same"]},
        "reason": {"type": "string", "description": "One or two sentences naming the deciding difference"},
    },
}


def _video(path: Path) -> dict:
    data = base64.b64encode(path.read_bytes()).decode()
    return {"type": "video_url", "video_url": {"url": f"data:video/mp4;base64,{data}"}}


def prefer(control: Path, candidate: Path, brief: str, reviewer_ref: str | None, rng: random.Random | None = None) -> dict:
    """Returns {"winner": "control" | "candidate" | "same", "reason": str}."""
    rng = rng or random.Random()
    flipped = rng.random() < 0.5
    first, second = (candidate, control) if flipped else (control, candidate)
    user = [
        {"type": "text", "text": f"Brief: {brief}\n\nClip A:"},
        _video(first),
        {"type": "text", "text": "Clip B:"},
        _video(second),
    ]
    out = llm.complete_json(SYSTEM + load_skills("reviewer", reviewer_ref), user, SCHEMA, "comparison")
    arm = {"A": "candidate" if flipped else "control", "B": "control" if flipped else "candidate"}
    winner = "same" if out["better"] == "same" else arm[out["better"]]
    names = {"control": "current", "candidate": "candidate"}
    reason = out["reason"]
    for label in ("A", "B"):
        reason = reason.replace(f"Clip {label}", f"the {names[arm[label]]} clip")
    return {"winner": winner, "reason": reason}
