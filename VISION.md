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
| The Reviewer sends back a video that humans liked. | The Reviewer's. |
| The Reviewer pushes forward a video that humans dislike. | Both agents'. |

### Improving

The Auditor turns identified failures into changes. Every change is **versioned** and **verified** before it becomes the new standard.

There will be many failures, so the Auditor **must not overreact** to any single one.

## Demo

_TBD_

## Hackathon constraints

- The repo must be public.
- Submissions are due at 5:00 PM PT, with a one-minute demo video of what we built during the hackathon.
- Judges see a live demo of about 3 minutes, followed by 1–2 minutes of Q&A.
- Judging criteria: Technical Demo 35%, Implementation Difficulty 30%, Impact Potential 20%, Creativity 15%. The final round weights all four equally.
- The demo must show only what we built during the event.
