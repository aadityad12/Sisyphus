"""Failure attribution, as defined in VISION.md."""

from enum import Enum


class Agent(str, Enum):
    CREATOR = "creator"
    REVIEWER = "reviewer"


def attribute_failure(reviewer_approved: bool, human_liked: bool | None) -> set[Agent]:
    """Return which agents failed for one video.

    reviewer_approved: True if the Reviewer pushed the video forward, False if it sent it back.
    human_liked: True or False once humans have given feedback, None if they haven't.
    """
    if not reviewer_approved:
        if human_liked:
            # Sent back a video humans liked: the Reviewer's failure only.
            return {Agent.REVIEWER}
        # Sent back: the Creator's failure (the most common case).
        return {Agent.CREATOR}
    if human_liked is False:
        # Pushed forward a video humans dislike: both agents failed.
        return {Agent.CREATOR, Agent.REVIEWER}
    return set()
