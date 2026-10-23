import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMe } from "./lib/access";

// Phase 0 frame-test log. Kept so the test page keeps working; capped and harmless.
const MAX_RUNS = 300;

export const saveRun = mutation({
  args: {
    label: v.string(), device: v.string(), browser: v.string(), source: v.string(), engine: v.string(),
    pass: v.boolean(), userAgent: v.string(), results: v.any(), misses: v.any(),
  },
  handler: async (ctx, args) => {
    const count = (await ctx.db.query("phase0Runs").take(MAX_RUNS)).length;
    if (count >= MAX_RUNS) throw new Error("Test log is full");
    const clip = (s: string) => s.slice(0, 2000);
    return await ctx.db.insert("phase0Runs", {
      ...args, label: clip(args.label), source: clip(args.source), userAgent: clip(args.userAgent), createdAt: new Date().toISOString(),
    });
  },
});

// Owner only since C1 (Oct 23); the lab pages call it without a sign-in and just show no list.
export const listRuns = query({
  args: {},
  handler: async (ctx) => { await requireMe(ctx); return await ctx.db.query("phase0Runs").order("desc").take(30); },
});
