// Nov 2 · Settings › Notifications for the business owner, and the client's list (Heston: "email notifications for
// everything, with a notifications settings menu so every business, vendor and client can configure their
// notifications"). The vendor's list is in vendorPortal.ts (it works per business they work for). Every email is in
// lib/notify.ts; the check that skips a switched-off one is emails.switchedOff, on every send.
import { mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe, requireSignedIn } from "./lib/access";
import { businessContact, businessInScope, defaultBusiness } from "./lib/business";
import { prefRow, setSwitch, viewFor } from "./lib/notifyPrefs";

async function ownerScope(ctx: QueryCtx | MutationCtx) {
  const me = await requireMe(ctx);
  const biz = businessInScope(ctx);
  if (!biz) throw new ConvexError("Not allowed.");
  // The owner's emails go to the business contact address; a switch is set on each so it holds wherever the email
  // goes. D151 (Nov 4): no extra alert address for the first business.
  const c = await businessContact(ctx, biz);
  const to = [...new Set([me.email, c.ownerEmail].map((e) => e.trim().toLowerCase()).filter(Boolean))];
  return { me, biz, to };
}

export const owner = query({
  args: {},
  handler: async (ctx) => {
    const { me, biz, to } = await ownerScope(ctx);
    const row = await prefRow(ctx, me.email, biz);
    return { to, items: viewFor("owner", row) };
  },
});

export const setOwner = mutation({
  args: { key: v.string(), on: v.boolean() },
  handler: async (ctx, { key, on }) => {
    const { biz, to } = await ownerScope(ctx);
    try { for (const e of to) await setSwitch(ctx, e, biz, "owner", key, on); } catch (e) { throw new ConvexError((e as Error).message); }
    return null;
  },
});

// ---------- the client (one list; it applies in every business they're a client of) ----------

async function clientBusinesses(ctx: QueryCtx | MutationCtx, email: string): Promise<Array<Id<"businesses"> | null>> {
  const def = (await defaultBusiness(ctx))?._id ?? null;
  const out = new Set<Id<"businesses"> | null>();
  for (const i of await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()) if (!i.revokedAt) out.add(i.businessId ?? def);
  for (const m of await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", email)).collect()) if (!m.revokedAt && m.role === "client") out.add(m.businessId);
  return [...out];
}

export const client = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    const email = me.email.toLowerCase();
    // Review fix: a client of several businesses has a row in each (an email's unsubscribe link changes only that
    // business's); a switch shows on only when it's on in all of them.
    const rows = [];
    for (const b of await clientBusinesses(ctx, email)) rows.push(await prefRow(ctx, email, b));
    const views = rows.length ? rows.map((r) => viewFor("client", r)) : [viewFor("client", null)];
    return { items: views[0].map((i, n) => ({ ...i, on: views.every((v) => v[n].on) })) };
  },
});

export const setClient = mutation({
  args: { key: v.string(), on: v.boolean() },
  handler: async (ctx, { key, on }) => {
    const me = await requireSignedIn(ctx);
    const email = me.email.toLowerCase();
    try { for (const b of await clientBusinesses(ctx, email)) await setSwitch(ctx, email, b, "client", key, on); } catch (e) { throw new ConvexError((e as Error).message); }
    return null;
  },
});
