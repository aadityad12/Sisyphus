import { invoke } from "@tauri-apps/api/core";

// The engine URL comes from the Rust layer. Outside Tauri (plain `npm run dev`), VITE_ENGINE_URL if set, else the
// default port.
let engineUrl: Promise<string> | null = null;
export function getEngineUrl(): Promise<string> {
  engineUrl ??= invoke<string>("engine_url").catch(
    () => (import.meta.env.VITE_ENGINE_URL as string | undefined) ?? "http://127.0.0.1:8765",
  );
  return engineUrl;
}

/**
 * The project the app is showing (#14). Footage, jobs, videos and the Showcase belong to a project; skills,
 * versions, styles and the Auditor are shared by all of them. An engine without projects ignores the parameter.
 */
const PROJECT_KEY = "sisyphus.project";
let project = "default";
try {
  project = localStorage.getItem(PROJECT_KEY) || "default";
} catch {
  // storage blocked: start on the default project
}
export function currentProject() {
  return project;
}
export function setCurrentProject(id: string) {
  project = id;
  try {
    localStorage.setItem(PROJECT_KEY, id);
  } catch {
    // not remembered across reloads, which is fine
  }
}
const inProject = (path: string) => `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(project)}`;

export type Project = {
  id: string;
  name: string;
  created_at: number;
  videos: number;
  footage: number;
  footage_dir: string;
};

export type Footage = {
  file: string;
  title: string;
  speaker?: string;
  duration_s?: number;
  brief?: string;
};

export type Segment = { start: number; end: number; punch?: number };
export type EditPlan = {
  title: string;
  hook: string;
  segments: Segment[];
  rendered_segments?: Segment[]; // the cut points the renderer used, after snapping
  crop_x: number;
  caption_style: "karaoke" | "plain" | "none";
  caption_words: number;
  // The look (#13); absent on plans from before the render knobs.
  layout?: "crop" | "fit" | "split";
  caption_size?: "small" | "medium" | "large" | "huge";
  caption_color?: string;
  caption_position?: "lower" | "middle" | "upper";
  caption_caps?: boolean;
  color_filter?: "none" | "warm" | "cool" | "bw" | "film" | "vivid";
  speed?: number;
  rationale: string;
  styles?: string[]; // the editing styles the Creator applied (#13)
};

export type Comment = { id: number; text: string; created_at: number };

export type VideoStatus = "queued" | "creating" | "reviewing" | "approved" | "rejected" | "failed";

export type Video = {
  id: number;
  footage: string;
  brief: string;
  status: VideoStatus;
  project?: string; // #14; absent on an engine without projects
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
  // A rejected clip goes back to the Creator: `revised_by` is the new attempt's id, `revision_of` the clip it
  // revises, `attempt` counts from 1. Absent on an engine without revisions.
  revision_of?: number | null;
  revised_by?: number | null;
  attempt?: number;
  failed_agents: string[];
  // Editing styles (#13): `styles` is what the Creator used (the video's tags), `styles_requested` what the
  // Studio asked for; empty means Auto, so the Creator picked. Absent on an engine without styles.
  styles?: string[];
  styles_requested?: string[];
  comments: Comment[];
  created_at: number;
  updated_at: number;
};

/** An editing style: two skill files, one telling the Creator how to edit, one telling the Reviewer what good looks like. */
export type Style = {
  name: string; // slug, [a-z0-9-]+
  title: string;
  summary: string;
  creator: string; // skills/creator/styles/<name>.md
  reviewer: string | null; // skills/reviewer/styles/<name>.md
};

export type NewStyle = { name: string; how_to_edit: string; what_good_looks_like: string };

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

/**
 * FastAPI errors are {"detail": "..."} (409 for a style name clash, 422 for a bad name, empty text or an unknown
 * style), or for validation errors a list of {msg}. Show the message, not the JSON.
 */
function errorDetail(body: string): string {
  try {
    const d = (JSON.parse(body) as { detail?: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d))
      return d.map((e) => (e && typeof e === "object" && "msg" in e ? String(e.msg) : "")).join("; ");
  } catch {
    // not JSON: show it as it came
  }
  return body;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getEngineUrl();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${errorDetail(await res.text())}`);
  return res.json() as Promise<T>;
}

/** Engine-wide settings (#35): how many jobs run at once, its ceiling, and how many are running now. */
export type Settings = { workers: number; max_workers: number; running: number };

export const api = {
  settings: () => req<Settings>("/settings"),
  setWorkers: (workers: number) =>
    req<Settings>("/settings", { method: "PATCH", body: JSON.stringify({ workers }) }),
  health: () => req<{ status: string; versions: Record<string, string> }>("/health"),
  projects: () => req<Project[]>("/projects"),
  createProject: (name: string) => req<Project>("/projects", { method: "POST", body: JSON.stringify({ name }) }),
  renameProject: (id: string, name: string) =>
    req<Project>(`/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteProject: (id: string) => req<{ deleted: string }>(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
  footage: () => req<Footage[]>(inProject("/footage")),
  footageUrl: async (file: string) => `${await getEngineUrl()}${inProject(`/footage/${encodeURIComponent(file)}/file`)}`,
  videos: (status?: string) => req<Video[]>(inProject(`/videos${status ? `?status=${status}` : ""}`)),
  // Every project's clips: the agents' activity and the shared learning (versions, styles) span projects. An engine
  // without projects ignores the parameter and answers with every clip anyway.
  allVideos: () => req<Video[]>("/videos?project=*"),
  // No styles (or none picked) means Auto: the Creator picks from the library.
  createJob: (footage: string, brief: string, styles: string[] = []) =>
    req<{ id: number }>("/jobs", {
      method: "POST",
      body: JSON.stringify(
        styles.length ? { footage, brief, styles, project } : { footage, brief, project },
      ),
    }),
  styles: () => req<Style[]>("/styles"),
  // Answers with the new style, shaped like a GET /styles item.
  createStyle: (body: NewStyle) => req<Style>("/styles", { method: "POST", body: JSON.stringify(body) }),
  feedback: (id: number, body: { liked?: boolean | null; comment?: string }) =>
    req<Video>(`/videos/${id}/feedback`, { method: "POST", body: JSON.stringify(body) }),
  review: (id: number, approved: boolean, reason: string) =>
    req<Video>(`/videos/${id}/review`, { method: "POST", body: JSON.stringify({ approved, reason }) }),
  versions: () => req<Versions>("/versions"),
  experimentVideos: (changeId: number) => req<Video[]>(`/videos?experiment_id=${changeId}`),
  failures: () => req<Failure[]>("/failures"),
  auditStatus: () => req<AuditStatus>("/audit"),
  runAudit: () => req<AuditStatus>("/audit", { method: "POST" }),
  showcase: () => req<ShowcaseTable>(inProject("/showcase")),
  renderShowcase: () => req<{ queued: number[] }>(inProject("/showcase"), { method: "POST" }),
  transcript: (id: number) => req<TranscriptView>(`/videos/${id}/transcript`),
  videoUrl: async (id: number) => `${await getEngineUrl()}/videos/${id}/file`,
};
