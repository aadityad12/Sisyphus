"""Background jobs: create a video, then hand it to the Reviewer."""

import json
import os
import logging
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

from . import RUNS_DIR, projects, store, versioning
from . import render
from .agents import creator, reviewer
from .transcribe import transcribe
from .transcribe import words as transcript_words

log = logging.getLogger(__name__)

# How many videos are edited and reviewed at once. Jobs mostly wait on the model API and a render takes ~10 s of
# CPU, so the old default of 2 left briefs queued for minutes behind two slow model calls (issue #35).
# SISYPHUS_WORKERS sets the starting value; once someone picks one in the app, the stored setting wins.
DEFAULT_WORKERS = 6
MAX_WORKERS = 16


class _Slots:
    """A limit on running jobs that, unlike a ThreadPoolExecutor's max_workers, can change while jobs run.

    Lowering it lets running jobs finish and holds the next ones back; raising it starts queued ones at once.
    """

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.active = 0
        self._cv = threading.Condition()

    def set(self, limit: int) -> None:
        with self._cv:
            self.limit = limit
            self._cv.notify_all()

    @contextmanager
    def held(self):
        with self._cv:
            self._cv.wait_for(lambda: self.active < self.limit)
            self.active += 1
        try:
            yield
        finally:
            with self._cv:
                self.active -= 1
                self._cv.notify_all()


def _clamp(n: int) -> int:
    return max(1, min(MAX_WORKERS, n))


slots = _Slots(_clamp(int(os.environ.get("SISYPHUS_WORKERS", DEFAULT_WORKERS))))
# Enough threads that every job allowed to run has one; queued jobs wait on `slots`, in a thread or in the pool's
# queue. Shadow A/B scoring (reviewer_ab) also runs here, outside the limit.
executor = ThreadPoolExecutor(max_workers=MAX_WORKERS * 2, thread_name_prefix="job")
_settings_lock = threading.Lock()  # so two saves at once can't leave the stored value and the live one different


def load_settings() -> None:
    """Apply the worker count saved from the app, if any. Called once the store exists."""
    saved = store.get_setting("workers")
    if saved is not None:
        slots.set(_clamp(int(saved)))


def set_workers(n: int) -> int:
    """Run up to `n` jobs at once from now on, and remember it across restarts."""
    if not 1 <= n <= MAX_WORKERS:
        raise ValueError(f"workers must be between 1 and {MAX_WORKERS}")
    with _settings_lock:
        store.set_setting("workers", str(n))
        slots.set(n)
    return n
# A clip the Reviewer sends back goes back to the Creator, with the reasons, until it passes or runs out of
# attempts. The cap is attempts in all, the first included, so a clip that keeps failing doesn't spend forever.
MAX_ATTEMPTS = int(os.environ.get("SISYPHUS_MAX_ATTEMPTS", "3"))
_revise_lock = threading.Lock()


def video_dir(video_id: int) -> Path:
    return RUNS_DIR / "videos" / str(video_id)


def submit(
    footage: str,
    brief: str,
    skills_ref: str | None = None,
    styles: list[str] | None = None,
    project: str = projects.DEFAULT,
    **fields,
) -> int:
    """Queue one video in `project`, from footage in that project's folder. `styles` are the editing
    styles asked for; none means Auto (the Creator picks). Raises FileNotFoundError for missing footage."""
    brief = brief.strip()  # so a showcase brief typed with stray spaces is the same brief everywhere
    path = projects.resolve_footage(project, footage)
    from . import showcase  # showcase imports jobs

    if showcase.is_showcase(footage, brief, project):
        # The demo's yardstick, even when started from the Studio: it must never feed the Auditor or an A/B.
        fields["showcase"] = 1
    video_id = store.add_video(
        footage,
        brief,
        project=project,
        skills_ref=skills_ref,
        creator_version=skills_ref or versioning.agent_version("creator"),
        styles_requested=json.dumps(list(styles)) if styles else None,
        **fields,
    )
    executor.submit(_run, video_id, path, brief, skills_ref, styles or None)
    return video_id


def resume_unfinished() -> int:
    """Re-run jobs a restart interrupted (the dev server reloads on every save). Returns how many."""
    videos = store.list_videos()
    stuck = [v for v in videos if v["status"] in ("queued", "creating")]
    for v in reversed(stuck):
        store.update_video(v["id"], status="queued")
        executor.submit(_run, v["id"], projects.footage_path(v["project"], v["footage"]), v["brief"], v["skills_ref"], v["styles_requested"])
    # A restart during a review leaves a rendered video with no verdict: review it again.
    unreviewed = [v for v in videos if v["status"] == "reviewing" and v["video_path"] and v["review_approved"] is None]
    for v in reversed(unreviewed):
        executor.submit(_review_in_slot, v["id"])
    # Rejections from before revisions existed, or whose revision a restart lost: send them back now.
    revised = [vid for v in reversed(videos) if v["status"] == "rejected" and (vid := revise(v["id"])) is not None]
    return len(stuck) + len(unreviewed) + len(revised)


def can_revise(v: dict) -> bool:
    """Whether a verdict sends this clip back to the Creator. A/B and showcase clips are measurements, judged
    on their first attempt, and a clip a person has already called good needs no second one."""
    return (
        v["status"] == "rejected"
        and v["experiment_id"] is None
        and not v.get("showcase")
        and v["human_liked"] is not True
        and settled_ancestor(v) is None
        and v["revised_by"] is None
        and v["attempt"] < MAX_ATTEMPTS
    )


def settled_ancestor(v: dict) -> dict | None:
    """An earlier attempt in this clip's chain that no longer needs another try: a person liked it, or its
    verdict was changed to an approval that no person has disliked. Any such attempt makes every later one moot."""
    while v and v.get("revision_of"):
        v = store.get_video(v["revision_of"])
        if v and (v["human_liked"] is True or (v["status"] != "rejected" and v["human_liked"] is not False)):
            return v
    return None


def revise(video_id: int) -> int | None:
    """Queue a new attempt at a rejected clip, with the Reviewer's reasons. Returns its id, or None if the clip
    isn't one to revise. The rejected video stays as it is: it is still a Creator failure for the Auditor."""
    with _revise_lock:  # a restart's resume and a fresh verdict must not both revise one clip
        v = store.get_video(video_id)
        if not v or not can_revise(v):
            return None
        try:
            return submit(
                v["footage"],
                v["brief"],
                skills_ref=v["skills_ref"],
                styles=v["styles_requested"] or None,
                project=v["project"],
                revision_of=video_id,
                attempt=v["attempt"] + 1,
            )
        except (FileNotFoundError, LookupError) as exc:  # footage or project removed since
            log.warning("can't revise video %s: %s", video_id, exc)
            return None


def history(video_id: int) -> list[dict]:
    """The Reviewer's verdicts on the attempts before this one, oldest first."""
    out = []
    v = store.get_video(video_id)
    while v and v.get("revision_of"):
        v = store.get_video(v["revision_of"])
        if v:
            out.append({"reason": v["review_reason"], "tags": v["review_tags"], "plan": v["plan"]})
    return out[::-1]


def _review_in_slot(video_id: int) -> None:
    with slots.held():
        run_review(video_id)


def _run(video_id: int, footage: Path, brief: str, skills_ref: str | None, styles: list[str] | None = None) -> None:
    # The slot covers the Creator, the render and the Reviewer: a video waits in 'queued' until one is free.
    with slots.held():
        _create_and_review(video_id, footage, brief, skills_ref, styles)


def _create_and_review(
    video_id: int, footage: Path, brief: str, skills_ref: str | None, styles: list[str] | None
) -> None:
    # A person rescued an earlier attempt, or approved it by hand, while this one waited: it needs no further
    # try. Checked once the slot is held, so a change that comes in while the job is queued still counts.
    done = settled_ancestor(store.get_video(video_id) or {})
    if done:
        why = "a person liked" if done["human_liked"] is True else "it was approved by hand,"
        # Detached from its parent, so if the verdict is turned back to a rejection the clip can be revised again.
        store.update_video(
            video_id, status="failed", revision_of=None, error=f"Not needed: {why} #{done['id']}."
        )
        return
    try:
        store.update_video(video_id, status="creating")
        plan, video = creator.create(
            footage, brief, video_dir(video_id), skills_ref=skills_ref, styles=styles, history=history(video_id)
        )
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
            transcript=transcribe(projects.footage_path(v["project"], v["footage"])),
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
    if not approved:
        revise(video_id)


def _settle(video_id: int) -> None:
    """If the video belongs to a shadow A/B, see whether that experiment can be decided."""
    v = store.get_video(video_id)
    if v and v["experiment_id"] is not None:
        from . import experiments  # experiments imports jobs

        experiments.maybe_decide(v["experiment_id"])


def plan_json(video_id: int) -> str:
    return json.dumps(store.get_video(video_id)["plan"], indent=2)
