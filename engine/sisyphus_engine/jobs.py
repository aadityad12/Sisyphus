"""Background jobs: create a video, then hand it to the Reviewer."""

import json
import os
import logging
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import FOOTAGE_DIR, RUNS_DIR, store, versioning
from . import render
from .agents import creator, reviewer
from .transcribe import transcribe
from .transcribe import words as transcript_words

log = logging.getLogger(__name__)
# Jobs mostly wait on the model API; a render takes ~10 s of CPU.
executor = ThreadPoolExecutor(max_workers=int(os.environ.get("SISYPHUS_WORKERS", "2")), thread_name_prefix="job")


def video_dir(video_id: int) -> Path:
    return RUNS_DIR / "videos" / str(video_id)


def submit(footage: str, brief: str, skills_ref: str | None = None, **fields) -> int:
    brief = brief.strip()  # so a showcase brief typed with stray spaces is the same brief everywhere
    path = (FOOTAGE_DIR / footage).resolve()
    if path.parent != FOOTAGE_DIR.resolve() or not path.exists():
        raise FileNotFoundError(footage)
    from . import showcase  # showcase imports jobs

    if showcase.is_showcase(footage, brief):
        # The demo's yardstick, even when started from the Studio: it must never feed the Auditor or an A/B.
        fields["showcase"] = 1
    video_id = store.add_video(
        footage,
        brief,
        skills_ref=skills_ref,
        creator_version=skills_ref or versioning.agent_version("creator"),
        **fields,
    )
    executor.submit(_run, video_id, path, brief, skills_ref)
    return video_id


def resume_unfinished() -> int:
    """Re-run jobs a restart interrupted (the dev server reloads on every save). Returns how many."""
    videos = store.list_videos()
    stuck = [v for v in videos if v["status"] in ("queued", "creating")]
    for v in reversed(stuck):
        store.update_video(v["id"], status="queued")
        executor.submit(_run, v["id"], FOOTAGE_DIR / v["footage"], v["brief"], v["skills_ref"])
    # A restart during a review leaves a rendered video with no verdict: review it again.
    unreviewed = [v for v in videos if v["status"] == "reviewing" and v["video_path"] and v["review_approved"] is None]
    for v in reversed(unreviewed):
        executor.submit(run_review, v["id"])
    return len(stuck) + len(unreviewed)


def _run(video_id: int, footage: Path, brief: str, skills_ref: str | None) -> None:
    try:
        store.update_video(video_id, status="creating")
        plan, video = creator.create(footage, brief, video_dir(video_id), skills_ref=skills_ref)
        stored = plan.model_dump()
        # The cut points the renderer actually used, so later changes to snapping don't rewrite history.
        stored["rendered_segments"] = [
            s.model_dump() for s in render.timeline(plan, transcript_words(transcribe(footage)))[0]
        ]
        store.update_video(video_id, status="reviewing", plan=stored, video_path=str(video))
    except Exception as exc:
        log.exception("creator failed for video %s", video_id)
        store.update_video(video_id, status="failed", error=f"{exc}\n{traceback.format_exc()[-1500:]}")
        _settle(video_id)
        return
    run_review(video_id)


def run_review(video_id: int, reviewer_ref: str | None = None) -> None:
    """Ask the Reviewer. A failed review leaves the video in 'reviewing' for POST /videos/{id}/review.

    `reviewer_ref` (or the video row's `reviewer_ref`, set at the start of a shadow A/B) freezes the
    Reviewer's skills at that Git ref, so a Creator change is judged by the Reviewer it started with.
    """
    v = store.get_video(video_id)
    ref = reviewer_ref or v.get("reviewer_ref")
    try:
        verdict = reviewer.review(
            Path(v["video_path"]),
            v["brief"],
            plan=v["plan"],
            transcript=transcribe(FOOTAGE_DIR / v["footage"]),
            ref=ref,
        )
    except NotImplementedError:
        return
    except Exception as exc:
        log.exception("reviewer failed for video %s", video_id)
        store.update_video(video_id, error=f"reviewer: {exc}")
        return
    record_review(video_id, verdict.approved, verdict.reason, tags=verdict.tags, reviewer_version=ref)


def record_review(
    video_id: int, approved: bool, reason: str, tags: list[str] | None = None, reviewer_version: str | None = None
) -> None:
    fields = {}
    if tags:
        if "review_tags" in (store.get_video(video_id) or {}):
            fields["review_tags"] = json.dumps(tags)
        else:  # no column yet: keep the tags in the reason, which the Auditor clusters on
            reason = f"[{', '.join(tags)}] {reason}"
    store.update_video(
        video_id,
        review_approved=int(approved),
        review_reason=reason,
        reviewer_version=(reviewer_version or versioning.agent_version("reviewer"))[:12],
        status="approved" if approved else "rejected",
        **fields,
    )
    _settle(video_id)


def _settle(video_id: int) -> None:
    """If the video belongs to a shadow A/B, see whether that experiment can be decided."""
    v = store.get_video(video_id)
    if v and v["experiment_id"] is not None:
        from . import experiments  # experiments imports jobs

        experiments.maybe_decide(v["experiment_id"])


def plan_json(video_id: int) -> str:
    return json.dumps(store.get_video(video_id)["plan"], indent=2)
