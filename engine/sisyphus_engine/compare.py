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
from . import styles as style_lib
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


def _heading(name: str, styles: list[str]) -> str:
    return f"Clip {name} (editing style: {', '.join(styles)}):" if styles else f"Clip {name}:"


def prefer(
    control: Path, candidate: Path, brief: str, reviewer_ref: str | None, rng: random.Random | None = None,
    styles: tuple[list[str], list[str]] | None = None,
) -> dict:
    """Returns {"winner": "control" | "candidate" | "same", "reason": str}.

    `styles` is (control's, candidate's) editing styles. Each clip is judged as a clip in its own styles,
    by the Reviewer's files for them at its frozen ref (issue #13).
    """
    rng = rng or random.Random()
    flipped = rng.random() < 0.5
    first, second = (candidate, control) if flipped else (control, candidate)
    k_styles, c_styles = styles or ([], [])
    a_styles, b_styles = (c_styles, k_styles) if flipped else (k_styles, c_styles)
    user = [
        {"type": "text", "text": f"Brief: {brief}\n\n{_heading('A', a_styles)}"},
        _video(first),
        {"type": "text", "text": _heading("B", b_styles)},
        _video(second),
    ]
    system = SYSTEM + load_skills("reviewer", reviewer_ref)
    used = list(dict.fromkeys([*k_styles, *c_styles]))
    if used:
        system += (
            "\n\nJudge each clip as a clip in its own editing style. Your standards for these styles:\n\n"
            + style_lib.for_agent("reviewer", used, reviewer_ref)
        )
    out = llm.complete_json(system, user, SCHEMA, "comparison")
    arm = {"A": "candidate" if flipped else "control", "B": "control" if flipped else "candidate"}
    winner = "same" if out["better"] == "same" else arm[out["better"]]
    names = {"control": "current", "candidate": "candidate"}
    reason = out["reason"]
    for label in ("A", "B"):
        reason = reason.replace(f"Clip {label}", f"the {names[arm[label]]} clip")
    return {"winner": winner, "reason": reason}
