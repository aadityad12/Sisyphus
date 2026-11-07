"""The look knobs (#13): defaults render exactly as before they existed, and each knob reaches ffmpeg."""

import json
from pathlib import Path
from typing import get_args

import pytest

from sisyphus_engine import render
from sisyphus_engine.plan import EditPlan, Segment, clamp_raw, json_schema, load, load_segments, sanitize

# What render() handed ffmpeg at 01c6e37, before any knob existed, for these plans and this transcript;
# the caption and hook margins since moved out of the platforms' UI bands (#26).
GOLDEN = json.loads((Path(__file__).parent / "fixtures" / "render_golden.json").read_text(encoding="utf-8"))
WORDS = [{"start": round(i * 0.5, 2), "end": round(i * 0.5 + 0.4, 2), "word": w}
         for i, w in enumerate("so here is the thing, we built it. and then? it broke again! every time".split())]
TRANSCRIPT = {"segments": [{"start": 0, "end": 10, "text": "", "words": WORDS}]}
FOOTAGE = Path("/footage/talk.mp4")
PLANS = {
    "crop": dict(layout="crop", crop_x=0.3, caption_style="karaoke", caption_words=3, hook="Wait for it"),
    "fit": dict(layout="fit", caption_style="plain", caption_words=4),
    "split": dict(layout="split", crop_x=0.8, zoom=1.5, crop_y=0.4, caption_style="karaoke"),
    "none": dict(layout="crop", caption_style="none", hook="Hook"),
    "tracked": dict(layout="crop", track_face=True, zoom=2.0),
}


def make(name: str = "crop", punch=(1.0, 1.0), **knobs) -> EditPlan:
    kw = {"hook": "", **PLANS[name], **knobs}
    segs = [{"start": 0.2, "end": 2.6, "punch": punch[0]}, {"start": 3.4, "end": 6.0, "punch": punch[1]}]
    return EditPlan(title="t", segments=segs, **kw)


@pytest.fixture
def ffmpeg_call(monkeypatch, tmp_path):
    """Render without ffmpeg: returns a function giving (args, captions.ass) for a plan."""
    seen = {}

    class Done:
        returncode, stderr = 0, ""

    def run(args, cwd=None, **kw):
        # The footage is passed resolved, which is C:\\footage\\talk.mp4 on Windows: map it to the golden's spelling.
        seen["args"] = ["/footage/talk.mp4" if a == str(FOOTAGE.resolve()) else a for a in args]
        seen["ass"] = (Path(cwd) / "captions.ass").read_text(encoding="utf-8")
        return Done()

    monkeypatch.setattr(render.subprocess, "run", run)
    monkeypatch.setattr(render.faces, "locate", lambda footage, a, b: (520.0, 260.0, 120.0))
    # One camera shot per segment, as the golden (captured before shot splitting) assumed.
    monkeypatch.setattr(render.faces, "shots", lambda footage, a, b: [(0.0, b - a)])
    monkeypatch.setattr(render, "ffmpeg", lambda: "ffmpeg")

    def call(plan: EditPlan) -> tuple[list[str], str]:
        render.render(plan, FOOTAGE, TRANSCRIPT, tmp_path / "video.mp4", 1280, 720)
        return seen["args"], seen["ass"]

    return call


def graph(args: list[str]) -> str:
    return args[args.index("-filter_complex") + 1]


@pytest.mark.parametrize("name", PLANS)
def test_defaults_render_exactly_as_before(ffmpeg_call, name):
    args, ass = ffmpeg_call(make(name))
    assert args == GOLDEN[name]["args"]
    assert ass == GOLDEN[name]["ass"]


def test_a_plan_from_before_the_knobs_loads_with_todays_look():
    old = {"title": "t", "hook": "", "segments": [{"start": 1, "end": 3}], "layout": "crop", "crop_x": 0.5,
           "caption_style": "karaoke", "caption_words": 3, "rationale": ""}
    plan = EditPlan.model_validate(old)
    assert plan.segments[0].punch == 1.0
    assert (plan.caption_size, plan.caption_color, plan.caption_position, plan.caption_caps) == ("medium", "white", "lower", True)
    assert (plan.color_filter, plan.speed) == ("none", 1.0)


def test_schema_is_strict_and_lists_every_knob():
    schema = json_schema()
    assert sorted(schema["required"]) == sorted(schema["properties"])
    seg = schema["properties"]["segments"]["items"]
    assert sorted(seg["required"]) == sorted(seg["properties"]) == ["end", "punch", "start"]
    for knob in ("caption_size", "caption_color", "caption_position", "caption_caps", "color_filter", "speed"):
        assert knob in schema["required"]
    # Each look is listed in three places: the plan's Literal, the schema the model decodes against and
    # the renderer's table. They must agree, or a model's choice fails validation or the render.
    for knob, table in (("caption_size", render.CAPTION_SIZE), ("caption_color", render.CAPTION_COLOR),
                        ("caption_position", render.CAPTION_POSITION), ("color_filter", render.COLOR_FILTERS)):
        literal = set(get_args(EditPlan.model_fields[knob].annotation))
        assert set(schema["properties"][knob]["enum"]) == literal == set(table), knob


def test_clamp_uses_the_plans_own_bounds():
    def bounds(field):
        meta = {type(m).__name__: m for m in field.metadata}
        return meta["Ge"].ge, meta["Le"].le

    lo, hi = bounds(EditPlan.model_fields["speed"])
    assert (clamp_raw({"speed": -9})["speed"], clamp_raw({"speed": 99})["speed"]) == (lo, hi)
    lo, hi = bounds(Segment.model_fields["punch"])
    clamped = clamp_raw({"segments": [{"punch": -9}, {"punch": 99}]})["segments"]
    assert [s["punch"] for s in clamped] == [lo, hi]


def test_clamp_pulls_speed_and_punch_into_range():
    raw = clamp_raw({"speed": 3, "segments": [{"start": 0, "end": 1, "punch": 0.5}, {"start": 1, "end": 2, "punch": 9}]})
    assert raw["speed"] == 1.5
    assert [s["punch"] for s in raw["segments"]] == [1.0, 1.3]
    assert clamp_raw({"speed": 0.1})["speed"] == 0.75


def test_a_stored_plan_from_before_the_punch_cap_still_loads():
    old = make().model_dump()
    old["segments"][1]["punch"] = 1.5  # brain-rot plans punched this hard before #26
    assert [s.punch for s in load(old).segments] == [1.0, 1.3]
    assert old["segments"][1]["punch"] == 1.5  # the stored plan itself is left alone
    # A video's rendered_segments are stored beside the plan, and the cut view loads them too.
    assert [s.punch for s in load_segments(old["segments"])] == [1.0, 1.3]


def test_punch_survives_sanitize_and_snapping():
    plan = sanitize(make(punch=(1.0, 1.2)), source_duration=100)
    assert [s.punch for s in plan.segments] == [1.0, 1.2]
    assert render.snap_to_words(Segment(start=0.3, end=2.6, punch=1.2), WORDS).punch == 1.2


def test_speed_scales_caption_times_but_not_cut_points():
    plain, fast = make(), make(speed=1.25)
    segs1, words1 = render.timeline(plain, WORDS)
    segs2, words2 = render.timeline(fast, WORDS)
    assert [s.model_dump() for s in segs2] == [s.model_dump() for s in segs1]  # source seconds: rendered_segments
    assert [w["start"] for w in words2] == pytest.approx([w["start"] / 1.25 for w in words1])
    assert fast.duration() == pytest.approx(plain.duration() / 1.25)


def test_speed_reaches_picture_sound_and_fades(ffmpeg_call):
    args, ass = ffmpeg_call(make(speed=1.25))
    g = graph(args)
    assert "setpts=(PTS-STARTPTS)/1.2500" in g and g.count("atempo=1.2500") == 2
    segs, _ = render.timeline(make(speed=1.25), WORDS)
    first_out = (segs[0].end - segs[0].start) / 1.25
    assert f"afade=t=out:st={first_out - render.FADE:.3f}" in g  # the fade-out is timed in output seconds
    assert "-t" in args and f"{segs[0].end - segs[0].start:.3f}" in args  # inputs still cut in source seconds


def test_punch_zooms_only_its_segment(ffmpeg_call):
    g = graph(ffmpeg_call(make(punch=(1.0, 1.25)))[0])
    v0, v1 = (part for part in g.split(";") if part.endswith(("[v0]", "[v1]")))
    assert "crop=iw/" not in v0
    assert ",crop=iw/1.250:ih/1.250,scale=720:1280,setsar=1[v1]" in v1  # inside the crop: one resize
    split = graph(ffmpeg_call(make("split", punch=(1.25, 1.0)))[0])
    assert ",crop=iw/1.250:ih/1.250,scale=720:876[bot0]" in split
    assert "[ts0]scale=720:404[top0]" in split  # the slide on top stays whole
    fit = graph(ffmpeg_call(make("fit", punch=(1.25, 1.0)))[0])
    assert "overlay=0:(H-h)/2,crop=iw/1.250:ih/1.250,scale=720:1280,setsar=1[v0]" in fit


@pytest.mark.parametrize("name", ["warm", "cool", "bw", "film", "vivid"])
def test_color_filter_grades_before_captions(ffmpeg_call, name):
    g = graph(ffmpeg_call(make(color_filter=name))[0])
    assert f"[cv]{render.COLOR_FILTERS[name]},subtitles=captions.ass" in g


def test_caption_knobs_reach_the_subtitles(ffmpeg_call):
    _, ass = ffmpeg_call(make(caption_size="huge", caption_color="pink", caption_position="upper", caption_caps=False))
    cap = next(line for line in ass.splitlines() if line.startswith("Style: Cap,"))
    fields = cap.split(",")
    assert fields[2] == "96" and fields[3] == "&H00B469FF"  # size, text colour
    assert (fields[18], fields[21]) == ("8", "400")  # alignment top centre, clear of a two-line hook
    assert fields[16] == str(round(5 * 96 / 62))  # outline grows with the text
    assert "so" in ass and "SO" not in ass  # transcript case kept
    assert r"{\c&HFFFFFF&}here{\c&HB469FF&}" in ass  # karaoke highlight, back to the text colour


def test_camera_shots_are_trimmed_in_sped_up_time(ffmpeg_call, monkeypatch):
    # [raw{i}] is retimed before shots are cut, so a cut 1.2 s into the source is 1.0 s into it at 1.2x
    # (the Opus review of #13: trimming in source seconds gave the next shot the speaker's crop).
    monkeypatch.setattr(render.faces, "shots", lambda footage, a, b: [(0.0, 1.2), (1.2, b - a)])
    args, _ = ffmpeg_call(make("tracked", speed=1.2))
    g = graph(args)
    assert "trim=start=0.000:end=1.000" in g and "trim=start=1.000:end=" in g


def test_a_shot_with_no_face_takes_no_punch(ffmpeg_call, monkeypatch):
    # A faceless shot is shown whole (fit), so a punch-in would crop the slide it is there to show.
    monkeypatch.setattr(render.faces, "shots", lambda footage, a, b: [(0.0, 1.0), (1.0, b - a)])
    monkeypatch.setattr(render.faces, "locate", lambda footage, a, b: (520.0, 260.0, 120.0) if a < 1.0 else None)
    args, _ = ffmpeg_call(make("tracked", punch=(1.3, 1.3)))
    g = graph(args)
    assert "[sh0_1]" in g and "crop=iw/1.300:ih/1.300" in g
    faceless = [p for p in g.split(";") if "[sv0_1]" in p and "overlay" in p]
    assert faceless and "crop=iw/1.300" not in faceless[0]
