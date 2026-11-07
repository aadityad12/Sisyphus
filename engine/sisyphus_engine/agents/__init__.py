"""The three agents. Each one loads its skills from `skills/<agent>/` at runtime."""

from .. import SKILLS_DIR


def load_skills(agent: str) -> str:
    """Concatenate an agent's skill files (all `.md` except README.md) for its prompt."""
    folder = SKILLS_DIR / agent
    files = [p for p in sorted(folder.glob("*.md")) if p.name.lower() != "readme.md"]
    return "\n\n".join(p.read_text(encoding="utf-8") for p in files)
