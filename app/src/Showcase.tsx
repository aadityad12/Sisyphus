import { useEffect, useState, type CSSProperties } from "react";
import { api, type ShowcaseRow, type ShowcaseVersion, type Video } from "./api";
import { usePoll } from "./usePoll";
import "./Showcase.css";

function tagsOf(v: Video): string[] {
  const t = v.review_tags;
  if (!t) return [];
  if (Array.isArray(t)) return t;
  try {
    const parsed: unknown = JSON.parse(t);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

const BUSY: Record<string, string> = {
  queued: "Queued",
  creating: "Creator editing…",
  reviewing: "Reviewer watching…",
};

function Cell({ video }: { video: Video | undefined }) {
  const [src, setSrc] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const ready = !!video?.plan && video.status !== "queued" && video.status !== "creating";
  useEffect(() => {
    let active = true;
    setSrc(null);
    setPlaybackError(false);
    if (video && ready) {
      api.videoUrl(video.id).then(
        (url) => { if (active) setSrc(url); },
        () => { if (active) setPlaybackError(true); },
      );
    }
    return () => { active = false; };
  }, [video?.id, ready, playbackAttempt]);

  if (!video) return (
    <div className="sc-cell empty">
      <span className="sc-empty-mark" aria-hidden="true">＋</span>
      <strong>Not rendered yet</strong>
      <span>No clip for this version.</span>
    </div>
  );
  const error = video.status === "approved" || video.status === "rejected" ? null : video.error;
  const busy = !error && BUSY[video.status];
  const tags = tagsOf(video);
  return (
    <div className={`sc-cell status-${video.status}`}>
      <div className="sc-player">
        {src && !playbackError ? (
          <video src={src} controls preload="metadata" playsInline aria-label={video.plan?.title || video.brief}
            onError={() => setPlaybackError(true)} />
        ) : (
          <div className={`sc-placeholder ${busy ? "busy" : ""}`}>
            <span className="sc-frame-mark" aria-hidden="true">{video.status === "failed" || playbackError ? "!" : "▶"}</span>
            <strong>{playbackError ? "Video unavailable" : busy || (video.status === "failed" ? "Render failed" : error ? "Review needs attention" : "Loading video…")}</strong>
            <span>{playbackError ? "The clip could not be loaded." : video.status === "queued" ? "Your fixed brief is next in line." : "The same brief. This Creator version."}</span>
            {playbackError && <button onClick={() => setPlaybackAttempt((attempt) => attempt + 1)}>Retry video</button>}
          </div>
        )}
      </div>
      {video.status === "approved" && <span className="badge approved">✓ Reviewer approved</span>}
      {video.status === "rejected" && <span className="badge rejected">↩ Reviewer sent it back</span>}
      {video.status === "failed" && <span className="badge failed">Render failed</span>}
      {video.status === "reviewing" && video.error && <span className="badge failed">Review needs attention</span>}
      {busy && <span className="badge queued">{busy}</span>}
      {error && <p className="sc-error">{error.split("\n")[0]}</p>}
      {tags.length > 0 && (
        <div className="sc-tags">
          {tags.map((t) => (
            <span key={t} className="chip">
              {t}
            </span>
          ))}
        </div>
      )}
      {video.review_reason && (
        <details className="sc-review">
          <summary>Reviewer’s notes</summary>
          <p>{video.review_reason}</p>
        </details>
      )}
    </div>
  );
}

function sameVersion(version: string, current: string) {
  return version === current || (/^[a-f0-9]{7,40}$/i.test(version) && /^[a-f0-9]{7,40}$/i.test(current)
    && (version.startsWith(current) || current.startsWith(version)));
}

function score(version: ShowcaseVersion, rows: ShowcaseRow[]) {
  const cells = rows.map((row) => row.cells[version.version]).filter((cell): cell is Video => !!cell);
  const done = cells.filter((cell) => cell.status === "approved" || cell.status === "rejected");
  return {
    approved: done.filter((cell) => cell.status === "approved").length,
    reviewed: done.length,
    failed: cells.filter((cell) => cell.status === "failed" || (cell.status === "reviewing" && !!cell.error)).length,
    total: rows.length,
  };
}

function VersionHead({ version, rows, current, first, latest, shared }: {
  version: ShowcaseVersion; rows: ShowcaseRow[]; current: boolean; first: boolean; latest: boolean; shared: boolean;
}) {
  const result = score(version, rows);
  const title = version.change?.title ?? "";
  const cluster = version.change?.rationale?.split(": ")[0]?.trim();
  const changeTitle = /^[\w./-]+\.md$/.test(title) && cluster ? `Fix: ${cluster}` : title;
  return (
    <div className="sc-head">
      <div className="sc-version-label">
        <span>{first ? "Before · " : latest ? "Latest · " : "Version · "}{version.label}</span>
        {current && <span className="sc-current">Current Creator</span>}
      </div>
      <div className={`sc-score ${result.reviewed < result.total ? "sc-incomplete" : ""}`}>
        <strong>{result.reviewed ? result.approved : "—"}</strong>
        {result.total > 0 && <span>/ {result.total}</span>}
      </div>
      <div className="sc-score-label">Reviewer approved</div>
      <div className="sc-completion">
        {result.total > 0 ? `${result.reviewed} of ${result.total} reviewed` : shared ? "No shared briefs to score" : "No active briefs to score"}{result.failed > 0 ? ` · ${result.failed} need attention` : ""}
      </div>
      <div className="sc-change">
        <span className="sc-change-label">{version.change ? "What changed" : first ? "Baseline" : "Creator version"}</span>
        <strong>{changeTitle || (first ? "First rendered version" : "No linked change")}</strong>
        <code>{version.version.slice(0, 8)}</code>
      </div>
    </div>
  );
}

export function Showcase() {
  const table = usePoll(api.showcase, 3000);
  const [compare, setCompare] = useState(true);
  const [busy, setBusy] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const t = table.data;

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function renderNow() {
    setBusy(true);
    setRenderError(null);
    setNotice(null);
    try {
      const result = await api.renderShowcase();
      setNotice(result.queued.length ? `${result.queued.length} showcase render${result.queued.length === 1 ? "" : "s"} queued.` : "This version is already rendered or in progress.");
      await table.refresh();
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (!t) return (
    <div className="showcase sc-empty-state" role="status">
      <span className="sc-eyebrow">Showcase</span>
      <h3>{table.error ? "The Showcase is unavailable" : "Loading the before & after…"}</h3>
      <p>{table.error || "Gathering the same briefs at every Creator version."}</p>
      {table.error && <button onClick={table.refresh}>Try again</button>}
    </div>
  );
  const all = t.versions;
  const listed = t.rows.filter((row) => row.listed);
  const shown = compare && all.length > 2 ? [all[0], all[all.length - 1]] : all;
  const currentRendered = all.some((version) => sameVersion(version.version, t.current));
  const pendingAfter = all.length === 1;
  const hasComparison = all.length > 1;
  const sharedScoring = compare && hasComparison;
  const scoredRows = sharedScoring ? listed.filter((row) => shown.every((version) => !!row.cells[version.version])) : listed;

  return (
    <div className={`showcase ${compare ? "sc-compare" : "sc-history"}`}>
      <div className="sc-bar">
        <div className="sc-intro">
          <span className="sc-eyebrow">Showcase · fixed briefs</span>
          <h3>{hasComparison ? "The same brief, before & after." : pendingAfter ? "Baseline so far." : "Start with a baseline."}</h3>
          <p>{hasComparison ? "Every Creator version gets the same starting point. Watch what changes." : pendingAfter ? currentRendered ? "One Creator version is available. The next promoted version will appear alongside it." : "Render the current Creator to compare. Only the baseline is available so far." : "Render the fixed briefs first. Future Creator versions will appear alongside the baseline."}</p>
        </div>
        <div className="sc-actions">
          {all.length > 2 && (
            <button onClick={() => setCompare(!compare)}>{compare ? `All ${all.length} versions` : "Before & after"}</button>
          )}
          <button className="primary" disabled={busy || listed.length === 0} onClick={renderNow}>
            {busy ? "Queueing renders…" : currentRendered ? "Render missing clips" : all.length === 0 ? "Render the baseline" : "Render current Creator"}
          </button>
        </div>
      </div>
      <div className="sc-isolation"><span aria-hidden="true">◇</span> Reserved for the Showcase. Never used to train or test a change.</div>
      {(renderError || table.error) && <p className="sc-error sc-message" role="alert">{renderError || `Could not refresh: ${table.error}`}</p>}
      {notice && <p className="sc-notice sc-message" role="status">{notice}</p>}
      {all.length > 0 && !currentRendered && (
        <p className="sc-pending-current">The current Creator <code>{t.current.slice(0, 8)}</code> has not been rendered here yet. Showing the latest available version.</p>
      )}

      {listed.length === 0 && (
        <div className="sc-empty-state"><h3>{all.length ? "No active briefs." : "Set the starting point."}</h3><p>Mark two or three entries in <code>footage/manifest.json</code> with <code>"showcase": true</code> to compare the same work across versions.{all.length > 0 && " Historical renders remain below, outside the scores."}</p></div>
      )}

      {t.rows.length > 0 && all.length === 0 && (
        <div className="sc-empty-state"><h3>The before comes first.</h3><p>{t.rows.length} fixed brief{t.rows.length === 1 ? " is" : "s are"} ready. Render the baseline; promoted Creator versions will appear alongside it.</p></div>
      )}

      {t.rows.length > 0 && all.length > 0 && (
        <div className="sc-scroll" role="region" aria-label="Showcase version comparison" tabIndex={0}>
          <table className="sc-table" style={{ "--sc-columns": shown.length + (pendingAfter ? 1 : 0) } as CSSProperties}>
            <caption className="sc-sr-only">{hasComparison ? `The same briefs edited by ${compare ? "the first and latest available Creator versions" : "every rendered Creator version"}.` : "Fixed briefs edited by the baseline Creator. A second version is not available yet."}</caption>
            <thead>
              <tr>
                <th className="sc-brief" scope="col"><div className="sc-yardstick"><span className="sc-eyebrow">The constant</span><strong>{listed.length} fixed brief{listed.length === 1 ? "" : "s"}</strong>{sharedScoring && <span className="sc-score-scope">Scored on {scoredRows.length} shared brief{scoredRows.length === 1 ? "" : "s"}</span>}<span>Same footage.<br />Same goal.<br />{hasComparison ? "Different Creator." : "Baseline for comparison."}</span></div></th>
                {shown.map((v) => {
                  const current = sameVersion(v.version, t.current);
                  return (
                    <th key={v.version} scope="col" className={current ? "sc-current-column" : ""}>
                      <VersionHead version={v} rows={scoredRows} current={current} first={v === all[0]} latest={v === all[all.length - 1]} shared={sharedScoring} />
                    </th>
                  );
                })}
                {pendingAfter && (
                  <th scope="col" className="sc-pending-column">
                    <div className="sc-head sc-after-head">
                      <div className="sc-version-label"><span>After · {currentRendered ? "next version" : "current version"}</span></div>
                      <strong className="sc-after-title">{currentRendered ? "The next version goes here." : "Ready for the comparison."}</strong>
                      <p>{currentRendered ? "When a Creator change is promoted, its edits appear beside the baseline." : "Render the same briefs with the current Creator to see what changed."}</p>
                      {!currentRendered && <button className="primary" disabled={busy || listed.length === 0} onClick={renderNow}>{busy ? "Queueing renders…" : "Render current Creator"}</button>}
                    </div>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={`${r.footage}|${r.brief}`} className={!r.listed || (sharedScoring && !scoredRows.includes(r)) ? "sc-unscored" : ""}>
                  <th className="sc-brief sc-brief-content" scope="row">
                    <strong>{r.title}</strong>
                    {!r.listed ? <span className="sc-unscored-label">Archived · not scored</span> : sharedScoring && !scoredRows.includes(r) && <span className="sc-unscored-label">Not shared · not scored</span>}
                    {r.speaker && <div className="dim small">{r.speaker}</div>}
                    <p>“{r.brief}”</p>
                  </th>
                  {shown.map((v) => (
                    <td key={v.version} className={sameVersion(v.version, t.current) ? "sc-current-column" : ""}>
                      <Cell key={r.cells[v.version]?.id ?? "missing"} video={r.cells[v.version]} />
                    </td>
                  ))}
                  {pendingAfter && (
                    <td className="sc-pending-column">
                      <div className="sc-cell empty">
                        <span className="sc-empty-mark" aria-hidden="true">＋</span>
                        <strong>{!r.listed ? "Archived brief" : currentRendered ? "Waiting for the next Creator" : "Not rendered yet"}</strong>
                        <span>{!r.listed ? "Removed from the fixed set. Kept here for history." : "Same footage. Same brief. A new edit."}</span>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {all.length > 0 && <p className="sc-footnote">{sharedScoring ? "Comparison scores cover active briefs with a clip in both shown versions only." : "Scores cover the active fixed briefs only."} Archived briefs are kept for history, not scored. Verdicts are from render time, not the shadow A/B used to promote a change.</p>}
    </div>
  );
}
