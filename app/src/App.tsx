import { useEffect, useState } from "react";
import "./App.css";
import { api } from "./api";
import { Studio } from "./Studio";
import { Feed } from "./Feed";
import { Versions } from "./Versions";
import { Showcase } from "./Showcase";
import { usePoll } from "./usePoll";
import { Loop, passRates, samePrefix } from "./Loop";

const TABS = ["Studio", "Feed", "Rejected", "Versions", "Showcase"] as const;
type Tab = (typeof TABS)[number];

const TAB_HINT: Record<Tab, string> = {
  Studio: "Start a clip and watch it move through the agents",
  Feed: "Clips the Reviewer approved",
  Rejected: "Clips the Reviewer sent back",
  Versions: "The Auditor's changes and their A/B tests",
  Showcase: "The same briefs, re-edited by every Creator version",
};

function App() {
  // The tab lives in the URL hash, so a reload (or the dev server's) keeps you where you were.
  const fromHash = () => TABS.find((t) => `#${t.toLowerCase()}` === window.location.hash) ?? "Studio";
  const [tab, setTabState] = useState<Tab>(fromHash);
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, "", `#${t.toLowerCase()}`);
  };
  useEffect(() => {
    const onHash = () => setTabState(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const [openedAt] = useState(Date.now);
  // A poll that keeps failing with the same error doesn't re-render, so wake once when "starting" ends.
  const [, setWoken] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWoken(true), 20_500);
    return () => clearTimeout(t);
  }, []);
  const health = usePoll(api.health, 3000);
  const videos = usePoll(() => api.videos(), 2000);
  const audit = usePoll(api.auditStatus, 2000);
  // A/B clips and showcase renders are not regular work: they stay out of Studio, Feed, Rejected and the pass rate.
  const all = (videos.data ?? []).filter((v) => v.experiment_id === null && !v.showcase);

  const approved = all.filter((v) => v.status === "approved");
  const rejected = all.filter((v) => v.status === "rejected");
  const counts: Record<Tab, number | null> = {
    Studio: all.filter((v) => ["queued", "creating", "reviewing"].includes(v.status)).length || null,
    Feed: approved.length || null,
    Rejected: rejected.length || null,
    Versions: null,
    Showcase: null,
  };

  const rates = passRates(all);
  // When the Creator has moved past the newest measured version, say how the current one is doing.
  const current = health.data?.versions.creator;
  let currentLine: string | null = null;
  if (rates && current && current !== "unknown" && !samePrefix(current, rates.lastVersion)) {
    const judged = all.filter(
      (v) =>
        v.creator_version && samePrefix(v.creator_version, current) && (v.human_liked ?? v.review_approved) !== null,
    );
    const passed = judged.filter((v) => v.human_liked ?? v.review_approved).length;
    currentLine = `current ${current.slice(0, 7)}: ${judged.length ? `${passed}/${judged.length} clips` : "no verdicts yet"}`;
  }
  // Before the first answer the engine may still be starting (the desktop app launches it).
  const engine = health.data
    ? health.error
      ? "lost"
      : "online"
    : health.error && Date.now() - openedAt > 20_000
      ? "down"
      : "starting";

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <h1>
            <span className="si">SI</span>syphus
          </h1>
          <span className="tagline">One must imagine SIsyphus editing.</span>
        </div>
        <Loop videos={videos.data ?? []} versions={health.data?.versions} audit={audit.data} go={setTab} />
        <div
          className="headline"
          title="Share of the Creator's clips that passed (a human vote, else the Reviewer), first version against the latest"
        >
          <span className="headline-label">Creator pass rate</span>
          {rates ? (
            <span className="headline-value">
              {rates.versions > 1 && (
                <>
                  <span className="was">{rates.first}%</span>
                  <span className="dim"> → </span>
                </>
              )}
              <strong
                className={
                  rates.versions > 1 ? (rates.last > rates.first ? "up" : rates.last < rates.first ? "down" : "") : ""
                }
              >
                {rates.last}%
              </strong>
            </span>
          ) : (
            <span className="headline-value dim">no verdicts yet</span>
          )}
          <span className="headline-sub">
            {rates ? `${rates.lastVersion.slice(0, 7)}: ${rates.passed}/${rates.clips} clips` : "\u00a0"}
          </span>
          {currentLine && <span className="headline-sub">{currentLine}</span>}
        </div>
        <span className={`engine ${engine}`} title={`Engine ${engine}`}>
          <span className="engine-dot" />
          {engine === "online" ? "engine" : engine === "starting" ? "starting engine…" : "engine offline"}
        </span>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? "active" : ""} onClick={() => setTab(t)} title={TAB_HINT[t]}>
            {t}
            {counts[t] !== null && <span className="count">{counts[t]}</span>}
          </button>
        ))}
      </nav>

      {(engine === "down" || engine === "lost") && (
        <div className="banner">
          <strong>The engine isn't answering.</strong> The app shows the last data it had. In development, start it with{" "}
          <code>cd engine && uv run python -m sisyphus_engine</code>; the desktop app starts it by itself.
        </div>
      )}

      <section className="panel">
        {tab === "Studio" && <Studio videos={all} refresh={videos.refresh} />}
        {tab === "Feed" && <Feed videos={approved} mode="feed" refresh={videos.refresh} />}
        {tab === "Rejected" && <Feed videos={rejected} mode="rejected" refresh={videos.refresh} />}
        {tab === "Versions" && <Versions videos={all} />}
        {tab === "Showcase" && <Showcase />}
      </section>
    </main>
  );
}

export default App;
