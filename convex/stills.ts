// Note stills (the frame, with the drawing burned in). Stored in Bunny Storage once it's set up,
// otherwise in Convex storage. Either way the note keeps a plain URL.
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { bunnyCall, bunnyEnv } from "./bunny";
import { encPath, reviewZones } from "./lib/reviewStorage";

const MAX_BYTES = 4_000_000;

function bunnyStorage() {
  const password = process.env.BUNNY_STORAGE_PASSWORD;
  const host = process.env.BUNNY_STORAGE_HOST; // e.g. ny.storage.bunnycdn.com
  const zone = process.env.BUNNY_STORAGE_ZONE; // e.g. wrangler-review-stills
  const cdn = process.env.BUNNY_STILLS_CDN; // e.g. wrangler-review-stills.b-cdn.net
  return password && host && zone && cdn ? { password, host, zone, cdn } : null;
}

function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Round trip check for Bunny Storage: writes a tiny test file, reads it back through the CDN, then
// removes it. Returns status codes only (safe for the public CI log).
export const storageCheck = internalAction({
  args: {},
  handler: async () => {
    const bs = bunnyStorage();
    if (!bs) return { configured: false };
    const path = `stills/_check/${randomId()}.txt`;
    const body = `wrangler-review check ${Date.now()}`;
    const put = await fetch(`https://${bs.host}/${bs.zone}/${path}`, {
      method: "PUT",
      headers: { AccessKey: bs.password, "content-type": "application/octet-stream" },
      body,
    });
    let cdnStatus = 0, matches = false;
    if (put.ok) {
      const got = await fetch(`https://${bs.cdn}/${path}`);
      cdnStatus = got.status;
      matches = got.ok && (await got.text()) === body;
    }
    const del = await fetch(`https://${bs.host}/${bs.zone}/${path}`, { method: "DELETE", headers: { AccessKey: bs.password } });
    return { configured: true, storageWrite: put.status, cdnRead: cdnStatus, matches, cleanedUp: del.status };
  },
});

export const upload = action({
  args: { dataBase64: v.string(), contentType: v.union(v.literal("image/jpeg"), v.literal("image/png")) },
  handler: async (ctx, { dataBase64, contentType }): Promise<string> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    const bytes = decodeBase64(dataBase64);
    if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new ConvexError("That still is too big.");
    const ext = contentType === "image/png" ? "png" : "jpg";
    const bs = bunnyStorage();
    if (bs) {
      const d = new Date();
      const path = `stills/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomId()}.${ext}`;
      const res = await fetch(`https://${bs.host}/${bs.zone}/${path}`, {
        method: "PUT",
        headers: { AccessKey: bs.password, "content-type": "application/octet-stream" },
        body: bytes,
      });
      if (!res.ok) throw new ConvexError(`Couldn't save the still (Bunny ${res.status}).`);
      return `https://${bs.cdn}/${path}`;
    }
    const storageId = await ctx.storage.store(new Blob([bytes], { type: contentType }));
    await ctx.runMutation(internal.stillsDb.record, { storageId });
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new ConvexError("Couldn't save the still.");
    return url;
  },
});

// After a version is deleted: removes its Bunny Stream video (when nothing else uses it) and its stills.
// Only touches files on our own stills CDN / storage zone.
export const cleanup = internalAction({
  args: { bunnyGuid: v.union(v.string(), v.null()), stillUrls: v.array(v.string()) },
  handler: async (_ctx, { bunnyGuid, stillUrls }) => {
    const out = { video: "kept", stills: 0 };
    // R3: "storage:<path>" is a render in the Storage zone; "scrub:<guid>" is its 360p copy in the scrub library.
    if (bunnyGuid?.startsWith("storage:")) {
      const path = bunnyGuid.slice("storage:".length);
      if (/^review\/[\w/.-]+$/.test(path) && !path.includes("..")) {
        // The render is in the review zone (or the stills zone, before it had its own): delete wherever it is.
        out.video = "already gone";
        for (const z of reviewZones()) {
          const res = await fetch(`https://${z.host}/${z.zone}/${encPath(path)}`, { method: "DELETE", headers: { AccessKey: z.password } });
          if (res.ok) out.video = "deleted";
          else if (res.status !== 404) out.video = `storage ${res.status}`;
        }
      }
      bunnyGuid = null;
    } else if (bunnyGuid?.startsWith("scrub:")) {
      const lib = process.env.BUNNY_SCRUB_LIBRARY_ID, key = process.env.BUNNY_SCRUB_API_KEY;
      if (lib && key) {
        const res = await fetch(`https://video.bunnycdn.com/library/${lib}/videos/${encodeURIComponent(bunnyGuid.slice(6))}`, { method: "DELETE", headers: { AccessKey: key } });
        out.video = res.ok ? "deleted" : res.status === 404 ? "already gone" : `scrub ${res.status}`;
      }
      bunnyGuid = null;
    }
    if (bunnyGuid) {
      const { lib } = bunnyEnv();
      await bunnyCall(`/library/${lib}/videos/${encodeURIComponent(bunnyGuid)}`, { method: "DELETE" }).then(() => { out.video = "deleted"; }).catch(() => { out.video = "already gone"; });
    }
    const bs = bunnyStorage();
    if (bs) {
      for (const u of stillUrls) {
        const prefix = `https://${bs.cdn}/`;
        if (!u.startsWith(prefix)) continue;
        const path = u.slice(prefix.length);
        if (!/^stills\/[\w/.-]+$/.test(path)) continue;
        const res = await fetch(`https://${bs.host}/${bs.zone}/${path}`, { method: "DELETE", headers: { AccessKey: bs.password } });
        if (res.ok || res.status === 404) out.stills++;
      }
    }
    return out;
  },
});
