import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ChevronRight, Copy, Film, FolderOpen, Plus, Sparkles } from "lucide-react";
import "./Studio.css";
import { api, currentProject, type Footage, type Project, type Style, type Video } from "./api";
import { shortVersion, VideoCard } from "./VideoCard";
import { NewStyleForm, StylePicker, withCreated } from "./Styles";
import { usePoll } from "./usePoll";
import { Empty, MOD, toast } from "./ui";

/** A finished clip stays in the Studio this long, so the verdict landing is visible where the job started. */
const RECENT_S = 15 * 60;
/** After a batch, a dozen clips can finish at once; the Studio shows the newest few, the tabs have the rest. */
const RECENT_MAX = 4;

function minutes(s?: number) {
  if (!s) return null;
  return s < 60 ? `${Math.round(s)}s` : `${Math.round(s / 60)} min`;
}

/** Footage the manifest lists has a speaker or a brief; files found only on disk have just a file name and title. */
function isListed(f: Footage) {
  return f.speaker !== undefined || f.brief !== undefined;
}

/** "lex-dhh-ai-programming" reads better as "lex dhh ai programming" than as a file name. */
function readable(title: string) {
  return title.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ");
}

/** "Andrej Karpathy (interviewed by Dwarkesh Patel)" → the name, and the rest for the second line. */
function splitSpeaker(speaker: string): [string, string | null] {
  const m = speaker.match(/^([^(]+?)\s*\((.+)\)\s*$/);
  return m ? [m[1], m[2]] : [speaker, null];
}

/**
 * How many clips the engine edits and reviews at once (#35). It counts every project's jobs, A/B and showcase
 * clips included, and a change applies at once: raising it starts queued clips, lowering it lets running ones finish.
 */
function Workers() {
  const settings = usePoll(api.settings, 5000);
  const [saving, setSaving] = useState(false);
  // An engine from before this setting answers 404: show nothing rather than a control that can't work.
  if (!settings.data) return null;
  const { workers, max_workers } = settings.data;
  const change = async (n: number) => {
    setSaving(true);
    try {
      await api.setWorkers(n);
      await settings.refresh();
    } catch (e) {
      toast(`Couldn't change it: ${e instanceof Error ? e.message : String(e)}`, "err");
    } finally {
      setSaving(false);
    }
  };
  return (
    <label className="sub st-workers" title="Across every project, A/B and showcase clips included">
      Run
      <select value={workers} disabled={saving} onChange={(e) => change(Number(e.target.value))}>
        {Array.from({ length: max_workers }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      at once
    </label>
  );
}

/**
 * Stills from the footage. Each is one <video> that fetches the metadata and one frame (the file server answers
 * range requests), drawn to a JPEG, after which the video is unmounted so its connection closes. They load two at
 * a time: a dozen open video requests would take every connection the webview allows to the engine and stall the
 * app's polls. Stills are kept for the session, so coming back to the Studio shows them at once.
 */
const stills = new Map<string, string>();
// Two at a time: quick enough on a cold start, and leaves the webview's other connections to the polls.
const lanes: Promise<void>[] = [Promise.resolve(), Promise.resolve()];
let nextLane = 0;
function inTurn(job: () => Promise<void>) {
  const i = nextLane++ % lanes.length;
  lanes[i] = lanes[i].then(job, job);
}

function Thumb({ f }: { f: Footage }) {
  // Two projects can each have an interview.mp4: the still belongs to this project's file.
  const key = `${currentProject()}/${f.file}`;
  const [still, setStill] = useState(() => stills.get(key) ?? null);
  const [src, setSrc] = useState<string | null>(null);
  const done = useRef<(() => void) | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (stills.has(key)) return;
    let live = true;
    inTurn(
      () =>
        new Promise<void>((resolve) => {
          if (!live) return resolve();
          // Give up on a file that doesn't answer, so one bad file doesn't hold the rest.
          const t = setTimeout(() => finish(), 10000);
          const finish = () => {
            clearTimeout(t);
            if (live) setSrc(null);
            resolve();
          };
          done.current = finish;
          // A third of the way in is usually the speaker, not a title card.
          api.footageUrl(f.file).then(
            (u) => (live ? setSrc(`${u}#t=${Math.round((f.duration_s ?? 300) / 3)}`) : finish()),
            finish,
          );
        }),
    );
    return () => {
      live = false;
      done.current?.();
    };
  }, [f.file, f.duration_s, key]);

  function grab() {
    const v = video.current;
    if (v && v.videoWidth) {
      try {
        const c = document.createElement("canvas");
        c.width = 384;
        c.height = Math.round((384 * v.videoHeight) / v.videoWidth);
        c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
        const url = c.toDataURL("image/jpeg", 0.8);
        stills.set(key, url);
        setStill(url);
      } catch {
        // A cross-origin frame without CORS can't be read back; the tile keeps its placeholder.
      }
    }
    done.current?.();
  }

  return (
    <span className={`st-thumb ${still ? "ready" : ""}`}>
      {still && <img src={still} alt="" />}
      {!still && src && (
        <video
          ref={video}
          src={src}
          crossOrigin="anonymous"
          preload="auto"
          muted
          playsInline
          onLoadedData={grab}
          onError={() => done.current?.()}
          tabIndex={-1}
        />
      )}
      {!still && <Film size={18} className="st-thumb-icon" />}
      {minutes(f.duration_s) && <span className="st-dur">{minutes(f.duration_s)}</span>}
    </span>
  );
}

function Source({ f, on, pick }: { f: Footage; on: boolean; pick: (f: Footage) => void }) {
  const [name, org] = f.speaker ? splitSpeaker(f.speaker) : [readable(f.title), null];
  const detail = f.speaker ? [org, f.title].filter(Boolean).join(" · ") : f.file;
  return (
    <button
      role="radio"
      aria-checked={on}
      className={`st-source ${on ? "on" : ""}`}
      title={[f.speaker, f.title, f.file].filter(Boolean).join("\n")}
      onClick={() => pick(f)}
    >
      <Thumb f={f} />
      <span className="st-source-text">
        <span className="st-speaker">{name}</span>
        {detail && <span className="st-title">{detail}</span>}
      </span>
      <span className="st-check" aria-hidden>
        <Check size={11} strokeWidth={3} />
      </span>
    </button>
  );
}

/** Clips still waiting for a plan get a one-line row; clips with a video get the full card. */
function Clips({ videos, refresh }: { videos: Video[]; refresh: () => void }) {
  const cards = videos.filter((v) => v.plan);
  const rows = videos.filter((v) => !v.plan);
  return (
    <>
      {rows.length > 0 && (
        <div className="st-rows">
          {rows.map((v) => (
            <VideoCard key={v.id} video={v} onChange={refresh} mode="studio" />
          ))}
        </div>
      )}
      {cards.length > 0 && (
        <div className={`grid ${rows.length ? "st-after" : ""}`}>
          {cards.map((v) => (
            <VideoCard key={v.id} video={v} onChange={refresh} mode="studio" />
          ))}
        </div>
      )}
    </>
  );
}

/** A new project starts with no footage: say where to put it. */
function NoFootage({ project }: { project: Project }) {
  return (
    <Empty icon={<FolderOpen size={18} />} title={`No footage in ${project.name} yet`}>
      Drop .mp4 files into this project's folder and they appear here. List them in its manifest.json to add a speaker
      and a default brief.
      {project.footage_dir && (
        <span className="pathbox st-path">
          <code title={project.footage_dir}>{project.footage_dir}</code>
          <button
            className="ghost icon sm"
            title="Copy the path"
            onClick={() =>
              navigator.clipboard.writeText(project.footage_dir).then(
                () => toast("Path copied"),
                () => toast("Couldn't copy the path", "err"),
              )
            }
          >
            <Copy size={13} />
          </button>
        </span>
      )}
    </Empty>
  );
}

/** Start new jobs and watch videos move through the Creator and the Reviewer. */
export function Studio({ videos, refresh, project }: { videos: Video[]; refresh: () => void; project: Project }) {
  const [footage, setFootage] = useState<Footage[] | null>(null);
  const [file, setFile] = useState("");
  const [brief, setBrief] = useState("");
  const [creator, setCreator] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Editing styles (#13). An engine without GET /styles answers 404: then there is no picker and jobs run as before.
  const library = usePoll(api.styles, 15000);
  const [created, setCreated] = useState<Style[]>([]);
  const styles = withCreated(library.data ?? [], created);
  const [picked, setPicked] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  // A held Ctrl+Enter fires before the re-render that disables the button; each repeat would be a paid job.
  const startingRef = useRef(false);
  const briefRef = useRef<HTMLTextAreaElement>(null);
  // The footage re-poll runs in an effect that outlives renders; it reads the current pick from here.
  const fileRef = useRef(file);
  fileRef.current = file;

  useEffect(() => {
    let stop = false;
    async function load() {
      while (!stop) {
        try {
          const f = await api.footage();
          setFootage(f);
          if (f[0]) {
            setFile(f[0].file);
            setBrief(f[0].brief ?? "");
          }
          poll();
          api
            .health()
            .then((h) => setCreator(h.versions.creator ?? null))
            .catch(() => {});
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 2000)); // engine not up yet
        }
      }
    }
    // After the first answer, list the folder again every few seconds: footage dropped into a project's folder
    // shows up without a reload. The picked file and the brief stay as they are.
    let timer: ReturnType<typeof setTimeout> | undefined;
    function poll() {
      timer = setTimeout(async () => {
        if (stop) return;
        try {
          const f = await api.footage();
          if (stop) return;
          setFootage((old) => (old && JSON.stringify(old) === JSON.stringify(f) ? old : f));
          // Keep the pick while its file is there; if it's gone (or nothing was picked), take the first. A brief
          // the user typed is kept: the new file's brief only fills an empty one.
          if (!f.some((x) => x.file === fileRef.current)) {
            setFile(f[0]?.file ?? "");
            if (f[0]?.brief && !briefRef.current?.value.trim()) setBrief(f[0].brief);
          }
        } catch {
          // the engine is busy or restarting; try again next time
        }
        poll();
      }, 5000);
    }
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  // "New clip" from anywhere (C, the palette, the top bar) lands on the brief.
  useEffect(() => {
    const focus = () => {
      briefRef.current?.focus();
      briefRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    window.addEventListener("sisyphus:new-clip", focus);
    return () => window.removeEventListener("sisyphus:new-clip", focus);
  }, []);

  function pick(f: Footage) {
    setFile(f.file);
    setBrief(f.brief ?? "");
  }

  async function start() {
    if (startingRef.current || !file || !brief.trim()) return;
    startingRef.current = true;
    setError(null);
    setStarting(true);
    try {
      // Picks go as chosen, never dropped silently: a job quietly switched to Auto would be a paid clip in a mode
      // nobody asked for. The engine rejects a style it doesn't know (422), and that error is shown.
      await api.createJob(file, brief, picked);
      refresh();
      toast("Clip started. The Creator is on it.");
    } catch (e) {
      setError(String(e));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  // Files with a manifest entry are the curated talks; the rest are whatever else is in the footage folder.
  const listed = (footage ?? []).filter(isListed);
  const unlisted = (footage ?? []).filter((f) => !isListed(f));
  const unlistedPicked = unlisted.some((f) => f.file === file);
  const chosen = (footage ?? []).find((f) => f.file === file);
  const chosenName = chosen ? (chosen.speaker ? splitSpeaker(chosen.speaker)[0] : readable(chosen.title)) : null;
  const pickedTitles = styles.filter((s) => picked.includes(s.name)).map((s) => s.title);

  const now = Date.now() / 1000;
  const inFlight = videos.filter((v) => ["queued", "creating", "reviewing"].includes(v.status));
  const finished = videos.filter((v) => ["approved", "rejected", "failed"].includes(v.status));
  const recent = finished.filter((v) => now - v.updated_at < RECENT_S).sort((a, b) => b.updated_at - a.updated_at);
  // Only verdicts are capped: they are also in the Feed and Rejected. Errors are shown nowhere else, so all stay here.
  const recentVerdicts = recent.filter((v) => v.status !== "failed");
  const recentErrors = recent.filter((v) => v.status === "failed");
  const oldErrors = finished.filter((v) => v.status === "failed" && now - v.updated_at >= RECENT_S);
  // With nothing finished lately, the Studio still shows the last verdicts, so the loop's outcome is on the first
  // screen and not only behind the Feed and Rejected tabs.
  const verdicts = finished.filter((v) => v.status !== "failed").sort((a, b) => b.updated_at - a.updated_at);
  // Idle: the newest approved clip and the newest sent-back one, so both outcomes of the loop show.
  const idleShown = [
    verdicts.find((v) => v.status === "approved"),
    verdicts.find((v) => v.status === "rejected"),
  ].filter((v): v is Video => !!v);
  const shownVerdicts = recentVerdicts.length ? recentVerdicts.slice(0, RECENT_MAX) : idleShown;
  const approvedCount = verdicts.filter((v) => v.status === "approved").length;
  const rejectedCount = verdicts.length - approvedCount;
  const ready = !!file && !!brief.trim() && !starting;

  return (
    <div className="studio">
      <div className="page-title">
        <div>
          <h1>New clip</h1>
          <p>
            {creator ? (
              <>
                Creator <code className="st-creator">{shortVersion(creator)}</code> edits it, then the Reviewer judges
                it. Disagree with a verdict and the Auditor learns from it.
              </>
            ) : (
              "The Creator edits it, then the Reviewer judges it."
            )}
          </p>
        </div>
      </div>

      <section className="st-new card">
        <div className="st-section">
          <div className="st-step">
            <span className="st-num">1</span>
            <span className="st-label">Footage</span>
            {footage && footage.length > 0 && (
              <span className="st-step-sub">
                {footage.length} video{footage.length === 1 ? "" : "s"} in {project.name}
              </span>
            )}
          </div>
          {footage === null ? (
            <div className="st-footage">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="st-source skeleton shimmer" />
              ))}
            </div>
          ) : footage.length === 0 ? (
            <NoFootage project={project} />
          ) : (
            <>
              {listed.length > 0 && (
                <div className="st-footage" role="radiogroup" aria-label="Footage">
                  {listed.map((f) => (
                    <Source key={f.file} f={f} on={f.file === file} pick={pick} />
                  ))}
                </div>
              )}
              {unlisted.length > 0 &&
                (listed.length === 0 ? (
                  <div className="st-footage" role="radiogroup" aria-label="Footage">
                    {unlisted.map((f) => (
                      <Source key={f.file} f={f} on={f.file === file} pick={pick} />
                    ))}
                  </div>
                ) : (
                  <details className="st-unlisted" open={unlistedPicked || undefined}>
                    <summary>
                      <Plus size={12} />
                      {unlisted.length} more {unlisted.length === 1 ? "file" : "files"}{" "}
                      <span className="dim">not in the manifest</span>
                    </summary>
                    <div className="st-footage" role="radiogroup" aria-label="More footage">
                      {unlisted.map((f) => (
                        <Source key={f.file} f={f} on={f.file === file} pick={pick} />
                      ))}
                    </div>
                  </details>
                ))}
            </>
          )}
        </div>

        <div className="st-section">
          <div className="st-step">
            <span className="st-num">2</span>
            <label className="st-label" htmlFor="st-brief">
              Brief
            </label>
            <span className="st-step-sub">What the clip is about. Picking footage fills in its default brief.</span>
          </div>
          <textarea
            id="st-brief"
            ref={briefRef}
            className="st-brief"
            rows={2}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
            }}
            placeholder="A 30-second clip on …"
          />
        </div>

        {library.data && (
          <div className="st-section">
            <div className="st-step">
              <span className="st-num">3</span>
              <span className="st-label">Style</span>
              <span className="st-step-sub">
                <a href="#styles">Style library</a>
              </span>
              <span className="grow" />
              {!adding && (
                <button className="ghost sm" onClick={() => setAdding(true)}>
                  <Plus size={13} /> New style
                </button>
              )}
            </div>
            {adding ? (
              <NewStyleForm
                onCancel={() => setAdding(false)}
                onCreated={(style) => {
                  setAdding(false);
                  setCreated((c) => [...c, style]);
                  setPicked([style.name]);
                  library.refresh();
                }}
              />
            ) : (
              <StylePicker styles={styles} value={picked} onChange={setPicked} />
            )}
          </div>
        )}

        <div className="st-go">
          <div className="st-summary">
            {chosenName ? (
              <>
                <span className="st-summary-k">Making</span>
                <strong>{chosenName}</strong>
                <span className="sep">·</span>
                <span>{pickedTitles.length ? pickedTitles.join(" + ") : "Auto style"}</span>
              </>
            ) : (
              <span className="dim">Pick footage to start</span>
            )}
          </div>
          {error && <p className="error">{error}</p>}
          <button className="primary lg" disabled={!ready} onClick={start}>
            {starting ? (
              "Starting…"
            ) : (
              <>
                <Sparkles size={15} /> Make clip
                <span className="row" style={{ gap: 3, marginLeft: 4 }}>
                  <kbd>{MOD}</kbd>
                  <kbd>↵</kbd>
                </span>
              </>
            )}
          </button>
        </div>
      </section>

      <section className="st-block">
        <div className="section-head">
          <h2>
            In progress <span className="count">{inFlight.length}</span>
          </h2>
          <span className="grow" />
          <Workers />
        </div>
        {inFlight.length === 0 ? (
          <p className="st-none">Nothing in progress. Start a clip above.</p>
        ) : (
          <Clips videos={inFlight} refresh={refresh} />
        )}
      </section>

      {(shownVerdicts.length > 0 || recentErrors.length > 0) && (
        <section className="st-block">
          <div className="section-head">
            <h2>{recentVerdicts.length ? "Just finished" : "Latest verdicts"}</h2>
            <span className="grow" />
            {verdicts.length > 0 && (
              <span className="st-hint">
                {/* The tab follows the URL hash, so plain links switch tabs. */}
                <a href="#feed">
                  {approvedCount} approved <ArrowRight size={12} />
                </a>
                <a href="#rejected">
                  {rejectedCount} sent back <ArrowRight size={12} />
                </a>
              </span>
            )}
          </div>
          <Clips videos={[...shownVerdicts, ...recentErrors]} refresh={refresh} />
        </section>
      )}

      {oldErrors.length > 0 && (
        <details className="st-errors st-block">
          <summary>
            <ChevronRight size={14} className="st-chev" />
            Older errors <span className="count">{oldErrors.length}</span>
          </summary>
          <Clips videos={oldErrors} refresh={refresh} />
        </details>
      )}
    </div>
  );
}
