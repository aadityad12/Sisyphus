import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleX,
  Code,
  Columns2,
  FlaskConical,
  GitBranch,
  GitMerge,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  TrendingUp,
  Undo2,
} from "lucide-react";
import "./Versions.css";
import { api, type AuditStatus, type Change, type Failure, type Video } from "./api";
import { Progress, changeTitle, passRows, rowPct } from "./Progress";
import { usePoll } from "./usePoll";
import { plural, samePrefix } from "./Loop";
import { StyleTags } from "./Styles";
import { Empty } from "./ui";

const STATUS: Record<Change["status"], { label: string; tone: string; icon: ReactNode }> = {
  proposed: { label: "Proposed", tone: "info", icon: <CircleDot size={13} /> },
  testing: { label: "A/B testing", tone: "warn", icon: <FlaskConical size={13} /> },
  promoted: { label: "Promoted", tone: "ok", icon: <GitMerge size={13} /> },
  rolled_back: { label: "Rolled back", tone: "err", icon: <Undo2 size={13} /> },
};

const clock = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString();

type DiffLine = { kind: "add" | "del" | "ctx" | "hunk" | "meta"; text: string; old?: number; new?: number };
type DiffFile = { path: string; index: string | null; lines: DiffLine[] };

/** Splits a unified diff into files, numbering each line from its hunk header. */
function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let o = 0;
  let n = 0;
  const lines = diff.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      const m = / b\/(.+)$/.exec(line);
      file = { path: m ? m[1] : line.slice(11), index: null, lines: [] };
      files.push(file);
      continue;
    }
    if (!file) {
      file = { path: "", index: null, lines: [] };
      files.push(file);
    }
    if (line.startsWith("index ") && file.lines.length === 0) {
      file.index = line.slice(6);
    } else if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      if (m) {
        o = Number(m[1]);
        n = Number(m[2]);
      }
      file.lines.push({ kind: "hunk", text: line });
    } else if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("\\")) {
      file.lines.push({ kind: "meta", text: line });
    } else if (line.startsWith("+")) {
      file.lines.push({ kind: "add", text: line, new: n++ });
    } else if (line.startsWith("-")) {
      file.lines.push({ kind: "del", text: line, old: o++ });
    } else {
      file.lines.push({ kind: "ctx", text: line, old: o++, new: n++ });
    }
  }
  return files;
}

function DiffView({ diff }: { diff: string }) {
  return (
    <div className="vz-diff">
      {parseDiff(diff).map((f, fi) => (
        <div key={fi} className="vz-diff-file">
          {(f.path || f.index) && (
            <div className="vz-diff-head">
              <Code size={13} />
              <span className="vz-diff-path">{f.path}</span>
              {f.index && <code className="vz-diff-index">{f.index}</code>}
            </div>
          )}
          <div className="vz-diff-body">
            <table>
              <tbody>
                {f.lines.map((l, i) => (
                  <tr key={i} className={l.kind}>
                    <td className="ln">{l.old ?? ""}</td>
                    <td className="ln">{l.new ?? ""}</td>
                    <td className="code">{l.text || " "}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
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
  const rate = (a: ArmResult) => (a.total ? (reviewerChange ? (a.agree ?? 0) : (a.approved ?? 0)) / a.total : null);
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
  const h2h = results.head_to_head !== undefined ? " on the head-to-head tiebreak" : "";
  if (change.status === "promoted")
    decision = `Promoted: the change won${h2h}${typeof results.merged === "string" ? ` and was merged as ${results.merged.slice(0, 7)}` : ""}.`;
  else if (change.status === "rolled_back")
    decision = h2h
      ? "Rolled back: tied on passes, and it did not win head to head."
      : "Rolled back: it did not beat the version without it.";
  else if (typeof results.waiting_for_votes === "string")
    decision = `Waiting for human votes: ${results.waiting_for_votes}.`;
  else if (pending) decision = `Testing: ${pending} held-out clip${pending > 1 ? "s" : ""} still to be judged.`;
  else if (!control.total && !candidate.total)
    decision = reviewerChange
      ? "Testing: re-reviewing clips humans voted on, with both versions of the Reviewer."
      : "Testing: rendering held-out clips with both versions.";
  else decision = "Testing.";

  const trend = d === null || d === 0 ? "flat" : d > 0 ? "up" : "down";
  const arm = (label: string, x: number | null, r: ArmResult, cls: string) => (
    <div className={`vz-arm ${cls}`}>
      <span className="vz-arm-label">{label}</span>
      <span className="vz-meter">
        <span style={{ width: `${x === null ? 0 : Math.max(x * 100, 1.5)}%` }} />
      </span>
      <strong className="vz-arm-pct">{pct(x)}</strong>
      <span className="vz-arm-count">
        {count(r)}/{r.total ?? 0} {metric}
      </span>
    </div>
  );

  return (
    <div className={`vz-ab ${change.status}`}>
      <div className="vz-ab-arms">
        {arm("Without the change", a, control, "control")}
        {arm("With the change", b, candidate, `candidate ${trend}`)}
      </div>
      <div className="vz-ab-side">
        <span className={`vz-delta ${trend}`}>
          {trend === "up" ? <ArrowUpRight size={14} /> : trend === "down" ? <ArrowDownRight size={14} /> : null}
          {d === null ? "–" : d === 0 ? "±0" : `${d > 0 ? "+" : ""}${d}`}
          <span className="unit">pts</span>
        </span>
      </div>
      <p className="vz-ab-decision">
        <span className="vz-ab-icon">{STATUS[change.status].icon}</span>
        <span>
          {decision}
          {humans && <span className="vz-ab-humans"> {humans}</span>}
        </span>
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
  if (!video) return <div className="vz-clip none" />;
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
    <div className={`vz-clip ${v}`}>
      {src ? <video src={src} controls preload="metadata" /> : <div className="placeholder busy">{video.status}</div>}
      <div className="vz-clip-meta">
        <span className={`pill ${v === "pass" ? "ok" : v === "fail" ? "err" : ""}`}>
          {v === "pass" ? <CircleCheck size={12} /> : v === "fail" ? <CircleX size={12} /> : null}
          {v === "pass" ? "Pass" : v === "fail" ? "Fail" : "Pending"}
        </span>
        {video.human_liked !== null && <span className="chip">human</span>}
        {video.plan && (
          <span className="vz-votes">
            <button
              className={video.human_liked === true ? "vote on up sm icon" : "vote ghost sm icon"}
              disabled={pending}
              onClick={() => vote(true)}
              title="Good clip"
            >
              <ThumbsUp size={13} />
            </button>
            <button
              className={video.human_liked === false ? "vote on down sm icon" : "vote ghost sm icon"}
              disabled={pending}
              onClick={() => vote(false)}
              title="Bad clip"
            >
              <ThumbsDown size={13} />
            </button>
          </span>
        )}
      </div>
      <StyleTags video={video} />
      {video.review_reason && <p className="vz-clip-reason">{video.review_reason}</p>}
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
    <div className="vz-clips">
      <div className="vz-clips-head">
        <span>Held-out brief</span>
        <span>Without the change</span>
        <span>With the change</span>
      </div>
      {[...rows.entries()].map(([key, row]) => (
        <div key={key} className="vz-clips-row">
          <p className="vz-brief">“{row.brief}”</p>
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

function AuditorPanel({ failures }: { failures: Failure[] | null | undefined }) {
  const status = usePoll(api.auditStatus, 2000);
  const [error, setError] = useState<string | null>(null);
  const creator = (failures ?? []).filter((f) => f.agents.includes("creator"));
  const reviewer = (failures ?? []).filter((f) => f.agents.includes("reviewer"));
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
    <section className={`card vz-auditor state-${state}`}>
      <div className="vz-auditor-head">
        <span className="vz-auditor-mark">
          <Sparkles size={14} />
        </span>
        <span className="agentname auditor">Auditor</span>
        <span className="vz-auditor-state">
          <span className="vz-state-dot" />
          {AUDIT_STATE[state]}
        </span>
      </div>
      {status.data?.detail && <p className="vz-auditor-detail">{status.data.detail}</p>}
      <div className="vz-failcounts">
        <div className="creator">
          <strong>{creator.length}</strong>
          <span>
            <span className="agentname creator">Creator</span> failures
          </span>
        </div>
        <div className="reviewer">
          <strong>{reviewer.length}</strong>
          <span>
            <span className="agentname reviewer">Reviewer</span> failures
          </span>
        </div>
      </div>
      <p className="vz-auditor-explain">
        A failure is a clip the Reviewer sent back, or one where a human's vote disagreed with the Reviewer. The Auditor
        groups them, writes one change to the skills, and A/B tests it on held-out work before adopting it.
      </p>
      <button className="primary" disabled={busy} onClick={run}>
        <Sparkles size={14} className={busy ? "spin" : undefined} />
        {busy ? `${AUDIT_STATE[state]}…` : "Run Auditor"}
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

type Pair = { footage: string; brief: string; winner: "control" | "candidate" | "same"; reason: string };

/** When pass counts tie, the frozen Reviewer compares each pair head to head (engine/compare.py). */
function HeadToHead({ results }: { results: Record<string, unknown> }) {
  const score = results.head_to_head as { candidate: number; control: number; same: number } | undefined;
  const pairs = (results.pairs ?? []) as Pair[];
  if (!score) return null;
  const label = { candidate: "With the change", control: "Without", same: "Same" } as const;
  return (
    <div className="vz-h2h">
      <div className="vz-h2h-head">
        <span>
          <strong>Pass counts tied</strong>, so the frozen Reviewer compared each pair head to head
        </span>
        <span className="vz-h2h-score">
          <span className="up">with {score.candidate}</span>
          <span className="sep">·</span>
          <span className="down">without {score.control}</span>
          {score.same > 0 && (
            <>
              <span className="sep">·</span>
              <span className="same">same {score.same}</span>
            </>
          )}
        </span>
      </div>
      {pairs.length > 0 && (
        <ul>
          {pairs.map((p) => (
            <li key={p.footage + p.brief}>
              <span className={`pill ${p.winner === "candidate" ? "ok" : p.winner === "control" ? "err" : ""}`}>
                {label[p.winner]}
              </span>
              <span>{p.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
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

/**
 * What a change targets (#13): the shared skills, one style's file, or a new style. Engines without styles
 * record neither field, and the card shows nothing extra.
 */
function ChangeScope({ change }: { change: Change }) {
  const kind = change.results?.kind;
  const style = typeof change.results?.style === "string" ? change.results.style : null;
  if (kind === "style" && style)
    return (
      <span className="vz-scope">
        style <span className="style-tag">{style}</span>
      </span>
    );
  if (kind === "new_style")
    return (
      <span className="vz-scope">
        new style
        {style && <span className="style-tag">{style}</span>}
      </span>
    );
  if (kind === "shared") return <span className="vz-scope">shared skills</span>;
  return null;
}

function ChangeCard({ change }: { change: Change }) {
  const [showDiff, setShowDiff] = useState(false);
  const [showClips, setShowClips] = useState(change.status === "testing");
  const cluster = typeof change.results?.cluster === "string" ? change.results.cluster : null;
  // The engine stores the rationale as "<cluster>: <why>"; the cluster is shown on its own line.
  const rationale =
    cluster && change.rationale?.startsWith(`${cluster}: `)
      ? change.rationale.slice(cluster.length + 2)
      : change.rationale;
  const stat = change.diff ? diffStat(change.diff) : null;
  const s = STATUS[change.status];
  return (
    <li className={`vz-change ${change.status}`}>
      <span className="vz-node" aria-hidden>
        {s.icon}
      </span>
      <article className="card vz-change-card">
        <header className="vz-change-head">
          <span className={`agentname ${change.agent}`}>{change.agent}</span>
          <span className={`pill ${s.tone} vz-status`}>
            <span className="dot" />
            {s.label}
          </span>
          <ChangeScope change={change} />
          <span className="grow" />
          <code className="vz-time">{clock(change.created_at)}</code>
        </header>
        <h3 title={change.title}>{changeTitle(change)}</h3>
        {cluster && (
          <p className="vz-pattern">
            <span className="vz-k">Pattern</span>
            <span>
              {cluster}
              {change.failure_ids.length > 0 && (
                <span className="vz-from"> · from {plural(change.failure_ids.length, "failure")}</span>
              )}
            </span>
          </p>
        )}
        {rationale && <p className="vz-rationale">{rationale}</p>}
        {typeof change.results?.error === "string" && <p className="error">{change.results.error}</p>}
        {change.results && <ABResult change={change} />}
        {change.results && <HeadToHead results={change.results} />}
        <div className="vz-change-foot">
          {change.diff && stat && (
            <button className={`ghost sm ${showDiff ? "on" : ""}`} onClick={() => setShowDiff(!showDiff)}>
              {showDiff ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Skill diff
              <span className="vz-stat">
                <span className="add">+{stat.add}</span>
                <span className="del">−{stat.del}</span>
              </span>
            </button>
          )}
          {change.agent === "creator" && (
            <button className={`ghost sm ${showClips ? "on" : ""}`} onClick={() => setShowClips(!showClips)}>
              <Columns2 size={13} />
              {showClips ? "Hide" : "Show"} held-out clips
            </button>
          )}
          <span className="grow" />
          <code className="vz-branch" title={change.branch}>
            <GitBranch size={12} />
            <span>{change.branch}</span>
          </code>
        </div>
        {showDiff && change.diff && <DiffView diff={change.diff} />}
        {showClips && <ABClips changeId={change.id} />}
      </article>
    </li>
  );
}

function Kpi({ icon, label, children, sub }: { icon: ReactNode; label: string; children: ReactNode; sub: ReactNode }) {
  return (
    <div className="vz-kpi">
      <span className="vz-kpi-label">
        {icon}
        {label}
      </span>
      <div className="vz-kpi-value">{children}</div>
      <span className="vz-kpi-sub">{sub}</span>
    </div>
  );
}

function PageTitle({ current }: { current?: Record<string, string> }) {
  return (
    <div className="page-title">
      <div>
        <h1>Versions</h1>
        <p>Is the Creator getting better? Each change the Auditor made, and the A/B test that decided it.</p>
      </div>
      <span className="grow" />
      {current && (
        <div className="vz-current" title="The version each agent runs now">
          {["creator", "reviewer", "auditor"]
            .filter((a) => current[a])
            .map((a) => (
              <span key={a} className={`vz-current-item ${a}`}>
                <span className="vz-current-dot" />
                <span className="agentname">{a}</span>
                <code>{current[a].slice(0, 7)}</code>
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

export function Versions({ videos }: { videos: Video[] }) {
  const { data } = usePoll(api.versions, 3000);
  const showcase = usePoll(api.showcase, 6000);
  const failures = usePoll(api.failures, 4000);
  if (!data)
    return (
      <div className="versions">
        <PageTitle />
        <div className="vz-kpis card vz-skeleton shimmer" />
        <div className="vz-evo">
          <div className="card vz-skeleton tall shimmer" />
          <div className="card vz-skeleton tall shimmer" />
        </div>
      </div>
    );
  const known: Record<string, number> = {};
  for (const v of showcase.data?.versions ?? []) if (v.change) known[v.version] = v.change.id;
  const changes = [...data.changes].sort((a, b) => b.created_at - a.created_at);
  const promoted = changes.filter((c) => c.status === "promoted").length;
  const rolledBack = changes.filter((c) => c.status === "rolled_back").length;
  const testing = changes.filter((c) => c.status === "testing" || c.status === "proposed").length;

  const rows = passRows(videos);
  const last = rows[rows.length - 1];
  const first = rows[0];
  const gain = rows.length > 1 ? rowPct(last) - rowPct(first) : null;
  const fails = failures.data ?? [];
  const creatorFails = fails.filter((f) => f.agents.includes("creator")).length;
  const reviewerFails = fails.filter((f) => f.agents.includes("reviewer")).length;

  return (
    <div className="versions">
      <PageTitle current={data.current} />

      <div className="card vz-kpis">
        <Kpi
          icon={<TrendingUp size={13} />}
          label="Creator pass rate"
          sub={
            last ? (
              <>
                <code>v{rows.length - 1}</code> · {last.passed}/{last.total} clips
                {gain !== null && <> · was {rowPct(first)}% at v0</>}
              </>
            ) : (
              "no verdicts yet"
            )
          }
        >
          <strong>{last ? `${rowPct(last)}%` : "–"}</strong>
          {gain !== null && gain !== 0 && (
            <span className={`vz-dpill ${gain > 0 ? "up" : "down"}`}>
              {gain > 0 ? "+" : ""}
              {gain} pts
            </span>
          )}
        </Kpi>
        <Kpi
          icon={<GitBranch size={13} />}
          label="Changes"
          sub={testing > 0 ? `${testing} in progress` : "none in progress"}
        >
          <strong>{changes.length}</strong>
        </Kpi>
        <Kpi
          icon={<TriangleAlert size={13} />}
          label="Failures to learn from"
          sub={
            failures.data ? (
              <>
                <span className="agentname creator">Creator</span> {creatorFails} ·{" "}
                <span className="agentname reviewer">Reviewer</span> {reviewerFails}
              </>
            ) : (
              "loading…"
            )
          }
        >
          <strong>{failures.data ? fails.length : "–"}</strong>
        </Kpi>
      </div>

      <div className="vz-evo">
        <Progress videos={videos} changes={data.changes} current={data.current.creator} known={known} />
        <AuditorPanel failures={failures.data} />
      </div>

      <section>
        <div className="section-head">
          <h2>What the Auditor changed</h2>
          {changes.length > 0 && (
            <span className="sub">
              {plural(changes.length, "change")} · {promoted} promoted · {rolledBack} rolled back
              {testing > 0 && ` · ${testing} in progress`}
            </span>
          )}
        </div>
        {changes.length === 0 ? (
          <Empty icon={<GitBranch size={18} />} title="No changes yet">
            When clips fail, run the Auditor: it proposes a change to an agent's skills and tests it here before
            adopting it.
          </Empty>
        ) : (
          <ol className="vz-changes">
            {changes.map((c) => (
              <ChangeCard key={c.id} change={c} />
            ))}
          </ol>
        )}
      </section>

      <details className="vz-history">
        <summary>
          <ChevronRight size={15} className="vz-chev" />
          <h2>Version history</h2>
          <span className="sub">every commit to each agent's skills</span>
        </summary>
        <div className="vz-timelines">
          {Object.entries(data.history).map(([agent, commits]) => (
            <div key={agent} className={`card vz-timeline ${agent}`}>
              <div className="vz-timeline-head">
                <h3 className={`agentname ${agent}`}>{agent}</h3>
                <span className="count">{commits.length}</span>
              </div>
              <ol>
                {commits.map((c) => (
                  <li key={c.version}>
                    <code className="vz-hash">{c.version.slice(0, 7)}</code>
                    <span className="vz-subject" title={c.subject}>
                      {c.subject}
                    </span>
                    {data.current[agent] && samePrefix(c.version, data.current[agent]) && (
                      <span className="vz-now">current</span>
                    )}
                    <code className="vz-ctime">{clock(c.time)}</code>
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
