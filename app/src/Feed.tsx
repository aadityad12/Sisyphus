import { useRef, useState } from "react";
import type { Video } from "./api";
import { VideoCard } from "./VideoCard";
import { stylesIn, stylesOf } from "./Styles";
import "./Feed.css";

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

  return (
    <div className="feed-view">
      <div className="feed-toolbar">
        <div>
          <h2 className="feed-heading">{mode === "feed" ? "Approved clips" : "Sent-back clips"}</h2>
          <p className="feed-description">
            {mode === "feed"
              ? "The Reviewer approved these. Your vote checks its decision."
              : "The Reviewer sent these back. Like a good one to flag a Reviewer mistake."}
          </p>
        </div>
        <label className="feed-sort">
          Sort by
          <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} disabled={!videos.length}>
            <option value="unvoted">Unvoted first</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
      </div>

      {styleOptions.length > 0 && (
        <div className="style-filter" role="group" aria-label="Filter by editing style">
          Style
          <button className={style === null ? "on" : ""} aria-pressed={style === null} onClick={() => setStyleFilter(null)}>
            All
          </button>
          {styleOptions.map((s) => (
            <button key={s} className={style === s ? "on" : ""} aria-pressed={style === s} onClick={() => setStyleFilter(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {videos.length > 0 && (
        <section className="feed-summary" aria-label="Human feedback summary">
          <div className="feed-total">
            <strong>{videos.length}</strong>
            <span>{mode === "feed" ? "approved" : "sent back"}</span>
          </div>
          <dl className="feed-stats">
            <div className="feed-stat agree" title="Your vote matches the Reviewer's verdict">
              <dt>You agreed</dt>
              <dd>{agreed}</dd>
            </div>
            <div
              className="feed-stat disagree"
              title={mode === "rejected" ? "You liked a clip the Reviewer sent back" : "Your vote contradicts the Reviewer's verdict"}
            >
              <dt>{mode === "rejected" ? "Reviewer wrong" : "You disagreed"}</dt>
              <dd>{disagreed}</dd>
            </div>
            <div className="feed-stat unvoted" title="These clips still need your vote">
              <dt>Unvoted</dt>
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

      {videos.length === 0 ? (
        <section className="feed-empty">
          <span className="feed-empty-mark" aria-hidden="true">
            {mode === "feed" ? "✓" : "↩"}
          </span>
          <h3>{mode === "feed" ? "No approved clips yet" : "Nothing sent back"}</h3>
          <p>
            {mode === "feed"
              ? "Start a clip in Studio. It will appear here after the Reviewer approves it, ready for your vote."
              : "Start a clip in Studio. If the Reviewer sends it back, it will appear here for a second opinion."}
          </p>
        </section>
      ) : (
        <div className="grid feed-grid">
          {sorted.map((video) => (
            <VideoCard key={video.id} video={video} onChange={refresh} mode={mode} />
          ))}
        </div>
      )}
    </div>
  );
}
