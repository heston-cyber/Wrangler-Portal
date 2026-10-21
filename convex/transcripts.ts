// Transcript bookkeeping (the ElevenLabs call itself is in transcribe.ts, which runs in Node for the memory).
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireMe } from "./lib/access";
import { findVideo, pickVersion, versionInfo } from "./connector";

export const begin = internalMutation({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    const row = await ctx.db.query("transcripts").withIndex("by_version", (q) => q.eq("versionId", versionId)).first();
    const now = Date.now();
    if (row) {
      await ctx.db.patch(row._id, { status: "running", attempts: row.attempts + 1, updatedAt: now, error: undefined });
      return row.attempts + 1;
    }
    await ctx.db.insert("transcripts", { versionId, status: "running", attempts: 1, updatedAt: now });
    return 1;
  },
});

export const markPending = internalMutation({
  args: { versionId: v.id("versions"), note: v.optional(v.string()) },
  handler: async (ctx, { versionId, note }) => {
    const row = await ctx.db.query("transcripts").withIndex("by_version", (q) => q.eq("versionId", versionId)).first();
    if (row) await ctx.db.patch(row._id, { status: "pending", error: note, updatedAt: Date.now() });
    else await ctx.db.insert("transcripts", { versionId, status: "pending", error: note, attempts: 0, updatedAt: Date.now() });
  },
});

export const finish = internalMutation({
  args: { versionId: v.id("versions"), storageId: v.id("_storage"), language: v.optional(v.string()), wordCount: v.number(), segmentCount: v.number(), model: v.string() },
  handler: async (ctx, a) => {
    const row = await ctx.db.query("transcripts").withIndex("by_version", (q) => q.eq("versionId", a.versionId)).first();
    const patch = { status: "done" as const, storageId: a.storageId, language: a.language, wordCount: a.wordCount, segmentCount: a.segmentCount, model: a.model, error: undefined, updatedAt: Date.now() };
    if (row) {
      if (row.storageId && row.storageId !== a.storageId) await ctx.storage.delete(row.storageId);
      await ctx.db.patch(row._id, patch);
    } else await ctx.db.insert("transcripts", { versionId: a.versionId, attempts: 1, ...patch });
  },
});

export const fail = internalMutation({
  args: { versionId: v.id("versions"), error: v.string() },
  handler: async (ctx, { versionId, error }) => {
    const row = await ctx.db.query("transcripts").withIndex("by_version", (q) => q.eq("versionId", versionId)).first();
    if (row) await ctx.db.patch(row._id, { status: "failed", error: error.slice(0, 300), updatedAt: Date.now() });
    else await ctx.db.insert("transcripts", { versionId, status: "failed", error: error.slice(0, 300), attempts: 1, updatedAt: Date.now() });
  },
});

// Transcribe every ready version that doesn't have a transcript yet (run once from CI after setup). Returns a count.
export const backfill = internalMutation({
  args: {},
  handler: async (ctx) => {
    let n = 0;
    for (const ver of await ctx.db.query("versions").collect()) {
      if (ver.status !== "ready") continue;
      const t = await ctx.db.query("transcripts").withIndex("by_version", (q) => q.eq("versionId", ver._id)).first();
      if (t && t.status !== "failed") continue;
      await ctx.scheduler.runAfter(n * 20_000, internal.transcribe.run, { versionId: ver._id, attempt: 0 });
      n++;
    }
    return { scheduled: n };
  },
});

// For the CI check: how transcripts are doing. Counts and statuses only (the logs are public).
export const summary = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("transcripts").collect()).map((t) => ({
    status: t.status, words: t.wordCount ?? null, lines: t.segmentCount ?? null, language: t.language ?? null, model: t.model ?? null, attempts: t.attempts,
    error: t.error ? t.error.replace(/[A-Za-z0-9_-]{24,}/g, "…") : null,
  })),
});

// Heston's "Transcribe again" button.
export const retry = mutation({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    await requireMe(ctx);
    const row = await ctx.db.query("transcripts").withIndex("by_version", (q) => q.eq("versionId", versionId)).first();
    if (row) await ctx.db.patch(row._id, { status: "pending", error: undefined, updatedAt: Date.now() });
    else await ctx.db.insert("transcripts", { versionId, status: "pending", attempts: 0, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.transcribe.run, { versionId, attempt: 0 });
  },
});

// The review page's Transcript tab: status, plus a URL for the transcript file when it's ready.
export const forVersion = query({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    await requireMe(ctx);
    const row = await ctx.db.query("transcripts").withIndex("by_version", (q) => q.eq("versionId", versionId)).first();
    if (!row) return null;
    return {
      status: row.status, language: row.language ?? null, wordCount: row.wordCount ?? null, error: row.error ?? null, updatedAt: row.updatedAt,
      url: row.status === "done" && row.storageId ? await ctx.storage.getUrl(row.storageId) : null,
    };
  },
});

// For the connector's get_transcript tool.
export const forTool = internalQuery({
  args: { videoId: v.optional(v.string()), video: v.optional(v.string()), version: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const found = await findVideo(ctx, a.videoId, a.video);
    if ("error" in found) return found;
    const pv = await pickVersion(ctx, found.video._id, a.version);
    if ("error" in pv) return { error: pv.error };
    const row = await ctx.db.query("transcripts").withIndex("by_version", (q) => q.eq("versionId", pv.ver._id)).first();
    return {
      video: { video_id: found.video._id as string, title: found.video.title, project: found.project?.name ?? null },
      version: versionInfo(pv.ver),
      startTimecode: pv.ver.startTimecode,
      fps: { num: pv.ver.fpsNum ?? 24000, den: pv.ver.fpsDen ?? 1001 },
      transcript: row ? { status: row.status, storageId: row.storageId ?? null, error: row.error ?? null, language: row.language ?? null } : null,
    };
  },
});
