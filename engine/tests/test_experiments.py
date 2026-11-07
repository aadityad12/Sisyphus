import pytest

from sisyphus_engine import experiments, store


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "t.db")
    store.init()
    calls = []
    monkeypatch.setattr(experiments.versioning, "promote", lambda b: calls.append(("promote", b)) or "abcdef1234")
    monkeypatch.setattr(experiments.versioning, "roll_back", lambda b: calls.append(("roll_back", b)))
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
