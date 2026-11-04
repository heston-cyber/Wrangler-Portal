// Phase 3c step 2 · a booking as the owner's pages show it (shared by bookings.ts and the Ledger in crm.ts).
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { bookingState, daysIn, expectedCents, todayCentral, type BookingState } from "./bookings";

export const label = (p: { name: string; jobNumber?: string }) => (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name);

export type BookingRow = {
  _id: Id<"vendorBookings">; vendorId: Id<"vendors">; vendor: string; projectId: Id<"projects">; project: string;
  role: string; start: string; end: string; days: number; rate: { cents: number; unit: "day" | "hour" }; hours: number | null;
  expectedCents: number; state: BookingState; location: string | null; note: string | null; declineReason: string | null;
  offeredAt: number; answeredAt: number | null; cancelledAt: number | null;
  brief: "none" | "draft" | "sent" | "read"; // Phase 3c step 3: the latest briefing for this booking
};

export async function rowOf(ctx: QueryCtx, x: Doc<"vendorBookings">, today: string): Promise<BookingRow> {
  const vendor = await ctx.db.get(x.vendorId);
  const p = await ctx.db.get(x.projectId);
  const briefs = await ctx.db.query("briefings").withIndex("by_booking", (q) => q.eq("bookingId", x._id)).collect();
  const sent = briefs.filter((b) => b.status === "sent");
  // D147: this vendor's own "I've read it" on a briefing emailed to them (their recipient row) counts too.
  let read = sent.some((b) => b.readAt);
  if (!read) for (const b of sent) {
    const r = (await ctx.db.query("briefingRecipients").withIndex("by_briefing", (q) => q.eq("briefingId", b._id)).collect()).find((y) => y.vendorId === x.vendorId);
    if (r?.readAt) { read = true; break; }
  }
  const brief = read ? "read" : sent.length ? "sent" : briefs.length ? "draft" : "none";
  return {
    brief,
    _id: x._id, vendorId: x.vendorId, vendor: vendor?.name ?? "A vendor", projectId: x.projectId, project: p ? label(p) : "A project",
    role: x.role, start: x.start, end: x.end, days: daysIn(x.start, x.end), rate: x.rate, hours: x.hours ?? null,
    expectedCents: expectedCents(x), state: bookingState(x, today), location: x.location ?? null, note: x.note ?? null,
    declineReason: x.declineReason ?? null, offeredAt: x.offeredAt, answeredAt: x.answeredAt ?? null, cancelledAt: x.cancelledAt ?? null,
  };
}
/** Soonest first; within a day, the newest offer first. */
export const order = (a: BookingRow, b: BookingRow) => a.start.localeCompare(b.start) || b.offeredAt - a.offeredAt;

/** Bookings that count as an expected cost in a project's Ledger: offered or accepted (done included). Step 5: what
 *  the owner has approved on a booking's invoices is an actual cost now, so it comes off the expected one; a booking
 *  invoiced in full (or more) drops out. */
export async function expectedForProject(ctx: QueryCtx, projectId: Id<"projects">) {
  const today = todayCentral();
  const rows = (await ctx.db.query("vendorBookings").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect()).filter((x) => x.status === "offered" || x.status === "accepted");
  const out: BookingRow[] = [];
  for (const x of rows) {
    const approved = (await ctx.db.query("vendorInvoices").withIndex("by_booking", (q) => q.eq("bookingId", x._id)).collect())
      .filter((i) => i.status === "approved" || i.status === "paid").reduce((t, i) => t + i.totalCents, 0);
    const r = await rowOf(ctx, x, today);
    const left = Math.max(0, r.expectedCents - approved);
    if (left > 0) out.push({ ...r, expectedCents: left });
  }
  return out.sort(order);
}


/** Step 5 · the day a paid vendor invoice counts toward a 1099: the day the owner says they paid, else the day they
 *  pressed Mark paid; and the amount (what they say they paid, else the total). */
export const paidDay = (x: Doc<"vendorInvoices">) => x.paidOn ?? (x.paidAt ? todayCentral(x.paidAt) : null);
export const paidAmount = (x: Doc<"vendorInvoices">) => x.paidCents ?? x.totalCents;
