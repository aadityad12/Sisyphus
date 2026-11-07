"""Showcase: a fixed set of briefs rendered at every Creator version, so the demo can show improvement.

The showcase briefs are the manifest entries marked `"showcase": true`. They are the yardstick, not
training data: their clips never reach the Auditor (store.failures skips them), never serve as held-out
A/B work (experiments._held_out skips them), and stay out of the Feed and Rejected tabs.

They are rendered once at the starting version (POST /showcase) and again each time a Creator change
is promoted (experiments calls on_promote). Each render uses the Creator's skills at that version's
commit, so a re-run reproduces that version and not whatever is checked out now.
"""

import json
import logging

from . import FOOTAGE_DIR, jobs, store, versioning

log = logging.getLogger(__name__)


def entries() -> list[dict]:
    manifest = FOOTAGE_DIR / "manifest.json"
    items = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else []
    return [m for m in items if m.get("showcase") and m.get("brief") and (FOOTAGE_DIR / m["file"]).exists()]


def _videos() -> list[dict]:
    return [v for v in store.list_videos() if v.get("showcase")]


def render(version: str | None = None) -> list[int]:
    """Render every showcase brief at `version` (default: the current Creator version), skipping ones
    already rendered or in flight at that version. A failed render is retried. Returns the new video ids."""
    version = version or versioning.agent_version("creator")
    have = {(v["footage"], v["brief"]) for v in _videos() if v["creator_version"] == version and v["status"] != "failed"}
    ids = []
    for m in entries():
        if (m["file"], m["brief"]) in have:
            continue
        ids.append(jobs.submit(m["file"], m["brief"], skills_ref=version, showcase=1))
    log.info("showcase: %d renders queued at %s", len(ids), version)
    return ids


def on_promote(version: str) -> None:
    """Called after a Creator change is promoted. Never lets a showcase problem undo a promotion."""
    try:
        render(version)
    except Exception:
        log.exception("showcase render after promote failed")


def _change_for(version: str, changes: list[dict]) -> dict | None:
    """The promoted change that produced this Creator version (its candidate or its merge commit)."""
    for c in changes:
        if c["agent"] != "creator" or c["status"] != "promoted":
            continue
        r = c["results"] or {}
        refs = [r.get("candidate"), r.get("merged"), c["branch"]]
        if any(ref and (ref.startswith(version) or version.startswith(ref)) for ref in refs):
            return c
    return None


def table() -> dict:
    """Rows are showcase briefs, columns are Creator versions in the order they first rendered."""
    vids = sorted(_videos(), key=lambda v: v["created_at"])
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
    listed = {(m["file"], m["brief"]) for m in entries()}
    keys = list(dict.fromkeys([(m["file"], m["brief"]) for m in entries()] + [(v["footage"], v["brief"]) for v in vids]))
    meta = {(m["file"], m["brief"]): m for m in entries()}
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
