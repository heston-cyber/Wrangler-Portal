// Nov 21 (Heston: "Should subscription invoices print the EIN too?" — "yes"). A subscription's invoices carry the
// business's EIN like every other invoice: on Stripe's copy (invoice_settings.account_tax_ids) and on the portal's.
//   S1 a new subscription carries the tax ID and remembers it; its mirrored invoice prints the EIN
//   S2 changing or removing the EIN moves running subscriptions to the new tax ID (or none) before the old one goes
//   S3 a subscription that can't be moved keeps the old tax ID in Stripe (tried again on the next save)
//   S4 a tax ID removed in Stripe's dashboard: the subscription starts without it, and Activity says so (no number)
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { fakeStripe, world } from "./payHarness";

const api = anyApi;
type W = Awaited<ReturnType<typeof world>>;
type Call = { method: string; path: string; account: string | null; form: Record<string, string> };

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
  process.env.RESEND_API_KEY = "re_test";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_platform";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

/** fakeStripe, plus the account's tax IDs; subscription updates can be refused. */
function stripe(opts: Parameters<typeof fakeStripe>[0], ids: Array<{ id: string; value: string }>, refuse: { subUpdate?: boolean } = {}) {
  const calls = fakeStripe(opts) as Call[];
  const inner = globalThis.fetch;
  let n = Math.max(0, ...ids.map((x) => Number(x.id.replace("txi_", "")) || 0));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const path = String(url).replace("https://api.stripe.com/v1/", "").split("?")[0];
    const m = init.method ?? "GET";
    const form = Object.fromEntries(new URLSearchParams(String(init.body ?? "")));
    const account = ((init.headers ?? {}) as Record<string, string>)["Stripe-Account"] ?? null;
    if (path === "tax_ids" || path.startsWith("tax_ids/")) {
      calls.push({ method: m, path, account, form });
      const one = path.split("/")[1];
      if (m === "POST") { const t = { id: `txi_${++n}`, value: form.value }; ids.push(t); return new Response(JSON.stringify({ ...t, type: "us_ein" })); }
      if (m === "DELETE") { const i = ids.findIndex((x) => x.id === one); if (i < 0) return new Response("{}", { status: 404 }); ids.splice(i, 1); return new Response(JSON.stringify({ id: one, deleted: true })); }
      if (one) { const t = ids.find((x) => x.id === one); return t ? new Response(JSON.stringify({ ...t, type: "us_ein" })) : new Response("{}", { status: 404 }); }
      return new Response(JSON.stringify({ data: ids.map((x) => ({ ...x, type: "us_ein", owner: { type: "self" } })) }));
    }
    if (/^subscriptions\/[^/]+$/.test(path) && m === "POST" && Object.keys(form).some((k) => k.startsWith("invoice_settings[account_tax_ids]"))) {
      calls.push({ method: m, path, account, form });
      if (refuse.subUpdate) return new Response(JSON.stringify({ error: { message: "try later" } }), { status: 500 });
      return new Response(JSON.stringify({ id: path.split("/")[1], object: "subscription" }));
    }
    return inner(url, init);
  }));
  return { calls, ids };
}

async function running(w: W, ids: Array<{ id: string; value: string }>) {
  fakeStripe();
  const planId = await w.heston.action(api.plans.save, { name: "Monthly retainer", amountCents: 250000, interval: "month", intervalCount: 1 });
  fakeStripe();
  const id = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya Brooks", email: "maya@harbor.example" }, startDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), firstInvoice: "start", postInbox: false });
  const token = (await w.heston.query(api.subscriptions.get, { subscriptionId: id })).link.split("/sub/")[1];
  const s = stripe({ sub: { portal: id, status: "trialing" } }, ids);
  await w.t.action(api.subscriptions.setupDone, { token, setupIntentId: "seti_1" });
  return { id, calls: s.calls };
}
const row = (w: W, id: string) => w.t.run(async (ctx) => await ctx.db.get(id as never) as { accountTaxId?: string } | null);

describe("the EIN on subscription invoices", () => {
  test("S1: a new subscription carries the tax ID and remembers it; its mirrored invoice prints the EIN", async () => {
    const w = await world();
    const ids: Array<{ id: string; value: string }> = [];
    stripe({}, ids);
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    const { id, calls } = await running(w, ids);
    const make = calls.find((c) => c.method === "POST" && c.path === "subscriptions")!;
    expect(make.form["invoice_settings[account_tax_ids][0]"]).toBe("txi_1");
    expect((await row(w, id))!.accountTaxId).toBe("txi_1");
    fakeStripe({ sub: { portal: id }, subInvoice: { status: "open" } });
    await w.t.action(anyApi.subscriptions.importInvoice, { accountId: "acct_A", stripeId: "in_s1" });
    const inv = await w.t.run(async (ctx) => (await ctx.db.query("invoices").collect()).find((i) => i.kind === "subscription")!);
    expect(inv.ein).toBe("12-3456789");
    expect((await w.t.query(api.invoicePay.page, { token: inv.payToken! })).business.ein).toBe("12-3456789");
    // Without an EIN, nothing is added.
    const w2 = await world();
    const plain = await running(w2, []);
    expect(Object.keys(plain.calls.find((c) => c.method === "POST" && c.path === "subscriptions")!.form).some((k) => k.startsWith("invoice_settings"))).toBe(false);
  });

  test("S2: changing the EIN moves the subscription to the new tax ID before the old one is removed; removing it clears the subscription's", async () => {
    const w = await world();
    const ids: Array<{ id: string; value: string }> = [];
    stripe({}, ids);
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    const { id } = await running(w, ids);
    let s = stripe({}, ids);
    await w.heston.action(api.taxId.set, { ein: "98-7654321" });
    const order = s.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`);
    expect(order).toEqual(["POST tax_ids", "POST subscriptions/sub_1", "DELETE tax_ids/txi_1"]);
    expect(s.calls.find((c) => c.path === "subscriptions/sub_1")!.form).toEqual({ "invoice_settings[account_tax_ids][0]": "txi_2" });
    expect((await row(w, id))!.accountTaxId).toBe("txi_2");
    s = stripe({}, ids);
    await w.heston.action(api.taxId.set, { ein: "" });
    expect(s.calls.find((c) => c.path === "subscriptions/sub_1")!.form).toEqual({ "invoice_settings[account_tax_ids]": "" });
    expect((await row(w, id))!.accountTaxId).toBeUndefined();
    expect(ids).toEqual([]);
  });

  test("S3: a subscription Stripe won't update keeps the old tax ID (not removed); the next save moves it and removes it", async () => {
    const w = await world();
    const ids: Array<{ id: string; value: string }> = [];
    stripe({}, ids);
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    const { id } = await running(w, ids);
    stripe({}, ids, { subUpdate: true });
    await expect(w.heston.action(api.taxId.set, { ein: "98-7654321" })).rejects.toThrow(/Stripe still has the old EIN for now/);
    expect(ids.map((x) => x.id)).toEqual(["txi_1", "txi_2"]); // the old one is still there for the subscription
    expect((await row(w, id))!.accountTaxId).toBe("txi_1");
    const s = stripe({}, ids);
    await w.heston.action(api.taxId.set, { ein: "98-7654321" });
    expect(s.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`)).toEqual(["POST subscriptions/sub_1", "DELETE tax_ids/txi_1"]);
    expect((await row(w, id))!.accountTaxId).toBe("txi_2");
    expect(ids.map((x) => x.id)).toEqual(["txi_2"]);
  });

  test("S4: a tax ID removed in Stripe's dashboard: the subscription starts without it, and Activity says so without the number", async () => {
    const w = await world();
    const ids: Array<{ id: string; value: string }> = [];
    stripe({}, ids);
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    ids.length = 0; // removed in Stripe's dashboard
    const { id, calls } = await running(w, ids);
    expect(Object.keys(calls.find((c) => c.method === "POST" && c.path === "subscriptions")!.form).some((k) => k.startsWith("invoice_settings"))).toBe(false);
    expect((await row(w, id))!.accountTaxId).toBeUndefined();
    expect((await w.heston.query(api.subscriptions.get, { subscriptionId: id })).status).toBe("scheduled");
    const activity = await w.t.run(async (ctx) => (await ctx.db.query("auditLog").collect()).map((a) => a.text).join("\n"));
    expect(activity).toContain("a subscription started without it");
    expect(activity).not.toMatch(/3456789/);
  });
});
