// Nov 2 (Heston): "Reveal in Finder". A web page can't open Finder, so it copies the file's or folder's path on this
// Mac; in Finder, ⌘⇧G and paste goes straight there (a file's path opens its folder with the file selected).
// Paths in the portal are inside Dropbox › Apps › Wrangler Review; where Dropbox sits on this Mac is set once in
// Settings › Dropbox drop folder and kept in this browser.
const KEY = "wp.dropboxRoot";
export const DEFAULT_ROOT = "~/Library/CloudStorage/Dropbox"; // the Dropbox app's usual place on current macOS
export function dropboxRoot(): string {
  try { return localStorage.getItem(KEY) || DEFAULT_ROOT; } catch { return DEFAULT_ROOT; }
}
export function setDropboxRoot(v: string) {
  const t = v.trim().replace(/\/+$/, "");
  try { if (!t || t === DEFAULT_ROOT) localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* private window: the default stays */ }
}
/** "/clients/4m lc/4mlc_arizona2026" → "~/Library/CloudStorage/Dropbox/Apps/Wrangler Review/clients/4m lc/4mlc_arizona2026" */
export function finderPath(inApp: string): string {
  const rel = inApp.startsWith("/") ? inApp : `/${inApp}`;
  return `${dropboxRoot()}/Apps/Wrangler Review${rel === "/" ? "" : rel}`;
}
export async function revealInFinder(inApp: string | null, show: (m: string) => void, what = "it") {
  if (inApp === null) { show(`The portal doesn't know where ${what} is in Dropbox (it came from the browser, not the Dropbox folder).`); return; }
  try { await navigator.clipboard.writeText(finderPath(inApp)); show("Path copied. In Finder, press ⌘⇧G and paste."); }
  catch { show(`Couldn't copy. The path: ${finderPath(inApp)}`); }
}
