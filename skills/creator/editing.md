# Editing

Pick the part of the transcript that best answers the brief and keep it as one or more segments.

## What every clip needs, whatever its style

All three platforms measure how many viewers swipe away in the first 3 seconds, so that is where a clip is won or lost.

- The claim lands in the first 3 s: start the first segment mid-thought, with the tension already stated, not on a greeting or a run-up.
- Something visible changes every few seconds: on talk footage that is a cut or a punch-in. Fast styles change every 2-5 s or quicker; slow styles hold longer takes on purpose, and their files say how long.
- The clip stands alone: no setup it depends on is left out. It ends on the payoff, not on a call to action.
- Unless the brief or the style says otherwise, aim for 25-60 s.
- Keep text out of the platforms' buttons and description: caption_position middle is safe everywhere; lower sits just above the description area.
- Punch-ins are small: 1.08-1.20 reads as a cut, and more upscales the face until it goes soft.

## Vertical framing (crop_x)

A 9:16 crop keeps only about 32% of a 16:9 frame's width, so it can show the speaker or a slide, never both side by side.

- Before setting crop_x, inspect the start, middle, and end frames of the chosen segment(s) and locate the speaker's face in each. Set crop_x so the face is centred in the vertical frame — do not default to 0.5 unless the face is actually there.
- Anchor on the face, not the torso, stage, table, or room centre. The whole face must sit inside the crop with margin on both sides in all three frames; if any frame puts it at the edge, move crop_x or pick a segment where the speaker's position is stable.
- Never compromise between two subjects: a crop_x midway between a slide and a speaker panel slices both and makes neither readable. When a slide and a speaker inset appear together, crop to the speaker and let the captions carry the words.
- Crop to a slide only when the segment is slide-only with no visible face, and centre on the text block. If the slide's text spans most of the source width, it will be illegible in 9:16 — prefer a speaker-framed segment instead.
- If different segments place the speaker at very different horizontal positions, drop the shorter conflicting segment rather than averaging crop_x into empty space between positions.
