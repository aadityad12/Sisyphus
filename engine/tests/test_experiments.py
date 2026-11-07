import pytest

from sisyphus_engine import experiments, store


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "t.db")
    store.init()
    calls = []
    monkeypatch.setattr(experiments.versioning, "promote", lambda b: calls.append(("promote", b)) or "abcdef1234")
    monkeypatch.setattr(experiments.versioning, "roll_back", lambda b: calls.append(("roll_back", b)))
    # A promote re-renders the showcase from the real footage/manifest.json; keep tests off real jobs.
    monkeypatch.setattr(experiments.showcase, "on_promote", lambda version: None)
    return calls


def _arm(change_id, arm, approved, human=None, status=None):
    vid = store.add_video("f.mp4", "brief", experiment_id=change_id, arm=arm)
    fields = {"status": status or ("approved" if approved else "rejected")}
    if approved is not None:
        fields["review_approved"] = int(approved)
    if human is not None:
        fields["human_liked"] = int(human)
    store.update_video(vid, **fields)
    return vid


def _change():
    return store.add_change("creator", "si/creator/1-x", "x", status="testing", results={})


def _status(change_id):
    return next(c for c in store.list_changes() if c["id"] == change_id)


def test_candidate_that_passes_more_is_promoted(db):
    cid = _change()
    _arm(cid, "control", False)
    _arm(cid, "control", True)
    _arm(cid, "candidate", True)
    _arm(cid, "candidate", True)
    experiments.maybe_decide(cid)
    assert _status(cid)["status"] == "promoted"
    assert db == [("promote", "si/creator/1-x")]


def test_tie_is_rolled_back(db):
    cid = _change()
    _arm(cid, "control", True)
    _arm(cid, "candidate", True)
    experiments.maybe_decide(cid)
    assert _status(cid)["status"] == "rolled_back"
    assert db == [("roll_back", "si/creator/1-x")]


def test_waits_for_every_verdict(db):
    cid = _change()
    _arm(cid, "control", False)
    _arm(cid, "candidate", None, status="reviewing")
    experiments.maybe_decide(cid)
    change = _status(cid)
    assert change["status"] == "testing"
    assert change["results"]["pending"] == 1
    assert db == []


def test_human_vote_overrides_reviewer(db):
    cid = _change()
    _arm(cid, "control", True, human=False)  # Reviewer approved, humans disliked: fail
    _arm(cid, "candidate", False, human=True)  # Reviewer sent back, humans liked: pass
    experiments.maybe_decide(cid)
    assert _status(cid)["status"] == "promoted"


def test_experiment_clips_are_not_auditor_failures(db):
    cid = _change()
    _arm(cid, "control", False)
    assert store.failures() == []


def test_held_out_prefers_the_failing_kind(db, tmp_path, monkeypatch):
    import json

    for name in ("talk1.mp4", "talk2.mp4", "pod1.mp4", "pod2.mp4"):
        (tmp_path / name).write_bytes(b"")
    manifest = [
        {"file": "talk1.mp4", "brief": "b", "kind": "talk"},
        {"file": "talk2.mp4", "brief": "b", "kind": "talk"},
        {"file": "pod1.mp4", "brief": "b", "kind": "interview"},
        {"file": "pod2.mp4", "brief": "b", "kind": "interview"},
    ]
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    monkeypatch.setattr(experiments, "FOOTAGE_DIR", tmp_path)
    picked = experiments._held_out({"pod1.mp4"}, 2)
    assert [p["footage"] for p in picked] == ["pod2.mp4", "talk1.mp4"]


def _pair(cid, footage, control_ok, candidate_ok):
    ids = []
    for arm, ok in (("control", control_ok), ("candidate", candidate_ok)):
        vid = store.add_video(footage, "brief", experiment_id=cid, arm=arm)
        store.update_video(vid, status="approved" if ok else "rejected", review_approved=int(ok), video_path=f"{footage}-{arm}.mp4")
        ids.append(vid)
    return ids


def test_tie_is_broken_head_to_head(db, monkeypatch):
    winners = iter(["candidate", "candidate", "control"])
    monkeypatch.setattr(experiments.compare, "prefer", lambda *a, **k: {"winner": next(winners), "reason": "r"})
    cid = _change()
    for f in ("a.mp4", "b.mp4", "c.mp4"):
        _pair(cid, f, False, False)
    experiments.maybe_decide(cid)
    change = _status(cid)
    assert change["status"] == "promoted"
    assert change["results"]["head_to_head"] == {"candidate": 2, "control": 1, "same": 0}


def test_tie_with_even_head_to_head_rolls_back(db, monkeypatch):
    winners = iter(["candidate", "control"])
    monkeypatch.setattr(experiments.compare, "prefer", lambda *a, **k: {"winner": next(winners), "reason": "r"})
    cid = _change()
    for f in ("a.mp4", "b.mp4"):
        _pair(cid, f, True, True)
    experiments.maybe_decide(cid)
    assert _status(cid)["status"] == "rolled_back"


def test_compare_maps_shuffled_labels_back_to_arms(monkeypatch, tmp_path):
    import random

    from sisyphus_engine import compare

    (tmp_path / "k.mp4").write_bytes(b"control")
    (tmp_path / "c.mp4").write_bytes(b"candidate")
    monkeypatch.setattr(compare, "load_skills", lambda *a: "")
    seen = {}

    def fake(system, user, schema, name):
        # Remember which file was shown as A, then pick A.
        seen["a_is_candidate"] = user[1]["video_url"]["url"] == compare._video(tmp_path / "c.mp4")["video_url"]["url"]
        return {"better": "A", "reason": "Clip A has the hook."}

    monkeypatch.setattr(compare.llm, "complete_json", fake)
    for seed in range(6):
        r = compare.prefer(tmp_path / "k.mp4", tmp_path / "c.mp4", "b", None, rng=random.Random(seed))
        assert r["winner"] == ("candidate" if seen["a_is_candidate"] else "control")
        assert r["reason"].startswith("the " + ("candidate" if seen["a_is_candidate"] else "current"))
