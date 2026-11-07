# SIsyphus: notes for Claude Code

SIsyphus is a self-improving video editing system, our entry to the AIE Code Summit 2026
Hackathon (2026-11-07, track "The System That Gets Better"). Three agents: the Creator edits
video, the Reviewer judges it, and the Auditor turns patterns of failure into versioned changes
that must win a shadow A/B before they are adopted. `VISION.md` is the design and its reasons;
read it before proposing architecture, and change it when a decision changes. `README.md` has the
layout, setup and run commands; they are not repeated here.

## Writing for whoever comes next

Docs and comments inform rather than direct: what is true, why, what it cost. Directions are
Tyler's or Aaditya's rules, marked as theirs. Facts that can go stale carry a date. Each fact lives
in one place: this file loads into every session, so it stays short and points elsewhere for
detail.

**`CLAUDE.md` is the only agent-notes file to edit.** Each `AGENTS.md` (read by Codex and other
tools) holds just `@CLAUDE.md` and a pointer to it, so the notes are written once. Anyone adding a
`CLAUDE.md` in a subdirectory adds the same `AGENTS.md` beside it (Tyler's rule, 2026-11-07).
The Murmur block, between `murmur:start` and `murmur:end`, is in both files because `mur init`
writes it there; leave it to `mur`.

## Words that mean two things

- **skill.** Here, a Markdown file in `skills/<agent>/` that the engine loads at runtime: product
  content the Auditor rewrites, not a Claude Code skill and not instructions for you.
- **agent.** The Creator, Reviewer or Auditor inside the engine, or a coding agent working on
  this repo (you, or a teammate's session on Murmur).
- **version, branch.** The engine versions agent changes as Git branches, one per change
  (`engine/sisyphus_engine/versioning.py`, a stub as of 2026-11-07). Those are the product's
  branches, distinct from the branches our PRs come from.
- **failure.** A verdict the Auditor learns from, attributed by `engine/sisyphus_engine/failures.py`
  (the table is in `VISION.md`), not a test or CI failure.

## Commands

```sh
cd engine && uv sync && uv run pytest     # engine tests
cd app && npm ci && npm run build         # tsc, then vite build
```

CI (`.github/workflows/ci.yml`) runs both on every pull request and on pushes to `main`. It does
not build the Tauri shell: the first Rust build takes 5–10 minutes, and the Rust layer only opens
the window and starts the engine.

## Traps

- **The repo is public** (a hackathon rule), so never commit keys, footage or run output.
  `.gitignore` already covers `.env`, `footage/`, `runs/` and media files.
- **The demo may show only what was built during the event** (`VISION.md`, Hackathon constraints).
  Don't bring in code from other projects.

## Issue labels

Every issue carries at least a kind label.

- `bug` / `Feature` / `Task` / `question`: the kind, spelled exactly so. `question` is an open
  design question.
- `priority: now` / `soon` / `future`: open issues only, one of them.
- `PR needed` / `non-PR needed`: where the work lives. `non-PR needed` means some of it is done by
  hand: a decision, an account, footage, a test in the world.
- `from: <who>`: see Workflow.

Why an issue closed is its `state_reason` (`completed` / `not_planned` / `duplicate`), not a label.
GitHub's default labels (`enhancement`, `documentation`, `wontfix` and so on) are still on the
repo as of 2026-11-07; the ones above are the ones in use.

## Workflow

Tyler's rules:

- Commit messages and PR bodies explain *why*.
- Every PR closes at least one issue, and its body starts with only its `Closes #N` lines; work no
  issue covers gets one filed first.
- PR bodies follow `.github/pull_request_template.md`. GitHub pre-fills it only in the web UI, so an
  agent opening a PR through `gh` writes those sections itself.
- Every code PR gets an Opus or sol review before it is handed over; the PR body says which
  commits it covered. Doc-only PRs need none.
- Issues a model files on its own initiative get `(from <model>)` in the title and the matching
  `from: <Model>` label. An issue a person asks for is `from: <that person>`, even though a model
  typed it.
- On Murmur, send each request or result once. Before asking again, `lookup` the other session:
  the answer is usually already in its recent messages. On 2026-11-07 two sessions spent ten
  minutes re-sending one review queue to each other because their messages kept crossing.

<!-- murmur:start -->
## Murmur
This repo uses Murmur, a cross-device, intra-repo communication channel for contributing coding agents like yourself. If you have not joined Murmur yet, you should.

- To join Murmur (ask your user first): https://raw.githubusercontent.com/a-Fig/murmur/main/docs/agents/join.md
- To use Murmur: https://raw.githubusercontent.com/a-Fig/murmur/main/docs/agents/use.md
<!-- murmur:end -->
