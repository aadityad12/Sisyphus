"""Creator: makes short-form videos from raw footage plus a one-line brief.

It writes a structured edit plan (see plan.py) and the fixed renderer (render.py) turns it into an MP4.
"""

import json
from pathlib import Path

from .. import llm, styles as style_lib
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

Every clip is edited in one or more editing styles. A style's file says how to cut, caption, frame and pace in it, and it takes precedence over the general skills where they disagree. List the styles you applied in "styles", by name.

Your skills follow. Follow them.

"""


def style_prompt(wanted: list[str], ref: str | None) -> str:
    """The style section of the prompt: the requested styles' files, or on Auto the whole library to pick from."""
    if wanted:
        return (
            f"\n\n# Editing style for this clip: {', '.join(wanted)}\n\nThe person asked for this. Apply it, "
            f"and set styles to {wanted}.\n\n" + style_lib.for_agent("creator", wanted, ref)
        )
    library = style_lib.names(ref)
    if not library:
        return ""
    return (
        "\n\n# Editing styles\n\nNo style was requested: pick the one that suits this footage and brief best, "
        "or mix two when that clearly serves the clip, and list them in styles. The styles you can use:\n\n"
        + style_lib.for_agent("creator", library, ref)
    )


def make_plan(
    footage: Path, brief: str, workdir: Path, skills_ref: str | None = None, model: str | None = None,
    styles: list[str] | None = None,
) -> tuple[EditPlan, dict]:
    info = probe(footage)
    transcript = transcribe(footage)
    wanted = list(dict.fromkeys(styles or []))
    skills = load_skills("creator", skills_ref) + style_prompt(wanted, skills_ref)

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
    # The tags are what was asked for, or on Auto what the Creator says it picked from the library.
    known = set(style_lib.names(skills_ref))
    used = wanted or [s for s in plan.styles if s in known]
    return plan.model_copy(update={"styles": used}), info


def create(
    footage: Path, brief: str, workdir: Path, skills_ref: str | None = None, model: str | None = None,
    styles: list[str] | None = None,
) -> tuple[EditPlan, Path]:
    """Plan and render one video. Returns the plan and the MP4 path. No `styles` means Auto."""
    workdir.mkdir(parents=True, exist_ok=True)
    plan, info = make_plan(footage, brief, workdir, skills_ref, model, styles)
    (workdir / "plan.json").write_text(json.dumps(plan.model_dump(), indent=2), encoding="utf-8")
    video = render(plan, footage, transcribe(footage), workdir / "video.mp4", info["width"], info["height"])
    return plan, video
