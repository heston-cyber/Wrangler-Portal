import { internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { requireSignedIn, viewerOf } from "./lib/access";
import { BUSINESS_TABLES } from "./lib/tenancy";
import { defaultBusiness } from "./lib/business";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ownerNames } from "./auth";

// The signed-in person, or null. `allowed` = owner (the site as before); `role` tells the page which side to show.
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const email = (user.email ?? "").toLowerCase();
    const local = email.split("@")[0] ?? "";
    const fallback = local ? local[0].toUpperCase() + local.slice(1) : null;
    const v = await viewerOf(ctx);
    const owner = v.kind === "owner";
    const role: "owner" | "client" | null = owner ? "owner" : v.kind === "client" ? "client" : null;
    return { id: userId, email, name: (user.name as string | undefined) || fallback, allowed: owner, role };
  },
});

// Used by actions: throws unless the caller is signed in as an owner. Phase 0.5d step 3: an action passes the ids it
// was given, and each must be a record of the owner's own business (anything else is "Not allowed.").
export const assertAllowed = internalQuery({
  args: { ids: v.optional(v.array(v.string())) },
  handler: async (ctx, { ids }) => {
    const v = await viewerOf(ctx);
    if (v.kind === "nobody") throw new Error((await getAuthUserId(ctx)) ? "Not allowed." : "Sign in first.");
    if (v.kind !== "owner") throw new Error("Not allowed.");
    const biz = v.businessId ?? (await defaultBusiness(ctx))?._id ?? null;
    for (const id of ids ?? []) {
      const table = BUSINESS_TABLES.find((t) => ctx.db.normalizeId(t as never, id));
      if (!table) continue; // not a business record (e.g. a file in storage)
      const doc = (await ctx.db.get(id as never)) as { businessId?: string } | null;
      if (!doc || (doc.businessId ?? (await defaultBusiness(ctx))?._id ?? null) !== biz) throw new Error("Not allowed.");
    }
    const name = v.name || "Heston";
    return { userId: v.userId, name, businessId: biz };
  },
});

// The name shown on notes and replies.
export const setName = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const me = await requireSignedIn(ctx);
    const n = name.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!n) throw new ConvexError("Enter a name.");
    if (me.kind !== "owner" && ownerNames().has(n.toLowerCase())) throw new ConvexError("That name is taken.");
    await ctx.db.patch(me.userId, { name: n });
  },
});
