// Phase 3c step 5 (Nov 2) · vendor payments, the owner's side (S5 · Phase 3c 730:5246 Vendors › Payments, 730:5780 the
// 1099 tab, 731:2198 / 731:2769 / 731:3341 a vendor invoice To approve · Approved · Paid, 732:3190 Mark paid).
// Approve puts the invoice in the project's Ledger as an actual cost (it takes the place of the booking's expected
// cost) and emails the vendor (27). Mark paid records the day, amount and method the owner paid them outside the
// portal, and emails the vendor (28). Nothing here moves money (D92). Owner only.
import { internalAction, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { businessInScope } from "./lib/business";
import { PAY_METHODS, expectedCents, isDate, looksLikeAccount, todayCentral } from "./lib/bookings";
import { label, paidAmount, paidDay } from "./lib/bookingRows";
import { mailBrandOf } from "./lib/mail";
import { vendorInvoiceApprovedMail, vendorInvoiceDeclinedMail, vendorInvoicePaidMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { SITE } from "./lib/site";

type Ctx = QueryCtx | MutationCtx;
const clip = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);

async function ownerBiz(ctx: Ctx) {
  const me = await requireMe(ctx);
  const id = businessInScope(ctx);
  const b = id ? await ctx.db.get(id) : null;
  if (!b) throw new ConvexError("Not allowed.");
  return { b, me };
}

const qtyText = (x: Doc<"vendorInvoices">) => {
  const q = Math.round(x.hours.reduce((t, h) => t + h.qty, 0) * 100) / 100;
  return x.rate.unit === "day" ? `${q} ${q === 1 ? "day" : "days"}` : `${q} h`;
};

async function rowOf(ctx: Ctx, x: Doc<"vendorInvoices">) {
  const vendor = await ctx.db.get(x.vendorId);
  const k = await ctx.db.get(x.bookingId);
  const p = await ctx.db.get(x.projectId);
  const role = k?.role ?? "";
  const what = x.mode === "hours" ? `${qtyText(x)} ${role.toLowerCase()}`.trim() : `${x.lines.length} line${x.lines.length === 1 ? "" : "s"}`;
  return {
    _id: x._id, number: x.number, status: x.status, vendorId: x.vendorId, vendor: vendor?.name ?? "A vendor", project: p ? label(p) : "A project",
    role, what, totalCents: x.totalCents, sentAt: x.sentAt ?? null, approvedAt: x.approvedAt ?? null, paidAt: x.paidAt ?? null, paidOn: paidDay(x),
    paidCents: x.status === "paid" ? paidAmount(x) : null, paidMethod: x.paidMethod ?? null, declinedAt: x.declinedAt ?? null,
  };
}

// ---------- reads ----------

/** Vendors › Payments: the three tabs' rows (drafts and declined invoices stay off it). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const all = (await ctx.db.query("vendorInvoices").collect()).filter((x) => x.status === "sent" || x.status === "approved" || x.status === "paid");
    const rows = [];
    for (const x of all) rows.push(await rowOf(ctx, x));
    return {
      toApprove: rows.filter((r) => r.status === "sent").sort((a, c) => (a.sentAt ?? 0) - (c.sentAt ?? 0)), // oldest first: waiting longest
      approved: rows.filter((r) => r.status === "approved").sort((a, c) => (c.approvedAt ?? 0) - (a.approvedAt ?? 0)),
      paid: rows.filter((r) => r.status === "paid").sort((a, c) => (c.paidOn ?? "").localeCompare(a.paidOn ?? "") || (c.paidAt ?? 0) - (a.paidAt ?? 0)),
    };
  },
});

/** The 1099 tab: each vendor's total paid in a calendar year (by the paid date), with W-9 status. */
export const totals1099 = query({
  args: { year: v.optional(v.number()) },
  handler: async (ctx, { year }) => {
    await ownerBiz(ctx);
    const paid = (await ctx.db.query("vendorInvoices").withIndex("by_status", (q) => q.eq("status", "paid")).collect());
    const thisYear = Number(todayCentral().slice(0, 4));
    const years = [...new Set([thisYear, ...paid.map((x) => Number((paidDay(x) ?? "").slice(0, 4))).filter((y) => y > 2000)])].sort((a, b) => b - a);
    const y = year && years.includes(year) ? year : thisYear;
    const mine = paid.filter((x) => (paidDay(x) ?? "").startsWith(`${y}-`));
    const byVendor = new Map<Id<"vendors">, Doc<"vendorInvoices">[]>();
    for (const x of mine) byVendor.set(x.vendorId, [...(byVendor.get(x.vendorId) ?? []), x]);
    const rows = [];
    for (const [vendorId, xs] of byVendor) {
      const vd = await ctx.db.get(vendorId);
      const last = xs.map((x) => paidDay(x) ?? "").sort().pop() ?? null;
      rows.push({ vendorId, name: vd?.name ?? "A vendor", businessName: vd?.businessName ?? null, address: vd?.address ?? null, email: vd?.email ?? null,
        w9: !!vd?.w9, payments: xs.length, last, totalCents: xs.reduce((t, x) => t + paidAmount(x), 0) });
    }
    rows.sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name));
    return { year: y, years, rows, missing: rows.filter((r) => !r.w9).map((r) => ({ vendorId: r.vendorId, name: r.name, email: r.email })) };
  },
});

/** A vendor invoice, for its page. */
export const get = query({
  args: { invoiceId: v.string() },
  handler: async (ctx, { invoiceId }) => {
    const { b } = await ownerBiz(ctx);
    const id = ctx.db.normalizeId("vendorInvoices", invoiceId);
    const x = id ? await ctx.db.get(id) : null;
    if (!x || x.status === "draft") return null;
    const vendor = await ctx.db.get(x.vendorId);
    const k = await ctx.db.get(x.bookingId);
    const p = await ctx.db.get(x.projectId);
    const lines = x.mode === "hours"
      ? x.hours.map((h) => ({ label: h.label || (x.rate.unit === "day" ? "Day" : "Hours"), qty: h.qty, rateCents: x.rate.cents, cents: Math.round(h.qty * x.rate.cents) }))
      : x.lines.map((l) => ({ label: l.description, qty: null as number | null, rateCents: null as number | null, cents: l.cents }));
    const history: Array<{ at: number; text: string }> = x.history?.length ? [...x.history] : [];
    if (!x.history?.length) {
      if (x.sentAt) history.push({ at: x.sentAt, text: `Sent by ${vendor?.name ?? "the vendor"}` });
      if (x.approvedAt) history.push({ at: x.approvedAt, text: "Approved by you · added to the Ledger" });
      if (x.paidAt) history.push({ at: x.paidAt, text: `Marked paid · ${x.paidMethod ?? ""}`.replace(/ · $/, "") });
    }
    history.sort((a, c) => c.at - a.at);
    return {
      _id: x._id, number: x.number, status: x.status, mode: x.mode, note: x.note ?? null, totalCents: x.totalCents,
      sentAt: x.sentAt ?? null, approvedAt: x.approvedAt ?? null, declinedAt: x.declinedAt ?? null, declineReason: x.declineReason ?? null,
      paidAt: x.paidAt ?? null, paidOn: paidDay(x), paidCents: x.status === "paid" ? paidAmount(x) : null, paidMethod: x.paidMethod ?? null, paidRef: x.paidRef ?? null,
      to: b.name, vendor: { _id: x.vendorId, name: vendor?.name ?? "A vendor", email: vendor?.email ?? null, businessName: vendor?.businessName ?? null, address: vendor?.address ?? null,
        payMethod: vendor?.payMethod ?? null },
      project: { _id: x.projectId, label: p ? label(p) : "A project", name: p?.name ?? "A project" },
      booking: k ? { _id: k._id, role: k.role, start: k.start, end: k.end, rate: k.rate, hours: k.hours ?? null, expectedCents: expectedCents(k) } : null,
      lines, history, ledgerEntryId: x.ledgerEntryId ?? null,
    };
  },
});

// ---------- writes ----------

/** Approve: into the project's Ledger as an actual cost, and email 27 to the vendor. */
export const approve = mutation({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }) => {
    const { me } = await ownerBiz(ctx);
    const x = await ctx.db.get(invoiceId);
    if (!x || x.status === "draft") throw new ConvexError("That invoice isn't here.");
    if (x.status !== "sent") throw new ConvexError(x.status === "declined" ? "You declined it. They can fix it and send it again." : "It's already approved.");
    const vendor = await ctx.db.get(x.vendorId);
    const k = await ctx.db.get(x.bookingId);
    if (!(await ctx.db.get(x.projectId))) throw new ConvexError("Its project isn't here any more.");
    const now = Date.now();
    const who = me.name ?? me.email;
    const entryId = await ctx.db.insert("ledgerEntries", {
      projectId: x.projectId, kind: "cost", cents: x.totalCents, who: clip(vendor?.name ?? "Vendor", 80),
      note: clip(`Invoice ${x.number}${k?.role ? ` · ${k.role}` : ""}`, 300), date: todayCentral(now), vendorInvoiceId: x._id, createdBy: who, createdAt: now,
    });
    const history = [...(x.history ?? []), { at: now, text: "Approved by you · added to the Ledger" }];
    await ctx.db.patch(invoiceId, { status: "approved", approvedAt: now, approvedBy: who, ledgerEntryId: entryId, seenAt: x.seenAt ?? now, history, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.vendorPayments.mailApproved, { invoiceId });
    return null;
  },
});

/** Decline with a reason. The vendor gets an email (Nov 2) and sees it in their portal, where they fix and resend it. */
export const decline = mutation({
  args: { invoiceId: v.id("vendorInvoices"), reason: v.string() },
  handler: async (ctx, { invoiceId, reason }) => {
    await ownerBiz(ctx);
    const x = await ctx.db.get(invoiceId);
    if (!x || x.status === "draft") throw new ConvexError("That invoice isn't here.");
    if (x.status !== "sent") throw new ConvexError(x.status === "declined" ? "It's already declined." : "It's approved, so it can't be declined.");
    const why = clip(reason, 500);
    if (!why) throw new ConvexError("Say why, so they can fix it.");
    const now = Date.now();
    await ctx.db.patch(invoiceId, { status: "declined", declinedAt: now, declineReason: why, history: [...(x.history ?? []), { at: now, text: `Declined by you: ${why}` }], updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.vendorPayments.mailDeclined, { invoiceId, at: now }); // Nov 2: email for everything
    return null;
  },
});

/** Mark paid (732:3190): records how they were paid outside the portal. Email 28 to the vendor. */
export const markPaid = mutation({
  args: { invoiceId: v.id("vendorInvoices"), paidOn: v.string(), cents: v.number(), method: v.string(), reference: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await ownerBiz(ctx);
    const x = await ctx.db.get(a.invoiceId);
    if (!x || x.status === "draft") throw new ConvexError("That invoice isn't here.");
    if (x.status !== "approved") throw new ConvexError(x.status === "paid" ? "It's already marked paid." : "Approve it first.");
    if (!isDate(a.paidOn)) throw new ConvexError("Pick the day you paid.");
    if (a.paidOn > todayCentral()) throw new ConvexError("The paid date can't be in the future.");
    if (!(Number.isInteger(a.cents) && a.cents > 0 && a.cents <= 100_000_000)) throw new ConvexError("Add the amount you paid.");
    if (!PAY_METHODS.includes(a.method)) throw new ConvexError("Pick how you paid.");
    const ref = clip(a.reference, 80);
    if (looksLikeAccount(ref)) throw new ConvexError("Leave account numbers out. A short confirmation number, or its last 4 digits, is enough.");
    const now = Date.now();
    await ctx.db.patch(a.invoiceId, {
      status: "paid", paidAt: now, paidOn: a.paidOn, paidCents: a.cents, paidMethod: a.method, ...(ref ? { paidRef: ref } : {}),
      history: [...(x.history ?? []), { at: now, text: `Marked paid · ${a.method} · ${new Date(`${a.paidOn}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })}` }], updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.vendorPayments.mailPaid, { invoiceId: a.invoiceId });
    return null;
  },
});

// ---------- emails 27 and 28 ----------

export const mailData = internalQuery({
  args: { invoiceId: v.id("vendorInvoices"), status: v.union(v.literal("approved"), v.literal("paid"), v.literal("declined")) },
  handler: async (ctx, { invoiceId, status }) => {
    const x = await ctx.db.get(invoiceId);
    if (!x || x.status !== status) return null;
    const vendor = await ctx.db.get(x.vendorId);
    const p = await ctx.db.get(x.projectId);
    if (!vendor || vendor.archivedAt) return null;
    return { x, paidOn: paidDay(x), paidCents: paidAmount(x), vendor: { name: vendor.name, email: vendor.email }, project: p?.name ?? "A project",
      brand: await mailBrandOf(ctx, x.businessId ?? null), link: `${SITE()}/vendor/invoices/${x._id}` };
  },
});

export const mailApproved = internalAction({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }) => {
    const d = await ctx.runQuery(internal.vendorPayments.mailData, { invoiceId, status: "approved" });
    if (!d) return;
    await deliverOnce(ctx, `vendor-invoice-approved:${invoiceId}`, "vendor_invoice_approved", d.vendor.email, vendorInvoiceApprovedMail(d.brand, {
      name: d.vendor.name, number: d.x.number, project: d.project, totalCents: d.x.totalCents, approvedOn: todayCentral(d.x.approvedAt ?? Date.now()), link: d.link,
    }), d.brand.replyTo, d.x.businessId ?? null);
  },
});

export const mailDeclined = internalAction({
  args: { invoiceId: v.id("vendorInvoices"), at: v.number() },
  handler: async (ctx, { invoiceId, at }) => {
    const d = await ctx.runQuery(internal.vendorPayments.mailData, { invoiceId, status: "declined" });
    if (!d) return;
    await deliverOnce(ctx, `vendor-invoice-declined:${invoiceId}:${at}`, "vendor_invoice_declined", d.vendor.email, vendorInvoiceDeclinedMail(d.brand, {
      name: d.vendor.name, number: d.x.number, project: d.project, totalCents: d.x.totalCents, reason: d.x.declineReason ?? "", link: d.link,
    }), d.brand.replyTo, d.x.businessId ?? null);
  },
});

export const mailPaid = internalAction({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }) => {
    const d = await ctx.runQuery(internal.vendorPayments.mailData, { invoiceId, status: "paid" });
    if (!d || !d.paidOn) return;
    await deliverOnce(ctx, `vendor-invoice-paid:${invoiceId}`, "vendor_invoice_paid", d.vendor.email, vendorInvoicePaidMail(d.brand, {
      name: d.vendor.name, number: d.x.number, project: d.project, paidCents: d.paidCents, paidOn: d.paidOn, method: d.x.paidMethod ?? "Other", link: d.link,
    }), d.brand.replyTo, d.x.businessId ?? null);
  },
});
