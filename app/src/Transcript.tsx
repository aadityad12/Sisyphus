import { useEffect, useState } from "react";
import { api, type TranscriptSegment, type TranscriptView, type TranscriptWord } from "./api";

// Cut words shown on each side of a kept segment until "Show all context" is on.
const NEAR_WORDS = 15;

type Run = { cls: string; title?: string; text: string };

function wordClass(w: TranscriptWord, index: number): Pick<Run, "cls" | "title"> {
  if (w.segment === index) return { cls: "tx-kept" };
  if (w.segment !== null) return { cls: "tx-other", title: `Kept in cut ${w.segment + 1}` };
  return { cls: "tx-cut" };
}

// Neighbouring words with the same look become one span, so a kept phrase reads as one highlight.
function runs(words: TranscriptWord[], index: number): Run[] {
  const out: Run[] = [];
  for (const w of words) {
    const { cls, title } = wordClass(w, index);
    const last = out[out.length - 1];
    if (last && last.cls === cls && last.title === title) last.text += ` ${w.word}`;
    else out.push({ cls, title, text: w.word });
  }
  return out;
}

function Words({ words, index }: { words: TranscriptWord[]; index: number }) {
  return (
    <>
      {runs(words, index).map((r, i) => (
        <span key={i}>
          <span className={r.cls} title={r.title}>
            {r.text}
          </span>{" "}
        </span>
      ))}
    </>
  );
}

function Block({ seg, full }: { seg: TranscriptSegment; full: boolean }) {
  // Split on the server's own kept marks, not on times, so a word the renderer drops at a boundary
  // never lands inside the highlight. Words are in source order, so this segment's are contiguous.
  const first = seg.words.findIndex((w) => w.segment === seg.index);
  const last = first + seg.words.filter((w) => w.segment === seg.index).length - 1;
  const split = first < 0 ? seg.words.filter((w) => w.start < seg.start).length : first;
  const before = seg.words.slice(0, split);
  const inside = first < 0 ? [] : seg.words.slice(first, last + 1);
  const after = seg.words.slice(first < 0 ? split : last + 1);
  const shownBefore = full ? before : before.slice(-NEAR_WORDS);
  const shownAfter = full ? after : after.slice(0, NEAR_WORDS);
  return (
    <div className="tx-block">
      <div className="tx-head">
        <span className="tx-num">Cut {seg.index + 1}</span>
        <span>
          {seg.start.toFixed(1)}s → {seg.end.toFixed(1)}s ({(seg.end - seg.start).toFixed(1)}s)
        </span>
      </div>
      <p className="tx-text">
        {shownBefore.length < before.length && <span className="tx-more">… </span>}
        <Words words={shownBefore} index={seg.index} />
        {inside.length ? <Words words={inside} index={seg.index} /> : <em className="tx-more">(no speech) </em>}
        <Words words={shownAfter} index={seg.index} />
        {shownAfter.length < after.length && <span className="tx-more">…</span>}
      </p>
    </div>
  );
}

/** What the Creator kept (highlighted, in play order) and the source around it that it cut. */
export function Transcript({ videoId }: { videoId: number }) {
  const [view, setView] = useState<TranscriptView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    let live = true;
    setView(null);
    setError(null);
    api
      .transcript(videoId)
      .then((v) => live && setView(v))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [videoId]);

  if (error) return <pre className="error">Transcript unavailable: {error}</pre>;
  if (!view) return <p className="dim small">Loading transcript…</p>;

  return (
    <div className="transcript">
      <div className={view.hook ? "tx-hook" : "tx-hook none"}>{view.hook || "No hook"}</div>
      <div className="row">
        <span className="dim small">
          {view.segments.length} cuts · {view.kept_s.toFixed(1)}s kept{view.reordered && " · played out of source order"}
        </span>
        <button className="link" onClick={() => setFull(!full)}>
          {full ? "Less context" : `Show all context (±${view.context_s}s)`}
        </button>
      </div>
      <p className="tx-legend small">
        <span className="tx-kept">kept</span> <span className="tx-other">kept in another cut</span>{" "}
        <span className="tx-cut">cut</span>
      </p>
      {view.segments.map((s) => (
        <Block key={s.index} seg={s} full={full} />
      ))}
    </div>
  );
}
