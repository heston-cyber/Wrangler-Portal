// Small per-hour counters (security review, Oct 23): a commenter can't run up stills, voice transcriptions or
// notes without limit. Keyed by what's being counted and who (share + guest key, or user). Rows expire by hour.
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

export const LIMITS = { notes: 120, stills: 240, voice: 40, replies: 120, views: 60, wsSigner: 300, guestCode: 6, briefingLink: 300, briefingSend: 200, offerSend: 200, offerLink: 300, offerAnswer: 20, callBook: 5, callBookBiz: 20, callBookDay: 60, callRead: 240, callChange: 10, callChangeBiz: 40, callCode: 3, callVerify: 10, callPickBiz: 60, callPickDay: 200, callCodeDay: 10, callCodeAddr: 20, callWrongDay: 15, msgSend: 120, msgLead: 60, msgUpload: 100, teamInvite: 30, emailChange: 5 } as const;

export async function bump(ctx: MutationCtx, what: keyof typeof LIMITS, who: string, limit: number = LIMITS[what]) {
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = `${what}:${who}:${hour}`;
  const row = await ctx.db.query("rateLimits").withIndex("by_key", (q) => q.eq("key", key)).unique();
  const n = (row?.count ?? 0) + 1;
  if (n > limit) throw new ConvexError("That's a lot in one hour. Try again a little later.");
  if (row) await ctx.db.patch(row._id, { count: n }); else await ctx.db.insert("rateLimits", { key, count: 1, hour });
}

/** The same, counted per day (UTC). Booking calls (review H1): a daily cap per business on top of the hourly one. */
export async function bumpDay(ctx: MutationCtx, what: keyof typeof LIMITS, who: string, limit: number = LIMITS[what]) {
  const day = Math.floor(Date.now() / 86_400_000);
  const key = `${what}:${who}:d${day}`;
  const row = await ctx.db.query("rateLimits").withIndex("by_key", (q) => q.eq("key", key)).unique();
  const n = (row?.count ?? 0) + 1;
  if (n > limit) throw new ConvexError("That's a lot for one day. Try again tomorrow.");
  if (row) await ctx.db.patch(row._id, { count: n }); else await ctx.db.insert("rateLimits", { key, count: 1, hour: day * 24 });
}
