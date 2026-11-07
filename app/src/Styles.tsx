import { useState } from "react";
import "./Styles.css";
import { api, type Style, type Video } from "./api";

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
        <span key={s} className="style-tag">
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
export function NewStyleForm({ onCreated, onCancel }: { onCreated: (name: string) => void; onCancel: () => void }) {
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
      await api.createStyle({ name: slug, how_to_edit: how.trim(), what_good_looks_like: good.trim() });
      onCreated(slug);
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

/** Every style with its two files, so you can read what the Creator and the Reviewer are told. */
export function StyleLibrary({ styles }: { styles: Style[] }) {
  return (
    <div className="style-library">
      {styles.map((s) => (
        <details key={s.name} className="style-entry">
          <summary>
            <strong>{s.title}</strong> <code className="dim small">{s.name}</code>
            <span className="dim small style-entry-summary">{s.summary}</span>
          </summary>
          <div className="style-files">
            <div>
              <span className="agentname creator">Creator</span>
              <code className="dim small"> skills/creator/styles/{s.name}.md</code>
              <pre>{s.creator}</pre>
            </div>
            <div>
              <span className="agentname reviewer">Reviewer</span>
              <code className="dim small"> skills/reviewer/styles/{s.name}.md</code>
              {s.reviewer ? <pre>{s.reviewer}</pre> : <p className="dim small">No Reviewer file yet.</p>}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

/** Filter options for a set of clips: every style they use, by name. */
export function stylesIn(videos: Video[]): string[] {
  return [...new Set(videos.flatMap(stylesOf))].sort();
}
