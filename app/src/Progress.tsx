import type { Change, Video } from "./api";
import { samePrefix } from "./Loop";

export type Row = { version: string; passed: number; total: number; first: number };

/**
 * A change's headline. The Auditor sometimes titles a change with the skill file it edits
 * ("editing.md", 2026-11-07); the failure pattern it fixes says more.
 */
export function changeTitle(c: Change): string {
  const cluster = typeof c.results?.cluster === "string" ? c.results.cluster : null;
  return /^[\w./-]+\.md$/.test(c.title.trim()) && cluster ? `Fix: ${cluster}` : c.title;
}

/**
 * The promoted change that produced a Creator version, if one is found. Our own commits to the
 * Creator's code also make new versions, so an unmatched version gets no Auditor credit: there is
 * deliberately no fallback by position. "No linked change" is all the UI can say about it.
 */
function changeFor(version: string, promoted: Change[], known: Record<string, number>): Change | undefined {
  const id = Object.entries(known).find(([v]) => samePrefix(v, version))?.[1];
  // The candidate's own commit is the version the agent reports; results.candidate holds it until the
  // A/B overwrites it with arm counts (experiments.py, 2026-11-07), and results.candidate_commit after a fix.
  const refs = (c: Change) =>
    [c.results?.candidate_commit, c.results?.candidate, c.results?.merged].filter(
      (r): r is string => typeof r === "string",
    );
  return promoted.find((c) => c.id === id) ?? promoted.find((c) => refs(c).some((r) => samePrefix(r, version)));
}

/**
 * Verdicts per Creator version on regular work (A/B and showcase clips excluded), oldest version first.
 * A human vote counts where there is one, else the Reviewer's verdict.
 */
export function passRows(videos: Video[]): Row[] {
  const rows = new Map<string, Row>();
  for (const v of videos) {
    if (v.experiment_id !== null || v.showcase || !v.creator_version) continue;
    const verdict = v.human_liked ?? v.review_approved;
    if (verdict === null) continue;
    const r = rows.get(v.creator_version) ?? { version: v.creator_version, passed: 0, total: 0, first: v.created_at };
    r.total += 1;
    r.passed += verdict ? 1 : 0;
    r.first = Math.min(r.first, v.created_at);
    rows.set(v.creator_version, r);
  }
  return [...rows.values()].sort((a, b) => a.first - b.first);
}

export const rowPct = (r: Row) => Math.round((100 * r.passed) / r.total);

/** Pass rate per Creator version on regular work (A/B clips excluded): is the system getting better? */
export function Progress({
  videos,
  changes,
  current,
  known = {},
}: {
  videos: Video[];
  changes: Change[];
  current?: string;
  /** Creator version → change id, from GET /showcase, which matches on the change branch's own commit too. */
  known?: Record<string, number>;
}) {
  const promoted = changes
    .filter((c) => c.agent === "creator" && c.status === "promoted")
    .sort((a, b) => a.created_at - b.created_at);
  const ordered = passRows(videos);
  // A freshly promoted version has no verdicts yet; it still gets a bar, so the promotion shows at once.
  const awaiting = current && !ordered.some((r) => samePrefix(r.version, current)) ? current : null;

  return (
    <section className="card vz-chart">
      <div className="vz-card-head">
        <h2>Creator pass rate by version</h2>
        <span className="vz-sub">A human vote where there is one, else the Reviewer's verdict</span>
      </div>
      {ordered.length === 1 && !awaiting && (
        <p className="vz-note-line">
          Only one Creator version has verdicts so far, so there is no improvement to measure yet. A version the Auditor
          promotes gets its own bar once clips are made with it.
        </p>
      )}
      {ordered.length === 0 ? (
        <div className="vz-chart-empty">
          <p>No verdicts yet. Make a few clips in the Studio and the first version's bar appears here.</p>
        </div>
      ) : (
        <div className="vz-plot">
          <div className="vz-axis" aria-hidden>
            <span style={{ bottom: "100%" }}>100</span>
            <span style={{ bottom: "50%" }}>50</span>
            <span style={{ bottom: "0%" }}>0</span>
          </div>
          <div className="vz-cols">
            {ordered.map((r, i) => {
              const pct = rowPct(r);
              const prev = i > 0 ? rowPct(ordered[i - 1]) : null;
              const change = i > 0 ? changeFor(r.version, promoted, known) : undefined;
              const latest = current ? samePrefix(r.version, current) : i === ordered.length - 1;
              return (
                <div key={r.version} className={`vz-col ${latest ? "latest" : ""}`}>
                  <div className="vz-bararea">
                    <div className="vz-bar" style={{ height: `${Math.max(pct, 2)}%` }} />
                    <div className="vz-val" style={{ bottom: `${Math.max(pct, 2)}%` }}>
                      <strong>{pct}%</strong>
                      {prev !== null && pct !== prev && (
                        <span className={`vz-dpill ${pct > prev ? "up" : "down"}`}>
                          {pct > prev ? "+" : ""}
                          {pct - prev}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="vz-vlabel">
                    <span className="vz-vname">v{i}</span>
                    <code>{r.version.slice(0, 7)}</code>
                  </div>
                  <div className="vz-vclips">
                    {r.passed}/{r.total} clips
                    {latest && <span className="vz-now">current</span>}
                  </div>
                  <div
                    className={`vz-vnote ${i > 0 && !change ? "none" : ""}`}
                    title={change ? changeTitle(change) : undefined}
                  >
                    {i === 0 ? "starting skills" : change ? changeTitle(change) : "no linked change"}
                  </div>
                </div>
              );
            })}
            {awaiting && (
              <div className="vz-col awaiting latest">
                <div className="vz-bararea">
                  <div className="vz-bar" />
                  <div className="vz-val" style={{ bottom: "100%" }}>
                    <strong>–</strong>
                  </div>
                </div>
                <div className="vz-vlabel">
                  <span className="vz-vname">v{ordered.length}</span>
                  <code>{awaiting.slice(0, 7)}</code>
                </div>
                <div className="vz-vclips">
                  <span className="vz-now">current · no clips yet</span>
                </div>
                <div className="vz-vnote">
                  {(() => {
                    const c = changeFor(awaiting, promoted, known);
                    return c ? changeTitle(c) : "no linked change";
                  })()}
                </div>
              </div>
            )}
            {!awaiting && (
              <div className="vz-col ghost" aria-hidden>
                <div className="vz-bararea">
                  <div className="vz-bar" />
                  <div className="vz-val" style={{ bottom: "100%" }}>
                    <strong>?</strong>
                  </div>
                </div>
                <div className="vz-vlabel">
                  <span className="vz-vname">v{ordered.length + (awaiting ? 1 : 0)}</span>
                </div>
                <div className="vz-vclips">&nbsp;</div>
                <div className="vz-vnote">appears when the Auditor promotes a change</div>
              </div>
            )}
            <div className="vz-col fill" aria-hidden>
              <div className="vz-bararea" />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
