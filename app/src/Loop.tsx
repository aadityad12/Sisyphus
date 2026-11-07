import type { AuditStatus, Video } from "./api";

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
  return { first: pct(first), last: pct(last), versions: ordered.length, clips: last.total };
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
  onClick,
}: {
  agent: "creator" | "reviewer" | "auditor";
  version?: string;
  activity: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`loop-node ${agent} ${active ? "active" : ""}`} onClick={onClick} title={`Go to ${agent}`}>
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
  go: (tab: "Studio" | "Feed" | "Versions") => void;
}) {
  // Every clip counts here, A/B and showcase included: the agents are busy with those too.
  const creating = videos.filter((v) => v.status === "creating").length;
  const queued = videos.filter((v) => v.status === "queued").length;
  const reviewing = videos.filter((v) => v.status === "reviewing").length;
  const judged = videos.filter((v) => v.status === "approved" || v.status === "rejected").length;
  const state = audit?.state ?? "idle";

  const creatorActivity = creating
    ? `editing ${creating} clip${creating > 1 ? "s" : ""}${queued ? `, ${queued} queued` : ""}`
    : queued
      ? `${queued} queued`
      : "idle";
  const reviewerActivity = reviewing
    ? `watching ${reviewing} clip${reviewing > 1 ? "s" : ""}`
    : judged
      ? `${judged} verdict${judged > 1 ? "s" : ""} given`
      : "idle";

  return (
    <div className="loop" aria-label="The agents">
      <Node
        agent="creator"
        version={versions?.creator}
        activity={creatorActivity}
        active={creating + queued > 0}
        onClick={() => go("Studio")}
      />
      <span className="loop-arrow" aria-hidden>
        →
      </span>
      <Node
        agent="reviewer"
        version={versions?.reviewer}
        activity={reviewerActivity}
        active={reviewing > 0}
        onClick={() => go("Feed")}
      />
      <span className="loop-arrow" aria-hidden>
        →
      </span>
      <Node
        agent="auditor"
        version={versions?.auditor}
        activity={state === "error" ? `error: ${audit?.detail ?? ""}` : AUDIT_LABEL[state]}
        active={state !== "idle" && state !== "error"}
        onClick={() => go("Versions")}
      />
      <span className="loop-back" aria-hidden title="The Auditor rewrites the Creator's and the Reviewer's skills">
        ↺ rewrites skills
      </span>
    </div>
  );
}
