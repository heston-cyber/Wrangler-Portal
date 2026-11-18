// Phase 7 step 1 (D106, D110, D113, D134; Heston, Nov 18: "Approved"): the platform admin page (frame 751:1808,
// "Businesses", and 854:10912, "Invite a business"). Only the platform's admin (ALLOWED_EMAILS: Heston) sees it. It shows
// each business's name, owner, status and counts, never its clients or its work: everything here comes from the
// platform's own tables (businesses, memberships, users, businessInvites), not from any business's records. Inviting a
// business emails its owner (email 38); the business is made when they sign up and confirm their email (lib/invites.ts).
// Public sign-up stays off (D106): there is no other way to make a business.
import { v, ConvexError } from "convex/values";
import { internalAction, internalQuery, mutation, query } from "./lib/functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { viewerOf } from "./lib/access";
import { allowedEmails } from "./lib/owners";
import { defaultBusiness } from "./lib/business";
import { INVITE_MS } from "./lib/invites";
import { businessInviteMail } from "./lib/mails";
import { platformBrand } from "./lib/mail";
import { deliverOnce } from "./invoiceReminders";
import { SUPPORT } from "./lib/email";
import { SITE } from "./lib/site";
import { bump } from "./lib/rate";
import { audit } from "./lib/audit";

const EMAIL = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']{2,}$/;
const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f<>{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** The platform's admin: Heston's own login (the owner of Wrangler, ALLOWED_EMAILS). Not a team member, not another owner. */
async function platformAdmin(ctx: QueryCtx | MutationCtx) {
  const v = await viewerOf(ctx);
  if (v.kind !== "owner" || !allowedEmails().includes(v.email.toLowerCase())) throw new ConvexError(await getAuthUserId(ctx) ? "Not allowed." : "Sign in first.");
  return v;
}

/** Whether the signed-in person is the platform admin (the menu shows "Platform admin" only then). Anyone may ask. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const v = await viewerOf(ctx);
    return { admin: v.kind === "owner" && allowedEmails().includes(v.email.toLowerCase()) };
  },
});

type Row = { _id: string; kind: "business" | "invite"; name: string; owner: string; email: string | null; since: number; status: "active" | "setting_up" | "invited" | "expired";
  yours: boolean; clients: number; vendors: number; team: number; lastActive: number | null; expiresAt: number | null };

/** Businesses and open invites, with counts only (D110). */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await platformAdmin(ctx);
    const now = Date.now();
    const def = await defaultBusiness(ctx);
    const rows: Row[] = [];
    for (const b of await ctx.db.query("businesses").collect()) {
      const ms = (await ctx.db.query("memberships").withIndex("by_business_email", (q) => q.eq("businessId", b._id)).collect()).filter((m) => !m.revokedAt);
      const owners = ms.filter((m) => m.role === "owner").sort((a, c) => a.createdAt - c.createdAt);
      const ownerUsers: Doc<"users">[] = [];
      for (const m of owners) { const u = m.userId ? await ctx.db.get(m.userId) : await ctx.db.query("users").withIndex("email", (q) => q.eq("email", m.email)).first(); if (u) ownerUsers.push(u); }
      const yours = def?._id === b._id;
      const ownerName = b.ownerName?.trim() || ownerUsers[0]?.name || owners[0]?.email || "";
      rows.push({
        _id: b._id, kind: "business", name: b.name, owner: ownerName, email: owners[0]?.email ?? null, since: b.createdAt, yours,
        status: yours || b.setupDoneAt ? "active" : "setting_up",
        clients: ms.filter((m) => m.role === "client").length, vendors: ms.filter((m) => m.role === "vendor").length, team: ms.filter((m) => m.role === "team").length,
        lastActive: ownerUsers.reduce<number | null>((t, u) => (u.lastSignInAt && (!t || u.lastSignInAt > t) ? u.lastSignInAt : t), null), expiresAt: null,
      });
    }
    for (const i of await ctx.db.query("businessInvites").collect()) {
      if (i.acceptedAt || i.revokedAt) continue;
      rows.push({ _id: i._id, kind: "invite", name: i.business, owner: i.email, email: i.email, since: i.sentAt, yours: false, status: i.expiresAt > now ? "invited" : "expired",
        clients: 0, vendors: 0, team: 0, lastActive: null, expiresAt: i.expiresAt });
    }
    const order = { active: 0, setting_up: 1, invited: 2, expired: 3 } as const;
    rows.sort((a, b) => (a.yours === b.yours ? 0 : a.yours ? -1 : 1) || order[a.status] - order[b.status] || b.since - a.since);
    const biz = rows.filter((r) => r.kind === "business");
    return {
      rows,
      totals: { businesses: biz.length, active: biz.filter((r) => r.status === "active").length, settingUp: biz.filter((r) => r.status === "setting_up").length,
        invited: rows.filter((r) => r.status === "invited").length, clients: biz.reduce((n, r) => n + r.clients, 0), vendors: biz.reduce((n, r) => n + r.vendors, 0) },
    };
  },
});

/** Is this email free to own a new business? Not an owner here, not already a login of any kind, not a team member. */
async function emailInUse(ctx: QueryCtx | MutationCtx, email: string) {
  if (allowedEmails().includes(email)) return true;
  const ms = (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", email)).collect()).filter((m) => !m.revokedAt);
  if (ms.length) return true;
  // Phase 7 reviews (L3): a login made from a business invite that ran out or was cancelled before the code was entered
  // (an owner with no business) can be invited again; any other login is in use.
  const u = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).collect()).find((x) => x.role !== "guest");
  return !!u && u.role !== "owner";
}

/** Invite a business (854:10912): Business name, Owner's email, a note. Nothing is sent until this is pressed. */
export const invite = mutation({
  args: { business: v.string(), email: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await platformAdmin(ctx);
    const business = clean(a.business, 80), email = a.email.trim().toLowerCase(), note = a.note ? clean(a.note, 600) : "";
    if (business.length < 2) throw new ConvexError("Type the business's name.");
    if (!EMAIL.test(email) || email.length > 254) throw new ConvexError("Type the owner's email.");
    if (await emailInUse(ctx, email)) throw new ConvexError("That email is already in use on WranglerPortal. Use another address for the business's owner.");
    await bump(ctx, "businessInvite", "platform"); // at most 200 an hour
    const now = Date.now();
    const open = (await ctx.db.query("businessInvites").withIndex("by_email", (q) => q.eq("email", email)).collect()).find((i) => !i.acceptedAt && !i.revokedAt);
    let inviteId: Id<"businessInvites">;
    if (open) { inviteId = open._id; await ctx.db.patch(open._id, { business, ...(note ? { note } : { note: undefined }), sentAt: now, expiresAt: now + INVITE_MS }); }
    else inviteId = await ctx.db.insert("businessInvites", { email, business, ...(note ? { note } : {}), createdAt: now, sentAt: now, expiresAt: now + INVITE_MS });
    await audit(ctx, { kind: "sent", text: `invited the business ${business} (${email}) to WranglerPortal`, where: "Platform admin" });
    await ctx.scheduler.runAfter(0, internal.platform.mailInvite, { inviteId, at: now });
    return { inviteId };
  },
});

/** Send it again: another 14 days from now. */
export const resend = mutation({
  args: { inviteId: v.string() },
  handler: async (ctx, a) => {
    await platformAdmin(ctx);
    const inviteId = ctx.db.normalizeId("businessInvites", a.inviteId);
    const i = inviteId ? await ctx.db.get(inviteId) : null;
    if (!i || i.revokedAt) throw new ConvexError("That invite isn't here.");
    if (i.acceptedAt) throw new ConvexError("They've already set up their business.");
    if (await emailInUse(ctx, i.email)) throw new ConvexError("That email is already in use on WranglerPortal. Cancel this invite and use another address.");
    await bump(ctx, "businessInvite", "platform");
    const now = Date.now();
    await ctx.db.patch(i._id, { sentAt: now, expiresAt: now + INVITE_MS });
    await ctx.scheduler.runAfter(0, internal.platform.mailInvite, { inviteId: i._id, at: now });
    return null;
  },
});

/** Cancel an invite that hasn't been accepted: the link stops working. */
export const revoke = mutation({
  args: { inviteId: v.string() },
  handler: async (ctx, a) => {
    await platformAdmin(ctx);
    const inviteId = ctx.db.normalizeId("businessInvites", a.inviteId);
    const i = inviteId ? await ctx.db.get(inviteId) : null;
    if (!i || i.revokedAt || i.acceptedAt) return null;
    await ctx.db.patch(i._id, { revokedAt: Date.now() });
    return null;
  },
});

export const inviteMail = internalQuery({
  args: { inviteId: v.id("businessInvites") },
  handler: async (ctx, { inviteId }) => {
    const i = await ctx.db.get(inviteId);
    if (!i || i.revokedAt || i.acceptedAt) return null;
    const def = await defaultBusiness(ctx);
    return { i, privacyUrl: def?.privacyUrl ?? null };
  },
});

/** Email 38 (753:2117), from WranglerPortal. */
export const mailInvite = internalAction({
  args: { inviteId: v.id("businessInvites"), at: v.number() },
  handler: async (ctx, { inviteId, at }) => {
    const d = await ctx.runQuery(internal.platform.inviteMail, { inviteId });
    if (!d) return;
    const link = `${SITE()}/?invited=${encodeURIComponent(d.i.email).replace(/%40/g, "@")}&side=owner`;
    const until = new Date(d.i.expiresAt).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric" });
    await deliverOnce(ctx, `business-invite:${inviteId}:${at}`, "business_invite", d.i.email, businessInviteMail(platformBrand(d.privacyUrl), { business: d.i.business, note: d.i.note ?? null, link, until }), SUPPORT(), null);
  },
});

/** Phase 7 (decision 4 of the read-back): whose name a sign-in or reset code email carries. Wrangler's own people (its
 *  owner, its clients, vendors and team, and anyone invited by it) get Wrangler Productions' as before; everyone else
 *  (another business's owner, clients, vendors or team) gets WranglerPortal's, since the code comes before we know
 *  which business they're signing in to. Reads only whether an address belongs to Wrangler; returns one word. */
export const codeBrand = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email: raw }) => {
    const email = raw.trim().toLowerCase();
    if (allowedEmails().includes(email)) return "wrangler" as const;
    const D = (await defaultBusiness(ctx))?._id ?? null;
    if (!D) return "wrangler" as const; // no businesses yet: nothing to tell apart
    const ours = (b: Id<"businesses"> | undefined) => (b ?? D) === D;
    if ((await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", email)).collect()).some((m) => !m.revokedAt && m.businessId === D)) return "wrangler" as const;
    if ((await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()).some((i) => !i.revokedAt && ours(i.businessId))) return "wrangler" as const;
    if ((await ctx.db.query("vendors").withIndex("by_email", (q) => q.eq("email", email)).collect()).some((x) => !x.archivedAt && ours(x.businessId))) return "wrangler" as const;
    if ((await ctx.db.query("teamInvites").withIndex("by_email", (q) => q.eq("email", email)).collect()).some((i) => !i.revokedAt && ours(i.businessId))) return "wrangler" as const;
    return "platform" as const;
  },
});
