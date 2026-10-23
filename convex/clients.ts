// Client accounts (client side C1, Oct 23). Owner only: invite an email, see and revoke invites. An invited email
// can then make an account on the sign-in page; everyone else is refused by auth.ts. Shares (C2) call invite too.
import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireMe, requireSignedIn } from "./lib/access";
import { allowedEmails } from "./auth";

const cleanEmail = (e: string) => e.trim().toLowerCase();
const valid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

export const invite = mutation({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const email = cleanEmail(a.email);
    if (!valid(email)) throw new ConvexError("Enter a valid email.");
    if (allowedEmails().includes(email)) throw new ConvexError("That's an owner's email; it already has full access.");
    const name = a.name?.trim().replace(/\s+/g, " ").slice(0, 60) || undefined;
    const existing = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()).find((i) => !i.revokedAt);
    if (existing) {
      if (name && name !== existing.name) await ctx.db.patch(existing._id, { name });
      return { inviteId: existing._id, already: true };
    }
    const inviteId = await ctx.db.insert("invites", { email, name, createdAt: Date.now() });
    return { inviteId, already: false };
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
    const out = [];
    for (const i of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      const user = i.userId ? await ctx.db.get(i.userId) : null;
      out.push({
        _id: i._id, email: i.email, name: user?.name ?? i.name ?? null, createdAt: i.createdAt, revokedAt: i.revokedAt ?? null,
        acceptedAt: i.acceptedAt ?? null, lastSignInAt: user?.lastSignInAt ?? null,
      });
    }
    return out;
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
