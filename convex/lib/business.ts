// Wrangler Portal, Phase 0.5d step 1 (Oct 28): businesses and memberships.
// Wrangler Productions is the default business (slug "wrangler"). Owners still come from ALLOWED_EMAILS in this
// step; their owner memberships mirror that list (made only here, never by a public function). Clients get a client
// membership when their invited account is made. Later steps give every record a business and scope every query.
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { allowedEmails } from "./owners";
import { rolePerms } from "./perms";

export const DEFAULT_SLUG = "wrangler";
const DEFAULT = { slug: DEFAULT_SLUG, name: "Wrangler Productions", legalName: "Wrangler Productions, a DBA of Hill Creative LLC" };

export async function defaultBusiness(ctx: QueryCtx | MutationCtx): Promise<Doc<"businesses"> | null> {
  return await ctx.db.query("businesses").withIndex("by_slug", (q) => q.eq("slug", DEFAULT_SLUG)).unique();
}

/** Makes the default business and the owners' memberships if they're missing. Safe to run any number of times. */
export async function ensureDefaultBusiness(ctx: MutationCtx): Promise<{ businessId: Id<"businesses">; made: boolean; ownersAdded: number }> {
  let biz = await defaultBusiness(ctx);
  let made = false;
  if (!biz) {
    const id = await ctx.db.insert("businesses", { ...DEFAULT, createdAt: Date.now() });
    biz = (await ctx.db.get(id))!;
    made = true;
  }
  let ownersAdded = 0;
  for (const email of allowedEmails()) {
    if (await ensureMembership(ctx, biz._id, email, "owner")) ownersAdded++;
  }
  return { businessId: biz._id, made, ownersAdded };
}

/** Adds an active membership for this email in this business with this role, unless one exists. True if it added one. */
export async function ensureMembership(ctx: MutationCtx, businessId: Id<"businesses">, email: string, role: "owner" | "client" | "vendor", userId?: Id<"users">): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!e) return false;
  const rows = await ctx.db.query("memberships").withIndex("by_business_email", (q) => q.eq("businessId", businessId).eq("email", e)).collect();
  const live = rows.find((m) => !m.revokedAt && m.role === role);
  if (live) {
    if (userId && !live.userId) await ctx.db.patch(live._id, { userId });
    return false;
  }
  await ctx.db.insert("memberships", { businessId, email: e, role, createdAt: Date.now(), ...(userId ? { userId } : {}) });
  return true;
}

/** The business a person works in or is a client of: their active membership, else the default business. */
export async function businessFor(ctx: QueryCtx | MutationCtx, email: string, role: "owner" | "client"): Promise<Id<"businesses"> | null> {
  const rows = await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", email)).collect();
  const live = rows.filter((m) => !m.revokedAt && m.role === role).sort((a, b) => a.createdAt - b.createdAt)[0];
  if (live) return live.businessId;
  return (await defaultBusiness(ctx))?._id ?? null;
}

/**
 * Who a business is, for documents and emails (Phase 0.5d step 4): its name, legal name and the owner's email.
 * Wrangler's values are what they always were (the legal name from its record, the owner from ALLOWED_EMAILS).
 */
export async function businessContact(ctx: QueryCtx | MutationCtx, businessId?: Id<"businesses"> | null): Promise<{ businessId: Id<"businesses"> | null; isDefault: boolean; name: string; legalName: string; ownerEmail: string }> {
  const def = await defaultBusiness(ctx);
  const biz = businessId ? await ctx.db.get(businessId) : def;
  const isDefault = !biz || (def && biz._id === def._id);
  const owners = biz ? (await ctx.db.query("memberships").withIndex("by_business_email", (q) => q.eq("businessId", biz._id)).collect()).filter((m) => !m.revokedAt && m.role === "owner").sort((a, b) => a.createdAt - b.createdAt) : [];
  const ownerEmail = (isDefault ? allowedEmails()[0] : undefined) ?? owners[0]?.email ?? allowedEmails()[0] ?? "heston@wranglerproductions.com";
  return {
    businessId: biz?._id ?? null,
    isDefault: !!isDefault,
    name: biz?.name ?? DEFAULT.name,
    legalName: biz?.legalName ?? biz?.name ?? DEFAULT.legalName,
    ownerEmail,
  };
}

/** The business a function is working for: the business it acts for, else the caller's, else the default. */
export function businessInScope(ctx: unknown): Id<"businesses"> | null {
  const c = ctx as { asBusiness?: Id<"businesses">; scope?: { owner: Id<"businesses"> | null; only?: Id<"businesses"> | null; pin: Id<"businesses"> | null; members: Set<string> } | null };
  if (c.asBusiness) return c.asBusiness;
  const s = c.scope;
  if (!s) return null;
  if (s.owner) return s.owner;
  if (s.only) return s.only;
  if (s.pin) return s.pin;
  if (s.members.size === 1) return [...s.members][0] as Id<"businesses">;
  return null;
}

/**
 * Step 6: a client account's memberships come from its invites: one client membership in each business that has a
 * live invite for this email (an untagged invite, only in tests, counts as the default business's). Run when the
 * account is made and at every sign-in, so an invite from a second business takes effect too.
 */
export async function syncClientMemberships(ctx: MutationCtx, email: string, userId: Id<"users">): Promise<number> {
  const e = email.trim().toLowerCase();
  const invites = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", e)).collect()).filter((i) => !i.revokedAt);
  let made = 0;
  for (const i of invites) {
    const biz = i.businessId ?? (await ensureDefaultBusiness(ctx)).businessId;
    if (await ensureMembership(ctx, biz, e, "client", userId)) made++;
  }
  return made;
}

/**
 * Phase 3c step 4 · vendors (D94): one login across the businesses a vendor works for. A vendor membership for each
 * business with a live (not archived) vendor record for this email that has been invited to the portal. Marks each of
 * those records joined. Trusted code only (sign-in, and the owner's invite). Returns how many it added.
 */
export async function syncVendorMemberships(ctx: MutationCtx, email: string, userId?: Id<"users">): Promise<number> {
  const e = email.trim().toLowerCase();
  const rows = (await ctx.db.query("vendors").withIndex("by_email", (q) => q.eq("email", e)).collect()).filter((x) => !x.archivedAt && x.invitedAt);
  let made = 0;
  for (const x of rows) {
    const biz = x.businessId ?? (await ensureDefaultBusiness(ctx)).businessId;
    if (await ensureMembership(ctx, biz, e, "vendor", userId)) made++;
    if (userId && !x.joinedAt) await ctx.db.patch(x._id, { joinedAt: Date.now() });
  }
  return made;
}

/** Phase 5e: a team invite that can still be accepted (not cancelled, not used, not past its 14 days). */
export async function liveTeamInvite(ctx: QueryCtx | MutationCtx, email: string): Promise<Doc<"teamInvites"> | null> {
  const e = email.trim().toLowerCase();
  const now = Date.now();
  const rows = (await ctx.db.query("teamInvites").withIndex("by_email", (q) => q.eq("email", e)).collect())
    .filter((i) => !i.revokedAt && !i.acceptedAt && i.expiresAt > now).sort((a, b) => a.createdAt - b.createdAt);
  // Two businesses can each invite the same email (neither can see the other's invites); the first invite wins, and a
  // team login only ever belongs to one business (syncTeamMembership).
  return rows[0] ?? null;
}

/**
 * Phase 5e: a team login's membership comes from its invite. Run only once the email is proved (the 6-digit code), and
 * at later sign-ins: the newest live invite becomes a team membership in its business with that role's switches, and is
 * marked accepted (the oldest live one, if two businesses invited the same email). One business per team login. Trusted code only (auth.ts). Returns true if it made one.
 */
export async function syncTeamMembership(ctx: MutationCtx, email: string, userId: Id<"users">): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const inv = await liveTeamInvite(ctx, e);
  if (!inv?.businessId) return false;
  const now = Date.now();
  const ms = await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", e)).collect();
  // never alongside an owner, client or vendor membership (team.invite refuses those emails; this is the backstop)
  if (ms.some((m) => !m.revokedAt && m.role !== "team")) return false;
  const live = ms.find((m) => !m.revokedAt && m.role === "team");
  if (live && live.businessId !== inv.businessId) return false; // one business per team login
  const biz = await ctx.db.get(inv.businessId);
  const perms = rolePerms(biz?.teamRoles, inv.teamRole);
  if (live) await ctx.db.patch(live._id, { teamRole: inv.teamRole, perms, userId, invitedBy: inv.invitedBy });
  else await ctx.db.insert("memberships", { businessId: inv.businessId, email: e, role: "team", teamRole: inv.teamRole, perms, userId, invitedBy: inv.invitedBy, createdAt: now });
  await ctx.db.patch(inv._id, { acceptedAt: now, userId });
  return true;
}
