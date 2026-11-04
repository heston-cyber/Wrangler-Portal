// Picture quality choice (Heston, Nov 4): "1080p is the default playback res unless changed … if a 4K file is
// uploaded … the option still in settings to play the 4K cut." Pure helpers shared by the backend (what a version has)
// and the player (the menu's labels). The 360p copy is never a choice: it's for dragging and the error fallback.

export type Size = { width: number; height: number };

/** Anything taller than 1080 or wider than 1920 counts as the high-resolution ("4K") choice. */
export const isBig = (width?: number | null, height?: number | null) => (width ?? 0) > 1920 || (height ?? 0) > 1080;

/** Heights in Bunny's list of resolutions ("360p,1080p,2160p" → [360, 1080, 2160]). */
export const listedResolutions = (res: string | null | undefined): number[] =>
  (res || "").split(",").map((x) => parseInt(x, 10)).filter((h) => Number.isFinite(h) && h > 0);

/** The real size of a Stream MP4 copy Bunny calls "<label>p": the source fitted into the label's 16:9 box, never
 *  enlarged (a 3840×1600 source's "2160p" copy is 3840×1600). Without the source's size, the box itself. */
export function copySize(label: number, source: { width?: number | null; height?: number | null }): Size {
  const boxW = Math.round((label * 16) / 9), w = source.width ?? 0, h = source.height ?? 0;
  if (!w || !h) return { width: boxW, height: label };
  const s = Math.min(1, boxW / w, label / h);
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

/** The menu name of the high-resolution choice and the short name the notice uses. */
export function hiLabel(s: Size): { label: string; short: string } {
  if (s.width >= 3840 || s.height >= 2160) return { label: `4K (${s.height}p)`, short: "4K" };
  if (s.height > 1080) return { label: `${s.height}p`, short: `${s.height}p` };
  return { label: `Full size (${s.width}×${s.height})`, short: "Full size" }; // e.g. a 2048×858 render
}
