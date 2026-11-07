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

    monkeypatch.setattr(showcase.jobs, "submit", submit)
    return {"version": version, "submitted": submitted}


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
