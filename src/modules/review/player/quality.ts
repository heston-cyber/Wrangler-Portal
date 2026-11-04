// The player's picture-quality choice (Heston, Nov 4): only "1080p" and, when there is one, "4K" are listed; 1080p
// plays by default; a viewer's own 4K choice is remembered in their browser and wins. The 360p copy is never listed:
// it's for dragging and the automatic fallback after a playback error. Versions made before Nov 4 (no `quality`)
// keep the old menu and play exactly as before.
import { hiLabel, type Size } from "../../../../convex/lib/quality";

export type QualityId = "1080" | "4k";
export type QualityInfo = { q1080: string | null; q4k: string | null; hi: Size | null; big: boolean };
export type QualityOption = { id: QualityId; label: string; short: string; url: string };

/** One key for the viewer, not per video. */
export const QUALITY_PREF_KEY = "wr.quality";
/** The 1080p notice shows once per version per browser. */
export const noticeKey = (versionId: string) => `wr.qnotice.${versionId}`;

/** What the menu lists, in order. Empty when the version is from before Nov 4 or nothing is ready yet (the old way
 *  then decides the picture). */
export function qualityOptions(q: QualityInfo | null | undefined): QualityOption[] {
  if (!q) return [];
  const out: QualityOption[] = [];
  if (q.q1080) out.push({ id: "1080", label: "1080p", short: "1080p", url: q.q1080 });
  if (q.q4k && q.hi) out.push({ id: "4k", url: q.q4k, ...hiLabel(q.hi) });
  return out;
}

/** The picture to play: the viewer's remembered 4K choice when there is a 4K, else 1080p, else the 4K (a render whose
 *  1080p copy isn't made yet). */
export function defaultQuality(options: QualityOption[], pref: string | null | undefined): QualityId | null {
  if (!options.length) return null;
  const has = (id: QualityId) => options.some((o) => o.id === id);
  if (pref === "4k" && has("4k")) return "4k";
  return has("1080") ? "1080" : options[0].id;
}

/** When what's ready changes: the picture to switch to now, or null to stay. A picture that's no longer offered is
 *  replaced; otherwise the default only takes over when the viewer hasn't chosen in this visit and the video is
 *  paused at its very start (never mid-play, never mid-way). */
export function switchTo(opts: { options: QualityOption[]; current: QualityId | null; pref: string | null | undefined; chose: boolean; playing: boolean; frame: number }): QualityId | null {
  const want = defaultQuality(opts.options, opts.pref);
  if (!want || want === opts.current) return null;
  if (opts.current !== null && !opts.options.some((o) => o.id === opts.current)) return want;
  if (opts.chose || opts.playing || opts.frame !== 0) return null;
  return want;
}

/** The notice for clients and guests: playing 1080p while a 4K is there. */
export function noticeText(options: QualityOption[]): string | null {
  const hi = options.find((o) => o.id === "4k");
  if (!hi || !options.some((o) => o.id === "1080")) return null;
  return `Playing in 1080p for faster loading. Choose ${hi.short} in ⚙ to watch the full-resolution cut.`;
}
