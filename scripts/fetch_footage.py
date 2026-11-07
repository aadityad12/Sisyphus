"""Download the demo footage listed in scripts/footage_sources.json and write footage/manifest.json.

    python scripts/fetch_footage.py            # everything missing
    python scripts/fetch_footage.py SUqQlvyI3N8  # just these YouTube ids (or file names)

Each entry: file, title, speaker, source_url (or a YouTube id), kind ("talk" for stage talks with slides,
"interview" for seated conversations: the A/B prefers held-out footage of the failure's kind), brief,
and optionally showcase: true (the demo's fixed before/after briefs, never used to train or test).

Footage is gitignored (the repo is public), so every machine fetches its own copy from this list, and
the held-out sets match across machines. Needs yt-dlp and ffmpeg on PATH. Downloads 720p H.264 MP4,
which is plenty for a 720x1280 vertical render and keeps a talk around 100-250 MB.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / "scripts" / "footage_sources.json"
FOOTAGE = Path(os.environ.get("SISYPHUS_FOOTAGE_DIR", ROOT / "footage"))
MANIFEST_FIELDS = ("file", "title", "speaker", "source_url", "duration_s", "kind", "brief", "showcase")
MAX_SECONDS = 1200  # long talks and podcasts are cut to their first 20 minutes


def _duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def _trim(path: Path) -> None:
    """Keep the first MAX_SECONDS: transcription is about real time on a laptop CPU, and a clip needs no more."""
    if _duration(path) <= MAX_SECONDS + 1:
        return
    tmp = path.with_suffix(".trim.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-t", str(MAX_SECONDS), "-c", "copy", str(tmp)], check=True)
    tmp.replace(path)


def fetch(src: dict) -> bool:
    out = FOOTAGE / src["file"]
    if out.exists():
        return True
    url = src.get("source_url") or f"https://www.youtube.com/watch?v={src['id']}"
    cmd = [
        "yt-dlp", "--no-playlist", "--quiet", "--progress",
        "-f", "bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]",
        "--merge-output-format", "mp4",
        "-o", str(out),
        url,
    ]
    print(f"fetching {src['file']} ...", flush=True)
    ok = subprocess.run(cmd).returncode == 0 and out.exists()
    if ok:
        _trim(out)
    else:
        print(f"  failed: {url}", file=sys.stderr)
    return ok


def write_manifest(sources: list[dict]) -> None:
    """Merge into any existing manifest: entries for files not in sources.json are kept."""
    path = FOOTAGE / "manifest.json"
    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    ours = {s["file"] for s in sources}
    merged = [m for m in existing if m.get("file") not in ours]
    for s in sources:
        if (FOOTAGE / s["file"]).exists():
            entry = {k: s[k] for k in MANIFEST_FIELDS if k in s}
            entry["duration_s"] = round(_duration(FOOTAGE / s["file"]))
            merged.append(entry)
    path.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    print(f"manifest: {len(merged)} entries in {path}")


def main() -> None:
    sources = json.loads(SOURCES.read_text(encoding="utf-8"))
    wanted = set(sys.argv[1:])
    FOOTAGE.mkdir(parents=True, exist_ok=True)
    picked = [s for s in sources if not wanted or s.get("id") in wanted or s["file"] in wanted]
    failed = [s["file"] for s in picked if not fetch(s)]
    write_manifest(sources)
    if failed:
        sys.exit(f"failed: {' '.join(failed)}")


if __name__ == "__main__":
    main()
