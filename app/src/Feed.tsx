import type { Video } from "./api";
import { VideoCard } from "./VideoCard";
import "./Feed.css";

/** The Reviewer's verdicts: approved clips (Feed) or sent-back clips (Rejected), for humans to agree or disagree. */
export function Feed({ videos, mode, refresh }: { videos: Video[]; mode: "feed" | "rejected"; refresh: () => void }) {
  return (
    <>
      <p className="dim">
        {mode === "feed"
          ? "Clips the Reviewer approved. Your likes, dislikes and comments teach the system."
          : "Clips the Reviewer sent back. If one is actually good, say so: that counts against the Reviewer."}
      </p>
      <div className="grid">
        {videos.map((v) => (
          <VideoCard key={v.id} video={v} onChange={refresh} mode={mode} />
        ))}
      </div>
    </>
  );
}
