import { useRef, useState } from "react";
import type { Video } from "./api";
import { ClipCard } from "./ClipCard";
import { stylesIn, stylesOf } from "./Styles";
import "./Feed.css";
import { CircleCheck, Undo2 } from "lucide-react";
import { Empty } from "./ui";

type SortMode = "unvoted" | "newest";

function newestFirst(a: Video, b: Video) {
  return b.created_at - a.created_at || b.id - a.id;
}

function sortVideos(videos: Video[], sort: SortMode) {
  return [...videos].sort((a, b) => {
    if (sort === "unvoted") {
      const voted = Number(a.human_liked !== null) - Number(b.human_liked !== null);
      if (voted !== 0) return voted;
    }
    return newestFirst(a, b);
  });
}

/** The Reviewer's verdicts: approved clips (Feed) or sent-back clips (Rejected), for humans to agree or disagree. */
export function Feed({
  videos: allVideos,
  mode,
  refresh,
}: {
  videos: Video[];
  mode: "feed" | "rejected";
  refresh: () => void;
}) {
  const [sort, setSort] = useState<SortMode>("unvoted");
  // Style filter (#13). It narrows what is shown and counted, never the order: the order below is kept over every
  // clip, so switching the filter doesn't reshuffle cards. A style no clip has any more falls back to all.
  const styleOptions = stylesIn(allVideos);
  const [styleFilter, setStyleFilter] = useState<string | null>(null);
  const style = styleFilter && styleOptions.includes(styleFilter) ? styleFilter : null;
  const inStyle = (video: Video) => !style || stylesOf(video).includes(style);
  const videos = style ? allVideos.filter(inStyle) : allVideos;
  const agreed = videos.filter(
    (video) =>
      video.human_liked !== null && video.review_approved !== null && video.human_liked === video.review_approved,
  ).length;
  const disagreed = videos.filter(
    (video) =>
      video.human_liked !== null && video.review_approved !== null && video.human_liked !== video.review_approved,
  ).length;
  const unvoted = videos.filter((video) => video.human_liked === null).length;
  const order = useRef<{ sort: SortMode; ids: number[] }>({ sort, ids: [] });
  const videosById = new Map(allVideos.map((video) => [video.id, video]));

  // Only a deliberate sort change may move existing cards. Newly finished clips join at the top;
  // polling still supplies fresh video objects, so votes and comments update without moving anything.
  if (order.current.sort !== sort) {
    order.current = { sort, ids: sortVideos(allVideos, sort).map((video) => video.id) };
  } else {
    const known = new Set(order.current.ids);
    const added = sortVideos(
      allVideos.filter((video) => !known.has(video.id)),
      sort,
    ).map((video) => video.id);
    order.current.ids = [...added, ...order.current.ids.filter((id) => videosById.has(id))];
  }

  const sorted = order.current.ids
    .map((id) => videosById.get(id))
    .filter((video): video is Video => video !== undefined)
    .filter(inStyle);

  const total = videos.length;
  const pct = (n: number) => (total ? `${(100 * n) / total}%` : "0%");

  return (
    <div className="feed-view">
      <div className="page-title">
        <div>
          <h1>{mode === "feed" ? "Approved clips" : "Sent-back clips"}</h1>
          <p>
            {mode === "feed"
              ? "The Reviewer approved these. Your vote checks its decision."
              : "The Reviewer sent these back. Like a good one to flag a Reviewer mistake."}
          </p>
        </div>
      </div>

      {total > 0 && (
        <section className="feed-summary" aria-label="Human feedback summary">
          <div className="feed-total">
            <strong>{total}</strong>
            <span>{mode === "feed" ? "approved" : "sent back"}</span>
          </div>
          <div className="feed-meter" aria-hidden>
            <span className="agree" style={{ width: pct(agreed) }} />
            <span className="disagree" style={{ width: pct(disagreed) }} />
          </div>
          <dl className="feed-stats">
            <div className="feed-stat agree" title="Your vote matches the Reviewer's verdict">
              <dt>
                <span className="swatch" />
                You agreed
              </dt>
              <dd>{agreed}</dd>
            </div>
            <div
              className="feed-stat disagree"
              title={
                mode === "rejected" ? "You liked a clip the Reviewer sent back" : "Your vote contradicts the Reviewer's verdict"
              }
            >
              <dt>
                <span className="swatch" />
                {mode === "rejected" ? "Reviewer wrong" : "You disagreed"}
              </dt>
              <dd>{disagreed}</dd>
            </div>
            <div className="feed-stat unvoted" title="These clips still need your vote">
              <dt>
                <span className="swatch" />
                Unvoted
              </dt>
              <dd>{unvoted}</dd>
            </div>
          </dl>
          <p className="feed-note">
            {mode === "feed"
              ? "A disagreement with the Reviewer becomes a failure the Auditor learns from."
              : "Liking a sent-back clip counts against the Reviewer."}
          </p>
        </section>
      )}

      <div className="feed-toolbar">
        {styleOptions.length > 0 ? (
          <div className="style-filter" role="group" aria-label="Filter by editing style">
            <span className="feed-tool-label">Style</span>
            <div className="seg">
              <button
                className={style === null ? "on" : ""}
                aria-pressed={style === null}
                onClick={() => setStyleFilter(null)}
              >
                All
              </button>
              {styleOptions.map((s) => (
                <button
                  key={s}
                  className={style === s ? "on" : ""}
                  aria-pressed={style === s}
                  onClick={() => setStyleFilter(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <span />
        )}
        <div className="feed-sort" role="group" aria-label="Sort">
          <span className="feed-tool-label">Sort</span>
          <div className="seg">
            <button
              className={sort === "unvoted" ? "on" : ""}
              aria-pressed={sort === "unvoted"}
              disabled={!videos.length}
              onClick={() => setSort("unvoted")}
            >
              Unvoted first
            </button>
            <button
              className={sort === "newest" ? "on" : ""}
              aria-pressed={sort === "newest"}
              disabled={!videos.length}
              onClick={() => setSort("newest")}
            >
              Newest
            </button>
          </div>
        </div>
      </div>

      {total === 0 ? (
        <Empty
          icon={mode === "feed" ? <CircleCheck size={18} /> : <Undo2 size={18} />}
          title={mode === "feed" ? "No approved clips yet" : "Nothing sent back"}
        >
          {mode === "feed"
            ? "Start a clip in the Studio. It appears here once the Reviewer approves it, ready for your vote."
            : "Start a clip in the Studio. If the Reviewer sends it back, it appears here for a second opinion."}
        </Empty>
      ) : (
        <div className="grid feed-grid">
          {sorted.map((video) => (
            <ClipCard key={video.id} video={video} onChange={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
