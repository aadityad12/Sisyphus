"""SIsyphus engine: the Creator, Reviewer and Auditor agents behind a local HTTP API."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SKILLS_DIR = REPO_ROOT / "skills"
RUNS_DIR = REPO_ROOT / "runs"  # gitignored: transcripts, renders, the database
FOOTAGE_DIR = REPO_ROOT / "footage"  # gitignored: raw demo footage
