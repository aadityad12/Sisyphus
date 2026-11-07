"""Creator: makes short-form videos from raw footage plus a one-line brief.

It writes a structured edit plan (see plan.py) and the fixed renderer (render.py) turns it into an MP4.
"""

import json
from pathlib import Path

from .. import llm
from ..media import frame_at, probe
from ..plan import EditPlan, clamp_raw, json_schema, sanitize
from ..render import render
from ..transcribe import as_prompt_text, transcribe
from . import load_skills

SYSTEM = """You are the Creator in SIsyphus, a video editing system. You turn a long talk or podcast into one \
vertical short-form clip (9:16) that answers a one-line brief.

You do not touch pixels. You write an edit plan: source time ranges to keep, in play order, plus an on-screen \
hook, caption settings and a layout. A fixed renderer cuts the footage, makes it 9:16 and burns in \
word-by-word captions from the transcript. Layouts: "crop" fills the vertical frame with a 9:16 slice of the \
source, positioned by crop_x; "fit" shows the whole 16:9 frame across the middle over a blurred fill. All times are in seconds of the source video and must come \
from the timestamped transcript you are given.

The frames you see are evenly spaced stills from the source, so you can choose the layout and crop_x.

Your skills follow. Follow them.

"""


def make_plan(footage: Path, brief: str, workdir: Path, skills_ref: str | None = None, model: str | None = None) -> tuple[EditPlan, dict]:
    info = probe(footage)
    transcript = transcribe(footage)
    skills = load_skills("creator", skills_ref)

    frames = []
    for i, frac in enumerate((0.15, 0.4, 0.65, 0.9)):
        frames.append(frame_at(footage, info["duration"] * frac, workdir / f"frame{i}.jpg"))

    user = [
        {"type": "text", "text": (
            f"Brief: {brief}\n"
            f"Source: {footage.name}, {info['duration']:.0f}s, {info['width']}x{info['height']}\n\n"
            f"Transcript (start-end seconds):\n{as_prompt_text(transcript)}"
        )},
        *[llm.image_part(f) for f in frames],
    ]
    raw = llm.complete_json(SYSTEM + skills, user, json_schema(), "edit_plan", model=model)
    plan = sanitize(EditPlan.model_validate(clamp_raw(raw)), info["duration"])
    return plan, info


def create(footage: Path, brief: str, workdir: Path, skills_ref: str | None = None, model: str | None = None) -> tuple[EditPlan, Path]:
    """Plan and render one video. Returns the plan and the MP4 path."""
    workdir.mkdir(parents=True, exist_ok=True)
    plan, info = make_plan(footage, brief, workdir, skills_ref, model)
    (workdir / "plan.json").write_text(json.dumps(plan.model_dump(), indent=2), encoding="utf-8")
    video = render(plan, footage, transcribe(footage), workdir / "video.mp4", info["width"], info["height"])
    return plan, video
