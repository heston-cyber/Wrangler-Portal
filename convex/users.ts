import { internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { requireMe, requireSignedIn, viewerOf } from "./lib/access";
import { toolsOf } from "./lib/tools";
import { BUSINESS_TABLES } from "./lib/tenancy";
import { defaultBusiness } from "./lib/business";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ownerNames } from "./auth";
import { sidesOf } from "./lib/roles";

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
    // Phase 5b step 4: a call-sheet guest's login (D127): the page shows it the guest pages and nothing else.
    const role: "owner" | "client" | "vendor" | "guest" | "team" | null = owner ? "owner" : v.kind === "client" ? "client" : v.kind === "vendor" ? "vendor" : v.kind === "team" ? "team" : user.role === "guest" ? "guest" : null;
    // Nov 2: a login that is a client and a vendor shows a switch between the two sides.
    const sides = owner || role === "guest" || role === "team" ? [] : await sidesOf(ctx, email);
    // Phase 5e: a team member's role and switches decide their menu (the server checks every call again).
    const team = v.kind === "team" ? { role: v.team.role, perms: v.team.perms } : null;
    return { id: userId, email, name: (user.name as string | undefined) || fallback, allowed: owner, role, sides, team, ...(owner ? { tools: toolsOf(user.tools) } : {}) };
  },
});

/** Moves a client-and-vendor login to its other side (only to a side it has a live membership on). */
export const switchSide = mutation({
  args: { side: v.union(v.literal("client"), v.literal("vendor")) },
  handler: async (ctx, { side }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first.");
    const user = await ctx.db.get(userId);
    const email = (user?.email ?? "").toLowerCase();
    if (!user || !email) throw new ConvexError("Sign in first.");
    const kind = (await viewerOf(ctx)).kind;
    if (kind === "owner" || kind === "nobody" || kind === "team" || user.role === "team") throw new ConvexError("Not allowed."); // Phase 5e: a team login has no other side
    if (!(await sidesOf(ctx, email)).includes(side)) throw new ConvexError(side === "vendor" ? "No business has you as a vendor." : "No business has you as a client.");
    if (user.role !== side) await ctx.db.patch(userId, { role: side });
    return side;
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
/** Settings › Tools (owner): saves the menu order, the tools off the menu and the Dashboard's widgets. */
export const setTools = mutation({
  args: { tools: v.any() },
  handler: async (ctx, { tools }) => {
    const me = await requireMe(ctx);
    if (JSON.stringify(tools ?? null).length > 4000) throw new ConvexError("That's too long.");
    await ctx.db.patch(me.userId, { tools: toolsOf(tools) });
    return null;
  },
});

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
