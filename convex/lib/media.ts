// Where a version's picture lives (R3, Oct 22) and, since C3 (Oct 23), signed links to it. "stream" versions are
// Bunny Stream videos (bunnyGuid); "file" versions are the render itself in Bunny Storage, plus an optional 360p
// scrub copy in the scrub library.
//
// Signing: each pull zone has a token key in the Convex dashboard (BUNNY_STILLS_TOKEN_KEY, BUNNY_STREAM_TOKEN_KEY,
// BUNNY_SCRUB_TOKEN_KEY, optional BUNNY_REVIEW_TOKEN_KEY). While a key is missing, that zone's links go out unsigned,
// so Heston can turn token authentication on zone by zone. Expiry is rounded to a 12-hour step (valid 12–24 h), so a
// query that re-runs mid-review hands the page the same URL and the player doesn't reload.
import type { Doc } from "../_generated/dataModel";
import { renderFolder, signBunnyUrl, streamFolder } from "./bunnySign";

export const streamCdn = () => process.env.BUNNY_STREAM_CDN || "vz-3ba0610b-f90.b-cdn.net";
export const scrubCdn = () => process.env.BUNNY_SCRUB_CDN || "";
export const stillsCdn = () => process.env.BUNNY_STILLS_CDN || "";
export const reviewCdn = () => process.env.BUNNY_REVIEW_CDN || stillsCdn();
export const isFile = (v: Pick<Doc<"versions">, "source">) => v.source === "file";

const STEP = 12 * 3600;
/** Unix seconds: the next 12-hour boundary plus 12 hours. Stable for up to 12 hours, valid for at least 12. */
export const stepExpiry = (now = Date.now()) => (Math.floor(now / 1000 / STEP) + 2) * STEP;

function keyFor(host: string): string | null {
  const e = process.env;
  if (host === streamCdn()) return e.BUNNY_STREAM_TOKEN_KEY || null;
  if (scrubCdn() && host === scrubCdn()) return e.BUNNY_SCRUB_TOKEN_KEY || null;
  if (reviewCdn() && host === reviewCdn() && reviewCdn() !== stillsCdn()) return e.BUNNY_REVIEW_TOKEN_KEY || null;
  if (stillsCdn() && host === stillsCdn()) return e.BUNNY_STILLS_TOKEN_KEY || null;
  if (host.endsWith(".b-cdn.net") && e.BUNNY_SIGN_TEST_CDN && host === e.BUNNY_SIGN_TEST_CDN) return e.BUNNY_SIGN_TEST_KEY || null;
  return null;
}

/** Signs a Bunny URL when its zone has a key; otherwise returns it as it is. */
export async function signUrl(url: string, opts: { folder?: string; directory?: boolean; expiresAt?: number } = {}): Promise<string> {
  let host: string;
  try { host = new URL(url).host; } catch { return url; }
  const key = keyFor(host);
  if (!key) return url;
  return await signBunnyUrl(url, key, { ttlSeconds: 0, expiresAt: opts.expiresAt ?? stepExpiry(), folder: opts.folder, directory: opts.directory });
}

/** A note still (or nothing). */
export async function signStillUrl(u: string | undefined | null): Promise<string | undefined> {
  if (!u) return undefined;
  return await signUrl(u);
}

export function thumbUrl(v: Doc<"versions">): string | null {
  if (isFile(v)) return v.scrubStatus === "ready" && v.scrubGuid && scrubCdn() ? `https://${scrubCdn()}/${v.scrubGuid}/thumbnail.jpg` : null;
  return v.bunnyGuid ? `https://${streamCdn()}/${v.bunnyGuid}/thumbnail.jpg` : null;
}
export async function signedThumbUrl(v: Doc<"versions">): Promise<string | null> {
  const u = thumbUrl(v);
  if (!u) return null;
  const folder = isFile(v) ? streamFolder(v.scrubGuid!) : streamFolder(v.bunnyGuid);
  return await signUrl(u, { folder });
}

// The small copy for dragging and its stream (file versions only, once the scrub library has made it).
export function scrubUrls(v: Doc<"versions">): { mp4: string; hls: string } | null {
  if (!isFile(v) || v.scrubStatus !== "ready" || !v.scrubGuid || !scrubCdn()) return null;
  return { mp4: `https://${scrubCdn()}/${v.scrubGuid}/play_360p.mp4`, hls: `https://${scrubCdn()}/${v.scrubGuid}/playlist.m3u8` };
}

export type VersionMedia = {
  /** The stream playlist (Bunny Stream versions) — HLS, token in the path so segments inherit it. */
  hls: string | null;
  /** MP4 copies by height (Bunny Stream versions). */
  mp4: Record<number, string>;
  /** The render itself (file versions). */
  file: string | null;
  /** The 360p scrub copy (file versions, when made). */
  scrub: { mp4: string; hls: string } | null;
  thumb: string | null;
};

/** Every link the player may need for a version, signed where the zone has a key. */
export async function versionMedia(v: Doc<"versions">): Promise<VersionMedia> {
  const expiresAt = stepExpiry();
  const out: VersionMedia = { hls: null, mp4: {}, file: null, scrub: null, thumb: null };
  if (isFile(v)) {
    if (v.fileUrl && v.storagePath) out.file = await signUrl(v.fileUrl, { folder: renderFolder(v.storagePath), expiresAt });
    else if (v.fileUrl) out.file = await signUrl(v.fileUrl, { expiresAt });
    const s = scrubUrls(v);
    if (s && v.scrubGuid) {
      const folder = streamFolder(v.scrubGuid);
      out.scrub = { mp4: await signUrl(s.mp4, { folder, expiresAt }), hls: await signUrl(s.hls, { folder, directory: true, expiresAt }) };
      out.thumb = await signUrl(`https://${scrubCdn()}/${v.scrubGuid}/thumbnail.jpg`, { folder, expiresAt });
    }
    return out;
  }
  if (!v.bunnyGuid) return out;
  const folder = streamFolder(v.bunnyGuid);
  const base = `https://${streamCdn()}/${v.bunnyGuid}`;
  out.hls = await signUrl(`${base}/playlist.m3u8`, { folder, directory: true, expiresAt });
  for (const h of v.mp4Heights ?? []) out.mp4[h] = await signUrl(`${base}/play_${h}p.mp4`, { folder, expiresAt });
  out.thumb = await signUrl(`${base}/thumbnail.jpg`, { folder, expiresAt });
  return out;
}

/** What "Download" saves for a version: the render itself (file versions) or the largest MP4 copy up to 1080p. */
export async function downloadFor(x: Doc<"versions">): Promise<{ url: string; name: string; bytes: number | null } | null> {
  if (x.status !== "ready") return null;
  const m = await versionMedia(x);
  const h = Math.max(0, ...(x.mp4Heights ?? []).filter((n) => n <= 1080));
  const url = m.file ?? (h ? m.mp4[h] : null);
  if (!url) return null;
  const name = x.fileName && /\.mp4$/i.test(x.fileName) ? x.fileName : `${(x.fileName || "video").replace(/\.[^.]+$/, "")}_v${x.number}.mp4`;
  return { url, name, bytes: x.fileSize ?? null };
}
