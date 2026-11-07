import { useEffect, useRef, useState } from "react";
import "./Studio.css";
import { api, type Footage, type Video } from "./api";
import { shortVersion, VideoCard } from "./VideoCard";

/** A finished clip stays in the Studio this long, so the verdict landing is visible where the job started. */
const RECENT_S = 15 * 60;
/** After a batch, a dozen clips can finish at once; the Studio shows the newest few, the tabs have the rest. */
const RECENT_MAX = 4;

function minutes(s?: number) {
  if (!s) return null;
  return s < 60 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
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

function Source({ f, on, pick }: { f: Footage; on: boolean; pick: (f: Footage) => void }) {
  const [name, org] = f.speaker ? splitSpeaker(f.speaker) : [readable(f.title), null];
  const detail = f.speaker ? [org, f.title].filter(Boolean).join(" · ") : null;
  return (
    <button
      role="radio"
      aria-checked={on}
      className={`st-source ${on ? "on" : ""}`}
      title={[f.speaker, f.title, f.file].filter(Boolean).join("\n")}
      onClick={() => pick(f)}
    >
      <span className="st-speaker">{name}</span>
      {minutes(f.duration_s) && <span className="st-dur">{minutes(f.duration_s)}</span>}
      {detail && <span className="st-title">{detail}</span>}
    </button>
  );
}

/** Clips with a video get the full card; ones still waiting for a plan get a one-line row beneath them. */
function Clips({ videos, refresh }: { videos: Video[]; refresh: () => void }) {
  const cards = videos.filter((v) => v.plan);
  const rows = videos.filter((v) => !v.plan);
  return (
    <>
      {cards.length > 0 && (
        <div className="grid">
          {cards.map((v) => (
            <VideoCard key={v.id} video={v} onChange={refresh} mode="studio" />
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className={`st-rows ${cards.length ? "after" : ""}`}>
          {rows.map((v) => (
            <VideoCard key={v.id} video={v} onChange={refresh} mode="studio" />
          ))}
        </div>
      )}
    </>
  );
}

/** Start new jobs and watch videos move through the Creator and the Reviewer. */
export function Studio({ videos, refresh }: { videos: Video[]; refresh: () => void }) {
  const [footage, setFootage] = useState<Footage[] | null>(null);
  const [file, setFile] = useState("");
  const [brief, setBrief] = useState("");
  const [creator, setCreator] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // A held Ctrl+Enter fires before the re-render that disables the button; each repeat would be a paid job.
  const startingRef = useRef(false);

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
    load();
    return () => {
      stop = true;
    };
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
      await api.createJob(file, brief);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  // Files with a manifest entry are the curated talks; the rest are whatever else is in footage/.
  const listed = (footage ?? []).filter(isListed);
  const unlisted = (footage ?? []).filter((f) => !isListed(f));
  const unlistedPicked = unlisted.some((f) => f.file === file);

  const now = Date.now() / 1000;
  const inFlight = videos.filter((v) => ["queued", "creating", "reviewing"].includes(v.status));
  const finished = videos.filter((v) => ["approved", "rejected", "failed"].includes(v.status));
  const recent = finished.filter((v) => now - v.updated_at < RECENT_S).sort((a, b) => b.updated_at - a.updated_at);
  // Only verdicts are capped: they are also in the Feed and Rejected. Errors are shown nowhere else, so all stay here.
  const recentVerdicts = recent.filter((v) => v.status !== "failed");
  const recentErrors = recent.filter((v) => v.status === "failed");
  const oldErrors = finished.filter((v) => v.status === "failed" && now - v.updated_at >= RECENT_S);

  return (
    <div className="studio">
      <section className="st-new">
        <div className="st-head">
          <h2>New clip</h2>
          <p className="dim small">
            {creator ? (
              <>
                Creator <code className="st-creator">{shortVersion(creator)}</code> edits it, then the Reviewer judges
                it.
              </>
            ) : (
              "The Creator edits it, then the Reviewer judges it."
            )}
          </p>
        </div>

        <div className="st-step">
          <span className="st-num">1</span>
          <span className="st-label">Pick the footage</span>
        </div>
        {footage === null ? (
          <p className="dim small">Waiting for the engine…</p>
        ) : footage.length === 0 ? (
          <p className="dim small">No footage found. Put videos in footage/ and list them in footage/manifest.json.</p>
        ) : (
          <>
            <div className="st-footage" role="radiogroup" aria-label="Footage">
              {listed.map((f) => (
                <Source key={f.file} f={f} on={f.file === file} pick={pick} />
              ))}
            </div>
            {unlisted.length > 0 && (
              <details className="st-unlisted" open={unlistedPicked || undefined}>
                <summary>
                  {unlisted.length} more {unlisted.length === 1 ? "file" : "files"}{" "}
                  <span className="dim">not in footage/manifest.json</span>
                </summary>
                <div className="st-footage" role="radiogroup" aria-label="More footage">
                  {unlisted.map((f) => (
                    <Source key={f.file} f={f} on={f.file === file} pick={pick} />
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        <div className="st-step">
          <span className="st-num">2</span>
          <label className="st-label" htmlFor="st-brief">
            Write the brief
          </label>
        </div>
        <textarea
          id="st-brief"
          className="st-brief"
          rows={2}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
          }}
          placeholder="A 30-second clip on …"
        />

        <div className="st-go">
          <button className="primary" disabled={!file || !brief.trim() || starting} onClick={start}>
            {starting ? "Starting…" : "Make clip →"}
          </button>
          {error && <p className="error">{error}</p>}
        </div>
      </section>

      <section>
        <h2>
          In progress <span className="st-count">{inFlight.length}</span>
        </h2>
        {inFlight.length === 0 ? (
          <p className="dim st-none">Nothing in progress. Start a clip above.</p>
        ) : (
          <Clips videos={inFlight} refresh={refresh} />
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <h2>Just finished</h2>
          <p className="dim small st-hint">
            {recentVerdicts.length > RECENT_MAX
              ? `The ${RECENT_MAX} newest of ${recentVerdicts.length} verdicts. The rest are in the Feed (approved) and Rejected (sent back).`
              : "Approved clips also go to the Feed; sent-back clips go to Rejected."}
          </p>
          <Clips videos={[...recentVerdicts.slice(0, RECENT_MAX), ...recentErrors]} refresh={refresh} />
        </section>
      )}

      {oldErrors.length > 0 && (
        <details className="st-errors">
          <summary>
            Older errors <span className="dim">· {oldErrors.length}</span>
          </summary>
          <Clips videos={oldErrors} refresh={refresh} />
        </details>
      )}
    </div>
  );
}
