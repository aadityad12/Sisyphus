import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, MessageSquare, Pause, Play, ThumbsDown, ThumbsUp, X } from "lucide-react";
import "./ClipCard.css";
import { api, type Video } from "./api";
import { Transcript } from "./Transcript";
import { useModalKeys } from "./ui";
import { LineageStrip, LineageWindow } from "./Lineage";
import { agreement, MANUAL_REASON, PlanDetails, reasonText, shortVersion } from "./VideoCard";

/*
 * A finished clip in the Feed or Rejected list: its verdict, title, which agent versions made and judged it, a
 * short review and one action. Everything else (the vote, comments at a moment of the video, the full review,
 * the edit plan) is in the feedback window, so the list stays readable. Cara's design, 2026-11-07, in the
 * "Website" page of the Figma file.
 */

/** "0:07". */
export function clock(s: number) {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * A comment about a moment is stored as "At 0:07: text". The engine keeps comments as plain text, and the
 * agents that read them see the moment in the words, so no schema change is needed.
 */
const AT = /^At (\d+):([0-5]\d):\s*/;
export function parseComment(text: string): { at: number | null; text: string } {
  const m = AT.exec(text);
  return m ? { at: Number(m[1]) * 60 + Number(m[2]), text: text.slice(m[0].length) } : { at: null, text };
}

function Status({ approved }: { approved: boolean }) {
  return (
    <span className={`clip-status ${approved ? "ok" : "no"}`}>
      {approved ? <Check size={16} strokeWidth={2.4} aria-hidden /> : <X size={16} strokeWidth={2.4} aria-hidden />}
      {approved ? "Approved" : "Rejected"}
    </span>
  );
}

function Versions({ video }: { video: Video }) {
  if (!video.creator_version && !video.reviewer_version) return null;
  return (
    <p className="clip-versions">
      {video.creator_version && (
        <span>
          Creator <code>{shortVersion(video.creator_version)}</code>
        </span>
      )}
      {video.creator_version && video.reviewer_version && <span aria-hidden> · </span>}
      {video.reviewer_version && (
        <span>
          Reviewer <code>{shortVersion(video.reviewer_version)}</code>
        </span>
      )}
    </p>
  );
}

function useVideoUrl(video: Video) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    // "#t=0.1" makes the player show the first frame instead of black before anyone presses play.
    if (video.plan) api.videoUrl(video.id).then((u) => setSrc(`${u}#t=0.1`));
  }, [video.id, video.plan]);
  return src;
}

function review(video: Video) {
  if (video.review_reason === MANUAL_REASON) return "The Reviewer failed on this clip, so a person gave the verdict.";
  return video.review_reason ? reasonText(video.review_reason) : "No reason given.";
}

export function ClipCard({
  video,
  chain = [video],
  onChange,
}: {
  video: Video;
  // Every attempt in this clip's revision chain, first try first (#45); just the clip when it passed first time.
  chain?: Video[];
  onChange: () => void;
}) {
  const src = useVideoUrl(video);
  const player = useRef<HTMLVideoElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [started, setStarted] = useState(false);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(false);
  const historyOpener = useRef<HTMLDivElement>(null);
  // The comment being written lives here, not in the window, so closing the window (Escape, a click outside)
  // doesn't throw it away.
  const [draft, setDraft] = useState("");
  const [timed, setTimed] = useState(true);
  const title = video.plan?.title || video.brief;
  const text = review(video);

  function play() {
    setStarted(true);
    player.current?.play();
  }

  return (
    <article className={`clip-card v-${video.status}`}>
      <div className="clip-frame">
        {src ? (
          <video ref={player} src={src} controls={started} preload="metadata" playsInline aria-label={title} />
        ) : (
          <div className="clip-frame-empty" />
        )}
        {src && !started && (
          <button className="clip-play" onClick={play} aria-label={`Play ${title}`}>
            <Play size={20} fill="currentColor" />
          </button>
        )}
      </div>

      <div className="clip-body">
        <Status approved={video.status === "approved"} />
        <h3 className="clip-title" title={title}>
          {title}
        </h3>
        <Versions video={video} />
        {chain.length > 0 && (
          <div ref={historyOpener} className="clip-lineage">
            <LineageStrip
              video={video}
              chain={chain}
              onOpen={() => {
                player.current?.pause();
                setHistory(true);
              }}
            />
          </div>
        )}

        <div className="clip-review">
          <span className="clip-label">Review</span>
          <p className={more ? "" : "clamp"}>{text}</p>
          {text.length > 140 && (
            <button className="link clip-more" onClick={() => setMore(!more)} aria-expanded={more}>
              {more ? "Show less" : "Read more"}
            </button>
          )}
        </div>

        <span className="grow" />
        <button
          ref={opener}
          className="primary clip-feedback"
          onClick={() => {
            player.current?.pause();
            setOpen(true);
          }}
        >
          <MessageSquare size={18} /> Give feedback
          {video.comments.length > 0 && <span className="clip-count">{video.comments.length}</span>}
        </button>
      </div>

      {open && (
        <FeedbackWindow
          video={video}
          src={src}
          onChange={onChange}
          draft={draft}
          setDraft={setDraft}
          timed={timed}
          setTimed={setTimed}
          close={() => {
            setOpen(false);
            opener.current?.focus();
          }}
        />
      )}
      {history && (
        <LineageWindow
          chain={chain}
          start={Math.max(0, chain.findIndex((v) => v.id === video.id))}
          close={() => {
            setHistory(false);
            // The strip can be gone by now (the chain changed while the window was open): fall back to the card.
            (historyOpener.current?.querySelector("button") ?? opener.current)?.focus();
          }}
        />
      )}
    </article>
  );
}

/** The window "Give feedback" opens: the clip large, your vote, the full review, and comments pinned to moments. */
export function FeedbackWindow({
  video,
  src,
  onChange,
  draft,
  setDraft,
  timed,
  setTimed,
  close,
}: {
  video: Video;
  src: string | null;
  onChange: () => void;
  draft: string;
  setDraft: (d: string | ((d: string) => string)) => void;
  timed: boolean;
  setTimed: (t: boolean) => void;
  close: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fullReview, setFullReview] = useState(false);
  const [details, setDetails] = useState(false);
  // One request at a time: a double-click or a held Enter must not send it twice.
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // The vote as last clicked, ahead of the poll that confirms it: a quick second click must toggle from what was
  // just sent, not from the stale prop.
  const [liked, setLiked] = useState(video.human_liked);
  useEffect(() => setLiked(video.human_liked), [video.human_liked]);

  const approved = video.status === "approved";
  const manual = video.review_reason === MANUAL_REASON;
  const title = video.plan?.title || video.brief;
  const text = review(video);
  const agree = agreement(video);
  const comments = video.comments.map((c) => ({ id: c.id, ...parseComment(c.text) }));
  const pins = comments.filter((c) => c.at !== null) as { id: number; at: number; text: string }[];

  useEffect(() => {
    closeBtn.current?.focus();
  }, []);

  useModalKeys(box, close);

  function toggle() {
    const v = player.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  }

  function seek(t: number) {
    const v = player.current;
    if (!v) return;
    v.currentTime = t;
    setTime(t);
  }

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

  async function vote(choice: boolean) {
    const next = liked === choice ? null : choice;
    const before = liked;
    setLiked(next);
    if (!(await feedback({ liked: next }))) setLiked(before);
  }

  async function post() {
    const body = draft.trim();
    if (!body) return;
    const comment = timed ? `At ${clock(time)}: ${body}` : body;
    // The box stays editable while the request runs; keep anything typed since instead of erasing it.
    if (await feedback({ comment })) setDraft((d) => (d.trim() === body ? "" : d));
  }

  // Rendered into <body>: the card's entry animation leaves a transform on it, which would trap a fixed overlay
  // inside the card.
  return createPortal(
    <div className="scrim fb-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={box}
        className="fb-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`fb-title-${video.id}`}
        tabIndex={-1}
        data-own-keys
      >
        <header className="fb-head">
          <div className="fb-head-text">
            <span className="clip-label">Give feedback</span>
            <h2 id={`fb-title-${video.id}`}>{title}</h2>
            <Versions video={video} />
          </div>
          <button ref={closeBtn} className="fb-close" onClick={close} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <div className="fb-body">
          <section className="fb-player" aria-label="Clip">
            <div className="fb-frame">
              {src ? (
                <video
                  ref={player}
                  src={src}
                  preload="metadata"
                  playsInline
                  onClick={toggle}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setLength(e.currentTarget.duration || 0)}
                />
              ) : (
                <div className="clip-frame-empty" />
              )}
            </div>
            <div className="fb-controls">
              <button className="fb-playpause" onClick={toggle} disabled={!src} aria-label={playing ? "Pause" : "Play"}>
                {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              </button>
              <span className="fb-time">
                {clock(time)} / {clock(length)}
              </span>
            </div>
            <div className="fb-timeline">
              <input
                type="range"
                min={0}
                max={length || 1}
                step={0.1}
                value={time}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="Position in the clip"
                aria-valuetext={clock(time)}
              />
              {length > 0 &&
                pins.map((p) => (
                  <span
                    key={p.id}
                    className="fb-pin"
                    style={{ left: `${Math.min(100, (100 * p.at) / length)}%` }}
                    title={`${clock(p.at)}: ${p.text}`}
                    aria-hidden
                  />
                ))}
            </div>
            <p className="fb-hint">Pause on a moment, then write what should change there.</p>
          </section>

          <div className="fb-side">
            <section className="fb-section" aria-labelledby={`fb-vote-${video.id}`}>
              <h3 id={`fb-vote-${video.id}`}>Is this a good clip?</h3>
              <div className="fb-votes" role="group" aria-labelledby={`fb-vote-${video.id}`}>
                <button
                  className={liked === true ? "fb-vote on up" : "fb-vote"}
                  aria-pressed={liked === true}
                  disabled={pending}
                  onClick={() => vote(true)}
                >
                  <ThumbsUp size={18} /> Good clip
                </button>
                <button
                  className={liked === false ? "fb-vote on down" : "fb-vote"}
                  aria-pressed={liked === false}
                  disabled={pending}
                  onClick={() => vote(false)}
                >
                  <ThumbsDown size={18} /> Not good
                </button>
              </div>
              {agree && <p className={`fb-agree ${agree.cls}`}>{agree.text}</p>}
            </section>

            <section className="fb-section">
              <div className="fb-review-head">
                <h3>{manual ? "The verdict" : "Reviewer's review"}</h3>
                <Status approved={approved} />
              </div>
              <p className={fullReview ? "fb-review" : "fb-review clamp"}>{text}</p>
              {text.length > 220 && (
                <button className="link" onClick={() => setFullReview(!fullReview)} aria-expanded={fullReview}>
                  {fullReview ? "Show less" : "Show full review"}
                </button>
              )}
              {(video.attempt ?? 1) > 1 && (
                <p className="fb-note">
                  Attempt {video.attempt}, revising #{video.revision_of} with the Reviewer's reasons.
                </p>
              )}
              {!approved && video.revised_by != null && (
                <p className="fb-note">Back with the Creator: the new attempt is #{video.revised_by}.</p>
              )}
              {video.failed_agents.length > 0 && (
                <p className="fb-note">
                  Counted as a failure of the {video.failed_agents.map((a) => a[0].toUpperCase() + a.slice(1)).join(" and ")}.
                </p>
              )}
            </section>

            <section className="fb-section" aria-labelledby={`fb-comments-${video.id}`}>
              <h3 id={`fb-comments-${video.id}`}>Comments on moments</h3>
              {comments.length === 0 ? (
                <p className="fb-note">No comments yet.</p>
              ) : (
                <ul className="fb-comments">
                  {comments.map((c) => (
                    <li key={c.id} className={c.at !== null && Math.floor(time) === c.at ? "now" : ""}>
                      {c.at !== null ? (
                        <button className="fb-at" onClick={() => seek(c.at!)} aria-label={`Go to ${clock(c.at)}`}>
                          {clock(c.at)}
                        </button>
                      ) : (
                        <span className="fb-at general">General</span>
                      )}
                      <p>{c.text}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="fb-compose">
                {timed ? (
                  <button
                    className="fb-at-chip"
                    onClick={() => setTimed(false)}
                    title="Make it a comment on the whole clip"
                  >
                    At {clock(time)} <X size={14} aria-label="Remove the time" />
                  </button>
                ) : (
                  <button className="fb-at-chip off" onClick={() => setTimed(true)}>
                    Whole clip · add the time
                  </button>
                )}
                <textarea
                  value={draft}
                  rows={3}
                  placeholder={timed ? "What should change at this moment?" : "What should the Creator do differently?"}
                  aria-label="Your comment"
                  onFocus={() => player.current?.pause()}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Not while an input method is composing a word (Vietnamese Telex, for one).
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      post();
                    }
                  }}
                />
                <button className="primary fb-post" onClick={post} disabled={pending || !draft.trim()}>
                  Post
                </button>
              </div>
              {failed && <p className="fb-failed">{failed}</p>}
            </section>

            {video.plan && (
              <details className="fb-section fb-details" onToggle={(e) => setDetails(e.currentTarget.open)}>
                <summary>
                  <ChevronRight size={18} className="fb-chev" aria-hidden />
                  Edit plan and transcript
                </summary>
                {details && (
                  <div className="fb-details-body">
                    <p className="fb-note">“{video.brief}” · {video.footage}</p>
                    <div className="vc-plan">
                      <PlanDetails plan={video.plan} />
                    </div>
                    <Transcript videoId={video.id} />
                  </div>
                )}
              </details>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
