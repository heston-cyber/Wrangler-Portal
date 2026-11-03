// Roles on one login (Heston, Nov 2, replacing D102 "one role per email"): an email can be a client (of one or more
// businesses) and a vendor (of one or more) at the same time. The login is on one side at a time (users.role: "client"
// or "vendor"), and switches between them (users.switchSide); every call still sees exactly one side.
import type { QueryCtx, MutationCtx } from "../_generated/server";

export type Side = "client" | "vendor";

/** The sides a login can be on: a live membership of that kind in any business. */
export async function sidesOf(ctx: QueryCtx | MutationCtx, email: string): Promise<Side[]> {
  const e = email.trim().toLowerCase();
  const ms = (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", e)).collect()).filter((m) => !m.revokedAt);
  return (["client", "vendor"] as const).filter((r) => ms.some((m) => m.role === r));
}

/** True when this login is a client of some business, whichever side it's on right now. */
export async function isClientLogin(ctx: QueryCtx | MutationCtx, email: string): Promise<boolean> {
  return (await sidesOf(ctx, email)).includes("client");
}
