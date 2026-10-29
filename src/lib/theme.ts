// Light / Dark / System (Settings). The choice is kept per browser; System follows the device's setting.
// index.html sets the theme before the page draws so it never flashes the wrong colours.
import { useEffect, useSyncExternalStore } from "react";

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

// A page can follow its own background instead of the saved choice (the signing page follows the document's backdrop).
let override: Theme | null = null;

export function applyTheme() {
  // Dark only (Gate 4, Oct 28: Appearance is removed). Only a page override (the signing page) turns it light.
  const t = override ?? "dark";
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

/** True for a light colour (#rgb, #rrggbb or #rrggbbaa); false for dark or anything unreadable. */
export function isLightColour(hex: string | null | undefined): boolean {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex ?? "");
  if (!m) return false;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1].slice(0, 6);
  const lin = (i: number) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4) > 0.35;
}

/**
 * While mounted, use this theme whatever the saved choice is; null leaves the saved choice alone.
 * Final test (Oct 28): a light document backdrop under the dark theme's light text made the Sign card unreadable.
 */
export function useThemeOverride(t: Theme | null) {
  useEffect(() => {
    if (!t) return;
    override = t;
    applyTheme();
    return () => { override = null; applyTheme(); };
  }, [t]);
}
