import type { Change, Video } from "./api";

type Row = { version: string; passed: number; total: number; first: number };

/**
 * A change's headline. The Auditor sometimes titles a change with the skill file it edits
 * ("editing.md", 2026-11-07); the failure pattern it fixes says more.
 */
export function changeTitle(c: Change): string {
  const cluster = typeof c.results?.cluster === "string" ? c.results.cluster : null;
  return /^[\w./-]+\.md$/.test(c.title.trim()) && cluster ? `Fix: ${cluster}` : c.title;
}

const samePrefix = (a: string, b: string) => {
  const n = Math.min(a.length, b.length);
  return n >= 7 && a.slice(0, n) === b.slice(0, n);
};

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
  // A freshly promoted version has no verdicts yet; it still gets a bar, so the promotion shows at once.
  const awaiting = current && !ordered.some((r) => samePrefix(r.version, current)) ? current : null;

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
            const change = i > 0 ? changeFor(r.version, promoted, known) : undefined;
            const latest = current ? samePrefix(r.version, current) : i === ordered.length - 1;
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
                <div className="barnote" title={change ? changeTitle(change) : undefined}>
                  {i === 0 ? "starting skills" : change ? changeTitle(change) : "no linked change"}
                </div>
                <div className="dim small">
                  {r.passed}/{r.total} clips
                </div>
              </div>
            );
          })}
          {awaiting && (
            <div className="barcol awaiting latest">
              <div className="barval">
                <strong className="dim">–</strong>
              </div>
              <div className="bartrack" />
              <div className="barlabel">
                <span className="vname">v{ordered.length}</span>
                <code>{awaiting.slice(0, 7)}</code>
              </div>
              <div className="barnote">
                {(() => {
                  const c = changeFor(awaiting, promoted, known);
                  return c ? changeTitle(c) : "current version";
                })()}
              </div>
              <div className="small awaiting-note">current · no clips yet</div>
            </div>
          )}
          <div className="barcol ghost" aria-hidden>
            <div className="barval">
              <strong className="dim">?</strong>
            </div>
            <div className="bartrack" />
            <div className="barlabel">
              <span className="vname dim">v{ordered.length + (awaiting ? 1 : 0)}</span>
            </div>
            <div className="barnote">the Auditor's next promoted change</div>
            <div className="small">&nbsp;</div>
          </div>
        </div>
      )}
    </section>
  );
}
