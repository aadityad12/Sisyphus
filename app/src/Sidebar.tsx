import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, Copy, FolderOpen, Monitor, Moon, Plus, Search, Settings2, Sun, Trash2 } from "lucide-react";
import { api, type AuditStatus, type Project, type Video } from "./api";
import { Loop } from "./Loop";
import { Keys, MOD, ProjectChip, toast } from "./ui";
import markWhite from "./assets/brand-mark-white.png";
import markBlack from "./assets/brand-mark-black.png";
import { Wordmark } from "./Wordmark";
import { NEXT, useTheme, type ThemeChoice } from "./theme";

export type NavItem = {
  id: string;
  label: string;
  icon: ReactNode;
  keys: string[];
  count?: number | null;
  hot?: boolean;
};

export type Engine = "online" | "starting" | "lost" | "down";

/** The project switcher: every project, a new one, and the current one's settings. */
function ProjectMenu({
  projects,
  current,
  onSwitch,
  onNew,
  onSettings,
  close,
}: {
  projects: Project[];
  current: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    // The click that opened the menu is still bubbling; listen from the next tick.
    const t = setTimeout(() => window.addEventListener("mousedown", away));
    window.addEventListener("keydown", esc);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [close]);
  return (
    <div className="popover" ref={ref} style={{ top: 52, left: 10, width: 260 }} role="menu">
      <div className="menu-label">Projects</div>
      {projects.map((p) => (
        <button
          key={p.id}
          className="menu-item"
          role="menuitemradio"
          aria-checked={p.id === current}
          onClick={() => {
            onSwitch(p.id);
            close();
          }}
        >
          <ProjectChip id={p.id} name={p.name} />
          <span className="label">{p.name}</span>
          <span className="meta">{p.videos}</span>
          {p.id === current ? <Check size={14} /> : <span style={{ width: 14 }} />}
        </button>
      ))}
      <div className="menu-sep" />
      <button
        className="menu-item"
        onClick={() => {
          close();
          onNew();
        }}
      >
        <Plus size={15} />
        <span className="label">New project…</span>
      </button>
      <button
        className="menu-item"
        onClick={() => {
          close();
          onSettings();
        }}
      >
        <Settings2 size={15} />
        <span className="label">Project settings…</span>
      </button>
    </div>
  );
}

export type ProjectDialogMode = { kind: "create" } | { kind: "settings"; project: Project };

/** Create a project, or rename / delete one and find its footage folder. */
export function ProjectDialog({
  mode,
  close,
  onCreated,
  onChanged,
  onDeleted,
}: {
  mode: ProjectDialogMode;
  close: () => void;
  onCreated: (p: Project) => void;
  onChanged: () => void;
  onDeleted: (id: string) => void;
}) {
  const editing = mode.kind === "settings" ? mode.project : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [close]);

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        if (name.trim() !== editing.name) await api.renameProject(editing.id, name.trim());
        onChanged();
        close();
      } else {
        // The parent shows the new project's settings next, with its footage folder.
        onCreated(await api.createProject(name.trim()));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteProject(editing.id);
      onDeleted(editing.id);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={editing ? "Project settings" : "New project"}>
        <div className="dialog-body">
          <h2>{editing ? "Project settings" : "New project"}</h2>
          <p>
            {editing
              ? "A project holds its own footage and the clips made from it. Skills, styles and versions are shared by every project, so what the Auditor learns carries over."
              : "Keep a body of work apart: one per event, client or series. It starts from the current shared skills."}
          </p>
          <label>
            Name
            <input
              autoFocus
              value={name}
              placeholder="e.g. Founder interviews"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </label>
          {editing && (
            <label>
              Footage folder
              <div className="pathbox">
                <FolderOpen size={14} className="dim" />
                <code title={editing.footage_dir}>{editing.footage_dir}</code>
                <button
                  className="ghost icon sm"
                  title="Copy the path"
                  onClick={() =>
                    navigator.clipboard.writeText(editing.footage_dir).then(
                      () => toast("Path copied"),
                      () => toast("Couldn't copy the path", "err"),
                    )
                  }
                >
                  <Copy size={13} />
                </button>
              </div>
              <span className="dim small" style={{ fontWeight: 400 }}>
                {editing.footage} video{editing.footage === 1 ? "" : "s"} · {editing.videos} clip
                {editing.videos === 1 ? "" : "s"}. Drop .mp4 files here; list them in its manifest.json for a speaker and
                a default brief.
              </span>
            </label>
          )}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="dialog-foot">
          {editing && editing.id !== "default" && (
            <button
              className={confirming ? "danger sm" : "ghost danger sm"}
              disabled={busy}
              onClick={() => (confirming ? remove() : setConfirming(true))}
              title={editing.videos ? "A project with clips can't be deleted" : "Delete this project"}
            >
              <Trash2 size={13} />
              {confirming ? "Click again to delete" : "Delete"}
            </button>
          )}
          <span className="grow" />
          <button className="ghost" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={!name.trim() || busy} onClick={save}>
            {editing ? "Save" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  nav,
  active,
  go,
  projects,
  project,
  switchProject,
  openDialog,
  openPalette,
  videos,
  versions,
  audit,
  engine,
}: {
  nav: { label: string; items: NavItem[] }[];
  active: string;
  go: (id: string) => void;
  projects: Project[] | null;
  project: Project;
  switchProject: (id: string) => void;
  openDialog: (m: ProjectDialogMode) => void;
  openPalette: () => void;
  videos: Video[];
  versions: Record<string, string> | undefined;
  audit: AuditStatus | null;
  engine: Engine;
}) {
  const [menu, setMenu] = useState(false);
  const canSwitch = projects !== null;
  return (
    <aside className="sidebar">
      {/* The brand: the mark (white on dark, black on light) and the wordmark, from brand/logo. */}
      <div className="brand">
        <img className="brand-mark on-dark" src={markWhite} alt="" />
        <img className="brand-mark on-light" src={markBlack} alt="" />
        <Wordmark className="brand-word" height={19} />
      </div>

      <div style={{ position: "relative" }}>
        <button
          className="workspace"
          aria-haspopup="menu"
          aria-expanded={menu}
          disabled={!canSwitch}
          title={canSwitch ? "Switch project" : "This engine has no projects"}
          onClick={() => setMenu(!menu)}
        >
          <ProjectChip id={project.id} name={project.name} size={28} />
          <span className="workspace-text">
            <span className="workspace-name">{project.name}</span>
          </span>
          {canSwitch && <ChevronsUpDown size={14} />}
        </button>
        {menu && projects && (
          <ProjectMenu
            projects={projects}
            current={project.id}
            onSwitch={switchProject}
            onNew={() => openDialog({ kind: "create" })}
            onSettings={() => openDialog({ kind: "settings", project })}
            close={() => setMenu(false)}
          />
        )}
      </div>

      <button className="search-btn" onClick={openPalette}>
        <Search size={14} />
        <span>Search…</span>
        <Keys keys={[MOD, "K"]} />
      </button>

      {nav.map((g) => (
        <nav key={g.label} className="nav-group" aria-label={g.label}>
          <div className="nav-label">{g.label}</div>
          {g.items.map((it) => (
            <button
              key={it.id}
              className={`nav-item ${active === it.id ? "active" : ""}`}
              aria-current={active === it.id ? "page" : undefined}
              onClick={() => go(it.id)}
            >
              {it.icon}
              <span className="label">{it.label}</span>
              {it.count ? <span className={`count ${it.hot ? "hot" : ""}`}>{it.count}</span> : null}
              <Keys keys={it.keys} />
            </button>
          ))}
        </nav>
      ))}

      <div className="spacer" />

      <Loop videos={videos} project={project.id} versions={versions} audit={audit} go={go} />

      <div className="sidebar-foot">
        <div className={`engine ${engine}`} title={`Engine ${engine}`}>
          <span className="engine-dot" />
          <span>
            {engine === "online"
              ? "Engine online"
              : engine === "starting"
                ? "Starting engine…"
                : engine === "lost"
                  ? "Engine not answering"
                  : "Engine offline"}
          </span>
        </div>
        <ThemeButton />
      </div>
    </aside>
  );
}

const THEME_LABEL: Record<ThemeChoice, string> = { system: "System theme", light: "Light theme", dark: "Dark theme" };

/** One button that steps System → Light → Dark. The icon shows the current choice. */
function ThemeButton() {
  const [theme, setTheme] = useTheme();
  const next = NEXT[theme];
  return (
    <button
      className="icon theme-btn"
      onClick={() => setTheme(next)}
      aria-label={`${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next].toLowerCase()}`}
      title={`${THEME_LABEL[theme]} (click for ${THEME_LABEL[next].toLowerCase()})`}
    >
      {theme === "light" ? <Sun size={15} /> : theme === "dark" ? <Moon size={15} /> : <Monitor size={15} />}
    </button>
  );
}
