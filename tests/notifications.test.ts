// Nov 2 · notifications (Heston: "email notifications for everything, with a notifications settings menu so every
// business, vendor and client can configure their notifications"). Every switch is on until the person turns it off;
// a switched-off email isn't sent (and isn't logged as sent); always-sent emails can't be switched off; a vendor's
// switches are per business. Plus the emails that are new with the rule: the owner hears when a vendor declines a
// booking, reads a briefing or uploads a W-9; the vendor hears when a booking is cancelled or an invoice declined.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { fakeStripe, sent, world } from "./payHarness";
import { internal } from "../convex/_generated/api";
import { NOTICES } from "../convex/lib/notify";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://handsome-hummingbird-11.convex.site";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
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
const HESTON = "heston@wranglerproductions.com";

/** Jordan, a vendor of Wrangler (A) and of Other Films (B), one login; a booking from each. */
async function setup(w: W) {
  const a = await w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: JORDAN, roles: ["Shooter"], rates: [], invite: true }) as Id<"vendors">;
  const b = await w.boss.mutation(api.vendors.add, { name: "Jordan E.", email: JORDAN, roles: ["Shooter"], rates: [], invite: true }) as Id<"vendors">;
  const { sub, A, B } = await w.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: JORDAN, name: "Jordan Ellis", role: "vendor" });
    const A = (await ctx.db.get(a))!.businessId!, B = (await ctx.db.get(b))!.businessId!;
    for (const biz of [A, B]) await ctx.db.insert("memberships", { businessId: biz, email: JORDAN, userId, role: "vendor", createdAt: Date.now() });
    return { A, B, sub: `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}` };
  });
  const otherProject = await w.t.run(async (ctx) => ctx.db.insert("projects", { businessId: B, name: "Fern & Field lookbook", createdAt: 0 }));
  const book = (who: "A" | "B", start: string) => (who === "A" ? w.heston : w.boss).mutation(api.bookings.create, { vendorId: who === "A" ? a : b, projectId: who === "A" ? w.p : otherProject, role: "Shooter", start, end: start, cents: 100_000, unit: "day" }) as Promise<Id<"vendorBookings">>;
  return { a, b, A, B, jordan: w.t.withIdentity({ subject: sub }), book };
}

describe("notifications", () => {
  test("the list: every email kind the code sends is in it, once per side; always-sent ones can't be switched", async () => {
    for (const side of ["owner", "vendor", "client"] as const) {
      const kinds = NOTICES.filter((n) => n.side === side).flatMap((n) => n.kinds);
      expect(new Set(kinds).size).toBe(kinds.length);
    }
    const w = await world();
    const mine = await w.heston.query(api.notifications.owner, {});
    expect(mine.to).toEqual([HESTON]);
    expect(mine.items.find((i: { key: string }) => i.key === "vendor_invoices")).toMatchObject({ group: "Vendors", on: true, always: false });
    expect(mine.items.find((i: { key: string }) => i.key === "sign_copy")).toMatchObject({ always: true, on: true });
    await expect(w.heston.mutation(api.notifications.setOwner, { key: "sign_copy", on: false })).rejects.toThrow(/always sent/);
    await expect(w.heston.mutation(api.notifications.setOwner, { key: "versions", on: false })).rejects.toThrow(/always sent/); // a client's switch, not the owner's
    // A client's list, and their switch for new versions keeps the unsubscribe link's column.
    const c = await w.maya.query(api.notifications.client, {});
    expect(c.items.map((i: { key: string }) => i.key)).toEqual(expect.arrayContaining(["versions", "replies", "notes", "invoice_reminders", "client_bills"]));
    await w.maya.mutation(api.notifications.setClient, { key: "versions", on: false });
    await w.maya.mutation(api.notifications.setClient, { key: "invoice_reminders", on: false });
    const row = await w.t.run((ctx) => ctx.db.query("emailPrefs").withIndex("by_email", (q) => q.eq("email", "maya@harbor.example")).unique());
    expect(row).toMatchObject({ versionsOff: true, off: ["invoice_reminders"] });
    expect((await w.maya.query(api.notifications.client, {})).items.filter((i: { on: boolean }) => !i.on).map((i: { key: string }) => i.key)).toEqual(["versions", "invoice_reminders"]);
    await expect(w.maya.mutation(api.notifications.setClient, { key: "client_bills", on: false })).rejects.toThrow(/always sent/);
    await expect(w.maya.query(api.notifications.owner, {})).rejects.toThrow();
  });

  test("owner: a switched-off email isn't sent; the new owner emails (a declined booking, a W-9) arrive while on", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { A, jordan, book } = await setup(w);
    const k1 = await book("A", "2030-11-06");
    await jordan.mutation(api.vendorPortal.accept, { bookingId: k1 });
    await w.heston.mutation(api.notifications.setOwner, { key: "vendor_invoices", on: false });
    await jordan.mutation(api.vendorPortal.saveInvoice, { bookingId: k1, mode: "hours", hours: [{ label: "Nov 6", qty: 1 }], lines: [], number: "JE-1", send: true });
    await settle(w);
    expect(mails.filter((m) => m.to === HESTON).map((m) => m.subject)).toEqual(["Jordan Ellis accepted the booking: 26127 Launch"]); // no "sent invoice"
    // Switched back on: the next one arrives (a resend after a decline is a new email).
    await w.heston.mutation(api.notifications.setOwner, { key: "vendor_invoices", on: true });
    const k2 = await book("A", "2030-11-20");
    await jordan.mutation(api.vendorPortal.decline, { bookingId: k2, reason: "Booked that day", note: "Sorry!" });
    const up = await w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4 w9"], { type: "application/pdf" })));
    await jordan.mutation(api.vendorPortal.setW9, { businessId: A, storageId: up, name: "W-9.pdf" });
    await settle(w);
    const toMe = mails.filter((m) => m.to === HESTON);
    const declined = toMe.find((m) => m.subject === "Jordan Ellis declined the booking: 26127 Launch")!;
    expect(declined.text).toContain("Reason: Booked that day: Sorry!");
    expect(declined.text).toContain("Settings › Notifications");
    expect(toMe.map((m) => m.subject)).toContain("Jordan Ellis uploaded a W-9");
    // Off: no decline email.
    await w.heston.mutation(api.notifications.setOwner, { key: "booking_answers", on: false });
    const k3 = await book("A", "2030-12-01");
    await jordan.mutation(api.vendorPortal.decline, { bookingId: k3, reason: "Too far" });
    await settle(w);
    expect(mails.filter((m) => m.subject.startsWith("Jordan Ellis declined")).length).toBe(1);
  });

  test("vendor: switches are per business; cancelled bookings and declined invoices email them", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { A, B, jordan, book } = await setup(w);
    const list = await jordan.query(api.vendorPortal.notifications, { businessId: A });
    expect(list.items.map((i: { key: string }) => i.key)).toEqual(["bookings", "briefings", "invoice_updates", "vendor_invite", "vendor_codes"]);
    await jordan.mutation(api.vendorPortal.setNotification, { businessId: B, key: "bookings", on: false }); // only Other Films
    await expect(jordan.mutation(api.vendorPortal.setNotification, { businessId: A, key: "vendor_invite", on: false })).rejects.toThrow(/always sent/);
    expect((await jordan.query(api.vendorPortal.notifications, { businessId: A })).items[0].on).toBe(true);
    expect((await jordan.query(api.vendorPortal.notifications, { businessId: B })).items[0].on).toBe(false);
    const kA = await book("A", "2030-11-06");
    const kB = await book("B", "2030-11-15");
    await settle(w);
    const offers = mails.filter((m) => m.to === JORDAN && /would like to book you/.test(m.subject)).map((m) => m.subject);
    expect(offers).toEqual(["Wrangler Productions would like to book you: Launch"]); // B's offer was switched off
    // Cancelling after the offer went: an email. (B's offer never went, so its cancellation has nothing to take back.)
    await jordan.mutation(api.vendorPortal.accept, { bookingId: kA });
    const inv = await jordan.mutation(api.vendorPortal.saveInvoice, { bookingId: kA, mode: "hours", hours: [{ label: "Nov 6", qty: 2 }], lines: [], number: "JE-9", send: true }) as Id<"vendorInvoices">;
    await w.heston.mutation(api.vendorPayments.decline, { invoiceId: inv, reason: "It was one day." });
    await w.boss.mutation(api.bookings.cancel, { bookingId: kB });
    await settle(w);
    const d = mails.find((m) => m.subject === "Invoice JE-9 declined")!;
    expect(d.to).toBe(JORDAN);
    expect(d.text).toContain("Reason: It was one day.");
    expect(d.text).toContain(`https://app.wranglerportal.com/vendor/invoices/${inv}`);
    expect(mails.some((m) => m.subject === "Booking cancelled: Fern & Field lookbook")).toBe(false);
    await w.heston.mutation(api.bookings.cancel, { bookingId: kA });
    await settle(w);
    const c = mails.find((m) => m.subject === "Booking cancelled: Launch")!;
    expect(c.text).toContain("Wrangler Productions cancelled your booking as a Shooter.");
    // Their invoice switch off: an approval sends nothing.
    await jordan.mutation(api.vendorPortal.setNotification, { businessId: A, key: "invoice_updates", on: false });
    const kA2 = await book("A", "2030-12-06");
    await jordan.mutation(api.vendorPortal.accept, { bookingId: kA2 });
    const inv2 = await jordan.mutation(api.vendorPortal.saveInvoice, { bookingId: kA2, mode: "hours", hours: [{ label: "Dec 6", qty: 1 }], lines: [], number: "JE-10", send: true }) as Id<"vendorInvoices">;
    await w.heston.mutation(api.vendorPayments.approve, { invoiceId: inv2 });
    await settle(w);
    expect(mails.some((m) => m.subject === "Invoice JE-10 approved")).toBe(false);
    expect(await w.t.run((ctx) => ctx.db.query("emailLog").withIndex("by_key", (q) => q.eq("key", `vendor-invoice-approved:${inv2}`)).unique())).toBeNull(); // not logged as sent
  });

  test("owner: a client's payment emails the owner beside the receipt, unless switched off", async () => {
    const w = await world();
    fakeStripe();
    const { id } = await sent(w);
    const pay = async (pid: string, cents: number) => {
      await w.t.run(async (ctx) => { const i = (await ctx.db.get(id))!; await ctx.db.patch(id, { payments: [...(i.payments ?? []), { id: pid, status: "paid", cents, at: Date.now(), method: "Visa •••• 4242" }] as never }); });
      const mails: Sent[] = [];
      stub(mails);
      await w.t.action(internal.invoiceReminders.sendReceipt, { invoiceId: id, paymentId: pid });
      return mails;
    };
    const first = await pay("py_1", 200_000);
    expect(first.map((m) => [m.to, m.subject])).toEqual([["maya@harbor.example", "Receipt from Wrangler Productions: $2,000.00 paid"], [HESTON, expect.stringMatching(/^Maya Brooks paid \$2,000\.00: invoice /)]]);
    await w.heston.mutation(api.notifications.setOwner, { key: "client_paid", on: false });
    const second = await pay("py_2", 250_000);
    expect(second.map((m) => m.to)).toEqual(["maya@harbor.example"]); // the receipt always goes
  });
});
