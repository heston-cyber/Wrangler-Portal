"use node";
// Render-to-review (R3, Oct 22): a review export goes from Dropbox straight into Bunny Storage, untouched, and is
// played from there. Streams, never holds the file in memory (Node actions get 512 MB and 10 minutes; a 1 GB file
// copies in about a minute). Then the scrub library makes a small 360p copy for dragging.
import { internal } from "./_generated/api";
import { internalAction } from "./lib/functions";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import https from "node:https";
import { Readable } from "node:stream";
import { encPath, reviewStorage } from "./lib/reviewStorage";
import { signUrl } from "./lib/media";
import { streamFolder } from "./lib/bunnySign";
import { SITE } from "./lib/site";
import { isBig, listedResolutions } from "./lib/quality";

const MAX_COPY_TRIES = 3;
const SCRUB_POLL_MS = 10_000;
const SCRUB_MAX_POLLS = 120; // ~20 minutes

function storage() {
  const z = reviewStorage();
  if (!z) throw new Error("Bunny Storage isn't set up.");
  return z;
}

function scrubLib() {
  const lib = process.env.BUNNY_SCRUB_LIBRARY_ID, key = process.env.BUNNY_SCRUB_API_KEY, cdn = process.env.BUNNY_SCRUB_CDN;
  return lib && key && cdn ? { lib, key, cdn } : null;
}
async function scrubCall(path: string, init: RequestInit = {}) {
  const s = scrubLib()!;
  const res = await fetch(`https://video.bunnycdn.com/library/${s.lib}${path}`, {
    ...init, headers: { AccessKey: s.key, accept: "application/json", "content-type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bunny scrub library ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

export const copy = internalAction({
  args: { versionId: v.id("versions"), dropboxPath: v.string(), size: v.number(), attempt: v.number() },
  handler: async (ctx, { versionId, dropboxPath, size, attempt }): Promise<{ result: string }> => {
    const row = await ctx.runQuery(internal.library.getVersionInternal, { versionId });
    if (!row) return { result: "version gone" };
    const ver = row.version;
    if (!ver.storagePath) return { result: "no storage path" };
    if (ver.status === "ready" && ver.fileUrl) return { result: "already copied" };
    const t0 = Date.now();
    try {
      const bs = storage();
      const token: string = await ctx.runAction(internal.dropbox.freshToken, {});
      const dl = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": JSON.stringify({ path: dropboxPath }) },
      });
      if (!dl.ok || !dl.body) throw new Error(`Dropbox download ${dl.status}`);
      const length = Number(dl.headers.get("content-length") ?? size);
      const status: number = await new Promise((resolve, reject) => {
        const req = https.request(
          { method: "PUT", host: bs.host, path: `/${bs.zone}/${encPath(ver.storagePath!)}`, headers: { AccessKey: bs.password, "content-type": "video/mp4", "content-length": String(length) } },
          (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); },
        );
        req.on("error", reject);
        Readable.fromWeb(dl.body as any).on("error", reject).pipe(req);
      });
      if (status < 200 || status >= 300) throw new Error(`Bunny Storage answered ${status}`);
      const fileUrl = `https://${bs.cdn}/${encPath(ver.storagePath)}`;
      // The CDN only answers the site's own address (allowed referrers, since Oct 28), so the check says it comes from there.
      const site = `${SITE()}/`;
      const head = await fetch(await signUrl(fileUrl), { headers: { Range: "bytes=0-1", Referer: site, Origin: new URL(site).origin } });
      await head.arrayBuffer();
      if (head.status !== 206 && head.status !== 200) throw new Error(`The CDN answered ${head.status} for the copy`);
      await ctx.runMutation(internal.dropbox.fileReady, { versionId, fileUrl, bytes: length, copyMs: Date.now() - t0 });
      return { result: `copied ${Math.round(length / 1e6)} MB in ${Math.round((Date.now() - t0) / 1000)} s` };
    } catch (e) {
      const msg = ((e as Error).message || String(e)).slice(0, 300);
      if (attempt + 1 < MAX_COPY_TRIES) {
        await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { copyError: msg } });
        await ctx.scheduler.runAfter(15_000 * (attempt + 1), internal.reviewFiles.copy, { versionId, dropboxPath, size, attempt: attempt + 1 });
        return { result: `retrying: ${msg}` };
      }
      await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { status: "failed", error: `Couldn't copy the render: ${msg}`, copyError: msg } });
      return { result: `failed: ${msg}` };
    }
  },
});

// Sends the stored render to the scrub library, which makes only a 360p copy. Skipped until BUNNY_SCRUB_* are set.
export const startScrub = internalAction({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }): Promise<{ result: string }> => {
    const s = scrubLib();
    if (!s) return { result: "no scrub library yet" };
    const row = await ctx.runQuery(internal.library.getVersionInternal, { versionId });
    if (!row?.version.fileUrl) return { result: "no file" };
    if (row.version.scrubGuid && row.version.scrubStatus !== "failed") return { result: "already has one" };
    const tag = `wr-scrub-${versionId}`;
    try {
      // Bunny fetches the render from our CDN, which only answers the site's own address: send it as the referrer.
      const fetched = await scrubCall("/videos/fetch", { method: "POST", body: JSON.stringify({ url: await signUrl(row.version.fileUrl), title: tag, headers: { Referer: `${SITE()}/` } }) }) as { id?: string };
      let guid: string | null = typeof fetched?.id === "string" && fetched.id ? fetched.id : null;
      for (let i = 0; i < 20 && !guid; i++) {
        await new Promise((r) => setTimeout(r, i === 0 ? 1500 : 3000));
        const found = await scrubCall(`/videos?page=1&itemsPerPage=10&search=${encodeURIComponent(tag)}`) as { items?: Array<{ guid: string; title: string }> };
        guid = found.items?.find((x) => x.title === tag)?.guid ?? null;
      }
      if (!guid) throw new Error("The scrub library didn't start the copy.");
      await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { scrubGuid: guid, scrubStatus: "pending", scrubPolls: 0 } });
      await ctx.scheduler.runAfter(SCRUB_POLL_MS, internal.reviewFiles.pollScrub, { versionId });
      return { result: "scrub copy started" };
    } catch (e) {
      await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { scrubStatus: "failed" } });
      return { result: `scrub failed: ${(e as Error).message}` };
    }
  },
});

// Nov 4 (Heston): a render bigger than 1080p plays at 1080p by default once the scrub library has made its 1080p copy
// (the library makes 360p and 1080p). Versions made before the quality choice wait for the 360p copy only, as before.
const wants1080 = (x: { qualityMenu?: boolean; width?: number; height?: number }) => !!x.qualityMenu && isBig(x.width, x.height);
const SCRUB_MAX_POLLS_1080 = 360; // ~1 hour: a long 4K render's 1080p copy takes a while

/** Does this copy answer on the scrub library's CDN? (A two-byte range, from the site's own address.) */
async function scrubAnswers(cdn: string, guid: string, h: number, folder: boolean): Promise<boolean> {
  const url = `https://${cdn}/${guid}/play_${h}p.mp4`;
  // Signed since C3 (Oct 23): the scrub zone needs a token too. (Unsigned, this was 403 and every copy "failed".)
  const r = await fetch(await signUrl(url, folder ? { folder: streamFolder(guid) } : {}), { headers: { Range: "bytes=0-1", Referer: `${SITE()}/` } });
  await r.arrayBuffer();
  return r.status === 206 || r.status === 200;
}

export const pollScrub = internalAction({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }): Promise<{ result: string }> => {
    const s = scrubLib();
    const row = await ctx.runQuery(internal.library.getVersionInternal, { versionId });
    const ver = row?.version;
    if (!s || !ver?.scrubGuid) return { result: "nothing to do" };
    const need1080 = wants1080(ver) && !(ver.scrubHeights ?? []).includes(1080);
    const pending = ver.scrubStatus === "pending";
    if (!pending && !(ver.scrubStatus === "ready" && need1080)) return { result: "nothing to do" };
    const polls = (ver.scrubPolls ?? 0) + 1;
    try {
      const b = await scrubCall(`/videos/${encodeURIComponent(ver.scrubGuid)}`) as { status: number; encodeProgress?: number; availableResolutions?: string | null; storageSize?: number };
      if (b.status === 5 || b.status === 8) {
        if (pending) {
          await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { scrubStatus: "failed", scrubPolls: polls } });
          return { result: "scrub copy failed" };
        }
        await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { scrubPolls: polls } });
        return { result: "1080p copy failed" }; // the render keeps playing at full size
      }
      const listed = listedResolutions(b.availableResolutions);
      const heights = new Set(ver.scrubHeights ?? []);
      const patch: Record<string, unknown> = {};
      if (pending && (b.status === 3 || b.status === 4) && listed.includes(360) && await scrubAnswers(s.cdn, ver.scrubGuid, 360, true)) {
        const total = (ver.fileSize ?? 0) + (b.storageSize ?? 0);
        Object.assign(patch, { scrubStatus: "ready", scrubReadyAt: Date.now(), storageBytes: total, storageCheckedAt: Date.now() });
        heights.add(360);
      }
      // The 1080p copy: signed for its one file, the way the page gets it.
      if (need1080 && (b.status === 3 || b.status === 4) && listed.includes(1080) && await scrubAnswers(s.cdn, ver.scrubGuid, 1080, false)) {
        heights.add(1080);
        if (typeof b.storageSize === "number") Object.assign(patch, { storageBytes: (ver.fileSize ?? 0) + b.storageSize, storageCheckedAt: Date.now() });
      }
      if (ver.qualityMenu && heights.size !== (ver.scrubHeights ?? []).length) patch.scrubHeights = [...heights].sort((a, c) => a - c);
      const ready360 = pending ? patch.scrubStatus === "ready" : true;
      const done1080 = !wants1080(ver) || heights.has(1080);
      // Bunny finished without a 1080p copy: the library isn't set to make one, so stop waiting for it.
      const no1080 = b.status === 3 && !listed.includes(1080);
      if (ready360 && (done1080 || no1080)) {
        await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { ...patch, scrubPolls: polls } });
        return { result: !pending ? (done1080 ? "1080p copy ready" : "no 1080p copy") : done1080 ? "scrub copy ready" : "scrub copy ready (no 1080p copy)" };
      }
      if (Object.keys(patch).length) await ctx.runMutation(internal.library.patchVersion, { versionId, patch });
    } catch { /* try again */ }
    const latest = (await ctx.runQuery(internal.library.getVersionInternal, { versionId }))?.version;
    const stillPending = latest?.scrubStatus === "pending";
    if (stillPending && polls >= SCRUB_MAX_POLLS) {
      await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { scrubStatus: "failed", scrubPolls: polls } });
      return { result: "scrub copy never finished" };
    }
    if (!stillPending && polls >= SCRUB_MAX_POLLS_1080) {
      await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { scrubPolls: polls } });
      return { result: "1080p copy never finished" };
    }
    await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { scrubPolls: polls } });
    await ctx.scheduler.runAfter(SCRUB_POLL_MS, internal.reviewFiles.pollScrub, { versionId });
    return { result: stillPending ? "waiting" : "waiting for the 1080p copy" };
  },
});

// Scrub copies marked "failed" while the ready check was unsigned (Oct 23–26): look at them again (CI, counts only).
export const repollScrub = internalAction({
  args: {},
  handler: async (ctx): Promise<{ repolled: number; started: number }> => {
    const rows: Array<{ _id: Id<"versions">; scrubGuid?: string; scrubStatus?: string; fileUrl?: string }> = await ctx.runQuery(internal.library.fileVersionsNeedingScrub, {});
    let repolled = 0, started = 0;
    for (const r of rows) {
      if (r.scrubGuid) {
        await ctx.runMutation(internal.library.patchVersion, { versionId: r._id, patch: { scrubStatus: "pending", scrubPolls: 0 } });
        await ctx.scheduler.runAfter(0, internal.reviewFiles.pollScrub, { versionId: r._id });
        repolled++;
      } else if (r.fileUrl) {
        await ctx.scheduler.runAfter(0, internal.reviewFiles.startScrub, { versionId: r._id });
        started++;
      }
    }
    return { repolled, started };
  },
});

// For versions made before the scrub library existed: start their scrub copies (CI, counts only).
export const backfillScrub = internalAction({
  args: {},
  handler: async (ctx): Promise<{ started: number }> => {
    if (!scrubLib()) return { started: 0 };
    const ids: string[] = await ctx.runQuery(internal.dropbox.fileVersionsWithoutScrub, {});
    for (const id of ids) await ctx.scheduler.runAfter(0, internal.reviewFiles.startScrub, { versionId: id as any });
    return { started: ids.length };
  },
});

// Live check of where review renders go (CI, statuses only): writes a tiny file under review/_check, reads it
// back through the CDN (with a range, like the player), checks the CORS header, removes it. Also checks the
// scrub library answers.
export const check = internalAction({
  args: {},
  handler: async () => {
    const z = reviewStorage();
    const out: Record<string, unknown> = { storage: z ? (z.own ? "own zone" : "stills zone") : "not set up", scrubLibrary: scrubLib() ? "set" : "not set" };
    if (z) {
      const path = `review/_check/${Date.now()}.mp4`;
      const body = new Uint8Array(4096).fill(7);
      const put = await fetch(`https://${z.host}/${z.zone}/${path}`, { method: "PUT", headers: { AccessKey: z.password, "content-type": "video/mp4" }, body });
      out.write = put.status;
      if (put.ok) {
        const got = await fetch(`https://${z.cdn}/${path}`, { headers: { Range: "bytes=0-99", Origin: SITE() } });
        const buf = new Uint8Array(await got.arrayBuffer());
        out.cdnRange = got.status;
        out.rangeBytes = buf.length;
        out.cors = got.headers.get("access-control-allow-origin") ?? "none";
        out.acceptRanges = got.headers.get("accept-ranges") ?? "none";
      }
      const del = await fetch(`https://${z.host}/${z.zone}/${path}`, { method: "DELETE", headers: { AccessKey: z.password } });
      out.cleanedUp = del.status;
    }
    if (scrubLib()) {
      try { const r = await scrubCall("/videos?page=1&itemsPerPage=1") as { totalItems?: number }; out.scrubList = "ok"; out.scrubVideos = r.totalItems ?? 0; }
      catch (e) { out.scrubList = (e as Error).message.replace(/:.*/, ""); }
    }
    return out;
  },
});
