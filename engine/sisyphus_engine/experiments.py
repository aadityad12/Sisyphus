"""The improvement loop: audit failures -> change branch -> shadow A/B on held-out work -> promote or roll back.

A Creator change is judged on new work: the Creator runs each held-out (footage, brief) twice, once with
the current skills (control) and once with the change's branch (candidate). Each clip is judged by the
Reviewer, and a human vote, when there is one, overrides the Reviewer's verdict (VISION.md). The
candidate is adopted only if it passes strictly more clips; a tie keeps the current version.
"""

import json
import logging
import os
import re
import threading
import time

from . import FOOTAGE_DIR, jobs, store, versioning
from .agents import auditor

log = logging.getLogger(__name__)
AB_SIZE = int(os.environ.get("SISYPHUS_AB_SIZE", "3"))
_lock = threading.Lock()

# What the Auditor is doing right now, for the UI.
status: dict = {"state": "idle", "detail": "", "updated_at": time.time()}


def _set(state: str, detail: str = "") -> None:
    status.update(state=state, detail=detail, updated_at=time.time())
    log.info("auditor: %s %s", state, detail)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "change"


def _consumed_failure_ids() -> set[int]:
    """Failures already handled by a change that is in flight or was adopted."""
    return {
        i for c in store.list_changes() if c["status"] in ("proposed", "testing", "promoted") for i in c["failure_ids"]
    }


def _held_out(exclude_footage: set[str], n: int) -> list[dict]:
    """New work for the A/B: footage the failure cluster didn't come from, with its suggested brief."""
    manifest = FOOTAGE_DIR / "manifest.json"
    items = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else []
    items = [m for m in items if m.get("brief") and (FOOTAGE_DIR / m["file"]).exists()]
    fresh = [m for m in items if m["file"] not in exclude_footage]
    picked = (fresh or items)[:n]
    return [{"footage": m["file"], "brief": m["brief"]} for m in picked]


def run_audit(agent: str = "creator") -> int | None:
    """One Auditor pass. Returns the id of the change it started testing, or None if no pattern yet."""
    if not _lock.acquire(blocking=False):
        raise RuntimeError("an audit is already running")
    try:
        consumed = _consumed_failure_ids()
        failures = [f for f in store.failures() if agent in f["agents"] and f["video_id"] not in consumed]
        _set("clustering", f"{len(failures)} unaddressed {agent} failures")
        clusters = auditor.cluster(failures)
        if not clusters:
            _set("idle", f"No pattern yet: {len(failures)} failures, need {auditor.MIN_CLUSTER} with one cause")
            return None
        top = clusters[0]
        _set("proposing", f"{top['label']} ({len(top['video_ids'])} failures)")
        rolled_back = [c for c in store.list_changes() if c["agent"] == agent and c["status"] == "rolled_back"]
        proposal = auditor.propose(agent, top, failures, rolled_back)

        base = versioning.head()
        n = len(store.list_changes()) + 1
        branch = f"si/{agent}/{n}-{_slug(proposal['title'])}"
        commit = versioning.create_change_branch(
            branch, proposal["files"], f"{proposal['title']}\n\n{proposal['rationale']}", base=base
        )
        change_id = store.add_change(
            agent,
            branch,
            proposal["title"],
            rationale=f"{top['label']}: {proposal['rationale']}",
            diff=versioning.diff(base, commit),
            failure_ids=top["video_ids"],
            status="testing",
            results={"base": base[:8], "candidate": commit[:8], "cluster": top["label"]},
        )

        footage_in_cluster = {v["footage"] for v in store.list_videos() if v["id"] in set(top["video_ids"])}
        work = _held_out(footage_in_cluster, AB_SIZE)
        _set("testing", f"{branch}: {len(work)} held-out clips × 2 arms")
        for w in work:
            jobs.submit(w["footage"], w["brief"], skills_ref=base[:12], experiment_id=change_id, arm="control")
            jobs.submit(w["footage"], w["brief"], skills_ref=branch, experiment_id=change_id, arm="candidate")
        return change_id
    except Exception as exc:
        _set("error", str(exc))
        raise
    finally:
        _lock.release()


def _passed(v: dict) -> bool | None:
    """A clip passes if humans liked it; failing a human vote, if the Reviewer approved it."""
    if v["human_liked"] is not None:
        return v["human_liked"]
    return v["review_approved"]


def maybe_decide(change_id: int) -> None:
    """Once every A/B clip has a verdict, promote the winner and roll back the loser."""
    change = next((c for c in store.list_changes() if c["id"] == change_id), None)
    if change is None or change["status"] != "testing":
        return
    videos = store.list_videos(experiment_id=change_id)
    arms: dict[str, dict] = {"control": {"approved": 0, "total": 0, "human": 0}, "candidate": {"approved": 0, "total": 0, "human": 0}}
    pending = 0
    for v in videos:
        if v["status"] == "failed":
            arms[v["arm"]]["total"] += 1  # a crash counts against the arm
            continue
        verdict = _passed(v)
        if verdict is None:
            pending += 1
            continue
        a = arms[v["arm"]]
        a["total"] += 1
        a["approved"] += int(verdict)
        a["human"] += int(v["human_liked"] is not None)
    results = {**(change["results"] or {}), **arms, "pending": pending}
    if pending:
        store.update_change(change_id, results=results)
        return
    won = arms["candidate"]["approved"] > arms["control"]["approved"]
    try:
        if won:
            results["merged"] = versioning.promote(change["branch"])[:8]
            store.update_change(change_id, status="promoted", results=results)
        else:
            versioning.roll_back(change["branch"])
            store.update_change(change_id, status="rolled_back", results=results)
        _set("idle", f"{change['branch']} {'promoted' if won else 'rolled back'}")
    except Exception as exc:
        log.exception("deciding change %s failed", change_id)
        store.update_change(change_id, results={**results, "error": str(exc)})
