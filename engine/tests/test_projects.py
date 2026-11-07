import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from sisyphus_engine import cuts, jobs, projects, store


@pytest.fixture
def footage(tmp_path, monkeypatch):
    """footage/ with a.mp4 at the root (the default project) and project x's b.mp4 in footage/x/."""
    root = tmp_path / "footage"
    (root / "x").mkdir(parents=True)
    (root / "a.mp4").write_bytes(b"a")
    (root / "x" / "b.mp4").write_bytes(b"b")
    (root / "x" / "manifest.json").write_text(json.dumps([
        {"file": "b.mp4", "title": "B talk", "brief": "brief b", "showcase": True},
    ]))
    monkeypatch.setattr(projects, "FOOTAGE_DIR", root)
    return root


@pytest.fixture
def client(tmp_path, monkeypatch, footage):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "t.db")
    # Importing the server runs store.init() and resumes unfinished jobs: keep both off the real runs/.
    monkeypatch.setattr(jobs, "resume_unfinished", lambda: 0)
    store.init()
    from sisyphus_engine import server

    submitted = []
    monkeypatch.setattr(jobs.executor, "submit", lambda fn, *a: submitted.append(a))
    monkeypatch.setattr(jobs.versioning, "agent_version", lambda agent: "aaa1111")
    c = TestClient(server.app)
    c.submitted = submitted
    return c


def test_migration_moves_existing_videos_into_the_default_project(tmp_path, monkeypatch):
    db = tmp_path / "old.db"
    old = sqlite3.connect(db)
    # The videos table as the first databases had it: no project, and none of the later columns.
    old.executescript("""
        CREATE TABLE videos (id INTEGER PRIMARY KEY AUTOINCREMENT, footage TEXT NOT NULL, brief TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued', creator_version TEXT, reviewer_version TEXT, skills_ref TEXT,
            plan TEXT, video_path TEXT, review_approved INTEGER, review_reason TEXT, human_liked INTEGER,
            error TEXT, experiment_id INTEGER, arm TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL);
        INSERT INTO videos (footage, brief, created_at, updated_at) VALUES ('a.mp4', 'old brief', 1, 1);
    """)
    old.commit()
    old.close()
    monkeypatch.setattr(store, "DB_PATH", db)
    store.init()
    store.init()  # idempotent
    assert store.get_video(1)["project"] == "default"
    assert [p["id"] for p in store.list_projects()] == ["default"]
    assert store.list_projects()[0]["name"] == "Default"
    assert store.count_videos("default") == 1


def test_create_rename_delete(client, footage):
    assert [p["id"] for p in client.get("/projects").json()] == ["default"]

    r = client.post("/projects", json={"name": "  Acme Client: Q4!  "})
    assert r.status_code == 200
    p = r.json()
    assert p["id"] == "acme-client-q4" and p["name"] == "Acme Client: Q4!"
    assert p["videos"] == 0 and p["footage"] == 0 and isinstance(p["created_at"], float)
    assert (footage / "acme-client-q4").is_dir()
    assert p["footage_dir"] == str((footage / "acme-client-q4").resolve())

    assert client.post("/projects", json={"name": "acme client q4"}).status_code == 409
    assert client.post("/projects", json={"name": "Default"}).status_code == 409
    for bad in ("", "  ", "!!!"):
        r = client.post("/projects", json={"name": bad})
        assert r.status_code == 422 and "detail" in r.json()

    client.post("/projects", json={"name": "Second"})
    assert [p["id"] for p in client.get("/projects").json()] == ["default", "acme-client-q4", "second"]

    r = client.patch("/projects/acme-client-q4", json={"name": "Acme"})
    assert r.status_code == 200 and r.json()["id"] == "acme-client-q4" and r.json()["name"] == "Acme"
    assert client.patch("/projects/nope", json={"name": "x"}).status_code == 404
    assert client.patch("/projects/second", json={"name": " "}).status_code == 422

    assert client.delete("/projects/default").status_code == 409
    assert client.delete("/projects/nope").status_code == 404
    store.add_video("b.mp4", "brief", project="second")
    r = client.delete("/projects/second")
    assert r.status_code == 409 and "1 video" in r.json()["detail"]
    assert client.delete("/projects/acme-client-q4").json() == {"deleted": "acme-client-q4"}
    assert (footage / "acme-client-q4").is_dir()  # the folder stays
    assert [p["id"] for p in client.get("/projects").json()] == ["default", "second"]


def test_project_counts(client):
    store.add_project("x", "X")
    store.add_video("b.mp4", "brief", project="x")
    by_id = {p["id"]: p for p in client.get("/projects").json()}
    assert (by_id["x"]["videos"], by_id["x"]["footage"]) == (1, 1)
    assert (by_id["default"]["videos"], by_id["default"]["footage"]) == (0, 1)  # x/b.mp4 is not the root's


def test_videos_are_filtered_by_project(client):
    store.add_project("x", "X")
    a = store.add_video("a.mp4", "brief a")
    b = store.add_video("b.mp4", "brief b", project="x", status="approved")
    ab = store.add_video("a.mp4", "ab clip", experiment_id=7, arm="control")

    assert {v["id"] for v in client.get("/videos").json()} == {a, ab}
    vids = client.get("/videos", params={"project": "x"}).json()
    assert [v["id"] for v in vids] == [b] and vids[0]["project"] == "x"
    assert client.get("/videos", params={"project": "x", "status": "rejected"}).json() == []
    # An A/B's clips come back by experiment id whichever project is asked for.
    assert [v["id"] for v in client.get("/videos", params={"project": "x", "experiment_id": 7}).json()] == [ab]
    assert client.get("/videos", params={"project": "nope"}).status_code == 404
    assert client.get(f"/videos/{b}").json()["project"] == "x"
    # `*` lists every project's clips, for the views that span projects.
    assert {v["id"] for v in client.get("/videos", params={"project": "*"}).json()} == {a, b, ab}


def test_reserved_windows_names_are_refused(client):
    for name in ("CON", "nul", "Com1"):
        assert client.post("/projects", json={"name": name}).status_code == 422
    assert [p["id"] for p in client.get("/projects").json()] == ["default"]


def test_delete_refuses_a_project_with_clips(client):
    store.add_project("x", "X")
    store.add_video("b.mp4", "brief", project="x")
    assert client.delete("/projects/x").status_code == 409
    assert store.delete_project_if_empty("x") is False
    assert store.get_project("x") is not None


def test_footage_is_listed_and_served_per_project(client):
    store.add_project("x", "X")
    assert [m["file"] for m in client.get("/footage").json()] == ["a.mp4"]  # not x/b.mp4
    x = client.get("/footage", params={"project": "x"}).json()
    assert [(m["file"], m["title"]) for m in x] == [("b.mp4", "B talk")]
    assert client.get("/footage", params={"project": "nope"}).status_code == 404

    assert client.get("/footage/b.mp4/file", params={"project": "x"}).content == b"b"
    assert client.get("/footage/b.mp4/file").status_code == 404
    assert client.get("/footage/a.mp4/file", params={"project": "x"}).status_code == 404


def test_a_job_in_a_project_uses_that_projects_footage(client, footage, monkeypatch):
    store.add_project("x", "X")
    r = client.post("/jobs", json={"footage": "b.mp4", "brief": "a brief", "project": "x"})
    assert r.status_code == 200
    v = store.get_video(r.json()["id"])
    assert v["project"] == "x"
    assert client.submitted[-1][1] == (footage / "x" / "b.mp4").resolve()  # _run's footage argument

    assert client.post("/jobs", json={"footage": "b.mp4", "brief": "a brief"}).status_code == 404
    assert client.post("/jobs", json={"footage": "b.mp4", "brief": "b", "project": "nope"}).status_code == 404
    assert store.get_video(client.post("/jobs", json={"footage": "a.mp4", "brief": "b"}).json()["id"])["project"] == "default"

    # A stored video finds its footage in its project's folder (the transcript view, the Reviewer, ...).
    assert projects.footage_path(v["project"], v["footage"]) == footage / "x" / "b.mp4"
    assert projects.footage_path(None, "a.mp4") == footage / "a.mp4"
    seen = []
    monkeypatch.setattr(cuts, "_cache_path", lambda path: seen.append(path) or footage / "missing.json")
    with pytest.raises(cuts.NotCached):
        cuts.for_video({**v, "plan": {"title": "t", "hook": "", "segments": [{"start": 0, "end": 1}]}})
    assert seen == [footage / "x" / "b.mp4"]


def test_showcase_is_per_project(client):
    store.add_project("x", "X")
    assert client.get("/showcase").json()["rows"] == []
    assert client.post("/showcase").json() == {"queued": []}
    queued = client.post("/showcase", params={"project": "x"}).json()["queued"]
    assert len(queued) == 1 and store.get_video(queued[0])["project"] == "x"
    assert store.get_video(queued[0])["showcase"] == 1
    rows = client.get("/showcase", params={"project": "x"}).json()["rows"]
    assert [(r["footage"], r["title"]) for r in rows] == [("b.mp4", "B talk")]
    assert client.get("/showcase", params={"project": "nope"}).status_code == 404


def test_a_clip_cannot_be_added_to_a_missing_project(client):
    import pytest

    with pytest.raises(LookupError):
        store.add_video("b.mp4", "brief", project="gone")
    assert client.get("/videos", params={"project": "*"}).json() == []
