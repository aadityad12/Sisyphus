import { useEffect, useState } from "react";
import { api, type ShowcaseVersion, type Video } from "./api";
import { usePoll } from "./usePoll";
import "./Showcase.css";

function tagsOf(v: Video): string[] {
  const t = v.review_tags;
  if (!t) return [];
  if (Array.isArray(t)) return t;
  try {
    return JSON.parse(t) as string[];
  } catch {
    return [];
  }
}

const BUSY: Record<string, string> = {
  queued: "Queued",
  creating: "Creator editing…",
  reviewing: "Reviewer watching…",
};

function Cell({ video, big }: { video: Video | undefined; big: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const ready = !!video?.plan && video.status !== "queued" && video.status !== "creating";
  useEffect(() => {
    if (video && ready) api.videoUrl(video.id).then(setSrc);
  }, [video?.id, ready]);

  if (!video) return <div className={`sc-cell empty ${big ? "big" : ""}`}>not rendered</div>;
  const busy = BUSY[video.status];
  const tags = tagsOf(video);
  return (
    <div className={`sc-cell status-${video.status} ${big ? "big" : ""}`}>
      <div className="sc-player">
        {src ? (
          <video src={src} controls preload="metadata" playsInline />
        ) : (
          <div className={`placeholder ${busy ? "busy" : ""}`}>{busy ?? (video.status === "failed" ? "Error" : "…")}</div>
        )}
      </div>
      {video.status === "approved" && <span className="badge approved">Approved</span>}
      {video.status === "rejected" && <span className="badge rejected">Sent back</span>}
      {busy && <span className="badge queued">{busy}</span>}
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
        <p className="sc-reason" title={video.review_reason}>
          {video.review_reason}
        </p>
      )}
    </div>
  );
}

function VersionHead({ v }: { v: ShowcaseVersion }) {
  return (
    <div className="sc-head">
      <strong>{v.label}</strong> <code>{v.version.slice(0, 7)}</code>
      <div className="dim small">{v.change ? v.change.title : v.label === "v0" ? "starting skills" : "—"}</div>
    </div>
  );
}

/** The same showcase briefs rendered at every Creator version: the before and after, side by side. */
export function Showcase() {
  const table = usePoll(api.showcase, 3000);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = table.data;

  async function renderNow() {
    setBusy(true);
    try {
      await api.renderShowcase();
      table.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!t) return <p className="dim">Loading showcase…</p>;
  const all = t.versions;
  const shown = compare && all.length > 2 ? [all[0], all[all.length - 1]] : all;
  const currentRendered = all.some((v) => v.version === t.current);
  const score = (v: ShowcaseVersion) => {
    const cells = t.rows.map((r) => r.cells[v.version]).filter((c): c is Video => !!c);
    const done = cells.filter((c) => c.status === "approved" || c.status === "rejected");
    return { approved: done.filter((c) => c.status === "approved").length, done: done.length };
  };

  return (
    <div className="showcase">
      <div className="sc-bar">
        <p className="dim">
          The same briefs, re-edited by every Creator version. They are never used to train or test a change, so
          this is a fair before and after.
        </p>
        <div className="sc-actions">
          {all.length > 2 && (
            <button onClick={() => setCompare(!compare)}>{compare ? "Show every version" : "First vs latest"}</button>
          )}
          <button className="primary" disabled={busy || t.rows.length === 0} onClick={renderNow}>
            {currentRendered ? "Re-render missing" : `Render at current version (${t.current.slice(0, 7)})`}
          </button>
        </div>
      </div>

      {t.rows.length === 0 && (
        <p className="dim">
          No showcase briefs yet. Mark two or three entries in footage/manifest.json with <code>"showcase": true</code>.
        </p>
      )}

      {t.rows.length > 0 && all.length === 0 && (
        <p className="dim">Nothing rendered yet. Render the showcase at the starting version to set the baseline.</p>
      )}

      {t.rows.length > 0 && all.length > 0 && (
        <div className="sc-scroll">
          <table className="sc-table">
            <thead>
              <tr>
                <th className="sc-brief">Brief</th>
                {shown.map((v) => {
                  const s = score(v);
                  return (
                    <th key={v.version}>
                      <VersionHead v={v} />
                      {s.done > 0 && (
                        <div className="sc-score">
                          {s.approved}/{s.done} approved
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={`${r.footage}|${r.brief}`}>
                  <td className="sc-brief">
                    <strong>{r.title}</strong>
                    {r.speaker && <div className="dim small">{r.speaker}</div>}
                    <div className="small">“{r.brief}”</div>
                  </td>
                  {shown.map((v) => (
                    <td key={v.version}>
                      <Cell video={r.cells[v.version]} big={compare} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
