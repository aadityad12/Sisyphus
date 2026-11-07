import { useEffect, useState } from "react";
import "./Studio.css";
import { api, type Footage, type Video } from "./api";
import { shortVersion, VideoCard } from "./VideoCard";

/** A finished clip stays in the Studio this long, so the verdict landing is visible where the job started. */
const RECENT_S = 15 * 60;

function minutes(s?: number) {
  if (!s) return null;
  return s < 60 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
}

/** Start new jobs and watch videos move through the Creator and the Reviewer. */
export function Studio({ videos, refresh }: { videos: Video[]; refresh: () => void }) {
  const [footage, setFootage] = useState<Footage[] | null>(null);
  const [file, setFile] = useState("");
  const [brief, setBrief] = useState("");
  const [creator, setCreator] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

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
    setError(null);
    setStarting(true);
    try {
      await api.createJob(file, brief);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  }

  const now = Date.now() / 1000;
  const inFlight = videos.filter((v) => ["queued", "creating", "reviewing"].includes(v.status));
  const finished = videos.filter((v) => ["approved", "rejected", "failed"].includes(v.status));
  const recent = finished.filter((v) => now - v.updated_at < RECENT_S).sort((a, b) => b.updated_at - a.updated_at);
  const oldErrors = finished.filter((v) => v.status === "failed" && now - v.updated_at >= RECENT_S);

  return (
    <div className="studio">
      <section className="st-new">
        <div className="st-head">
          <h2>New clip</h2>
          <p className="dim small">
            {creator ? (
              <>
                Creator <code className="st-creator">{shortVersion(creator)}</code> edits it, then the Reviewer judges it.
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
          <div className="st-footage" role="radiogroup" aria-label="Footage">
            {footage.map((f) => (
              <button
                key={f.file}
                role="radio"
                aria-checked={f.file === file}
                className={`st-source ${f.file === file ? "on" : ""}`}
                onClick={() => pick(f)}
              >
                <span className="st-speaker">{f.speaker ?? "Unknown speaker"}</span>
                <span className="st-title">{f.title}</span>
                {minutes(f.duration_s) && <span className="st-dur">{minutes(f.duration_s)}</span>}
              </button>
            ))}
          </div>
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
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && file && brief.trim()) start();
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
          <div className="grid">
            {inFlight.map((v) => (
              <VideoCard key={v.id} video={v} onChange={refresh} mode="studio" />
            ))}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <h2>Just finished</h2>
          <p className="dim small st-hint">Approved clips also go to the Feed; sent-back clips go to Rejected.</p>
          <div className="grid">
            {recent.map((v) => (
              <VideoCard key={v.id} video={v} onChange={refresh} mode="studio" />
            ))}
          </div>
        </section>
      )}

      {oldErrors.length > 0 && (
        <details className="st-errors">
          <summary>
            Older errors <span className="dim">· {oldErrors.length}</span>
          </summary>
          <div className="grid">
            {oldErrors.map((v) => (
              <VideoCard key={v.id} video={v} onChange={refresh} mode="studio" />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
