# SIsyphus brand

Logo files, colors and type for SIsyphus. The source is the Figma file
[sisyphus](https://www.figma.com/design/zLcCWPF9npw0gvOSwI9UKX/sisyphus): **Page 1** holds the logo
artwork and the export frames (the "Sisyphus logo assets" frame), and **Design System** holds the
color variables, text styles and usage notes. Everything in `logo/` was exported from it on
2026-11-07.

## Logo files

Three versions, each in four color treatments.

| Folder | What it is | Canvas |
|---|---|---|
| `logo/lockup/` | Figure pushing the boulder, with the slanted wordmark | 1024×1024 |
| `logo/mark/` | Figure pushing the boulder, no text | 1024×1024 and 512×512 |
| `logo/wordmark/` | "sisyphus" in Caesar Dressing | 1600×600 |

| Name ends in | Artwork | Background | Suits |
|---|---|---|---|
| `-black` | black, orange accent | transparent | light backgrounds |
| `-white` | white, orange accent | transparent | dark backgrounds |
| `-on-white` | black, orange accent | white | places that need a solid tile: avatars, social cards, store listings |
| `-on-black` | white, orange accent | black | the same, dark |

Every variant is a PNG. The 1024 and wordmark canvases are also SVGs, which scale to any size; the
mark's PNGs carry their size in the name (`-1024`, `-512`).

The artwork fills 80% of every canvas, centered, so each file already has 10% clear space on all
sides. Cropping into that margin crowds the logo.

The brush texture on the boulder and the play button is drawn as dense paths, so the lockup and
mark SVGs are about 0.8 MB each (the wordmark SVGs about 40 KB). The PNGs are 20 to 60 KB.

The app's favicon (`app/public/favicon.png`, 64 px, and `apple-touch-icon.png`, 180 px) is the
on-black mark scaled down. At 64 px the figure, boulder and orange play button still read
(2026-11-07); the transparent variants vanish on a dark browser tab, so the favicon keeps its
black square.

## Accent

Orange `#EA3F00` marks two things: the play button inside the boulder, and the dot on the i in
the wordmark. The slanted wordmark inside the lockup keeps a plain i dot (decided 2026-11-07).

## Colors

| Name | Hex | Role |
|---|---|---|
| Ink | `#000000` | Logo artwork on light |
| Paper | `#FFFFFF` | Logo artwork on dark |
| Sisyphus Orange | `#EA3F00` | Accent |

Contrast of the orange (WCAG 2): 4.03:1 on white, which meets AA for graphics and large text
(3:1) but not body text (4.5:1); 5.21:1 on black and 4.85:1 on the app background `#0c0c0f`,
which meet AA for body text.

The app's colors are CSS variables in `:root` in `app/src/App.css` (as of 2026-11-07, after the redesign in
#31); that file is the source of truth, and the main ones are:

| Variable | Value | In the app |
|---|---|---|
| `--bg-0` … `--bg-4` | `#08090a`, `#0e0f11`, `#141517`, `#1a1b1e`, `#232428` | Surfaces, darkest to lightest: window, main panel, cards, raised, highest |
| `--border-1` … `--border-3` | white at 6%, 10%, 16% | Borders, on any surface |
| `--text-1` … `--text-4` | `#f4f5f6`, `#c2c5cc`, `#8b8f98`, `#5d6169` | Text, from titles to placeholders |
| `--accent`, `--accent-text` | `#e8450e`, `#ff7a45` | Brand orange: the primary action, selection and focus; the lighter tone for text on dark |
| `--ok`, `--err`, `--warn`, `--info` | `#46c48a`, `#f0595d`, `#f0b429`, `#5aa9fa` | Status, each with a `-tint` fill |
| `--creator`, `--reviewer`, `--auditor` | `#5aa9fa`, `#a98bfa`, `#f0b429` | One color per agent |
| `--style` | `#2fc9b4` | Editing styles (#13) |

The Figma Design System page's color variables (`color/bg/canvas` and so on) still hold the colors from before
#12 as of 2026-11-07; update them from `App.css` when the Figma file is next touched.

The redesign settled the amber-or-orange question for the interface: the brand orange is the app's accent, and
amber is kept only as the Auditor's color.

## Type

| Font | Used for | License |
|---|---|---|
| Caesar Dressing (Regular, its only weight) | The wordmark and display headlines | SIL Open Font License, via Google Fonts |
| Inter | Interface and body text, bundled with the app (`@fontsource-variable/inter`) | SIL Open Font License |
| JetBrains Mono | Versions, ids, timecodes, bundled (`@fontsource-variable/jetbrains-mono`) | SIL Open Font License |

Figma text styles:

| Style | Font | Size / line height |
|---|---|---|
| `Display/XL` | Caesar Dressing | 96 / 100% |
| `Display/L` | Caesar Dressing | 56 / 100% |
| `Heading/H1` | Inter Bold | 28 / 120% |
| `Body/Default` | Inter Regular | 16 / 150% |
| `Body/Small` | Inter Regular | 14 / 150% |
| `Label/Small` | Inter Medium | 12 / 130% |

Spacing (`space/xs` to `space/lg`: 4, 8, 16, 24) and radius (`radius/sm` 8, `radius/md` 12,
`radius/full` 999) come from the paddings and corners in `App.css`.

## Updating the files

In Figma, the `-black` and `-white` frames under "Sisyphus logo assets" are components; every other
logo frame is an instance of one of them, so editing a component updates its variants. Each frame
is named `logo/<version>/<file>` and carries its PNG and SVG export settings, so selecting
"Sisyphus logo assets" and exporting rebuilds this folder.

When these files were exported through the Figma MCP tools (2026-11-07), the export painted the
page's own background (`#1E1E1E`) behind the transparent frames. Setting the page background's
opacity to 0 while exporting avoided it in the PNGs; the SVGs had the extra `<rect>` removed by
hand.
