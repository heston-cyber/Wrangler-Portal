// Bunny Stream helpers. Internal only: run from the CLI (CI workflow), never from the browser.
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

const API = "https://video.bunnycdn.com";

function env() {
  const lib = process.env.BUNNY_STREAM_LIBRARY_ID;
  const key = process.env.BUNNY_STREAM_API_KEY;
  if (!lib || !key) throw new Error("Set BUNNY_STREAM_LIBRARY_ID and BUNNY_STREAM_API_KEY in Convex environment variables");
  return { lib, key };
}

async function call(path: string, init: RequestInit = {}) {
  const { key } = env();
  const res = await fetch(API + path, {
    ...init,
    headers: { AccessKey: key, accept: "application/json", "content-type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) throw new Error(`Bunny ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

// Bunny status codes: 0 queued, 1 processing, 2 encoding, 3 finished, 4 resolution finished, 5 failed.
const summarize = (x: any) => ({
  guid: x.guid,
  title: x.title,
  status: x.status,
  encodeProgress: x.encodeProgress,
  framerate: x.framerate,
  width: x.width,
  height: x.height,
  lengthSeconds: x.length,
  availableResolutions: x.availableResolutions,
  hasMP4Fallback: x.hasMP4Fallback,
  storageSize: x.storageSize,
  dateUploaded: x.dateUploaded,
});

export const importFromUrl = internalAction({
  args: { url: v.string(), title: v.string() },
  handler: async (_ctx, { url, title }) => {
    const { lib } = env();
    return await call(`/library/${lib}/videos/fetch`, { method: "POST", body: JSON.stringify({ url, title }) });
  },
});

export const listVideos = internalAction({
  args: {},
  handler: async () => {
    const { lib } = env();
    const body: any = await call(`/library/${lib}/videos?page=1&itemsPerPage=50&orderBy=date`);
    return (body.items || []).map(summarize);
  },
});

export const getVideo = internalAction({
  args: { guid: v.string() },
  handler: async (_ctx, { guid }) => {
    const { lib } = env();
    const body: any = await call(`/library/${lib}/videos/${guid}`);
    return { ...summarize(body), raw: body };
  },
});
