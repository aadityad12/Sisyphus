import { useEffect, useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  FileText,
  ListVideo,
  Loader,
  MessageSquare,
  SendHorizontal,
  ThumbsDown,
  ThumbsUp,
  Undo2,
} from "lucide-react";
import "./VideoCard.css";
import { api, type Video } from "./api";
import { StyleTags } from "./Styles";
import { Transcript } from "./Transcript";

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

function cuts(n: number) {
  return `${n} ${n === 1 ? "cut" : "cuts"}`;
}

/** The heading already says approved or sent back, so drop the Reviewer's own "Approved:" / "Send back:" lead-in. */
const VERDICT_LEAD = /^\s*(approve[sd]?|reject(?:ed|s)?|sen[dt]s?(?: it)? back)(?: as[- ]is)?\s*[:.—–-]\s*/i;
function reasonText(reason: string) {
  const rest = reason.replace(VERDICT_LEAD, "");
  return rest ? rest[0].toUpperCase() + rest.slice(1) : reason;
}

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
            <span className="dot">
              {state === "done" ? <Check size={9} strokeWidth={3} /> : state === "stuck" ? "!" : null}
            </span>
            <span className="step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The first thing to read on a card: what the Reviewer decided and why, or where the clip is. */
/** The reason a hand-given verdict is recorded with, so the card can say a person decided, not the Reviewer. */
const MANUAL_REASON = "Manual verdict after a Reviewer error";

/**
 * A Reviewer error leaves a clip in "reviewing" with nothing to retry it while the engine runs (a
 * restart finishes interrupted reviews), so a human gives the verdict the Reviewer couldn't.
 */
function StuckReview({ video, onChange }: { video: Video; onChange: () => void }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // POST /review overwrites any verdict, so after one is saved the buttons stay locked until the refreshed clip
  // (no longer stuck) replaces this component. Unlocking on success would let a click on the stale card undo it.
  // A ref, so a second click in the same tick is refused too.
  const [saved, setSaved] = useState<boolean | null>(null);
  const busy = useRef(false);

  async function decide(approved: boolean) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailed(null);
    try {
      await api.review(video.id, approved, MANUAL_REASON);
      setSaved(approved);
      onChange();
    } catch (e) {
      busy.current = false; // only a failed save may be retried
      setFailed(`Couldn't save the verdict: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="vc-stuck">
      <p className="vc-stuck-head">
        <CircleAlert size={14} /> The Reviewer failed on this clip. Watch it and give the verdict yourself.
      </p>
      <div className="vc-votes">
        <button className="vote sm" disabled={pending || saved !== null} onClick={() => decide(true)}>
          <Check size={13} /> Approve
        </button>
        <button className="vote sm" disabled={pending || saved !== null} onClick={() => decide(false)}>
          <Undo2 size={13} /> Send back
        </button>
      </div>
      {saved !== null && <p className="dim small">Saved: {saved ? "approved" : "sent back"}. Updating…</p>}
      {failed && <p className="vc-failed">{failed}</p>}
    </div>
  );
}

function Verdict({ video, onChange }: { video: Video; onChange: () => void }) {
  const [full, setFull] = useState(false);
  if (video.status === "approved" || video.status === "rejected") {
    const ok = video.status === "approved";
    const manual = video.review_reason === MANUAL_REASON;
    const reason = video.review_reason && reasonText(video.review_reason);
    return (
      <div className={`vc-verdict ${ok ? "ok" : "no"}`}>
        <div className="vc-verdict-head">
          <span className="icon">{ok ? <CircleCheck size={15} /> : <Undo2 size={15} />}</span>
          {manual
            ? ok
              ? "Approved by hand"
              : "Sent back by hand"
            : ok
              ? "Reviewer approved"
              : "Reviewer sent it back"}
          {video.reviewer_version && !manual && <code className="vc-ver">{shortVersion(video.reviewer_version)}</code>}
        </div>
        {(video.attempt ?? 1) > 1 && (
          <p className="dim small">
            Attempt {video.attempt}, revising #{video.revision_of} with the Reviewer's reasons.
          </p>
        )}
        {!ok && video.revised_by != null && (
          <p className="dim small">Back with the Creator: the new attempt is #{video.revised_by}.</p>
        )}
        {manual ? (
          <p className="dim small">The Reviewer failed on this clip, so a person gave the verdict.</p>
        ) : reason ? (
          <>
            {/* Reasons run to a paragraph; the first few lines carry the verdict, the rest is on demand. */}
            <blockquote className={full ? "" : "clamp"}>{reason}</blockquote>
            {reason.length > LONG_REASON && (
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
          <span className="icon">
            <CircleAlert size={15} />
          </span>
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
      {video.status === "reviewing" && video.error && video.plan && <StuckReview video={video} onChange={onChange} />}
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
  const failed = video.status === "failed";
  return (
    <article className={`vrow v-${video.status}`}>
      <span className={`vrow-icon ${failed ? "err" : ""}`} aria-hidden>
        {failed ? <CircleAlert size={15} /> : <Loader size={15} className="spin-slow" />}
      </span>
      <div className="vrow-what">
        <p className="vrow-brief" title={video.brief}>
          {video.brief}
        </p>
        <p className="vrow-facts">
          <span>{video.footage}</span>
          {video.creator_version && (
            <span className="vc-maker">
              <span className="agent-dot creator" />
              Creator <code>{shortVersion(video.creator_version)}</code>
            </span>
          )}
          {/* No plan yet, so no styles used yet: say what was asked for. */}
          {video.styles_requested !== undefined && (
            <span>{video.styles_requested.length ? `in ${video.styles_requested.join(" + ")}` : "style: Auto"}</span>
          )}
        </p>
        {video.error && <pre className="vc-error">{video.error.split("\n")[0]}</pre>}
      </div>
      <Steps video={video} />
      {!failed && (
        <span className="vrow-time">
          <Clock size={12} />
          {elapsed(now - video.created_at)}
        </span>
      )}
    </article>
  );
}

/** "4m ago", for when a clip last changed. */
function ago(t: number) {
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** One line on how the human's vote sits against the Reviewer's verdict: disagreements are what the Auditor learns from. */
function agreement(video: Video): { text: string; cls: string } | null {
  if (video.human_liked === null || video.review_approved === null) return null;
  if (video.review_reason === MANUAL_REASON) return null; // a person gave that verdict, not the Reviewer
  if (video.human_liked === video.review_approved) return { text: "You agree with the Reviewer.", cls: "agree" };
  return {
    text: video.human_liked
      ? "You liked a clip the Reviewer sent back. The Auditor learns from this."
      : "You disliked a clip the Reviewer approved. The Auditor learns from this.",
    cls: "disagree",
  };
}

type Panel = "plan" | "transcript" | "comments";

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
  // One feedback request at a time: a double-click or a held Enter must not send it twice.
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // Comments start open when there are some. The transcript mounts only while its panel is open, so a feed of
  // cards doesn't fetch every clip's transcript.
  const [panel, setPanel] = useState<Panel | null>(video.comments.length > 0 ? "comments" : null);
  const toggle = (p: Panel) => setPanel((open) => (open === p ? null : p));

  useEffect(() => {
    // "#t=0.1" makes the player show the first frame instead of black before anyone presses play.
    if (video.plan) api.videoUrl(video.id).then((u) => setSrc(`${u}#t=0.1`));
  }, [video.id, video.plan]);

  async function feedback(body: { liked?: boolean | null; comment?: string }): Promise<boolean> {
    if (pending) return false;
    setPending(true);
    setFailed(null);
    try {
      await api.feedback(video.id, body);
      onChange();
      return true;
    } catch (e) {
      setFailed(`Couldn't save that: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setPending(false);
    }
  }

  function vote(liked: boolean) {
    feedback({ liked: video.human_liked === liked ? null : liked });
  }

  async function send() {
    const text = comment.trim();
    if (!text) return;
    // The input stays editable while the request runs; keep anything typed since instead of erasing it.
    if (await feedback({ comment: text })) setComment((draft) => (draft.trim() === text ? "" : draft));
  }

  // Source seconds kept, played at the plan's speed.
  const duration = (video.plan?.segments.reduce((t, s) => t + (s.end - s.start), 0) ?? 0) / (video.plan?.speed ?? 1);
  const busy = video.status === "queued" || video.status === "creating";
  const agree = agreement(video);

  if (!video.plan) return <InFlightRow video={video} />;
  const plan = video.plan;

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
        <Verdict video={video} onChange={onChange} />

        <div className="vc-what">
          <h3 title={plan.title ?? video.brief}>{plan.title ?? video.brief}</h3>
          {plan.title && (
            <p className="vc-brief" title={video.brief}>
              “{video.brief}”
            </p>
          )}
          <div className="vc-facts">
            {video.creator_version && (
              <span className="vc-maker" title="The Creator version that made this clip">
                <span className="agent-dot creator" />
                Creator <code>{shortVersion(video.creator_version)}</code>
              </span>
            )}
            {video.arm && <span className={`chip arm-${video.arm}`}>A/B {video.arm}</span>}
            <StyleTags video={video} />
          </div>
          <p className="vc-source">
            <span className="file" title={video.footage}>
              {video.footage}
            </span>
            <span className="sep">·</span>
            <code>{fmt(duration)}</code>
            <span className="sep">·</span>
            <span>{cuts(plan.segments.length)}</span>
            <span className="sep">·</span>
            <span title={new Date(video.updated_at * 1000).toLocaleString()}>{ago(video.updated_at)}</span>
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

        <div className="vc-you">
          <div className="vc-you-row">
            <span className="vc-label">Your call</span>
            <div className="vc-votes" role="group" aria-label="Your vote">
              <button
                className={video.human_liked === true ? "vote on up" : "vote"}
                aria-pressed={video.human_liked === true}
                disabled={pending}
                onClick={() => vote(true)}
              >
                <ThumbsUp size={14} /> {mode === "rejected" ? "Actually good" : "Good clip"}
              </button>
              <button
                className={video.human_liked === false ? "vote on down" : "vote"}
                aria-pressed={video.human_liked === false}
                disabled={pending}
                onClick={() => vote(false)}
              >
                <ThumbsDown size={14} /> {mode === "feed" ? "Not good" : "Bad clip"}
              </button>
            </div>
          </div>
          {agree && <p className={`vc-agree ${agree.cls}`}>{agree.text}</p>}
          {failed && <p className="vc-failed">{failed}</p>}
        </div>

        <div className="vc-tabs" role="tablist" aria-label="Clip details">
          <button
            role="tab"
            aria-selected={panel === "plan"}
            className={panel === "plan" ? "on" : ""}
            onClick={() => toggle("plan")}
          >
            <ListVideo size={13} /> Edit plan <span className="n">{plan.segments.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={panel === "transcript"}
            className={panel === "transcript" ? "on" : ""}
            onClick={() => toggle("transcript")}
            title="What was kept and cut"
          >
            <FileText size={13} /> Transcript
          </button>
          <button
            role="tab"
            aria-selected={panel === "comments"}
            className={panel === "comments" ? "on" : ""}
            onClick={() => toggle("comments")}
          >
            <MessageSquare size={13} /> Comments <span className="n">{video.comments.length}</span>
          </button>
        </div>

        {panel === "plan" && (
          <div className="vc-panel vc-plan" role="tabpanel">
            <p className="vc-hook">
              <span className="k">Hook</span> {plan.hook || <em className="dim">none</em>}
            </p>
            <ol className="vc-segs">
              {plan.segments.map((s, i) => (
                <li key={i}>
                  <span className="i">{i + 1}</span>
                  <code>
                    {fmt(s.start)} → {fmt(s.end)}
                  </code>
                  <span className="dim">{fmt(s.end - s.start)}</span>
                  {s.punch && s.punch > 1 ? <span className="chip">punch {s.punch.toFixed(2)}×</span> : null}
                </li>
              ))}
            </ol>
            <div className="vc-knobs">
              <span className="chip">crop {plan.crop_x.toFixed(2)}</span>
              <span className="chip">
                captions {plan.caption_style} ×{plan.caption_words}
              </span>
              {plan.caption_size && (
                <span className="chip">
                  {`${plan.caption_size} ${plan.caption_color ?? ""} ${plan.caption_position ?? ""}`.trim()}
                  {plan.caption_caps ? " caps" : ""}
                </span>
              )}
              {plan.color_filter && plan.color_filter !== "none" && <span className="chip">{plan.color_filter}</span>}
              {plan.speed && plan.speed !== 1 && <span className="chip">{plan.speed}× speed</span>}
            </div>
            {plan.rationale && <p className="vc-rationale">{plan.rationale}</p>}
          </div>
        )}

        {panel === "transcript" && (
          <div className="vc-panel" role="tabpanel">
            <Transcript videoId={video.id} />
          </div>
        )}

        {panel === "comments" && (
          <div className="vc-panel vc-comments" role="tabpanel">
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
              <button className="icon" onClick={send} disabled={pending || !comment.trim()} title="Send">
                <SendHorizontal size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
