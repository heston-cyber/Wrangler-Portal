// Phase 2 Part B, step 3: the client's side of an invoice: the /i/<token> page, Pay, the payments read back from
// Stripe, email 08 and the Inbox item. Stripe is a stand-in fetch.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { due, fakeStripe, sent, world } from "./payHarness";
import { methodLabel, paymentsFrom } from "../convex/invoicePay";
import { invoiceMail } from "../convex/lib/mails";
import { brandFrom } from "../convex/lib/mail";

const api = anyApi;
const internal = anyApi;

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = "whsec_pay";
  process.env.EMAIL_ONLY_TO = "heston@wranglerproductions.com"; // the preview's rule: Maya's email is held, not sent
  process.env.RESEND_API_KEY = "re_test";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); delete process.env.STRIPE_PUBLISHABLE_KEY; });

describe("the invoice link and the client's list", () => {
  test("Send gives the invoice its link; the page answers with or without an account; drafts and other tokens get nothing", async () => {
    const w = await world();
    fakeStripe();
    const draft = await w.heston.mutation(api.invoices.saveDraft, { kind: "other", title: "Draft", billTo: { name: "Maya", email: "maya@harbor.example" }, lines: [{ id: "a", description: "x", qty: 1, unitCents: 5000 }], dueDate: due });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(draft as Id<"invoices">))!.payToken ?? null)).toBeNull();
    const { token } = await sent(w);
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    const page = await w.t.query(api.invoicePay.page, { token }); // signed out, from the email
    expect(page).toMatchObject({ number: "WRNGLR-0001", title: "Final invoice", status: "due", totalCents: 450000, amountRemainingCents: 450000, canPay: true,
      project: "26127 Launch", hostedUrl: "https://invoice.stripe.com/i/in_1", testMode: true, business: { name: "Wrangler Productions", email: "heston@wranglerproductions.com" } });
    expect(JSON.stringify(page)).not.toMatch(/history|acct_A|cus_1|createdBy/); // nothing of the owner's side or the business's Stripe ids
    expect(await w.t.query(api.invoicePay.page, { token: "x".repeat(24) })).toBeNull();
    expect(await w.t.query(api.invoicePay.page, { token: "bad" })).toBeNull();
  });

  test("Payments › Invoices: the person billed and the client's other people see it; anyone else doesn't", async () => {
    const w = await world();
    fakeStripe();
    const { token } = await sent(w);
    expect((await w.maya.query(api.invoicePay.mine, {})).map((r: { token: string }) => r.token)).toEqual([token]);
    expect((await w.jo.query(api.invoicePay.mine, {})).map((r: { token: string }) => r.token)).toEqual([token]); // one of Harbor's people
    expect(await w.sam.query(api.invoicePay.mine, {})).toEqual([]); // a client of the business, not of Harbor
    expect(await w.boss.query(api.invoicePay.mine, {})).toEqual([]);
    expect(await w.t.query(api.invoicePay.mine, {})).toEqual([]);
  });

  test("viewed: the first look by anyone but the owner, once", async () => {
    const w = await world();
    fakeStripe();
    const { id, token } = await sent(w);
    await w.heston.mutation(api.invoicePay.markViewed, { token });
    expect((await w.heston.query(api.invoices.get, { invoiceId: id })).viewedAt).toBeNull();
    await w.maya.mutation(api.invoicePay.markViewed, { token });
    await w.t.mutation(api.invoicePay.markViewed, { token });
    const inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv.viewedAt).toBeTruthy();
    expect(inv.history.filter((h: { kind: string }) => h.kind === "viewed")).toEqual([expect.objectContaining({ detail: "Maya Brooks" })]);
  });
});

describe("Send tells the client", () => {
  test("one Inbox item ('Pay') to the person billed and one email 08 (held by the preview's list here), noted in the history", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const { id, token } = await sent(w);
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    const items = await w.t.run(async (ctx) => ctx.db.query("inboxItems").collect());
    expect(items).toEqual([expect.objectContaining({ email: "maya@harbor.example", kind: "invoice", link: `/i/${token}`, linkLabel: "Pay", title: "Invoice WRNGLR-0001 · $4,500.00" })]);
    const log = await w.t.run(async (ctx) => ctx.db.query("emailLog").collect());
    expect(log).toEqual([expect.objectContaining({ key: `invoice-sent:${id}`, kind: "invoice", to: "maya@harbor.example" })]);
    const inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv.history.map((h: { kind: string }) => h.kind)).toEqual(["created", "sent", "email_held"]);
    // Running it again sends nothing more.
    await w.t.action(internal.invoicePay.sendInvoiceEmail, { invoiceId: id });
    expect(await w.t.run(async (ctx) => (await ctx.db.query("emailLog").collect()).length)).toBe(1);
  });

  test("email 08 reads as drawn", () => {
    const b = brandFrom({ name: "Wrangler Productions", legalName: "Hill Creative LLC", replyTo: "heston@wranglerproductions.com" }, { ownerEmail: "heston@wranglerproductions.com", logoUrl: null, isDefault: true });
    const m = invoiceMail(b, { name: "Maya Brooks", number: "WRNGLR-0042", title: "Final invoice", project: "26127 Harbor Coffee Launch", amountCents: 450000, dueDate: "2026-11-21", memo: "Thank you, Maya.", link: "https://app.wranglerportal.com/i/abc" });
    expect(m.subject).toBe("Invoice WRNGLR-0042 from Wrangler Productions: $4,500.00 due Nov 21, 2026");
    expect(m.from).toBe("Wrangler Productions <updates@wranglerportal.com>");
    expect(m.text).toContain("Hi Maya,");
    expect(m.text).toContain("Here’s invoice WRNGLR-0042 for 26127 Harbor Coffee Launch.");
    expect(m.text).toContain("Amount due: $4,500.00");
    expect(m.text).toContain("View and pay: https://app.wranglerportal.com/i/abc");
    expect(m.text).toContain("— Heston, Wrangler Productions");
    expect(m.html).not.toMatch(/unsubscribe/i);
  });
});

describe("paying", () => {
  test("Pay gets the invoice's own payment secret on the business's account; refused when it's not switched on, paid, or not connected", async () => {
    const w = await world();
    const calls = fakeStripe();
    const { token } = await sent(w);
    await expect(w.t.action(api.invoicePay.start, { token })).rejects.toThrow(/isn't switched on/);
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_platform";
    const r = await w.t.action(api.invoicePay.start, { token });
    expect(r).toEqual({ clientSecret: "pi_1_secret_abc", accountId: "acct_A", publishableKey: "pk_test_platform", amountCents: 450000 });
    const get = calls[calls.length - 1];
    expect(get).toMatchObject({ method: "GET", path: "invoices/in_1", account: "acct_A" });
    expect(get.query).toContain("expand[0]=confirmation_secret");
    await expect(w.t.action(api.invoicePay.start, { token: "y".repeat(24) })).rejects.toThrow(/isn't here/);
    await w.t.run(async (ctx) => { await ctx.db.patch(w.A, { stripe: { accountId: "acct_A", status: "disconnected", chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true, livemode: false, startedAt: 0, checkedAt: 0 } }); });
    await expect(w.t.action(api.invoicePay.start, { token })).rejects.toThrow(/can't be paid here/);
    expect((await w.t.query(api.invoicePay.page, { token })).canPay).toBe(false);
  });

  test("payments read back from Stripe: a failed card, a bank payment clearing, then paid", async () => {
    const w = await world();
    fakeStripe();
    const { id, token } = await sent(w);
    const failed = { status: "open", amount_requested: 450000, created: 1_790_000_000, payment: { type: "payment_intent", payment_intent: { id: "pi_1", status: "requires_payment_method", amount: 450000, created: 1_790_000_000,
      last_payment_error: { message: "Your card was declined.", payment_method: { type: "card", card: { brand: "visa", last4: "0002" }, created: 1_790_000_100 } } } } };
    fakeStripe({ payments: [failed] });
    await w.t.action(api.invoicePay.refresh, { token });
    let page = await w.t.query(api.invoicePay.page, { token });
    expect(page).toMatchObject({ status: "failed", lastFailure: "Your card was declined.", canPay: true, payments: [] });

    const clearing = { status: "open", amount_requested: 450000, created: 1_790_000_200, payment: { type: "payment_intent", payment_intent: { id: "pi_1", status: "processing", amount: 450000, created: 1_790_000_200, payment_method: { type: "us_bank_account", us_bank_account: { last4: "6789" } } } } };
    fakeStripe({ payments: [clearing] });
    await w.t.action(api.invoicePay.refresh, { token });
    page = await w.t.query(api.invoicePay.page, { token });
    expect(page).toMatchObject({ status: "processing", canPay: false, payments: [expect.objectContaining({ method: "Bank •••• 6789", status: "processing", cents: 450000 })] });

    const paid = { ...clearing, status: "paid", amount_paid: 450000, status_transitions: { paid_at: 1_790_100_000 }, payment: { type: "payment_intent", payment_intent: { ...clearing.payment.payment_intent, status: "succeeded" } } };
    fakeStripe({ payments: [paid], invoiceStatus: "paid" });
    await w.t.action(api.invoicePay.refresh, { token });
    page = await w.t.query(api.invoicePay.page, { token });
    expect(page).toMatchObject({ status: "paid", canPay: false, amountRemainingCents: 0, payments: [expect.objectContaining({ status: "paid", method: "Bank •••• 6789" })] });
    const inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv.history.map((h: { kind: string }) => h.kind)).toEqual(["created", "sent", "failed", "processing", "paid", "delivery_waiting"]);
  });

  test("methods as the invoice shows them", () => {
    expect(methodLabel({ type: "card", card: { brand: "visa", last4: "4242" } })).toBe("Visa •••• 4242");
    expect(methodLabel({ type: "card", card: { brand: "amex", last4: "0005" } })).toBe("Amex •••• 0005");
    expect(methodLabel({ type: "us_bank_account", us_bank_account: { last4: "6789" } })).toBe("Bank •••• 6789");
    expect(methodLabel({ type: "link" })).toBe("Link");
    expect(methodLabel(null)).toBe("Payment");
    // An untouched payment (nothing tried yet) isn't listed.
    expect(paymentsFrom([{ status: "open", payment: { payment_intent: { id: "pi", status: "requires_payment_method" } } }])).toEqual({ payments: [], failure: null, processing: false });
  });

  test("the owner's 'Client's invoice page' link; nobody else gets one", async () => {
    const w = await world();
    fakeStripe();
    const { id, token } = await sent(w);
    expect(await w.heston.mutation(api.invoicePay.ownerLink, { invoiceId: id })).toBe(`https://app.wranglerportal.com/i/${token}`);
    await expect(w.maya.mutation(api.invoicePay.ownerLink, { invoiceId: id })).rejects.toThrow(/Not allowed/);
    await expect(w.boss.mutation(api.invoicePay.ownerLink, { invoiceId: id })).rejects.toThrow();
  });
});
