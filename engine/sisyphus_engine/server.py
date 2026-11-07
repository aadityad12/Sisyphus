"""Local HTTP API the desktop UI talks to."""

import json
import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import FOOTAGE_DIR, jobs, store, versioning

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


@app.post("/jobs")
def create_job(job: JobIn) -> dict:
    try:
        return {"id": jobs.submit(job.footage, job.brief)}
    except FileNotFoundError:
        raise HTTPException(404, f"no footage named {job.footage}")


@app.get("/videos")
def videos(status: str | None = None, experiment_id: int | None = None) -> list[dict]:
    return store.list_videos(status, experiment_id)


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
