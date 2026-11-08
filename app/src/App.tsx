import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  Clapperboard,
  Columns2,
  FlaskConical,
  FolderPlus,
  GitBranch,
  Palette,
  Plus,
  Settings2,
  Undo2,
} from "lucide-react";
import "./App.css";
import { api, currentProject, setCurrentProject, type Project } from "./api";
import { Studio } from "./Studio";
import { Feed } from "./Feed";
import { Versions } from "./Versions";
import { Showcase } from "./Showcase";
import { StylesTab } from "./Styles";
import { usePoll } from "./usePoll";
import { Sidebar, ProjectDialog, type Engine, type NavItem, type ProjectDialogMode } from "./Sidebar";
import { CommandPalette, type Command } from "./CommandPalette";
import { ProjectChip, Toasts, toast } from "./ui";

const TABS = ["Studio", "Feed", "Rejected", "Styles", "Versions", "Showcase"] as const;
type Tab = (typeof TABS)[number];

const TAB_HINT: Record<Tab, string> = {
  Studio: "Start a clip and watch it move through the agents",
  Feed: "Clips the Reviewer approved",
  Rejected: "Clips the Reviewer sent back",
  Styles: "What each style asks of the Creator and the Reviewer, and how its clips do",
  Versions: "The Auditor's changes and their A/B tests",
  Showcase: "The same briefs, re-edited by every Creator version",
};

const ICON: Record<Tab, (size: number) => React.ReactNode> = {
  Studio: (s) => <Clapperboard size={s} />,
  Feed: (s) => <CircleCheck size={s} />,
  Rejected: (s) => <Undo2 size={s} />,
  Showcase: (s) => <Columns2 size={s} />,
  Versions: (s) => <GitBranch size={s} />,
  Styles: (s) => <Palette size={s} />,
};

/** Linear-style "G then S" chords: the second key of each page's shortcut. */
const CHORD: Record<Tab, string> = { Studio: "S", Feed: "F", Rejected: "R", Showcase: "C", Versions: "V", Styles: "Y" };

const DEFAULT_PROJECT: Project = { id: "default", name: "Default", created_at: 0, videos: 0, footage: 0, footage_dir: "" };

/** Typing in a field must not trigger single-key shortcuts. */
function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

function App() {
  // The tab lives in the URL hash, so a reload (or the dev server's) keeps you where you were.
  const fromHash = () => TABS.find((t) => `#${t.toLowerCase()}` === window.location.hash) ?? "Studio";
  const [tab, setTabState] = useState<Tab>(fromHash);
  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, "", `#${t.toLowerCase()}`);
  }, []);
  useEffect(() => {
    const onHash = () => setTabState(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const [palette, setPalette] = useState(false);
  const [dialog, setDialog] = useState<ProjectDialogMode | null>(null);

  // Projects (#14). An engine without them answers 404: then there is one implicit project and no switcher.
  const [projectId, setProjectId] = useState(currentProject);
  const projectsPoll = usePoll(api.projects, 8000);
  // Projects made in this session stay listed until a poll includes them: a poll that left before the create can
  // land after it, and would otherwise bounce the app back to the first project.
  const [made, setMade] = useState<Project[]>([]);
  const projects = projectsPoll.data
    ? [...projectsPoll.data, ...made.filter((m) => !projectsPoll.data!.some((p) => p.id === m.id))]
    : null;
  const project = projects?.find((p) => p.id === projectId) ?? projects?.[0] ?? DEFAULT_PROJECT;

  const [openedAt] = useState(Date.now);
  // A poll that keeps failing with the same error doesn't re-render, so wake once when "starting" ends.
  const [, setWoken] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWoken(true), 20_500);
    return () => clearTimeout(t);
  }, []);
  const health = usePoll(api.health, 3000);
  // One poll of every project's clips; each view filters what it shows.
  const videos = usePoll(api.allVideos, 2000);
  const audit = usePoll(api.auditStatus, 2000);

  const switchProject = useCallback(
    (id: string) => {
      setCurrentProject(id);
      setProjectId(id);
      videos.refresh();
    },
    [videos],
  );
  // A remembered project that was deleted elsewhere falls back to the first one.
  useEffect(() => {
    if (projects && !projects.some((p) => p.id === projectId) && projects[0]) switchProject(projects[0].id);
  }, [projects, projectId, switchProject]);

  // Every clip, A/B and showcase included: the agents are busy with all of them, in every project.
  const every = videos.data ?? [];
  // A/B clips and showcase renders are not regular work: they stay out of Studio, Feed, Rejected and the pass rates.
  const regular = every.filter((v) => v.experiment_id === null && !v.showcase);
  // Skills are shared, so a Creator version's pass rate (Versions, Styles) counts every project's clips.
  // The work views show only this project's; an engine without projects sends no `project`, which is the default.
  const all = regular.filter((v) => (v.project ?? "default") === project.id);
  // A revision is a retry of a brief that already failed, with the Reviewer's reasons in hand, so pass rates
  // (Versions, Styles) count first attempts only: otherwise retries of hard briefs weigh on a version.
  const measured = regular.filter((v) => (v.attempt ?? 1) === 1);

  const approved = all.filter((v) => v.status === "approved");
  const rejected = all.filter((v) => v.status === "rejected");
  const inFlight = all.filter((v) => ["queued", "creating", "reviewing"].includes(v.status)).length;

  // Before the first answer the engine may still be starting (the desktop app launches it).
  const engine: Engine = health.data
    ? health.error
      ? "lost"
      : "online"
    : health.error && Date.now() - openedAt > 20_000
      ? "down"
      : "starting";

  const item = (t: Tab, label: string, count?: number | null, hot?: boolean): NavItem => ({
    id: t,
    label,
    icon: ICON[t](15),
    keys: ["G", CHORD[t]],
    count,
    hot,
  });
  const nav = [
    {
      label: "Project",
      items: [
        item("Studio", "Studio", inFlight || null, inFlight > 0),
        item("Feed", "Feed", approved.length || null),
        item("Rejected", "Rejected", rejected.length || null),
        item("Showcase", "Showcase"),
      ],
    },
    {
      label: "Shared learning",
      items: [item("Versions", "Versions"), item("Styles", "Styles")],
    },
  ];

  const newClip = useCallback(() => {
    setTab("Studio");
    // The Studio may be mounting; let it, then focus the brief.
    setTimeout(() => window.dispatchEvent(new Event("sisyphus:new-clip")), 50);
  }, [setTab]);

  const commands: Command[] = useMemo(() => {
    const cs: Command[] = [
      {
        id: "new-clip",
        group: "Actions",
        label: "New clip",
        icon: <Plus size={16} />,
        keys: ["C"],
        run: newClip,
      },
      {
        id: "run-auditor",
        group: "Actions",
        label: "Run the Auditor",
        meta: "learn from failures",
        icon: <FlaskConical size={16} />,
        run: () =>
          api.runAudit().then(
            () => toast("The Auditor is looking at the failures"),
            (e) => toast(`Couldn't start the Auditor: ${e instanceof Error ? e.message : e}`, "err"),
          ),
      },
      ...TABS.map((t) => ({
        id: `go-${t}`,
        group: "Go to",
        label: t,
        meta: TAB_HINT[t],
        icon: ICON[t](16),
        keys: ["G", CHORD[t]],
        run: () => setTab(t),
      })),
    ];
    if (projects) {
      for (const p of projects)
        if (p.id !== project.id)
          cs.push({
            id: `project-${p.id}`,
            group: "Switch project",
            label: p.name,
            meta: `${p.videos} clip${p.videos === 1 ? "" : "s"}`,
            icon: <ProjectChip id={p.id} name={p.name} size={16} />,
            run: () => switchProject(p.id),
          });
      cs.push(
        {
          id: "project-new",
          group: "Projects",
          label: "New project…",
          icon: <FolderPlus size={16} />,
          run: () => setDialog({ kind: "create" }),
        },
        {
          id: "project-settings",
          group: "Projects",
          label: `${project.name} settings…`,
          icon: <Settings2 size={16} />,
          run: () => setDialog({ kind: "settings", project }),
        },
      );
    }
    return cs;
  }, [projects, project, newClip, setTab, switchProject]);

  // Keyboard: ⌘K opens the palette; G then a letter jumps to a page; C starts a clip.
  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      // A clip's feedback window owns the keyboard while it is open, ⌘K included: the palette would open behind it.
      if (document.querySelector("[data-own-keys]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || palette || dialog) return;
      const k = e.key.toUpperCase();
      if (Date.now() - g < 1200) {
        const t = TABS.find((x) => CHORD[x] === k);
        g = 0;
        if (t) {
          e.preventDefault();
          setTab(t);
        }
        return;
      }
      if (k === "G") g = Date.now();
      else if (k === "C") {
        e.preventDefault();
        newClip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [palette, dialog, newClip, setTab]);

  return (
    <div className="shell">
      <Sidebar
        nav={nav}
        active={tab}
        go={(id) => setTab(id as Tab)}
        projects={projects}
        project={project}
        switchProject={switchProject}
        openDialog={setDialog}
        openPalette={() => setPalette(true)}
        videos={every}
        versions={health.data?.versions}
        audit={audit.data}
        engine={engine}
      />

      <main className="main">
        <header className="topbar">
          <div className="crumbs">
            <span className="row" style={{ gap: 7 }}>
              <ProjectChip id={project.id} name={project.name} size={16} />
              {project.name}
            </span>
            <span className="sep">/</span>
            <strong>
              {ICON[tab](15)}
              {tab}
            </strong>
          </div>
          <span className="hint">{TAB_HINT[tab]}</span>
          <span className="grow" />
          {tab !== "Studio" && (
            <button className="primary sm" onClick={newClip} title="New clip (C)">
              <Plus size={14} /> New clip
            </button>
          )}
        </header>

        {(engine === "down" || engine === "lost") && (
          <div className="banner">
            <CircleAlert size={15} />
            <span>
              <strong>The engine isn't answering.</strong> The app shows the last data it had. In development, start it
              with <code>cd engine && uv run python -m sisyphus_engine</code>; the desktop app starts it by itself.
            </span>
          </div>
        )}

        <div className="page">
          {/* Keyed by project and page: a switch remounts the page, so it reloads its own data and fades in. */}
          <div className="page-inner" key={`${project.id}:${tab}`}>
            {tab === "Studio" && <Studio videos={all} refresh={videos.refresh} project={project} />}
            {tab === "Feed" && <Feed videos={approved} mode="feed" refresh={videos.refresh} />}
            {tab === "Rejected" && <Feed videos={rejected} mode="rejected" refresh={videos.refresh} />}
            {tab === "Versions" && <Versions videos={measured} />}
            {tab === "Styles" && <StylesTab videos={measured} />}
            {tab === "Showcase" && <Showcase />}
          </div>
        </div>
      </main>

      {palette && <CommandPalette commands={commands} close={() => setPalette(false)} />}
      {dialog && (
        <ProjectDialog
          mode={dialog}
          close={() => setDialog(null)}
          onCreated={(p) => {
            setMade((m) => [...m, p]);
            projectsPoll.refresh();
            switchProject(p.id);
            toast(`Created ${p.name}. Add footage to its folder to start.`);
            setDialog({ kind: "settings", project: p });
          }}
          onChanged={() => {
            projectsPoll.refresh();
            toast("Project saved");
          }}
          onDeleted={(id) => {
            setMade((m) => m.filter((p) => p.id !== id));
            if (id === project.id) switchProject("default");
            projectsPoll.refresh();
            toast("Project deleted");
          }}
        />
      )}
      <Toasts />
    </div>
  );
}

export default App;
