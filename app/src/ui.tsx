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

/** A tiny sparkline: one point per Creator version's pass rate. */
export function Spark({ values, width = 44, height = 16 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const step = width / (values.length - 1);
  const y = (v: number) => height - 2 - (v / 100) * (height - 4);
  const d = values.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  const color = up ? "var(--ok)" : "var(--err)";
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={y(values[values.length - 1])} r="2" fill={color} />
    </svg>
  );
}
