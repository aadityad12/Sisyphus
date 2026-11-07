# Visual and audio treatments in short-form vertical video (2025-2026), beyond captions

Source-quality caveat for the whole file: almost everything found is vendor blogs, tool landing pages and SEO tutorials (CapCut/Pippit, Submagic, OpusClip, Filmora, etc.). I found no independent platform documentation for loudness, no controlled retention studies for any treatment here, and very few dated "this is now out of fashion" statements. Numbers below are rules of thumb from those sources, not measured effects. Date context: today is 2026-11-07; most pages are undated or 2025-2026.

## Zooms: punch-in, slow push, shake

### Takeaway
Small punch-ins of about 105-120% on emphasis moments, repeated every few seconds, are the standard talking-head treatment. Fast jump zooms suit beats and cuts; slow pushes suit reveals. Shake is a CapCut effect with no source recommending it for talking heads.

### Cited Findings
- Premiere guide: raise Scale from 100 to about 120, or bump a middle slice to 110-115 — [Firecut](https://firecut.ai/blog/how-to-zoom-in-on-premiere-pro-a-step-by-step-guide-for-beginners/)
- Subtle 105-108% zooms for short clips, 110-120% for longer ones, with gentle easing — [Pippit slow zoom](https://www.pippit.ai/blog/capcut-alternative/slow-zoom-capcut)
- A fast punch-in is an 8-15% scale jump with a short ease-in, for beats and cuts; slow push-ins of 100% to 120% reveal details — [Pippit zoom-in effect](https://www.pippit.ai/blog/capcut-alternative/capcut-zoom-in-effect)
- Frequency: "a tasteful zoom every 3-7 seconds" for short-form, subtler for education, bolder for entertainment — [Pippit zoom effect](https://www.pippit.ai/blog/capcut-alternative/capcut-zoom-effect)
- Punch-ins are placed on key statements or reactions in talking-head clips, giving emphasis without a second camera — [AutoClip](https://autoclip.dev/blog/how-to-use-punch-in-zoom-effect)
- When combined with a reframe, keep the push subtle; a big zoom plus a big reposition feels "floaty" — [Cursa](https://cursa.app/en/page/keyframes-in-capcut-smooth-zooms-reframes-and-motion-that-follows-the-subject)
- Submagic auto-zoom: 6 unnamed zoom styles (earlier results mention fast, smooth, "expo"), timed from the transcript, can be added manually on a subtitle line, also applied to B-roll; page gives no scale, duration or frequency — [Submagic auto zooms](https://submagic.co/features/auto-zooms)
- Opus, EditBuddy and Eliro also auto-place transcript-driven zooms — [Opus zoom](https://www.opus.pro/tools/zoom-in-effect)
- Shake: CapCut's effect has adjustable intensity, speed, direction; guidance is to keep it subtle, and locked-off framing is the norm for talking heads — [FlexClip](https://FlexClip.com/learn/how-to-do-the-shake-effect-on-capcut.html), [Pippit](https://pippit.capcut.com/templates/camera-shake-effect)
- Warning that constant automated zooming can be distracting; review each cut — [search summary of reframing guides, e.g. ClipSpeed](https://clipspeed.ai/blog/vertical-video-editing-guide.html)

### Inferences
- The existing 1.0-2.0 punch-in range is far wider than practice; a useful default is 1.08-1.20, with 2.0 effectively never used. Source resolution matters: zooming 720p by 300% looks blurry (joyspace source below).
- Zoom should be a hard (or 0.1-0.2 s eased) step at a segment boundary, alternating 1.0 and ~1.12-1.2, which fits the renderer's per-segment model. Slow push (Ken Burns) would need a time-varying crop expression in ffmpeg.
- Emphasis words and sentence starts are the natural trigger points; the transcript is already available.

### Gaps
- No source compared hard jump-cut zooms against smooth keyframed zooms. No source recommended shake for talking heads. No independent data on zoom frequency vs retention.

## Reframing 16:9 to 9:16 for one and two speakers

### Takeaway
Pro tools use three layouts: full-frame crop on the active speaker, stacked split screen (both visible), and grids for 3+. Switching is driven by audio activity plus face detection, with eased crop movement.

### Cited Findings
- Split screen for interviews, debates, reactions, overlapping speech; costs size (about 540 px of height per speaker in a 50/50 1080x1920 split versus 1920 px full-frame); single-speaker moments use a crop on the active speaker, and layouts should be used deliberately, not switched constantly — [ClipSpeed](https://clipspeed.ai/blog/vertical-video-editing-guide.html)
- Layout by use: split (host top, guest bottom) for interviews/debates/reactions; full-screen punch-in for storytelling and emotional moments; grid for 3-4 speakers with the active speaker at about 60% of the screen; switching uses active mic plus face detection; no timing values given — [Joyspace](https://joyspace.ai/speaker-highlight-method-automated-framing)
- Google Cloud write-up of Glance: active speaker detection positions the speaker at the top of a split screen, with easing on crop movements — [Google Cloud](https://cloud.google.com/blog/products/media-entertainment/how-glance-turns-hours-of-video-into-mobile-ready-clips-with-ai)
- Failure mode: auto-reframe can lock onto the wrong face during crosstalk; fix by correcting the speaker track or switching to split — [Joyspace / reframing guides](https://joyspace.ai/speaker-highlight-method-automated-framing)
- Open-source clipify uses ffmpeg with motion-energy detection on speaker regions to pan or switch to split — [SourcePulse listing](https://www.sourcepulse.org/projects/29456955)
- Descript users requested a one-click split-screen/active-speaker vertical layout, implying it was not native — [Descript Canny](https://descript.canny.io/feature-requests/p/one-click-podcast-to-reel-vertical-layout-split-screen-active-speaker)

### Inferences
- The renderer's "split: full frame on top, face crop below" is a conference-talk/slide layout; the podcast equivalent is two face crops stacked, which it lacks. Speaker-over-slide is the same idea with a slide on top.
- Speaker switching needs a minimum hold and eased/hard-cut rule; no source gave one. A sensible untested default is to hold at least about 1-2 s and ignore backchannels (e.g. "yeah").

### Gaps
- No concrete headroom/face-position offsets, minimum shot hold, or switch latency from any source.

## Colour grading

### Takeaway
For talking-head footage the advice is correction first, then a light consistent grade; heavy stylised looks are not recommended for sit-down content. Contrast and cleaner colour help phone legibility.

### Cited Findings
- Two phases: primary correction (white balance, exposure, contrast; pull blacks to zero on the waveform), then a minimal creative grade; slight cool shadows, warm highlights, or a LUT at 30-50% opacity; "if the viewer notices the grade it's too heavy" — [DaVinci-style tutorial summary, Infinite Creation](https://infinitecreation.pages.dev/tutorial-color-grade-talking-head.html)
- Normalize all clips to similar contrast/colour cast before applying a look; a LUT is a fixed treatment, not a fix — [Adobe Community](https://community.adobe.com/t5/premiere-pro/color-grade/m-p/12137135)
- Podcast/webinar footage often looks washed out; better contrast helps captions and faces read on phones — [AlcheClip](https://alcheclip.vercel.app/features/color-grading)
- Restrained saturation and softened contrast for sit-down content; "studio podcast" preset warms midtones slightly, keeps background subdued — [Filmora](https://filmora.wondershare.com/video-creative-tips/minimal-color-grading-video-lut-filters.html)

### Inferences
- Of the six filters, "vivid" (modest, not extreme), "warm" and "film" at partial strength map to practice; bw is a stylistic choice for serious/quote content. An auto-contrast / black-point level step plus a mild S-curve may beat any preset. Presets at 30-50% mix is cheap in ffmpeg (blend original with graded).

### Gaps
- No sourced numbers for contrast/saturation by style (e.g. teal-orange, muted); no evidence on which grades perform on which platform.

## Transitions

### Takeaway
Hard cuts remain the default; vendor guidance across sources is restraint. Glitch/flash/zoom transitions are marketed as trending but with overuse warnings; no source declared a specific transition dead.

### Cited Findings
- CapCut says glitch effects still trend in 2026 for high-energy edits — [CapCut trends](https://www.capcut.com/help/capcut-transitions)
- Flash transitions can overwhelm if overused; J-cuts and L-cuts read more professional than fancy effects — same search results ([CapCut transitions](https://www.capcut.com/help/capcut-transitions), [Eklipse](https://blog.eklipse.gg/beginner-guide-2/how-to-use-transitions-effectively-in-short-form-video-editing.html))
- Trending: match cuts, object wipes, beat-synced snaps/flicks, micro-loops; transitions seen across many niches are "crowded", and predictable wipes/zooms lose satisfaction; busy edits age faster; no durations or frequencies given — [CapCut transition trends](https://www.capcut.com/create/video-transition-trends-viral-short-form-edits)
- A "lo-fi" rejection of polish is also reported as a trend — same CapCut help page search result (single vendor)

### Inferences
- Transition trends here are mostly creator/lifestyle content; for talking-head and podcast clips, hard cuts plus occasional zoom are the norm and effects transitions are low priority.

### Gaps
- No source on whip pans specifically for talking heads, and no neutral statement of what is "dated".

## Audio: music, ducking, SFX, loudness, voice cleanup

### Takeaway
Loudness: about -14 LUFS integrated, -1 dBTP is the working consensus, but TikTok and Reels publish nothing. Music sits roughly 12-18 dB under voice (ducked), SFX are short and sparing.

### Cited Findings
- YouTube recommends -14 LUFS integrated with -1 dBFS true peak max; TikTok and Reels have no published specs, apply their own normalisation; -14 to -16 LUFS is a safe range — [OpenClip](https://openclip.app/learn/audio-normalization)
- Louder-than-target audio is turned down, not boosted; some suggest about -13 LUFS to compete (single vendor, conflicts with -14); true peak about -1 dBTP — [DEV Community](https://dev.to/arthurvalle1_a2586dd2b4bc/mastering-for-reels-tiktok-and-youtube-shorts-the-lufs-14-standard-2ck5), [OpenClip LUFS](https://openclip.app/learn/lufs)
- Avoid heavy limiting/compression that flattens dialogue; normalise clips with differing gain — [OpenClip](https://openclip.app/learn/audio-normalization)
- Music under voice: -12 to -18 dB for voice-led content — [Sonilo](https://sonilo.com/blog/how-to-add-background-music-to-a-video); others 10-20 dB; an Adobe forum user settled on about -12 dB — [Adobe Community](https://community.adobe.com/t5/premiere-pro-discussions/help-with-audio-settings-for-voice-over-and-music/m-p/12040586/highlight/true); 18-24 dB from one vendor test (outlier) — [Overseer](https://www.overseeros.com/blog/background-music-volume-under-voiceover)
- Ducking: start at about 6-12 dB, fast attack, release roughly 250-700 ms; lighter duck for short-form; fix the voice first, don't use music to hide problems — [Typecast](https://typecast.ai/learn/?p=14829), [CapCut ducking](https://www.capcut.com/create/audio-ducking-for-clear-dialogue-in-video)
- SFX: riser peak lined up with the cut/title reveal; whoosh length matches the move length; pop/click for text pop-ups; impacts on jump cuts; reusing the same whoosh loses effect; fewer purposeful SFX beat big libraries — [Fish Audio](https://fish.audio/blog/using-sound-effects-for-short-form-content), [Sonilo transitions](https://sonilo.com/blog/guides/transition-effect-sound-video-edits)
- Submagic markets automatic SFX (whooshes, pops, risers) timed to text animations and background music; Opus Clip is described as lacking these, but that comes from Submagic's own comparison — [Submagic vs Opus](https://submagic.co/blog/opus-clip-vs-submagic)

### Inferences
- The renderer can do loudnorm (I=-14, TP=-1) in one/two-pass ffmpeg, and sidechaincompress for ducking, cheaply. Both are low effort. A reasonable music default: about -18 to -22 LUFS bed (roughly 14-18 dB under the voice), ducked a further 6 dB under speech.
- Podcast speech usually needs only loudnorm plus light denoise (afftdn/arnndn) and maybe a high-pass; no source covered voice enhancement tools like Adobe Enhance Speech with parameters.

### Gaps
- No platform-primary documentation for TikTok/Reels loudness. No dB levels for SFX relative to voice. Nothing found on trending sounds or commercial licensing (business accounts typically cannot use the trending commercial catalog, but I did not source that). No info on silence as a technique, or on noise removal parameters.

## Other elements: B-roll, emoji, progress bars, frames, gameplay split-screen, grain, letterbox

### Takeaway
Auto B-roll is the most prominent competitor feature; the rest are decoration with thin evidence. Gameplay split-screen is documented as a trend but not shown to raise retention.

### Cited Findings
- Submagic "Magic B-rolls": auto-inserts stock (Pexels, Pixabay) or user clips, user sets timing and duration; zooms apply to them — [Submagic B-roll](https://submagic.co/features/b-roll)
- Progress bars: vendors say creators use them to boost retention; "10-16 px chunky" look is from one tool page — [Echowave](https://echowave.io/tools/video-progress-bar/)
- Film grain overlays use Multiply/Soft Light/Overlay blend modes; film-matte letterbox and rounded-corner frames are sold as overlays — [Kapwing](https://www.kapwing.com/explore/editorskeys-film-rounded-corners-reels-overlay)
- Emoji/stickers are bounce-animated overlays — [FlowShorts](https://flowshorts.app/blog/tiktok-overlays)
- Subway Surfers/Family Guy split-screen videos went viral (Bloomberg, 2023) and are called "sludge content"; no retention data — [Bloomberg](https://www.bloomberg.com/news/newsletters/2023-02-03/tiktok-subway-surfers-family-guy-videos-are-terrible-for-attention-span), [Studybreaks](https://studybreaks.com/tvfilm/subway-surfers-new-storytelling-method)
- Eye-tracking study (2025, ASMR/cleaning split-screen, not gameplay): split-screen raised engagement and satisfaction versus subtitles-only, with no change in recall — [iMotions](https://imotions.com/blog/publications/short-form-videos-an-exploratory-study-on-the-impact-of-subtitles-and-asmr-split-screen-format-options-using-eyegaze-and-facial-expression-data/)
- Pacing advice of a visual change every 2-3 s comes from a scraped repost, low reliability — [Strategia](https://strategia-x-v2.pages.dev/blog/2026-07-01-vertical-video-retention-editing-playbook)

### Inferences
- Gameplay split-screen, grain, letterbox and emoji spam are likely read as low-effort or niche for podcast/conference content (inference, not sourced); they also risk the "premium" read. Premium signals suggested by the sources: consistent light grade, clean audio, restrained zoom, purposeful SFX, J/L-cuts.

### Gaps
- No source explicitly lists treatments as "dated" or "premium". Nothing credible on emoji or progress-bar effectiveness.

## Ranking for an ffmpeg-based automated editor (effort vs impact)

This ranking is my inference from the findings above, not a sourced result.
1. Loudness normalisation to -14 LUFS / -1 dBTP plus light denoise/high-pass (very low effort, consistent quality, matches every audio source).
2. Narrow and calibrate the punch-in (default 1.08-1.2, every 3-7 s, on emphasis words; hard step or short ease) (low effort).
3. Two-speaker handling: active-speaker switching and stacked two-face split (medium effort; the biggest gap for podcast footage).
4. Mild consistent grade: black-point/contrast step and partial-strength preset (low effort).
5. Background music with sidechain ducking (medium effort, depends on licensed tracks) at about 12-18 dB under voice.
6. Sparse SFX (pop on text, whoosh on zoom/cut) (medium; needs asset library and restraint).
7. Auto B-roll (high effort; stock sourcing and relevance matching).
8. Progress bar (low effort in ffmpeg, but unproven value), grain, letterbox, emoji, gameplay split (low priority).
