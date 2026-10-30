// Phase 2 Part B, step 4: reminders (D51), the receipt, "Payment received" and the failed-payment email.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { nextReminder, REMINDER_DEFAULTS } from "../convex/invoiceReminders";
import { paymentFailedMail, receiptMail, reminderMail } from "../convex/lib/mails";
import { brandFrom } from "../convex/lib/mail";
import { fakeStripe, sent, world, refreshNow } from "./payHarness";

const api = anyApi;
const internal = anyApi;
const DAY = 86_400_000;

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
  process.env.EMAIL_ONLY_TO = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ON = { ...REMINDER_DEFAULTS, on: true }; // 3 days before, 1 day after, every 7 days, 3 overdue at most

describe("when the next reminder goes", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const inv = (o: Record<string, unknown> = {}) => ({ status: "open" as const, processing: false, amountRemainingCents: 1000, dueDate: "2026-11-20", sentAt: now - 10 * DAY, reminders: [], ...o });
  test("off, paid, void, clearing: none", () => {
    expect(nextReminder(inv(), REMINDER_DEFAULTS, now)).toBeNull();
    expect(nextReminder(inv({ status: "paid" }), ON, now)).toBeNull();
    expect(nextReminder(inv({ status: "void" }), ON, now)).toBeNull();
    expect(nextReminder(inv({ processing: true }), ON, now)).toBeNull();
  });
  test("3 days before the due date; then 1 day after it, then every 7 days, 3 at most", () => {
    expect(nextReminder(inv(), ON, now)).toEqual({ kind: "before", at: Date.parse("2026-11-17T15:00:00Z") });
    const before = [{ at: Date.parse("2026-11-17T15:00:00Z"), kind: "before" as const, auto: true }];
    expect(nextReminder(inv({ reminders: before }), ON, now)).toEqual({ kind: "overdue", at: Date.parse("2026-11-21T15:00:00Z") });
    const one = [...before, { at: Date.parse("2026-11-21T15:00:00Z"), kind: "overdue" as const, auto: true }];
    expect(nextReminder(inv({ reminders: one }), ON, now)?.at).toBe(Date.parse("2026-11-28T15:00:00Z"));
    const three = [...one, { at: 1, kind: "overdue" as const, auto: true }, { at: 2, kind: "overdue" as const, auto: true }];
    expect(nextReminder(inv({ reminders: three }), ON, now)).toBeNull();
  });
  test("no 'before' reminder for an invoice sent within a day of it; one sent by hand pushes the next one out", () => {
    expect(nextReminder(inv({ sentAt: Date.parse("2026-11-17T00:00:00Z") }), ON, now)?.kind).toBe("overdue");
    const byHand = [{ at: Date.parse("2026-11-20T18:00:00Z"), kind: "before" as const, auto: false }];
    expect(nextReminder(inv({ reminders: byHand }), ON, now)?.at).toBe(Date.parse("2026-11-21T18:00:00Z")); // a day after it
    expect(nextReminder(inv(), { ...ON, beforeDays: 0 }, now)?.kind).toBe("overdue");
  });
});

describe("reminders in the portal", () => {
  test("the setting: owner only, off by default, kept in range", async () => {
    const w = await world();
    expect((await w.heston.query(api.payments.settings, {})).reminders).toMatchObject({ on: false, beforeDays: 3 });
    await w.heston.mutation(api.invoiceReminders.setReminders, { on: true, beforeDays: 99, afterDays: 1, everyDays: 0, stopAfter: 3 });
    expect((await w.heston.query(api.payments.settings, {})).reminders).toEqual({ on: true, beforeDays: 30, afterDays: 1, everyDays: 1, stopAfter: 3 });
    await expect(w.maya.mutation(api.invoiceReminders.setReminders, { ...ON })).rejects.toThrow(/Not allowed/);
  });

  test("Send reminder: the owner, once every few minutes, noted in the history; the invoice page shows last and next", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const { id } = await sent(w);
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await w.heston.mutation(api.invoiceReminders.sendReminder, { invoiceId: id })).toEqual({ name: "Maya Brooks" });
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(w.heston.mutation(api.invoiceReminders.sendReminder, { invoiceId: id })).rejects.toThrow(/few minutes ago/);
    await expect(w.maya.mutation(api.invoiceReminders.sendReminder, { invoiceId: id })).rejects.toThrow(/Not allowed/);
    await expect(w.boss.mutation(api.invoiceReminders.sendReminder, { invoiceId: id })).rejects.toThrow();
    const inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv.history.find((h: { kind: string }) => h.kind === "reminder")).toMatchObject({ by: "Heston", detail: expect.stringMatching(/days before due · sent by hand/) });
    expect(inv.reminders).toMatchObject({ canSend: true, auto: false, next: null, last: expect.any(Number) });
    const log = await w.t.run(async (ctx) => (await ctx.db.query("emailLog").collect()).map((r) => r.key));
    expect(log.filter((k) => k.startsWith("reminder:"))).toHaveLength(1);
  });

  test("automatic: the hourly run sends what's due, once, and nothing for a business with them off", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const { id } = await sent(w); // due in 14 days
    // Make it due in two days, sent a week ago: the "3 days before" reminder is due now.
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { dueDate: iso(Date.now() + 2 * DAY), sentAt: Date.now() - 7 * DAY }); });
    expect(await w.t.mutation(internal.invoiceReminders.runDue, {})).toEqual({ sent: 0 }); // off
    await w.heston.mutation(api.invoiceReminders.setReminders, { ...ON });
    expect(await w.t.mutation(internal.invoiceReminders.runDue, {})).toEqual({ sent: 1 });
    expect(await w.t.mutation(internal.invoiceReminders.runDue, {})).toEqual({ sent: 0 });
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    let inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv.history.filter((h: { kind: string }) => h.kind === "reminder").map((h: { detail: string }) => h.detail)).toEqual(["3 days before due · automatic"]);
    expect(inv.reminders.next).toBeGreaterThan(Date.now()); // the first overdue one, after the due date

    // Overdue by 2 days: the overdue reminder goes; paid, nothing more.
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { dueDate: iso(Date.now() - 2 * DAY) }); });
    expect(await w.t.mutation(internal.invoiceReminders.runDue, {})).toEqual({ sent: 1 }); // the first overdue one
    expect(await w.t.mutation(internal.invoiceReminders.runDue, {})).toEqual({ sent: 0 }); // the next is 7 days later
    // A week on (the due date and the reminders all 8 days earlier): the second.
    await w.t.run(async (ctx) => { const i = (await ctx.db.get(id))!; await ctx.db.patch(id, { dueDate: iso(Date.now() - 10 * DAY), reminders: i.reminders!.map((r) => ({ ...r, at: r.at - 8 * DAY })) }); });
    expect(await w.t.mutation(internal.invoiceReminders.runDue, {})).toEqual({ sent: 1 }); // the second
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { status: "paid", amountRemainingCents: 0 }); });
    await w.t.run(async (ctx) => { const i = (await ctx.db.get(id))!; await ctx.db.patch(id, { reminders: i.reminders!.map((r) => ({ ...r, at: r.at - 30 * DAY })) }); });
    expect(await w.t.mutation(internal.invoiceReminders.runDue, {})).toEqual({ sent: 0 });
    inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv.reminders.canSend).toBe(false);
  });
});

describe("after a payment", () => {
  const paid = (id: string, cents: number) => ({ status: "paid", amount_paid: cents, status_transitions: { paid_at: Math.floor(Date.now() / 1000) }, payment: { type: "payment_intent", payment_intent: { id, status: "succeeded", amount: cents, payment_method: { type: "card", card: { brand: "visa", last4: "4242" } } } } });
  test("a receipt and 'Payment received' for each new payment, once", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const { id, token } = await sent(w);
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    fakeStripe({ payments: [paid("pi_1", 450000)], invoiceStatus: "paid" });
    await refreshNow(w, token);
    await refreshNow(w, token); // again: nothing new
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    const items = await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).filter((i) => i.kind === "payment"));
    expect(items).toEqual([expect.objectContaining({ email: "maya@harbor.example", title: "Payment received · $4,500.00", linkLabel: "View receipt", link: `/i/${token}` })]);
    const log = await w.t.run(async (ctx) => (await ctx.db.query("emailLog").collect()).map((r) => r.key));
    expect(log).toContain(`receipt:${id}:pi_1`);
    expect(log.filter((k) => k.startsWith("receipt:"))).toHaveLength(1);
  });

  test("a failed attempt is emailed 15 minutes later, unless they paid in the meantime", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const { id, token } = await sent(w);
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    const t0 = Math.floor(Date.now() / 1000);
    const failed = { status: "open", payment: { type: "payment_intent", payment_intent: { id: "pi_f", status: "requires_payment_method", amount: 450000, created: t0,
      last_payment_error: { message: "Your card was declined.", payment_method: { type: "card", card: { brand: "visa", last4: "0002" }, created: t0 } } } } };
    fakeStripe({ payments: [failed] });
    await refreshNow(w, token);
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    let keys = await w.t.run(async (ctx) => (await ctx.db.query("emailLog").collect()).map((r) => r.key));
    expect(keys.filter((k) => k.startsWith("failed:"))).toHaveLength(1);

    // A second decline, then a payment before the 15 minutes are up: no second email.
    const t1 = t0 + 3600;
    const failed2 = { ...failed, payment: { type: "payment_intent", payment_intent: { ...failed.payment.payment_intent, id: "pi_g", created: t1, last_payment_error: { ...failed.payment.payment_intent.last_payment_error, payment_method: { type: "card", card: { brand: "visa", last4: "0002" }, created: t1 } } } } };
    vi.setSystemTime(t1 * 1000 + 1000);
    fakeStripe({ payments: [failed2] });
    await refreshNow(w, token);
    fakeStripe({ payments: [failed2, { ...paid("pi_h", 450000), status_transitions: { paid_at: t1 + 60 } }], invoiceStatus: "paid" });
    await refreshNow(w, token);
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    keys = await w.t.run(async (ctx) => (await ctx.db.query("emailLog").collect()).map((r) => r.key));
    expect(keys.filter((k) => k.startsWith("failed:"))).toHaveLength(1);
    expect((await w.heston.query(api.invoices.get, { invoiceId: id })).status).toBe("paid");
  });
});

describe("emails 09–12 read as drawn", () => {
  const b = brandFrom({ name: "Wrangler Productions", legalName: "Hill Creative LLC", replyTo: "heston@wranglerproductions.com" }, { ownerEmail: "heston@wranglerproductions.com", logoUrl: null, isDefault: true });
  const d = { name: "Maya Brooks", number: "WRNGLR-0042", title: "Final invoice", amountCents: 450000, dueDate: "2026-11-21", link: "https://app.wranglerportal.com/i/abc" };
  test("09 before due, 10 overdue", () => {
    const m9 = reminderMail(b, { ...d, kind: "before" });
    expect(m9.subject).toBe("Reminder: invoice WRNGLR-0042 from Wrangler Productions is due Nov 21, 2026");
    expect(m9.text).toContain("A quick reminder that invoice WRNGLR-0042 is due on Nov 21, 2026.");
    expect(m9.text).toContain("If you’ve already paid, thank you. You can ignore this.");
    const m10 = reminderMail(b, { ...d, kind: "overdue" });
    expect(m10.subject).toBe("Invoice WRNGLR-0042 from Wrangler Productions is overdue");
    expect(m10.text).toContain("Was due: Nov 21, 2026");
    expect(m10.text).toContain("If something’s wrong with the invoice, just reply.");
  });
  test("11 receipt, 12 payment failed", () => {
    const m11 = receiptMail(b, { ...d, paidCents: 450000, paidAt: Date.parse("2026-11-20T18:00:00Z"), method: "Visa •••• 4242", amountCents: 0 });
    expect(m11.subject).toBe("Receipt from Wrangler Productions: $4,500.00 paid");
    expect(m11.text).toContain("Method: Visa •••• 4242");
    expect(m11.text).toContain("Amount remaining: $0.00");
    expect(m11.text).toContain("View receipt: https://app.wranglerportal.com/i/abc");
    expect(m11.text).toContain("Payment processed by Stripe for Wrangler Productions, a DBA of Hill Creative LLC.");
    const m12 = paymentFailedMail(b, { ...d, message: "Your card was declined." });
    expect(m12.text).toContain("Your card was declined, so nothing was charged.");
    expect(m12.text).toContain("Try again: https://app.wranglerportal.com/i/abc");
    expect(paymentFailedMail(b, { ...d, message: "The bank account couldn't be debited." }).text).toContain("Stripe said: The bank account couldn't be debited.");
  });
});

void (null as unknown as Id<"invoices">);
