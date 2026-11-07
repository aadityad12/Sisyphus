"""Showcase: a fixed set of briefs rendered at every Creator version, so the demo can show improvement.

The showcase briefs are the manifest entries marked `"showcase": true`. They are the yardstick, not
training data: their clips never reach the Auditor (store.failures skips them), never serve as held-out
A/B work (experiments._held_out skips them), and stay out of the Feed and Rejected tabs.

They are rendered once at the starting version (POST /showcase) and again each time a Creator change
is promoted (experiments calls on_promote). Each render uses the Creator's skills at that version's
commit, so a re-run reproduces that version and not whatever is checked out now.

Each project has its own showcase: the entries in its own manifest, rendered into that project. A
promotion renders every project's, since the Creator's skills are shared across projects.
"""

import logging
import threading

from . import jobs, projects, store, versioning

log = logging.getLogger(__name__)
_render_lock = threading.Lock()


def entries(project: str = projects.DEFAULT) -> list[dict]:
    folder = projects.footage_dir(project)
    return [m for m in projects.manifest(project) if m.get("showcase") and m.get("brief") and (folder / m["file"]).exists()]


def is_showcase(footage: str, brief: str, project: str = projects.DEFAULT) -> bool:
    return any(m["file"] == footage and m["brief"].strip() == brief.strip() for m in entries(project))


def _videos(project: str = projects.DEFAULT) -> list[dict]:
    return [v for v in store.list_videos(project=project) if v.get("showcase")]


def render(version: str | None = None, project: str = projects.DEFAULT) -> list[int]:
    """Render every showcase brief of `project` at `version` (default: the current Creator version),
    skipping ones already rendered or in flight at that version. A failed render is retried. Returns
    the new video ids."""
    with _render_lock:
        return _render(version or versioning.agent_version("creator"), project)


def _render(version: str, project: str) -> list[int]:
    have = {
        (v["footage"], v["brief"])
        for v in _videos(project)
        if v["creator_version"] == version and v["status"] != "failed"
    }
    ids = []
    for m in entries(project):
        if (m["file"], m["brief"]) in have:
            continue
        ids.append(jobs.submit(m["file"], m["brief"], skills_ref=version, project=project, showcase=1))
    log.info("showcase: %d renders queued at %s in project %s", len(ids), version, project)
    return ids


def on_promote(version: str) -> None:
    """Called after a Creator change is promoted. Never lets a showcase problem undo a promotion."""
    for p in store.list_projects():
        try:
            render(version, p["id"])
        except Exception:
            log.exception("showcase render after promote failed in project %s", p["id"])


def _change_for(version: str, changes: list[dict]) -> dict | None:
    """The promoted change that produced this Creator version (its candidate or its merge commit)."""
    for c in changes:
        if c["agent"] != "creator" or c["status"] != "promoted":
            continue
        r = c["results"] or {}
        # results["candidate"] starts as the change's commit but becomes the arm's tally when decided,
        # so match on the merge commit and on the change branch's own commit (kept after a promote).
        refs = [r.get("merged"), versioning._git("rev-parse", "--short=12", c["branch"])]
        if any(isinstance(ref, str) and ref and (ref.startswith(version) or version.startswith(ref)) for ref in refs):
            return c
    return None


def table(project: str = projects.DEFAULT) -> dict:
    """Rows are the project's showcase briefs, columns are Creator versions in the order they first rendered."""
    vids = sorted(_videos(project), key=lambda v: v["created_at"])
    listed_entries = entries(project)
    changes = store.list_changes()
    versions: list[dict] = []
    seen: set[str] = set()
    for v in vids:
        ver = v["creator_version"]
        if ver in seen:
            continue
        seen.add(ver)
        c = _change_for(ver, changes)
        versions.append({
            "version": ver,
            "label": f"v{len(versions)}",
            "first_at": v["created_at"],
            "change": None if c is None else {"id": c["id"], "title": c["title"], "rationale": c["rationale"]},
        })
    rows = []
    listed = {(m["file"], m["brief"]) for m in listed_entries}
    keys = list(dict.fromkeys([(m["file"], m["brief"]) for m in listed_entries] + [(v["footage"], v["brief"]) for v in vids]))
    meta = {(m["file"], m["brief"]): m for m in listed_entries}
    for footage, brief in keys:
        cells = {}
        for v in vids:  # newest render per version wins
            if v["footage"] == footage and v["brief"] == brief:
                cells[v["creator_version"]] = v
        m = meta.get((footage, brief), {})
        rows.append({
            "footage": footage,
            "brief": brief,
            "title": m.get("title", footage),
            "speaker": m.get("speaker"),
            "listed": (footage, brief) in listed,
            "cells": cells,
        })
    return {"versions": versions, "rows": rows, "current": versioning.agent_version("creator")}
