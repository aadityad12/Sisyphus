"""The three agents. Each one loads its skills from `skills/<agent>/` at runtime."""

import subprocess

from .. import REPO_ROOT, SKILLS_DIR


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, check=True).stdout


def load_skills(agent: str, ref: str | None = None) -> str:
    """Concatenate an agent's skill files (all `.md` except README.md) for its prompt.

    With `ref` (a branch or commit), read the skills as they are at that ref without checking it out.
    This is how a proposed change runs side by side with the current version in a shadow A/B.
    """
    if ref is None:
        folder = SKILLS_DIR / agent
        files = [p for p in sorted(folder.glob("*.md")) if p.name.lower() != "readme.md"]
        return "\n\n".join(p.read_text(encoding="utf-8") for p in files)
    names = _git("ls-tree", "--name-only", ref, f"skills/{agent}/").split()
    names = sorted(n for n in names if n.endswith(".md") and not n.lower().endswith("readme.md"))
    return "\n\n".join(_git("show", f"{ref}:{n}") for n in names)
