// Uploading a new version: the browser sends the file straight to Bunny (resumable TUS upload);
// the backend creates the Bunny video, signs the upload, then polls Bunny until it's converted.
import { action, internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { bunnyCall, bunnyEnv, getBunnyVideo, type BunnyVideo } from "./bunny";
import { fpsFromFloat } from "./lib/frames";
import { httpRangeReader, mp4FrameCount } from "./lib/mp4";
import type { Id } from "./_generated/dataModel";
import { signUrl } from "./lib/media";
import { NEW_VERSION_DELAY_MS } from "./emails";
import { SITE_SLASH } from "./lib/site";

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MP4_HEIGHTS = [240, 360, 480, 720, 1080, 1440, 2160]; // 4K (Oct 23): copies up to 2160p when the library makes them
const POLL_MS = 10_000;
const MAX_POLLS = 720; // 2 hours

export const startUpload = action({
  args: { videoId: v.id("videos"), fileName: v.string(), fileSize: v.optional(v.number()) },
  handler: async (ctx, a): Promise<{ versionId: Id<"versions">; number: number; libraryId: string; videoId: string; expire: number; signature: string; endpoint: string }> => {
    const who: { name: string } = await ctx.runQuery(internal.users.assertAllowed, {});
    const { lib, key } = bunnyEnv();
    const title = a.fileName.slice(0, 200);
    const created = (await bunnyCall(`/library/${lib}/videos`, { method: "POST", body: JSON.stringify({ title }) })) as { guid?: string };
    if (!created.guid) throw new ConvexError("Bunny didn't create the video.");
    const { versionId, number }: { versionId: Id<"versions">; number: number } = await ctx.runMutation(internal.library.insertVersion, {
      videoId: a.videoId, bunnyGuid: created.guid, fileName: a.fileName, fileSize: a.fileSize, uploaderName: who.name,
    });
    const expire = Math.floor(Date.now() / 1000) + 24 * 3600;
    const signature = await sha256Hex(`${lib}${key}${expire}${created.guid}`);
    return { versionId, number, libraryId: lib, videoId: created.guid, expire, signature, endpoint: "https://video.bunnycdn.com/tusupload" };
  },
});

// Called by the browser when the upload finishes; also safe to call again.
export const uploadFinished = action({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { status: "processing", pollCount: 0 } });
    await ctx.scheduler.runAfter(2000, internal.uploads.poll, { versionId });
  },
});

export const uploadFailed = action({
  args: { versionId: v.id("versions"), error: v.string() },
  handler: async (ctx, { versionId, error }) => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { status: "failed", error: error.slice(0, 300) } });
  },
});

// For the CI check (public logs): how long converting took per version, with sizes and no names.
// Converting time is estimated from the number of 10-second checks between "upload finished" and "ready".
export const timings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const vs = await ctx.db.query("versions").collect();
    const tr = new Map((await ctx.db.query("transcripts").collect()).map((t) => [t.versionId, t]));
    return vs.filter((x) => x.status === "ready").map((x) => ({
      // Seconds from ready to the transcript finishing (only meaningful for a first, untouched run).
      transcriptSec: tr.get(x._id)?.status === "done" && x.readyAt ? Math.round((tr.get(x._id)!.updatedAt - x.readyAt) / 1000) : null,
      n: x.number,
      src: x.dropboxPath ? "dropbox" : "browser",
      ext: (x.fileName.split(".").pop() ?? "").toLowerCase().slice(0, 5),
      sizeMB: x.fileSize ? Math.round(x.fileSize / 1e6) : null,
      lenSec: x.lengthSeconds ? Math.round(x.lengthSeconds) : null,
      res: x.width && x.height ? `${x.width}x${x.height}` : null,
      fps: x.fpsNum && x.fpsDen ? +(x.fpsNum / x.fpsDen).toFixed(3) : null,
      checks: x.pollCount ?? null,
      convertMin: x.pollCount ? +((x.pollCount * 10.5) / 60).toFixed(1) : null,
      totalMin: x.readyAt ? +((x.readyAt - x.createdAt) / 60000).toFixed(1) : null,
      day: x.readyAt ? new Date(x.readyAt).toISOString().slice(5, 16) : null,
    }));
  },
});

// Ask Bunny how the conversion is going; reschedule until it's ready or failed.
export const poll = internalAction({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }): Promise<void> => {
    const row = await ctx.runQuery(internal.library.getVersionInternal, { versionId });
    if (!row || row.version.status === "ready" || row.version.status === "failed") return;
    const count = (row.version.pollCount ?? 0) + 1;
    let b;
    try {
      b = await getBunnyVideo(row.version.bunnyGuid);
    } catch (e) {
      if (count < MAX_POLLS) {
        await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { pollCount: count } });
        await ctx.scheduler.runAfter(POLL_MS, internal.uploads.poll, { versionId });
      }
      return;
    }
    const fps = fpsFromFloat(b.framerate);
    const failed = b.status === 5 || b.status === 8;
    const ready = (b.status === 3 || b.status === 4) && (b.encodeProgress ?? 0) >= 100;
    // Measurement (Oct 21): log what Bunny has made each time it changes (it also asks each MP4 copy whether it's there).
    const stages = await nextStages(row.version, b).catch(() => null);
    const lastStage = (stages ?? row.version.stages ?? []).slice(-1)[0];
    // Only MP4 copies that answer go on the version (Oct 26); the stage check keeps adding the rest as they appear.
    const mp4Heights = ready ? await answeringHeights(row.version.bunnyGuid, b, lastStage?.mp4 ?? row.version.mp4Heights ?? []) : [];
    const patch: Record<string, unknown> = {
      pollCount: count, encodeProgress: b.encodeProgress ?? 0, width: b.width || undefined, height: b.height || undefined,
      lengthSeconds: b.length || undefined, fpsNum: b.framerate ? fps.num : undefined, fpsDen: b.framerate ? fps.den : undefined, mp4Heights,
      ...(typeof b.storageSize === "number" ? { storageBytes: b.storageSize, storageCheckedAt: Date.now() } : {}),
    };
    if (failed) {
      patch.status = "failed";
      patch.error = "Bunny couldn't convert this file.";
    } else if (ready) {
      patch.status = "ready";
      patch.readyAt = Date.now();
    }
    if (stages) patch.stages = stages;
    await ctx.runMutation(internal.library.patchVersion, { versionId, patch });
    // Came from the Dropbox drop folder: once Bunny has the file (anything past "created"), delete the share link.
    if (row.version.dropboxPath && b.status !== 0 && (ready || failed || count % 3 === 1)) {
      await ctx.scheduler.runAfter(0, internal.dropbox.revokeForVersion, { versionId });
    }
    if (ready) {
      await ctx.scheduler.runAfter(0, internal.uploads.countFrames, { versionId, attempt: 0 });
      await ctx.scheduler.runAfter(0, internal.slack.versionReady, { versionId });
      await ctx.scheduler.runAfter(NEW_VERSION_DELAY_MS, internal.emails.newVersion, { versionId }); // C4
      // Transcribe straight away (it used to wait a minute for the frame count; now it counts frames itself if needed).
      if (process.env.ELEVENLABS_API_KEY) await ctx.runMutation(internal.transcripts.markPending, { versionId });
      await ctx.scheduler.runAfter(0, internal.transcribe.run, { versionId, attempt: 0 });
      // Waveform for the timeline, from the same MP4 copy.
      await ctx.runMutation(internal.waveforms.markPending, { versionId });
      await ctx.scheduler.runAfter(45_000, internal.waveform.run, { versionId, attempt: 0 });
      // Keep logging for a few minutes after "ready", in case the MP4 copies land later.
      await ctx.scheduler.runAfter(10_000, internal.uploads.stageCheck, { versionId, attempt: 0 });
    } else if (!failed && count < MAX_POLLS) {
      await ctx.scheduler.runAfter(POLL_MS, internal.uploads.poll, { versionId });
    }
  },
});

// Exact frame count, read from the converted MP4's index (a few small range reads, not a download).
// Bunny can finish its MP4 copies a little after the stream is ready, so this retries for ~10 minutes.
const streamCdn = () => process.env.BUNNY_STREAM_CDN || "vz-3ba0610b-f90.b-cdn.net";

// ---------- Measurement (Oct 21, Heston's "option 2") ----------
// Could a version open as soon as Bunny's 1080p copy is usable, instead of waiting for "ready"? To find out, every
// check while converting (and every 10 s for up to 3 minutes after) logs any change in Bunny's status, progress,
// the copies it lists, and which MP4 copies actually answer on the CDN. An MP4 is only asked for once Bunny lists
// that size, so the CDN isn't asked for files that can't exist yet.
type Stage = { t: number; s: number; p: number; res: string; mp4: number[] };
const CHECK_HEIGHTS = [360, 1080];
const listedHeights = (res: string | null | undefined) =>
  (res || "").split(",").map((x) => parseInt(x, 10)).filter((h) => CHECK_HEIGHTS.includes(h));

// The MP4 copies that actually answer right now (Bunny lists a resolution before its MP4 fallback file exists, and
// may never make one for 2160p). Only these go on the version, so the player is never handed a file that isn't there.
export async function answeringHeights(guid: string, b: Pick<BunnyVideo, "availableResolutions" | "hasMP4Fallback">, known: number[] = []): Promise<number[]> {
  if (!b.hasMP4Fallback) return [];
  const site = SITE_SLASH();
  const out: number[] = [];
  for (const h of MP4_HEIGHTS.filter((h) => listedHeights(b.availableResolutions).includes(h))) {
    if (known.includes(h)) { out.push(h); continue; } // seen already; files don't disappear
    try {
      const r = await fetch(await signUrl(`https://${streamCdn()}/${guid}/play_${h}p.mp4`), { method: "HEAD", headers: { Referer: site, Origin: new URL(site).origin } });
      if (r.ok) out.push(h);
    } catch { /* not there yet, or a blip */ }
  }
  return out;
}

export async function nextStages(version: { bunnyGuid: string; stages?: Stage[] }, b: BunnyVideo): Promise<Stage[] | null> {
  const prev = version.stages ?? [];
  const last = prev[prev.length - 1];
  const site = SITE_SLASH();
  const mp4 = await answeringHeights(version.bunnyGuid, { ...b, hasMP4Fallback: true }, last?.mp4 ?? []);
  void site;
  const e: Stage = { t: Date.now(), s: b.status, p: b.encodeProgress ?? 0, res: b.availableResolutions || "", mp4 };
  if (last && last.s === e.s && last.p === e.p && last.res === e.res && last.mp4.join() === e.mp4.join()) return null;
  return [...prev, e].slice(-80);
}

export const stageCheck = internalAction({
  args: { versionId: v.id("versions"), attempt: v.number() },
  handler: async (ctx, { versionId, attempt }): Promise<void> => {
    const row = await ctx.runQuery(internal.library.getVersionInternal, { versionId });
    if (!row) return;
    let b: BunnyVideo | null = null;
    try { b = await getBunnyVideo(row.version.bunnyGuid); } catch { /* try again next time */ }
    let stages = row.version.stages ?? [];
    if (b) {
      const next = await nextStages(row.version, b).catch(() => null);
      if (next) stages = next;
      const storage = typeof b.storageSize === "number" ? { storageBytes: b.storageSize, storageCheckedAt: Date.now() } : {};
      // Copies that have appeared since the version went ready join the list (and 2160p when Bunny ever makes it).
      const answering = (next ?? stages)[(next ?? stages).length - 1]?.mp4 ?? [];
      const merged = [...new Set([...(row.version.mp4Heights ?? []), ...answering])].sort((a, b) => a - b);
      const grew = merged.length !== (row.version.mp4Heights ?? []).length;
      if (next || grew || "storageBytes" in storage) await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { ...(next ? { stages } : {}), ...(grew ? { mp4Heights: merged } : {}), ...storage } });
    }
    const last = stages[stages.length - 1];
    const listed = listedHeights(last?.res);
    const settled = !!b && b.status === 3 && listed.length > 0 && listed.every((h) => last.mp4.includes(h));
    if (!settled && attempt < 18) await ctx.scheduler.runAfter(10_000, internal.uploads.stageCheck, { versionId, attempt: attempt + 1 });
  },
});

// For the CI check (public logs): the logged stages of the latest versions, as seconds after the first check.
// Each row: [seconds, Bunny status, progress %, copies listed, MP4s answering]. No names.
export const stageTimes = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const vs = (await ctx.db.query("versions").collect()).filter((x) => x.stages?.length).slice(-(limit ?? 5));
    return vs.map((x) => {
      const t0 = x.stages![0].t;
      return {
        n: x.number, src: x.dropboxPath ? "dropbox" : "browser", sizeMB: x.fileSize ? Math.round(x.fileSize / 1e6) : null,
        lenSec: x.lengthSeconds ? Math.round(x.lengthSeconds) : null, res: x.width && x.height ? `${x.width}x${x.height}` : null,
        readySec: x.readyAt ? Math.round((x.readyAt - t0) / 1000) : null,
        stages: x.stages!.map((s) => [Math.round((s.t - t0) / 1000), s.s, s.p, s.res, s.mp4.join("/")]),
      };
    });
  },
});

export const countFrames = internalAction({
  args: { versionId: v.id("versions"), attempt: v.number() },
  handler: async (ctx, { versionId, attempt }): Promise<{ frameCount: number | null; from?: string; error?: string }> => {
    const row = await ctx.runQuery(internal.library.getVersionInternal, { versionId });
    if (!row) return { frameCount: null, error: "no such version" };
    const heights = [...(row.version.mp4Heights ?? [])].sort((a, b) => b - a);
    if (!heights.length) return { frameCount: null, error: "no MP4 copy to read" };
    let lastError = "";
    for (const h of heights) {
      const url = await signUrl(`https://${streamCdn()}/${row.version.bunnyGuid}/play_${h}p.mp4`);
      try {
        const site = SITE_SLASH();
        const n = await mp4FrameCount(httpRangeReader(url, site));
        if (n) {
          await ctx.runMutation(internal.library.patchVersion, { versionId, patch: { frameCount: n, frameCountFrom: "file" } });
          return { frameCount: n, from: `${h}p MP4` };
        }
        lastError = `${h}p: no frame index found`;
      } catch (e) {
        lastError = `${h}p: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    if (attempt < 20) await ctx.scheduler.runAfter(30_000, internal.uploads.countFrames, { versionId, attempt: attempt + 1 });
    return { frameCount: null, error: lastError };
  },
});

// One-off: count frames for every ready version that only has the player's estimate. Returns counts only.
export const countAllFrames = internalAction({
  args: {},
  handler: async (ctx): Promise<{ frameCount: number | null; from?: string; error?: string }[]> => {
    const ids: Id<"versions">[] = await ctx.runQuery(internal.library.versionsNeedingCount, {});
    const out = [];
    for (const id of ids) out.push(await ctx.runAction(internal.uploads.countFrames, { versionId: id, attempt: 99 }));
    return out;
  },
});

async function scrubSize(guid: string): Promise<number | null> {
  const lib = process.env.BUNNY_SCRUB_LIBRARY_ID, key = process.env.BUNNY_SCRUB_API_KEY;
  if (!lib || !key) return null;
  const r = await fetch(`https://video.bunnycdn.com/library/${lib}/videos/${encodeURIComponent(guid)}`, { headers: { AccessKey: key, accept: "application/json" } });
  if (!r.ok) return null;
  const j = await r.json() as { storageSize?: number };
  return typeof j.storageSize === "number" ? j.storageSize : null;
}

// Bunny storage per version (R2b): refreshed once a day, since Bunny's copies keep landing after "ready".
// Returns counts only (safe for the public CI log).
export const refreshStorage = internalAction({
  args: { all: v.optional(v.boolean()) },
  handler: async (ctx, { all }): Promise<{ checked: number; updated: number; failed: number }> => {
    const due: Array<{ _id: Id<"versions">; bunnyGuid: string; scrubGuid: string | null; fileSize: number }> = await ctx.runQuery(internal.library.versionsForStorage, { all: all ?? false });
    let updated = 0, failed = 0;
    for (const ver of due) {
      try {
        // A review render (R3): the file in Bunny Storage plus its 360p scrub copy (whose size lands after "ready").
        if (ver.scrubGuid) {
          const s = await scrubSize(ver.scrubGuid);
          if (s !== null) { await ctx.runMutation(internal.library.patchVersion, { versionId: ver._id, patch: { storageBytes: ver.fileSize + s, storageCheckedAt: Date.now() } }); updated++; }
          continue;
        }
        const b = await getBunnyVideo(ver.bunnyGuid);
        if (typeof b.storageSize === "number") {
          await ctx.runMutation(internal.library.patchVersion, { versionId: ver._id, patch: { storageBytes: b.storageSize, storageCheckedAt: Date.now() } });
          updated++;
        }
      } catch { failed++; }
    }
    return { checked: due.length, updated, failed };
  },
});

// 4K (Oct 23): after the library's encoding settings change and a video is re-encoded on Bunny, pick up the new
// copies (e.g. 2160p) on versions that are already "ready". Run from CI with { all: true } or one versionId.
export const refreshHeights = internalAction({
  args: { versionId: v.optional(v.id("versions")), all: v.optional(v.boolean()) },
  handler: async (ctx, { versionId, all }): Promise<{ checked: number; updated: number; heights: Record<string, number[]> }> => {
    const rows: Array<{ _id: Id<"versions">; bunnyGuid: string; mp4Heights: number[]; streamOnly?: boolean }> = await ctx.runQuery(internal.library.versionsForHeights, { versionId: versionId ?? null, all: all ?? false });
    let updated = 0; const heights: Record<string, number[]> = {};
    for (const ver of rows) {
      const b = await getBunnyVideo(ver.bunnyGuid);
      const mp4Heights = await answeringHeights(ver.bunnyGuid, b);
      heights[ver._id.slice(0, 6)] = mp4Heights;
      // A version marked stream-only because a copy wasn't there yet gets its files back once they answer.
      const unmark = ver.streamOnly && mp4Heights.length > 0;
      if (JSON.stringify(mp4Heights) !== JSON.stringify(ver.mp4Heights) || unmark) {
        await ctx.runMutation(internal.library.patchVersion, { versionId: ver._id, patch: { mp4Heights, width: b.width || undefined, height: b.height || undefined, ...(unmark ? { streamOnly: undefined } : {}) } });
        updated++;
      }
    }
    return { checked: rows.length, updated, heights };
  },
});
