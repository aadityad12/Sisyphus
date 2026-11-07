import json

import pytest

from sisyphus_engine import cuts
from sisyphus_engine.plan import EditPlan
from sisyphus_engine.render import timeline
from sisyphus_engine.transcribe import words as all_words


def synthetic(n: int = 200) -> dict:
    """A word every 0.5 s, each 0.4 s long: w0 at 0.0-0.4, w1 at 0.5-0.9, and so on."""
    ws = [{"start": round(i * 0.5, 2), "end": round(i * 0.5 + 0.4, 2), "word": f"w{i}"} for i in range(n)]
    return {"segments": [{"start": 0.0, "end": ws[-1]["end"], "text": " ".join(w["word"] for w in ws), "words": ws}]}


def plan(*segments: tuple[float, float], hook: str = "") -> EditPlan:
    return EditPlan(title="t", hook=hook, segments=[{"start": s, "end": e} for s, e in segments])


def kept_by(block: dict) -> list[str]:
    return [w["word"] for w in block["words"] if w["segment"] == block["index"]]


def test_kept_words_match_what_the_renderer_plays():
    t, p = synthetic(), plan((10.0, 12.0), (40.2, 43.7))
    view = cuts.build(p, t)
    _, played = timeline(p, all_words(t))
    assert [w for b in view["segments"] for w in kept_by(b)] == [w["word"] for w in played]
    assert kept_by(view["segments"][0]) == ["w20", "w21", "w22", "w23"]


def test_blocks_use_snapped_segments_and_sum_to_kept_seconds():
    t, p = synthetic(), plan((10.1, 12.0))  # 10.1 is inside w20 (10.0-10.4): snapping pulls it back
    segs, _ = timeline(p, all_words(t))
    view = cuts.build(p, t)
    block = view["segments"][0]
    assert (block["start"], block["end"]) == (round(segs[0].start, 2), round(segs[0].end, 2))
    assert block["start"] < 10.0
    assert view["kept_s"] == round(segs[0].end - segs[0].start, 2)


def test_context_is_cut_and_bounded():
    view = cuts.build(plan((50.0, 52.0)), synthetic(), context=5.0)
    block = view["segments"][0]
    cut = [w for w in block["words"] if not w["kept"]]
    assert cut and all(w["segment"] is None for w in cut)
    assert all(w["end"] > block["start"] - 5.0 and w["start"] < block["end"] + 5.0 for w in block["words"])
    assert block["words"][0]["word"] == "w90"  # 45.0-45.4, the first word inside 44.95


def test_context_stops_at_the_source_start():
    view = cuts.build(plan((0.0, 2.0)), synthetic())
    assert view["segments"][0]["words"][0]["word"] == "w0"


def test_play_order_and_reordering():
    view = cuts.build(plan((50.0, 52.0), (10.0, 12.0)), synthetic())
    assert [b["index"] for b in view["segments"]] == [0, 1]
    assert view["segments"][0]["start"] > view["segments"][1]["start"]
    assert view["reordered"] is True
    assert cuts.build(plan((10.0, 12.0), (50.0, 52.0)), synthetic())["reordered"] is False


def test_words_another_segment_plays_are_marked_with_its_index():
    view = cuts.build(plan((10.0, 12.0), (14.0, 16.0)), synthetic())
    first = view["segments"][0]
    w28 = next(w for w in first["words"] if w["word"] == "w28")  # 14.0-14.4, played by segment 1
    assert w28 == {"word": "w28", "start": 14.0, "end": 14.4, "kept": True, "segment": 1}


def test_hook_and_title_pass_through():
    view = cuts.build(plan((10.0, 12.0), hook="Wait for it"), synthetic())
    assert (view["hook"], view["title"]) == ("Wait for it", "t")


def test_whitespace_hook_reads_as_no_hook():
    assert cuts.build(plan((10.0, 12.0), hook="  "), synthetic())["hook"] == ""


STORED = {"footage": "talk.mp4", "plan": plan((10.0, 12.0)).model_dump() | {"layout": "fit"}}


def test_for_video_reads_the_cached_transcript(monkeypatch, tmp_path):
    cache = tmp_path / "cache.json"
    cache.write_text(json.dumps(synthetic()))
    seen = []
    monkeypatch.setattr(cuts, "FOOTAGE_DIR", tmp_path)
    monkeypatch.setattr(cuts, "_cache_path", lambda path: seen.append(path) or cache)
    view = cuts.for_video(STORED)
    assert seen == [tmp_path / "talk.mp4"]
    assert kept_by(view["segments"][0]) == ["w20", "w21", "w22", "w23"]


def test_for_video_never_transcribes(monkeypatch, tmp_path):
    monkeypatch.setattr(cuts, "_cache_path", lambda path: tmp_path / "missing.json")
    with pytest.raises(cuts.NotCached):
        cuts.for_video(STORED)
