// Client accounts (client side C1, Oct 23). Owner only: invite an email, see and revoke invites. An invited email
// can then make an account on the sign-in page; everyone else is refused by auth.ts. Shares (C2) call invite too.
import { type MutationCtx } from "./_generated/server";
import { mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { requireMe, requireSignedIn } from "./lib/access";
import { allowedEmails } from "./auth";
import { prefsByEmail } from "./emails";
import { businessInScope, ensureMembership } from "./lib/business";

const cleanEmail = (e: string) => e.trim().toLowerCase();
const valid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

// Make sure an email is invited (an unrevoked invite exists). Returns the clean email and whether it was new.
export async function ensureInvite(ctx: MutationCtx, rawEmail: string, rawName?: string) {
  const email = cleanEmail(rawEmail);
  if (!valid(email)) throw new ConvexError("Enter a valid email.");
  if (allowedEmails().includes(email)) throw new ConvexError("That's an owner's email; it already has full access.");
  const ownsOne = (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", email)).collect()).some((m) => m.role === "owner" && !m.revokedAt);
  if (ownsOne) throw new ConvexError("That email runs a business here, so it can't be invited as a client.");
  const name = rawName?.trim().replace(/\s+/g, " ").slice(0, 60) || undefined;
  const existing = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()).find((i) => !i.revokedAt);
  if (existing) {
    if (name && name !== existing.name) await ctx.db.patch(existing._id, { name });
    return { inviteId: existing._id, email, name: existing.name ?? name, already: true };
  }
  const inviteId = await ctx.db.insert("invites", { email, name, createdAt: Date.now() });
  // Step 6: someone who already has an account (a client of another business) becomes a client of this one too.
  const biz = businessInScope(ctx);
  const user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).unique();
  if (biz && user) await ensureMembership(ctx, biz, email, "client", user._id);
  return { inviteId, email, name, already: false };
}

export const invite = mutation({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const r = await ensureInvite(ctx, a.email, a.name);
    return { inviteId: r.inviteId, already: r.already };
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    await requireMe(ctx);
    const inv = await ctx.db.get(inviteId);
    if (!inv || inv.revokedAt) return;
    await ctx.db.patch(inviteId, { revokedAt: Date.now() });
    // An account they already made keeps its role, but nothing is shared with a revoked email (C2 checks invites).
  },
});

export const listInvites = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const rows = await ctx.db.query("invites").collect();
    const prefs = await prefsByEmail(ctx, rows.map((i) => i.email));
    const out = [];
    for (const i of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      const user = i.userId ? await ctx.db.get(i.userId) : null;
      out.push({
        _id: i._id, email: i.email, name: user?.name ?? i.name ?? null, createdAt: i.createdAt, revokedAt: i.revokedAt ?? null,
        acceptedAt: i.acceptedAt ?? null, lastSignInAt: user?.lastSignInAt ?? null,
        emails: prefs.get(i.email) ?? { versionsOff: false, repliesOff: false }, // C4: what they've switched off
      });
    }
    return out;
  },
});

// May this email make an account? Asked by the sign-up page before it tries, so the reason is plain when it can't
// (the auth error itself is redacted in production). Says only invited / not invited, nothing else.
export const canSignUp = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const e = cleanEmail(email);
    if (!valid(e)) return { ok: false, reason: "invalid" as const };
    if (allowedEmails().includes(e)) return { ok: true, reason: "owner" as const };
    const inv = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", e)).collect()).find((i) => !i.revokedAt);
    return inv ? { ok: true, reason: "invited" as const } : { ok: false, reason: "notInvited" as const };
  },
});

// A signed-in account's own details, for the account page (owner or client).
export const account = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    return { email: me.email, name: me.name, kind: me.kind };
  },
});
