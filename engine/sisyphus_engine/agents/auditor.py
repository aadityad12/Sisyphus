"""Auditor: groups similar failures and proposes small, targeted changes.

It changes skills, prompts, tools and the editing software (mostly skills). Each change goes on its
own Git branch and must win a shadow A/B test before it becomes the new standard (see VISION.md).

It must not overreact: it only acts on a cluster of at least MIN_CLUSTER similar failures.
"""

import os
import re

from .. import REPO_ROOT, llm
from . import load_skills

MIN_CLUSTER = int(os.environ.get("SISYPHUS_MIN_CLUSTER", "3"))

CLUSTER_SYSTEM = """You are the Auditor in SIsyphus, a self-improving video editing system. A Creator agent \
cuts long talks into 30-second vertical clips; a Reviewer approves them or sends them back; humans like, \
dislike and comment.

You are given failures: clips that were sent back, or that humans disliked, with the reasons. Group them \
into clusters of failures that share one root cause the Creator could fix. A cluster's label names the \
cause (for example "hook comes too late" or "speaker cropped out of frame"), not the topic of the clip. \
Reviewer tags, when present, are a strong hint: failures sharing a tag usually share a cause. Put each failure in at most one cluster. Leave out failures that share a cause with no other failure.

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
    "1 bottom) places a zoomed crop vertically, which frames a small speaker inset), caption_style "
    "(karaoke, plain, none) and caption_words (words on screen at once).",
    "reviewer": "The Reviewer's skills are its standards: what makes a clip good enough to approve. A Reviewer "
    "change is judged by how often its verdicts agree with human votes, so fix where it disagreed with people, "
    "in either direction: approving clips people disliked, or sending back clips people liked.",
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
                "required": ["label", "root_cause", "video_ids"],
                "properties": {
                    "label": {"type": "string"},
                    "root_cause": {"type": "string"},
                    "video_ids": {"type": "array", "items": {"type": "integer"}},
                },
            },
        }
    },
}

PROPOSAL_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "rationale", "files"],
    "properties": {
        "title": {"type": "string", "description": "Imperative, under 70 characters"},
        "rationale": {"type": "string", "description": "Failure pattern -> lesson -> edit, in 2-3 sentences"},
        "files": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "content"],
                "properties": {
                    "name": {"type": "string", "description": "File name inside the skills folder, e.g. hooks.md"},
                    "content": {"type": "string", "description": "The full new content of the file"},
                },
            },
        },
    },
}


def _describe(f: dict) -> str:
    bits = [f"#{f['video_id']} brief: {f['brief']}"]
    if f.get("review_tags"):
        bits.append(f"tags: {', '.join(f['review_tags'])}")
    if f.get("review_reason"):
        bits.append(f"reviewer: {f['review_reason']}")
    if f.get("human_liked") is not None:
        bits.append(f"human: {'liked' if f['human_liked'] else 'disliked'}")
    for c in f.get("comments", []):
        bits.append(f"comment: {c}")
    return "\n  ".join(bits)


def cluster(failures: list[dict]) -> list[dict]:
    """Group failures by shared root cause. Only clusters of at least MIN_CLUSTER are returned."""
    if len(failures) < MIN_CLUSTER:
        return []
    user = "Failures:\n\n" + "\n\n".join(_describe(f) for f in failures)
    known = {f["video_id"] for f in failures}
    out = llm.complete_json(CLUSTER_SYSTEM + load_skills("auditor"), user, CLUSTER_SCHEMA, "clusters")
    clusters = []
    for c in out["clusters"]:
        ids = sorted({i for i in c["video_ids"] if i in known})
        if len(ids) >= MIN_CLUSTER:
            clusters.append({**c, "video_ids": ids})
    return sorted(clusters, key=lambda c: -len(c["video_ids"]))


def _skill_files(agent: str) -> dict[str, str]:
    folder = REPO_ROOT / "skills" / agent
    return {
        p.name: p.read_text(encoding="utf-8")
        for p in sorted(folder.glob("*.md"))
        if p.name.lower() != "readme.md"
    }


def propose(agent: str, cluster: dict, failures: list[dict], rolled_back: list[dict]) -> dict:
    """Write one change for a cluster. Returns {title, rationale, files: {repo path: content}}."""
    by_id = {f["video_id"]: f for f in failures}
    files = _skill_files(agent)
    parts = [
        f"Failure cluster: {cluster['label']}\nRoot cause: {cluster['root_cause']}\n",
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
        name = re.sub(r"[^a-z0-9._-]", "-", f["name"].lower().split("/")[-1])
        if not name.endswith(".md") or name == "readme.md":
            continue
        content = f["content"].rstrip() + "\n"
        if files.get(name) != content:
            changed[f"skills/{agent}/{name}"] = content
    if not changed:
        raise ValueError("Auditor proposed no effective change")
    return {"title": out["title"].strip(), "rationale": out["rationale"].strip(), "files": changed}
