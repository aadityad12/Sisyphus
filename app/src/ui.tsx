import { useEffect, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";

/** Small pieces every page shares: keyboard hints, empty states, project chips and toasts. */

export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="row" style={{ gap: 3 }}>
      {keys.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
    </span>
  );
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}

/** A stable hue per project id, so each project is recognisable at a glance. */
export function projectHue(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return id === "default" ? 18 : h;
}

export function ProjectChip({ id, name, size = 18 }: { id: string; name: string; size?: number }) {
  const hue = projectHue(id);
  return (
    <span
      className="proj-chip"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.55,
        background: `linear-gradient(135deg, hsl(${hue} 80% 58%), hsl(${(hue + 30) % 360} 75% 42%))`,
      }}
      aria-hidden
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

type Toast = { id: number; text: string; kind: "ok" | "err" };
let listeners: ((t: Toast) => void)[] = [];
let nextId = 1;

/** Show a short message in the corner. */
export function toast(text: string, kind: Toast["kind"] = "ok") {
  const t = { id: nextId++, text, kind };
  listeners.forEach((l) => l(t));
}

export function Toasts() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (t: Toast) => {
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 4200);
    };
    listeners.push(add);
    return () => {
      listeners = listeners.filter((l) => l !== add);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === "ok" ? <CircleCheck size={16} /> : <CircleAlert size={16} />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
