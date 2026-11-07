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
