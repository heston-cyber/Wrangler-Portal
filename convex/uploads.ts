// Uploading a new version: the browser sends the file straight to Bunny (resumable TUS upload);
// the backend creates the Bunny video, signs the upload, then polls Bunny until it's converted.
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { bunnyCall, bunnyEnv, getBunnyVideo } from "./bunny";
import { fpsFromFloat } from "./lib/frames";
import { httpRangeReader, mp4FrameCount } from "./lib/mp4";
import type { Id } from "./_generated/dataModel";

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MP4_HEIGHTS = [240, 360, 480, 720, 1080];
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
    const res = (b.availableResolutions || "").split(",").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
    const mp4Heights = b.hasMP4Fallback ? MP4_HEIGHTS.filter((h) => res.includes(h)) : [];
    const patch: Record<string, unknown> = {
      pollCount: count, encodeProgress: b.encodeProgress ?? 0, width: b.width || undefined, height: b.height || undefined,
      lengthSeconds: b.length || undefined, fpsNum: b.framerate ? fps.num : undefined, fpsDen: b.framerate ? fps.den : undefined, mp4Heights,
    };
    const failed = b.status === 5 || b.status === 8;
    const ready = (b.status === 3 || b.status === 4) && (b.encodeProgress ?? 0) >= 100;
    if (failed) {
      patch.status = "failed";
      patch.error = "Bunny couldn't convert this file.";
    } else if (ready) {
      patch.status = "ready";
      patch.readyAt = Date.now();
    }
    await ctx.runMutation(internal.library.patchVersion, { versionId, patch });
    // Came from the Dropbox drop folder: once Bunny has the file (anything past "created"), delete the share link.
    if (row.version.dropboxPath && b.status !== 0 && (ready || failed || count % 3 === 1)) {
      await ctx.scheduler.runAfter(0, internal.dropbox.revokeForVersion, { versionId });
    }
    if (ready) {
      await ctx.scheduler.runAfter(0, internal.uploads.countFrames, { versionId, attempt: 0 });
      await ctx.scheduler.runAfter(0, internal.slack.versionReady, { versionId });
      // Transcribe after the frame count has had a moment, so words can be clamped to the last frame.
      await ctx.scheduler.runAfter(60_000, internal.transcribe.run, { versionId, attempt: 0 });
    } else if (!failed && count < MAX_POLLS) {
      await ctx.scheduler.runAfter(POLL_MS, internal.uploads.poll, { versionId });
    }
  },
});

// Exact frame count, read from the converted MP4's index (a few small range reads, not a download).
// Bunny can finish its MP4 copies a little after the stream is ready, so this retries for ~10 minutes.
const streamCdn = () => process.env.BUNNY_STREAM_CDN || "vz-3ba0610b-f90.b-cdn.net";

export const countFrames = internalAction({
  args: { versionId: v.id("versions"), attempt: v.number() },
  handler: async (ctx, { versionId, attempt }): Promise<{ frameCount: number | null; from?: string; error?: string }> => {
    const row = await ctx.runQuery(internal.library.getVersionInternal, { versionId });
    if (!row) return { frameCount: null, error: "no such version" };
    const heights = [...(row.version.mp4Heights ?? [])].sort((a, b) => b - a);
    if (!heights.length) return { frameCount: null, error: "no MP4 copy to read" };
    let lastError = "";
    for (const h of heights) {
      const url = `https://${streamCdn()}/${row.version.bunnyGuid}/play_${h}p.mp4`;
      try {
        const site = (process.env.SITE_URL || "https://review.wranglerportal.com").replace(/\/?$/, "/");
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
