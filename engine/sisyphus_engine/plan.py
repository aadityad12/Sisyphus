"""The edit plan: what the Creator writes and the renderer turns into an MP4.

Plans are plain JSON, so they diff cleanly between agent versions.
"""

from typing import Literal

from pydantic import BaseModel, Field


class Segment(BaseModel):
    start: float = Field(description="Source time in seconds where this cut starts")
    end: float = Field(description="Source time in seconds where this cut ends")


class EditPlan(BaseModel):
    title: str = Field(description="Short internal title for the clip")
    hook: str = Field(description="On-screen hook text shown over the first seconds; empty for none")
    segments: list[Segment] = Field(description="Source ranges, played in this order")
    layout: Literal["crop", "fit", "split"] = Field(
        "crop",
        description="crop: fill 9:16 with a crop of the frame; fit: whole 16:9 frame over a blurred fill; "
        "split: whole frame on top, a crop at crop_x filling the bottom",
    )
    crop_x: float = Field(0.5, ge=0, le=1, description="Horizontal position of the 9:16 crop: 0 left, 0.5 center, 1 right")
    track_face: bool = Field(False, description="Centre and size the crop on the speaker's face, per segment")
    zoom: float = Field(1.0, ge=1, le=4, description="Crop magnification: 1 uses the full source height, 3 a third of it")
    crop_y: float = Field(0.5, ge=0, le=1, description="Vertical position of a zoomed crop: 0 top, 1 bottom")
    caption_style: Literal["karaoke", "plain", "none"] = "karaoke"
    caption_words: int = Field(3, ge=1, le=8, description="Max words on screen at once")
    rationale: str = Field("", description="Why these cuts answer the brief")

    def duration(self) -> float:
        return sum(max(0.0, s.end - s.start) for s in self.segments)


def json_schema() -> dict:
    """A strict JSON schema for constrained decoding (every property required, no extras)."""
    num = {"type": "number"}
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["title", "hook", "segments", "layout", "track_face", "crop_x", "zoom", "crop_y", "caption_style", "caption_words", "rationale"],
        "properties": {
            "title": {"type": "string"},
            "hook": {"type": "string"},
            "segments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["start", "end"],
                    "properties": {"start": num, "end": num},
                },
            },
            "layout": {"type": "string", "enum": ["crop", "fit", "split"]},
            "crop_x": num,
            "zoom": num,
            "track_face": {"type": "boolean"},
            "crop_y": num,
            "caption_style": {"type": "string", "enum": ["karaoke", "plain", "none"]},
            "caption_words": {"type": "integer"},
            "rationale": {"type": "string"},
        },
    }


def clamp_raw(raw: dict) -> dict:
    """Pull out-of-range numbers back into range before validation: a model slip shouldn't fail the job."""
    raw = dict(raw)
    if isinstance(raw.get("caption_words"), (int, float)):
        raw["caption_words"] = int(min(8, max(1, raw["caption_words"])))
    if isinstance(raw.get("hook"), str) and raw["hook"].strip().lower() in ("none", "n/a", "null", "no hook"):
        raw["hook"] = ""  # the model sometimes spells "no hook" as the word itself
    if isinstance(raw.get("zoom"), (int, float)):
        raw["zoom"] = min(4.0, max(1.0, float(raw["zoom"])))
    if isinstance(raw.get("crop_y"), (int, float)):
        raw["crop_y"] = min(1.0, max(0.0, float(raw["crop_y"])))
    if isinstance(raw.get("crop_x"), (int, float)):
        raw["crop_x"] = min(1.0, max(0.0, float(raw["crop_x"])))
    return raw


def sanitize(plan: EditPlan, source_duration: float) -> EditPlan:
    """Clamp segments to the source and drop empty ones. Order is kept: the Creator may reorder on purpose."""
    segs = []
    for s in plan.segments:
        start = max(0.0, min(s.start, source_duration))
        end = max(0.0, min(s.end, source_duration))
        if end - start >= 0.3:
            segs.append(Segment(start=start, end=end))
    if not segs:
        raise ValueError("edit plan has no usable segments")
    return plan.model_copy(update={"segments": segs, "crop_x": min(1.0, max(0.0, plan.crop_x))})
