import type { Video } from "./api";

type Row = { version: string; passed: number; total: number; first: number };

/** Pass rate per Creator version on regular work (A/B clips excluded): is the system getting better? */
export function Progress({ videos }: { videos: Video[] }) {
  const rows = new Map<string, Row>();
  for (const v of videos) {
    if (v.experiment_id !== null || !v.creator_version) continue;
    const verdict = v.human_liked ?? v.review_approved;
    if (verdict === null) continue;
    const r = rows.get(v.creator_version) ?? { version: v.creator_version, passed: 0, total: 0, first: v.created_at };
    r.total += 1;
    r.passed += verdict ? 1 : 0;
    r.first = Math.min(r.first, v.created_at);
    rows.set(v.creator_version, r);
  }
  const ordered = [...rows.values()].sort((a, b) => a.first - b.first);
  if (ordered.length === 0) return null;
  return (
    <section>
      <h2>Creator pass rate by version</h2>
      <div className="progress">
        {ordered.map((r, i) => {
          const pct = Math.round((100 * r.passed) / r.total);
          return (
            <div key={r.version} className="progrow">
              <code>{r.version.slice(0, 8)}</code>
              <span className="dim small">{i === 0 ? "start" : `v${i + 1}`}</span>
              <div className="bar">
                <div className="fill" style={{ width: `${pct}%` }} />
              </div>
              <strong>{pct}%</strong>
              <span className="dim small">
                {r.passed}/{r.total} clips
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
