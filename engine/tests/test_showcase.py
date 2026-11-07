import json

import pytest

from sisyphus_engine import showcase, store


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "t.db")
    store.init()
    footage = tmp_path / "footage"
    footage.mkdir()
    for name in ("a.mp4", "b.mp4", "c.mp4"):
        (footage / name).write_bytes(b"x")
    (footage / "manifest.json").write_text(json.dumps([
        {"file": "a.mp4", "title": "A", "brief": "brief a", "showcase": True},
        {"file": "b.mp4", "title": "B", "brief": "brief b", "showcase": True},
        {"file": "c.mp4", "title": "C", "brief": "brief c"},
    ]))
    monkeypatch.setattr(showcase, "FOOTAGE_DIR", footage)
    version = {"v": "aaa1111"}
    monkeypatch.setattr(showcase.versioning, "agent_version", lambda agent: version["v"])
    submitted = []

    def submit(footage, brief, skills_ref=None, **fields):
        vid = store.add_video(footage, brief, skills_ref=skills_ref, creator_version=skills_ref, **fields)
        submitted.append((footage, skills_ref, fields))
        return vid

    real_submit = showcase.jobs.submit
    monkeypatch.setattr(showcase.jobs, "submit", submit)
    return {"version": version, "submitted": submitted, "real_submit": real_submit}


def test_renders_only_showcase_briefs_once_per_version(env):
    assert len(showcase.render()) == 2
    assert {s[0] for s in env["submitted"]} == {"a.mp4", "b.mp4"}
    assert all(s[1] == "aaa1111" and s[2] == {"showcase": 1} for s in env["submitted"])
    assert showcase.render() == []  # already rendered at this version
    env["version"]["v"] = "bbb2222"
    assert len(showcase.render()) == 2


def test_a_failed_render_is_retried(env):
    first = showcase.render()
    store.update_video(first[0], status="failed")
    assert len(showcase.render()) == 1


def test_table_has_a_column_per_version_and_names_the_change(env):
    showcase.render()
    store.add_change("creator", "si/creator/1-hook", "Open on the claim", status="promoted",
                     results={"candidate": "bbb22223", "merged": "ccc33334"})
    env["version"]["v"] = "bbb2222"
    showcase.render()
    t = showcase.table()
    assert [v["label"] for v in t["versions"]] == ["v0", "v1"]
    assert t["versions"][0]["change"] is None
    assert t["versions"][1]["change"]["title"] == "Open on the claim"
    assert [r["footage"] for r in t["rows"]] == ["a.mp4", "b.mp4"]
    assert set(t["rows"][0]["cells"]) == {"aaa1111", "bbb2222"}


def test_showcase_clips_never_reach_the_auditor(env):
    vid = showcase.render()[0]
    store.update_video(vid, review_approved=0, status="rejected")
    assert store.failures() == []


def test_a_studio_job_on_a_showcase_brief_is_marked_showcase(env, monkeypatch):
    from sisyphus_engine import jobs

    monkeypatch.setattr(jobs, "FOOTAGE_DIR", showcase.FOOTAGE_DIR)
    monkeypatch.setattr(jobs.executor, "submit", lambda *a, **k: None)
    monkeypatch.setattr(jobs.versioning, "agent_version", lambda agent: "aaa1111")
    same = env["real_submit"]("a.mp4", " brief a ")
    other = env["real_submit"]("a.mp4", "a different brief")
    assert store.get_video(same)["showcase"] == 1
    assert not store.get_video(other)["showcase"]


def test_concurrent_renders_queue_each_clip_once(env):
    import threading

    threads = [threading.Thread(target=showcase.render) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(env["submitted"]) == 2
