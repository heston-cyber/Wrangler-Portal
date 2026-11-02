// Phase 3c step 2 (Nov 2) · bookings, the owner's side: Book a vendor (S5 · Phase 3c 732:3051), the Crew card on the
// project Overview (730:2326, D96), Vendors › Bookings (730:3942), the bookings on a vendor's page, and the expected
// costs in the project's Ledger (730:3160). Sending a booking emails the vendor (email 24, 735:5139); they accept or
// decline it in their vendor portal (step 4). Nothing here moves money (D92). Owner only.
import { internalAction, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { businessInScope } from "./lib/business";
import { ratesOf } from "./crm";
import { assertNotClient } from "./lib/roles";
import { daysIn, isDate, todayCentral } from "./lib/bookings";
import { type BookingRow, label, order, rowOf } from "./lib/bookingRows";
import { mailBrandOf } from "./lib/mail";
import { bookingOfferMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { SITE } from "./lib/site";

const clip = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);

async function ownerBiz(ctx: QueryCtx | MutationCtx) {
  const me = await requireMe(ctx);
  const id = businessInScope(ctx);
  const b = id ? await ctx.db.get(id) : null;
  if (!b) throw new ConvexError("Not allowed.");
  return { b, me };
}

// ---------- reads ----------

/** What the Book a vendor dialog needs: your vendors, your projects, and Pricing's subcontractor costs. */
export const form = query({
  args: { projectId: v.optional(v.string()) },
  handler: async (ctx, { projectId }) => {
    const { b } = await ownerBiz(ctx);
    const r = await ratesOf(ctx, b);
    const vendors = (await ctx.db.query("vendors").collect()).filter((x) => !x.archivedAt).sort((a, c) => a.name.localeCompare(c.name))
      .map((x) => ({ _id: x._id, name: x.name, roles: x.roles, rates: x.rates }));
    const projects = (await ctx.db.query("projects").collect()).sort((a, c) => (c.updatedAt ?? c.createdAt) - (a.updatedAt ?? a.createdAt))
      .map((p) => ({ _id: p._id, label: label(p) }));
    const pid = projectId ? ctx.db.normalizeId("projects", projectId) : null;
    return {
      vendors, projects, project: pid ? projects.find((p) => p._id === pid) ?? null : null,
      rates: { costs: r.costs, kinds: r.kinds, fullDayHours: r.fullDayHours },
    };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const today = todayCentral();
    const out: BookingRow[] = [];
    for (const x of await ctx.db.query("vendorBookings").collect()) out.push(await rowOf(ctx, x, today));
    return out.sort(order);
  },
});

/** The Crew card (D96): everyone booked on this project, cancelled ones left out. */
export const forProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    await ownerBiz(ctx);
    const id = ctx.db.normalizeId("projects", projectId);
    if (!id || !(await ctx.db.get(id))) return null;
    const today = todayCentral();
    const out: BookingRow[] = [];
    for (const x of await ctx.db.query("vendorBookings").withIndex("by_project", (q) => q.eq("projectId", id)).collect()) if (x.status !== "cancelled") out.push(await rowOf(ctx, x, today));
    return out.sort(order);
  },
});

export const forVendor = query({
  args: { vendorId: v.string() },
  handler: async (ctx, { vendorId }) => {
    await ownerBiz(ctx);
    const id = ctx.db.normalizeId("vendors", vendorId);
    if (!id || !(await ctx.db.get(id))) return null;
    const today = todayCentral();
    const out: BookingRow[] = [];
    for (const x of await ctx.db.query("vendorBookings").withIndex("by_vendor", (q) => q.eq("vendorId", id)).collect()) out.push(await rowOf(ctx, x, today));
    return out.sort((a, c) => c.start.localeCompare(a.start) || c.offeredAt - a.offeredAt); // newest work first
  },
});

export const get = query({
  args: { bookingId: v.string() },
  handler: async (ctx, { bookingId }) => {
    await ownerBiz(ctx);
    const id = ctx.db.normalizeId("vendorBookings", bookingId);
    const x = id ? await ctx.db.get(id) : null;
    if (!x) return null;
    const vendor = await ctx.db.get(x.vendorId);
    // Phase 3c step 3: the newest briefing for this booking, to open from here.
    const brief = (await ctx.db.query("briefings").withIndex("by_booking", (q) => q.eq("bookingId", x._id)).collect()).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    return { ...(await rowOf(ctx, x, todayCentral())), vendorEmail: vendor?.email ?? null, suggestedCents: x.suggestedCents ?? null, createdBy: x.createdBy ?? null,
      briefing: brief ? { _id: brief._id, sentAt: brief.sentAt ?? null, readAt: brief.readAt ?? null } : null };
  },
});

// ---------- writes ----------

export const create = mutation({
  args: {
    vendorId: v.id("vendors"), projectId: v.id("projects"), role: v.string(), start: v.string(), end: v.string(),
    cents: v.number(), unit: v.union(v.literal("day"), v.literal("hour")), hours: v.optional(v.number()),
    suggestedCents: v.optional(v.number()), location: v.optional(v.string()), note: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const { me } = await ownerBiz(ctx);
    const vendor = await ctx.db.get(a.vendorId);
    if (!vendor || vendor.archivedAt) throw new ConvexError("That vendor isn't on your list.");
    await assertNotClient(ctx, vendor.email); // D102
    if (!(await ctx.db.get(a.projectId))) throw new ConvexError("That project isn't here.");
    const role = clip(a.role, 40);
    if (!role) throw new ConvexError("Pick a role.");
    if (!isDate(a.start) || !isDate(a.end)) throw new ConvexError("Pick the dates.");
    if (a.end < a.start) throw new ConvexError("The last day is before the first.");
    if (daysIn(a.start, a.end) > 366) throw new ConvexError("A booking can be a year at most.");
    if (!(Number.isInteger(a.cents) && a.cents > 0 && a.cents <= 10_000_000)) throw new ConvexError("Add the agreed rate.");
    let hours: number | undefined;
    if (a.unit === "hour") {
      if (!(Number(a.hours) > 0 && Number(a.hours) <= 2000)) throw new ConvexError("Add the hours you expect.");
      hours = Math.round(a.hours! * 100) / 100;
    }
    const now = Date.now();
    const id = await ctx.db.insert("vendorBookings", {
      vendorId: a.vendorId, projectId: a.projectId, role, start: a.start, end: a.end, rate: { cents: a.cents, unit: a.unit },
      ...(hours ? { hours } : {}), ...(a.suggestedCents && a.suggestedCents > 0 ? { suggestedCents: Math.round(a.suggestedCents) } : {}),
      ...(clip(a.location, 160) ? { location: clip(a.location, 160) } : {}), ...(clip(a.note, 1000) ? { note: clip(a.note, 1000) } : {}),
      status: "offered", offeredAt: now, createdBy: me.name ?? me.email, createdAt: now, updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.bookings.mailOffer, { bookingId: id });
    return id;
  },
});

/** Take back an offer, or call off an accepted booking. Its expected cost leaves the Ledger. The vendor isn't emailed. */
export const cancel = mutation({
  args: { bookingId: v.id("vendorBookings") },
  handler: async (ctx, { bookingId }) => {
    await ownerBiz(ctx);
    const x = await ctx.db.get(bookingId);
    if (!x) throw new ConvexError("That booking isn't here.");
    if (x.status !== "offered" && x.status !== "accepted") throw new ConvexError(x.status === "declined" ? "They already declined it." : "It's already cancelled.");
    const now = Date.now();
    await ctx.db.patch(bookingId, { status: "cancelled", cancelledAt: now, updatedAt: now });
    if (x.reviewShareId) { const sh = await ctx.db.get(x.reviewShareId); if (sh && !sh.offAt) await ctx.db.patch(sh._id, { offAt: now }); } // a booked editor's Review access ends
    return null;
  },
});

// ---------- email 24 ----------

export const mailData = internalQuery({
  args: { bookingId: v.id("vendorBookings") },
  handler: async (ctx, { bookingId }) => {
    const x = await ctx.db.get(bookingId);
    if (!x || x.status !== "offered") return null;
    const vendor = await ctx.db.get(x.vendorId);
    const p = await ctx.db.get(x.projectId);
    if (!vendor || !p) return null;
    return { x, vendor: { name: vendor.name, email: vendor.email }, project: p.name, brand: await mailBrandOf(ctx, x.businessId ?? null), link: `${SITE()}/vendor/bookings/${x._id}` };
  },
});

export const mailOffer = internalAction({
  args: { bookingId: v.id("vendorBookings") },
  handler: async (ctx, { bookingId }) => {
    const d = await ctx.runQuery(internal.bookings.mailData, { bookingId });
    if (!d) return;
    await deliverOnce(ctx, `booking-offer:${bookingId}`, "booking_offer", d.vendor.email, bookingOfferMail(d.brand, {
      name: d.vendor.name, role: d.x.role, project: d.project, start: d.x.start, end: d.x.end, rateCents: d.x.rate.cents, unit: d.x.rate.unit,
      hours: d.x.hours ?? null, location: d.x.location ?? null, note: d.x.note ?? null, link: d.link,
    }), d.brand.replyTo);
  },
});
