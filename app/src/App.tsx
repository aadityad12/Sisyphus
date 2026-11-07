import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type Health = { status: string; versions: Record<string, string> };

// The engine URL comes from the Rust layer. Outside Tauri (plain `npm run dev`), use the default.
async function getEngineUrl(): Promise<string> {
  try {
    return await invoke<string>("engine_url");
  } catch {
    return "http://127.0.0.1:8765";
  }
}

const TABS = ["Feed", "Rejected", "Versions"] as const;
type Tab = (typeof TABS)[number];

function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Feed");

  useEffect(() => {
    let stop = false;
    async function poll() {
      const url = await getEngineUrl();
      while (!stop) {
        try {
          const res = await fetch(`${url}/health`);
          setHealth(await res.json());
          setError(null);
        } catch {
          setHealth(null);
          setError("Engine not reachable yet");
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    poll();
    return () => {
      stop = true;
    };
  }, []);

  return (
    <main className="app">
      <header className="top">
        <h1>
          <span className="si">SI</span>syphus
        </h1>
        <span className={health ? "pill ok" : "pill down"}>
          {health ? "engine online" : error ?? "connecting…"}
        </span>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      <section className="panel">
        {tab === "Feed" && <p>Videos the Reviewer approved, for human feedback. (TODO)</p>}
        {tab === "Rejected" && <p>Videos the Reviewer sent back. Humans can override. (TODO)</p>}
        {tab === "Versions" && (
          <div>
            <p>Current agent versions:</p>
            <ul>
              {health
                ? Object.entries(health.versions).map(([agent, v]) => (
                    <li key={agent}>
                      {agent}: <code>{v}</code>
                    </li>
                  ))
                : null}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
