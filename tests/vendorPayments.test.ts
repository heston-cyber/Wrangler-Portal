// Phase 3c step 5 · vendor payments, the owner's side. T3c.5: a vendor's invoice goes To approve → Approved (an actual
// cost in the project's Ledger, in place of the booking's expected cost; email 27) → Paid (the day, amount and method
// the owner records; email 28; it counts toward the vendor's 1099 total for that year). Decline sends it back to the
// vendor to fix and resend. Nothing moves money (D92). Another business never sees or touches it.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { todayCentral } from "../convex/lib/bookings";

const api = anyApi;
beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://handsome-hummingbird-11.convex.site";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
type Sent = { to: string; subject: string; text: string };
const stub = (mails: Sent[]) => vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
  return new Response("{}", { status: 500 });
}));
const settle = async (w: W) => { vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const JORDAN = "jordan@ellisfilms.com";

/** Jordan, a vendor of Wrangler with a login, booked for two days at $1,000/day and accepted. */
async function booked(w: W) {
  const a = await w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: JORDAN, roles: ["Shooter"], rates: [], invite: true }) as Id<"vendors">;
  const sub = await w.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: JORDAN, name: "Jordan Ellis", role: "vendor" });
    await ctx.db.insert("memberships", { businessId: (await ctx.db.get(a))!.businessId!, email: JORDAN, userId, role: "vendor", createdAt: Date.now() });
    return `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
  });
  const jordan = w.t.withIdentity({ subject: sub });
  const k = await w.heston.mutation(api.bookings.create, { vendorId: a, projectId: w.p, role: "Shooter", start: "2030-11-06", end: "2030-11-07", cents: 100_000, unit: "day" }) as Id<"vendorBookings">;
  await jordan.mutation(api.vendorPortal.accept, { bookingId: k });
  return { a, k, jordan };
}

describe("vendor payments", () => {
  test("T3c.5 To approve → Approved (Ledger, email 27) → Paid (email 28, 1099)", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { a, k, jordan } = await booked(w);
    const ledger0 = await w.heston.query(api.crm.ledger, { projectId: w.p });
    expect(ledger0.expectedCents).toBe(200_000);
    const otherBefore = ledger0.otherCents;

    const inv = await jordan.mutation(api.vendorPortal.saveInvoice, { bookingId: k, mode: "hours", hours: [{ label: "Nov 6 · shoot", qty: 1 }, { label: "Nov 7 · shoot", qty: 1 }], lines: [], number: "JE-014", send: true }) as Id<"vendorInvoices">;
    await settle(w);
    expect(mails.find((m) => m.subject === "Jordan Ellis sent invoice JE-014")!.text).toContain(`https://app.wranglerportal.com/vendors/payments/${inv}`);
    const list = await w.heston.query(api.vendorPayments.list, {});
    expect(list.toApprove).toEqual([expect.objectContaining({ _id: inv, number: "JE-014", vendor: "Jordan Ellis", project: "26127 Launch", what: "2 days shooter", totalCents: 200_000 })]);
    expect(list.approved).toEqual([]);
    const page = await w.heston.query(api.vendorPayments.get, { invoiceId: inv });
    expect(page).toMatchObject({ status: "sent", to: "Wrangler Productions", booking: { role: "Shooter", expectedCents: 200_000 } });
    expect(page.lines).toEqual([{ label: "Nov 6 · shoot", qty: 1, rateCents: 100_000, cents: 100_000 }, { label: "Nov 7 · shoot", qty: 1, rateCents: 100_000, cents: 100_000 }]);
    await expect(w.heston.mutation(api.vendorPayments.markPaid, { invoiceId: inv, paidOn: todayCentral(), method: "ACH" })).rejects.toThrow(/Approve it first/);

    // Approve: an actual cost in the Ledger, the expected one gone; email 27; the Home alert clears.
    await w.heston.mutation(api.vendorPayments.approve, { invoiceId: inv });
    await expect(w.heston.mutation(api.vendorPayments.approve, { invoiceId: inv })).rejects.toThrow(/already approved/);
    await expect(w.heston.mutation(api.vendorPayments.decline, { invoiceId: inv, reason: "No" })).rejects.toThrow(/approved/);
    const ledger1 = await w.heston.query(api.crm.ledger, { projectId: w.p });
    expect(ledger1.expected).toEqual([]);
    expect(ledger1.otherCents).toBe(otherBefore + 200_000);
    expect(ledger1.entries).toContainEqual(expect.objectContaining({ kind: "cost", cents: 200_000, who: "Jordan Ellis", note: "Invoice JE-014 · Shooter", date: todayCentral() }));
    expect((await w.heston.query(api.home.needs, {})).filter((n: { kind: string }) => n.kind === "vendorInvoice")).toEqual([]);
    await settle(w);
    const m27 = mails.find((m) => m.subject === "Invoice JE-014 approved")!;
    expect(m27.to).toBe(JORDAN);
    expect(m27.text).toContain("Heston approved your invoice JE-014.");
    expect(m27.text).toContain(`https://app.wranglerportal.com/vendor/invoices/${inv}`);
    expect(await jordan.query(api.vendorPortal.invoice, { invoiceId: inv })).toMatchObject({ status: "approved" });
    expect((await w.heston.query(api.vendorPayments.list, {})).approved.map((x: { _id: string }) => x._id)).toEqual([inv]);

    // Mark paid: checked, recorded, email 28, the 1099 total.
    const today = todayCentral();
    await expect(w.heston.mutation(api.vendorPayments.markPaid, { invoiceId: inv, paidOn: "2999-01-01", method: "ACH" })).rejects.toThrow(/future/);
    await expect(w.heston.mutation(api.vendorPayments.markPaid, { invoiceId: inv, paidOn: today, method: "Venmo" })).rejects.toThrow(/how you paid/);
    await expect(w.heston.mutation(api.vendorPayments.markPaid, { invoiceId: inv, paidOn: today, method: "ACH", reference: "acct 1234 5678 9012 3456" })).rejects.toThrow(/account numbers/);
    await w.heston.mutation(api.vendorPayments.markPaid, { invoiceId: inv, paidOn: today, method: "Zelle", reference: "Conf 88213" });
    await expect(w.heston.mutation(api.vendorPayments.markPaid, { invoiceId: inv, paidOn: today, method: "ACH" })).rejects.toThrow(/already marked paid/);
    await settle(w);
    const m28 = mails.find((m) => m.subject === "Invoice JE-014 paid")!;
    expect(m28.to).toBe(JORDAN);
    expect(m28.text).toContain("Wrangler Productions paid your invoice JE-014.");
    expect(m28.text).toContain("Zelle");
    expect(m28.text).toContain(`It counts toward your ${today.slice(0, 4)} total with Wrangler Productions.`);
    const got = await w.heston.query(api.vendorPayments.get, { invoiceId: inv });
    expect(got).toMatchObject({ status: "paid", paidOn: today, paidCents: 200_000, paidMethod: "Zelle", paidRef: "Conf 88213" });
    expect(got.history.map((h: { text: string }) => h.text)).toEqual([expect.stringMatching(/^Marked paid · Zelle/), "Approved by you · added to the Ledger", "Sent by Jordan Ellis"]);
    const t = await w.heston.query(api.vendorPayments.totals1099, {});
    expect(t).toMatchObject({ year: Number(today.slice(0, 4)), rows: [expect.objectContaining({ vendorId: a, name: "Jordan Ellis", w9: false, payments: 1, last: today, totalCents: 200_000 })] });
    expect(t.missing).toEqual([{ vendorId: a, name: "Jordan Ellis", email: JORDAN }]);
    expect((await w.heston.query(api.vendors.get, { vendorId: a })).totals).toMatchObject({ paidThisYearCents: 200_000, waitingCount: 0 });
    expect(await jordan.query(api.vendorPortal.invoice, { invoiceId: inv })).toMatchObject({ status: "paid", paidOn: today, paidCents: 200_000, paidMethod: "Zelle" });
    // Removing the Ledger line is the owner's call; the invoice stays paid.
    expect(ledger1.entries.find((e: { note: string | null }) => e.note === "Invoice JE-014 · Shooter")).toBeTruthy();
  });

  test("decline sends it back; the vendor fixes and resends it (a second email 26); part-invoicing leaves the rest expected", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { k, jordan } = await booked(w);
    const inv = await jordan.mutation(api.vendorPortal.saveInvoice, { bookingId: k, mode: "hours", hours: [{ label: "Nov 6", qty: 3 }], lines: [], number: "JE-015", send: true }) as Id<"vendorInvoices">;
    await settle(w);
    await expect(w.heston.mutation(api.vendorPayments.decline, { invoiceId: inv, reason: "  " })).rejects.toThrow(/Say why/);
    await w.heston.mutation(api.vendorPayments.decline, { invoiceId: inv, reason: "We booked two days, not three." });
    await expect(w.heston.mutation(api.vendorPayments.approve, { invoiceId: inv })).rejects.toThrow(/declined it/);
    expect(await jordan.query(api.vendorPortal.invoice, { invoiceId: inv })).toMatchObject({ status: "declined", declineReason: "We booked two days, not three." });
    const list = await w.heston.query(api.vendorPayments.list, {});
    expect([...list.toApprove, ...list.approved, ...list.paid]).toEqual([]);
    expect((await w.heston.query(api.crm.ledger, { projectId: w.p })).expectedCents).toBe(200_000); // nothing approved
    // Fixed and sent again: only one day this time (the other comes on a later invoice).
    await jordan.mutation(api.vendorPortal.saveInvoice, { invoiceId: inv, bookingId: k, mode: "hours", hours: [{ label: "Nov 6", qty: 1 }], lines: [], send: true });
    await settle(w);
    expect(mails.filter((m) => m.subject === "Jordan Ellis sent invoice JE-015")).toHaveLength(2);
    const page = await w.heston.query(api.vendorPayments.get, { invoiceId: inv });
    expect(page).toMatchObject({ status: "sent", totalCents: 100_000 });
    expect(page.history.map((h: { text: string }) => h.text)).toEqual(["Sent again by Jordan Ellis", "Declined by you: We booked two days, not three.", "Sent by Jordan Ellis"]);
    await w.heston.mutation(api.vendorPayments.approve, { invoiceId: inv });
    const ledger = await w.heston.query(api.crm.ledger, { projectId: w.p });
    expect(ledger.expected).toEqual([expect.objectContaining({ _id: k, cents: 100_000 })]); // the rest is still expected
    expect(ledger.expectedCents).toBe(100_000);
  });

  test("another business never sees or touches it; vendors and clients are refused", async () => {
    const w = await world();
    stub([]);
    const { k, jordan } = await booked(w);
    const inv = await jordan.mutation(api.vendorPortal.saveInvoice, { bookingId: k, mode: "lines", hours: [], lines: [{ description: "Shoot", cents: 50_000 }], send: true }) as Id<"vendorInvoices">;
    expect(await w.boss.query(api.vendorPayments.get, { invoiceId: inv })).toBeNull();
    expect(await w.boss.query(api.vendorPayments.list, {})).toEqual({ toApprove: [], approved: [], paid: [] });
    await expect(w.boss.mutation(api.vendorPayments.approve, { invoiceId: inv })).rejects.toThrow();
    await expect(w.boss.mutation(api.vendorPayments.decline, { invoiceId: inv, reason: "x" })).rejects.toThrow();
    await expect(jordan.query(api.vendorPayments.list, {})).rejects.toThrow();
    await expect(jordan.mutation(api.vendorPayments.approve, { invoiceId: inv })).rejects.toThrow();
    expect((await w.heston.query(api.vendorPayments.get, { invoiceId: inv })).lines).toEqual([{ label: "Shoot", qty: null, rateCents: null, cents: 50_000 }]);
  });
});
