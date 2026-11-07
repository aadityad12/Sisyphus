"""Versioned agent changes: one Git branch per proposed change (see VISION.md).

An agent's version is the short hash of the last commit touching its skills or its code.
TODO: the Auditor creates a branch per change, runs the shadow A/B, then merges (promotes) or deletes (rolls back).
"""

import subprocess

from . import REPO_ROOT

AGENTS = ("creator", "reviewer", "auditor")

# What counts as each agent's "version": its skills plus the code and tools it runs.
AGENT_PATHS = {
    "creator": ["skills/creator", "engine/sisyphus_engine/agents/creator.py", "engine/sisyphus_engine/render.py",
                "engine/sisyphus_engine/plan.py"],
    "reviewer": ["skills/reviewer", "engine/sisyphus_engine/agents/reviewer.py"],
    "auditor": ["skills/auditor", "engine/sisyphus_engine/agents/auditor.py"],
}


def _git(*args: str) -> str:
    try:
        out = subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, check=True)
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return ""


def agent_version(agent: str) -> str:
    return _git("log", "-1", "--format=%h", "--", *AGENT_PATHS[agent]) or "unknown"


def current_versions() -> dict[str, str]:
    return {agent: agent_version(agent) for agent in AGENTS}


def history(agent: str, limit: int = 20) -> list[dict]:
    """Commits that changed an agent, newest first."""
    out = _git("log", f"-{limit}", "--format=%h%x09%ct%x09%s", "--", *AGENT_PATHS[agent])
    rows = []
    for line in out.splitlines():
        h, ts, subject = line.split("\t", 2)
        rows.append({"version": h, "time": int(ts), "subject": subject})
    return rows


# --- One branch per change -------------------------------------------------------------------------
# Change branches are built with Git plumbing in a temporary index, so proposing a change never touches
# the working tree that running jobs read their skills from.

import os
import tempfile


def _git_env(*args: str, env: dict | None = None, input: str | None = None) -> str:
    out = subprocess.run(
        ["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, check=True,
        env={**os.environ, **(env or {})}, input=input, encoding="utf-8",
    )
    return out.stdout.strip()


def head() -> str:
    return _git_env("rev-parse", "HEAD")


def current_branch() -> str:
    return _git_env("branch", "--show-current")


def create_change_branch(branch: str, files: dict[str, str], message: str, base: str | None = None) -> str:
    """Commit `files` (repo-relative path -> new content) on top of `base` as `branch`. Returns the commit."""
    base = base or head()
    fd, index = tempfile.mkstemp(prefix="si-index-")
    os.close(fd)
    os.unlink(index)
    env = {"GIT_INDEX_FILE": index}
    try:
        _git_env("read-tree", base, env=env)
        for path, content in files.items():
            blob = _git_env("hash-object", "-w", "--stdin", input=content)
            _git_env("update-index", "--add", "--cacheinfo", f"100644,{blob},{path}", env=env)
        tree = _git_env("write-tree", env=env)
        commit = _git_env("commit-tree", tree, "-p", base, "-m", message)
        _git_env("update-ref", f"refs/heads/{branch}", commit)
        return commit
    finally:
        if os.path.exists(index):
            os.unlink(index)


def diff(base: str, ref: str, paths: list[str] | None = None) -> str:
    return _git_env("diff", base, ref, "--", *(paths or []))


def promote(branch: str) -> str:
    """Adopt a change: merge its branch into the checked-out branch. Returns the merge commit."""
    _git_env("merge", "--no-ff", "-m", f"Promote {branch}: it won its shadow A/B", branch)
    return head()


def roll_back(branch: str) -> None:
    """Discard a change. A tag keeps its commit so the history of what was tried is never lost."""
    _git_env("tag", "-f", f"rolled-back/{branch}", branch)
    _git_env("branch", "-D", branch)
