# SIsyphus: vision

> *One must imagine SIsyphus editing.*

## What it is

SIsyphus is a self-improving video editing system. **SI** stands for **Self-Improving**.

In the myth, Sisyphus pushes a boulder up a hill and it always rolls back. SIsyphus keeps what works: changes that fail evaluation roll back, and changes that pass stay. *SIsyphus, but the hill gets shorter.*

## Why we're building it

It is our entry to the AIE Code Summit 2026 Hackathon (Cerebral Valley, Shack15, San Francisco, 2026-11-07), in the track **"The System That Gets Better"**:

> Build an autonomous coding system that completes a hard, tightly coupled software task and improves itself as it works. Each failure becomes a versioned change to its skills, tools, routing or context, and each change has to prove itself on held-out work. How can it keep making progress over a long task, adopt only the changes that held-out evaluation confirms, and roll back the rest?

Applied to video editing, the track asks for the following:

- The system edits video.
- Each failure becomes a **versioned change** to its skills, tools, routing or context.
- Each change has to **prove itself on held-out work** before it is adopted.
- Changes that don't pass evaluation are **rolled back**.

## How it works

SIsyphus is a **desktop app** with three agents.

| Agent | Role |
|---|---|
| **Creator** | Makes and edits short-form videos. It handles editing, music, transcripts, audio, assets, and anything else high-quality content needs. |
| **Reviewer** | Reviews what the Creator makes and decides whether it is good enough. It either sends the video back or pushes it forward. |
| **Auditor** | Audits failures and writes updates to the agents' skills, tools, software and so on. |

### Failures

Failures can come from the Creator, the Reviewer, or both:

| What happened | Whose failure |
|---|---|
| The Reviewer sends a video back. | The Creator's. This will be the most common failure. |
| The Reviewer sends back a video that humans liked. | The Reviewer's only. This overrides the row above. |
| The Reviewer pushes forward a video that humans dislike. | Both agents'. |

### Improving

The Auditor turns identified failures into changes. Every change is **versioned** and **verified** before it becomes the new standard.

There will be many failures, so the Auditor **must not overreact** to any single one.

### Human feedback

- People leave comments and feedback **in the app**, on content and at different points in the system.
- The main human review comes **after the Reviewer approves** a video.
- A **rejected-videos tab** shows every video the Reviewer sent back. If people liked one, that counts as a Reviewer failure.

### Creator input

The Creator starts from **raw footage plus a brief**: a long clip, such as a talk, podcast or screen recording, and a one-line goal (for example, "30s clip on X").

### Open: how the Creator edits

This is left to whoever builds the editing agent. Some options:

- **Edit plan rendered with ffmpeg (recommended).** The Creator writes a structured edit plan (cuts, captions, music, zooms), and a fixed renderer turns it into an MP4. Plans are easy to diff and version, and the Auditor can improve the Creator's skills separately from the renderer's tools.
- **Remotion (React video).** Polished captions and motion graphics, but heavier and slower to render on a laptop.
- **Free-form ffmpeg or Python scripts.** The most flexible, but the hardest to version and verify, because each video is its own code.

Whichever is chosen, the Auditor's changes need to be versionable and verifiable.

### What the Auditor can change

The Auditor can change the agents' **skills, prompts and tools, and the editing software**. Most changes will be to **skills**, but the right target depends on the failure.

### Not overreacting

- Every failure is logged with its reason.
- The Auditor **groups similar failures** and proposes a change only when a pattern emerges, not after a single failure.
- Each proposed change is small and targeted, and it still has to pass verification.

### Versioning

Versioning uses **Git, with one branch per change**. Promoting a change merges its branch. Rolling a change back discards it.

### Verification: shadow A/B on new work

Each proposed change runs **side by side with the current version on new work**. Who decides the winner depends on where the change is:

| Change to | Winner decided by |
|---|---|
| **Creator** | A **frozen copy of the current Reviewer** compares the old and new videos. **Humans can override** its decision. |
| **Reviewer** | **Agreement with human verdicts.** The version whose decisions match human feedback more often wins, counting both approved videos and the rejected-videos tab. A Reviewer never grades itself. |

The winner becomes the new standard, and the loser is rolled back.

## Demo

The demo shows two things:

- **Before and after:** the Creator and Reviewer working in their initial versions, then in later versions, so the improvement is visible.
- **Verification:** the versioned changes being verified before they become the new standard.

## Hackathon constraints

- The repo must be public.
- Submissions are due at 5:00 PM PT, with a one-minute demo video of what we built during the hackathon.
- Judges see a live demo of about 3 minutes, followed by 1–2 minutes of Q&A.
- Judging criteria: Technical Demo 35%, Implementation Difficulty 30%, Impact Potential 20%, Creativity 15%. The final round weights all four equally.
- The demo must show only what we built during the event.
