// The one access check in front of every app function (client side C1, Oct 23).
//   requireMe       the owner (Heston): signed in, on the allow list. Every function the site had before C1 uses it,
//                   so nothing is visible to anyone else unless a later phase explicitly allows it through a share.
//   requireSignedIn any account, owner or client: for the account page and, later, "Shared with me".
//   viewerOf        who is calling (owner / client / nobody), for functions that answer differently per role.
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { allowedEmails } from "./owners";
import { businessFor } from "./business";

export type Me = { userId: Id<"users">; name: string; email: string };
// businessId (Phase 0.5d step 1): the business they work in or are a client of. Optional until step 3 makes every
// function use it; null only before the default business has been made.
export type Viewer = { kind: "owner" | "client"; userId: Id<"users">; name: string; email: string; businessId: Id<"businesses"> | null } | { kind: "nobody" };

const fallbackName = (email: string) => { const local = email.split("@")[0] ?? ""; return local ? local[0].toUpperCase() + local.slice(1) : "Someone"; };

export async function viewerOf(ctx: QueryCtx | MutationCtx): Promise<Viewer> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return { kind: "nobody" };
  const user = await ctx.db.get(userId);
  const email = (user?.email ?? "").toLowerCase();
  if (!user || !email) return { kind: "nobody" };
  const name = (user.name as string | undefined) || fallbackName(email);
  // Owner by the allow list (the source of truth), or by a role stamped at sign-up while still on the list.
  if (allowedEmails().includes(email)) return { kind: "owner", userId, name, email, businessId: await businessFor(ctx, email, "owner") };
  if (user.role === "client") return { kind: "client", userId, name, email, businessId: await businessFor(ctx, email, "client") };
  return { kind: "nobody" };
}

export async function requireMe(ctx: QueryCtx | MutationCtx): Promise<Me> {
  const v = await viewerOf(ctx);
  if (v.kind === "nobody") throw new ConvexError(await getAuthUserId(ctx) ? "Not allowed." : "Sign in first.");
  if (v.kind !== "owner") throw new ConvexError("Not allowed.");
  return { userId: v.userId, name: v.name, email: v.email };
}

export async function requireSignedIn(ctx: QueryCtx | MutationCtx): Promise<Me & { kind: "owner" | "client" }> {
  const v = await viewerOf(ctx);
  if (v.kind === "nobody") throw new ConvexError(await getAuthUserId(ctx) ? "Not allowed." : "Sign in first.");
  return { userId: v.userId, name: v.name, email: v.email, kind: v.kind };
}

// Actions can't read the db directly: check sign-in through a query (users.assertAllowed does the owner check).
export async function requireMeInAction(ctx: ActionCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  return userId;
}
