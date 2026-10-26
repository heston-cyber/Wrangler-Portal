// Playback problems reported by the browser (Oct 21). Logged so problems on phones and other machines can be read
// later; and a version whose 1080p file failed anywhere is marked so every device opens it on the stream.
import { internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { accessToVersion, shareArg } from "./lib/viewer";

export const log = mutation({
  args: {
    versionId: v.id("versions"), kind: v.string(), code: v.optional(v.number()), msg: v.optional(v.string()),
    t: v.optional(v.number()), src: v.optional(v.string()), ua: v.optional(v.string()), share: shareArg,
  },
  handler: async (ctx, a) => {
    await accessToVersion(ctx, a.versionId, a.share);
    // A runaway loop can't flood the table: at most 300 entries an hour.
    const recent = await ctx.db.query("playerLogs").withIndex("by_at", (q) => q.gt("at", Date.now() - 3_600_000)).take(301);
    if (recent.length > 300) return;
    await ctx.db.insert("playerLogs", {
      versionId: a.versionId, at: Date.now(), kind: a.kind.slice(0, 20), code: a.code, msg: a.msg?.slice(0, 300),
      t: a.t === undefined ? undefined : Math.round(a.t * 100) / 100, src: a.src?.slice(0, 10), ua: a.ua?.slice(0, 220),
    });
  },
});

// Oct 26: only a decode error (code 3) marks a version stream-only. Code 4 (no source / not supported) with nothing
// loaded usually means the MP4 copy wasn't there yet, so the copies are re-checked instead and the list corrected.
export const fileFailed = mutation({
  args: { versionId: v.id("versions"), share: shareArg, code: v.optional(v.number()) },
  handler: async (ctx, { versionId, share, code }) => {
    const { version: ver, access } = await accessToVersion(ctx, versionId, share);
    if (ver.source === "file" || !ver.bunnyGuid) return;
    if (code === 4) { await ctx.scheduler.runAfter(0, internal.uploads.refreshHeights, { versionId }); return; }
    if (access.kind === "owner" && !ver.streamOnly) await ctx.db.patch(versionId, { streamOnly: true });
  },
});

// For the CI check (public logs): recent entries with short ids and no names.
export const recent = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) =>
    (await ctx.db.query("playerLogs").withIndex("by_at").order("desc").take(limit ?? 40)).map((r) => ({
      at: new Date(r.at).toISOString().slice(5, 19), version: r.versionId.slice(-6), kind: r.kind, code: r.code ?? null,
      msg: r.msg ?? null, t: r.t ?? null, src: r.src ?? null, ua: r.ua ?? null,
    })),
});
