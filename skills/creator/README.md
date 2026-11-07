# Creator skills

Every `.md` file in this folder is loaded into the Creator's prompt at runtime, in name order.

The Creator makes and edits short-form videos from raw footage plus a brief: editing, music, transcripts, audio, assets, and anything else high-quality content needs.

The Auditor improves these files. Each change goes on its own Git branch and must win a shadow A/B test before it is merged.

`styles/` holds one file per editing style (brain rot, simple, polished, artsy, and any that people or the Auditor add). These are not loaded with the files above: the Creator gets the styles a job asks for, or on Auto the whole library to pick from, and lists the ones it used in the plan's `styles`, which become the video's tags. The Reviewer has its own file per style in `skills/reviewer/styles/` (issue #13).
