"""Editing styles: brain rot, simple, polished, artsy, and whatever people or the Auditor add.

A style is two skill files (issue #13):

- `skills/creator/styles/<name>.md`: how to edit in that style. The Creator loads it when a job asks for
  the style, or picks it on Auto.
- `skills/reviewer/styles/<name>.md`: the Reviewer's own idea of a good clip in that style. It loads it
  for every clip that used the style.

They are separate so each side improves through its own A/B: a Creator change can't lower the bar it is
judged against. Each file starts with `# <Title>`, then one paragraph that is its summary (the picker
shows it, and the Creator reads it on Auto), then the rules.

Style files sit in a subfolder, so `load_skills` (top-level `.md` files only) never loads them all.
"""

import re
import subprocess

from . import REPO_ROOT, SKILLS_DIR, versioning

SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
AGENTS = ("creator", "reviewer")


def _git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=REPO_ROOT, capture_output=True, text=True, encoding="utf-8", check=True
    ).stdout


def slug(name: str) -> str:
    """'Brain Rot' -> 'brain-rot'."""
    return re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")


def _files(agent: str, ref: str | None) -> dict[str, str]:
    """Style name -> file text for one agent, from the working tree or as of a Git ref."""
    if ref is None:
        folder = SKILLS_DIR / agent / "styles"
        return {p.stem: p.read_text(encoding="utf-8") for p in sorted(folder.glob("*.md"))} if folder.is_dir() else {}
    try:
        paths = _git("ls-tree", "--name-only", ref, f"skills/{agent}/styles/").split()
    except subprocess.CalledProcessError:
        return {}
    return {p.rsplit("/", 1)[-1][:-3]: _git("show", f"{ref}:{p}") for p in sorted(paths) if p.endswith(".md")}


def parse(text: str) -> tuple[str, str]:
    """(title, summary): the `# ` heading and the first paragraph after it."""
    title, summary, para = "", "", []
    for line in text.splitlines():
        s = line.strip()
        if not title and s.startswith("# "):
            title = s[2:].strip()
            continue
        if s.startswith("#") or (not s and para):
            if para:
                break
            continue
        if s:
            para.append(s)
    summary = " ".join(para)
    return title, summary


def library(ref: str | None = None) -> list[dict]:
    """Every style the Creator can use: [{name, title, summary, creator, reviewer}], by name."""
    creator, reviewer = _files("creator", ref), _files("reviewer", ref)
    out = []
    for name in sorted(creator):
        title, summary = parse(creator[name])
        out.append({"name": name, "title": title or name, "summary": summary,
                    "creator": creator[name], "reviewer": reviewer.get(name)})
    return out


def names(ref: str | None = None) -> list[str]:
    return sorted(_files("creator", ref))


def for_agent(agent: str, wanted: list[str], ref: str | None = None) -> str:
    """The style files `agent` needs for these styles, for its prompt. A missing file is named, not dropped."""
    files = _files(agent, ref)
    parts = []
    for name in wanted:
        if name in files:
            parts.append(f"## Style: {name}\n\n{files[name].strip()}")
        else:
            parts.append(f"## Style: {name}\n\n(No {agent} file for this style yet: go by its name.)")
    return "\n\n".join(parts)


def create(name: str, how_to_edit: str, what_good_looks_like: str) -> dict:
    """A person adds a style: commit both files on the checked-out branch, as their own decision.

    It goes in without an A/B (Tyler, 2026-11-07); styles the Auditor proposes must win one.
    """
    name = slug(name)
    if not name or not SLUG.match(name):
        raise ValueError("a style needs a name with letters or digits")
    if name in names():
        raise FileExistsError(name)
    if any((SKILLS_DIR / agent / f"{name}.md").exists() for agent in AGENTS):
        raise ValueError(f"{name} is the name of a shared skill file; pick another")
    how, good = how_to_edit.strip(), what_good_looks_like.strip()
    if not how or not good:
        raise ValueError("a style needs both how to edit and what a good one looks like")
    title = name.replace("-", " ").capitalize()
    files = {
        f"skills/creator/styles/{name}.md": _as_style_file(title, how),
        f"skills/reviewer/styles/{name}.md": _as_style_file(title, good),
    }
    branch = f"human/style-{name}"
    from .experiments import _decide_lock  # experiments imports this module (through compare)

    with _decide_lock:  # one git merge at a time, alongside A/B promotions
        if name in names():  # added while this request waited for the lock
            raise FileExistsError(name)
        versioning.create_change_branch(branch, files, f"Add the {title} editing style\n\nA person added it in the app.")
        versioning.promote(branch, message=f"Add the {title} editing style, from the app")
        try:
            versioning.delete_branch(branch)
        except subprocess.CalledProcessError:
            pass  # the style is in; a leftover branch is harmless
    return next(s for s in library() if s["name"] == name)


def _as_style_file(title: str, body: str) -> str:
    """Give a person's text the heading the summary is read from, unless it has one."""
    return (body if body.lstrip().startswith("# ") else f"# {title}\n\n{body}").rstrip() + "\n"
