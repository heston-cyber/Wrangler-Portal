// Pay in portal (Nov 2). The owner pays an approved vendor invoice from their Stripe balance to the vendor's bank
// (Stripe Global Payouts, standard ACH), for the default business only. The vendor sets up direct deposit on
// Stripe's own form; the portal follows the payout until it posts (paid, emails) or fails / is returned (back to
// approved, an email to the owner). Stripe's v2 API is faked here.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";

const api = anyApi;
beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://handsome-hummingbird-11.convex.site";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); delete process.env.STRIPE_PAYOUTS_KEY; });

type W = Awaited<ReturnType<typeof world>>;
type Sent = { to: string; subject: string; text: string };
type Call = { method: string; path: string; body: any; headers: Record<string, string> };
const JORDAN = "jordan@ellisfilms.com";

/** A fake Stripe (v2) and Resend. */
function fake() {
  const s = { mails: [] as Sent[], calls: [] as Call[], balance: 500_000, ach: "pending", bank: false, obp: "processing", reason: null as string | null, down: false };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); s.mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
    if (!url.startsWith("https://api.stripe.com/v2/")) return new Response("{}", { status: 500 });
    if (s.down) return new Response(JSON.stringify({ error: { message: "down" } }), { status: 500 });
    const path = url.slice("https://api.stripe.com/v2/".length).split("?")[0];
    const method = init?.method ?? "GET";
    s.calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null, headers: (init?.headers ?? {}) as Record<string, string> });
    const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
    if (method === "POST" && path === "core/accounts") return ok({ id: "acct_rcp1" });
    if (method === "POST" && path === "core/account_links") return ok({ url: "https://connect.stripe.com/setup/x1" });
    if (path === "core/accounts/acct_rcp1") return ok({ id: "acct_rcp1", configuration: { recipient: { capabilities: { bank_accounts: { ach: { status: s.ach } } } } }, requirements: { entries: [] } });
    if (path === "money_management/payout_methods") return ok({ data: s.bank ? [{ id: "pm_1", type: "bank_account", bank_account: { last4: "6789", bank_name: "STRIPE TEST BANK" } }] : [] });
    if (path === "money_management/financial_accounts") return ok({ data: [{ id: "fa_1", status: "open", balance: { available: { usd: { value: s.balance, currency: "usd" } } } }] });
    if (method === "POST" && path === "money_management/outbound_payments") return ok({ id: "obp_1", status: "processing", expected_arrival_date: "2030-11-12", receipt_url: "https://pay.stripe.com/receipts/x" });
    if (path === "money_management/outbound_payments/obp_1") return ok({ id: "obp_1", status: s.obp, status_transitions: s.obp === "posted" ? { posted_at: new Date().toISOString() } : {}, status_details: s.reason ? { [s.obp]: { reason: s.reason } } : {} });
    return new Response(JSON.stringify({ error: { message: "unknown" } }), { status: 404 });
  }));
  return s;
}
const settle = async (w: W) => { vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };

/** Jordan, a vendor of Wrangler with a login, booked two days at $1,000/day; their invoice JE-014 approved. */
async function approved(w: W) {
  const a = await w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: JORDAN, roles: ["Shooter"], rates: [], invite: true }) as Id<"vendors">;
  const sub = await w.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: JORDAN, name: "Jordan Ellis", role: "vendor" });
    await ctx.db.insert("memberships", { businessId: (await ctx.db.get(a))!.businessId!, email: JORDAN, userId, role: "vendor", createdAt: Date.now() });
    return `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
  });
  const jordan = w.t.withIdentity({ subject: sub });
  const k = await w.heston.mutation(api.bookings.create, { vendorId: a, projectId: w.p, role: "Shooter", start: "2030-11-06", end: "2030-11-07", cents: 100_000, unit: "day" }) as Id<"vendorBookings">;
  await jordan.mutation(api.vendorPortal.accept, { bookingId: k });
  const inv = await jordan.mutation(api.vendorPortal.saveInvoice, { bookingId: k, mode: "hours", hours: [{ label: "Nov 6", qty: 1 }, { label: "Nov 7", qty: 1 }], lines: [], number: "JE-014", send: true }) as Id<"vendorInvoices">;
  await w.heston.mutation(api.vendorPayments.approve, { invoiceId: inv });
  return { a, inv, jordan };
}

describe("pay in portal", () => {
  test("set up direct deposit → pay → posted (paid, emails) → returned (back to approved)", async () => {
    const w = await world();
    const s = fake();
    const { a, inv, jordan } = await approved(w);

    // No key: off everywhere, and Pay is refused.
    expect(await w.heston.query(api.vendorPayouts.status, {})).toMatchObject({ on: false, keySet: false });
    expect(await jordan.query(api.vendorPayouts.mine, { businessId: w.A })).toMatchObject({ on: false, state: "none" });
    await expect(w.heston.action(api.vendorPayouts.pay, { invoiceId: inv })).rejects.toThrow(/isn't connected/);

    process.env.STRIPE_PAYOUTS_KEY = "rk_test_fake";
    expect(await w.heston.query(api.vendorPayouts.status, {})).toMatchObject({ on: true, mode: "test" });
    expect(await w.heston.action(api.vendorPayouts.balance, {})).toEqual({ availableCents: 500_000 });
    expect(await w.heston.query(api.vendorPayouts.forInvoice, { invoiceId: inv })).toMatchObject({ on: true, vendor: { state: "none" }, payout: null });
    await expect(w.heston.action(api.vendorPayouts.pay, { invoiceId: inv })).rejects.toThrow(/hasn't set up direct deposit/);

    // Ask Jordan to set it up: an email pointing at their portal's Settings.
    await w.heston.mutation(api.vendorPayouts.askSetup, { vendorId: a });
    await settle(w);
    const ask = s.mails.find((m) => m.subject === "Set up direct deposit with Wrangler Productions")!;
    expect(ask.to).toBe(JORDAN);
    expect(ask.text).toContain("https://app.wranglerportal.com/settings");

    // Jordan opens Stripe's form: a recipient is made once, then a link.
    expect(await jordan.action(api.vendorPayouts.setupLink, { businessId: w.A })).toEqual({ url: "https://connect.stripe.com/setup/x1" });
    const made = s.calls.find((c) => c.path === "core/accounts")!;
    expect(made.body).toMatchObject({ contact_email: JORDAN, display_name: "Jordan Ellis", identity: { country: "us", entity_type: "individual" }, configuration: { recipient: { capabilities: { bank_accounts: { ach: { requested: true } } } } } });
    expect(s.calls.find((c) => c.path === "core/account_links")!.body).toMatchObject({ account: "acct_rcp1", use_case: { type: "account_onboarding", account_onboarding: { configurations: ["recipient"], return_url: `https://app.wranglerportal.com/settings?payouts=${w.A}` } } });
    await jordan.action(api.vendorPayouts.setupLink, { businessId: w.A });
    expect(s.calls.filter((c) => c.path === "core/accounts")).toHaveLength(1);
    expect(await jordan.query(api.vendorPayouts.mine, { businessId: w.A })).toMatchObject({ on: true, state: "started" });
    expect(await jordan.action(api.vendorPayouts.refreshMine, { businessId: w.A })).toEqual({ state: "started" });

    // They finish it: ready, with the bank's last 4 (and nothing else of the bank).
    s.ach = "active"; s.bank = true;
    expect(await jordan.action(api.vendorPayouts.refreshMine, { businessId: w.A })).toEqual({ state: "ready" });
    expect(await jordan.query(api.vendorPayouts.mine, { businessId: w.A })).toEqual({ on: true, state: "ready", last4: "6789", bankName: "STRIPE TEST BANK" });
    expect(await w.heston.query(api.vendorPayouts.forInvoice, { invoiceId: inv })).toMatchObject({ vendor: { state: "ready", last4: "6789" } });
    expect(s.calls.find((c) => c.path === "core/account_links" && c.body.use_case.type === "account_update")).toBeUndefined();
    await jordan.action(api.vendorPayouts.setupLink, { businessId: w.A });
    expect(s.calls.filter((c) => c.path === "core/account_links").at(-1)!.body.use_case.type).toBe("account_update");

    // Not enough in the Stripe balance: refused, nothing sent, and it can be tried again.
    s.balance = 150_000;
    await expect(w.heston.action(api.vendorPayouts.pay, { invoiceId: inv })).rejects.toThrow(/has \$1,500\.00; this needs \$2,000\.00/);
    expect(s.calls.filter((c) => c.path === "money_management/outbound_payments")).toHaveLength(0);
    expect((await w.heston.query(api.vendorPayouts.forInvoice, { invoiceId: inv })).payout).toMatchObject({ status: "failed" });

    // Pay: the invoice total, once, to their bank; Paying until Stripe says otherwise.
    s.balance = 500_000;
    expect(await w.heston.action(api.vendorPayouts.pay, { invoiceId: inv })).toEqual({ expectedArrival: "2030-11-12" });
    const out = s.calls.filter((c) => c.path === "money_management/outbound_payments");
    expect(out).toHaveLength(1);
    expect(out[0].body).toMatchObject({ from: { financial_account: "fa_1", currency: "usd" }, to: { recipient: "acct_rcp1", payout_method: "pm_1", currency: "usd" }, amount: { value: 200_000, currency: "usd" }, description: "Invoice JE-014" });
    expect(out[0].headers["Idempotency-Key"]).toBe(`wp-vinv-${inv}-2`);
    expect(out[0].headers["Stripe-Version"]).toBe("2026-09-30.preview");
    expect((await w.heston.query(api.vendorPayouts.forInvoice, { invoiceId: inv })).payout).toMatchObject({ status: "processing", expectedArrival: "2030-11-12" });
    await expect(w.heston.action(api.vendorPayouts.pay, { invoiceId: inv })).rejects.toThrow(/already being paid/);
    await expect(w.heston.mutation(api.vendorPayments.markPaid, { invoiceId: inv, paidOn: "2026-01-02", method: "ACH" })).rejects.toThrow(/being paid through Stripe/);
    expect(await w.heston.action(api.vendorPayouts.checkNow, { invoiceId: inv })).toBe("same");
    expect(await jordan.query(api.vendorPortal.invoice, { invoiceId: inv })).toMatchObject({ status: "approved" });

    // Posted: paid (Stripe), the vendor gets email 28 (direct deposit), the owner a note.
    s.obp = "posted";
    expect(await w.t.action(anyApi.vendorPayouts.poll, {})).toBe(1);
    await settle(w);
    const page = await w.heston.query(api.vendorPayments.get, { invoiceId: inv });
    expect(page).toMatchObject({ status: "paid", paidMethod: "Direct deposit (Stripe)" });
    expect(page.history.map((h: { text: string }) => h.text)).toEqual(expect.arrayContaining([expect.stringMatching(/^Paying through Stripe \(ACH to ••••6789\) · expected Nov 12$/), "Paid through Stripe · it left your Stripe balance"]));
    const m28 = s.mails.find((m) => m.subject === "Invoice JE-014 paid")!;
    expect(m28.to).toBe(JORDAN);
    expect(m28.text).toContain("Direct deposit");
    expect(s.mails.find((m) => m.subject === "Paid Jordan Ellis $2,000.00: invoice JE-014")!.to).toBe("heston@wranglerproductions.com");
    expect((await w.heston.query(api.vendorPayments.totals1099, { year: Number(page.paidOn.slice(0, 4)) })).rows).toEqual([expect.objectContaining({ name: "Jordan Ellis", totalCents: 200_000 })]);

    // Still followed for a while: a returned ACH payout puts it back to approved and tells the owner.
    s.obp = "returned"; s.reason = "account_closed";
    expect(await w.t.action(anyApi.vendorPayouts.poll, {})).toBe(1);
    await settle(w);
    expect(await w.heston.query(api.vendorPayments.get, { invoiceId: inv })).toMatchObject({ status: "approved" });
    const bad = s.mails.find((m) => m.subject === "Payment to Jordan Ellis didn't go through: invoice JE-014")!;
    expect(bad.text).toContain("account closed");
    expect(await w.t.action(anyApi.vendorPayouts.poll, {})).toBe(0);
    // And it can be paid again (a new attempt, a new idempotency key).
    s.obp = "processing"; s.reason = null;
    await w.heston.action(api.vendorPayouts.pay, { invoiceId: inv });
    expect(s.calls.filter((c) => c.path === "money_management/outbound_payments").at(-1)!.headers["Idempotency-Key"]).toBe(`wp-vinv-${inv}-3`);
  });

  test("a failed payout goes back to approved; Stripe down leaves it as it was", async () => {
    const w = await world();
    const s = fake();
    process.env.STRIPE_PAYOUTS_KEY = "rk_test_fake";
    const { inv, jordan } = await approved(w);
    await jordan.action(api.vendorPayouts.setupLink, { businessId: w.A });
    s.ach = "active"; s.bank = true;
    await w.heston.action(api.vendorPayouts.pay, { invoiceId: inv });
    s.down = true;
    expect(await w.heston.action(api.vendorPayouts.checkNow, { invoiceId: inv })).toBe("unreachable");
    expect((await w.heston.query(api.vendorPayouts.forInvoice, { invoiceId: inv })).payout).toMatchObject({ status: "processing" });
    s.down = false; s.obp = "failed"; s.reason = "insufficient_funds";
    expect(await w.heston.action(api.vendorPayouts.checkNow, { invoiceId: inv })).toBe("failed");
    await settle(w);
    expect(await w.heston.query(api.vendorPayments.get, { invoiceId: inv })).toMatchObject({ status: "approved" });
    expect((await w.heston.query(api.vendorPayouts.forInvoice, { invoiceId: inv })).payout).toMatchObject({ status: "failed", reason: "insufficient funds" });
    expect(s.mails.some((m) => m.subject.startsWith("Payment to Jordan Ellis didn't go through"))).toBe(true);
    // Mark paid works again once it's no longer on its way.
    await w.heston.mutation(api.vendorPayments.markPaid, { invoiceId: inv, paidOn: "2026-01-02", method: "ACH" });
  });

  test("only the default business; vendors and other businesses can't pay", async () => {
    const w = await world();
    fake();
    process.env.STRIPE_PAYOUTS_KEY = "rk_test_fake";
    const { a, inv, jordan } = await approved(w);
    expect(await w.boss.query(api.vendorPayouts.status, {})).toMatchObject({ on: false, isDefault: false });
    expect(await w.boss.query(api.vendorPayouts.forInvoice, { invoiceId: inv })).toBeNull();
    await expect(w.boss.action(api.vendorPayouts.pay, { invoiceId: inv })).rejects.toThrow();
    await expect(w.boss.mutation(api.vendorPayouts.askSetup, { vendorId: a })).rejects.toThrow();
    expect(await w.boss.action(api.vendorPayouts.balance, {})).toEqual({ error: "off" });
    await expect(jordan.action(api.vendorPayouts.pay, { invoiceId: inv })).rejects.toThrow(/Not allowed/);
    await expect(w.maya.action(api.vendorPayouts.checkNow, { invoiceId: inv })).rejects.toThrow(/Not allowed/);
    await expect(w.heston.query(api.vendorPayouts.mine, { businessId: w.A })).rejects.toThrow(/Not allowed/);
  });
});
