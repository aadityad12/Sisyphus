"""Shadow A/B for a Reviewer change: whichever version agrees with humans more often wins.

A Reviewer never grades itself (VISION.md). Instead, both versions re-review the same held-out clips
that humans have already voted on: approved clips people liked or disliked, and rejected clips people
rescued from the rejected-videos tab. A verdict agrees when it matches the human vote. The change is
adopted only if it agrees strictly more often; a tie keeps the current version.

No new videos are rendered. Shadow verdicts go in the change's results and never touch a video's own
review fields. Held-out means the clips the change was not written from.
"""

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import FOOTAGE_DIR, store, versioning
from .agents import reviewer
from .transcribe import transcribe

log = logging.getLogger(__name__)

MIN_VIDEOS = int(os.environ.get("SISYPHUS_REVIEWER_AB_MIN", "4"))
MAX_VIDEOS = int(os.environ.get("SISYPHUS_REVIEWER_AB_MAX", "8"))
_running: set[int] = set()
_rerun: set[int] = set()  # asked to run while running: new votes may have arrived since its snapshot
_lock = threading.Lock()


def held_out(exclude_ids: set[int], limit: int = MAX_VIDEOS) -> list[dict]:
    """Rendered clips with a human vote, newest first, leaving out the ones the change came from."""
    return [
        v
        for v in store.list_videos()
        if v["human_liked"] is not None
        and not v.get("showcase")
        and v["id"] not in exclude_ids
        and v["video_path"]
        and Path(v["video_path"]).exists()
    ][:limit]


def _review(v: dict, ref: str) -> dict:
    try:
        r = reviewer.review(
            Path(v["video_path"]),
            v["brief"],
            plan=v["plan"],
            transcript=transcribe(FOOTAGE_DIR / v["footage"]),
            ref=ref,
        )
        return {"approved": r.approved, "agrees": r.approved == v["human_liked"], "reason": r.reason, "tags": r.tags}
    except Exception as exc:  # a crash counts against its arm
        log.exception("shadow review of video %s at %s failed", v["id"], ref)
        return {"approved": None, "agrees": False, "reason": f"error: {exc}", "tags": []}


def score(videos: list[dict], control_ref: str, candidate_ref: str, workers: int = 4) -> dict:
    """Review every clip with both versions. Returns per-arm agreement and per-video verdicts."""
    jobs = [(v, arm, ref) for v in videos for arm, ref in (("control", control_ref), ("candidate", candidate_ref))]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        verdicts = list(pool.map(lambda j: _review(j[0], j[2]), jobs))
    arms = {a: {"agree": 0, "total": 0} for a in ("control", "candidate")}
    per_video: dict[int, dict] = {}
    for (v, arm, _), verdict in zip(jobs, verdicts):
        arms[arm]["total"] += 1
        arms[arm]["agree"] += int(verdict["agrees"])
        per_video.setdefault(v["id"], {"video_id": v["id"], "human_liked": v["human_liked"]})[arm] = verdict
    return {**arms, "per_video": list(per_video.values())}


def run(change_id: int) -> None:
    """Score a Reviewer change and promote or roll it back. Waits if too few clips have human votes."""
    with _lock:
        if change_id in _running:
            _rerun.add(change_id)
            return
        _running.add(change_id)
    try:
        while True:
            _run_once(change_id)
            with _lock:
                if change_id not in _rerun:
                    _running.discard(change_id)
                    return
                _rerun.discard(change_id)
    except BaseException:
        with _lock:
            _running.discard(change_id)
            _rerun.discard(change_id)
        raise


def _run_once(change_id: int) -> None:
    change = None
    try:
        change = next((c for c in store.list_changes() if c["id"] == change_id), None)
        if change is None or change["agent"] != "reviewer" or change["status"] != "testing":
            return
        results = {k: v for k, v in (change["results"] or {}).items() if k != "waiting_for_votes"}
        base = results.get("base") or versioning.head()
        videos = held_out(set(change["failure_ids"]))
        if len(videos) < MIN_VIDEOS:
            results["waiting_for_votes"] = f"{len(videos)} of {MIN_VIDEOS} held-out clips have a human vote"
            store.update_change(change_id, results=results)
            return

        results.update(score(videos, base, change["branch"]))
        won = results["candidate"]["agree"] > results["control"]["agree"]
        from .experiments import _decide_lock  # experiments imports this module

        with _decide_lock:  # one git merge at a time, whichever agent's change it is
            if won:
                results["merged"] = versioning.promote(change["branch"])[:8]
                store.update_change(change_id, status="promoted", results=results)
            else:
                versioning.roll_back(change["branch"])
                store.update_change(change_id, status="rolled_back", results=results)
        log.info("reviewer change %s %s", change_id, "promoted" if won else "rolled back")
    except Exception as exc:
        log.exception("reviewer A/B %s failed", change_id)
        store.update_change(change_id, results={**((change or {}).get("results") or {}), "error": str(exc)})


def submit(change_id: int) -> None:
    """Run the A/B in the background job pool."""
    from .jobs import executor  # jobs imports experiments, which will import this module

    executor.submit(run, change_id)


def on_vote() -> None:
    """A human vote may give a waiting Reviewer change enough held-out clips to be decided."""
    with _lock:
        running = set(_running)
    for c in store.list_changes():
        if c["agent"] != "reviewer" or c["status"] != "testing":
            continue
        # A run in progress may have taken its snapshot before this vote: run() queues one more pass.
        if c["id"] in running or (c["results"] or {}).get("waiting_for_votes"):
            submit(c["id"])
