# Reviewer skills

Every `.md` file in this folder is loaded into the Reviewer's prompt at runtime, in name order.

The Reviewer decides whether a Creator video is good enough. It either pushes the video forward or sends it back.

The Auditor improves these files. A Reviewer change wins its A/B test by agreeing with human verdicts more often. A Reviewer never grades itself.

`styles/` holds the Reviewer's own idea of a good clip in each editing style. They are not loaded with the files above: the Reviewer gets the files for the styles a clip used. They are separate from the Creator's style files so that a Creator change can't lower the bar it is judged against (issue #13).
