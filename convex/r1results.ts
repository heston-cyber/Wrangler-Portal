// Phase R1 (Oct 22): the review-format test page posts its numbers here, so tests on Heston's phone reach Claude.
// No sign-in on that page; the test link's folder key is the password (only its hash is in the code).
import { internalQuery, mutation } from "./lib/functions";
import { v, ConvexError } from "convex/values";

const KEY_SHA256 = "96fafcb8c881cd492226208ad38beee7a3f4cf3877858529bfe245c298492466";

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const report = mutation({
  args: { k: v.string(), device: v.string(), rows: v.string() },
  handler: async (ctx, { k, device, rows }) => {
    if ((await sha256(k)) !== (process.env.R1_KEY_SHA256_TEST ?? KEY_SHA256)) throw new ConvexError("Not allowed.");
    if (rows.length > 20000 || device.length > 300) throw new ConvexError("Too big.");
    if ((await ctx.db.query("r1Results").collect()).length >= 300) throw new ConvexError("Full.");
    await ctx.db.insert("r1Results", { at: Date.now(), device, rows });
  },
});

export const list = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("r1Results").collect()).map((r) => ({ at: new Date(r.at).toISOString().slice(11, 19), device: r.device, rows: JSON.parse(r.rows) })),
});
