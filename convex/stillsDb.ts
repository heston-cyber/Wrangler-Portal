import { internalMutation } from "./lib/functions";
import { v } from "convex/values";

export const record = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    await ctx.db.insert("stillFiles", { storageId, createdAt: Date.now() });
  },
});
