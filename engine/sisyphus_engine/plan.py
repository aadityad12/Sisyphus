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
    crop_x: float = Field(0.5, ge=0, le=1, description="Horizontal position of the 9:16 crop: 0 left, 0.5 center, 1 right")
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
        "required": ["title", "hook", "segments", "crop_x", "caption_style", "caption_words", "rationale"],
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
            "crop_x": num,
            "caption_style": {"type": "string", "enum": ["karaoke", "plain", "none"]},
            "caption_words": {"type": "integer"},
            "rationale": {"type": "string"},
        },
    }


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
