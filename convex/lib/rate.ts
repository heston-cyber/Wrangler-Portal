// Small per-hour counters (security review, Oct 23): a commenter can't run up stills, voice transcriptions or
// notes without limit. Keyed by what's being counted and who (share + guest key, or user). Rows expire by hour.
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

export const LIMITS = { notes: 120, stills: 240, voice: 40, replies: 120, views: 60 } as const;

export async function bump(ctx: MutationCtx, what: keyof typeof LIMITS, who: string) {
  const hour = Math.floor(Date.now() / 3_600_000);
  const key = `${what}:${who}:${hour}`;
  const row = await ctx.db.query("rateLimits").withIndex("by_key", (q) => q.eq("key", key)).unique();
  const n = (row?.count ?? 0) + 1;
  if (n > LIMITS[what]) throw new ConvexError("That's a lot in one hour. Try again a little later.");
  if (row) await ctx.db.patch(row._id, { count: n }); else await ctx.db.insert("rateLimits", { key, count: 1, hour });
}
