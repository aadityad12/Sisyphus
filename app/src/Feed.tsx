import { useState } from "react";
import type { Video } from "./api";
import { VideoCard } from "./VideoCard";
import "./Feed.css";

type SortMode = "unvoted" | "newest" | "creator";

function newestFirst(a: Video, b: Video) {
  return b.created_at - a.created_at || b.id - a.id;
}

/** Keep the ordering stable as polling refreshes the cards, and group Creator versions by their latest clip. */
function sortVideos(videos: Video[], sort: SortMode) {
  const latestForVersion = new Map<string, number>();
  if (sort === "creator") {
    for (const video of videos) {
      const version = video.creator_version ?? "unversioned";
      latestForVersion.set(version, Math.max(latestForVersion.get(version) ?? 0, video.created_at));
    }
  }

  return [...videos].sort((a, b) => {
    if (sort === "unvoted") {
      const voted = Number(a.human_liked !== null) - Number(b.human_liked !== null);
      if (voted !== 0) return voted;
    }

    if (sort === "creator") {
      const aVersion = a.creator_version ?? "unversioned";
      const bVersion = b.creator_version ?? "unversioned";
      if (aVersion !== bVersion) {
        return (latestForVersion.get(bVersion) ?? 0) - (latestForVersion.get(aVersion) ?? 0);
      }
    }

    return newestFirst(a, b);
  });
}

/** The Reviewer's verdicts: approved clips (Feed) or sent-back clips (Rejected), for humans to agree or disagree. */
export function Feed({ videos, mode, refresh }: { videos: Video[]; mode: "feed" | "rejected"; refresh: () => void }) {
  const [sort, setSort] = useState<SortMode>("unvoted");
  const agreed = videos.filter(
    (video) =>
      video.human_liked !== null && video.review_approved !== null && video.human_liked === video.review_approved,
  ).length;
  const disagreed = videos.filter(
    (video) =>
      video.human_liked !== null && video.review_approved !== null && video.human_liked !== video.review_approved,
  ).length;
  const unvoted = videos.filter((video) => video.human_liked === null).length;
  const reviewerWrong = videos.filter((video) => video.human_liked === true).length;
  const sorted = sortVideos(videos, sort);

  return (
    <div className="feed-view">
      <div className="feed-toolbar">
        <div>
          <h2 className="feed-heading">{mode === "feed" ? "Approved clips" : "Sent-back clips"}</h2>
          <p className="feed-description">
            {mode === "feed"
              ? "The Reviewer approved these. Your vote tells the Auditor whether it was right."
              : "The Reviewer sent these back. Like a good one to flag a Reviewer mistake."}
          </p>
        </div>
        <label className="feed-sort">
          Sort by
          <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} disabled={!videos.length}>
            <option value="unvoted">Unvoted first</option>
            <option value="newest">Newest first</option>
            <option value="creator">Creator version</option>
          </select>
        </label>
      </div>

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
            <div className="feed-stat disagree" title="Your vote contradicts the Reviewer's verdict">
              <dt>You disagreed</dt>
              <dd>{disagreed}</dd>
            </div>
            <div className="feed-stat unvoted" title="These clips still need your vote">
              <dt>Unvoted</dt>
              <dd>{unvoted}</dd>
            </div>
          </dl>
          <p className="feed-note">
            {mode === "rejected" && (
              <>
                Reviewer wrong on <strong>{reviewerWrong}</strong> {reviewerWrong === 1 ? "clip" : "clips"}.{" "}
              </>
            )}
            Every vote trains the Auditor.
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
