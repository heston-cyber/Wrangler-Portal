// Phase 3c step 4 (Nov 2) · the vendor side of the portal (S5 · Phase 3c 733:3100 Home, 733:3658 a booking, 733:3985 a
// briefing, 732:3285 Decline, 734:5189 the "Working for" switcher). A third side, beside the owner's and the client's.
// One login across the businesses a vendor works for (D94); every call works for one of them, and sees only that
// business's work with this vendor: their own vendor record, their bookings, the briefings sent to them.
//
// Who may call: a signed-in vendor login (users.role "vendor") with a live vendor membership in the business, whose
// vendor record there is still on the list. Owners and clients are refused here, and vendors are refused everywhere
// else (requireMe, requireSignedIn).
import { focusBusiness, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { bookingState, daysIn, expectedCents, todayCentral, type BookingState } from "./lib/bookings";
import { label } from "./lib/bookingRows";

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
    await openOffer(ctx, bookingId);
    const now = Date.now();
    await ctx.db.patch(bookingId, { status: "accepted", answeredAt: now, updatedAt: now });
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
    return null;
  },
});
