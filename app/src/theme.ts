import { useEffect, useState } from "react";

/*
 * Light and dark themes. The choice is "system" (follow the OS), "light" or "dark", kept in localStorage.
 * The resolved theme goes on <html data-theme>, which App.css reads. index.html sets it before first paint
 * with the same key and rule, so a light-mode user doesn't see a dark flash on load.
 */
export type ThemeChoice = "system" | "light" | "dark";
const KEY = "sisyphus.theme";
const media = () => window.matchMedia("(prefers-color-scheme: light)");

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const light = choice === "light" || (choice === "system" && media().matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
}

const listeners = new Set<(c: ThemeChoice) => void>();
let current = read();

export function setTheme(choice: ThemeChoice) {
  current = choice;
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // not remembered across reloads, which is fine
  }
  apply(choice);
  for (const l of listeners) l(choice);
}

/** The order a single toggle button steps through. */
export const NEXT: Record<ThemeChoice, ThemeChoice> = { system: "light", light: "dark", dark: "system" };

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState(current);
  useEffect(() => {
    listeners.add(setChoice);
    // While following the system, follow it live.
    const m = media();
    const onSystem = () => current === "system" && apply("system");
    m.addEventListener("change", onSystem);
    return () => {
      listeners.delete(setChoice);
      m.removeEventListener("change", onSystem);
    };
  }, []);
  return [choice, setTheme];
}
