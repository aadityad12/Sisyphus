# Editing

Pick the part of the transcript that best answers the brief and keep it as one or more segments.

## Vertical framing (crop_x)

A 9:16 crop keeps only about 32% of a 16:9 frame's width, so it can show the speaker or a slide, never both side by side.

- Before setting crop_x, inspect the start, middle, and end frames of the chosen segment(s) and locate the speaker's face in each. Set crop_x so the face is centred in the vertical frame — do not default to 0.5 unless the face is actually there.
- Anchor on the face, not the torso, stage, table, or room centre. The whole face must sit inside the crop with margin on both sides in all three frames; if any frame puts it at the edge, move crop_x or pick a segment where the speaker's position is stable.
- Never compromise between two subjects: a crop_x midway between a slide and a speaker panel slices both and makes neither readable. When a slide and a speaker inset appear together, crop to the speaker and let the captions carry the words.
- Crop to a slide only when the segment is slide-only with no visible face, and centre on the text block. If the slide's text spans most of the source width, it will be illegible in 9:16 — prefer a speaker-framed segment instead.
- If different segments place the speaker at very different horizontal positions, drop the shorter conflicting segment rather than averaging crop_x into empty space between positions.
