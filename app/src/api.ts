import { invoke } from "@tauri-apps/api/core";

// The engine URL comes from the Rust layer. Outside Tauri (plain `npm run dev`), use the default.
let engineUrl: Promise<string> | null = null;
export function getEngineUrl(): Promise<string> {
  engineUrl ??= invoke<string>("engine_url").catch(() => "http://127.0.0.1:8765");
  return engineUrl;
}

export type Footage = {
  file: string;
  title: string;
  speaker?: string;
  duration_s?: number;
  brief?: string;
};

export type Segment = { start: number; end: number };
export type EditPlan = {
  title: string;
  hook: string;
  segments: Segment[];
  rendered_segments?: Segment[]; // the cut points the renderer used, after snapping
  crop_x: number;
  caption_style: "karaoke" | "plain" | "none";
  caption_words: number;
  rationale: string;
};

export type Comment = { id: number; text: string; created_at: number };

export type VideoStatus = "queued" | "creating" | "reviewing" | "approved" | "rejected" | "failed";

export type Video = {
  id: number;
  footage: string;
  brief: string;
  status: VideoStatus;
  creator_version: string | null;
  reviewer_version: string | null;
  skills_ref: string | null;
  plan: EditPlan | null;
  review_approved: boolean | null;
  review_reason: string | null;
  human_liked: boolean | null;
  error: string | null;
  experiment_id: number | null;
  arm: "control" | "candidate" | null;
  review_tags?: string | string[] | null;
  showcase?: number | null;
  failed_agents: string[];
  comments: Comment[];
  created_at: number;
  updated_at: number;
};

export type Change = {
  id: number;
  agent: string;
  branch: string;
  title: string;
  rationale: string | null;
  diff: string | null;
  failure_ids: number[];
  status: "proposed" | "testing" | "promoted" | "rolled_back";
  results: Record<string, unknown> | null;
  created_at: number;
};

export type Versions = {
  current: Record<string, string>;
  history: Record<string, { version: string; time: number; subject: string }[]>;
  changes: Change[];
};

export type Failure = {
  video_id: number;
  agents: string[];
  brief: string;
  review_reason: string | null;
  human_liked: boolean | null;
  comments: string[];
  creator_version: string | null;
};

export type TranscriptWord = { word: string; start: number; end: number; kept: boolean; segment: number | null };
export type TranscriptSegment = { index: number; start: number; end: number; words: TranscriptWord[] };
export type TranscriptView = {
  title: string;
  hook: string;
  context_s: number;
  kept_s: number;
  reordered: boolean;
  segments: TranscriptSegment[];
};

export type AuditStatus = { state: "idle" | "clustering" | "proposing" | "testing" | "error"; detail: string };

export type ShowcaseVersion = {
  version: string;
  label: string;
  first_at: number;
  change: { id: number; title: string; rationale: string | null } | null;
};
export type ShowcaseRow = {
  footage: string;
  brief: string;
  title: string;
  speaker?: string | null;
  listed: boolean;
  cells: Record<string, Video>;
};
export type ShowcaseTable = { versions: ShowcaseVersion[]; rows: ShowcaseRow[]; current: string };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getEngineUrl();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<{ status: string; versions: Record<string, string> }>("/health"),
  footage: () => req<Footage[]>("/footage"),
  videos: (status?: string) => req<Video[]>(`/videos${status ? `?status=${status}` : ""}`),
  createJob: (footage: string, brief: string) =>
    req<{ id: number }>("/jobs", { method: "POST", body: JSON.stringify({ footage, brief }) }),
  feedback: (id: number, body: { liked?: boolean | null; comment?: string }) =>
    req<Video>(`/videos/${id}/feedback`, { method: "POST", body: JSON.stringify(body) }),
  review: (id: number, approved: boolean, reason: string) =>
    req<Video>(`/videos/${id}/review`, { method: "POST", body: JSON.stringify({ approved, reason }) }),
  versions: () => req<Versions>("/versions"),
  experimentVideos: (changeId: number) => req<Video[]>(`/videos?experiment_id=${changeId}`),
  failures: () => req<Failure[]>("/failures"),
  auditStatus: () => req<AuditStatus>("/audit"),
  runAudit: () => req<AuditStatus>("/audit", { method: "POST" }),
  showcase: () => req<ShowcaseTable>("/showcase"),
  renderShowcase: () => req<{ queued: number[] }>("/showcase", { method: "POST" }),
  transcript: (id: number) => req<TranscriptView>(`/videos/${id}/transcript`),
  videoUrl: async (id: number) => `${await getEngineUrl()}/videos/${id}/file`,
};
