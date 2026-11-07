import { useEffect, useState } from "react";
import { api, type Video } from "./api";
import { Transcript } from "./Transcript";

const STATUS_LABEL: Record<Video["status"], string> = {
  queued: "Queued",
  creating: "Creator editing…",
  reviewing: "Awaiting Reviewer",
  approved: "Approved",
  rejected: "Sent back",
  failed: "Error",
};

function fmt(s: number) {
  return `${s.toFixed(1)}s`;
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
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState(false);

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

  return (
    <article className={`card status-${video.status}`}>
      <div className="player">
        {src ? (
          <video src={src} controls preload="metadata" playsInline />
        ) : (
          <div className={`placeholder ${busy ? "busy" : ""}`}>{STATUS_LABEL[video.status]}</div>
        )}
      </div>

      <div className="meta">
        <div className="row">
          <span className={`badge ${video.status}`}>{STATUS_LABEL[video.status]}</span>
          {video.creator_version && <code className="chip">creator {video.creator_version.slice(0, 12)}</code>}
          {video.arm && <span className={`chip arm-${video.arm}`}>{video.arm}</span>}
        </div>
        <h3>{video.plan?.title ?? video.brief}</h3>
        <p className="brief">“{video.brief}”</p>
        <p className="dim small">
          {video.footage}
          {video.plan && ` · ${fmt(duration)} · ${video.plan.segments.length} cuts`}
        </p>

        {video.review_reason && (
          <div className={`reason ${video.review_approved ? "ok" : "no"}`}>
            <strong>Reviewer:</strong> {video.review_reason}
          </div>
        )}
        {video.error && <pre className="error">{video.error.split("\n")[0]}</pre>}

        {video.failed_agents.length > 0 && (
          <div className="row">
            <span className="dim small">Failure:</span>
            {video.failed_agents.map((a) => (
              <span key={a} className="chip fail">
                {a}
              </span>
            ))}
          </div>
        )}

        {video.plan && (
          <div className="row actions">
            <button className={video.human_liked === true ? "vote on up" : "vote"} onClick={() => vote(true)}>
              ▲ {mode === "rejected" ? "Actually good" : "Like"}
            </button>
            <button className={video.human_liked === false ? "vote on down" : "vote"} onClick={() => vote(false)}>
              ▼ Dislike
            </button>
            <button className="link" onClick={() => setOpen(!open)}>
              {open ? "Hide plan" : "Edit plan"}
            </button>
            <button className="link" onClick={() => setTranscript(!transcript)}>
              {transcript ? "Hide transcript" : "Transcript"}
            </button>
          </div>
        )}

        {transcript && video.plan && <Transcript videoId={video.id} />}

        {open && video.plan && (
          <div className="plan">
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
        )}

        {video.plan && (
          <div className="comments">
            {video.comments.map((c) => (
              <p key={c.id} className="comment">
                {c.text}
              </p>
            ))}
            <div className="row">
              <input
                value={comment}
                placeholder="Leave feedback…"
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
              <button onClick={send}>Send</button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
