// Where a version's picture lives (R3, Oct 22). "stream" versions are Bunny Stream videos (bunnyGuid); "file"
// versions are the render itself in Bunny Storage, plus an optional 360p scrub copy in the scrub library.
import type { Doc } from "../_generated/dataModel";

export const streamCdn = () => process.env.BUNNY_STREAM_CDN || "vz-3ba0610b-f90.b-cdn.net";
export const scrubCdn = () => process.env.BUNNY_SCRUB_CDN || "";
export const isFile = (v: Pick<Doc<"versions">, "source">) => v.source === "file";

export function thumbUrl(v: Doc<"versions">): string | null {
  if (isFile(v)) return v.scrubStatus === "ready" && v.scrubGuid && scrubCdn() ? `https://${scrubCdn()}/${v.scrubGuid}/thumbnail.jpg` : null;
  return v.bunnyGuid ? `https://${streamCdn()}/${v.bunnyGuid}/thumbnail.jpg` : null;
}

// The small copy for dragging and its stream (file versions only, once the scrub library has made it).
export function scrubUrls(v: Doc<"versions">): { mp4: string; hls: string } | null {
  if (!isFile(v) || v.scrubStatus !== "ready" || !v.scrubGuid || !scrubCdn()) return null;
  return { mp4: `https://${scrubCdn()}/${v.scrubGuid}/play_360p.mp4`, hls: `https://${scrubCdn()}/${v.scrubGuid}/playlist.m3u8` };
}
