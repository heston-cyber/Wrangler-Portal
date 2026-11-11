import { internalMutation } from "./lib/functions";
import { v } from "convex/values";
import { recordFile } from "./lib/fileOwners";
import { businessInScope } from "./lib/business";

export const record = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    await ctx.db.insert("stillFiles", { storageId, createdAt: Date.now() });
    await recordFile(ctx as never, storageId, businessInScope(ctx), "still"); // 5e review (Nov 6)
  },
});
