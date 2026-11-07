import { useState } from "react";
import { api } from "./api";
import { Studio } from "./Studio";
import { VideoCard } from "./VideoCard";
import { Versions } from "./Versions";
import { usePoll } from "./usePoll";
import "./App.css";

const TABS = ["Studio", "Feed", "Rejected", "Versions"] as const;
type Tab = (typeof TABS)[number];

function App() {
  const [tab, setTab] = useState<Tab>("Studio");
  const health = usePoll(api.health, 3000);
  const videos = usePoll(() => api.videos(), 2000);
  const all = (videos.data ?? []).filter((v) => v.experiment_id === null);

  const approved = all.filter((v) => v.status === "approved");
  const rejected = all.filter((v) => v.status === "rejected");
  const counts: Record<Tab, number | null> = {
    Studio: all.filter((v) => ["queued", "creating", "reviewing"].includes(v.status)).length || null,
    Feed: approved.length || null,
    Rejected: rejected.length || null,
    Versions: null,
  };

  return (
    <main className="app">
      <header className="top">
        <h1>
          <span>
            <span className="si">SI</span>syphus
          </span>
          <span className="tagline">One must imagine SIsyphus editing.</span>
        </h1>
        <span className={health.data ? "pill ok" : "pill down"}>
          {health.data ? "engine online" : "engine not reachable"}
        </span>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>
            {t}
            {counts[t] !== null && <span className="count">{counts[t]}</span>}
          </button>
        ))}
      </nav>

      <section className="panel">
        {tab === "Studio" && <Studio videos={all} refresh={videos.refresh} />}
        {tab === "Feed" && (
          <>
            <p className="dim">Clips the Reviewer approved. Your likes, dislikes and comments teach the system.</p>
            <div className="grid">
              {approved.map((v) => (
                <VideoCard key={v.id} video={v} onChange={videos.refresh} mode="feed" />
              ))}
            </div>
          </>
        )}
        {tab === "Rejected" && (
          <>
            <p className="dim">
              Clips the Reviewer sent back. If one is actually good, say so: that counts against the Reviewer.
            </p>
            <div className="grid">
              {rejected.map((v) => (
                <VideoCard key={v.id} video={v} onChange={videos.refresh} mode="rejected" />
              ))}
            </div>
          </>
        )}
        {tab === "Versions" && <Versions />}
      </section>
    </main>
  );
}

export default App;
