// Settings that follow Heston's account to every device (R2b): which details show next to videos, and in what
// order; and whether the Approve final button is on. Kept per user.
import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireMe, viewerOf } from "./lib/access";

const KEYS = ["details", "approveFinal"] as const;

// Anyone may ask (the video page does, whoever is looking); only the owner has any settings. Clients and guests get
// an empty answer rather than an error (C5 fix, Oct 24: a client opening a shared video hit "Not allowed." here).
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await viewerOf(ctx);
    const out: Record<string, unknown> = {};
    if (me.kind !== "owner") return out;
    for (const k of KEYS) {
      const row = await ctx.db.query("userPrefs").withIndex("by_user_key", (q) => q.eq("userId", me.userId).eq("key", k)).first();
      if (row) out[k] = row.value;
    }
    return out;
  },
});

export const set = mutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, { key, value }) => {
    const me = await requireMe(ctx);
    if (!(KEYS as readonly string[]).includes(key)) throw new ConvexError("Unknown setting.");
    if (JSON.stringify(value ?? null).length > 2000) throw new ConvexError("That setting is too big.");
    const row = await ctx.db.query("userPrefs").withIndex("by_user_key", (q) => q.eq("userId", me.userId).eq("key", key)).first();
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() });
    else await ctx.db.insert("userPrefs", { userId: me.userId, key, value, updatedAt: Date.now() });
  },
});
