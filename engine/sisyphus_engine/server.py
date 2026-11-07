"""Local HTTP API the desktop UI talks to."""

import json
import logging
import threading

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import FOOTAGE_DIR, experiments, jobs, reviewer_ab, showcase, store, styles, versioning

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="SIsyphus engine")

app.add_middleware(
    CORSMiddleware,
    # Vite dev server and the Tauri webview origins.
    allow_origins=["http://localhost:1420", "tauri://localhost", "http://tauri.localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)

store.init()
jobs.resume_unfinished()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "versions": versioning.current_versions()}


@app.get("/footage")
def footage() -> list[dict]:
    manifest = FOOTAGE_DIR / "manifest.json"
    items = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else []
    known = {m["file"] for m in items}
    items += [{"file": p.name, "title": p.stem} for p in sorted(FOOTAGE_DIR.glob("*.mp4")) if p.name not in known]
    return [m for m in items if (FOOTAGE_DIR / m["file"]).exists()]


@app.get("/footage/{name}/file")
def footage_file(name: str):
    path = (FOOTAGE_DIR / name).resolve()
    if path.parent != FOOTAGE_DIR.resolve() or not path.exists():
        raise HTTPException(404)
    return FileResponse(path, media_type="video/mp4")


class JobIn(BaseModel):
    footage: str
    brief: str
    styles: list[str] = []  # editing styles to apply; empty = Auto


@app.post("/jobs")
def create_job(job: JobIn) -> dict:
    known = set(styles.names())
    unknown = [s for s in job.styles if s not in known]
    if unknown:
        raise HTTPException(422, f"no style named {', '.join(unknown)}")
    try:
        return {"id": jobs.submit(job.footage, job.brief, styles=job.styles)}
    except FileNotFoundError:
        raise HTTPException(404, f"no footage named {job.footage}")


@app.get("/styles")
def style_library() -> list[dict]:
    """The editing styles: name, title, summary, and both files (the Reviewer's may be null)."""
    return styles.library()


class StyleIn(BaseModel):
    name: str
    how_to_edit: str
    what_good_looks_like: str


@app.post("/styles")
def add_style(body: StyleIn) -> dict:
    """A person adds a style. It is committed straight in, with no A/B (issue #13)."""
    try:
        return styles.create(body.name, body.how_to_edit, body.what_good_looks_like)
    except FileExistsError:
        raise HTTPException(409, f"a style named {styles.slug(body.name)} already exists")
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except RuntimeError as exc:  # the commit or merge failed
        raise HTTPException(500, str(exc))


@app.get("/videos")
def videos(status: str | None = None, experiment_id: int | None = None, style: str | None = None) -> list[dict]:
    return store.list_videos(status, experiment_id, style)


@app.get("/videos/{video_id}")
def video(video_id: int) -> dict:
    v = store.get_video(video_id)
    if v is None:
        raise HTTPException(404)
    return v


@app.get("/videos/{video_id}/file")
def video_file(video_id: int):
    v = store.get_video(video_id)
    if v is None or not v["video_path"]:
        raise HTTPException(404)
    return FileResponse(v["video_path"], media_type="video/mp4")


class ReviewIn(BaseModel):
    approved: bool
    reason: str


@app.post("/videos/{video_id}/review")
def review(video_id: int, body: ReviewIn) -> dict:
    """Record a Reviewer verdict (for a Reviewer running outside the engine)."""
    jobs.record_review(video_id, body.approved, body.reason)
    return store.get_video(video_id)


class FeedbackIn(BaseModel):
    liked: bool | None = None
    comment: str | None = None


@app.post("/videos/{video_id}/feedback")
def feedback(video_id: int, body: FeedbackIn) -> dict:
    """Human feedback: a like/dislike (null clears it) and/or a comment."""
    if store.get_video(video_id) is None:
        raise HTTPException(404)
    if "liked" in body.model_fields_set:
        store.update_video(video_id, human_liked=None if body.liked is None else int(body.liked))
    if body.comment:
        store.add_comment(video_id, body.comment)
    jobs._settle(video_id)  # a human vote can decide a shadow A/B
    reviewer_ab.on_vote()  # ... or a Reviewer change waiting for human votes
    return store.get_video(video_id)


@app.get("/failures")
def failures() -> list[dict]:
    return store.failures()


@app.get("/versions")
def versions() -> dict:
    return {
        "current": versioning.current_versions(),
        "history": {a: versioning.history(a) for a in versioning.AGENTS},
        "changes": store.list_changes(),
    }


@app.get("/showcase")
def showcase_table() -> dict:
    """Showcase briefs x Creator versions: the before/after for the demo."""
    return showcase.table()


@app.post("/showcase")
def showcase_render(version: str | None = None) -> dict:
    """Render the showcase briefs at a Creator version (default: current). Already-rendered ones are skipped."""
    return {"queued": showcase.render(version)}


@app.post("/audit")
def audit(agent: str = "creator") -> dict:
    """Start an Auditor pass in the background: cluster failures, propose a change, start its A/B."""
    if experiments.status["state"] in ("clustering", "proposing"):
        raise HTTPException(409, "an audit is already running")

    def run():
        try:
            experiments.run_audit(agent)
        except Exception:
            logging.exception("audit failed")

    threading.Thread(target=run, daemon=True).start()
    return experiments.status


@app.get("/audit")
def audit_status() -> dict:
    return experiments.status
