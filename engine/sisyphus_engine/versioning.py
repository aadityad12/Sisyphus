"""Versioned agent changes: one Git branch per proposed change (see VISION.md).

TODO: create a branch per Auditor change, run the shadow A/B, then merge (promote) or discard (roll back).
"""

import subprocess

from . import REPO_ROOT

AGENTS = ("creator", "reviewer", "auditor")


def _head() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def current_versions() -> dict[str, str]:
    """For now every agent's version is the current commit."""
    head = _head()
    return {agent: head for agent in AGENTS}
