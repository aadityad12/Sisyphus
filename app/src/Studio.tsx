import { useEffect, useState } from "react";
import "./Studio.css";
import { api, type Footage, type Video } from "./api";
import { VideoCard } from "./VideoCard";

/** Start new jobs and watch videos move through the Creator and the Reviewer. */
export function Studio({ videos, refresh }: { videos: Video[]; refresh: () => void }) {
  const [footage, setFootage] = useState<Footage[]>([]);
  const [file, setFile] = useState("");
  const [brief, setBrief] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  function pick(name: string) {
    setFile(name);
    setBrief(footage.find((f) => f.file === name)?.brief ?? "");
  }

  async function start() {
    setError(null);
    try {
      await api.createJob(file, brief);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  const inFlight = videos.filter((v) => ["queued", "creating", "reviewing", "failed"].includes(v.status));

  return (
    <div>
      <div className="newjob">
        <label>
          Footage
          <select value={file} onChange={(e) => pick(e.target.value)}>
            {footage.map((f) => (
              <option key={f.file} value={f.file}>
                {f.speaker ? `${f.speaker}: ` : ""}
                {f.title}
                {f.duration_s ? ` (${Math.round(f.duration_s / 60)} min)` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          Brief
          <input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="30s clip on …" />
        </label>
        <button className="primary" disabled={!file || !brief.trim()} onClick={start}>
          Make clip
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <h2>In progress</h2>
      {inFlight.length === 0 ? (
        <p className="dim">Nothing in progress. Approved clips go to the Feed; sent-back clips go to Rejected.</p>
      ) : (
        <div className="grid">
          {inFlight.map((v) => (
            <VideoCard key={v.id} video={v} onChange={refresh} mode="studio" />
          ))}
        </div>
      )}
    </div>
  );
}
