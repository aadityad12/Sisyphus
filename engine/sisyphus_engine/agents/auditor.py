"""Auditor: groups similar failures and proposes small, targeted changes.

It changes skills, prompts, tools and the editing software (mostly skills). Each change goes on its
own Git branch and must win a shadow A/B test before it becomes the new standard (see VISION.md).
"""

from . import load_skills


def audit(failures: list[dict]) -> None:
    skills = load_skills("auditor")
    raise NotImplementedError("Auditor not built yet")
