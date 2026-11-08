"""A clip the Reviewer sends back goes back to the Creator, with the reasons, until it passes or runs out."""

import pytest

from sisyphus_engine import jobs, projects, store
from sisyphus_engine.agents import creator


@pytest.fixture
def db(tmp_path, monkeypatch):
    root = tmp_path / "footage"
    root.mkdir()
    (root / "a.mp4").write_bytes(b"a")
    monkeypatch.setattr(projects, "FOOTAGE_DIR", root)
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "t.db")
    monkeypatch.setattr(jobs.versioning, "agent_version", lambda agent: "aaa1111")
    store.init()
    queued = []
    monkeypatch.setattr(jobs.executor, "submit", lambda fn, *a: queued.append((fn, a)))
    return queued


def _rejected(**fields):
    vid = store.add_video("a.mp4", "30s on X", **fields)
    store.update_video(vid, plan={"title": "first cut", "segments": []}, video_path="v.mp4")
    jobs.record_review(vid, False, "The hook is slow.", tags=["hook"], reviewer_version="bbb2222")
    return vid


def _revisions():
    return [v for v in store.list_videos() if v["revision_of"] is not None]


def test_a_rejection_queues_a_revision_and_keeps_the_rejected_clip(db):
    vid = _rejected(styles_requested='["podcast"]')
    (rev,) = _revisions()
    assert rev["revision_of"] == vid and rev["attempt"] == 2 and rev["styles_requested"] == ["podcast"]
    # The rejected clip is still a rejection, for the Rejected tab and the Auditor, and points at its revision.
    old = store.get_video(vid)
    assert old["status"] == "rejected" and old["revised_by"] == rev["id"]
    assert [fn for fn, _ in db][-1] is jobs._run


def test_the_revision_is_told_why(db):
    vid = _rejected()
    (rev,) = _revisions()
    assert jobs.history(rev["id"]) == [
        {"reason": "The hook is slow.", "tags": ["hook"], "plan": {"title": "first cut", "segments": []}}
    ]
    prompt = creator.revision_prompt(jobs.history(rev["id"]))
    assert "Attempt 1 [hook]: The hook is slow." in prompt and "first cut" in prompt
    assert creator.revision_prompt([]) == ""
    assert store.get_video(vid)["revised_by"] == rev["id"]


def test_revisions_stop_at_the_cap(db, monkeypatch):
    monkeypatch.setattr(jobs, "MAX_ATTEMPTS", 2)
    _rejected()
    (rev,) = _revisions()
    store.update_video(rev["id"], plan={"segments": []}, video_path="v.mp4")
    jobs.record_review(rev["id"], False, "Still slow.")
    assert len(_revisions()) == 1  # attempt 2 of 2 was the last


@pytest.mark.parametrize("fields", [{"experiment_id": 1, "arm": "control"}, {"showcase": 1}])
def test_measurements_are_not_revised(db, fields):
    _rejected(**fields)
    assert _revisions() == []


def test_approval_and_a_human_like_need_no_revision(db):
    vid = store.add_video("a.mp4", "brief")
    jobs.record_review(vid, True, "Good.")
    vid2 = store.add_video("a.mp4", "brief")
    store.update_video(vid2, human_liked=1)
    jobs.record_review(vid2, False, "Meh.")
    assert _revisions() == []


def test_restart_sends_back_old_rejections_once(db):
    vid = store.add_video("a.mp4", "brief")
    store.update_video(vid, status="rejected", review_approved=0, review_reason="Old.")  # from before revisions
    assert jobs.resume_unfinished() == 1
    jobs.resume_unfinished()  # re-queues the still-queued revision, but doesn't revise the old clip again
    (rev,) = _revisions()
    assert rev["revision_of"] == vid


def test_the_creator_prompt_carries_the_reasons(db, monkeypatch, tmp_path):
    seen = {}

    def fake_complete(system, user, *a, **k):
        seen["text"] = user[0]["text"]
        raise RuntimeError("stop here")

    monkeypatch.setattr(creator, "probe", lambda f: {"duration": 60, "width": 1920, "height": 1080})
    monkeypatch.setattr(creator, "transcribe", lambda f: [])
    monkeypatch.setattr(creator, "as_prompt_text", lambda t: "")
    monkeypatch.setattr(creator, "frame_at", lambda *a: None)
    monkeypatch.setattr(creator.llm, "image_part", lambda f: {})
    monkeypatch.setattr(creator, "load_skills", lambda *a: "")
    monkeypatch.setattr(creator.llm, "complete_json", fake_complete)
    with pytest.raises(RuntimeError):
        creator.make_plan(tmp_path / "a.mp4", "brief", tmp_path, history=[{"reason": "Too slow.", "tags": [], "plan": None}])
    assert "Attempt 1: Too slow." in seen["text"]


def test_missing_footage_is_not_an_error(db):
    vid = store.add_video("gone.mp4", "brief")
    store.update_video(vid, status="rejected", review_approved=0)
    assert jobs.revise(vid) is None


def test_a_revision_skips_a_clip_a_person_rescued(db, monkeypatch):
    vid = _rejected()
    (rev,) = _revisions()
    store.update_video(vid, human_liked=1)
    monkeypatch.setattr(creator, "create", lambda *a, **k: pytest.fail("the Creator ran"))
    jobs._run(rev["id"], projects.FOOTAGE_DIR / "a.mp4", "30s on X", None)
    assert store.get_video(rev["id"])["status"] == "failed"


def test_the_auditor_counts_a_brief_once_however_often_it_is_sent_back(db, monkeypatch):
    monkeypatch.setattr(jobs, "MAX_ATTEMPTS", 2)
    vid = _rejected()
    (rev,) = _revisions()
    store.update_video(rev["id"], plan={"segments": []}, video_path="v.mp4")
    jobs.record_review(rev["id"], False, "Still slow.")
    assert [f["video_id"] for f in store.failures()] == [vid]
    store.update_video(rev["id"], review_approved=1, status="approved", human_liked=0)  # approved, then disliked
    assert {f["video_id"] for f in store.failures()} == {vid, rev["id"]}


def _reject_again(rev_id, reason="Still slow."):
    store.update_video(rev_id, plan={"segments": []}, video_path="v.mp4")
    jobs.record_review(rev_id, False, reason)


def test_a_rescued_original_leaves_the_later_rejection_as_creator_evidence(db):
    vid = _rejected()
    (rev,) = _revisions()
    _reject_again(rev["id"])
    store.update_video(vid, human_liked=1)  # attempt 1 is now the Reviewer's failure, not the Creator's
    by_id = {f["video_id"]: f["agents"] for f in store.failures()}
    assert by_id == {vid: ["reviewer"], rev["id"]: ["creator"]}


def test_liking_attempt_one_stops_a_queued_attempt_three(db, monkeypatch):
    vid = _rejected()
    (rev,) = _revisions()
    _reject_again(rev["id"])
    third = next(v for v in _revisions() if v["attempt"] == 3)
    store.update_video(vid, human_liked=1)
    monkeypatch.setattr(creator, "create", lambda *a, **k: pytest.fail("the Creator ran"))
    jobs._run(third["id"], projects.FOOTAGE_DIR / "a.mp4", "30s on X", None)
    assert store.get_video(third["id"])["status"] == "failed"
    assert jobs.revise(third["id"]) is None


def test_a_hand_verdict_changed_to_approval_cancels_its_revision(db, monkeypatch):
    vid = store.add_video("a.mp4", "brief")
    jobs.record_review(vid, False, "By hand: no.")
    (rev,) = _revisions()
    jobs.record_review(vid, True, "By hand: actually yes.")
    monkeypatch.setattr(creator, "create", lambda *a, **k: pytest.fail("the Creator ran"))
    jobs._run(rev["id"], projects.FOOTAGE_DIR / "a.mp4", "brief", None)
    assert "approved by hand" in store.get_video(rev["id"])["error"]
