import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  History,
  Loader,
  MessageSquare,
  Play,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import "./Lineage.css";
import { api, type EditPlan, type Video } from "./api";
import { useModalKeys } from "./ui";
import { MANUAL_REASON, reasonText, shortVersion } from "./VideoCard";

/*
 * A clip's life cycle (#45). A clip the Reviewer sends back goes back to the Creator with the reasons, as a new
 * video whose `revision_of` is the one it revises, until one passes or the attempts run out (MAX_ATTEMPTS in
 * jobs.py). The Feed shows only the attempt that passed; this shows every attempt before it, what the Reviewer
 * said about each, and what the Creator changed in answer.
 */

/** Every attempt in `video`'s revision chain, first try first, from the clips the app already has. */
export function chainOf(video: Video, pool: Map<number, Video>): Video[] {
  const seen = new Set<number>([video.id]);
  const before: Video[] = [];
  let v: Video | undefined = video;
  while (v?.revision_of != null) {
    const parent = pool.get(v.revision_of);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    before.unshift(parent);
    v = parent;
  }
  const after: Video[] = [];
  v = video;
  while (v?.revised_by != null) {
    const child = pool.get(v.revised_by);
    if (!child || seen.has(child.id)) break;
    seen.add(child.id);
    after.push(child);
    v = child;
  }
  return [...before, video, ...after];
}

type Kind = "ok" | "no" | "fail" | "live";

/** A Reviewer error leaves a clip in "reviewing" with an error set until a person gives the verdict. */
const stuck = (v: Video) => v.status === "reviewing" && !!v.error;

function kindOf(v: Video): Kind {
  if (v.status === "approved") return "ok";
  if (v.status === "rejected") return "no";
  if (v.status === "failed" || stuck(v)) return "fail";
  return "live";
}

const VERDICT: Record<Video["status"], string> = {
  queued: "Queued",
  creating: "Creator editing…",
  reviewing: "Reviewer watching…",
  approved: "Approved",
  rejected: "Sent back",
  failed: "Didn't finish",
};
const verdictOf = (v: Video) => (stuck(v) ? "Needs your verdict" : VERDICT[v.status]);

function KindIcon({ kind, size = 14 }: { kind: Kind; size?: number }) {
  if (kind === "ok") return <Check size={size} strokeWidth={2.6} aria-hidden />;
  if (kind === "no") return <X size={size} strokeWidth={2.6} aria-hidden />;
  if (kind === "fail") return <CircleAlert size={size} strokeWidth={2.4} aria-hidden />;
  return <Loader size={size} strokeWidth={2.4} className="ln-spin" aria-hidden />;
}

/** "2m", "1h 5m": how long after the first try something happened. */
function span(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

function when(t: number) {
  return new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The words "attempts 1 and 2", "attempts 1, 2 and 3". */
function listOf(ns: number[]) {
  if (ns.length === 1) return `attempt ${ns[0]}`;
  return `attempts ${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
}

/** Where the chain ended up, in one line. */
function outcome(chain: Video[]): { text: string; kind: Kind } {
  const last = chain[chain.length - 1];
  const n = chain.length;
  // No timing here: `updated_at` moves with every vote and comment, so it isn't when the verdict came.
  if (last.status === "approved")
    return n === 1
      ? { text: "Approved on the first try.", kind: "ok" }
      : { text: `Approved on attempt ${n}, after ${n - 1} sent back.`, kind: "ok" };
  if (last.status === "rejected") {
    const times = n === 1 ? "once" : `all ${n} times`;
    // A like on any attempt stops the revisions (jobs.settled_ancestor), so it is why the chain ended.
    const liked = chain.findIndex((v) => v.human_liked === true);
    if (liked >= 0)
      return {
        text: `Sent back ${times}, but you called ${liked === n - 1 ? "the last one" : `attempt ${liked + 1}`} good.`,
        kind: "no",
      };
    return { text: `Sent back ${times}. No more attempts.`, kind: "no" };
  }
  if (last.status === "failed") return { text: `Attempt ${n} didn't finish.`, kind: "fail" };
  if (stuck(last)) return { text: `Attempt ${n} needs your verdict: the Reviewer failed on it.`, kind: "fail" };
  return { text: `Attempt ${n} is with the agents now.`, kind: "live" };
}

/**
 * Text cut to a few lines (the line count is in the CSS `.clamp` rule), with a button to show the rest. The
 * button appears only when the text really overflows, measured, since the width it wraps at varies.
 */
function Clamp({
  className,
  quote,
  more = "Show all of it",
  children,
}: {
  className: string;
  quote?: boolean;
  more?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children, open]);
  const text = (
    <span ref={ref} className={open ? className : `${className} clamp`}>
      {children}
    </span>
  );
  return (
    <>
      {quote ? <blockquote>{text}</blockquote> : text}
      {(over || open) && (
        <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Show less" : more}
        </button>
      )}
    </>
  );
}

/* ---------- What changed between two attempts ---------- */

type Change = { label: string; before: string; after: string; long?: boolean };

const kept = (p: EditPlan) => (p.rendered_segments ?? p.segments).reduce((t, s) => t + (s.end - s.start), 0);
const captions = (p: EditPlan) =>
  p.caption_style === "none"
    ? "none"
    : [p.caption_style, p.caption_size, p.caption_position, p.caption_color, p.caption_caps ? "caps" : ""]
        .filter(Boolean)
        .join(" ");

/** The differences a viewer would notice between two edit plans, in the order they'd notice them. */
export function planChanges(prev: EditPlan, next: EditPlan): Change[] {
  const out: Change[] = [];
  const add = (label: string, before: string, after: string, long = false) => {
    if (before !== after) out.push({ label, before, after, long });
  };
  add("Hook", prev.hook || "none", next.hook || "none", true);
  add("Length", `${kept(prev).toFixed(1)}s`, `${kept(next).toFixed(1)}s`);
  add("Cuts", String(prev.segments.length), String(next.segments.length));
  add("Layout", prev.layout ?? "crop", next.layout ?? "crop");
  if (Math.abs(prev.crop_x - next.crop_x) >= 0.02 && (next.layout ?? "crop") !== "fit")
    add("Framing", `x ${prev.crop_x.toFixed(2)}`, `x ${next.crop_x.toFixed(2)}`);
  add("Captions", captions(prev), captions(next));
  if (prev.caption_style !== "none" || next.caption_style !== "none")
    add("Words per caption", String(prev.caption_words), String(next.caption_words));
  add("Colour", prev.color_filter ?? "none", next.color_filter ?? "none");
  add("Speed", `${prev.speed ?? 1}×`, `${next.speed ?? 1}×`);
  add("Styles", (prev.styles ?? []).join(", ") || "auto", (next.styles ?? []).join(", ") || "auto");
  add("Title", prev.title, next.title, true);
  // Same moments but cut at different points: say so, rather than claiming nothing changed.
  if (
    out.every((c) => c.label !== "Length" && c.label !== "Cuts") &&
    (prev.rendered_segments ?? prev.segments).some((s, i) => {
      const t = (next.rendered_segments ?? next.segments)[i];
      return !t || Math.abs(s.start - t.start) > 0.25 || Math.abs(s.end - t.end) > 0.25;
    })
  )
    out.push({ label: "Cut points", before: "", after: "moved", long: false });
  return out;
}

/* ---------- The strip on a card ---------- */

/**
 * The attempts behind a card, as a row of marks; opens the clip's history. Every card has one, a first-try clip
 * too, so the way in is always in the same place (on 2026-11-07 the first cards in the Feed were all first tries,
 * and a strip shown only on revised clips went unnoticed).
 */
export function LineageStrip({ video, chain, onOpen }: { video: Video; chain: Video[]; onOpen: () => void }) {
  const at = chain.findIndex((v) => v.id === video.id);
  const sentBack = chain.flatMap((v, i) => (v.status === "rejected" ? [i + 1] : []));
  const label = [
    `Attempt ${at + 1} of ${chain.length}, ${verdictOf(video).toLowerCase()}.`,
    sentBack.length ? `The Reviewer sent back ${listOf(sentBack)}.` : "",
    "Show this clip's history.",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className="ln-strip" onClick={onOpen} aria-label={label} title="Every attempt at this clip">
      <span className="ln-marks" aria-hidden>
        {chain.map((v, i) => (
          <span key={v.id} className="ln-mark-wrap">
            {i > 0 && <span className={`ln-link k-${kindOf(chain[i - 1])}`} />}
            <span className={`ln-mark k-${kindOf(v)}${i === at ? " here" : ""}`}>
              <KindIcon kind={kindOf(v)} size={11} />
            </span>
          </span>
        ))}
      </span>
      <span className="ln-strip-text">{chain.length === 1 ? "First try" : `Attempt ${at + 1} of ${chain.length}`}</span>
      <span className="ln-strip-cta">
        <History size={14} aria-hidden /> History
        <ChevronRight size={14} aria-hidden />
      </span>
    </button>
  );
}

/* ---------- The history window ---------- */

function useSrc(video: Video | undefined) {
  const [src, setSrc] = useState<string | null>(null);
  // Keyed on whether there is a plan, not the plan object: every poll brings a new one, and reloading the source
  // on each would restart a playing video every two seconds. A Player is keyed by video id, so it starts empty.
  const id = video?.id;
  const hasPlan = !!video?.plan;
  useEffect(() => {
    if (hasPlan && id !== undefined) api.videoUrl(id).then((u) => setSrc(`${u}#t=0.1`));
  }, [id, hasPlan]);
  return src;
}

function review(v: Video) {
  if (v.review_reason === MANUAL_REASON) return "The Reviewer failed on this attempt, so a person gave the verdict.";
  return v.review_reason ? reasonText(v.review_reason) : null;
}

function Player({
  video,
  n,
  innerRef,
  compact,
}: {
  video: Video;
  n: number;
  innerRef?: React.Ref<HTMLVideoElement>;
  compact?: boolean;
}) {
  const src = useSrc(video);
  const kind = kindOf(video);
  return (
    <figure className={`ln-player${compact ? " compact" : ""}`}>
      <div className={`ln-frame k-${kind}`}>
        {src ? (
          <video key={video.id} ref={innerRef} src={src} controls preload="metadata" playsInline aria-label={`Attempt ${n}`} />
        ) : (
          <div className="ln-frame-empty">
            <KindIcon kind={kind} size={22} />
            <span>{kind === "live" ? verdictOf(video) : kind === "fail" ? "No video: it didn't finish" : "No video"}</span>
          </div>
        )}
      </div>
      <figcaption>
        <span className={`ln-pill k-${kind}`}>
          <KindIcon kind={kind} size={12} /> {verdictOf(video)}
        </span>
        <span>Attempt {n}</span>
      </figcaption>
    </figure>
  );
}

function Vote({ video }: { video: Video }) {
  if (video.human_liked === true)
    return (
      <span className="ln-vote up">
        <ThumbsUp size={14} aria-hidden /> You liked it
      </span>
    );
  if (video.human_liked === false)
    return (
      <span className="ln-vote down">
        <ThumbsDown size={14} aria-hidden /> You didn't like it
      </span>
    );
  return <span className="ln-vote none">No vote from you</span>;
}

function Detail({ chain, index }: { chain: Video[]; index: number }) {
  const video = chain[index];
  const prev = index > 0 ? chain[index - 1] : undefined;
  const [compare, setCompare] = useState(false);
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const text = review(video);
  const asked = prev && prev.review_reason !== MANUAL_REASON ? review(prev) : null;
  const changes = prev?.plan && video.plan ? planChanges(prev.plan, video.plan) : null;
  const canCompare = !!prev?.plan && !!video.plan;
  const comparing = compare && canCompare;
  const n = index + 1;

  function playBoth() {
    for (const v of [a.current, b.current]) {
      if (!v) continue;
      v.currentTime = 0;
      void v.play().catch(() => {});
    }
  }

  return (
    <div className="ln-detail" role="tabpanel" id="ln-panel" aria-labelledby={`ln-tab-${video.id}`}>
      <div className="ln-detail-head">
        <div>
          <h3>
            Attempt {n} <span className="ln-of">of {chain.length}</span>
          </h3>
          <p className="ln-meta">
            {when(video.created_at)}
            {video.creator_version && (
              <>
                <span aria-hidden> · </span>Creator <code>{shortVersion(video.creator_version)}</code>
              </>
            )}
            {video.reviewer_version && video.review_reason !== MANUAL_REASON && (
              <>
                <span aria-hidden> · </span>Reviewer <code>{shortVersion(video.reviewer_version)}</code>
              </>
            )}
          </p>
        </div>
        {canCompare && (
          <div className="seg ln-compare" role="group" aria-label="View">
            <button className={!comparing ? "on" : ""} aria-pressed={!comparing} onClick={() => setCompare(false)}>
              This attempt
            </button>
            <button className={comparing ? "on" : ""} aria-pressed={comparing} onClick={() => setCompare(true)}>
              Side by side with {n - 1}
            </button>
          </div>
        )}
      </div>

      <div className={`ln-detail-body${comparing ? " comparing" : ""}`}>
        <div className="ln-players">
          {comparing && prev && <Player video={prev} n={n - 1} innerRef={a} compact />}
          {comparing && <ArrowRight size={18} className="ln-players-arrow" aria-hidden />}
          <Player key={video.id} video={video} n={n} innerRef={b} compact={comparing} />
          {comparing && (
            <button className="ln-playboth" onClick={playBoth}>
              <Play size={14} fill="currentColor" aria-hidden /> Play both from the start
            </button>
          )}
        </div>

        <div className="ln-info">
          {prev && (
            <section className="ln-section ln-why">
              <h4>Why there was an attempt {n}</h4>
              {prev.review_reason === MANUAL_REASON ? (
                <p className="ln-note">The Reviewer failed on attempt {n - 1}, so a person sent it back.</p>
              ) : asked ? (
                <>
                  <p className="ln-asked-lead">The Reviewer sent attempt {n - 1} back:</p>
                  <Clamp className="ln-quote" quote>
                    {asked}
                  </Clamp>
                </>
              ) : (
                <p className="ln-note">Attempt {n - 1} was sent back without a reason.</p>
              )}
              {changes && (
                <>
                  <p className="ln-asked-lead">The Creator's answer:</p>
                  {changes.length === 0 ? (
                    <p className="ln-note">The same edit plan. The difference is in the render.</p>
                  ) : (
                    <dl className="ln-changes">
                      {changes.map((c) => (
                        <div key={c.label} className={c.long ? "long" : ""}>
                          <dt>{c.label}</dt>
                          <dd>
                            {c.before && <span className="was">{c.before}</span>}
                            {c.before && <ArrowRight size={13} className="to" aria-label="became" />}
                            <span className="now">{c.after}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {video.plan?.rationale && (
                    <Clamp className="ln-rationale">
                      <span className="ln-rationale-lead">In its words: </span>
                      {video.plan.rationale}
                    </Clamp>
                  )}
                </>
              )}
            </section>
          )}
          {!prev && (
            <section className="ln-section">
              <h4>The first try</h4>
              <p className="ln-note">
                From the brief “{video.brief}” on <code>{video.footage}</code>.
              </p>
            </section>
          )}

          <section className="ln-section">
            <h4>{video.review_reason === MANUAL_REASON ? "The verdict" : "What the Reviewer said"}</h4>
            {video.status === "failed" ? (
              <p className="ln-note">{video.error?.split("\n")[0] ?? "The Creator couldn't finish this attempt."}</p>
            ) : stuck(video) ? (
              <p className="ln-note">
                The Reviewer failed on this attempt. Give the verdict yourself from its card in the Studio.
              </p>
            ) : kindOf(video) === "live" ? (
              <p className="ln-note">Nothing yet: this attempt is still {VERDICT[video.status].toLowerCase()}</p>
            ) : text ? (
              <Clamp className="ln-review" more="Show the full review">
                {text}
              </Clamp>
            ) : (
              <p className="ln-note">No reason given.</p>
            )}
            {(video.status === "approved" || video.status === "rejected") && (
              <div className="ln-you">
                <Vote video={video} />
                {video.comments.length > 0 && (
                  <span className="ln-vote none">
                    <MessageSquare size={14} aria-hidden /> {video.comments.length} comment
                    {video.comments.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** The window "History" opens: every attempt down the left, the one picked on the right. */
export function LineageWindow({ chain, start, close }: { chain: Video[]; start: number; close: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [index, setIndex] = useState(start);
  const at = Math.min(index, chain.length - 1);
  const first = chain[0];
  const last = chain[chain.length - 1];
  const end = outcome(chain);
  const title = last.plan?.title || chain.find((v) => v.plan)?.plan?.title || first.brief;

  useModalKeys(box, close);
  useEffect(() => {
    closeBtn.current?.focus();
  }, []);

  function onRailKey(e: ReactKeyboardEvent) {
    const to =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? Math.min(at + 1, chain.length - 1)
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? Math.max(at - 1, 0)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? chain.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    setIndex(to);
    tabs.current[to]?.focus();
  }

  // Rendered into <body>, like the feedback window: the card's entry animation leaves a transform on it, which
  // would trap a fixed overlay inside the card.
  return createPortal(
    <div className="scrim fb-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={box}
        className="fb-window ln-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ln-title"
        tabIndex={-1}
        data-own-keys
      >
        <header className="fb-head">
          <div className="fb-head-text">
            <span className="clip-label">
              <History size={13} aria-hidden /> Clip history
            </span>
            <h2 id="ln-title">{title}</h2>
            <p className={`ln-outcome k-${end.kind}`}>
              <KindIcon kind={end.kind} size={14} /> {end.text}
            </p>
          </div>
          <button ref={closeBtn} className="fb-close" onClick={close} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <div className="ln-body">
          <nav className="ln-rail" aria-label="Attempts">
            <p className="ln-brief">
              <span className="clip-label">Brief</span>“{first.brief}”
            </p>
            <div role="tablist" aria-orientation="vertical" aria-label="Attempts" className="ln-steps" onKeyDown={onRailKey}>
              {chain.map((v, i) => {
                const kind = kindOf(v);
                const said = review(v);
                return (
                  <button
                    key={v.id}
                    id={`ln-tab-${v.id}`}
                    ref={(el) => {
                      tabs.current[i] = el;
                    }}
                    role="tab"
                    aria-selected={i === at}
                    aria-controls="ln-panel"
                    tabIndex={i === at ? 0 : -1}
                    className={`ln-step k-${kind}${i === at ? " on" : ""}${i === chain.length - 1 ? " last" : ""}`}
                    onClick={() => setIndex(i)}
                  >
                    <span className="ln-node" aria-hidden>
                      <KindIcon kind={kind} size={13} />
                    </span>
                    <span className="ln-step-text">
                      <span className="ln-step-head">
                        <strong>Attempt {i + 1}</strong>
                        <span className="ln-step-verdict">{verdictOf(v)}</span>
                      </span>
                      <span className="ln-step-time">{i === 0 ? when(v.created_at) : `+${span(v.created_at - first.created_at)}`}</span>
                      {said && kind !== "live" && <span className="ln-step-said">{said}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {chain.length > 1 && (
              <p className="ln-rail-hint">
                <kbd>↑</kbd> <kbd>↓</kbd> to move between attempts
              </p>
            )}
          </nav>

          <Detail key={chain[at].id} chain={chain} index={at} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
