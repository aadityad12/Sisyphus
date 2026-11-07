"""Download the demo footage listed in scripts/footage_sources.json and write footage/manifest.json.

    python scripts/fetch_footage.py            # everything missing
    python scripts/fetch_footage.py SUqQlvyI3N8  # just these YouTube ids

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
MANIFEST_FIELDS = ("file", "title", "speaker", "brief", "showcase")


def fetch(src: dict) -> bool:
    out = FOOTAGE / src["file"]
    if out.exists():
        return True
    cmd = [
        "yt-dlp", "--no-playlist", "--quiet", "--progress",
        "-f", "bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[height<=720]",
        "--merge-output-format", "mp4",
        "-o", str(out),
        f"https://www.youtube.com/watch?v={src['id']}",
    ]
    print(f"fetching {src['file']} ...", flush=True)
    ok = subprocess.run(cmd).returncode == 0 and out.exists()
    if not ok:
        print(f"  failed: {src['id']}", file=sys.stderr)
    return ok


def write_manifest(sources: list[dict]) -> None:
    """Merge into any existing manifest: entries for files not in sources.json are kept."""
    path = FOOTAGE / "manifest.json"
    existing = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    ours = {s["file"] for s in sources}
    merged = [m for m in existing if m.get("file") not in ours]
    merged += [{k: s[k] for k in MANIFEST_FIELDS if k in s} for s in sources if (FOOTAGE / s["file"]).exists()]
    path.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    print(f"manifest: {len(merged)} entries in {path}")


def main() -> None:
    sources = json.loads(SOURCES.read_text(encoding="utf-8"))
    wanted = set(sys.argv[1:])
    FOOTAGE.mkdir(parents=True, exist_ok=True)
    failed = [s["id"] for s in sources if (not wanted or s["id"] in wanted) and not fetch(s)]
    write_manifest(sources)
    if failed:
        sys.exit(f"failed: {' '.join(failed)}")


if __name__ == "__main__":
    main()
