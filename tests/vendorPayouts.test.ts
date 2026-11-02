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

/** A fake Stripe (v2) and Resend. Outbound payments honour idempotency keys, like Stripe's. */
function fake() {
  const s = {
    mails: [] as Sent[], calls: [] as Call[], balance: 500_000, ach: "pending", bank: false, obp: "processing", reason: null as string | null, down: false,
    banks: null as null | Array<{ id: string; last4: string; usage?: string }>, def: null as string | null,
    post: "ok" as "ok" | "lostAfter" | "lostBefore" | "garbled", first: "processing", mailDown: false,
    made: new Map<string, { id: string; status: string; body: any }>(),
  };
  const ids = () => s.made.size + 1;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.resend.com/emails") {
      if (s.mailDown) return new Response("{}", { status: 500 });
      const b = JSON.parse(String(init?.body)); s.mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response(JSON.stringify({ id: "em" }), { status: 200 });
    }
    if (!url.startsWith("https://api.stripe.com/v2/")) return new Response("{}", { status: 500 });
    if (s.down) return new Response(JSON.stringify({ error: { message: "down" } }), { status: 500 });
    const path = url.slice("https://api.stripe.com/v2/".length).split("?")[0];
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    s.calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null, headers });
    const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
    const obpOf = (o: { id: string; status: string }) => ({ id: o.id, status: o.status, expected_arrival_date: "2030-11-12", receipt_url: "https://pay.stripe.com/receipts/x",
      status_transitions: o.status === "posted" ? { posted_at: new Date().toISOString() } : {}, status_details: s.reason ? { [o.status]: { reason: s.reason } } : {} });
    if (method === "POST" && path === "core/accounts") return ok({ id: "acct_rcp1" });
    if (method === "POST" && path === "core/account_links") return ok({ url: "https://connect.stripe.com/setup/x1" });
    if (path === "core/accounts/acct_rcp1") return ok({ id: "acct_rcp1", configuration: { recipient: { capabilities: { bank_accounts: { ach: { status: s.ach } } } } }, requirements: { entries: [] }, ...(s.def ? { defaults: { payout_methods: { usd: s.def } } } : {}) });
    if (path === "money_management/payout_methods") {
      const list = s.banks ?? (s.bank ? [{ id: "pm_1", last4: "6789" }] : []);
      return ok({ data: list.map((b) => ({ id: b.id, type: "bank_account", usage_status: { payments: b.usage ?? "eligible" }, bank_account: { last4: b.last4, bank_name: "STRIPE TEST BANK" } })) });
    }
    if (path === "money_management/financial_accounts") return ok({ data: [{ id: "fa_closed", status: "closed" }, { id: "fa_1", status: "open", balance: { available: { usd: { value: s.balance, currency: "usd" } } } }] });
    if (method === "POST" && path === "money_management/outbound_payments") {
      const key = headers["Idempotency-Key"];
      if (s.post === "lostBefore") { s.post = "ok"; return new Response(JSON.stringify({ error: { message: "timeout" } }), { status: 503 }); }
      let o = s.made.get(key);
      if (!o) { o = { id: `obp_${ids()}`, status: s.first, body: JSON.parse(String(init?.body)) }; s.made.set(key, o); }
      if (s.post === "lostAfter") { s.post = "ok"; return new Response(JSON.stringify({ error: { message: "bad gateway" } }), { status: 502 }); }
      if (s.post === "garbled") { s.post = "ok"; return new Response("<html>", { status: 200 }); }
      return ok(obpOf(o));
    }
    const m = /^money_management\/outbound_payments\/(obp_\d+)$/.exec(path);
    if (m) { const o = [...s.made.values()].find((x) => x.id === m[1]); if (!o) return new Response("{}", { status: 404 }); o.status = s.obp; return ok(obpOf(o)); }
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
    expect((await w.heston.query(api.vendorPayouts.forInvoice, { invoiceId: inv })).payout).toMatchObject({ status: "refused" });

    // Pay: the invoice total, once, to their bank; Paying until Stripe says otherwise.
    s.balance = 500_000;
    expect(await w.heston.action(api.vendorPayouts.pay, { invoiceId: inv, last4: "6789" })).toEqual({ state: "processing", expectedArrival: "2030-11-12" });
    const out = s.calls.filter((c) => c.path === "money_management/outbound_payments");
    expect(out).toHaveLength(1);
    expect(out[0].body).toMatchObject({ from: { financial_account: "fa_1", currency: "usd" }, to: { recipient: "acct_rcp1", payout_method: "pm_1", currency: "usd" }, amount: { value: 200_000, currency: "usd" }, description: "Invoice JE-014", metadata: { portal_attempt: "2" } });
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
    const bad = s.mails.find((m) => m.subject === "Payment to Jordan Ellis came back: invoice JE-014")!;
    expect(bad.text).toContain("account closed");
    expect(s.mails.find((m) => m.subject === "Your payment for invoice JE-014 came back")!.to).toBe(JORDAN);
    expect(await w.t.action(anyApi.vendorPayouts.poll, {})).toBe(0);
    // And it can be paid again (a new attempt, a new idempotency key).
    s.reason = null;
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

  // The review's cases (Nov 2): answers that get lost, first answers other than processing, a Pay that died midway,
  // a changed bank, a slow check, and an email that fails.
  async function ready(w: W) {
    const s = fake();
    process.env.STRIPE_PAYOUTS_KEY = "rk_test_fake";
    const r = await approved(w);
    await r.jordan.action(api.vendorPayouts.setupLink, { businessId: w.A });
    s.ach = "active"; s.bank = true;
    await r.jordan.action(api.vendorPayouts.refreshMine, { businessId: w.A });
    return { s, ...r };
  }
  const posts = (s: ReturnType<typeof fake>) => s.calls.filter((c) => c.method === "POST" && c.path === "money_management/outbound_payments");
  const payoutOf = async (w: W, inv: Id<"vendorInvoices">) => (await w.heston.query(api.vendorPayouts.forInvoice, { invoiceId: inv })).payout;

  test("Stripe makes the payment but the answer is lost: re-sent with the same key, paid once", async () => {
    const w = await world();
    const { s, inv } = await ready(w);
    s.post = "lostAfter";
    expect(await w.heston.action(api.vendorPayouts.pay, { invoiceId: inv, last4: "6789" })).toEqual({ state: "unknown", expectedArrival: null });
    expect(await payoutOf(w, inv)).toMatchObject({ status: "unknown", stale: false });
    await expect(w.heston.action(api.vendorPayouts.pay, { invoiceId: inv })).rejects.toThrow(/already being paid/);
    await expect(w.heston.mutation(api.vendorPayments.markPaid, { invoiceId: inv, paidOn: "2026-01-02", method: "ACH" })).rejects.toThrow(/being paid through Stripe/);
    expect(await w.t.action(anyApi.vendorPayouts.poll, {})).toBe(1);
    expect(s.made.size).toBe(1);
    expect(new Set(posts(s).map((c) => c.headers["Idempotency-Key"]))).toEqual(new Set([`wp-vinv-${inv}-1`]));
    expect(await payoutOf(w, inv)).toMatchObject({ status: "processing" });
    s.obp = "posted";
    await w.t.action(anyApi.vendorPayouts.poll, {});
    expect(await w.heston.query(api.vendorPayments.get, { invoiceId: inv })).toMatchObject({ status: "paid", paidCents: 200_000 });
    expect(s.made.size).toBe(1);
  });

  test("the request never reached Stripe, or the answer was garbled: re-sent, made once", async () => {
    const w = await world();
    const { s, inv } = await ready(w);
    s.post = "lostBefore";
    expect((await w.heston.action(api.vendorPayouts.pay, { invoiceId: inv })).state).toBe("unknown");
    expect(s.made.size).toBe(0);
    expect(await w.heston.action(api.vendorPayouts.checkNow, { invoiceId: inv })).toBe("processing");
    expect(s.made.size).toBe(1);
    const w2 = await world();
    const r2 = await ready(w2);
    r2.s.post = "garbled";
    expect((await w2.heston.action(api.vendorPayouts.pay, { invoiceId: r2.inv })).state).toBe("unknown");
    expect(await w2.heston.action(api.vendorPayouts.checkNow, { invoiceId: r2.inv })).toBe("processing");
    expect(r2.s.made.size).toBe(1);
  });

  test("Stripe's first answer is posted or failed: recorded straight away; no second payment", async () => {
    const w = await world();
    const { s, inv } = await ready(w);
    s.first = "posted"; s.obp = "posted";
    expect((await w.heston.action(api.vendorPayouts.pay, { invoiceId: inv })).state).toBe("paid");
    expect(await w.heston.query(api.vendorPayments.get, { invoiceId: inv })).toMatchObject({ status: "paid", paidMethod: "Direct deposit (Stripe)" });
    await expect(w.heston.action(api.vendorPayouts.pay, { invoiceId: inv })).rejects.toThrow(/already paid/);
    expect(s.made.size).toBe(1);
    await settle(w);
    expect(s.mails.some((m) => m.subject === "Invoice JE-014 paid")).toBe(true);

    const w2 = await world();
    const r2 = await ready(w2);
    r2.s.first = "failed"; r2.s.obp = "failed"; r2.s.reason = "invalid_account_number";
    expect((await w2.heston.action(api.vendorPayouts.pay, { invoiceId: r2.inv })).state).toBe("failed");
    expect(await payoutOf(w2, r2.inv)).toMatchObject({ status: "failed", reason: "invalid account number" });
    await settle(w2);
    expect(r2.s.mails.some((m) => m.subject.startsWith("Payment to Jordan Ellis didn't go through"))).toBe(true);
    r2.s.first = "processing"; r2.s.reason = null;
    await w2.heston.action(api.vendorPayouts.pay, { invoiceId: r2.inv });
    expect(posts(r2.s).at(-1)!.headers["Idempotency-Key"]).toBe(`wp-vinv-${r2.inv}-2`);
  });

  test("a Pay that died midway: never sent → can pay again after 10 minutes; sent → re-sent with its key", async () => {
    const w = await world();
    const { s, inv } = await ready(w);
    const now = Date.now();
    await w.t.run(async (ctx) => { await ctx.db.patch(inv, { payout: { status: "starting", attempt: 1, mode: "test", startedAt: now - 60_000 } }); });
    expect(await w.heston.action(api.vendorPayouts.checkNow, { invoiceId: inv })).toBe("same");
    await w.t.run(async (ctx) => { await ctx.db.patch(inv, { payout: { status: "starting", attempt: 1, mode: "test", startedAt: now - 11 * 60_000 } }); });
    expect(await w.t.action(anyApi.vendorPayouts.poll, {})).toBe(1);
    expect(await payoutOf(w, inv)).toMatchObject({ status: "refused" });
    expect(s.made.size).toBe(0);
    // Saved request, then the action died: the cron sends that exact request with its key.
    const request = { key: `wp-vinv-${inv}-2`, cents: 200_000, recipient: "acct_rcp1", payoutMethod: "pm_1", financialAccount: "fa_1", last4: "6789", description: "Invoice JE-014" };
    await w.t.run(async (ctx) => { await ctx.db.patch(inv, { payout: { status: "starting", attempt: 2, mode: "test", startedAt: now - 5 * 60_000, request } }); });
    expect(await w.t.action(anyApi.vendorPayouts.poll, {})).toBe(1);
    expect(posts(s)).toHaveLength(1);
    expect(posts(s)[0].headers["Idempotency-Key"]).toBe(`wp-vinv-${inv}-2`);
    expect(await payoutOf(w, inv)).toMatchObject({ status: "processing" });
    // A day with no answer: the portal stops re-sending; the owner checks Stripe and frees it.
    await w.t.run(async (ctx) => { await ctx.db.patch(inv, { payout: { status: "unknown", attempt: 3, mode: "test", startedAt: now - 24 * 3_600_000, request: { ...request, key: `wp-vinv-${inv}-3` } } }); });
    expect(await w.heston.action(api.vendorPayouts.checkNow, { invoiceId: inv })).toBe("unknown");
    expect(posts(s)).toHaveLength(1);
    expect(await payoutOf(w, inv)).toMatchObject({ status: "unknown", stale: true });
    await w.heston.mutation(api.vendorPayouts.nothingWentOut, { invoiceId: inv });
    expect(await payoutOf(w, inv)).toMatchObject({ status: "refused" });
  });

  test("the bank the owner saw is the bank paid; a changed or ambiguous bank stops it", async () => {
    const w = await world();
    const { s, inv } = await ready(w);
    s.banks = [{ id: "pm_old", last4: "1111" }, { id: "pm_new", last4: "2222" }];
    expect(await w.heston.action(api.vendorPayouts.balance, {})).toMatchObject({ availableCents: 500_000 });
    await expect(w.heston.action(api.vendorPayouts.pay, { invoiceId: inv, last4: "6789" })).rejects.toThrow(/direct deposit isn't ready/);
    s.def = "pm_new";
    await expect(w.heston.action(api.vendorPayouts.pay, { invoiceId: inv, last4: "6789" })).rejects.toThrow(/bank changed to STRIPE TEST BANK ••••2222/);
    expect(await w.heston.query(api.vendorPayouts.forInvoice, { invoiceId: inv })).toMatchObject({ vendor: { state: "ready", last4: "2222" } });
    expect(s.made.size).toBe(0);
    await w.heston.action(api.vendorPayouts.pay, { invoiceId: inv, last4: "2222" });
    expect(posts(s)[0].body.to.payout_method).toBe("pm_new");
  });

  test("a slow check about an old attempt can't overwrite a newer one; a failed email doesn't block the record", async () => {
    const w = await world();
    const { s, inv } = await ready(w);
    await w.heston.action(api.vendorPayouts.pay, { invoiceId: inv });
    expect(await w.t.mutation(anyApi.vendorPayouts.record, { invoiceId: inv, attempt: 7, id: "obp_1", status: "failed", postedOn: "2026-01-02" })).toBe("stale");
    expect(await w.t.mutation(anyApi.vendorPayouts.record, { invoiceId: inv, attempt: 1, id: "obp_9", status: "failed", postedOn: "2026-01-02" })).toBe("stale");
    expect(await payoutOf(w, inv)).toMatchObject({ status: "processing" });
    s.mailDown = true; s.obp = "posted";
    expect(await w.t.action(anyApi.vendorPayouts.poll, {})).toBe(1);
    await settle(w).catch(() => {});
    expect(await w.heston.query(api.vendorPayments.get, { invoiceId: inv })).toMatchObject({ status: "paid" });
  });
});
