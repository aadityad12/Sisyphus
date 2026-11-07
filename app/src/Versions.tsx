import { useEffect, useState } from "react";
import { api, type Change, type Video } from "./api";
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

function verdict(v: Video): "pass" | "fail" | "pending" {
  const ok = v.human_liked ?? v.review_approved;
  if (v.status === "failed") return "fail";
  return ok === null ? "pending" : ok ? "pass" : "fail";
}

function Clip({ video }: { video: Video | undefined }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (video?.plan) api.videoUrl(video.id).then(setSrc);
  }, [video?.id, video?.plan]);
  if (!video) return <div className="abclip empty" />;
  const v = verdict(video);
  return (
    <div className={`abclip ${v}`}>
      {src ? <video src={src} controls preload="metadata" /> : <div className="placeholder busy">{video.status}</div>}
      <div className="small">
        <span className={`verdict ${v}`}>{v === "pass" ? "✓ pass" : v === "fail" ? "✗ fail" : "…"}</span>
        {video.human_liked !== null && <span className="chip">human</span>}
      </div>
      {video.review_reason && <p className="dim small">{video.review_reason}</p>}
    </div>
  );
}

/** Held-out clips, current version beside the candidate, one row per (footage, brief). */
function ABClips({ changeId }: { changeId: number }) {
  const { data } = usePoll(() => api.experimentVideos(changeId), 3000);
  if (!data || data.length === 0) return null;
  const rows = new Map<string, { control?: Video; candidate?: Video; brief: string }>();
  for (const v of [...data].reverse()) {
    const key = `${v.footage}|${v.brief}`;
    const row = rows.get(key) ?? { brief: v.brief };
    if (v.arm) row[v.arm] = v;
    rows.set(key, row);
  }
  return (
    <div className="abgrid">
      <div className="abhead dim small">Held-out work</div>
      <div className="abhead dim small">Current</div>
      <div className="abhead dim small">Candidate</div>
      {[...rows.entries()].map(([key, row]) => (
        <div key={key} className="abrow">
          <p className="small">“{row.brief}”</p>
          <Clip video={row.control} />
          <Clip video={row.candidate} />
        </div>
      ))}
    </div>
  );
}

function AuditorPanel() {
  const status = usePoll(api.auditStatus, 2000);
  const failures = usePoll(api.failures, 4000);
  const [error, setError] = useState<string | null>(null);
  const creator = (failures.data ?? []).filter((f) => f.agents.includes("creator"));
  const reviewer = (failures.data ?? []).filter((f) => f.agents.includes("reviewer"));
  const busy = status.data && ["clustering", "proposing"].includes(status.data.state);
  async function run() {
    setError(null);
    try {
      await api.runAudit();
      status.refresh();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section className="auditor">
      <div className="row">
        <div className="agentver">
          <span className="dim small">Creator failures</span>
          <strong className="big">{creator.length}</strong>
        </div>
        <div className="agentver">
          <span className="dim small">Reviewer failures</span>
          <strong className="big">{reviewer.length}</strong>
        </div>
        <div className="auditstate">
          <span className="dim small">Auditor</span>
          <div>
            <span className={`badge ${status.data?.state === "error" ? "failed" : status.data?.state === "idle" ? "" : "creating"}`}>
              {status.data?.state ?? "…"}
            </span>{" "}
            <span className="small">{status.data?.detail}</span>
          </div>
        </div>
        <button className="primary" disabled={!!busy} onClick={run}>
          Run Auditor
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
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
      <ABClips changeId={change.id} />
    </article>
  );
}

export function Versions() {
  const { data } = usePoll(api.versions, 3000);
  if (!data) return <p className="dim">Loading…</p>;
  return (
    <div className="versions">
      <AuditorPanel />
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
