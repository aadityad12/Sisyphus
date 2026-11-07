import { RefreshCcw } from "lucide-react";
import type { AuditStatus, Video } from "./api";

/** Two commit hashes name the same commit when the shorter is a prefix of the longer (7+ characters). */
export const samePrefix = (a: string, b: string) => {
  const n = Math.min(a.length, b.length);
  return n >= 7 && a.slice(0, n) === b.slice(0, n);
};

type Verdicted = { version: string; passed: number; total: number; first: number };

/** Pass rate (human vote, else Reviewer) of the first and the latest Creator version on regular work. */
export function passRates(videos: Video[]) {
  const rows = new Map<string, Verdicted>();
  for (const v of videos) {
    if (v.experiment_id !== null || v.showcase || !v.creator_version) continue;
    const ok = v.human_liked ?? v.review_approved;
    if (ok === null) continue;
    const r = rows.get(v.creator_version) ?? { version: v.creator_version, passed: 0, total: 0, first: v.created_at };
    r.total += 1;
    r.passed += ok ? 1 : 0;
    r.first = Math.min(r.first, v.created_at);
    rows.set(v.creator_version, r);
  }
  const ordered = [...rows.values()].sort((a, b) => a.first - b.first);
  const pct = (r: Verdicted) => Math.round((100 * r.passed) / r.total);
  if (ordered.length === 0) return null;
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  return {
    first: pct(first),
    last: pct(last),
    versions: ordered.length,
    passed: last.passed,
    clips: last.total,
    lastVersion: last.version,
    series: ordered.map(pct),
  };
}

const AUDIT_LABEL: Record<AuditStatus["state"], string> = {
  idle: "watching for failures",
  clustering: "grouping failures",
  proposing: "writing a change",
  testing: "A/B testing a change",
  error: "error",
};

function Node({
  agent,
  version,
  activity,
  active,
  warn = false,
  onClick,
}: {
  agent: "creator" | "reviewer" | "auditor";
  version?: string;
  activity: string;
  active: boolean;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`loop-node ${agent} ${active ? "active" : ""} ${warn ? "warn" : ""}`}
      onClick={onClick}
      title={`${agent[0].toUpperCase() + agent.slice(1)}: ${activity}`}
    >
      <span className="loop-dot" />
      <span className="loop-text">
        <span className="loop-name">
          {agent[0].toUpperCase() + agent.slice(1)}
          {version && <code>{version.slice(0, 7)}</code>}
        </span>
        <span className="loop-activity">{activity}</span>
      </span>
    </button>
  );
}

type Tab = "Studio" | "Feed" | "Versions" | "Showcase";
type Pool = "regular" | "ab" | "showcase";

const poolOf = (v: Video): Pool => (v.experiment_id !== null ? "ab" : v.showcase ? "showcase" : "regular");
const POOL_TAB: Record<Pool, Tab> = { regular: "Studio", ab: "Versions", showcase: "Showcase" };
const POOL_WORD: Record<Pool, string> = { regular: "", ab: "A/B ", showcase: "showcase " };
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Where most of the work in `videos` lives, so clicking an agent opens the tab that shows it. */
function busiest(videos: Video[]): Pool | null {
  const n: Record<Pool, number> = { regular: 0, ab: 0, showcase: 0 };
  for (const v of videos) n[poolOf(v)] += 1;
  const top = (Object.keys(n) as Pool[]).sort((a, b) => n[b] - n[a])[0];
  return n[top] ? top : null;
}

/** "editing 3 clips" when all regular work, else names the kind: "editing 2 A/B clips". */
function describe(verb: string, videos: Video[]): string {
  const pool = busiest(videos);
  const mixed = new Set(videos.map(poolOf)).size > 1;
  return `${verb} ${plural(videos.length, `${mixed || !pool ? "" : POOL_WORD[pool]}clip`)}`;
}

/**
 * The three agents and what each is doing right now, with the arrow back from the Auditor to the
 * Creator: the whole system in one strip, so the loop reads before anyone opens a tab.
 */
export function Loop({
  videos,
  versions,
  audit,
  go,
}: {
  videos: Video[];
  versions: Record<string, string> | undefined;
  audit: AuditStatus | null;
  go: (tab: Tab) => void;
}) {
  // Every clip counts here, A/B and showcase included: the agents are busy with those too.
  const creating = videos.filter((v) => v.status === "creating");
  const queued = videos.filter((v) => v.status === "queued");
  // A Reviewer error leaves a clip in "reviewing" with an error set: stuck, not being watched.
  const reviewing = videos.filter((v) => v.status === "reviewing" && !v.error);
  const stuck = videos.filter((v) => v.status === "reviewing" && v.error);
  // Verdicts on regular clips match what Feed + Rejected show; A/B and showcase verdicts are counted apart.
  const done = videos.filter((v) => v.status === "approved" || v.status === "rejected");
  const judged = done.filter((v) => poolOf(v) === "regular").length;
  const judgedElsewhere = done.length - judged;
  const state = audit?.state ?? "idle";

  const creatorActivity = creating.length
    ? `${describe("editing", creating)}${queued.length ? `, ${queued.length} queued` : ""}`
    : queued.length
      ? `${queued.length} queued`
      : "idle";
  const reviewerActivity = reviewing.length
    ? describe("watching", reviewing)
    : stuck.length
      ? `${plural(stuck.length, "clip")} need${stuck.length === 1 ? "s" : ""} a verdict`
      : done.length
        ? `${plural(judged, "verdict")}${judgedElsewhere ? ` · ${judgedElsewhere} on tests` : ""}`
        : "idle";
  const creatorPool = busiest([...creating, ...queued]);
  const reviewerPool = busiest(reviewing.length ? reviewing : stuck);

  return (
    <section className="agents" aria-label="The agents">
      <div className="agents-head">
        <span>Agents</span>
        <span className="loopback" title="The Auditor rewrites the Creator's and the Reviewer's skills">
          <RefreshCcw size={11} /> self-improving
        </span>
      </div>
      <div className="loop">
        <Node
          agent="creator"
          version={versions?.creator}
          activity={creatorActivity}
          active={creating.length + queued.length > 0}
          onClick={() => go(creatorPool ? POOL_TAB[creatorPool] : "Studio")}
        />
        <Node
          agent="reviewer"
          version={versions?.reviewer}
          activity={reviewerActivity}
          active={reviewing.length > 0}
          warn={!reviewing.length && stuck.length > 0}
          onClick={() => go(reviewerPool ? POOL_TAB[reviewerPool] : "Feed")}
        />
        <Node
          agent="auditor"
          version={versions?.auditor}
          activity={state === "error" ? `error: ${audit?.detail ?? ""}` : AUDIT_LABEL[state]}
          active={state !== "idle" && state !== "error"}
          warn={state === "error"}
          onClick={() => go("Versions")}
        />
      </div>
    </section>
  );
}
