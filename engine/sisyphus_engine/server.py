"""Local HTTP API the desktop UI talks to."""

import logging
import threading

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import cuts, experiments, jobs, projects, reviewer_ab, showcase, store, styles, versioning

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


def _project(project_id: str) -> dict:
    p = store.get_project(project_id)
    if p is None:
        raise HTTPException(404, f"no project named {project_id}")
    return p


ALL_PROJECTS = "*"


@app.get("/projects")
def project_list() -> list[dict]:
    """Every project with its video and footage counts. Default first, then oldest first."""
    return [projects.summary(p) for p in store.list_projects()]


class ProjectIn(BaseModel):
    name: str


@app.post("/projects")
def project_create(body: ProjectIn) -> dict:
    """A new project. Its id is the name as a slug, and its footage folder is created empty."""
    try:
        return projects.create(body.name)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except FileExistsError:
        raise HTTPException(409, f"a project with id {projects.slug(body.name)} already exists")


@app.patch("/projects/{project_id}")
def project_rename(project_id: str, body: ProjectIn) -> dict:
    """Renames only: the id, and so the footage folder, stay."""
    _project(project_id)
    if not body.name.strip():
        raise HTTPException(422, "a project needs a name")
    store.rename_project(project_id, body.name.strip())
    return projects.summary(_project(project_id))


@app.delete("/projects/{project_id}")
def project_delete(project_id: str) -> dict:
    """Deletes an empty project's row. Its footage folder stays on disk."""
    _project(project_id)
    if project_id == projects.DEFAULT:
        raise HTTPException(409, "the default project can't be deleted")
    # One statement checks for clips and deletes, so a clip started meanwhile can't be orphaned.
    if not store.delete_project_if_empty(project_id):
        n = store.count_videos(project_id)
        raise HTTPException(409, f"project {project_id} still has {n} video{'s' if n != 1 else ''}; delete them first")
    return {"deleted": project_id}


@app.get("/footage")
def footage(project: str = projects.DEFAULT) -> list[dict]:
    _project(project)
    return projects.footage(project)


@app.get("/footage/{name}/file")
def footage_file(name: str, project: str = projects.DEFAULT):
    _project(project)
    try:
        path = projects.resolve_footage(project, name)
    except FileNotFoundError:
        raise HTTPException(404)
    return FileResponse(path, media_type="video/mp4")


class JobIn(BaseModel):
    footage: str
    brief: str
    styles: list[str] = []  # editing styles to apply; empty = Auto
    project: str = projects.DEFAULT


@app.post("/jobs")
def create_job(job: JobIn) -> dict:
    _project(job.project)
    known = set(styles.names())
    unknown = [s for s in job.styles if s not in known]
    if unknown:
        raise HTTPException(422, f"no style named {', '.join(unknown)}")
    try:
        return {"id": jobs.submit(job.footage, job.brief, styles=job.styles, project=job.project)}
    except FileNotFoundError:
        raise HTTPException(404, f"no footage named {job.footage} in project {job.project}")


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
def videos(
    status: str | None = None, experiment_id: int | None = None, style: str | None = None, project: str = projects.DEFAULT
) -> list[dict]:
    """The project's videos, or every project's with `project=*` (the agents' activity and the shared
    learning views span projects). Asked for by experiment_id, an A/B's clips come from every project:
    A/B work is shared machinery, not one project's (VISION.md, Projects)."""
    if project != ALL_PROJECTS:
        _project(project)
    every = project == ALL_PROJECTS or experiment_id is not None
    return store.list_videos(status, experiment_id, style, project=None if every else project)


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


@app.get("/videos/{video_id}/transcript")
def video_transcript(video_id: int) -> dict:
    """The source transcript around each kept segment, for showing what the Creator kept and cut."""
    v = store.get_video(video_id)
    if v is None or not v["plan"]:
        raise HTTPException(404)
    try:
        return cuts.for_video(v)
    except FileNotFoundError:
        raise HTTPException(404, f"footage {v['footage']} is missing")
    except cuts.NotCached:
        raise HTTPException(404, f"no cached transcript for {v['footage']}")


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
def showcase_table(project: str = projects.DEFAULT) -> dict:
    """The project's showcase briefs x Creator versions: the before/after for the demo."""
    _project(project)
    return showcase.table(project)


@app.post("/showcase")
def showcase_render(version: str | None = None, project: str = projects.DEFAULT) -> dict:
    """Render the project's showcase briefs at a Creator version (default: current). Already-rendered ones are skipped."""
    _project(project)
    return {"queued": showcase.render(version, project)}


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
