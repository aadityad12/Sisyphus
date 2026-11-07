import pytest

from sisyphus_engine import reviewer_ab, store
from sisyphus_engine.agents.reviewer import Review


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "t.db")
    store.init()
    calls = []
    monkeypatch.setattr(reviewer_ab.versioning, "promote", lambda b: calls.append(("promote", b)) or "abcdef1234")
    monkeypatch.setattr(reviewer_ab.versioning, "roll_back", lambda b: calls.append(("roll_back", b)))
    monkeypatch.setattr(reviewer_ab, "transcribe", lambda p: {"segments": []})
    clip = tmp_path / "v.mp4"
    clip.write_bytes(b"x")
    return {"calls": calls, "clip": str(clip)}


def _voted(env, liked, approved=True):
    vid = store.add_video("f.mp4", "brief")
    store.update_video(vid, video_path=env["clip"], review_approved=int(approved), human_liked=int(liked),
                       status="approved" if approved else "rejected")
    return vid


def _reviewers(monkeypatch, control, candidate):
    """control/candidate: functions from video id to the verdict that version gives."""
    def fake(video, brief, plan=None, transcript=None, ref=None):
        vid = fake.ids[brief]
        return Review(approved=(candidate if ref == "si/reviewer/1-x" else control)(vid), reason="r")
    monkeypatch.setattr(reviewer_ab.reviewer, "review", fake)
    return fake


def _change(failure_ids=()):
    return store.add_change("reviewer", "si/reviewer/1-x", "x", status="testing",
                            failure_ids=list(failure_ids), results={"base": "base123"})


def _get(cid):
    return next(c for c in store.list_changes() if c["id"] == cid)


def _setup(env, monkeypatch, likes, control, candidate):
    ids = [_voted(env, liked) for liked in likes]
    fake = _reviewers(monkeypatch, control, candidate)
    fake.ids = {}
    for i in ids:  # give each video its own brief so the fake can tell them apart
        store.update_video(i, brief=f"b{i}")
        fake.ids[f"b{i}"] = i
    return ids


def test_candidate_that_agrees_more_with_humans_is_promoted(env, monkeypatch):
    _setup(env, monkeypatch, [True, False, True, False],
           control=lambda i: True, candidate=lambda i: store.get_video(i)["human_liked"])
    cid = _change()
    reviewer_ab.run(cid)
    c = _get(cid)
    assert c["status"] == "promoted"
    assert c["results"]["control"] == {"agree": 2, "total": 4}
    assert c["results"]["candidate"] == {"agree": 4, "total": 4}
    assert env["calls"] == [("promote", "si/reviewer/1-x")]


def test_tie_rolls_back(env, monkeypatch):
    _setup(env, monkeypatch, [True, True, False, False], control=lambda i: True, candidate=lambda i: False)
    cid = _change()
    reviewer_ab.run(cid)
    assert _get(cid)["status"] == "rolled_back"
    assert env["calls"] == [("roll_back", "si/reviewer/1-x")]


def test_waits_for_votes_and_excludes_the_cluster(env, monkeypatch):
    ids = _setup(env, monkeypatch, [True, True, True, True], control=lambda i: True, candidate=lambda i: True)
    cid = _change(failure_ids=ids[:1])  # only 3 held-out clips left
    reviewer_ab.run(cid)
    c = _get(cid)
    assert c["status"] == "testing" and "3 of 4" in c["results"]["waiting_for_votes"]
    assert env["calls"] == []


def test_a_crash_counts_against_its_arm(env, monkeypatch):
    ids = _setup(env, monkeypatch, [True] * 4, control=lambda i: True, candidate=lambda i: True)

    def fake(video, brief, plan=None, transcript=None, ref=None):
        if ref == "si/reviewer/1-x":
            raise RuntimeError("boom")
        return Review(approved=True, reason="r")

    monkeypatch.setattr(reviewer_ab.reviewer, "review", fake)
    cid = _change()
    reviewer_ab.run(cid)
    c = _get(cid)
    assert c["status"] == "rolled_back" and c["results"]["candidate"]["agree"] == 0
    assert len(ids) == len(c["results"]["per_video"])


def test_a_vote_during_a_run_triggers_one_more_pass(env, monkeypatch):
    """The final vote can land after a run took its snapshot: the change must not stay stuck waiting."""
    ids = _setup(env, monkeypatch, [True] * 3, control=lambda i: True, candidate=lambda i: True)
    cid = _change()
    real_held_out = reviewer_ab.held_out
    passes = []

    def held_out_then_vote(exclude, style=None):
        snapshot = real_held_out(exclude)
        if not passes:  # first pass: a human votes on a 4th clip right after the snapshot
            new = _voted(env, True)
            store.update_video(new, brief=f"b{new}")
            reviewer_ab.reviewer.review.ids[f"b{new}"] = new
            reviewer_ab.run(cid)  # what on_vote's submit does while this run is in flight
        passes.append(len(snapshot))
        return snapshot

    monkeypatch.setattr(reviewer_ab, "held_out", held_out_then_vote)
    reviewer_ab.run(cid)
    assert passes == [3, 4]
    assert _get(cid)["status"] == "rolled_back"  # decided (a tie), not stuck at "3 of 4"
    assert not reviewer_ab._running and not reviewer_ab._rerun
    assert len(ids) == 3
