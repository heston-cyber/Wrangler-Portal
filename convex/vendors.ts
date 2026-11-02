// Phase 3c (Oct 31) · Vendors, the owner's side: the vendor record (S5 · Phase 3c 730:2 All vendors, 730:653 empty,
// 730:1153 the vendor page, 732:2909 Add vendor). A business's subcontractors with their roles, rates (shown beside the
// business's own Pricing subcontractor costs), details, gear, W-9 status and notes. Bookings, briefings, the vendor
// portal and payments build on this in the next steps. Owner only.
import { internalAction, internalQuery, mutation, query } from "./lib/functions";
import { internal } from "./_generated/api";
import { syncVendorMemberships } from "./lib/business";
import { mailBrandOf } from "./lib/mail";
import { vendorInviteMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { businessInScope } from "./lib/business";
import type { Rates } from "./lib/estimate";
import { ratesOf } from "./crm";
import { assertNotClient } from "./lib/roles";
import { todayCentral } from "./lib/bookings";
import { paidAmount, paidDay } from "./lib/bookingRows";

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const clip = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);

async function ownerBiz(ctx: QueryCtx | MutationCtx) {
  await requireMe(ctx);
  const id = businessInScope(ctx);
  const b = id ? await ctx.db.get(id) : null;
  if (!b) throw new ConvexError("Not allowed.");
  return b;
}
const rateV = v.object({ role: v.string(), unit: v.union(v.literal("day"), v.literal("hour")), cents: v.number() });
const detailsV = {
  name: v.string(), email: v.string(), roles: v.array(v.string()), rates: v.array(rateV),
  basedIn: v.optional(v.string()), phone: v.optional(v.string()), portfolio: v.optional(v.string()), gear: v.optional(v.array(v.string())), notes: v.optional(v.string()),
};
type Details = { name: string; email: string; roles: string[]; rates: Array<{ role: string; unit: "day" | "hour"; cents: number }>; basedIn?: string; phone?: string; portfolio?: string; gear?: string[]; notes?: string };

function clean(a: Details) {
  const email = a.email.trim().toLowerCase();
  if (!a.name.trim()) throw new ConvexError("Add their name.");
  if (!EMAIL.test(email) || email.length > 254) throw new ConvexError("Add their email.");
  const roles = [...new Set(a.roles.map((r) => clip(r, 40)).filter(Boolean))].slice(0, 12);
  const rates = a.rates.slice(0, 12).map((r) => ({ role: clip(r.role, 40) || roles[0] || "Rate", unit: r.unit, cents: Math.round(r.cents) }));
  if (rates.some((r) => !Number.isFinite(r.cents) || r.cents < 0 || r.cents > 10_000_000)) throw new ConvexError("Check their rates.");
  return {
    name: clip(a.name, 120), email, roles, rates, basedIn: clip(a.basedIn, 80) || undefined, phone: clip(a.phone, 40) || undefined,
    portfolio: clip(a.portfolio, 300) || undefined, gear: a.gear ? [...new Set(a.gear.map((g) => clip(g, 40)).filter(Boolean))].slice(0, 30) : undefined, notes: clip(a.notes, 2000) || undefined,
  };
}

/** Pricing's subcontractor cost for a role ("Shooter" → the Shooter cost, per its kind's unit). */
export function pricingCost(r: Rates | undefined, role: string): { cents: number; unit: "day" | "hour"; name: string } | null {
  if (!r) return null;
  const c = r.costs.find((x) => x.name.trim().toLowerCase() === role.trim().toLowerCase());
  if (!c) return null;
  const kind = r.kinds.find((k) => k.id === c.kindId);
  return { cents: c.cents, unit: kind?.unit ?? "hour", name: c.name };
}
const status = (x: Doc<"vendors">) => (x.joinedAt ? "in the portal" : x.invitedAt ? `invited ${new Date(x.invitedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "not invited");

/** Step 4: from the vendor's invoices. Paid this year counts invoices paid since Jan 1 (Central), for 1099s. */
async function totalsOf(ctx: QueryCtx, vendorId: Id<"vendors">) {
  const rows = await ctx.db.query("vendorInvoices").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();
  const year = `${todayCentral().slice(0, 4)}-`;
  const sum = (xs: typeof rows) => xs.reduce((t, x) => t + x.totalCents, 0);
  const sent = rows.filter((x) => x.status === "sent"), approved = rows.filter((x) => x.status === "approved"), paid = rows.filter((x) => x.status === "paid" && (paidDay(x) ?? "").startsWith(year));
  return { paidThisYearCents: paid.reduce((t, x) => t + paidAmount(x), 0), approvedCents: sum(approved), approvedCount: approved.length, waitingCents: sum(sent), waitingCount: sent.length };
}

/** A vendor's invoices, for their page (each opens at Vendors › Payments). */
export const invoices = query({
  args: { vendorId: v.string() },
  handler: async (ctx, { vendorId }) => {
    await ownerBiz(ctx);
    const id = ctx.db.normalizeId("vendors", vendorId);
    if (!id) return null;
    const rows = (await ctx.db.query("vendorInvoices").withIndex("by_vendor", (q) => q.eq("vendorId", id)).collect()).filter((x) => x.status !== "draft").sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
    const out = [];
    for (const x of rows) { const p = await ctx.db.get(x.projectId); out.push({ _id: x._id, number: x.number, status: x.status, project: p?.name ?? "A project", totalCents: x.totalCents, sentAt: x.sentAt ?? null, paidAt: x.paidAt ?? null, paidOn: paidDay(x) }); }
    return out;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const rows = (await ctx.db.query("vendors").collect()).filter((x) => !x.archivedAt).sort((a, b) => a.name.localeCompare(b.name));
    const out = [];
    for (const x of rows) out.push({ _id: x._id, name: x.name, roles: x.roles, basedIn: x.basedIn ?? null, portal: status(x), w9: !!x.w9, paidThisYearCents: (await totalsOf(ctx, x._id)).paidThisYearCents });
    return out;
  },
});

export const get = query({
  args: { vendorId: v.string() },
  handler: async (ctx, { vendorId }) => {
    const b = await ownerBiz(ctx);
    const id = ctx.db.normalizeId("vendors", vendorId);
    const x = id ? await ctx.db.get(id) : null;
    if (!x) return null;
    const rates = await ratesOf(ctx, b);
    return {
      ...x, portal: status(x), w9: x.w9 ? { name: x.w9.name, uploadedAt: x.w9.uploadedAt, url: await ctx.storage.getUrl(x.w9.fileId) } : null,
      costs: x.roles.map((role) => ({ role, cost: pricingCost(rates, role) })),
      totals: await totalsOf(ctx, x._id),
    };
  },
});

export const add = mutation({
  args: { ...detailsV, invite: v.boolean() },
  handler: async (ctx, a) => {
    await ownerBiz(ctx);
    const d = clean(a);
    const dup = (await ctx.db.query("vendors").withIndex("by_email", (q) => q.eq("email", d.email)).collect()).find((x) => !x.archivedAt);
    if (dup) throw new ConvexError(`${dup.name} is already a vendor with that email.`);
    await assertNotClient(ctx, d.email); // D102
    const now = Date.now();
    const id = await ctx.db.insert("vendors", { ...d, ...(a.invite ? { invitedAt: now } : {}), createdAt: now, updatedAt: now });
    if (a.invite) await inviteNow(ctx, id);
    return id;
  },
});

export const update = mutation({
  args: { vendorId: v.id("vendors"), ...detailsV },
  handler: async (ctx, { vendorId, ...a }) => {
    await ownerBiz(ctx);
    const x = await ctx.db.get(vendorId);
    if (!x) throw new ConvexError("That vendor isn't here.");
    const d = clean(a);
    if (d.email !== x.email && (await ctx.db.query("vendors").withIndex("by_email", (q) => q.eq("email", d.email)).collect()).some((y) => y._id !== x._id && !y.archivedAt)) throw new ConvexError("Another vendor has that email.");
    if (d.email !== x.email) await assertNotClient(ctx, d.email); // D102
    // Review fix (step 6): a new email is a new login. The old address loses this business, and the new one needs a
    // fresh invite before it sees any of their bookings, invoices or W-9.
    if (d.email !== x.email) await endAccess(ctx, x);
    await ctx.db.patch(vendorId, { ...d, ...(d.email !== x.email ? { invitedAt: undefined, joinedAt: undefined } : {}), updatedAt: Date.now() });
    return null;
  },
});

/** Take a vendor off the list (their bookings, invoices and 1099 totals stay). */
export const archive = mutation({
  args: { vendorId: v.id("vendors"), archived: v.boolean() },
  handler: async (ctx, { vendorId, archived }) => {
    await ownerBiz(ctx);
    const x = await ctx.db.get(vendorId);
    if (!x) throw new ConvexError("That vendor isn't here.");
    if (!archived && x.archivedAt) await assertNotClient(ctx, x.email); // D102: back on the list only if still not a client's
    await ctx.db.patch(vendorId, { archivedAt: archived ? Date.now() : undefined, updatedAt: Date.now() });
    // Review fix (step 6): off the list ends their portal access to this business (and a booked editor's Review link);
    // back on the list gives it back to an invited vendor.
    if (archived && !x.archivedAt) await endAccess(ctx, x);
    if (!archived && x.archivedAt && x.invitedAt) {
      const user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", x.email)).first();
      await syncVendorMemberships(ctx, x.email, user?.role === "vendor" ? user._id : undefined);
    }
    return null;
  },
});

/** Their vendor login loses this business, and any Review link a booking gave them is switched off. */
async function endAccess(ctx: MutationCtx, x: Doc<"vendors">) {
  const now = Date.now();
  const biz = x.businessId;
  if (biz) for (const m of await ctx.db.query("memberships").withIndex("by_business_email", (q) => q.eq("businessId", biz).eq("email", x.email)).collect())
    if (m.role === "vendor" && !m.revokedAt) await ctx.db.patch(m._id, { revokedAt: now });
  for (const k of await ctx.db.query("vendorBookings").withIndex("by_vendor", (q) => q.eq("vendorId", x._id)).collect()) {
    if (!k.reviewShareId) continue;
    const sh = await ctx.db.get(k.reviewShareId);
    if (sh && !sh.offAt) await ctx.db.patch(sh._id, { offAt: now });
  }
}

// ---------- the vendor portal invite (step 4) ----------

/** Records the invite, gives someone who already has a vendor login (another business's vendor, D94) this business
 *  too, and emails them. */
async function inviteNow(ctx: MutationCtx, vendorId: Id<"vendors">) {
  const x = (await ctx.db.get(vendorId))!;
  const now = Date.now();
  await ctx.db.patch(vendorId, { invitedAt: now, updatedAt: now });
  const user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", x.email)).unique();
  if (user?.role === "vendor") await syncVendorMemberships(ctx, x.email, user._id);
  await ctx.scheduler.runAfter(0, internal.vendors.mailInvite, { vendorId, at: now });
}

/** Invite to the vendor portal, or send the invite again. */
export const invite = mutation({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, { vendorId }) => {
    await ownerBiz(ctx);
    const x = await ctx.db.get(vendorId);
    if (!x || x.archivedAt) throw new ConvexError("That vendor isn't on your list.");
    await assertNotClient(ctx, x.email); // D102
    await inviteNow(ctx, vendorId);
    return null;
  },
});

export const inviteData = internalQuery({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, { vendorId }) => {
    const x = await ctx.db.get(vendorId);
    if (!x || x.archivedAt || !x.invitedAt) return null;
    const user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", x.email)).unique();
    return { name: x.name, email: x.email, hasAccount: !!user, brand: await mailBrandOf(ctx, x.businessId ?? null) };
  },
});

export const mailInvite = internalAction({
  args: { vendorId: v.id("vendors"), at: v.number() },
  handler: async (ctx, { vendorId, at }) => {
    const d = await ctx.runQuery(internal.vendors.inviteData, { vendorId });
    if (!d) return;
    await deliverOnce(ctx, `vendor-invite:${vendorId}:${at}`, "vendor_invite", d.email, vendorInviteMail(d.brand, { name: d.name, email: d.email, hasAccount: d.hasAccount }), d.brand.replyTo);
  },
});
