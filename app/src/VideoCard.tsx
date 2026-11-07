import { useEffect, useState } from "react";
import "./VideoCard.css";
import { api, type Video } from "./api";

const STATUS_LABEL: Record<Video["status"], string> = {
  queued: "Queued",
  creating: "Creator editing…",
  reviewing: "Reviewer watching…",
  approved: "Approved",
  rejected: "Sent back",
  failed: "Error",
};

/** The loop every clip goes through, in order. A finished clip has passed all of them. */
const STEPS = ["Queued", "Editing", "Reviewing", "Verdict"] as const;
const STEP_OF: Record<Video["status"], number> = {
  queued: 0,
  creating: 1,
  reviewing: 2,
  approved: 3,
  rejected: 3,
  failed: 1, // only the Creator sets "failed"
};

/** About four lines of a card's reason quote; longer reasons are clamped until expanded. */
const LONG_REASON = 220;

function fmt(s: number) {
  return `${s.toFixed(1)}s`;
}

/** Commit hashes are long; eight characters is enough to tell versions apart on screen. */
export function shortVersion(v: string) {
  return v.slice(0, 8);
}

/** Where an in-flight clip is in the loop. */
export function Steps({ video }: { video: Video }) {
  const at = STEP_OF[video.status];
  // A Reviewer error leaves the clip in "reviewing" with an error set: the step is stuck, not running.
  const stuck = video.status === "failed" || (video.status === "reviewing" && !!video.error);
  return (
    <ol className="vc-steps">
      {STEPS.map((label, i) => {
        const state = i < at ? "done" : i === at ? (stuck ? "stuck" : "active") : "todo";
        return (
          <li key={label} className={`${state} step-${i}`}>
            <span className="dot" />
            {label}
          </li>
        );
      })}
    </ol>
  );
}

/** The first thing to read on a card: what the Reviewer decided and why, or where the clip is. */
function Verdict({ video }: { video: Video }) {
  const [full, setFull] = useState(false);
  if (video.status === "approved" || video.status === "rejected") {
    const ok = video.status === "approved";
    return (
      <div className={`vc-verdict ${ok ? "ok" : "no"}`}>
        <div className="vc-verdict-head">
          <span className="icon">{ok ? "✓" : "↩"}</span>
          {ok ? "Reviewer approved" : "Reviewer sent it back"}
          {video.reviewer_version && <code className="vc-ver">{shortVersion(video.reviewer_version)}</code>}
        </div>
        {video.review_reason ? (
          <>
            {/* Reasons run to a paragraph; the first few lines carry the verdict, the rest is on demand. */}
            <blockquote className={full ? "" : "clamp"}>{video.review_reason}</blockquote>
            {video.review_reason.length > LONG_REASON && (
              <button className="link vc-moreless" onClick={() => setFull(!full)}>
                {full ? "Less" : "Read the full review"}
              </button>
            )}
          </>
        ) : (
          <p className="dim small">No reason given.</p>
        )}
      </div>
    );
  }
  if (video.status === "failed") {
    return (
      <div className="vc-verdict no">
        <div className="vc-verdict-head">
          <span className="icon">!</span>
          The Creator couldn't finish this clip
        </div>
        {video.error && <pre className="vc-error">{video.error.split("\n")[0]}</pre>}
      </div>
    );
  }
  return (
    <div className="vc-verdict pending">
      <Steps video={video} />
      {video.error && <pre className="vc-error">{video.error.split("\n")[0]}</pre>}
    </div>
  );
}

function elapsed(s: number) {
  const t = Math.max(0, Math.round(s));
  return t < 60 ? `${t}s` : `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, "0")}s`;
}

/** A clip with no plan yet has nothing to watch, so it takes one row, not a 9:16 frame. */
function InFlightRow({ video }: { video: Video }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (video.status === "failed") return;
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [video.status]);
  return (
    <article className={`vrow v-${video.status}`}>
      <div className="vrow-what">
        <p className="vrow-brief" title={video.brief}>
          {video.brief}
        </p>
        <p className="vrow-facts">
          {video.footage}
          {video.creator_version && (
            <span className="vc-maker">
              {" · "}Creator <code>{shortVersion(video.creator_version)}</code>
            </span>
          )}
        </p>
        {video.error && <pre className="vc-error">{video.error.split("\n")[0]}</pre>}
      </div>
      <Steps video={video} />
      {video.status !== "failed" && <span className="vrow-time">{elapsed(now - video.created_at)}</span>}
    </article>
  );
}

/** One line on how the human's vote sits against the Reviewer's verdict: disagreements are what the Auditor learns from. */
function agreement(video: Video): { text: string; cls: string } | null {
  if (video.human_liked === null || video.review_approved === null) return null;
  if (video.human_liked === video.review_approved) return { text: "You agree with the Reviewer.", cls: "agree" };
  return {
    text: video.human_liked
      ? "You liked a clip the Reviewer sent back. The Auditor learns from this."
      : "You disliked a clip the Reviewer approved. The Auditor learns from this.",
    cls: "disagree",
  };
}

export function VideoCard({
  video,
  onChange,
  mode,
}: {
  video: Video;
  onChange: () => void;
  mode: "feed" | "rejected" | "studio";
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (video.plan) api.videoUrl(video.id).then(setSrc);
  }, [video.id, video.plan]);

  async function vote(liked: boolean) {
    await api.feedback(video.id, { liked: video.human_liked === liked ? null : liked });
    onChange();
  }

  async function send() {
    if (!comment.trim()) return;
    await api.feedback(video.id, { comment: comment.trim() });
    setComment("");
    onChange();
  }

  const duration = video.plan?.segments.reduce((t, s) => t + (s.end - s.start), 0) ?? 0;
  const busy = video.status === "queued" || video.status === "creating";
  const agree = agreement(video);

  if (!video.plan) return <InFlightRow video={video} />;

  return (
    <article className={`vcard v-${video.status}`}>
      <div className="vc-frame">
        {src ? (
          <video src={src} controls preload="metadata" playsInline />
        ) : (
          <div className={`vc-empty ${busy ? "busy" : ""}`}>{STATUS_LABEL[video.status]}</div>
        )}
      </div>

      <div className="vc-body">
        <Verdict video={video} />

        <div className="vc-what">
          <h3 title={video.plan?.title ?? video.brief}>{video.plan?.title ?? video.brief}</h3>
          {video.plan?.title && <p className="vc-brief" title={video.brief}>Brief: “{video.brief}”</p>}
          <p className="vc-facts">
            {video.creator_version && (
              <span className="vc-maker">
                Made by Creator <code>{shortVersion(video.creator_version)}</code>
              </span>
            )}
            {video.arm && <span className={`chip arm-${video.arm}`}>A/B {video.arm}</span>}
            <span className="dim">
              {video.footage}
              {video.plan && ` · ${fmt(duration)} · ${video.plan.segments.length} cuts`}
            </span>
          </p>
        </div>

        {video.failed_agents.length > 0 && (
          <p className="vc-blame">
            Counted as a failure of the{" "}
            {video.failed_agents.map((a, i) => (
              <span key={a}>
                {i > 0 && " and "}
                <span className="chip fail">{a}</span>
              </span>
            ))}
          </p>
        )}

        {video.plan && (
          <div className="vc-you">
            <span className="vc-label">Your call</span>
            <div className="vc-votes">
              <button
                className={video.human_liked === true ? "vote on up" : "vote"}
                aria-pressed={video.human_liked === true}
                onClick={() => vote(true)}
              >
                ▲ {mode === "rejected" ? "Actually good" : "Good clip"}
              </button>
              <button
                className={video.human_liked === false ? "vote on down" : "vote"}
                aria-pressed={video.human_liked === false}
                onClick={() => vote(false)}
              >
                ▼ {mode === "feed" ? "Not good" : "Bad clip"}
              </button>
            </div>
            {agree && <p className={`vc-agree ${agree.cls}`}>{agree.text}</p>}
          </div>
        )}

        {video.plan && (
          <div className="vc-more">
            <details>
              <summary>
                Edit plan <span className="dim">· {video.plan.segments.length} cuts</span>
              </summary>
              <div className="vc-plan">
                <p>
                  <strong>Hook:</strong> {video.plan.hook || <em>none</em>}
                </p>
                <ol>
                  {video.plan.segments.map((s, i) => (
                    <li key={i}>
                      {fmt(s.start)} → {fmt(s.end)} <span className="dim">({fmt(s.end - s.start)})</span>
                    </li>
                  ))}
                </ol>
                <p className="dim small">
                  crop {video.plan.crop_x.toFixed(2)} · captions {video.plan.caption_style} ×{video.plan.caption_words}
                </p>
                {video.plan.rationale && <p className="small">{video.plan.rationale}</p>}
              </div>
            </details>

            {/* More disclosures (the Transcript from #8) go here, as further <details>. */}

            <details open={video.comments.length > 0 || undefined}>
              <summary>
                Comments <span className="dim">· {video.comments.length}</span>
              </summary>
              <div className="vc-comments">
                {video.comments.map((c) => (
                  <p key={c.id} className="vc-comment">
                    {c.text}
                  </p>
                ))}
                <div className="vc-compose">
                  <input
                    value={comment}
                    placeholder="Tell the Creator what to do differently…"
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                  />
                  <button onClick={send} disabled={!comment.trim()}>
                    Send
                  </button>
                </div>
              </div>
            </details>
          </div>
        )}
      </div>
    </article>
  );
}
