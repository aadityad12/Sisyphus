"""SQLite store for videos, verdicts, human feedback and proposed changes. Lives in runs/ (gitignored)."""

import json
import sqlite3
import threading
import time
from contextlib import contextmanager

from . import RUNS_DIR
from .failures import attribute_failure

DB_PATH = RUNS_DIR / "sisyphus.db"
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
    human_liked INTEGER,                     -- null until a human votes
    error TEXT,
    experiment_id INTEGER,
    arm TEXT,                                -- 'control' or 'candidate' in a shadow A/B
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL REFERENCES videos(id),
    text TEXT NOT NULL,
    created_at REAL NOT NULL
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


def init() -> None:
    with conn() as c:
        c.executescript(SCHEMA)


def _video(row: sqlite3.Row, comments: list[dict] | None = None) -> dict:
    v = dict(row)
    v["plan"] = json.loads(v["plan"]) if v["plan"] else None
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
    with conn() as c:
        cur = c.execute(
            f"INSERT INTO videos ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", list(cols.values())
        )
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


def list_videos(status: str | None = None, experiment_id: int | None = None) -> list[dict]:
    q, args = "SELECT * FROM videos WHERE 1=1", []
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
        return [_video(r, comments.get(r["id"])) for r in rows]


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
            "human_liked": v["human_liked"],
            "comments": [c["text"] for c in v["comments"]],
            "creator_version": v["creator_version"],
        }
        for v in list_videos()
        if v["failed_agents"] and v["experiment_id"] is None
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
