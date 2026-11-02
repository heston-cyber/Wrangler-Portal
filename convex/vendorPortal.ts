// Phase 3c step 4 (Nov 2) · the vendor side of the portal (S5 · Phase 3c 733:3100 Home, 733:3658 a booking, 733:3985 a
// briefing, 732:3285 Decline, 734:5189 the "Working for" switcher). A third side, beside the owner's and the client's.
// One login across the businesses a vendor works for (D94); every call works for one of them, and sees only that
// business's work with this vendor: their own vendor record, their bookings, the briefings sent to them.
//
// Who may call: a signed-in vendor login (users.role "vendor") with a live vendor membership in the business, whose
// vendor record there is still on the list. Owners and clients are refused here, and vendors are refused everywhere
// else (requireMe, requireSignedIn).
import { focusBusiness, internalAction, internalQuery, mutation, query } from "./lib/functions";
import { internal } from "./_generated/api";
import { randomToken } from "./lib/hash";
import { businessContact } from "./lib/business";
import { mailBrandOf } from "./lib/mail";
import { ownerBookingAcceptedMail, ownerBookingDeclinedMail, ownerBriefingReadMail, ownerVendorInvoiceMail, ownerW9Mail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { SITE } from "./lib/site";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { PAY_METHODS, looksLikeAccount, bookingState, daysIn, expectedCents, todayCentral, type BookingState } from "./lib/bookings";
import { label, paidAmount, paidDay } from "./lib/bookingRows";
import { prefRow, setSwitch, viewFor } from "./lib/notifyPrefs";

type Ctx = QueryCtx | MutationCtx;

/** The vendor's businesses (live vendor memberships whose vendor record is still on that business's list). */
async function myBusinesses(ctx: Ctx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  const user = await ctx.db.get(userId);
  const email = (user?.email ?? "").toLowerCase();
  if (!user || user.role !== "vendor" || !email) throw new ConvexError("Not allowed.");
  const ms = (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", email)).collect()).filter((m) => m.role === "vendor" && !m.revokedAt).sort((a, b) => a.createdAt - b.createdAt);
  return { user, email, ids: [...new Set(ms.map((m) => m.businessId))] };
}

/** Acts for one of the vendor's businesses: focuses the call on it and returns their vendor record there. */
async function asVendor(ctx: Ctx, businessId?: Id<"businesses"> | null) {
  const me = await vendorIn(ctx, businessId);
  if (!me) throw new ConvexError("Not allowed.");
  return me;
}
/** The same, but null (not a throw) when they don't work for that business, or are no longer on its list. */
async function vendorIn(ctx: Ctx, businessId?: Id<"businesses"> | null) {
  const { user, email, ids } = await myBusinesses(ctx);
  const biz = businessId ?? ids[0];
  if (!biz || !ids.includes(biz)) return null;
  focusBusiness(ctx, biz);
  const vendor = (await ctx.db.query("vendors").withIndex("by_email", (q) => q.eq("email", email)).collect()).find((x) => !x.archivedAt && (x.businessId ?? biz) === biz);
  return vendor ? { user, email, biz, vendor } : null;
}
/** A record's business, read without trusting it: the caller must be that business's vendor, and it must be theirs. */
async function mine<T extends { businessId?: Id<"businesses"> }>(ctx: Ctx, doc: T | null, owns: (vendorId: Id<"vendors">) => boolean) {
  await myBusinesses(ctx); // a vendor login first, whether or not the record exists
  if (!doc) return null;
  const me = await vendorIn(ctx, doc.businessId ?? null);
  return me && owns(me.vendor._id) ? me : null;
}

const ownerOf = async (ctx: Ctx, biz: Id<"businesses">) => { const b = await ctx.db.get(biz); return { business: b?.name ?? "The business", owner: b?.ownerName?.trim() || b?.name || "The business" }; };

async function bookingRow(ctx: Ctx, x: Doc<"vendorBookings">, today: string) {
  const p = await ctx.db.get(x.projectId);
  const briefs = (await ctx.db.query("briefings").withIndex("by_booking", (q) => q.eq("bookingId", x._id)).collect()).filter((b) => b.status === "sent" && b.sentTo?.vendorId === x.vendorId);
  const brief = briefs.sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0))[0] ?? null;
  return {
    _id: x._id, project: p ? label(p) : "A project", projectName: p?.name ?? "A project", role: x.role, start: x.start, end: x.end, days: daysIn(x.start, x.end),
    rate: x.rate, hours: x.hours ?? null, expectedCents: expectedCents(x), state: bookingState(x, today) as BookingState, location: x.location ?? null, note: x.note ?? null,
    declineReason: x.declineReason ?? null, offeredAt: x.offeredAt, answeredAt: x.answeredAt ?? null,
    brief: brief ? { _id: brief._id, readAt: brief.readAt ?? null, sentAt: brief.sentAt ?? null } : null,
  };
}
const myBookings = async (ctx: Ctx, vendorId: Id<"vendors">) => ctx.db.query("vendorBookings").withIndex("by_vendor", (q) => q.eq("vendorId", vendorId)).collect();

async function briefRow(ctx: Ctx, x: Doc<"briefings">) {
  const build = await ctx.db.get(x.buildId);
  const k = x.bookingId ? await ctx.db.get(x.bookingId) : null;
  const p = await ctx.db.get(x.projectId);
  return {
    _id: x._id, title: build?.title ?? "Briefing", kind: x.starter === "edit" ? "Edit brief" : x.starter === "shoot" ? "Shoot brief" : "Brief", project: p ? label(p) : "A project",
    role: k?.role ?? null, start: k?.start ?? null, end: k?.end ?? null, sentAt: x.sentAt ?? 0, readAt: x.readAt ?? null,
  };
}
/** Briefings sent to this vendor, newest first. */
async function myBriefings(ctx: Ctx, vendorId: Id<"vendors">) {
  const out = [];
  for (const k of await myBookings(ctx, vendorId))
    for (const b of await ctx.db.query("briefings").withIndex("by_booking", (q) => q.eq("bookingId", k._id)).collect())
      if (b.status === "sent" && b.sentTo?.vendorId === vendorId) out.push(b);
  return out.sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
}

// ---------- who they are, and the businesses they work for ----------

export const businesses = query({
  args: {},
  handler: async (ctx) => {
    const { user, ids } = await myBusinesses(ctx);
    const list = [];
    for (const id of ids) {
      const b = await ctx.db.get(id);
      if (b) list.push({ businessId: b._id, name: b.name, accent: b.accent ?? null, background: b.background ?? null, logoUrl: b.logoFileId ? await ctx.storage.getUrl(b.logoFileId) : null });
    }
    return { name: user.name ?? null, email: user.email ?? "", list };
  },
});

/** The switcher's "{n} new": offers to answer and briefings to read, for one business. */
export const counts = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, { businessId }) => {
    const { vendor } = await asVendor(ctx, businessId);
    const offered = (await myBookings(ctx, vendor._id)).filter((x) => x.status === "offered").length;
    const toRead = (await myBriefings(ctx, vendor._id)).filter((b) => !b.readAt).length;
    return { offered, toRead, total: offered + toRead };
  },
});

// ---------- Home (733:3100) ----------

export const home = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, { businessId }) => {
    const { biz, vendor } = await asVendor(ctx, businessId);
    const today = todayCentral();
    const rows = [];
    for (const x of (await myBookings(ctx, vendor._id)).sort((a, b) => a.start.localeCompare(b.start))) rows.push(await bookingRow(ctx, x, today));
    const briefs = [];
    for (const b of (await myBriefings(ctx, vendor._id)).filter((b) => !b.readAt)) briefs.push(await briefRow(ctx, b));
    return {
      businessId: biz, ...(await ownerOf(ctx, biz)), name: vendor.name,
      offered: rows.filter((x) => x.state === "offered"), upcoming: rows.filter((x) => x.state === "accepted"), toRead: briefs,
      details: { w9: !!vendor.w9, payMethod: vendor.payMethod?.method ?? null },
    };
  },
});

// ---------- Bookings ----------

export const bookings = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, { businessId }) => {
    const { biz, vendor } = await asVendor(ctx, businessId);
    const today = todayCentral();
    const out = [];
    for (const x of await myBookings(ctx, vendor._id)) out.push(await bookingRow(ctx, x, today));
    return { businessId: biz, rows: out.sort((a, b) => a.start.localeCompare(b.start)) };
  },
});

export const booking = query({
  args: { bookingId: v.string() },
  handler: async (ctx, { bookingId }) => {
    const id = ctx.db.normalizeId("vendorBookings", bookingId);
    const x = id ? await ctx.db.get(id) : null;
    const me = await mine(ctx, x, (vid) => x!.vendorId === vid);
    if (!me || !x) return null;
    return { businessId: me.biz, ...(await ownerOf(ctx, me.biz)), ...(await bookingRow(ctx, x, todayCentral())) };
  },
});

async function openOffer(ctx: MutationCtx, bookingId: Id<"vendorBookings">) {
  const x = await ctx.db.get(bookingId);
  const me = await mine(ctx, x, (vid) => x!.vendorId === vid);
  if (!me || !x) throw new ConvexError("That booking isn't here.");
  if (x.status !== "offered") throw new ConvexError(x.status === "accepted" ? "You've already accepted it." : x.status === "declined" ? "You've already declined it." : "It was cancelled.");
  return x;
}

export const accept = mutation({
  args: { bookingId: v.id("vendorBookings") },
  handler: async (ctx, { bookingId }) => {
    const x = await openOffer(ctx, bookingId);
    const now = Date.now();
    await ctx.db.patch(bookingId, { status: "accepted", answeredAt: now, updatedAt: now });
    // D93, D103: a booked editor can comment on the project's cuts from now until 30 days after the booking's last day.
    if (isEditing(x.role)) {
      const shareId = await editorShare(ctx, x);
      if (shareId) await ctx.db.patch(bookingId, { reviewShareId: shareId });
    }
    await ctx.scheduler.runAfter(0, internal.vendorPortal.mailAccepted, { bookingId }); // Heston, Nov 2: email the owner
    return null;
  },
});

/** Decline with a reason (732:3285); the owner sees it on the booking and the Crew card. */
export const decline = mutation({
  args: { bookingId: v.id("vendorBookings"), reason: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await openOffer(ctx, a.bookingId);
    const reason = a.reason.trim().slice(0, 60);
    if (!reason) throw new ConvexError("Pick a reason.");
    const note = (a.note ?? "").trim().slice(0, 500);
    const now = Date.now();
    await ctx.db.patch(a.bookingId, { status: "declined", declineReason: note ? `${reason}: ${note}` : reason, answeredAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.vendorPortal.mailOwner, { what: "declined", id: a.bookingId }); // Nov 2: email for everything
    return null;
  },
});

// ---------- Briefings ----------

export const briefings = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, { businessId }) => {
    const { biz, vendor } = await asVendor(ctx, businessId);
    const out = [];
    for (const b of await myBriefings(ctx, vendor._id)) out.push(await briefRow(ctx, b));
    return { businessId: biz, rows: out };
  },
});

async function sentToMe(ctx: Ctx, briefingId: string) {
  const id = ctx.db.normalizeId("briefings", briefingId);
  const x = id ? await ctx.db.get(id) : null;
  const me = await mine(ctx, x, (vid) => x!.status === "sent" && x!.sentTo?.vendorId === vid);
  return me && x ? { me, x } : null;
}

/** One briefing (733:3985): the PDF that was sent, read-only. */
export const briefing = query({
  args: { briefingId: v.string() },
  handler: async (ctx, { briefingId }) => {
    const r = await sentToMe(ctx, briefingId);
    if (!r) return null;
    return { businessId: r.me.biz, ...(await ownerOf(ctx, r.me.biz)), ...(await briefRow(ctx, r.x)), pdfUrl: r.x.pdfId ? await ctx.storage.getUrl(r.x.pdfId) : null };
  },
});

/** "I've read it": records the time; the owner sees "Read {date}". */
export const markRead = mutation({
  args: { briefingId: v.id("briefings") },
  handler: async (ctx, { briefingId }) => {
    const r = await sentToMe(ctx, briefingId);
    if (!r) throw new ConvexError("That briefing isn't here.");
    if (r.x.readAt) return null;
    const now = Date.now();
    await ctx.db.patch(r.x._id, { readAt: now, updatedAt: now, history: [...r.x.history, { kind: "read", at: now, by: r.me.vendor.name }].slice(-60) });
    await ctx.scheduler.runAfter(0, internal.vendorPortal.mailOwner, { what: "read", id: r.x._id }); // Nov 2
    return null;
  },
});

// ---------- the owner's email when a vendor accepts (Heston, Nov 2) ----------

export const acceptedData = internalQuery({
  args: { bookingId: v.id("vendorBookings") },
  handler: async (ctx, { bookingId }) => {
    const x = await ctx.db.get(bookingId);
    if (!x || x.status !== "accepted") return null;
    const vendor = await ctx.db.get(x.vendorId);
    const p = await ctx.db.get(x.projectId);
    if (!vendor || !p) return null;
    const c = await businessContact(ctx, x.businessId ?? null);
    return { owner: c.ownerEmail, vendor: vendor.name, x, project: label(p), brand: await mailBrandOf(ctx, x.businessId ?? null), link: `${SITE()}/vendors/bookings/${x._id}` };
  },
});
export const mailAccepted = internalAction({
  args: { bookingId: v.id("vendorBookings") },
  handler: async (ctx, { bookingId }) => {
    const d = await ctx.runQuery(internal.vendorPortal.acceptedData, { bookingId });
    if (!d?.owner) return;
    await deliverOnce(ctx, `booking-accepted:${bookingId}`, "booking_accepted", d.owner, ownerBookingAcceptedMail(d.brand, {
      vendor: d.vendor, role: d.x.role, project: d.project, start: d.x.start, end: d.x.end, rateCents: d.x.rate.cents, unit: d.x.rate.unit, link: d.link,
    }), d.brand.replyTo, d.x.businessId ?? null);
  },
});

// ---------- Nov 2 (Heston: email notifications for everything): the owner hears about declines, reads and W-9s ----------

export const ownerMailData = internalQuery({
  args: { what: v.string(), id: v.string() },
  handler: async (ctx, { what, id }) => {
    const brandOf = async (biz: Id<"businesses"> | null) => ({ owner: (await businessContact(ctx, biz)).ownerEmail, brand: await mailBrandOf(ctx, biz), biz });
    if (what === "declined") {
      const bid = ctx.db.normalizeId("vendorBookings", id);
      const x = bid ? await ctx.db.get(bid) : null;
      if (!x || x.status !== "declined") return null;
      const vendor = await ctx.db.get(x.vendorId), p = await ctx.db.get(x.projectId);
      if (!vendor || !p) return null;
      return { ...(await brandOf(x.businessId ?? null)), key: `booking-declined:${x._id}`, kind: "booking_declined",
        mail: { k: "declined" as const, vendor: vendor.name, role: x.role, project: label(p), start: x.start, end: x.end, reason: x.declineReason ?? null, link: `${SITE()}/vendors/bookings/${x._id}` } };
    }
    if (what === "read") {
      const rid = ctx.db.normalizeId("briefings", id);
      const x = rid ? await ctx.db.get(rid) : null;
      if (!x || !x.readAt || !x.sentTo) return null;
      const p = await ctx.db.get(x.projectId);
      const build = await ctx.db.get(x.buildId);
      return { ...(await brandOf(x.businessId ?? null)), key: `briefing-read:${x._id}:${x.sentAt ?? 0}`, kind: "briefing_read",
        mail: { k: "read" as const, vendor: x.sentTo.name, title: build?.title ?? "The brief", project: p ? label(p) : "a project", link: `${SITE()}/vendors/briefings/${x._id}` } };
    }
    if (what === "w9" || what === "w9-replaced") {
      const vendor = (await ctx.db.query("vendors").collect()).find((x) => x.w9 && String(x.w9.fileId) === id);
      if (!vendor) return null;
      return { ...(await brandOf(vendor.businessId ?? null)), key: `vendor-w9:${id}`, kind: "vendor_w9",
        mail: { k: "w9" as const, vendor: vendor.name, replaced: what === "w9-replaced", link: `${SITE()}/vendors/${vendor._id}` } };
    }
    return null;
  },
});
export const mailOwner = internalAction({
  args: { what: v.string(), id: v.string() },
  handler: async (ctx, a) => {
    const d = await ctx.runQuery(internal.vendorPortal.ownerMailData, a);
    if (!d?.owner) return;
    const m = d.mail.k === "declined" ? ownerBookingDeclinedMail(d.brand, d.mail) : d.mail.k === "read" ? ownerBriefingReadMail(d.brand, d.mail) : ownerW9Mail(d.brand, d.mail);
    await deliverOnce(ctx, d.key, d.kind, d.owner, m, d.brand.replyTo, d.biz);
  },
});

// ---------- Review access for booked editors (D93, D103) ----------

const isEditing = (role: string) => /edit|colou?r|post|motion|graphic/i.test(role);
const DAY = 86_400_000;
/** The access ends 30 days after the booking's last day (end of that day, Central). */
export const reviewUntil = (end: string) => Date.parse(`${end}T23:59:59-06:00`) + 30 * DAY;

/** A comment link to the project's cuts, kept in the vendor's portal (never emailed), ending with D103. Made as the
 *  business's owner, like any share; it shows in Settings › Shares, where it can be extended or switched off. */
async function editorShare(ctx: MutationCtx, x: Doc<"vendorBookings">) {
  const biz = x.businessId;
  if (!biz || !(await ctx.db.get(x.projectId))) return null;
  const owner = (await ctx.db.query("memberships").collect()).filter((m) => m.businessId === biz && m.role === "owner" && !m.revokedAt && m.userId).sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!owner?.userId) return null;
  let token = randomToken(16);
  while (await ctx.db.query("shares").withIndex("by_token", (q) => q.eq("token", token)).unique()) token = randomToken(16);
  return ctx.db.insert("shares", {
    token, kind: "project", projectId: x.projectId, access: "comment", who: "link", allVersions: true, downloads: false, emailNewVersions: false,
    expiresAt: reviewUntil(x.end), createdAt: Date.now(), createdBy: owner.userId,
  });
}

/** The projects a booked editor can open in Review (734:4809). */
export const reviews = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, { businessId }) => {
    const { biz, vendor } = await asVendor(ctx, businessId);
    const now = Date.now();
    const out = [];
    for (const x of await myBookings(ctx, vendor._id)) {
      if (x.status !== "accepted" || !x.reviewShareId) continue;
      const sh = await ctx.db.get(x.reviewShareId);
      if (!sh || sh.offAt || (sh.expiresAt && sh.expiresAt <= now)) continue;
      const p = await ctx.db.get(x.projectId);
      out.push({ bookingId: x._id, project: p ? label(p) : "A project", role: x.role, start: x.start, end: x.end, token: sh.token, expiresAt: sh.expiresAt ?? null });
    }
    return { businessId: biz, rows: out };
  },
});

// ---------- Invoices (734:3527, 734:3958) ----------

const invTotal = (mode: "hours" | "lines", hours: Array<{ qty: number }>, lines: Array<{ cents: number }>, rateCents: number) =>
  mode === "hours" ? Math.round(hours.reduce((t, h) => t + h.qty, 0) * rateCents) : lines.reduce((t, l) => t + l.cents, 0);

async function invRow(ctx: Ctx, x: Doc<"vendorInvoices">) {
  const k = await ctx.db.get(x.bookingId);
  const p = await ctx.db.get(x.projectId);
  const qty = x.hours.reduce((t, h) => t + h.qty, 0);
  return {
    _id: x._id, number: x.number, status: x.status, project: p ? label(p) : "A project", projectName: p?.name ?? "A project", role: k?.role ?? "",
    mode: x.mode, hours: x.hours, lines: x.lines, rate: x.rate, totalCents: x.totalCents, note: x.note ?? null, bookingId: x.bookingId,
    amount: x.mode === "hours" ? `${Math.round(qty * 100) / 100} ${x.rate.unit === "day" ? (qty === 1 ? "day" : "days") : "h"}` : `${x.lines.length} line${x.lines.length === 1 ? "" : "s"}`,
    sentAt: x.sentAt ?? null, approvedAt: x.approvedAt ?? null, paidAt: x.paidAt ?? null, paidMethod: x.paidMethod ?? null, updatedAt: x.updatedAt,
    paidOn: paidDay(x), paidCents: x.status === "paid" ? paidAmount(x) : null, declinedAt: x.declinedAt ?? null, declineReason: x.declineReason ?? null, // step 5
  };
}

export const invoices = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, { businessId }) => {
    const { biz, vendor } = await asVendor(ctx, businessId);
    const rows = (await ctx.db.query("vendorInvoices").withIndex("by_vendor", (q) => q.eq("vendorId", vendor._id)).collect()).sort((a, b) => b.updatedAt - a.updatedAt);
    const out = [];
    for (const x of rows) out.push(await invRow(ctx, x));
    return { businessId: biz, rows: out };
  },
});

/** What Send an invoice needs: the bookings it can be for (accepted, or done), with their agreed rates. */
export const invoiceForm = query({
  args: { businessId: v.optional(v.id("businesses")), invoiceId: v.optional(v.string()) },
  handler: async (ctx, { businessId, invoiceId }) => {
    const id = invoiceId ? ctx.db.normalizeId("vendorInvoices", invoiceId) : null;
    const inv = id ? await ctx.db.get(id) : null;
    const { biz, vendor } = await asVendor(ctx, inv?.businessId ?? businessId);
    if (inv && inv.vendorId !== vendor._id) return null;
    const bookings = [];
    for (const x of await myBookings(ctx, vendor._id)) {
      if (x.status !== "accepted") continue;
      const p = await ctx.db.get(x.projectId);
      bookings.push({ _id: x._id, label: `${p ? label(p) : "A project"} · ${x.role}`, start: x.start, end: x.end, rate: x.rate, hours: x.hours ?? null, expectedCents: expectedCents(x) });
    }
    const count = (await ctx.db.query("vendorInvoices").withIndex("by_vendor", (q) => q.eq("vendorId", vendor._id)).collect()).length;
    return { businessId: biz, ...(await ownerOf(ctx, biz)), bookings, nextNumber: `INV-${String(count + 1).padStart(4, "0")}`, invoice: inv ? await invRow(ctx, inv) : null };
  },
});

export const invoice = query({
  args: { invoiceId: v.string() },
  handler: async (ctx, { invoiceId }) => {
    const id = ctx.db.normalizeId("vendorInvoices", invoiceId);
    const x = id ? await ctx.db.get(id) : null;
    const me = await mine(ctx, x, (vid) => x!.vendorId === vid);
    if (!me || !x) return null;
    return { businessId: me.biz, ...(await ownerOf(ctx, me.biz)), ...(await invRow(ctx, x)) };
  },
});

/** Save a draft, or send it (email 26 and the owner's Home alert). A sent invoice can't change. */
export const saveInvoice = mutation({
  args: {
    invoiceId: v.optional(v.id("vendorInvoices")), bookingId: v.id("vendorBookings"), mode: v.union(v.literal("hours"), v.literal("lines")),
    hours: v.array(v.object({ label: v.string(), qty: v.number() })), lines: v.array(v.object({ description: v.string(), cents: v.number() })),
    number: v.optional(v.string()), note: v.optional(v.string()), send: v.boolean(),
  },
  handler: async (ctx, a) => {
    const k = await ctx.db.get(a.bookingId);
    const me = await mine(ctx, k, (vid) => k!.vendorId === vid);
    if (!me || !k) throw new ConvexError("That booking isn't here.");
    if (k.status !== "accepted") throw new ConvexError("Invoices are for bookings you've accepted.");
    const prev = a.invoiceId ? await ctx.db.get(a.invoiceId) : null;
    if (a.invoiceId && (!prev || prev.vendorId !== me.vendor._id)) throw new ConvexError("That invoice isn't here.");
    if (prev && prev.status !== "draft" && prev.status !== "declined") throw new ConvexError("It's been sent, so it can't change."); // step 5: a declined one can be fixed and resent
    const hours = a.mode === "hours" ? a.hours.slice(0, 60).map((h) => ({ label: h.label.trim().slice(0, 80), qty: Math.round(Number(h.qty) * 100) / 100 })).filter((h) => h.qty !== 0 || h.label) : [];
    const lines = a.mode === "lines" ? a.lines.slice(0, 60).map((l) => ({ description: l.description.trim().slice(0, 200), cents: Math.round(Number(l.cents)) })).filter((l) => l.cents !== 0 || l.description) : [];
    if (hours.some((h) => !(h.qty > 0 && h.qty <= 1000))) throw new ConvexError(`Each ${k.rate.unit === "day" ? "line needs its days" : "line needs its hours"}, more than 0.`);
    if (lines.some((l) => !(l.cents > 0 && l.cents <= 10_000_000) || !l.description)) throw new ConvexError("Each line needs what it's for and an amount.");
    const totalCents = invTotal(a.mode, hours, lines, k.rate.cents);
    if (a.send && totalCents <= 0) throw new ConvexError(a.mode === "hours" ? "Add the hours you worked." : "Add a line.");
    if (totalCents > 100_000_000) throw new ConvexError("That total is too large.");
    const count = (await ctx.db.query("vendorInvoices").withIndex("by_vendor", (q) => q.eq("vendorId", me.vendor._id)).collect()).length;
    const number = (a.number ?? "").trim().slice(0, 30) || prev?.number || `INV-${String(count + 1).padStart(4, "0")}`;
    const now = Date.now();
    if (looksLikeAccount(a.note ?? "") || [...hours.map((h) => h.label), ...lines.map((l) => l.description)].some(looksLikeAccount)) throw new ConvexError("Leave out account and routing numbers. Your payment details are in Settings; the business asks for the rest.");
    const body = { bookingId: k._id, projectId: k.projectId, number, mode: a.mode, hours, lines, rate: k.rate, totalCents, note: (a.note ?? "").trim().slice(0, 1000) || undefined, updatedAt: now,
      ...(a.send ? { status: "sent" as const, sentAt: now, history: [...(prev?.history ?? []), { at: now, text: `${prev?.status === "declined" ? "Sent again" : "Sent"} by ${me.vendor.name}` }] }
        : prev?.status === "declined" ? { status: "draft" as const } : {}) };
    const id = prev ? (await ctx.db.patch(prev._id, body), prev._id) : await ctx.db.insert("vendorInvoices", { vendorId: me.vendor._id, status: "draft", createdAt: now, ...body });
    if (a.send) await ctx.scheduler.runAfter(0, internal.vendorPortal.mailInvoice, { invoiceId: id, sentAt: now });
    return id;
  },
});

export const deleteInvoice = mutation({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }) => {
    const x = await ctx.db.get(invoiceId);
    const me = await mine(ctx, x, (vid) => x!.vendorId === vid);
    if (!me || !x) return null;
    if (x.status !== "draft") throw new ConvexError("A sent invoice stays.");
    await ctx.db.delete(invoiceId);
    return null;
  },
});

export const invoiceMailData = internalQuery({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }) => {
    const x = await ctx.db.get(invoiceId);
    if (!x || x.status !== "sent") return null;
    const vendor = await ctx.db.get(x.vendorId);
    const k = await ctx.db.get(x.bookingId);
    if (!vendor || !k) return null;
    const c = await businessContact(ctx, x.businessId ?? null);
    const row = await invRow(ctx, x);
    return { owner: c.ownerEmail, vendor: vendor.name, row, expectedCents: x.mode === "hours" ? expectedCents(k) : null, brand: await mailBrandOf(ctx, x.businessId ?? null), link: `${SITE()}/vendors/payments/${x._id}`, biz: x.businessId ?? null };
  },
});
export const mailInvoice = internalAction({
  args: { invoiceId: v.id("vendorInvoices"), sentAt: v.optional(v.number()) },
  handler: async (ctx, { invoiceId, sentAt }) => {
    const d = await ctx.runQuery(internal.vendorPortal.invoiceMailData, { invoiceId });
    if (!d?.owner) return;
    await deliverOnce(ctx, sentAt ? `vendor-invoice:${invoiceId}:${sentAt}` : `vendor-invoice:${invoiceId}`, "vendor_invoice", d.owner, ownerVendorInvoiceMail(d.brand, {
      vendor: d.vendor, number: d.row.number, project: d.row.project, role: d.row.role, amount: d.row.mode === "hours" ? d.row.amount : "", totalCents: d.row.totalCents, expectedCents: d.expectedCents, link: d.link,
    }), d.brand.replyTo, d.biz);
  },
});

// ---------- Settings: their details, W-9 (D100), how they're paid (D101) (734:4386) ----------

export const settings = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, { businessId }) => {
    const { biz, vendor, email } = await asVendor(ctx, businessId);
    return {
      businessId: biz, ...(await ownerOf(ctx, biz)), email, name: vendor.name, businessName: vendor.businessName ?? "", phone: vendor.phone ?? "", address: vendor.address ?? "", portfolio: vendor.portfolio ?? "",
      roles: vendor.roles, w9: vendor.w9 ? { name: vendor.w9.name, uploadedAt: vendor.w9.uploadedAt, url: await ctx.storage.getUrl(vendor.w9.fileId) } : null,
      payMethod: vendor.payMethod ?? null,
    };
  },
});

// Nov 2 · Notifications: which emails they get from this business (each business they work for has its own list).
export const notifications = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, { businessId }) => {
    const { biz, vendor, email } = await asVendor(ctx, businessId);
    return { businessId: biz, items: viewFor("vendor", await prefRow(ctx, vendor.email || email, biz)) };
  },
});
export const setNotification = mutation({
  args: { businessId: v.id("businesses"), key: v.string(), on: v.boolean() },
  handler: async (ctx, a) => {
    const { biz, vendor, email } = await asVendor(ctx, a.businessId);
    try { for (const e of new Set([vendor.email.toLowerCase(), email])) await setSwitch(ctx, e, biz, "vendor", a.key, a.on); } catch (e) { throw new ConvexError((e as Error).message); }
    return null;
  },
});

const clip = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);
export const saveDetails = mutation({
  args: { businessId: v.id("businesses"), name: v.string(), businessName: v.optional(v.string()), phone: v.optional(v.string()), address: v.optional(v.string()), portfolio: v.optional(v.string()),
    payMethod: v.optional(v.string()), payNote: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { vendor } = await asVendor(ctx, a.businessId);
    if (!a.name.trim()) throw new ConvexError("Add your name.");
    const note = clip(a.payNote, 300);
    // D101: the method and a note only. A long run of digits looks like an account or routing number: refused.
    if (looksLikeAccount(note)) throw new ConvexError("Leave out account and routing numbers. Say how you like to be paid; the business asks for the rest.");
    if (a.payMethod && !PAY_METHODS.includes(a.payMethod)) throw new ConvexError("Pick how you get paid.");
    await ctx.db.patch(vendor._id, {
      name: clip(a.name, 120), businessName: clip(a.businessName, 120) || undefined, phone: clip(a.phone, 40) || undefined, address: clip(a.address, 300) || undefined,
      portfolio: clip(a.portfolio, 300) || undefined, ...(a.payMethod ? { payMethod: { method: a.payMethod, ...(note ? { note } : {}) } } : {}), updatedAt: Date.now(),
    });
    return null;
  },
});

export const w9UploadUrl = mutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, { businessId }) => { await asVendor(ctx, businessId); return ctx.storage.generateUploadUrl(); },
});

/** D100: one W-9 per business; replacing it drops the old file. */
export const setW9 = mutation({
  args: { businessId: v.id("businesses"), storageId: v.id("_storage"), name: v.string() },
  handler: async (ctx, a) => {
    const { vendor } = await asVendor(ctx, a.businessId);
    const file = await ctx.db.system.get(a.storageId);
    const fresh = file && Date.now() - file._creationTime < 30 * 60_000;
    if (!file || !fresh) throw new ConvexError("The W-9 didn't upload. Try again.");
    const pdf = file.contentType ? file.contentType === "application/pdf" : /\.pdf$/i.test(a.name.trim());
    if (!pdf || file.size > 10 * 1024 * 1024) throw new ConvexError("Upload the W-9 as a PDF, up to 10 MB.");
    const old = vendor.w9?.fileId;
    await ctx.db.patch(vendor._id, { w9: { fileId: a.storageId, name: clip(a.name, 120) || "W-9.pdf", uploadedAt: Date.now() }, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.vendorPortal.mailOwner, { what: old ? "w9-replaced" : "w9", id: a.storageId }); // Nov 2
    if (old && old !== a.storageId) await ctx.storage.delete(old).catch(() => null);
    return null;
  },
});
