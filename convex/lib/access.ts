import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { allowedEmails } from "../auth";

export type Me = { userId: Id<"users">; name: string; email: string };

// Every app function calls this first. Signed-in AND on the allow list, or it throws.
export async function requireMe(ctx: QueryCtx | MutationCtx): Promise<Me> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  const user = await ctx.db.get(userId);
  const email = (user?.email ?? "").toLowerCase();
  if (!email || !allowedEmails().includes(email)) throw new ConvexError("Not allowed.");
  const local = email.split("@")[0];
  const name = (user?.name as string | undefined) || local[0].toUpperCase() + local.slice(1);
  return { userId, name, email };
}

// Actions can't read the db directly: check sign-in through a query.
export async function requireMeInAction(ctx: ActionCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  return userId;
}
