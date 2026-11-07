import { api, type Change } from "./api";
import { usePoll } from "./usePoll";

const STAMP: Record<Change["status"], string> = {
  proposed: "PROPOSED",
  testing: "A/B TESTING",
  promoted: "PROMOTED",
  rolled_back: "ROLLED BACK",
};

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="diff">
      {diff.split("\n").map((line, i) => (
        <span
          key={i}
          className={
            line.startsWith("+") && !line.startsWith("+++")
              ? "add"
              : line.startsWith("-") && !line.startsWith("---")
                ? "del"
                : line.startsWith("@@")
                  ? "hunk"
                  : ""
          }
        >
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

type ArmResult = { approved?: number; total?: number; human_agree?: number; human_total?: number };

function ABTable({ results }: { results: Record<string, unknown> }) {
  const control = (results.control ?? {}) as ArmResult;
  const candidate = (results.candidate ?? {}) as ArmResult;
  const rate = (a: ArmResult) => (a.total ? a.approved! / a.total : null);
  const rows: [string, number | null, number | null][] = [
    ["Approval rate", rate(control), rate(candidate)],
  ];
  if (control.human_total || candidate.human_total) {
    rows.push([
      "Agreement with humans",
      control.human_total ? control.human_agree! / control.human_total : null,
      candidate.human_total ? candidate.human_agree! / candidate.human_total : null,
    ]);
  }
  const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
  return (
    <table className="ab">
      <thead>
        <tr>
          <th />
          <th>Current</th>
          <th>Candidate</th>
          <th>Δ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, a, b]) => {
          const d = a !== null && b !== null ? b - a : null;
          return (
            <tr key={label}>
              <td>{label}</td>
              <td>{pct(a)}</td>
              <td>{pct(b)}</td>
              <td className={d === null ? "" : d > 0 ? "up" : d < 0 ? "down" : ""}>
                {d === null ? "–" : `${d > 0 ? "+" : ""}${Math.round(d * 100)}`}
              </td>
            </tr>
          );
        })}
        <tr>
          <td className="dim">Held-out clips</td>
          <td className="dim">{control.total ?? 0}</td>
          <td className="dim">{candidate.total ?? 0}</td>
          <td />
        </tr>
      </tbody>
    </table>
  );
}

function ChangeCard({ change }: { change: Change }) {
  return (
    <article className={`change ${change.status}`}>
      <header className="row">
        <span className="chip">{change.agent}</span>
        <code className="chip">{change.branch}</code>
        <span className={`stamp ${change.status}`}>{STAMP[change.status]}</span>
      </header>
      <h3>{change.title}</h3>
      {change.rationale && <p>{change.rationale}</p>}
      {change.failure_ids.length > 0 && (
        <p className="dim small">
          Motivated by {change.failure_ids.length} failures: {change.failure_ids.map((id) => `#${id}`).join(", ")}
        </p>
      )}
      {change.diff && <DiffView diff={change.diff} />}
      {change.results && <ABTable results={change.results} />}
    </article>
  );
}

export function Versions() {
  const { data } = usePoll(api.versions, 3000);
  if (!data) return <p className="dim">Loading…</p>;
  return (
    <div className="versions">
      <section>
        <h2>Current agents</h2>
        <div className="row">
          {Object.entries(data.current).map(([agent, v]) => (
            <div key={agent} className="agentver">
              <span className="dim small">{agent}</span>
              <code>{v}</code>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Changes</h2>
        {data.changes.length === 0 ? (
          <p className="dim">The Auditor hasn't proposed any changes yet.</p>
        ) : (
          data.changes.map((c) => <ChangeCard key={c.id} change={c} />)
        )}
      </section>

      <section>
        <h2>History</h2>
        {Object.entries(data.history).map(([agent, commits]) => (
          <div key={agent} className="timeline">
            <h3>{agent}</h3>
            <ol>
              {commits.map((c) => (
                <li key={c.version}>
                  <code>{c.version}</code> {c.subject}{" "}
                  <span className="dim small">{new Date(c.time * 1000).toLocaleTimeString()}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </section>
    </div>
  );
}
