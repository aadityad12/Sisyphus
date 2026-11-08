"""SQLite store for videos, verdicts, human feedback and proposed changes. Lives in runs/ (gitignored)."""

import json
import sqlite3
import threading
import time
from contextlib import contextmanager

from . import RUNS_DIR
from .failures import attribute_failure

DB_PATH = RUNS_DIR / "sisyphus.db"
DEFAULT_PROJECT = "default"  # the work from before projects existed (issue #14)
_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    footage TEXT NOT NULL,
    brief TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',   -- queued, creating, reviewing, approved, rejected, failed
    creator_version TEXT,
    reviewer_version TEXT,
    skills_ref TEXT,                         -- git ref the Creator's skills came from (null = working tree)
    plan TEXT,
    video_path TEXT,
    review_approved INTEGER,
    review_reason TEXT,
    review_tags TEXT,                        -- JSON list from the Reviewer: hook, pacing, framing, ...
    reviewer_ref TEXT,                       -- git ref the Reviewer is frozen at (shadow A/B), null = live
    human_liked INTEGER,                     -- null until a human votes
    error TEXT,
    experiment_id INTEGER,
    arm TEXT,                                -- 'control' or 'candidate' in a shadow A/B
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,                     -- slug [a-z0-9-]+; also the footage subfolder name
    name TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id),
    text TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (           -- engine-wide settings changed from the app
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    branch TEXT NOT NULL,
    title TEXT NOT NULL,
    rationale TEXT,
    diff TEXT,
    failure_ids TEXT,                        -- JSON list of video ids that motivated it
    status TEXT NOT NULL DEFAULT 'proposed', -- proposed, testing, promoted, rolled_back
    results TEXT,                            -- JSON shadow A/B results
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
"""


@contextmanager
def conn():
    with _lock:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(DB_PATH)
        c.row_factory = sqlite3.Row
        try:
            yield c
            c.commit()
        finally:
            c.close()


# Columns added after the first databases were created: (table, column, type).
MIGRATIONS = [
    ("videos", "review_tags", "TEXT"),
    ("videos", "reviewer_ref", "TEXT"),
    ("videos", "showcase", "INTEGER"),  # 1 = a showcase render: the demo's yardstick, never Auditor input
    ("videos", "styles_requested", "TEXT"),  # JSON list of style names the job asked for; empty or null = Auto
    ("videos", "project", f"TEXT NOT NULL DEFAULT '{DEFAULT_PROJECT}'"),  # existing videos join the default project
]


def init() -> None:
    with conn() as c:
        c.executescript(SCHEMA)
        for table, column, kind in MIGRATIONS:
            have = {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}
            if column not in have:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {column} {kind}")
        # created_at 0 keeps it first in any ordering by age.
        c.execute("INSERT OR IGNORE INTO projects (id, name, created_at) VALUES (?, 'Default', 0)", (DEFAULT_PROJECT,))


def get_setting(key: str) -> str | None:
    with conn() as c:
        row = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    with conn() as c:
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )


def _video(row: sqlite3.Row, comments: list[dict] | None = None) -> dict:
    v = dict(row)
    v["plan"] = json.loads(v["plan"]) if v["plan"] else None
    v["review_tags"] = json.loads(v["review_tags"]) if v.get("review_tags") else []
    v["styles_requested"] = json.loads(v["styles_requested"]) if v.get("styles_requested") else []
    # The video's style tags: what the Creator applied (plan.styles). Videos from before styles have none.
    v["styles"] = (v["plan"] or {}).get("styles") or []
    for k in ("review_approved", "human_liked"):
        v[k] = None if v[k] is None else bool(v[k])
    v["failed_agents"] = (
        sorted(a.value for a in attribute_failure(v["review_approved"], v["human_liked"]))
        if v["review_approved"] is not None
        else []
    )
    v["comments"] = comments or []
    return v


def add_video(footage: str, brief: str, **fields) -> int:
    now = time.time()
    cols = {"footage": footage, "brief": brief, "created_at": now, "updated_at": now, **fields}
    names, marks = ",".join(cols), ",".join("?" * len(cols))
    with conn() as c:
        if "project" not in cols:
            return c.execute(f"INSERT INTO videos ({names}) VALUES ({marks})", list(cols.values())).lastrowid
        # Only into a project that exists, in the same statement: a project deleted since the caller checked
        # would otherwise get a clip no view can list.
        cur = c.execute(
            f"INSERT INTO videos ({names}) SELECT {marks} WHERE EXISTS (SELECT 1 FROM projects WHERE id=?)",
            [*cols.values(), cols["project"]],
        )
        if not cur.rowcount:
            raise LookupError(f"no project {cols['project']}")
        return cur.lastrowid


def update_video(video_id: int, **fields) -> None:
    if "plan" in fields and not isinstance(fields["plan"], (str, type(None))):
        fields["plan"] = json.dumps(fields["plan"])
    fields["updated_at"] = time.time()
    with conn() as c:
        c.execute(f"UPDATE videos SET {','.join(f'{k}=?' for k in fields)} WHERE id=?", [*fields.values(), video_id])


def get_video(video_id: int) -> dict | None:
    with conn() as c:
        row = c.execute("SELECT * FROM videos WHERE id=?", (video_id,)).fetchone()
        if row is None:
            return None
        comments = [dict(r) for r in c.execute("SELECT * FROM comments WHERE video_id=? ORDER BY id", (video_id,))]
        return _video(row, comments)


def list_videos(
    status: str | None = None, experiment_id: int | None = None, style: str | None = None, project: str | None = None
) -> list[dict]:
    """Videos, newest first. `project` None means every project: the Auditor and the A/Bs learn from all of them."""
    q, args = "SELECT * FROM videos WHERE 1=1", []
    if project is not None:
        q += " AND project=?"
        args.append(project)
    if status:
        q += " AND status=?"
        args.append(status)
    if experiment_id is not None:
        q += " AND experiment_id=?"
        args.append(experiment_id)
    with conn() as c:
        rows = c.execute(q + " ORDER BY id DESC", args).fetchall()
        comments: dict[int, list[dict]] = {}
        for r in c.execute("SELECT * FROM comments ORDER BY id"):
            comments.setdefault(r["video_id"], []).append(dict(r))
        out = [_video(r, comments.get(r["id"])) for r in rows]
    return [v for v in out if style in v["styles"]] if style else out


def add_comment(video_id: int, text: str) -> None:
    with conn() as c:
        c.execute("INSERT INTO comments (video_id, text, created_at) VALUES (?,?,?)", (video_id, text, time.time()))


def failures() -> list[dict]:
    """Every video with at least one failed agent, with the reasons the Auditor clusters on."""
    return [
        {
            "video_id": v["id"],
            "agents": v["failed_agents"],
            "brief": v["brief"],
            "review_reason": v["review_reason"],
            "review_tags": v["review_tags"],
            "human_liked": v["human_liked"],
            "comments": [c["text"] for c in v["comments"]],
            "creator_version": v["creator_version"],
            "styles": v["styles"],
            "styles_requested": v["styles_requested"],
        }
        for v in list_videos()
        if v["failed_agents"] and v["experiment_id"] is None and not v.get("showcase")
    ]


def add_change(agent: str, branch: str, title: str, **fields) -> int:
    now = time.time()
    cols = {"agent": agent, "branch": branch, "title": title, "created_at": now, "updated_at": now, **fields}
    for k in ("failure_ids", "results"):
        if k in cols and not isinstance(cols[k], str):
            cols[k] = json.dumps(cols[k])
    with conn() as c:
        return c.execute(
            f"INSERT INTO changes ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", list(cols.values())
        ).lastrowid


def update_change(change_id: int, **fields) -> None:
    for k in ("failure_ids", "results"):
        if k in fields and not isinstance(fields[k], str):
            fields[k] = json.dumps(fields[k])
    fields["updated_at"] = time.time()
    with conn() as c:
        c.execute(f"UPDATE changes SET {','.join(f'{k}=?' for k in fields)} WHERE id=?", [*fields.values(), change_id])


def list_changes() -> list[dict]:
    with conn() as c:
        out = []
        for r in c.execute("SELECT * FROM changes ORDER BY id DESC"):
            d = dict(r)
            d["failure_ids"] = json.loads(d["failure_ids"] or "[]")
            d["results"] = json.loads(d["results"]) if d["results"] else None
            out.append(d)
        return out


def list_projects() -> list[dict]:
    """Default first, then oldest first."""
    with conn() as c:
        rows = c.execute(
            "SELECT * FROM projects ORDER BY id != ?, created_at, id", (DEFAULT_PROJECT,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_project(project_id: str) -> dict | None:
    with conn() as c:
        row = c.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        return None if row is None else dict(row)


def add_project(project_id: str, name: str) -> None:
    """Raises FileExistsError if the id is taken."""
    with conn() as c:
        try:
            c.execute("INSERT INTO projects (id, name, created_at) VALUES (?,?,?)", (project_id, name, time.time()))
        except sqlite3.IntegrityError:
            raise FileExistsError(project_id) from None


def rename_project(project_id: str, name: str) -> None:
    with conn() as c:
        c.execute("UPDATE projects SET name=? WHERE id=?", (name, project_id))


def delete_project(project_id: str) -> None:
    with conn() as c:
        c.execute("DELETE FROM projects WHERE id=?", (project_id,))


def delete_project_if_empty(project_id: str) -> bool:
    """Deletes the project only if it has no videos, in one statement. True if it was deleted."""
    with conn() as c:
        cur = c.execute(
            "DELETE FROM projects WHERE id=? AND NOT EXISTS (SELECT 1 FROM videos WHERE project=?)",
            (project_id, project_id),
        )
        return cur.rowcount > 0


def count_videos(project_id: str) -> int:
    with conn() as c:
        return c.execute("SELECT COUNT(*) FROM videos WHERE project=?", (project_id,)).fetchone()[0]
