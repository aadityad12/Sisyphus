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

# Caption looks the plan can pick. Each knob's default reproduces the captions from before they existed.
CAPTION_SIZE = {"small": 48, "medium": 62, "large": 78, "huge": 96}  # font px; outline scales with it
# ASS colours are &HBBGGRR: (text, karaoke highlight), the highlight picked to stand out from the text.
CAPTION_COLOR = {
    "white": ("FFFFFF", "00E5FF"),
    "yellow": ("00E5FF", "FFFFFF"),
    "green": ("5AE65A", "FFFFFF"),
    "cyan": ("FFFF00", "00E5FF"),
    "pink": ("B469FF", "FFFFFF"),
}
# (ASS alignment, vertical margin): lower third, centre, or high but clear of the hook, which sits at
# MarginV 170 and reaches about 320 px when it wraps to two lines.
CAPTION_POSITION = {"lower": (2, 330), "middle": (5, 0), "upper": (8, 350)}
# Applied to the cut before captions are burned in, so caption colours stay true.
COLOR_FILTERS = {
    "none": "",
    "warm": "colorbalance=rs=0.08:gs=0.02:bs=-0.08:rm=0.05:bm=-0.05,eq=saturation=1.08",
    "cool": "colorbalance=rs=-0.06:bs=0.08:rm=-0.04:bm=0.06",
    "bw": "hue=s=0,eq=contrast=1.12",
    "film": "eq=contrast=1.06:saturation=0.82,colorbalance=rs=0.04:bs=-0.04,noise=alls=7:allf=t,vignette=PI/5",
    "vivid": "eq=saturation=1.35:contrast=1.06",
}


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
    return seg.model_copy(update={"start": max(0.0, prev_end, start - 0.05), "end": min(end + 0.12, max(end, next_start))})


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
    """ASS subtitles: captions placed and styled by the plan's caption_* knobs, plus the hook at the top."""
    size = CAPTION_SIZE[plan.caption_size]
    text_c, high_c = CAPTION_COLOR[plan.caption_color]
    align, margin_v = CAPTION_POSITION[plan.caption_position]
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {WIDTH}
PlayResY: {HEIGHT}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Arial,{size},&H00{text_c},&H00{text_c},&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,{round(5 * size / 62)},2,{align},50,50,{margin_v},1
Style: Hook,Arial,54,&H00000000,&H00000000,&H00FFFFFF,&H00FFFFFF,1,0,0,0,100,100,0,0,3,14,0,8,60,60,170,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    if plan.hook.strip():
        lines.append(f"Dialogue: 1,{_ass_time(0)},{_ass_time(min(3.0, total))},Hook,,0,0,0,,{_escape(plan.hook.strip())}")
    if plan.caption_style != "none":
        for chunk in _chunks(timeline_words, plan.caption_words):
            texts = [_escape(w["word"]).upper() if plan.caption_caps else _escape(w["word"]) for w in chunk]
            chunk_end = chunk[-1]["end"]
            fit = _fit(texts, size, plan.caption_caps)
            if plan.caption_style == "plain":
                lines.append(f"Dialogue: 0,{_ass_time(chunk[0]['start'])},{_ass_time(chunk_end)},Cap,,0,0,0,,{fit}{' '.join(texts)}")
                continue
            for i, w in enumerate(chunk):
                start = w["start"]
                end = chunk[i + 1]["start"] if i + 1 < len(chunk) else chunk_end
                if end <= start:
                    continue
                shown = [f"{{\\c&H{high_c}&}}{t}{{\\c&H{text_c}&}}" if j == i else t for j, t in enumerate(texts)]
                lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Cap,,0,0,0,,{fit}{' '.join(shown)}")
    return header + "\n".join(lines) + "\n"


def _fit(texts: list[str], size: int, caps: bool) -> str:
    """A smaller font for a line whose longest word would run off the frame, else nothing.

    A word can't wrap, so at caption_size huge a 14-letter word in capitals was cut off at both edges
    (OVERPREDICTION, the first brain-rot render, 2026-11-07). Widths are estimated for Arial Bold.
    """
    room = WIDTH - 100  # the Cap style's 50 px side margins
    per_char = 0.72 if caps else 0.6  # average advance, in font sizes
    longest = max((len(t) for t in texts), default=0) * per_char * size
    return "" if longest <= room else f"{{\\fs{int(size * room / longest)}}}"


def timeline(plan: EditPlan, words: list[dict]) -> tuple[list[Segment], list[dict]]:
    """Snap the cuts, then map transcript words from source time onto the output timeline.

    The segments stay in source seconds (they are cut points); the words are in output seconds, so at a
    plan.speed other than 1 they are scaled with the sped-up picture and sound.
    """
    segs = [snap_to_words(s, words) for s in plan.segments]
    out, offset, speed = [], 0.0, plan.speed
    for seg in segs:
        for w in words:
            if w["start"] >= seg.start and w["end"] <= seg.end:
                out.append({
                    "word": w["word"],
                    "start": offset + (w["start"] - seg.start) / speed,
                    "end": offset + (w["end"] - seg.start) / speed,
                })
        offset += (seg.end - seg.start) / speed
    return segs, out


def _punch(p: float) -> str:
    """A centred crop by p, put before a pane's scale: a punch-in that keeps the crop's framing and costs
    no second resize. Nothing at 1."""
    return "" if p <= 1 else f"crop=iw/{p:.3f}:ih/{p:.3f},"


def _crop(plan: EditPlan, out_w: int, out_h: int) -> str:
    """An ffmpeg crop with the output's aspect ratio: height = source height / zoom, placed at crop_x, crop_y."""
    h = f"ih/{plan.zoom:.3f}"
    w = f"min(iw\\,{h}*{out_w}/{out_h})"  # escaped comma: a bare one would end the filter
    return f"crop={w}:{h}:(iw-{w})*{plan.crop_x:.3f}:(ih-{h})*{plan.crop_y:.3f}"


def _chain(
    plan: EditPlan, layout: str, src: str, out: str, tag: str, face, src_w: int, src_h: int, punch: float = 1.0
) -> list[str]:
    """Filters that turn [src] into a 720x1280 [out] in `layout`. `face` (or None) centres the crop; `punch`
    zooms the result for a punch-in (in split, only the bottom pane, so the slide stays whole)."""
    def pane_crop(out_w: int, out_h: int, face_share: float) -> str:
        if face and src_w and src_h:
            w, h, x, y = faces.crop_on_face(face, src_w, src_h, out_w, out_h, face_share)
            return f"crop={w}:{h}:{x}:{y}"
        return _crop(plan, out_w, out_h)

    if layout == "split":
        # Whole frame across the top (slides stay readable), a tall crop on the speaker below.
        top_h = 404
        bottom_h = HEIGHT - top_h
        return [
            f"[{src}]split[ts{tag}][bs{tag}]",
            f"[ts{tag}]scale={WIDTH}:{top_h}[top{tag}]",
            f"[bs{tag}]{pane_crop(WIDTH, bottom_h, 0.32)},{_punch(punch)}scale={WIDTH}:{bottom_h}[bot{tag}]",
            f"[top{tag}][bot{tag}]vstack,setsar=1[{out}]",
        ]
    if layout == "fit":
        # Whole frame, full width, centred over a blurred, zoomed copy of itself.
        crop_w = f"ih*{WIDTH}/{HEIGHT}"
        return [
            f"[{src}]split[bgs{tag}][fgs{tag}]",
            f"[bgs{tag}]crop={crop_w}:ih:(iw-{crop_w})/2:0,scale={WIDTH // 4}:{HEIGHT // 4},boxblur=8:2,"
            f"scale={WIDTH}:{HEIGHT},eq=brightness=-0.12[bg{tag}]",
            f"[fgs{tag}]scale={WIDTH}:-2[fg{tag}]",
            # The composite is already at output size, so a punch here crops and scales it back.
            f"[bg{tag}][fg{tag}]overlay=0:(H-h)/2"
            f"{',' + _punch(punch) + f'scale={WIDTH}:{HEIGHT}' if punch > 1 else ''},setsar=1[{out}]",
        ]
    return [f"[{src}]{pane_crop(WIDTH, HEIGHT, 0.2)},{_punch(punch)}scale={WIDTH}:{HEIGHT},setsar=1[{out}]"]


def _layout(plan: EditPlan, i: int, footage: Path, seg: Segment, src_w: int, src_h: int) -> list[str]:
    """Filter chains that turn segment i's [raw{i}] into a 720x1280 [v{i}].

    With track_face, the segment is split at camera cuts and each shot is framed on its own: centred on
    the face it shows, or, if it shows none (a slide, B-roll, a wide or empty shot), fitted whole. One crop
    for a whole segment put an empty desk on screen whenever the edit cut away from the speaker.
    """
    if not (plan.track_face and src_w and src_h):
        return _chain(plan, plan.layout, f"raw{i}", f"v{i}", str(i), None, src_w, src_h, seg.punch)
    shots = faces.shots(footage, round(seg.start, 2), round(seg.end, 2))
    framed = []
    for a, b in shots:
        face = faces.locate(footage, round(seg.start + a, 2), round(seg.start + b, 2))
        framed.append((a, b, face, plan.layout if face else "fit"))
    if len(framed) == 1:
        _, _, face, layout = framed[0]
        return _chain(plan, layout, f"raw{i}", f"v{i}", str(i), face, src_w, src_h, seg.punch)
    labels = "".join(f"[sh{i}_{k}]" for k in range(len(framed)))
    parts = [f"[raw{i}]split={len(framed)}{labels}"]
    for k, (a, b, face, layout) in enumerate(framed):
        tag = f"{i}_{k}"
        # [raw{i}] is already retimed to plan.speed, so the shot bounds (source seconds) are scaled to match.
        s, e = a / plan.speed, b / plan.speed
        parts.append(f"[sh{tag}]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS[st{tag}]")
        parts.extend(_chain(plan, layout, f"st{tag}", f"sv{tag}", tag, face, src_w, src_h, seg.punch))
    parts.append("".join(f"[sv{i}_{k}]" for k in range(len(framed))) + f"concat=n={len(framed)}:v=1:a=0[v{i}]")
    return parts


def render(plan: EditPlan, footage: Path, transcript: dict, out: Path, src_width: int, src_height: int) -> Path:
    workdir = out.parent
    workdir.mkdir(parents=True, exist_ok=True)
    segs, tl_words = timeline(plan, all_words(transcript))
    total = sum(s.end - s.start for s in segs) / plan.speed  # output seconds

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
    # Speed: setpts shortens the picture and atempo the sound (pitch kept); both are left out at 1.
    pts = "PTS-STARTPTS" if plan.speed == 1 else f"(PTS-STARTPTS)/{plan.speed:.4f}"
    tempo = "" if plan.speed == 1 else f",atempo={plan.speed:.4f}"
    for i, s in enumerate(segs):
        d = (s.end - s.start) / plan.speed  # output seconds, which the fade-out is timed in
        # The layout is applied per segment, so a tracked crop can follow the speaker across camera cuts.
        parts.append(f"[{i}:v]setpts={pts},fps=30[raw{i}]")
        parts.extend(_layout(plan, i, footage, s, src_width, src_height))
        parts.append(
            f"[{i}:a]asetpts=PTS-STARTPTS,aresample=48000{tempo},afade=t=in:d={FADE},afade=t=out:st={max(0, d - FADE):.3f}:d={FADE}[a{i}]"
        )
    concat_in = "".join(f"[v{i}][a{i}]" for i in range(len(segs)))
    parts.append(f"{concat_in}concat=n={len(segs)}:v=1:a=1[cv][ca]")
    grade = COLOR_FILTERS[plan.color_filter]
    parts.append(f"[cv]{grade + ',' if grade else ''}subtitles=captions.ass:fontsdir=fonts[vout]")
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
