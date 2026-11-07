import { useEffect, useState } from "react";
import "./Versions.css";
import { api, type AuditStatus, type Change, type Video } from "./api";
import { Progress, changeTitle } from "./Progress";
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

type ArmResult = {
  approved?: number;
  total?: number;
  agree?: number; // Reviewer changes: verdicts that matched a human vote
  human_agree?: number;
  human_total?: number;
};

/** The A/B as two numbers and a delta, with what the Auditor decided, so the outcome reads first. */
function ABResult({ change }: { change: Change }) {
  const results = change.results ?? {};
  const control = (results.control ?? {}) as ArmResult;
  const candidate = (results.candidate ?? {}) as ArmResult;
  const reviewerChange = change.agent === "reviewer";
  const rate = (a: ArmResult) =>
    a.total ? (reviewerChange ? (a.agree ?? 0) : (a.approved ?? 0)) / a.total : null;
  const count = (a: ArmResult) => (reviewerChange ? a.agree : a.approved) ?? 0;
  const a = rate(control);
  const b = rate(candidate);
  const d = a !== null && b !== null ? Math.round((b - a) * 100) : null;
  const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
  const pending = typeof results.pending === "number" ? results.pending : 0;
  const metric = reviewerChange ? "agree with the human vote" : "pass";
  const humans =
    !reviewerChange && (control.human_total || candidate.human_total)
      ? `Humans voted on ${(control.human_total ?? 0) + (candidate.human_total ?? 0)} of these clips; their votes override the Reviewer.`
      : null;

  let decision: string;
  if (change.status === "promoted")
    decision = `Promoted: the change won${typeof results.merged === "string" ? ` and was merged as ${results.merged.slice(0, 7)}` : ""}.`;
  else if (change.status === "rolled_back") decision = "Rolled back: it did not beat the version without it.";
  else if (typeof results.waiting_for_votes === "string") decision = `Waiting for human votes: ${results.waiting_for_votes}.`;
  else if (pending) decision = `Testing: ${pending} held-out clip${pending > 1 ? "s" : ""} still to be judged.`;
  else if (!control.total && !candidate.total)
    decision = reviewerChange
      ? "Testing: re-reviewing clips humans voted on, with both versions of the Reviewer."
      : "Testing: rendering held-out clips with both versions.";
  else decision = "Testing.";

  return (
    <div className={`abresult ${change.status}`}>
      <div className="abarm">
        <span className="ablabel">Without the change</span>
        <strong>{pct(a)}</strong>
        <span className="dim small">
          {count(control)}/{control.total ?? 0} {metric}
        </span>
      </div>
      <div className="abvs">vs</div>
      <div className="abarm candidate">
        <span className="ablabel">With the change</span>
        <strong>{pct(b)}</strong>
        <span className="dim small">
          {count(candidate)}/{candidate.total ?? 0} {metric}
        </span>
      </div>
      <div className={`abdelta ${d === null ? "" : d > 0 ? "up" : d < 0 ? "down" : ""}`}>
        {d === null ? "–" : `${d > 0 ? "+" : ""}${d}`}
        <span className="small">pts</span>
      </div>
      <p className="abdecision">
        {decision}
        {humans && <span className="dim"> {humans}</span>}
      </p>
    </div>
  );
}

function verdict(v: Video): "pass" | "fail" | "pending" {
  const ok = v.human_liked ?? v.review_approved;
  if (v.status === "failed") return "fail";
  return ok === null ? "pending" : ok ? "pass" : "fail";
}

function Clip({ video, onVoted }: { video: Video | undefined; onVoted: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  useEffect(() => {
    if (video?.plan) api.videoUrl(video.id).then(setSrc);
  }, [video?.id, video?.plan]);
  if (!video) return <div className="abclip empty" />;
  const v = verdict(video);
  // A human vote overrides the Reviewer for this clip, and can decide the A/B.
  async function vote(liked: boolean) {
    if (!video || pending) return;
    setPending(true);
    setVoteError(null);
    try {
      await api.feedback(video.id, { liked: video.human_liked === liked ? null : liked });
      onVoted();
    } catch (e) {
      setVoteError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={`abclip ${v}`}>
      {src ? <video src={src} controls preload="metadata" /> : <div className="placeholder busy">{video.status}</div>}
      <div className="small">
        <span className={`verdict ${v}`}>{v === "pass" ? "✓ pass" : v === "fail" ? "✗ fail" : "…"}</span>
        {video.human_liked !== null && <span className="chip">human</span>}
      </div>
      {video.review_reason && <p className="dim small">{video.review_reason}</p>}
      {video.plan && (
        <div className="row">
          <button className={video.human_liked === true ? "vote on up" : "vote"}
            disabled={pending}
            onClick={() => vote(true)}
          >
            ▲
          </button>
          <button className={video.human_liked === false ? "vote on down" : "vote"}
            disabled={pending}
            onClick={() => vote(false)}
          >
            ▼
          </button>
        </div>
      )}
      {voteError && <p className="error">Vote not saved: {voteError}</p>}
    </div>
  );
}

/** Held-out clips, current version beside the candidate, one row per (footage, brief). */
function ABClips({ changeId }: { changeId: number }) {
  const { data, refresh } = usePoll(() => api.experimentVideos(changeId), 3000);
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
      <div className="abhead dim small">Held-out brief</div>
      <div className="abhead dim small">Without the change</div>
      <div className="abhead dim small">With the change</div>
      {[...rows.entries()].map(([key, row]) => (
        <div key={key} className="abrow">
          <p className="small">“{row.brief}”</p>
          <Clip video={row.control} onVoted={refresh} />
          <Clip video={row.candidate} onVoted={refresh} />
        </div>
      ))}
    </div>
  );
}

const AUDIT_STATE: Record<AuditStatus["state"], string> = {
  idle: "Idle",
  clustering: "Grouping failures",
  proposing: "Writing a change",
  testing: "A/B testing",
  error: "Error",
};

function AuditorPanel() {
  const status = usePoll(api.auditStatus, 2000);
  const failures = usePoll(api.failures, 4000);
  const [error, setError] = useState<string | null>(null);
  const creator = (failures.data ?? []).filter((f) => f.agents.includes("creator"));
  const reviewer = (failures.data ?? []).filter((f) => f.agents.includes("reviewer"));
  const state = status.data?.state ?? "idle";
  const busy = state === "clustering" || state === "proposing";
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
    <section className={`auditor-panel state-${state}`}>
      <div className="auditor-head">
        <span className="agentname auditor">Auditor</span>
        <span className="auditor-state">
          <span className="state-dot" />
          {AUDIT_STATE[state]}
        </span>
      </div>
      {status.data?.detail && <p className="auditor-detail">{status.data.detail}</p>}
      <div className="failcounts">
        <div>
          <strong>{creator.length}</strong>
          <span className="agentname creator">Creator</span>
          <span className="dim small">failures</span>
        </div>
        <div>
          <strong>{reviewer.length}</strong>
          <span className="agentname reviewer">Reviewer</span>
          <span className="dim small">failures</span>
        </div>
      </div>
      <p className="dim small">
        A failure is a clip a human disagreed with, or one the Reviewer sent back. The Auditor groups them, writes one
        change to the skills, and A/B tests it on held-out work before adopting it.
      </p>
      <button className="primary" disabled={busy} onClick={run}>
        {busy ? `${AUDIT_STATE[state]}…` : "Run Auditor"}
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function diffStat(diff: string) {
  let add = 0;
  let del = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) add++;
    else if (l.startsWith("-") && !l.startsWith("---")) del++;
  }
  return { add, del };
}

function ChangeCard({ change }: { change: Change }) {
  const [showDiff, setShowDiff] = useState(false);
  const [showClips, setShowClips] = useState(change.status === "testing");
  const cluster = typeof change.results?.cluster === "string" ? change.results.cluster : null;
  // The engine stores the rationale as "<cluster>: <why>"; the cluster is shown on its own line.
  const rationale =
    cluster && change.rationale?.startsWith(`${cluster}: `) ? change.rationale.slice(cluster.length + 2) : change.rationale;
  const stat = change.diff ? diffStat(change.diff) : null;
  return (
    <article className={`change ${change.status}`}>
      <header className="change-head">
        <span className={`agentname ${change.agent}`}>{change.agent}</span>
        <span className={`stamp ${change.status}`}>{STAMP[change.status]}</span>
        <span className="dim small change-time">{new Date(change.created_at * 1000).toLocaleTimeString()}</span>
      </header>
      <h3 title={change.title}>{changeTitle(change)}</h3>
      {cluster && (
        <p className="cluster">
          <span className="dim">Pattern:</span> {cluster}
          {change.failure_ids.length > 0 && (
            <span className="dim">
              {" "}
              · from {change.failure_ids.length} failure{change.failure_ids.length > 1 ? "s" : ""}
            </span>
          )}
        </p>
      )}
      {rationale && <p className="rationale">{rationale}</p>}
      {typeof change.results?.error === "string" && <p className="error">{change.results.error}</p>}
      {change.results && <ABResult change={change} />}
      <div className="change-more">
        {change.diff && stat && (
          <button className="link" onClick={() => setShowDiff(!showDiff)}>
            {showDiff ? "Hide" : "Show"} skill diff <span className="add">+{stat.add}</span>{" "}
            <span className="del">−{stat.del}</span>
          </button>
        )}
        {change.agent === "creator" && (
          <button className="link" onClick={() => setShowClips(!showClips)}>
            {showClips ? "Hide" : "Show"} held-out clips
          </button>
        )}
        <code className="dim small">{change.branch}</code>
      </div>
      {showDiff && change.diff && <DiffView diff={change.diff} />}
      {showClips && <ABClips changeId={change.id} />}
    </article>
  );
}

export function Versions({ videos }: { videos: Video[] }) {
  const { data } = usePoll(api.versions, 3000);
  const showcase = usePoll(api.showcase, 6000);
  if (!data) return <p className="dim">Loading…</p>;
  const known: Record<string, number> = {};
  for (const v of showcase.data?.versions ?? []) if (v.change) known[v.version] = v.change.id;
  const changes = [...data.changes].sort((a, b) => b.created_at - a.created_at);
  const promoted = changes.filter((c) => c.status === "promoted").length;
  const rolledBack = changes.filter((c) => c.status === "rolled_back").length;
  return (
    <div className="versions">
      <div className="evo">
        <Progress videos={videos} changes={data.changes} current={data.current.creator} known={known} />
        <AuditorPanel />
      </div>

      <section>
        <div className="evo-title">
          <h2>What the Auditor changed</h2>
          {changes.length > 0 && (
            <span className="dim small">
              {changes.length} proposed · {promoted} promoted · {rolledBack} rolled back
            </span>
          )}
        </div>
        {changes.length === 0 ? (
          <div className="empty">
            No changes yet. When clips fail, run the Auditor: it proposes a change to an agent's skills and tests it
            here before adopting it.
          </div>
        ) : (
          <div className="changes">
            {changes.map((c) => (
              <ChangeCard key={c.id} change={c} />
            ))}
          </div>
        )}
      </section>

      <details className="history">
        <summary>
          <h2>Version history</h2>
          <span className="dim small">every commit to each agent's skills</span>
        </summary>
        <div className="timelines">
          {Object.entries(data.history).map(([agent, commits]) => (
            <div key={agent} className="timeline">
              <h3 className={`agentname ${agent}`}>{agent}</h3>
              <ol>
                {commits.map((c) => (
                  <li key={c.version}>
                    <code>{c.version.slice(0, 7)}</code> <span>{c.subject}</span>{" "}
                    <span className="dim small">{new Date(c.time * 1000).toLocaleTimeString()}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
