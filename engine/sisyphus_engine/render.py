"""Fixed renderer: edit plan + footage + transcript -> vertical MP4 with burned-in captions.

This is "the editing software" the Auditor may change. Keep it deterministic.
"""

import shutil
import subprocess
from pathlib import Path

from . import faces
from .media import ffmpeg
from .plan import EditPlan, Segment
from .transcribe import words as all_words

WIDTH, HEIGHT = 720, 1280
FONT_FILE = Path("C:/Windows/Fonts/arialbd.ttf")
FADE = 0.04  # seconds of audio fade at each cut, to avoid clicks


def snap_to_words(seg: Segment, words: list[dict]) -> Segment:
    """Move cut points into the silence between words so no word is cut in half."""
    start, end = seg.start, seg.end
    for w in words:
        if w["start"] < start < w["end"]:  # starts mid-word: include the whole word
            start = w["start"]
        if w["start"] < end < w["end"]:  # ends mid-word: finish the word
            end = w["end"]
    prev_end = max((w["end"] for w in words if w["end"] <= start), default=0.0)
    next_start = min((w["start"] for w in words if w["start"] >= end), default=end + 0.12)
    return Segment(start=max(0.0, prev_end, start - 0.05), end=min(end + 0.12, max(end, next_start)))


def _ass_time(t: float) -> str:
    t = max(0.0, t)
    h, rem = divmod(t, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def _escape(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")").replace("\r", "").replace("\n", "\\N")


def _chunks(words: list[dict], max_words: int) -> list[list[dict]]:
    """Group words into on-screen chunks, breaking at punctuation and pauses."""
    chunks, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        pause = nxt is not None and nxt["start"] - w["end"] > 0.35
        punct = w["word"][-1:] in ".,!?;:"
        if len(cur) >= max_words or pause or punct or nxt is None:
            chunks.append(cur)
            cur = []
    return chunks


def build_ass(plan: EditPlan, timeline_words: list[dict], total: float) -> str:
    """ASS subtitles: captions in the lower third, plus the hook at the top."""
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {WIDTH}
PlayResY: {HEIGHT}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Arial,62,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,5,2,2,50,50,330,1
Style: Hook,Arial,54,&H00000000,&H00000000,&H00FFFFFF,&H00FFFFFF,1,0,0,0,100,100,0,0,3,14,0,8,60,60,170,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    if plan.hook.strip():
        lines.append(f"Dialogue: 1,{_ass_time(0)},{_ass_time(min(3.0, total))},Hook,,0,0,0,,{_escape(plan.hook.strip())}")
    if plan.caption_style != "none":
        for chunk in _chunks(timeline_words, plan.caption_words):
            texts = [_escape(w["word"]).upper() for w in chunk]
            chunk_end = chunk[-1]["end"]
            if plan.caption_style == "plain":
                lines.append(f"Dialogue: 0,{_ass_time(chunk[0]['start'])},{_ass_time(chunk_end)},Cap,,0,0,0,,{' '.join(texts)}")
                continue
            for i, w in enumerate(chunk):
                start = w["start"]
                end = chunk[i + 1]["start"] if i + 1 < len(chunk) else chunk_end
                if end <= start:
                    continue
                shown = [r"{\c&H00E5FF&}" + t + r"{\c&HFFFFFF&}" if j == i else t for j, t in enumerate(texts)]
                lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Cap,,0,0,0,,{' '.join(shown)}")
    return header + "\n".join(lines) + "\n"


def timeline(plan: EditPlan, words: list[dict]) -> tuple[list[Segment], list[dict]]:
    """Snap the cuts, then map transcript words from source time onto the output timeline."""
    segs = [snap_to_words(s, words) for s in plan.segments]
    out, offset = [], 0.0
    for seg in segs:
        for w in words:
            if w["start"] >= seg.start and w["end"] <= seg.end:
                out.append({"word": w["word"], "start": offset + w["start"] - seg.start, "end": offset + w["end"] - seg.start})
        offset += seg.end - seg.start
    return segs, out


def _crop(plan: EditPlan, out_w: int, out_h: int) -> str:
    """An ffmpeg crop with the output's aspect ratio: height = source height / zoom, placed at crop_x, crop_y."""
    h = f"ih/{plan.zoom:.3f}"
    w = f"min(iw\\,{h}*{out_w}/{out_h})"  # escaped comma: a bare one would end the filter
    return f"crop={w}:{h}:(iw-{w})*{plan.crop_x:.3f}:(ih-{h})*{plan.crop_y:.3f}"


def _pane_crop(plan: EditPlan, footage: Path, seg: Segment, src_w: int, src_h: int, out_w: int, out_h: int,
               face_share: float) -> str:
    """The crop for one pane: centred on the speaker's face when track_face is on and a face is found,
    otherwise placed by crop_x, crop_y and zoom."""
    if plan.track_face and src_w and src_h:
        face = faces.locate(footage, round(seg.start, 2), round(seg.end, 2))
        if face:
            w, h, x, y = faces.crop_on_face(face, src_w, src_h, out_w, out_h, face_share)
            return f"crop={w}:{h}:{x}:{y}"
    return _crop(plan, out_w, out_h)


def _layout(plan: EditPlan, i: int, footage: Path, seg: Segment, src_w: int, src_h: int) -> list[str]:
    """Filter chains that turn segment i's [raw{i}] into a 720x1280 [v{i}]."""
    if plan.layout == "split":
        # Whole frame across the top (slides stay readable), a tall crop on the speaker below.
        top_h = 404
        bottom_h = HEIGHT - top_h
        crop = _pane_crop(plan, footage, seg, src_w, src_h, WIDTH, bottom_h, face_share=0.32)
        return [
            f"[raw{i}]split[ts{i}][bs{i}]",
            f"[ts{i}]scale={WIDTH}:{top_h}[top{i}]",
            f"[bs{i}]{crop},scale={WIDTH}:{bottom_h}[bot{i}]",
            f"[top{i}][bot{i}]vstack,setsar=1[v{i}]",
        ]
    if plan.layout == "fit":
        # Whole frame, full width, centred over a blurred, zoomed copy of itself.
        crop_w = f"ih*{WIDTH}/{HEIGHT}"
        return [
            f"[raw{i}]split[bgs{i}][fgs{i}]",
            f"[bgs{i}]crop={crop_w}:ih:(iw-{crop_w})/2:0,scale={WIDTH // 4}:{HEIGHT // 4},boxblur=8:2,"
            f"scale={WIDTH}:{HEIGHT},eq=brightness=-0.12[bg{i}]",
            f"[fgs{i}]scale={WIDTH}:-2[fg{i}]",
            f"[bg{i}][fg{i}]overlay=0:(H-h)/2,setsar=1[v{i}]",
        ]
    crop = _pane_crop(plan, footage, seg, src_w, src_h, WIDTH, HEIGHT, face_share=0.2)
    return [f"[raw{i}]{crop},scale={WIDTH}:{HEIGHT},setsar=1[v{i}]"]


def render(plan: EditPlan, footage: Path, transcript: dict, out: Path, src_width: int, src_height: int) -> Path:
    workdir = out.parent
    workdir.mkdir(parents=True, exist_ok=True)
    segs, tl_words = timeline(plan, all_words(transcript))
    total = sum(s.end - s.start for s in segs)

    # libass needs a font dir it can open; ffmpeg's filter parser chokes on "C:" so use a relative path.
    fonts = workdir / "fonts"
    fonts.mkdir(exist_ok=True)
    if FONT_FILE.exists() and not (fonts / FONT_FILE.name).exists():
        shutil.copy(FONT_FILE, fonts / FONT_FILE.name)
    (workdir / "captions.ass").write_text(build_ass(plan, tl_words, total), encoding="utf-8")

    args = [ffmpeg(), "-v", "error", "-y"]
    for s in segs:  # one seeking input per segment: fast even on long footage
        args += ["-ss", f"{s.start:.3f}", "-t", f"{s.end - s.start:.3f}", "-i", str(footage.resolve())]
    parts = []
    for i, s in enumerate(segs):
        d = s.end - s.start
        # The layout is applied per segment, so a tracked crop can follow the speaker across camera cuts.
        parts.append(f"[{i}:v]setpts=PTS-STARTPTS,fps=30[raw{i}]")
        parts.extend(_layout(plan, i, footage, s, src_width, src_height))
        parts.append(
            f"[{i}:a]asetpts=PTS-STARTPTS,aresample=48000,afade=t=in:d={FADE},afade=t=out:st={max(0, d - FADE):.3f}:d={FADE}[a{i}]"
        )
    concat_in = "".join(f"[v{i}][a{i}]" for i in range(len(segs)))
    parts.append(f"{concat_in}concat=n={len(segs)}:v=1:a=1[cv][ca]")
    parts.append("[cv]subtitles=captions.ass:fontsdir=fonts[vout]")
    args += [
        "-filter_complex", ";".join(parts),
        "-map", "[vout]", "-map", "[ca]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        out.name,
    ]
    result = subprocess.run(args, cwd=workdir, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr[-2000:]}")
    return out
