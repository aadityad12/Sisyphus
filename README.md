# SIsyphus

> *One must imagine SIsyphus editing.*

SIsyphus is a self-improving video editing system, built for the AIE Code Summit 2026 Hackathon. See [VISION.md](VISION.md) for what it is and how it works.

## Layout

| Path | What it is | Language |
|---|---|---|
| `app/` | Desktop app: a Tauri window around a React UI | TypeScript, plus a thin Rust layer in `app/src-tauri` |
| `engine/` | The Creator, Reviewer and Auditor agents, served over a local HTTP API on port 8765 | Python |
| `skills/` | Each agent's skill files, loaded at runtime. These are what the Auditor changes most. | Markdown |

Keep the logic in `engine/` and `app/src/` so changes need no Rust rebuild. The Rust layer only opens the window and starts the engine.

## Setup

You need Rust, Node 20 or later, [uv](https://docs.astral.sh/uv/) and ffmpeg.

```sh
cd engine && uv sync          # Python deps
cd ../app && npm install      # UI deps
```

The agents run on Meta's `muse-wonder-1.0` through the Meta Model API. Put the key in `engine/.env`, which is gitignored:

```sh
MODEL_API_KEY=...
```

Footage goes in `footage/` (gitignored), with an optional `footage/manifest.json` listing each file's title, speaker and a suggested brief. The Auditor's shadow A/B draws its held-out work from that manifest. Transcripts, renders and the SQLite database go in `runs/` (gitignored). `SISYPHUS_FOOTAGE_DIR` and `SISYPHUS_RUNS_DIR` override both folders, for example to share one footage folder with a second checkout.

## Development: in the browser, no Rust

Develop the whole day in the browser. Nothing compiles. Run these in two terminals:

```sh
cd engine && uv run python -m sisyphus_engine   # engine on :8765
cd app && npm run dev                           # UI on http://localhost:1420
```

Then open http://localhost:1420. The UI reloads on save; restart the engine after changing its code. On Windows, `--reload` noticed changes only in `.venv`, not in the engine's own files (2026-11-07), and any reload kills the jobs in flight. The engine re-queues interrupted jobs when it starts.

When the Auditor promotes a change, it merges the change's branch into whatever branch is checked out. Run a demo or a long experiment from its own worktree, so promotions don't land on a branch a pull request is open from.

## Desktop build: once, at the end

The Tauri desktop window is built only when we package the demo. The first Rust build takes about 5–10 minutes, so start it well before the deadline.

```sh
cd app && npm run tauri dev     # desktop window; starts the engine itself
cd app && npm run tauri build   # installer
```

If the engine is already running with `--reload`, set `SISYPHUS_EXTERNAL_ENGINE=1` so the desktop app doesn't start a second copy. On PowerShell that's `$env:SISYPHUS_EXTERNAL_ENGINE=1`.

## Tests

```sh
cd engine && uv run pytest
```
