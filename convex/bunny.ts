// Bunny Stream helpers. Internal only: called by uploads.ts, or from the CLI (CI workflow) for checks.
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

const API = "https://video.bunnycdn.com";

export function bunnyEnv() {
  const lib = process.env.BUNNY_STREAM_LIBRARY_ID;
  const key = process.env.BUNNY_STREAM_API_KEY;
  if (!lib || !key) throw new Error("Set BUNNY_STREAM_LIBRARY_ID and BUNNY_STREAM_API_KEY in Convex environment variables");
  return { lib, key };
}

export async function bunnyCall(path: string, init: RequestInit = {}) {
  const { key } = bunnyEnv();
  const res = await fetch(API + path, {
    ...init,
    headers: { AccessKey: key, accept: "application/json", "content-type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) throw new Error(`Bunny ${res.status}: ${typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  return body;
}

// Bunny status codes: 0 queued, 1 processing, 2 encoding, 3 finished, 4 resolution finished, 5 failed,
// 6 presigned upload started, 7 presigned upload finished, 8 presigned upload failed.
export type BunnyVideo = {
  guid: string; title: string; status: number; encodeProgress: number; framerate: number;
  width: number; height: number; length: number; availableResolutions: string | null; hasMP4Fallback: boolean;
  storageSize?: number;
};

export async function getBunnyVideo(guid: string): Promise<BunnyVideo> {
  const { lib } = bunnyEnv();
  return (await bunnyCall(`/library/${lib}/videos/${encodeURIComponent(guid)}`)) as BunnyVideo;
}

const summarize = (x: any) => ({
  guid: x.guid, title: x.title, status: x.status, encodeProgress: x.encodeProgress, framerate: x.framerate,
  width: x.width, height: x.height, lengthSeconds: x.length, availableResolutions: x.availableResolutions,
  hasMP4Fallback: x.hasMP4Fallback, storageSize: x.storageSize, dateUploaded: x.dateUploaded,
});

export const importFromUrl = internalAction({
  args: { url: v.string(), title: v.string() },
  handler: async (_ctx, { url, title }) => {
    const { lib } = bunnyEnv();
    return await bunnyCall(`/library/${lib}/videos/fetch`, { method: "POST", body: JSON.stringify({ url, title }) });
  },
});

export const listVideos = internalAction({
  args: {},
  handler: async () => {
    const { lib } = bunnyEnv();
    const body: any = await bunnyCall(`/library/${lib}/videos?page=1&itemsPerPage=50&orderBy=date`);
    return (body.items || []).map(summarize);
  },
});

export const getVideo = internalAction({
  args: { guid: v.string() },
  handler: async (_ctx, { guid }) => summarize(await getBunnyVideo(guid)),
});

// Which services are connected (names only, never values). Safe to run from the public CI log.
export const configStatus = internalAction({
  args: {},
  handler: async () => {
    const names = ["BUNNY_STREAM_LIBRARY_ID", "BUNNY_STREAM_API_KEY", "BUNNY_STORAGE_PASSWORD", "BUNNY_STORAGE_HOST", "BUNNY_STORAGE_ZONE", "BUNNY_STILLS_CDN", "BUNNY_REVIEW_STORAGE_ZONE", "BUNNY_REVIEW_STORAGE_PASSWORD", "BUNNY_REVIEW_STORAGE_HOST", "BUNNY_REVIEW_CDN", "BUNNY_SCRUB_LIBRARY_ID", "BUNNY_SCRUB_API_KEY", "BUNNY_SCRUB_CDN", "BUNNY_STILLS_TOKEN_KEY", "BUNNY_STREAM_TOKEN_KEY", "BUNNY_SCRUB_TOKEN_KEY", "SLACK_WEBHOOK_URL", "DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "ELEVENLABS_API_KEY", "ALLOWED_EMAILS", "SITE_URL", "JWT_PRIVATE_KEY", "JWKS"];
    return Object.fromEntries(names.map((n) => [n, Boolean(process.env[n])]));
  },
});
