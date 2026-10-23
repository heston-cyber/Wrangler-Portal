import { query, mutation, internalQuery } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireSignedIn } from "./lib/access";
import { getAuthUserId } from "@convex-dev/auth/server";
import { allowedEmails, ownerNames } from "./auth";

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
    const owner = allowedEmails().includes(email);
    const role: "owner" | "client" | null = owner ? "owner" : user.role === "client" ? "client" : null;
    return { id: userId, email, name: (user.name as string | undefined) || fallback, allowed: owner, role };
  },
});

// Used by actions: throws unless the caller is signed in and allowed.
export const assertAllowed = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const user = await ctx.db.get(userId);
    const email = (user?.email ?? "").toLowerCase();
    if (!allowedEmails().includes(email)) throw new Error("Not allowed.");
    const name = (user?.name as string | undefined) || "Heston";
    return { userId, name };
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
