"""Fill the engine's transcript cache with whisper.cpp, which runs on a Mac's GPU through Metal.

    cd engine && uv run python ../scripts/prewarm_transcripts.py                 # manifest files not cached yet
    cd engine && uv run python ../scripts/prewarm_transcripts.py ../footage/a.mp4  # just these files
    cd engine && uv run python ../scripts/prewarm_transcripts.py --force           # redo cached ones too

The engine transcribes with faster-whisper small.en, which has no Metal backend: on an M1 Pro CPU it
runs at about 1.7x real time (Aaditya, 2026-11-07), so ten 15-20 minute talks take over an hour
before the Creator can use them. whisper.cpp runs the same small.en weights on the GPU. This writes
its result to exactly the file transcribe.transcribe() reads (_cache_path is imported, not copied,
so the key cannot drift), in the same shape, so the engine finds every transcript already cached.

Needs ffmpeg and whisper-cli (`brew install whisper-cpp`). The first run downloads ggml-small.en.bin
(466 MB) into runs/models/, which is gitignored. Without whisper-cli it says so and exits 1, and the
engine still transcribes on demand as before.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from sisyphus_engine import FOOTAGE_DIR, RUNS_DIR
from sisyphus_engine.media import ffmpeg
from sisyphus_engine.transcribe import MODEL_SIZE, _cache_path

MODEL_URL = f"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{MODEL_SIZE}.bin"
MODEL_PATH = RUNS_DIR / "models" / f"ggml-{MODEL_SIZE}.bin"


MAX_WORD_S = 0.6  # longest a word may reach back from its end, when the gap before it is a pause


def convert(whisper_json: dict) -> dict:
    """whisper-cli's --output-json-full output -> {"segments": [{start, end, text, words: [{start, end, word}]}]}.

    whisper.cpp splits text into sub-word tokens. A token that starts with a space starts a new word,
    and one that doesn't (the rest of a word, or punctuation) joins the word before it, which is how
    faster-whisper attaches punctuation too. Tokens like [_BEG_] and [_TT_150] are timing markers.

    Timing comes from DTW (`-dtw`, t_dtw in centiseconds), which marks where a token ends: on
    sparsh-jain-same-mistakes.mp4 word ends landed a median 0.01 s from faster-whisper's (p99 0.13 s),
    against 0.27 s (p90 0.9 s) for the token offsets. A word starts where the one before it ended, or
    at most MAX_WORD_S before its own end after a pause (starts: median 0.01 s, p99 0.53 s). A token
    with no DTW time (t_dtw -1) falls back to its offsets (milliseconds). Punctuation never moves a
    word's end: a "." token's span runs through the pause after it, and stretching the word over that
    would push the renderer's cut snapping and caption timing into the silence. Segment times are
    their words' span, since the Creator picks cuts from them.
    """
    segments = []
    prev_end = 0.0
    for seg in whisper_json.get("transcription", []):
        words: list[dict] = []
        for tok in seg.get("tokens", []):
            text = tok.get("text", "")
            if not text.strip() or text.startswith("[_"):
                continue
            dtw = tok.get("t_dtw", -1)
            end = dtw / 100 if dtw >= 0 else tok["offsets"]["to"] / 1000
            if words and not text.startswith(" "):
                words[-1]["word"] += text
                if any(c.isalnum() for c in text):
                    words[-1]["end"] = max(words[-1]["end"], end)
            else:
                start = max(prev_end, end - MAX_WORD_S) if dtw >= 0 else tok["offsets"]["from"] / 1000
                words.append({"start": min(start, end), "end": end, "word": text.strip()})
            prev_end = words[-1]["end"]
        text = seg.get("text", "").strip()
        if not text:
            continue
        rounded = [{"start": round(w["start"], 2), "end": round(w["end"], 2), "word": w["word"]} for w in words]
        segments.append(
            {
                "start": rounded[0]["start"] if rounded else round(seg["offsets"]["from"] / 1000, 2),
                "end": rounded[-1]["end"] if rounded else round(seg["offsets"]["to"] / 1000, 2),
                "text": text,
                "words": rounded,
            }
        )
    return {"segments": segments}


def ensure_model() -> Path:
    if MODEL_PATH.exists():
        return MODEL_PATH
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    part = MODEL_PATH.with_suffix(".part")
    print(f"downloading {MODEL_URL} -> {MODEL_PATH} ...", flush=True)
    urllib.request.urlretrieve(MODEL_URL, part)
    part.replace(MODEL_PATH)
    return MODEL_PATH


def transcribe_file(footage: Path, whisper_cli: str, model: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix="prewarm-") as tmp:
        wav, out = Path(tmp) / "audio.wav", Path(tmp) / "out"
        # 16 kHz mono 16-bit PCM is the only input whisper-cli reads without converting it itself.
        subprocess.run(
            [ffmpeg(), "-v", "error", "-y", "-i", str(footage), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)],
            check=True,
        )
        # -dtw gives the word timings (see convert); it silently yields none with flash attention,
        # which is on by default, hence -nfa (42 s -> 48 s for a 15-minute talk on an M3).
        # --no-prints still leaves progress lines on stderr, so keep it and show it only on failure.
        subprocess.run(
            [whisper_cli, "-m", str(model), "-f", str(wav), "-l", "en", "-t", str(min(8, os.cpu_count() or 4)),
             "-dtw", MODEL_SIZE, "-nfa", "--output-json-full", "-of", str(out), "--no-prints"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        return convert(json.loads(Path(f"{out}.json").read_text(encoding="utf-8")))


def write_cache(footage: Path, transcript: dict) -> Path:
    cache = _cache_path(footage)
    cache.parent.mkdir(parents=True, exist_ok=True)
    tmp = cache.with_suffix(".tmp")
    tmp.write_text(json.dumps(transcript), encoding="utf-8")
    tmp.replace(cache)  # atomic, so the engine never reads half a file
    return cache


def manifest_files() -> list[Path]:
    manifest = FOOTAGE_DIR / "manifest.json"
    if not manifest.exists():
        sys.exit(f"no {manifest}: run scripts/fetch_footage.py first, or pass footage paths")
    return [FOOTAGE_DIR / m["file"] for m in json.loads(manifest.read_text(encoding="utf-8"))]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("footage", nargs="*", type=Path, help="files to transcribe (default: footage/manifest.json)")
    parser.add_argument("--force", action="store_true", help="transcribe even if a transcript is cached")
    args = parser.parse_args()

    whisper_cli = shutil.which("whisper-cli")
    if whisper_cli is None:
        print(
            "whisper-cli not found: `brew install whisper-cpp` to prewarm on the GPU. Nothing was written; "
            "the engine will still transcribe each file with faster-whisper when it first needs it.",
            file=sys.stderr,
        )
        return 1

    files = [p.resolve() for p in args.footage] if args.footage else manifest_files()
    missing = [p for p in files if not p.exists()]
    for p in missing:
        print(f"skip {p.name}: file not found", file=sys.stderr)
    todo = [p for p in files if p.exists() and (args.force or not _cache_path(p).exists())]
    print(f"{len(files) - len(missing) - len(todo)} already cached, {len(todo)} to transcribe")
    if not todo:
        return 1 if missing else 0

    model = ensure_model()
    failed = 0
    for i, footage in enumerate(todo, 1):
        t0 = time.monotonic()
        print(f"[{i}/{len(todo)}] {footage.name} ...", end=" ", flush=True)
        try:
            transcript = transcribe_file(footage, whisper_cli, model)
        except subprocess.CalledProcessError as exc:
            failed += 1
            print(f"failed ({Path(exc.cmd[0]).name} exited {exc.returncode})")
            if exc.stderr:
                print(exc.stderr[-2000:], file=sys.stderr)
            continue
        cache = write_cache(footage, transcript)
        n_words = sum(len(s["words"]) for s in transcript["segments"])
        print(f"{len(transcript['segments'])} segments, {n_words} words in {time.monotonic() - t0:.0f}s -> {cache.name}")
    return 1 if failed or missing else 0


if __name__ == "__main__":
    sys.exit(main())
