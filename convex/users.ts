import { query, internalQuery } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { allowedEmails } from "./auth";

// The signed-in person, or null.
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const email = (user.email ?? "").toLowerCase();
    return { id: userId, email, name: (user.name as string | undefined) ?? null, allowed: allowedEmails().includes(email) };
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
