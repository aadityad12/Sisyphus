"""SIsyphus engine: the Creator, Reviewer and Auditor agents behind a local HTTP API."""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SKILLS_DIR = REPO_ROOT / "skills"
# Both gitignored. Overridable so a second checkout (a worktree) can share one footage folder.
RUNS_DIR = Path(os.environ.get("SISYPHUS_RUNS_DIR", REPO_ROOT / "runs"))  # transcripts, renders, database
FOOTAGE_DIR = Path(os.environ.get("SISYPHUS_FOOTAGE_DIR", REPO_ROOT / "footage"))  # raw demo footage
