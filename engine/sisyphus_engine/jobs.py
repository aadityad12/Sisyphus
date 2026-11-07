"""Background jobs: create a video, then hand it to the Reviewer."""

import json
import logging
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import FOOTAGE_DIR, RUNS_DIR, store, versioning
from .agents import creator, reviewer

log = logging.getLogger(__name__)
executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="job")


def video_dir(video_id: int) -> Path:
    return RUNS_DIR / "videos" / str(video_id)


def submit(footage: str, brief: str, skills_ref: str | None = None, **fields) -> int:
    path = FOOTAGE_DIR / footage
    if not path.exists():
        raise FileNotFoundError(footage)
    video_id = store.add_video(
        footage,
        brief,
        skills_ref=skills_ref,
        creator_version=skills_ref or versioning.agent_version("creator"),
        **fields,
    )
    executor.submit(_run, video_id, path, brief, skills_ref)
    return video_id


def _run(video_id: int, footage: Path, brief: str, skills_ref: str | None) -> None:
    try:
        store.update_video(video_id, status="creating")
        plan, video = creator.create(footage, brief, video_dir(video_id), skills_ref=skills_ref)
        store.update_video(video_id, status="reviewing", plan=plan.model_dump(), video_path=str(video))
    except Exception as exc:
        log.exception("creator failed for video %s", video_id)
        store.update_video(video_id, status="failed", error=f"{exc}\n{traceback.format_exc()[-1500:]}")
        return
    run_review(video_id)


def run_review(video_id: int) -> None:
    """Ask the Reviewer. Until the Reviewer is built, the video waits in 'reviewing' for POST /videos/{id}/review."""
    v = store.get_video(video_id)
    try:
        verdict = reviewer.review(Path(v["video_path"]), v["brief"])
    except NotImplementedError:
        return
    except Exception as exc:
        log.exception("reviewer failed for video %s", video_id)
        store.update_video(video_id, error=f"reviewer: {exc}")
        return
    record_review(video_id, verdict.approved, verdict.reason)


def record_review(video_id: int, approved: bool, reason: str) -> None:
    store.update_video(
        video_id,
        review_approved=int(approved),
        review_reason=reason,
        reviewer_version=versioning.agent_version("reviewer"),
        status="approved" if approved else "rejected",
    )


def plan_json(video_id: int) -> str:
    return json.dumps(store.get_video(video_id)["plan"], indent=2)
