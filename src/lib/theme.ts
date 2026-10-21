// Light / Dark / System (Settings). The choice is kept per browser; System follows the device's setting.
// index.html sets the theme before the page draws so it never flashes the wrong colours.
import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "wr.theme";
const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
const subs = new Set<() => void>();

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "dark";
  } catch { return "dark"; }
}
export const resolveTheme = (p: ThemePref): Theme => (p === "system" ? (media?.matches ? "light" : "dark") : p);

export function applyTheme() {
  const t = resolveTheme(readThemePref());
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#f2efe7" : "#030104");
}

export function setThemePref(p: ThemePref) {
  try { localStorage.setItem(KEY, p); } catch { /* private mode: still applies for this visit */ }
  applyTheme();
  subs.forEach((l) => l());
}

media?.addEventListener?.("change", () => { if (readThemePref() === "system") { applyTheme(); subs.forEach((l) => l()); } });

const subscribe = (l: () => void) => { subs.add(l); return () => { subs.delete(l); }; };
const snapshot = () => `${readThemePref()}|${resolveTheme(readThemePref())}`;

export function useTheme() {
  const [pref, theme] = useSyncExternalStore(subscribe, snapshot).split("|") as [ThemePref, Theme];
  return { pref, theme, setPref: setThemePref };
}
