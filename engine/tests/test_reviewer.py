import subprocess

import httpx
import pytest
from openai import BadRequestError

from sisyphus_engine.agents import reviewer
from sisyphus_engine.media import ffmpeg

PLAN = {
    "title": "t",
    "hook": "Why evals matter",
    "segments": [{"start": 0.0, "end": 2.0}, {"start": 5.0, "end": 6.0}],
    "layout": "crop",
    "crop_x": 0.5,
    "caption_style": "karaoke",
    "caption_words": 3,
    "rationale": "",
}
TRANSCRIPT = {
    "segments": [
        {"start": 0.2, "end": 1.6, "text": "Evals are everything.", "words": [
            {"start": 0.2, "end": 0.6, "word": "Evals"}, {"start": 0.6, "end": 0.9, "word": "are"},
            {"start": 0.9, "end": 1.6, "word": "everything."}]},
        {"start": 3.0, "end": 4.0, "text": "Dropped.", "words": [{"start": 3.0, "end": 4.0, "word": "Dropped."}]},
        {"start": 5.1, "end": 5.8, "text": "Ship it.", "words": [
            {"start": 5.1, "end": 5.4, "word": "Ship"}, {"start": 5.4, "end": 5.8, "word": "it."}]},
    ]
}


@pytest.fixture
def clip(tmp_path):
    out = tmp_path / "video.mp4"
    subprocess.run(
        [ffmpeg(), "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=30:duration=3",
         "-f", "lavfi", "-i", "sine=duration=3", "-shortest", "-pix_fmt", "yuv420p", str(out)],
        check=True,
    )
    return out


@pytest.fixture
def calls(monkeypatch):
    calls = []
    monkeypatch.setattr(reviewer, "load_skills", lambda agent, ref=None: f"skills@{ref}")

    def fake(system, user, schema, name, model=None):
        calls.append({"system": system, "user": user})
        return {"approved": False, "tags": ["hook", "hook", "bogus"], "reason": " Slow start at 0:00. "}

    monkeypatch.setattr(reviewer.llm, "complete_json", fake)
    return calls


def _types(user):
    return [p["type"] for p in user]


def test_sends_video_stills_plan_and_spoken_text(clip, calls):
    r = reviewer.review(clip, "30s clip on evals", plan=PLAN, transcript=TRANSCRIPT, ref="abc123")
    assert r == reviewer.Review(approved=False, reason="Slow start at 0:00.", tags=["hook"])
    (call,) = calls
    assert call["system"].endswith("skills@abc123")  # frozen reviewer skills
    assert _types(call["user"]).count("video_url") == 1
    assert _types(call["user"]).count("image_url") == reviewer.N_FRAMES
    text = call["user"][0]["text"]
    assert "Why evals matter" in text
    assert "Dropped" not in text  # outside the kept ranges
    assert "--- cut at" in text and "Ship it." in text


def test_falls_back_to_stills_when_model_rejects_video(clip, monkeypatch):
    monkeypatch.setattr(reviewer, "load_skills", lambda agent, ref=None: "")
    seen = []

    def fake(system, user, schema, name, model=None):
        seen.append(_types(user))
        if "video_url" in seen[-1]:
            resp = httpx.Response(400, request=httpx.Request("POST", "http://x"))
            raise BadRequestError("video not supported", response=resp, body=None)
        return {"approved": True, "tags": [], "reason": "Good hook and a clean ending."}

    monkeypatch.setattr(reviewer.llm, "complete_json", fake)
    r = reviewer.review(clip, "brief")
    assert r.approved and r.tags == []
    assert len(seen) == 2 and "video_url" not in seen[1]


def test_no_video_when_disabled(clip, calls, monkeypatch):
    monkeypatch.setattr(reviewer, "SEND_VIDEO", False)
    reviewer.review(clip, "brief")
    assert "video_url" not in _types(calls[0]["user"])


def test_record_review_stores_tags(tmp_path, monkeypatch):
    from sisyphus_engine import jobs, store

    monkeypatch.setattr(store, "DB_PATH", tmp_path / "t.db")
    store.init()
    vid = store.add_video("f.mp4", "brief")
    jobs.record_review(vid, False, "Slow start.", tags=["hook", "pacing"], reviewer_version="abcdef1234567890")
    v = store.get_video(vid)
    assert v["status"] == "rejected" and v["review_approved"] is False
    assert v["review_reason"] == "Slow start."
    assert v["review_tags"] == ["hook", "pacing"]
    assert v["reviewer_version"] == "abcdef123456"


def test_a_bare_tag_as_the_reason_is_asked_again(clip, monkeypatch):
    monkeypatch.setattr(reviewer, "load_skills", lambda agent, ref=None: "")
    answers = iter([
        {"approved": False, "tags": ["framing"], "reason": "framing"},
        {"approved": False, "tags": ["framing"], "reason": "At 0:08 the speaker's inset is cut off on the right; fit the frame."},
    ])
    seen = []
    monkeypatch.setattr(reviewer.llm, "complete_json", lambda s, u, sc, n, model=None: seen.append(u) or next(answers))
    r = reviewer.review(clip, "brief")
    assert r.reason.startswith("At 0:08") and len(seen) == 2
    assert "A tag name alone is not a reason" in seen[1][-1]["text"]


def test_a_failed_re_ask_keeps_the_first_verdict(clip, monkeypatch):
    monkeypatch.setattr(reviewer, "load_skills", lambda agent, ref=None: "")
    answers = [{"approved": True, "tags": [], "reason": "good"}, TimeoutError("hung")]

    def fake(s, u, sc, n, model=None):
        a = answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a

    monkeypatch.setattr(reviewer.llm, "complete_json", fake)
    r = reviewer.review(clip, "brief")
    assert r.approved and r.reason == "good" and not answers
