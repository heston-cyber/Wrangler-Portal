// Wrangler Portal Phase 1 (Oct 29): colour maths shared by the backend (Business settings) and the portal.
// Button text on a business's accent is chosen automatically so it reaches WCAG AA 4.5:1 (Heston, Oct 29):
// light text when the accent is dark enough, dark text otherwise. Wrangler's red keeps its approved exception.

export const LIGHT_TEXT = "#F4F1E9"; // the portal's cream
export const DARK_TEXT = "#030104";  // the portal's black
export const AA = 4.5;

function rgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number | null {
  const c = rgb(hex);
  if (!c) return null;
  const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** WCAG contrast ratio between two colours (1 to 21). */
export function contrast(a: string, b: string): number | null {
  const la = luminance(a), lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The text colour for a button filled with this accent, and whether it reaches 4.5:1. */
export function textOn(accent: string): { text: string; ratio: number; ok: boolean } {
  const light = contrast(accent, LIGHT_TEXT) ?? 0;
  const dark = contrast(accent, DARK_TEXT) ?? 0;
  if (light >= AA && light >= dark) return { text: LIGHT_TEXT, ratio: light, ok: true };
  if (dark >= AA) return { text: DARK_TEXT, ratio: dark, ok: true };
  return light >= dark ? { text: LIGHT_TEXT, ratio: light, ok: false } : { text: DARK_TEXT, ratio: dark, ok: false };
}

/** Mixes a colour toward white (amount > 0) or black (amount < 0): for hover and pressed shades. */
export function shade(hex: string, amount: number): string {
  const c = rgb(hex);
  if (!c) return hex;
  const t = amount > 0 ? 255 : 0, a = Math.min(Math.abs(amount), 1);
  return "#" + c.map((v) => Math.round(v + (t - v) * a).toString(16).padStart(2, "0")).join("").toUpperCase();
}
