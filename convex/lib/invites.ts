// Phase 7 step 1 (D134, Heston, Nov 18: "Approved", with the build's suggestion of 14 days): who may make an account.
// An invite works 14 days from when it was sent (or sent again), unless it was already accepted. Invites sent before
// Nov 18 have no end date and keep working. The same rule for a client's invite, a vendor's portal invite, a team
// invite and a business invite (Heston's, from the platform admin page).
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { allowedEmails } from "./owners";
import { ensureMembership } from "./business";
import { clientLive, vendorLive } from "./inviteLive";

export const INVITE_DAYS = 14;
export const INVITE_MS = INVITE_DAYS * 86_400_000;

type Live =
  | { kind: "owner" }
  | { kind: "client"; invite: Doc<"invites"> }
  | { kind: "vendor"; vendor: Doc<"vendors"> }
  | { kind: "team"; invite: Doc<"teamInvites"> }
  | { kind: "business"; invite: Doc<"businessInvites"> };
export type InviteCheck = Live | { kind: null; expired: boolean };


/** What this email was invited as: owner first, then Heston's business invite (Q4, Heston, Nov 18: "Go with your
 *  suggestions": when the same email also has a client, vendor or team invite from another business, the business invite
 *  wins and the other stays unaccepted until it runs out), then the order the sign-up has always used (client, vendor,
 *  team). An expired business invite never beats a live one. With none that works, whether one existed and ran out (for
 *  "This invite has expired"). Reads with plain access: the sign-up runs before anyone has a business. */
export async function inviteFor(ctx: QueryCtx | MutationCtx, rawEmail: string, now = Date.now()): Promise<InviteCheck> {
  const email = rawEmail.trim().toLowerCase();
  if (allowedEmails().includes(email)) return { kind: "owner" };
  const biz = (await ctx.db.query("businessInvites").withIndex("by_email", (q) => q.eq("email", email)).collect()).filter((i) => !i.revokedAt);
  const b = biz.filter((i) => !i.acceptedAt && i.expiresAt > now).sort((x, y) => x.createdAt - y.createdAt)[0];
  if (b) return { kind: "business", invite: b };
  const clients = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()).filter((i) => !i.revokedAt);
  const c = clients.find((i) => clientLive(i, now));
  if (c) return { kind: "client", invite: c };
  const vendors = (await ctx.db.query("vendors").withIndex("by_email", (q) => q.eq("email", email)).collect()).filter((x) => !x.archivedAt && x.invitedAt);
  const vd = vendors.find((x) => vendorLive(x, now));
  if (vd) return { kind: "vendor", vendor: vd };
  const teams = (await ctx.db.query("teamInvites").withIndex("by_email", (q) => q.eq("email", email)).collect()).filter((i) => !i.revokedAt && !i.acceptedAt);
  const t = teams.filter((i) => i.expiresAt > now).sort((a, b) => a.createdAt - b.createdAt)[0];
  if (t) return { kind: "team", invite: t };
  return { kind: null, expired: clients.length + vendors.length + teams.length + biz.filter((i) => !i.acceptedAt).length > 0 };
}

/** A business invite accepted: once the email is confirmed, a new business with the invited name, this person its owner.
 *  Runs once (an accepted invite is never used again). Returns the business, or null when there's nothing to accept. */
export async function acceptBusinessInvite(ctx: MutationCtx, rawEmail: string, userId: Doc<"users">["_id"], now = Date.now()) {
  const email = rawEmail.trim().toLowerCase();
  if (allowedEmails().includes(email)) return null;
  const check = await inviteFor(ctx, email, now);
  if (check.kind !== "business") return null;
  // An email that already owns a business (or works in one) never gets a second one this way.
  const ms = (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", email)).collect()).filter((m) => !m.revokedAt);
  if (ms.some((m) => m.role === "owner" || m.role === "team")) return null;
  const inv = check.invite;
  const name = inv.business.trim().replace(/\s+/g, " ").slice(0, 80) || "My business";
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "business";
  let slug = base;
  for (let n = 2; await ctx.db.query("businesses").withIndex("by_slug", (q) => q.eq("slug", slug)).first(); n++) slug = `${base}-${n}`;
  const user = await ctx.db.get(userId);
  const businessId = await ctx.db.insert("businesses", { slug, name, createdAt: now, invitedFrom: inv._id, ...(user?.name ? { ownerName: user.name } : {}) });
  await ensureMembership(ctx, businessId, email, "owner", userId);
  await ctx.db.patch(inv._id, { acceptedAt: now, businessId });
  return businessId;
}
