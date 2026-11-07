"""Projects: named workspaces that organize the user's work (issue #14, VISION.md "Projects").

A project holds footage and the videos made from it. Skills, versions, styles, failures and the
Auditor's A/B tests stay shared across projects, so what the system learns in one carries to all.

The project `default` is the work from before projects existed: its footage is the root of
FOOTAGE_DIR. Any other project's footage is in FOOTAGE_DIR/<id>/, with its own optional
manifest.json in the same format. Every path to a video's footage goes through `footage_path`.
"""

import json
import re
from pathlib import Path

from . import FOOTAGE_DIR, store

DEFAULT = store.DEFAULT_PROJECT
# Windows device names: a folder called any of these can't be created (2026-11-07).
RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40].strip("-")


def footage_dir(project: str | None = DEFAULT) -> Path:
    project = project or DEFAULT
    return FOOTAGE_DIR if project == DEFAULT else FOOTAGE_DIR / project


def footage_path(project: str | None, file: str) -> Path:
    """Where a stored video's footage is. No checks: callers stat it and handle a missing file."""
    return footage_dir(project) / file


def resolve_footage(project: str | None, file: str) -> Path:
    """A footage file named by a user, checked to be directly inside the project's folder and to exist."""
    folder = footage_dir(project).resolve()
    path = (folder / file).resolve()
    if path.parent != folder or not path.is_file():
        raise FileNotFoundError(file)
    return path


def manifest(project: str | None = DEFAULT) -> list[dict]:
    """The project's raw manifest.json entries (file, title, speaker, brief, ...), or [] if it has none."""
    path = footage_dir(project) / "manifest.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def footage(project: str | None = DEFAULT) -> list[dict]:
    """The project's footage: manifest entries first, then any unlisted .mp4, only files that exist.

    Only files directly in the folder count, so the default project's listing never shows other
    projects' footage from their subfolders.
    """
    folder = footage_dir(project)
    items = manifest(project)
    known = {m["file"] for m in items}
    items += [{"file": p.name, "title": p.stem} for p in sorted(folder.glob("*.mp4")) if p.name not in known]
    return [m for m in items if Path(m["file"]).name == m["file"] and (folder / m["file"]).is_file()]


def summary(p: dict) -> dict:
    """A project row as the API returns it."""
    return {
        **p,
        "videos": store.count_videos(p["id"]),
        "footage": len(footage(p["id"])),
        "footage_dir": str(footage_dir(p["id"]).resolve()),
    }


def exists(project: str) -> bool:
    return store.get_project(project) is not None


def create(name: str) -> dict:
    """Raises ValueError for a name with no usable characters, FileExistsError if the id is taken."""
    pid = slug(name)
    if not pid:
        raise ValueError("a project needs a name with at least one letter or digit")
    if pid in RESERVED:
        raise ValueError(f"{pid} can't be a project id: Windows reserves it as a device name")
    store.add_project(pid, name.strip())  # raises FileExistsError
    footage_dir(pid).mkdir(parents=True, exist_ok=True)  # somewhere to put the footage
    return summary(store.get_project(pid))
