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

Not yet checked: how the mark reads below 512 px, for example as a favicon.

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
(3:1) but not body text (4.5:1); 5.21:1 on black and 4.68:1 on the app background `#111114`,
which meet AA for body text.

The app's colors, as hardcoded in `app/src/App.css` on 2026-11-07 (it defines no CSS variables
yet; the Figma variables carry proposed `var(--…)` names for when it does):

| Figma variable | Hex | In the app |
|---|---|---|
| `color/bg/canvas` | `#111114` | Page background |
| `color/bg/surface` | `#18181C` | Panels |
| `color/bg/raised` | `#1D1D22` | Tab buttons |
| `color/border/default` | `#2C2C33` | Borders |
| `color/text/primary` | `#E8E8EA` | Text |
| `color/accent/highlight` | `#F5B942` | "SI" in the title, active tab border |
| `color/status/success`, `-bg` | `#7EE2A0` on `#1F3D2A` | "ok" pill |
| `color/status/danger`, `-bg` | `#F08A8A` on `#3D1F1F` | "down" pill |

The app highlights in amber `#F5B942` while the brand accent is orange `#EA3F00`. They are kept as
separate variables until one is chosen.

## Type

| Font | Used for | License |
|---|---|---|
| Caesar Dressing (Regular, its only weight) | The wordmark and display headlines | SIL Open Font License, via Google Fonts |
| Inter | Interface and body text, as in `App.css` | SIL Open Font License |

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
