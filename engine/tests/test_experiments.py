import json

import pytest

from sisyphus_engine import experiments, jobs, store


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


def test_waits_for_clips_not_yet_submitted(db):
    cid = store.add_change("creator", "si/creator/1-x", "x", status="testing", results={"expected": 4})
    _arm(cid, "control", False)  # the first clip finished before the rest were submitted
    experiments.maybe_decide(cid)
    change = _status(cid)
    assert change["status"] == "testing"
    assert change["results"]["pending"] == 3


# run_audit end to end (hearty-ermine's repro of the P1 fixed in 16d4fb3 and c589de5, 2026-11-07). The
# executor runs each job inside jobs.submit: the extreme case of a worker settling the first clip while
# run_audit is still submitting the rest.


class _Inline:
    """Runs each job at once, inside submit. Like a real executor, a job's exception stays with the job
    (kept in .errors) instead of reaching run_audit, where it would look like a failed submit."""

    def __init__(self):
        self.errors: list[Exception] = []

    def submit(self, fn, *args, **kwargs):
        try:
            fn(*args, **kwargs)
        except Exception as exc:
            self.errors.append(exc)


@pytest.fixture
def audit(db, tmp_path, monkeypatch):
    """A Creator audit over two held-out talks (2 × 2 arms = 4 clips) with everything but the A/B faked.
    Returns the decisions as (promote|roll_back, number of the change's clips that existed at the time)."""
    footage = tmp_path / "footage"
    footage.mkdir()
    for name in ("a.mp4", "c.mp4", "d.mp4"):
        (footage / name).write_bytes(b"x")
    (footage / "manifest.json").write_text(json.dumps([
        {"file": "a.mp4", "brief": "brief a", "showcase": True},
        {"file": "c.mp4", "brief": "brief c", "kind": "talk"},
        {"file": "d.mp4", "brief": "brief d", "kind": "talk"},
    ]))
    for module in (jobs, experiments.showcase, experiments):
        monkeypatch.setattr(module, "FOOTAGE_DIR", footage)
    executor = _Inline()
    monkeypatch.setattr(jobs, "executor", executor)
    monkeypatch.setattr(experiments, "AB_SIZE", 2)
    monkeypatch.setattr(experiments, "status", {"state": "idle", "detail": ""})  # run_audit leaves it set

    def no_model(*a, **k):
        raise AssertionError("a tie with rendered clips would ask the real Reviewer to compare them")

    monkeypatch.setattr(experiments.compare, "prefer", no_model)

    decisions = []

    def clips():  # how many clips the change under test has when it is decided
        testing = [c["id"] for c in store.list_changes() if c["status"] == "testing"]
        return len(store.list_videos(experiment_id=testing[0])) if testing else -1

    v = experiments.versioning
    monkeypatch.setattr(v, "promote", lambda branch: decisions.append(("promote", clips())) or "abcdef1234")
    monkeypatch.setattr(v, "roll_back", lambda branch: decisions.append(("roll_back", clips())))
    monkeypatch.setattr(v, "head", lambda: "base1234567890")
    monkeypatch.setattr(v, "create_change_branch", lambda *a, **k: "cand1234567890")
    monkeypatch.setattr(v, "diff", lambda a, b: "")
    monkeypatch.setattr(v, "full_ref", lambda ref: "rev1234567890")
    monkeypatch.setattr(v, "agent_version", lambda agent: "v1")
    monkeypatch.setattr(experiments.store, "failures", lambda: [{"video_id": 99, "agents": ["creator"]}])
    monkeypatch.setattr(experiments.auditor, "cluster", lambda failures: [{"label": "x", "video_ids": [99]}])
    monkeypatch.setattr(experiments.auditor, "propose", lambda *a: {"title": "t", "rationale": "r", "files": {}})
    yield decisions
    assert executor.errors == []  # every job ran to completion


def _judge_by_arm(monkeypatch):
    """Skip the Creator: every control clip is sent back and every candidate clip approved."""

    def run(video_id, footage, brief, skills_ref):
        candidate = store.get_video(video_id)["arm"] == "candidate"
        store.update_video(video_id, status="approved" if candidate else "rejected", review_approved=int(candidate))
        jobs._settle(video_id)

    monkeypatch.setattr(jobs, "_run", run)


def test_audit_decides_once_every_clip_exists_when_clips_crash(audit, monkeypatch):
    def crash(*a, **k):
        raise RuntimeError("fast crash")

    monkeypatch.setattr(jobs.creator, "create", crash)
    cid = experiments.run_audit("creator")
    assert audit == [("roll_back", 4)]  # before 16d4fb3: [("roll_back", 1)], on the first clip alone
    change = _status(cid)
    assert change["status"] == "rolled_back"
    assert (change["results"]["control"]["total"], change["results"]["candidate"]["total"]) == (2, 2)


def test_audit_promotes_on_all_clips_not_the_first(audit, monkeypatch):
    _judge_by_arm(monkeypatch)
    cid = experiments.run_audit("creator")
    change = _status(cid)
    # Before 16d4fb3 the first control's rejection alone tied 0-0 and rolled the change back.
    assert audit == [("promote", 4)]
    assert change["status"] == "promoted"
    assert (change["results"]["candidate"]["approved"], change["results"]["control"]["approved"]) == (2, 0)


def test_audit_decides_on_the_clips_submitted_when_a_submit_raises(audit, monkeypatch):
    _judge_by_arm(monkeypatch)
    real_submit, calls = jobs.submit, []

    def submit(*args, **kwargs):  # the second talk's footage vanishes before its first clip is submitted
        calls.append(args[0])
        if len(calls) == 3:
            raise FileNotFoundError(args[0])
        return real_submit(*args, **kwargs)

    monkeypatch.setattr(jobs, "submit", submit)
    with pytest.raises(FileNotFoundError):
        experiments.run_audit("creator")
    (change,) = store.list_changes()
    # Before c589de5 the change waited forever for 2 clips that were never submitted.
    assert audit == [("promote", 2)]
    assert change["status"] == "promoted"
    assert change["results"]["expected"] == 2
