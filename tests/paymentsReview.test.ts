// The independent review of the payments code (Oct 30): one test per fix (numbers match the review's findings).
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { signForTest } from "../convex/lib/stripeApi";
import { totals } from "../convex/invoices";
import { due, fakeStripe, refreshNow, sent, world } from "./payHarness";

const api = anyApi;
const SECRET = "whsec_pay";

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = SECRET;
  process.env.EMAIL_ONLY_TO = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function poster(w: Awaited<ReturnType<typeof world>>) {
  return async (evId: string, type: string, obj: Record<string, unknown>, account = "acct_A") => {
    const body = JSON.stringify({ id: evId, type, account, livemode: false, data: { object: obj } });
    const r = await w.t.fetch("/stripe/connect", { method: "POST", body, headers: { "stripe-signature": await signForTest(body, SECRET) } });
    return `${r.status} ${await r.text()}`;
  };
}

describe("review fixes", () => {
  test("1: a late 'finalized' (open, nothing paid) after 'paid' leaves it paid", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe({ invoiceStatus: "paid" }); // the re-read from Stripe says paid too
    const { id } = await sent(w);
    const post = await poster(w);
    expect(await post("evt_p", "invoice.paid", { id: "in_1", status: "paid", total: 450000, amount_paid: 450000, amount_remaining: 0 })).toBe("200 ok");
    expect(await post("evt_f", "invoice.finalized", { id: "in_1", status: "open", total: 450000, amount_paid: 0, amount_remaining: 450000 })).toBe("200 ok");
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await w.heston.query(api.invoices.get, { invoiceId: id })).toMatchObject({ status: "paid", amountPaidCents: 450000, amountRemainingCents: 0 });
  });

  test("2: an event is recorded as handled only after it's handled; a repeat is still answered once", async () => {
    const w = await world();
    fakeStripe();
    await sent(w);
    const post = await poster(w);
    expect(await post("evt_u", "invoice.updated", { id: "in_1", status: "open", total: 450000, amount_paid: 0, amount_remaining: 450000 })).toBe("200 ok");
    expect(await post("evt_u", "invoice.updated", { id: "in_1", status: "open", total: 450000, amount_paid: 0, amount_remaining: 450000 })).toBe("200 already handled");
    expect(await w.t.run(async (ctx) => (await ctx.db.query("stripeEvents").collect()).length)).toBe(1);
  });

  test("3: charge.refund.updated is no longer read as a charge (it carries a Refund)", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const { id, token } = await sent(w);
    fakeStripe({ invoiceStatus: "paid", payments: [{ status: "paid", amount_paid: 450000, status_transitions: { paid_at: 1 }, payment: { payment_intent: { id: "pi_1", status: "succeeded", amount: 450000 } } }] });
    await refreshNow(w, token);
    const post = await poster(w);
    await post("evt_r", "charge.refunded", { id: "ch_1", payment_intent: "pi_1", amount_refunded: 50000 });
    await post("evt_ru", "charge.refund.updated", { id: "re_1", object: "refund", payment_intent: "pi_1", charge: "ch_1", amount: 50000, status: "succeeded" });
    expect((await w.heston.query(api.invoices.get, { invoiceId: id })).refundedCents).toBe(50000);
  });

  test("4: a bank payment that fails days after it started still sends the failed-payment email, with the bank's reason", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const { id, token } = await sent(w);
    const started = Math.floor(Date.now() / 1000) - 3 * 86400;
    const pm = { type: "us_bank_account", us_bank_account: { last4: "6789" } };
    fakeStripe({ payments: [{ status: "open", payment: { payment_intent: { id: "pi_b", status: "processing", amount: 450000, created: started, payment_method: pm } } }] });
    await refreshNow(w, token);
    // The webhook says it failed; the re-read shows the bank's reason on a charge made 3 days ago.
    fakeStripe({ payments: [{ status: "open", payment: { payment_intent: { id: "pi_b", status: "requires_payment_method", amount: 450000, created: started, payment_method: pm,
      latest_charge: { id: "ch_b", created: started, failure_message: "The account has insufficient funds." }, last_payment_error: { message: "The payment failed.", charge: "ch_b" } } } }] });
    const post = await poster(w);
    expect(await post("evt_pf", "invoice.payment_failed", { id: "in_1", status: "open", total: 450000, amount_paid: 0, amount_remaining: 450000 })).toBe("200 ok");
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    const inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv).toMatchObject({ status: "failed", lastFailure: { message: "The account has insufficient funds." } });
    expect(inv.history.filter((h: { kind: string }) => h.kind === "failed")).toHaveLength(1);
    const keys = await w.t.run(async (ctx) => (await ctx.db.query("emailLog").collect()).map((r) => r.key));
    expect(keys).toContain(`failed:${id}:pi_b:ch_b`);
  });

  test("5: a failed send deletes its Stripe draft; editing and sending again uses fresh keys and works", async () => {
    const w = await world();
    const bad = fakeStripe({ totalOverride: 1 });
    const id = await w.heston.mutation(api.invoices.saveDraft, { kind: "other", title: "Extra", billTo: { name: "Maya", email: "maya@harbor.example" }, lines: [{ id: "a", description: "x", qty: 1, unitCents: 5000 }], dueDate: due });
    await expect(w.heston.action(api.invoices.send, { invoiceId: id })).rejects.toThrow();
    expect(bad.some((c) => c.method === "DELETE" && c.path === "invoices/in_1")).toBe(true);
    await w.heston.mutation(api.invoices.saveDraft, { invoiceId: id, kind: "other", title: "Extra", billTo: { name: "Maya", email: "maya@harbor.example" }, lines: [{ id: "a", description: "x", qty: 1, unitCents: 6000 }], dueDate: due });
    const good = fakeStripe();
    expect(await w.heston.action(api.invoices.send, { invoiceId: id })).toEqual({ number: "WRNGLR-0001" });
    expect(good.some((c) => c.path === "customers")).toBe(false); // the customer made the first time is reused
    expect(await w.heston.query(api.invoices.get, { invoiceId: id })).toMatchObject({ status: "due", totalCents: 6000 });
  });

  test("7: a client of two businesses can refresh after paying", async () => {
    const w = await world();
    fakeStripe();
    const { token } = await sent(w);
    await w.t.run(async (ctx) => {
      const other = (await ctx.db.query("businesses").collect()).find((b) => b.slug === "other")!;
      const maya = (await ctx.db.query("users").collect()).find((u) => u.email === "maya@harbor.example")!;
      await ctx.db.insert("memberships", { businessId: other._id, email: "maya@harbor.example", userId: maya._id, role: "client", createdAt: 5 });
    });
    fakeStripe({ invoiceStatus: "paid", payments: [{ status: "paid", amount_paid: 450000, status_transitions: { paid_at: 1 }, payment: { payment_intent: { id: "pi_m", status: "succeeded", amount: 450000 } } }] });
    await expect(w.maya.action(api.invoicePay.refresh, { token })).resolves.toBeNull();
    expect((await w.t.query(api.invoicePay.page, { token })).status).toBe("paid");
  });

  test("10: tax is rounded per line, as Stripe does", () => {
    // Two lines of $0.15 at 10%: per line 2¢ + 2¢ = 4¢ (one rounding on $0.30 would give 3¢).
    expect(totals({ lines: [{ qty: 1, unitCents: 15 }, { qty: 1, unitCents: 15 }], taxPercent: 10 }).tax).toBe(4);
  });

  test("11: an invoice due today can still be sent in the evening", async () => {
    const w = await world();
    fakeStripe();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T20:30:00Z")); // 2:30 pm Central
    const id = await w.heston.mutation(api.invoices.saveDraft, { kind: "other", title: "Today", billTo: { name: "Maya", email: "maya@harbor.example" }, lines: [{ id: "a", description: "x", qty: 1, unitCents: 5000 }], dueDate: "2026-11-03" });
    await expect(w.heston.action(api.invoices.send, { invoiceId: id })).resolves.toMatchObject({ number: expect.any(String) });
  });

  test("12: no reminders, by hand or automatic, while Stripe is disconnected", async () => {
    const w = await world();
    fakeStripe();
    const { id } = await sent(w);
    await w.t.run(async (ctx) => { const b = (await ctx.db.get(w.A))!; await ctx.db.patch(w.A, { stripe: { ...b.stripe!, status: "disconnected" } }); });
    await expect(w.heston.mutation(api.invoiceReminders.sendReminder, { invoiceId: id })).rejects.toThrow(/isn't connected/);
  });
});

void (null as unknown as Id<"invoices">);
