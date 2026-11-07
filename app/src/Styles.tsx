import { useState } from "react";
import "./Styles.css";
import { api, type Style, type Video } from "./api";
import { usePoll } from "./usePoll";

/**
 * Editing styles (#13). A style is two skill files: how the Creator edits in it, and what the Reviewer
 * expects of a clip in it. The Studio picks styles for a job (or Auto, and the Creator picks); the styles
 * the Creator actually used are the video's tags.
 */

/** The styles a clip was edited in: the engine's `styles`, else the plan's own list. */
export function stylesOf(v: Video): string[] {
  return v.styles ?? v.plan?.styles ?? [];
}

/** The Studio asked for no styles, so the Creator chose them itself. */
export function autoPicked(v: Video): boolean {
  return (v.styles_requested ?? []).length === 0;
}

/** A video's style tags, marked when the Creator picked them on Auto. Nothing for a clip with no styles. */
export function StyleTags({ video }: { video: Video }) {
  const styles = stylesOf(video);
  if (styles.length === 0) return null;
  const auto = autoPicked(video);
  return (
    <span className="style-tags" title={auto ? "Auto: the Creator picked these styles" : "Styles picked in the Studio"}>
      {styles.map((s) => (
        <span key={s} className="chip style-tag">
          {s}
        </span>
      ))}
      {auto && <span className="style-auto">auto-picked</span>}
    </span>
  );
}

/** Lowercase words joined by dashes: the engine's style names are slugs ([a-z0-9-]+). */
export function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Auto, or any number of styles. Auto is the empty selection. */
export function StylePicker({
  styles,
  value,
  onChange,
}: {
  styles: Style[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (name: string) => onChange(value.includes(name) ? value.filter((n) => n !== name) : [...value, name]);
  const picked = styles.filter((s) => value.includes(s.name));
  return (
    <div className="style-picker">
      <div className="style-options" role="group" aria-label="Editing styles">
        <button
          className={`style-option auto ${value.length === 0 ? "on" : ""}`}
          aria-pressed={value.length === 0}
          onClick={() => onChange([])}
          title="The Creator picks the styles that suit the footage and the brief"
        >
          <span className="style-option-title">Auto</span>
          <span className="style-option-summary">The Creator picks for the footage and brief.</span>
        </button>
        {styles.map((s) => (
          <button
            key={s.name}
            className={`style-option ${value.includes(s.name) ? "on" : ""}`}
            aria-pressed={value.includes(s.name)}
            onClick={() => toggle(s.name)}
            title={s.summary}
          >
            <span className="style-option-title">{s.title}</span>
            <span className="style-option-summary">{s.summary}</span>
          </button>
        ))}
      </div>
      <p className="dim small">
        {picked.length === 0
          ? "Auto: the Creator chooses from the library, and the clip is tagged with what it used."
          : picked.length === 1
            ? `The clip is edited in ${picked[0].title}.`
            : `The clip mixes ${picked.map((s) => s.title).join(" + ")}.`}
      </p>
    </div>
  );
}

/** A human adds a style: both files are written and committed by the engine. */
export function NewStyleForm({ onCreated, onCancel }: { onCreated: (style: Style) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [how, setHow] = useState("");
  const [good, setGood] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const slug = slugify(name);
  const ready = !!slug && !!how.trim() && !!good.trim() && !pending;

  async function create() {
    if (!ready) return;
    setPending(true);
    setFailed(null);
    try {
      const made = await api.createStyle({ name: slug, how_to_edit: how.trim(), what_good_looks_like: good.trim() });
      // The engine returns the style; if a response ever lacks it, build it from what was sent.
      onCreated(
        made && typeof made === "object" && made.name
          ? made
          : { name: slug, title: name.trim(), summary: how.trim(), creator: how.trim(), reviewer: good.trim() },
      );
    } catch (e) {
      setFailed(`Couldn't add the style: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="style-form">
      <label>
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Documentary" />
        {name && (
          <span className="dim small">
            saved as <code>{slug || "…"}</code>
          </span>
        )}
      </label>
      <label>
        <span>How to edit in it</span>
        <span className="dim small">For the Creator: pacing, cuts, captions, zoom, colour.</span>
        <textarea
          rows={3}
          value={how}
          onChange={(e) => setHow(e.target.value)}
          placeholder="Slow, long takes. Plain white captions at the bottom, sentence case. No punch-ins…"
        />
      </label>
      <label>
        <span>What a good one looks like</span>
        <span className="dim small">For the Reviewer: how it judges a clip that claims this style.</span>
        <textarea
          rows={3}
          value={good}
          onChange={(e) => setGood(e.target.value)}
          placeholder="Feels calm and considered; every cut lands on a finished sentence…"
        />
      </label>
      <div className="style-form-actions">
        <button className="primary" disabled={!ready} onClick={create}>
          {pending ? "Adding…" : "Add style"}
        </button>
        <button onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        {failed && <p className="vc-failed">{failed}</p>}
      </div>
    </div>
  );
}

type StyleStats = { clips: number; judged: number; passed: number; auto: number };

/** How each style's clips are doing on regular work: a human vote where there is one, else the Reviewer. */
function statsByStyle(videos: Video[]): Map<string, StyleStats> {
  const by = new Map<string, StyleStats>();
  for (const v of videos) {
    if (v.experiment_id !== null || v.showcase) continue;
    const verdict = v.human_liked ?? v.review_approved;
    for (const name of stylesOf(v)) {
      const s = by.get(name) ?? { clips: 0, judged: 0, passed: 0, auto: 0 };
      s.clips += 1;
      if (verdict !== null) {
        s.judged += 1;
        s.passed += verdict ? 1 : 0;
      }
      if (autoPicked(v)) s.auto += 1;
      by.set(name, s);
    }
  }
  return by;
}

/** One style: what it is, how its clips are doing, and the two files the Creator and the Reviewer are given. */
function StyleCard({ style, stats }: { style: Style; stats: StyleStats | undefined }) {
  const pct = stats?.judged ? Math.round((100 * stats.passed) / stats.judged) : null;
  return (
    <article className="style-card">
      <header>
        <h3>{style.title}</h3>
        <code className="dim small">{style.name}</code>
      </header>
      <p className="style-card-summary">{style.summary}</p>
      <div className="style-card-stats">
        {stats ? (
          <>
            <span>
              <strong>{stats.clips}</strong> clip{stats.clips === 1 ? "" : "s"}
            </span>
            <span title="A human vote where there is one, else the Reviewer's verdict">
              <strong>{pct === null ? "–" : `${pct}%`}</strong> passed
              {stats.judged > 0 && (
                <span className="dim">
                  {" "}
                  ({stats.passed}/{stats.judged})
                </span>
              )}
            </span>
            {stats.auto > 0 && <span className="dim">{stats.auto} picked on Auto</span>}
          </>
        ) : (
          <span className="dim">No clips in this style yet.</span>
        )}
      </div>
      <details className="style-entry">
        <summary>Skill files</summary>
        <div className="style-files">
          <div>
            <span className="agentname creator">Creator</span>
            <code className="dim small"> skills/creator/styles/{style.name}.md</code>
            <pre>{style.creator}</pre>
          </div>
          <div>
            <span className="agentname reviewer">Reviewer</span>
            <code className="dim small"> skills/reviewer/styles/{style.name}.md</code>
            {style.reviewer ? <pre>{style.reviewer}</pre> : <p className="dim small">No Reviewer file yet.</p>}
          </div>
        </div>
      </details>
    </article>
  );
}

/** The Styles tab: the library, how each style is doing, and a form to add one. */
export function StylesTab({ videos }: { videos: Video[] }) {
  const library = usePoll(api.styles, 15000);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Style[]>([]);
  const stats = statsByStyle(videos);

  if (!library.data) {
    return library.error ? (
      <p className="dim">
        This engine has no editing styles (GET /styles: {library.error}). They arrive with #13's engine change.
      </p>
    ) : (
      <p className="dim">Loading styles…</p>
    );
  }
  const styles = withCreated(library.data, added);
  return (
    <div className="styles-tab">
      <div className="styles-head">
        <div>
          <h2>Editing styles</h2>
          <p className="dim small">
            Each style is two skill files: how the Creator edits in it, and what the Reviewer expects of a clip that
            claims it. The Auditor improves each through its own A/B.
          </p>
        </div>
        {!adding && (
          <button className="primary" onClick={() => setAdding(true)}>
            + New style
          </button>
        )}
      </div>
      {adding && (
        <NewStyleForm
          onCancel={() => setAdding(false)}
          onCreated={(style) => {
            setAdding(false);
            setAdded((a) => [...a, style]);
            library.refresh();
          }}
        />
      )}
      {added.length > 0 && !adding && (
        <p className="dim small">
          Added <code>{added[added.length - 1].name}</code>. Pick it in the Studio.
        </p>
      )}
      {styles.length === 0 ? (
        <p className="dim">No styles yet. Add the first one.</p>
      ) : (
        <div className="style-cards">
          {styles.map((s) => (
            <StyleCard key={s.name} style={s} stats={stats.get(s.name)} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The library as last polled, plus styles created since that the poll hasn't returned yet (its refresh can fail,
 * or an older poll can land after it), so a style just added is never missing from the picker.
 */
export function withCreated(library: Style[], created: Style[]): Style[] {
  return [...library, ...created.filter((c) => !library.some((s) => s.name === c.name))];
}

/** Filter options for a set of clips: every style they use, by name. */
export function stylesIn(videos: Video[]): string[] {
  return [...new Set(videos.flatMap(stylesOf))].sort();
}
