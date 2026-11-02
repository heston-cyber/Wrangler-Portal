// D102 (Heston, Nov 2): one role per email for now. An email that is a client's (a client login anywhere on the
// portal, an invite or a person on a client of this business) can't be a vendor, and a vendor's email can't be
// invited as a client. Switching roles on one login is a later build, only if the portal is used a lot.
import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const ONE_ROLE = "One email can be a client or a vendor, not both, for now. Use a different email.";

/** True when this email is a client: a live client membership (any business), or, in this business, an invite or a
 *  person on a client. The business tables are already limited to the caller's business by the database guard. */
export async function isClientEmail(ctx: QueryCtx | MutationCtx, email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if ((await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", e)).collect()).some((m) => m.role === "client" && !m.revokedAt)) return true;
  if ((await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", e)).collect()).some((i) => !i.revokedAt)) return true;
  return (await ctx.db.query("clientPeople").withIndex("by_email", (q) => q.eq("email", e)).collect()).some((p) => !p.removedAt);
}

export async function isVendorEmail(ctx: QueryCtx | MutationCtx, email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  // A vendor login anywhere on the portal (step 4), or a vendor of this business.
  if ((await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", e)).collect()).some((m) => m.role === "vendor" && !m.revokedAt)) return true;
  return (await ctx.db.query("vendors").withIndex("by_email", (q) => q.eq("email", e)).collect()).some((x) => !x.archivedAt);
}

export async function assertNotClient(ctx: QueryCtx | MutationCtx, email: string) {
  if (await isClientEmail(ctx, email)) throw new ConvexError(`That email belongs to a client. ${ONE_ROLE}`);
}
export async function assertNotVendor(ctx: QueryCtx | MutationCtx, email: string) {
  if (await isVendorEmail(ctx, email)) throw new ConvexError(`That email belongs to one of your vendors. ${ONE_ROLE}`);
}
