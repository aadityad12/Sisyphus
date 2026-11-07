import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, CornerDownLeft, Search } from "lucide-react";

export type Command = {
  id: string;
  group: string;
  label: string;
  icon: ReactNode;
  meta?: string;
  keys?: string[];
  run: () => void;
};

/** Match every word of the query against the label, its group and meta, in any order. */
function matches(c: Command, q: string) {
  const hay = `${c.label} ${c.group} ${c.meta ?? ""}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** ⌘K: jump to a page, switch project, start a clip, run the Auditor. */
export function CommandPalette({ commands, close }: { commands: Command[]; close: () => void }) {
  const [q, setQ] = useState("");
  const [hl, setHl] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => commands.filter((c) => matches(c, q)), [commands, q]);

  useEffect(() => setHl(0), [q]);
  useEffect(() => {
    list.current?.querySelector(".hl")?.scrollIntoView({ block: "nearest" });
  }, [hl]);

  function run(c: Command | undefined) {
    if (!c) return;
    close();
    c.run();
  }

  let lastGroup = "";
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command menu">
        <div className="cmdk-input">
          <Search size={17} />
          <input
            autoFocus
            value={q}
            placeholder="Type a command or search…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setHl((h) => Math.min(h + 1, shown.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHl((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(shown[hl]);
              }
            }}
            role="combobox"
            aria-expanded
            aria-controls="cmdk-list"
          />
        </div>
        <div className="cmdk-list" id="cmdk-list" ref={list} role="listbox">
          {shown.length === 0 && <div className="cmdk-empty">No results for “{q}”</div>}
          {shown.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head && <div className="cmdk-group">{head}</div>}
                <button
                  className={`cmdk-item ${i === hl ? "hl" : ""}`}
                  role="option"
                  aria-selected={i === hl}
                  onMouseMove={() => setHl(i)}
                  onClick={() => run(c)}
                >
                  {c.icon}
                  <span className="label">{c.label}</span>
                  {c.meta && <span className="meta">{c.meta}</span>}
                  {c.keys && (
                    <span className="row" style={{ gap: 3 }}>
                      {c.keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <div className="cmdk-foot">
          <span>
            <kbd>
              <ArrowUp size={10} />
            </kbd>
            <kbd>
              <ArrowDown size={10} />
            </kbd>
            to navigate
          </span>
          <span>
            <kbd>
              <CornerDownLeft size={10} />
            </kbd>
            to select
          </span>
          <span>
            <kbd>esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
