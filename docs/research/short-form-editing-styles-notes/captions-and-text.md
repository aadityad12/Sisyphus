# Captions and on-screen text in short-form vertical video (2025-2026)

Source-quality warning for the writer: almost everything here comes from vendor blogs (BlitzCut, OpusClip, Submagic, OpenClip, Fluxnote) with a commercial stake. Platform safe-zone numbers come from ad specs, not organic guidance. No head-to-head caption-style experiment with a disclosed method was found. The only cited primary stat sources are Verizon/Publicis (2019) and Meta/Facebook (undated).

## Platform safe zones for 9:16 and where captions should sit

### Takeaway
No platform publishes organic-post safe zones; the numbers are ad templates, which agree roughly: keep key text out of the top ~12-15%, the bottom ~34-35% and the right ~11-18% of a 1080x1920 frame. A cross-platform working area is about the centre 900x1400 px, so captions fit best in the middle band, lower-middle at the lowest.

### Cited Findings
- TikTok In-Feed ad template: top 240 px (12.5%), bottom 660 px (34.4%), left 120 px (11.1%), right 120 px, plus 300 px of action-button column from y=840 down. Reels (Meta ads guide): top 269 px (14%), bottom 672 px (35%), left/right 65 px (6%). Shorts (Google Ads help): top 288 px (15%), bottom 672 px (35%), left 48 px (4.4%), right 192 px (17.8%). The aggregator says these are ad guidance, not organic values — [upload-post safe zone checker](https://www.upload-post.com/tools/safe-zone-checker/) (cites TikTok Ads Manager Help, Meta Ads Guide, Google Ads Help)
- Reels ads with a disclaimer: keep the bottom 40% (768 px) clear — [upload-post](https://www.upload-post.com/tools/safe-zone-checker/)
- Conservative cross-platform working margins on 1080x1920: top ~15%, sides ~10-15%, bottom ~25-35%; TikTok: avoid the lowest ~25% for essential text. The source labels these "working margins, not official specifications" — [Reap](https://reap.video/blog/short-form-video-safe-zones)
- Dead-zone estimates: TikTok bottom 320-350 px and right 120-164 px; Reels bottom 310-450 px and right 120 px; Shorts bottom ~300 px and right ~48 px. For cross-posting, keep captions in a centred ~900x1400 px area — [BlitzCut TikTok caption size](https://blitzcutai.com/blog/best-caption-size-tiktok-2026)
- Other estimates differ (TikTok 108 px top / 320 px bottom; Reels bottom 250-420 px; Shorts "lighter overlay"), so the numbers are approximate — [search summary of Argil/Moonb/Postiz guides](https://www.moonb.io/blog/vertical-video-dimensions)
- OpusClip recommends the upper-middle third, clear of TikTok's right-side buttons and bottom caption text (this reflects its own style, which moves captions off the lower third) — [OpusClip](https://www.opus.pro/blog/why-viral-tiktoks-use-captions)
- A vendor claims bottom-third placement performs 10-15% worse in short form; unverified — [BlitzCut via search result](https://blitzcutai.com/blog/tiktok-caption-trends-2026)
- Other guidance: keep the last highlighted word off the right edge; test the longest two-line caption; do not cover eyes or hands — [Reap](https://reap.video/blog/short-form-video-safe-zones)
- A YouTube June 2026 "Clear Screen" mode for Shorts is mentioned; details not verified — [Reap](https://reap.video/blog/short-form-video-safe-zones)

### Inferences
- For caption_position, "middle" and "upper" are the lower-risk settings. "lower" is safe only if raised so the block ends above ~y=1250 (about 35% from the bottom) of 1920. A "lower" that follows the old convention (bottom 10-15%) collides with UI on all three platforms.
- The hook overlay at the very top collides with the top 12.5-15% band; it should start below ~y=290 px.

### Gaps
- No organic-post pixel numbers from TikTok, Meta or YouTube; no official source for the right-hand margin on Reels.

## Captions, watch time and sound-off viewing

### Takeaway
Roughly half of viewers watch muted in some settings (50% of subscribers usually; 69% in public places), but most "captions lift watch time 12-40%" claims are second-hand and untested. Measured effects are modest (~5-12%).

### Cited Findings
- Verizon Media/Publicis (2019, n=5,616 US adults): 50% usually watch without sound, 69% in public places; 80% said they are more likely to watch a video to completion when captions are available (stated preference) — [search summary of Verizon/Publicis; Rev roundup](https://www.rev.com/blog/ultimate-roundup-closed-captions-statistics), cited via [Mean CEO](https://blog.mean.ceo/?p=11554)
- Facebook internal testing: captioned video ads raised view time 12% (undated, second-hand) — [Mean CEO](https://blog.mean.ceo/?p=11554)
- Instapage A/B test (two months): +5% average total view time and 3% more viewers with captions — [Instapage via search result](https://instapage.com/amp/closed-captioning-mute-videos)
- Discovery Digital Networks reported +40% views for captioned YouTube videos, but the same roundup gives a lifetime lift of 7.32% — [Rev](https://www.rev.com/blog/ultimate-roundup-closed-captions-statistics)
- 74% of Facebook videos viewed without audio (Clipchamp); 79-80% of LinkedIn videos muted (LinkedIn, conflicting figures); 88% of TikTok users say sound is a must (TikTok, undated); the article flags the 92% muted figure as an older study — [Mean CEO](https://blog.mean.ceo/?p=11554)
- OpusClip internal analysis of 13.5M clips (Jan-Mar 2026): 80.2% of viral-tier clips use burned-in captions, 78.6% animate them. It claims animated captions hold viewers 15-20% longer than static, with no cited method; "~85% of mobile video watched with sound off" is also uncited — [OpusClip](https://www.opus.pro/blog/why-viral-tiktoks-use-captions)
- A vendor analysis reports 80.2% of 12.2M clips use captions, 1.6% static — [search result summary](https://blitzcutai.com/blog/tiktok-caption-trends-2026)
- BlitzCut states it has no controlled test showing word-by-word captions raise watch time — [BlitzCut](https://blitzcutai.com/blog/word-by-word-captions-vs-full-sentence-captions)

### Inferences
- TikTok viewers are comparatively sound-on (88% say sound is a must), so captions drive retention and comprehension there more than "muted viewers"; the muted case matters most for Reels, Facebook and LinkedIn cross-posts. Captions should default to on.
- caption_style "none" is rarely justified for talk footage.

### Gaps
- No peer-reviewed or platform-published caption-style experiment; no current (2025-26) sound-off share for TikTok/Reels/Shorts specifically.

## Common caption treatments and which style they signal

### Takeaway
Word-by-word 1-3 word captions with one accent colour are the baseline. The "Hormozi" bundle (bold all-caps, yellow/green active word, keyword colour, emoji, SFX) signals business/motivation; "dynamic minimalism" (white bold with black outline, subtle pop, one colour) is rising; lowercase thin captions signal lifestyle/quiet content.

### Cited Findings
- Hormozi look: Anton (current) uppercase with slight shadow, yellow stroke, pop-in from bottom up; older version used The Bold Font, uppercase, shadow, no stroke. CapCut shadow: opacity 100%, blur 70%, distance 14%; 4-6 words across 2 lines; Premiere: max 15 characters per caption, min 2 s, two lines. Keywords change colour and are enlarged by splitting the caption at the word — [Submagic Hormozi guide](https://www.submagic.co/blog/how-to-make-alex-hormozi-captions)
- Hormozi package elements: Montserrat Black or Proxima Nova Bold, white all-caps, yellow highlight (#f7c204), "woosh" sound, emoji between lines; called saturated, though the core mechanics still work — [BlitzCut trends 2026](https://blitzcutai.com/blog/tiktok-caption-trends-2026)
- Word-by-word captions show 2-3 words at a time; typewriter reveal is too slow above ~140 wpm; colour-switch per word suits clips under 30 s — [BlitzCut trends](https://blitzcutai.com/blog/tiktok-caption-trends-2026)
- "Dynamic minimalism": same timing and heavy font but no yellow highlight, SFX, emoji or multiple accents; white bold, black outline, subtle scale/fade — [BlitzCut trends](https://blitzcutai.com/blog/tiktok-caption-trends-2026)
- Pill/chip backgrounds (rounded solid-colour boxes) are rising and are CapCut's default; quiet/lowercase style: single line, centred, thin/medium weight, white or butter yellow (#F5D76E), no animation, lifestyle/wellness — [BlitzCut trends](https://blitzcutai.com/blog/tiktok-caption-trends-2026)
- Font table (BlitzCut): Montserrat 700-900 (business, education; most used), Bebas Neue (fitness, all caps only), Anton, Archivo Black (opinion), Poppins (lifestyle), Inter (tech/minimal), Proxima Nova (paid; in Submagic/CapCut presets), TikTok Sans (open-sourced mid-2025) — [BlitzCut trends](https://blitzcutai.com/blog/tiktok-caption-trends-2026)
- Font traits: weight 700-900; avoid thin, condensed, script; keep blocks 2-5 words; mixed case for most text, caps for short high-impact words; add stroke or drop shadow for legibility — [OpenClip font guide](https://openclip.app/guides/caption-font-guide.md)
- Keyword emphasis: colour, bold or size on 1-2 words per phrase; phrases under 7 words; OpusClip's own advice favours word pop (fast speech) or phrase reveal (slow speech) and says to avoid continuous scroll, static full-sentence blocks and karaoke highlight — [OpusClip](https://www.opus.pro/blog/why-viral-tiktoks-use-captions) (contradicts the BlitzCut and Submagic view that word highlight is standard)
- Talking-head / UGC / founder: readable phrase with restrained highlight; isolated words only for hook or key point; for fast speakers single-word replacement is hard to follow; do not cover demonstrated hands/UI — [BlitzCut word-by-word](https://blitzcutai.com/blog/word-by-word-captions-vs-full-sentence-captions)
- Podcast / multi-speaker: speaker labels are called essential because viewers cannot tell who is talking; Choppity added customisable lower-third speaker titles (Aug 2026); The Rest Is Politics burns show colours into the lower third — [search result summary](https://choppity.featurebase.app/changelog/customizable-lower-third-speaker-titles), [PlayPodcasts](https://playpodcasts.com/blog/cut-for-the-algorithm-british-podcasts-short-form-clips)
- Minimal/educational: lower-third, short lines, bold sans-serif, one accent colour for keywords, minimal animation — [Subclip](https://subclip.app/blogs/subtitle-styles-that-convert)

### Inferences
- Mapping to current controls: Hormozi/high energy = karaoke, 2-3 words, large/huge, all caps, yellow/green, middle. Podcast = karaoke or plain, 3-5 words, medium, mixed case, white, speaker label (missing). Educational = plain or light karaoke, 4-6 words, medium/large, white with one accent. Minimalist = plain, 4-7 words, small/medium, no caps, white, lower-middle.
- Missing features that matter most: keyword emphasis in a second colour (separate from the active-word highlight), stroke/shadow or pill background, speaker name labels, entry animation choice (pop vs fade), and a safe-zone-aware position.

### Gaps
- No performance data comparing treatments; Hormozi's own current captions not verified first-hand.

## Hook text overlays

### Takeaway
Overlays are short (3-8 words, 30-60 characters), appear on frame one and stay about 3-5 s, and sit below the top UI band; wording is curiosity, problem or payoff statements.

### Cited Findings
- Overlay summarises the hook in 3-8 words; decision window is 2-3 s; useful text within the first 1 s; keep text clear of faces and UI; examples "Your first cut is too late" (6 words), "Fix the caption rhythm" (4) — [CapCut hook patterns](https://www.capcut.com/create/short-form-video-hooks-first-3-second-patterns)
- Start on frame one and last at least 3 s (ideally 4-5); readable in under 2 s (30-60 characters); a one-word "Wait" can show under 1.5 s; another source suggests 5-8 words on screen 2+ s — [search result summary, CapCut text overlay timing and others](https://www.capcut.com/create/text-overlay-timing-ai-video-editing)
- Pattern types: start mid-action, payoff first, question hook, problem-first ("This is why people stop reading your subtitles"), caption-led tension, voiceover curiosity — [CapCut hook patterns](https://www.capcut.com/create/short-form-video-hooks-first-3-second-patterns)
- Position advice conflicts: lower third (one source) vs upper third on Reels to clear caption and like buttons (another) — [search result summary](https://www.capcut.com/create/text-overlay-timing-ai-video-editing)

### Inferences
- "POV:" and "Wait for it" patterns are widely known creator conventions but I found no citable numeric source for them; treat them as pattern examples only.
- Hook overlay must not share a band with the captions during 0-3 s; with captions in the middle, the hook belongs in the upper band under the top UI zone (about 15-30% of height).

### Gaps
- No platform data on hook overlay effect on retention; no source for "POV:" or "Wait for it" usage rates.

## Readability limits

### Takeaway
For word-by-word, 1-3 words at 70-90 px; for phrases 3-7 words at 60-75 px; floor about 48 px on 1080x1920. Subtitle norms are 42 characters per line, 2 lines, and 17-20 characters per second.

### Cited Findings
- Sizes on 1080x1920: minimum readable 48-55 px (~2.5-2.9% of height); standard talking-head 60-75 px; high-energy 75-95 px; hard max 100 px; caption block 12-20% of height (230-384 px); word-by-word 1-3 words at 70-90 px; short phrase 3-7 words at 60-75 px; full sentence 8-15 words at 50-60 px — [BlitzCut TikTok caption size](https://blitzcutai.com/blog/best-caption-size-tiktok-2026)
- Other vendor values: 40-60 px, minimum 24 px, 32 pt minimum — [search summary](https://www.bigmotion.ai/blog/youtube-shorts-dimensions-in-2025), [OpusClip](https://www.opus.pro/blog/why-viral-tiktoks-use-captions) (the figures do not agree)
- Minimum 1.5 s per caption in social video — [search summary](https://www.bigmotion.ai/blog/youtube-shorts-dimensions-in-2025)
- Netflix English timed text: 42 characters per line, max 2 lines; secondary sources say 20 cps adult / 17 cps children's, while others say 17/13; check the current guide — [Netflix style guide index](https://backlothelp.netflix.com/hc/en-us/articles/215758617), [Languages Unlimited](https://www.languagesunlimited.com/?p=17279)
- Typewriter reveal fails above ~140 wpm — [BlitzCut trends](https://blitzcutai.com/blog/tiktok-caption-trends-2026)

### Inferences
- Speech at 150-180 wpm is 2.5-3 words/s, so 1-3 word groups last ~0.4-1.2 s each; a 1-word group at fast speech falls below readable dwell (~0.3 s). caption_words of 1 should be avoided unless emphasis is the aim. caption_size huge (~90+ px) with 6+ words overflows 1080 px width.

### Gaps
- No eye-tracking or accessibility study for burned-in word-by-word captions found. A Disabled World piece (July 2026) argues karaoke captions can exclude disabled users; not read in full.

## Tool presets and their names

### Takeaway
Tools sell named style presets, typically 10-100+, named after creators or adjectives; none documents exact parameters publicly.

### Cited Findings
- Submagic: "Beast" template (colour, animation, font customisable); three or four Hormozi templates ("Hormozi 2" and "Hormozi 4" in third-party lists); third-party API list shows about 30 names including Sara, Daniel, Dan 2, Dan, Devin ("Daniel" not confirmed officially) — [Submagic MrBeast guide](https://submagic.co/blog/how-to-make-captions-like-mrbeast), [Submagic Hormozi guide](https://www.submagic.co/blog/how-to-make-alex-hormozi-captions), [ComfyUI node](https://comfy.icu/node/NSSubmagicCaptions)
- OpusClip: animated caption templates, brand kit with custom fonts; no public preset list found — [OpusClip captions](https://www.opus.pro/captions)
- OpenClip (separate product): presets Beast, Pop, Dan, Reveal, Mozi, Kendrick, Sara, Lucy, Tayo, Default; mapped Beast/Pop to gaming-entertainment, Dan/Reveal to business, Sara/Lucy/Tayo to personal brand; advises one preset consistently — [OpenClip font guide](https://openclip.app/guides/caption-font-guide.md)
- Captions (app, rebranded Mirage Sept 2025): caption generator in 100+ languages, 100+ template styles on Pro and above, font/colour/size and custom fonts — [Mirage help](https://help.mirage.app/mirage/edit-videos/generate-captions), [Wikipedia](https://en.wikipedia.org/wiki/Captions_(app))
- CapCut: pill backgrounds are the default per BlitzCut; Hormozi look achievable with The Bold Font plus shadow settings — [BlitzCut trends](https://blitzcutai.com/blog/tiktok-caption-trends-2026), [Submagic Hormozi guide](https://www.submagic.co/blog/how-to-make-alex-hormozi-captions)
- Generic preset labels: "Hormozi", "Dynamic Words", "Pop-Up" — [search result summary](https://www.kapwing.com/explore/hormozi-style-captions-template)

### Gaps
- Descript and CapCut caption preset names, and the OpusClip preset list, were not found.

## What is seen as overused or dated

### Takeaway
The full Hormozi package, per-word shake, neon colours, multi-colour all-caps lines, inline emoji and script/thin fonts are named as dated; restraint (one accent, one font) is the stated direction. Source is a single vendor blog, with a Reddit roundup echoing "overused templates."

### Cited Findings
- Dated: full Hormozi package (saturated), heavy shake/vibrate per word (2022-23, template default), electric blue and neon green outside gaming/music, all-caps with 3+ colours per line, inline emoji in subtitle lines (standalone emoji stickers still common), script fonts and thin weights; static full-sentence blocks weak as primary short-form captions — [BlitzCut trends 2026](https://blitzcutai.com/blog/tiktok-caption-trends-2026)
- Word-by-word karaoke is "table stakes"; creators complain about overused templates — [search summary incl. wildandfreetools Reddit roundup](https://www.wildandfreetools.com/blog/best-tiktok-captions-reddit-2026/)
- Karaoke highlighting may exclude some disabled users (July 2026 article) — [Disabled World](https://www.disabled-world.com/disability/accessibility/karaoke-captions.php)

### Inferences
- Differentiation now comes from restraint and fit to the content; with a limited colour list, white plus one accent is the safe default, and neon-like cyan/pink read as dated outside entertainment.

### Gaps
- Only one detailed source for "dated" claims; the vendor sells caption tools, so trend claims are opinion.
