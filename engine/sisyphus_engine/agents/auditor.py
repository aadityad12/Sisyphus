"""Auditor: groups similar failures and proposes small, targeted changes.

It changes skills, prompts, tools and the editing software (mostly skills). Each change goes on its
own Git branch and must win a shadow A/B test before it becomes the new standard (see VISION.md).

It must not overreact: it only acts on a cluster of at least MIN_CLUSTER similar failures.
"""

import os
import re

from .. import REPO_ROOT, llm, styles
from . import load_skills

MIN_CLUSTER = int(os.environ.get("SISYPHUS_MIN_CLUSTER", "3"))

CLUSTER_SYSTEM = """You are the Auditor in SIsyphus, a self-improving video editing system. A Creator agent \
cuts long talks into 30-second vertical clips; a Reviewer approves them or sends them back; humans like, \
dislike and comment.

You are given failures: clips that were sent back, or that humans disliked, with the reasons. Group them \
into clusters of failures that share one root cause the Creator could fix. A cluster's label names the \
cause (for example "hook comes too late" or "speaker cropped out of frame"), not the topic of the clip. \
Reviewer tags, when present, are a strong hint: failures sharing a tag usually share a cause. Put each failure in at most one cluster. Leave out failures that share a cause with no other failure.

Every clip is edited in one or more editing styles (brain rot, polished, artsy, ...), each with its own \
skill file. Say where each cluster's fix belongs:
- kind "style", with style set to that style's name: the cause is in how one style is done (the brain-rot \
clips keep losing the speaker in their punch-ins). Every failure in the cluster used that style.
- kind "shared", with style "": the cause doesn't depend on the style (endings cut mid-sentence in every style).
- kind "new_style", with style set to a new name (lowercase, hyphens): people keep asking, in comments or \
dislikes, for a look that no existing style gives them. Use this rarely, only when the failures say so.

The existing styles: {styles}

"""

PROPOSE_SYSTEM = """You are the Auditor in SIsyphus, a self-improving video editing system. You turn a \
cluster of similar failures into one small, targeted change to the {agent}'s skills: Markdown files that \
are loaded into its prompt at runtime.

The change will run side by side with the current version on new, held-out work, and it is adopted only \
if it does better there. So:
- Fix the root cause of this cluster, and nothing else. Do not rewrite unrelated guidance.
- Write general rules that transfer to other footage and briefs, never rules about a specific clip.
- Prefer editing an existing skill file, or adding one short new file named for the lesson.
- Keep each file concise and concrete: numbers and checks beat adjectives.

{controls}

"""

CONTROLS = {
    "creator": "What the Creator can control (its edit plan): which source ranges to keep and their order, the "
    "on-screen hook text (shown for the first 3 seconds), the layout (crop: a 9:16 slice of the frame positioned "
    "by crop_x, 0 = left edge, 1 = right edge; fit: the whole 16:9 frame over a blurred fill; split: the whole "
    "16:9 frame across the top 404 px, readable at full width, and a tall crop at crop_x filling the 876 px below, "
    "the usual choice for a slide with the speaker beside it); zoom (1-4) magnifies the crop, and crop_y (0 top, "
    "1 bottom) places a zoomed crop vertically, which frames a small speaker inset; track_face (true/false) has "
    "the renderer split each segment at camera cuts, centre and size the crop on the face in each shot "
    "(overriding crop_x, crop_y and zoom), and show any shot without a face, such as a slide or B-roll, whole "
    "as in fit), caption_style "
    "(karaoke, plain, none) and caption_words (words on screen at once); the look: caption_size (small, medium, "
    "large, huge), caption_color (white, yellow, green, cyan, pink), caption_position (lower, middle, upper), "
    "caption_caps (true upper-cases every caption, false keeps the speaker's case), color_filter (none, warm, "
    "cool, bw, film, vivid), speed (0.75-1.5, the whole clip, sound included) and a per-segment punch (1-2, an "
    "extra centred zoom on that segment, so cutting between punch 1 and 1.3 reads as a punch-in). "
    "Its skills are shared files, which apply to every clip, and one file per editing style in styles/, which "
    "applies only to clips in that style and takes precedence over the shared files where they disagree.",
    "reviewer": "The Reviewer's skills are its standards: what makes a clip good enough to approve. A Reviewer "
    "change is judged by how often its verdicts agree with human votes, so fix where it disagreed with people, "
    "in either direction: approving clips people disliked, or sending back clips people liked. Its shared "
    "files apply to every clip; its file per editing style in styles/ is its idea of a good clip in that style.",
}

CLUSTER_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["clusters"],
    "properties": {
        "clusters": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["label", "root_cause", "video_ids", "kind", "style"],
                "properties": {
                    "label": {"type": "string"},
                    "root_cause": {"type": "string"},
                    "video_ids": {"type": "array", "items": {"type": "integer"}},
                    "kind": {"type": "string", "enum": ["shared", "style", "new_style"]},
                    "style": {"type": "string"},
                },
            },
        }
    },
}

PROPOSAL_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "rationale", "files", "reviewer_style"],
    "properties": {
        "title": {"type": "string", "description": "Imperative, under 70 characters"},
        "reviewer_style": {
            "type": "string",
            "description": "Only for a new style: the Reviewer's file for it, what a good clip in this style looks "
            "like, starting with '# <Title>' and a one-paragraph summary. Empty otherwise.",
        },
        "rationale": {"type": "string", "description": "Failure pattern -> lesson -> edit, in 2-3 sentences"},
        "files": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "content"],
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "File name inside the skills folder, e.g. hooks.md, or styles/<style>.md for a style's file",
                    },
                    "content": {"type": "string", "description": "The full new content of the file"},
                },
            },
        },
    },
}


def _describe(f: dict) -> str:
    bits = [f"#{f['video_id']} brief: {f['brief']}"]
    if f.get("styles"):
        picked = "asked for" if f.get("styles_requested") else "picked on Auto"
        bits.append(f"styles: {', '.join(f['styles'])} ({picked})")
    if f.get("review_tags"):
        bits.append(f"tags: {', '.join(f['review_tags'])}")
    if f.get("review_reason"):
        bits.append(f"reviewer: {f['review_reason']}")
    if f.get("human_liked") is not None:
        bits.append(f"human: {'liked' if f['human_liked'] else 'disliked'}")
    for c in f.get("comments", []):
        bits.append(f"comment: {c}")
    return "\n  ".join(bits)


def _style_names() -> list[str]:
    return styles.names()


def cluster(failures: list[dict]) -> list[dict]:
    """Group failures by shared root cause. Only clusters of at least MIN_CLUSTER are returned.

    Each cluster says where its fix belongs: `kind` "shared", "style" (one style's file, named in `style`)
    or "new_style" (a style that doesn't exist yet). A "style" cluster naming an unknown style is treated
    as shared, and a "new_style" naming one that exists as a fix to it.
    """
    if len(failures) < MIN_CLUSTER:
        return []
    user = "Failures:\n\n" + "\n\n".join(_describe(f) for f in failures)
    known = {f["video_id"] for f in failures}
    library = _style_names()
    system = CLUSTER_SYSTEM.replace("{styles}", ", ".join(library) or "(none yet)")
    out = llm.complete_json(system + load_skills("auditor"), user, CLUSTER_SCHEMA, "clusters")
    clusters = []
    for c in out["clusters"]:
        ids = sorted({i for i in c["video_ids"] if i in known})
        if len(ids) < MIN_CLUSTER:
            continue
        kind, style = c.get("kind", "shared"), styles.slug(c.get("style") or "")
        if kind == "style" and style not in library:
            kind, style = "shared", ""
        elif kind == "new_style" and style in library:
            kind = "style"
        elif kind == "new_style" and not style:
            kind = "shared"
        if kind == "shared":
            style = ""
        clusters.append({**c, "video_ids": ids, "kind": kind, "style": style})
    return sorted(clusters, key=lambda c: -len(c["video_ids"]))


def _skill_files(agent: str) -> dict[str, str]:
    """Shared skill files by name, and style files as styles/<name>.md."""
    folder = REPO_ROOT / "skills" / agent
    files = {p.name: p.read_text(encoding="utf-8") for p in sorted(folder.glob("*.md")) if p.name.lower() != "readme.md"}
    for p in sorted((folder / "styles").glob("*.md")):
        files[f"styles/{p.name}"] = p.read_text(encoding="utf-8")
    return files


def _target(cluster: dict) -> str:
    """What the change may edit, by the cluster's kind."""
    kind, style = cluster.get("kind", "shared"), cluster.get("style", "")
    if kind == "style":
        return (f"This cluster is about the {style} style. Change only its file, styles/{style}.md, so the "
                f"other styles are untouched. The change is tested on new clips in that style.")
    if kind == "new_style":
        return (f"People want a look no existing style gives them. Add one new style file, styles/{style}.md: "
                f"'# <Title>', then a one-paragraph summary of the look (it is shown in the style picker and is how "
                f"the Creator chooses it), then concrete rules using the plan's controls. Also write reviewer_style: "
                f"the Reviewer's standards for a good clip in this style. Change no other file. The change is tested "
                f"by clips in the new style against clips the current version makes on Auto.")
    return ("This cluster doesn't depend on the editing style. Change the shared skill files, not a style's file. "
            "The change is tested on new clips in whatever style the Creator picks.")


def _file_name(raw: str) -> str | None:
    """A proposed file's name, as a shared file ('hooks.md') or a style file ('styles/brain-rot.md')."""
    parts = [p for p in raw.lower().replace("\\", "/").split("/") if p]
    if not parts:
        return None
    name = re.sub(r"[^a-z0-9._-]", "-", parts[-1])
    if not name.endswith(".md") or name == "readme.md":
        return None
    if len(parts) >= 2 and parts[-2] == "styles":
        stem = styles.slug(name[:-3])
        return f"styles/{stem}.md" if stem else None
    return name


def propose(agent: str, cluster: dict, failures: list[dict], rolled_back: list[dict]) -> dict:
    """Write one change for a cluster. Returns {title, rationale, files: {repo path: content}}."""
    by_id = {f["video_id"]: f for f in failures}
    files = _skill_files(agent)
    kind, style = cluster.get("kind", "shared"), cluster.get("style", "")
    parts = [
        f"Failure cluster: {cluster['label']}\nRoot cause: {cluster['root_cause']}\n",
        _target(cluster) + "\n",
        "Failures in this cluster:\n\n" + "\n\n".join(_describe(by_id[i]) for i in cluster["video_ids"] if i in by_id),
        "\nCurrent skill files:\n" + "\n".join(f"--- {name} ---\n{text}" for name, text in files.items()),
    ]
    if rolled_back:
        parts.append(
            "\nThese earlier changes were tried and rolled back because they did not win on held-out work. "
            "Do not repeat them:\n" + "\n".join(f"- {c['title']}: {c['rationale']}" for c in rolled_back)
        )
    out = llm.complete_json(
        PROPOSE_SYSTEM.format(agent=agent, controls=CONTROLS.get(agent, "")) + load_skills("auditor"), "\n".join(parts), PROPOSAL_SCHEMA, "change"
    )
    changed = {}
    for f in out["files"]:
        name = _file_name(f["name"])
        if name is None:
            continue
        # A style change stays inside its style: anything else it writes would go untested on other styles.
        if kind in ("style", "new_style") and name != f"styles/{style}.md":
            continue
        content = f["content"].rstrip() + "\n"
        if files.get(name) != content:
            changed[f"skills/{agent}/{name}"] = content
    if kind == "new_style" and agent == "creator" and changed:
        # The judge needs a bar for the new style. It is adopted with the style if the style wins; during the
        # A/B the frozen Reviewer has no file for it and goes by its name and the general standards.
        bar = (out.get("reviewer_style") or "").strip()
        title = style.replace("-", " ").capitalize()
        changed[f"skills/reviewer/styles/{style}.md"] = (bar if bar.startswith("# ") else f"# {title}\n\n{bar or 'A good clip looks and feels like the ' + title + ' style.'}").rstrip() + "\n"
    if not changed:
        raise ValueError("Auditor proposed no effective change")
    title = out["title"].strip()
    # The model sometimes names the file it edited ("editing.md"); the Versions and Showcase tabs show this title.
    if title.lower().endswith(".md") or len(title.split()) < 3:
        title = cluster["label"].strip()
    return {"title": title, "rationale": out["rationale"].strip(), "files": changed}
