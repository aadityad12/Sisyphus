import type { Change, Video } from "./api";

type Row = { version: string; passed: number; total: number; first: number };

/** The promoted change that produced a Creator version, matched on the shorter of the two hashes. */
function changeFor(version: string, changes: Change[]): Change | undefined {
  return changes.find((c) => {
    const merged = c.results?.merged;
    if (c.agent !== "creator" || c.status !== "promoted" || typeof merged !== "string") return false;
    const n = Math.min(merged.length, version.length);
    return n >= 7 && merged.slice(0, n) === version.slice(0, n);
  });
}

/** Pass rate per Creator version on regular work (A/B clips excluded): is the system getting better? */
export function Progress({ videos, changes }: { videos: Video[]; changes: Change[] }) {
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
  const ordered = [...rows.values()].sort((a, b) => a.first - b.first);

  return (
    <section className="evo-chart">
      <div className="evo-title">
        <h2>Creator pass rate by version</h2>
        <span className="dim small">a human vote where there is one, else the Reviewer's verdict</span>
      </div>
      {ordered.length === 0 ? (
        <p className="dim">No verdicts yet. Make a few clips in the Studio and the first version's bar appears here.</p>
      ) : (
        <div className="bars">
          {ordered.map((r, i) => {
            const pct = Math.round((100 * r.passed) / r.total);
            const prev = i > 0 ? Math.round((100 * ordered[i - 1].passed) / ordered[i - 1].total) : null;
            const change = changeFor(r.version, changes);
            const latest = i === ordered.length - 1;
            return (
              <div key={r.version} className={`barcol ${latest ? "latest" : ""}`}>
                <div className="barval">
                  <strong>{pct}%</strong>
                  {prev !== null && pct !== prev && (
                    <span className={pct > prev ? "up" : "down"}>
                      {pct > prev ? "+" : ""}
                      {pct - prev}
                    </span>
                  )}
                </div>
                <div className="bartrack">
                  <div className="barfill" style={{ height: `${Math.max(pct, 2)}%` }} />
                </div>
                <div className="barlabel">
                  <span className="vname">v{i}</span>
                  <code>{r.version.slice(0, 7)}</code>
                </div>
                <div className="barnote" title={change?.title}>
                  {i === 0 ? "starting skills" : change ? change.title : "—"}
                </div>
                <div className="dim small">
                  {r.passed}/{r.total} clips
                </div>
              </div>
            );
          })}
          <div className="barcol ghost" aria-hidden>
            <div className="barval">
              <strong className="dim">?</strong>
            </div>
            <div className="bartrack" />
            <div className="barlabel">
              <span className="vname dim">v{ordered.length}</span>
            </div>
            <div className="barnote">the Auditor's next promoted change</div>
            <div className="small">&nbsp;</div>
          </div>
        </div>
      )}
    </section>
  );
}
