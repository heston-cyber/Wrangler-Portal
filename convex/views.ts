// C9 (Oct 26): who watched what, and how much. The player sends a heartbeat every few seconds while playing (and
// when it pauses or the page is left): seconds watched since the last beat, where the playhead is, the length.
// One row per sitting. The owner sees, per video, how many views, by how many people, who got how far; the share
// activity list reads "watched v2 to the end". Anyone who may view a version may report on it; the owner's own
// sittings are stored (so the page stays simple) but never counted or listed.
import { mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMe } from "./lib/access";
import { accessToVersion, authorOf, limitKey, shareArg } from "./lib/viewer";
import { bump } from "./lib/rate";

const END_SLACK = 3; // within this many seconds of the end counts as watched to the end

export const beat = mutation({
  args: { versionId: v.id("versions"), session: v.string(), watchedSec: v.number(), posSec: v.number(), lengthSec: v.number(), share: shareArg },
  handler: async (ctx, a) => {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(a.session)) throw new ConvexError("Bad session.");
    const { access, version } = await accessToVersion(ctx, a.versionId, a.share);
    const watched = Math.max(0, Math.min(a.watchedSec, 120));           // one beat covers at most two minutes
    const pos = Math.max(0, Math.min(a.posSec, 24 * 3600));
    const length = Math.max(0, Math.min(a.lengthSec, 24 * 3600));
    const now = Date.now();
    const row = await ctx.db.query("views").withIndex("by_session", (q) => q.eq("versionId", a.versionId).eq("session", a.session)).unique();
    if (row) {
      const maxSec = Math.max(row.maxSec, pos);
      await ctx.db.patch(row._id, { lastAt: now, watchedSec: row.watchedSec + watched, maxSec, lengthSec: length || row.lengthSec, completed: row.completed || (length > 0 && maxSec >= length - END_SLACK) });
      return;
    }
    // A new sitting: at most 60 an hour per person, so a runaway page can't fill the table (quietly dropped past that).
    try { await bump(ctx, "views", limitKey(access)); } catch { return; }
    await ctx.db.insert("views", {
      videoId: version.videoId, versionId: a.versionId, shareId: access.share?._id, session: a.session, kind: access.kind,
      who: authorOf(access), whoKey: limitKey(access), startedAt: now, lastAt: now, watchedSec: watched, maxSec: pos, lengthSec: length,
      completed: length > 0 && pos >= length - END_SLACK,
    });
  },
});

export type ViewRow = { who: string; kind: "client" | "guest"; version: number; startedAt: number; lastAt: number; watchedSec: number; maxSec: number; lengthSec: number; completed: boolean };

function rowOf(r: Doc<"views">, versionNumber: number): ViewRow {
  return { who: r.who, kind: r.kind === "owner" ? "client" : r.kind, version: versionNumber, startedAt: r.startedAt, lastAt: r.lastAt, watchedSec: Math.round(r.watchedSec), maxSec: Math.round(r.maxSec), lengthSec: Math.round(r.lengthSec), completed: r.completed };
}

/** The owner's view of a video's viewers: counts and every sitting (newest first), the owner's own left out. */
export const forVideo = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await requireMe(ctx);
    const rows = (await ctx.db.query("views").withIndex("by_video", (q) => q.eq("videoId", videoId)).order("desc").take(500)).filter((r) => r.kind !== "owner");
    const versions = new Map((await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect()).map((x) => [x._id as string, x.number]));
    const people = new Set(rows.map((r) => r.whoKey));
    const last = rows[0] ?? null;
    return {
      views: rows.length,
      people: people.size,
      completed: rows.filter((r) => r.completed).length,
      last: last ? { who: last.who, at: last.lastAt } : null,
      byVersion: Object.fromEntries([...versions.values()].map((n) => [n, { views: rows.filter((r) => versions.get(r.versionId) === n).length, people: new Set(rows.filter((r) => versions.get(r.versionId) === n).map((r) => r.whoKey)).size }])),
      rows: rows.map((r) => rowOf(r, versions.get(r.versionId) ?? 0)),
    };
  },
});

/** Sittings through one share (for its activity list), newest first. */
export async function viewsForShare(ctx: Parameters<typeof requireMe>[0], shareId: Id<"shares">, limit = 100) {
  const rows = (await ctx.db.query("views").withIndex("by_share", (q) => q.eq("shareId", shareId)).order("desc").take(limit)).filter((r) => r.kind !== "owner");
  const out = [];
  for (const r of rows) {
    const ver = await ctx.db.get(r.versionId);
    const vid = await ctx.db.get(r.videoId);
    out.push({ ...rowOf(r, ver?.number ?? 0), videoId: r.videoId, videoTitle: vid?.title ?? null });
  }
  return out;
}
