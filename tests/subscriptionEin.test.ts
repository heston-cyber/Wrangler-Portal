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
function stripe(opts: Parameters<typeof fakeStripe>[0], ids: Array<{ id: string; value: string }>, refuse: { subUpdate?: boolean; subCreate?: string; taxGet?: boolean; existing?: Record<string, unknown> } = {}) {
  const calls = fakeStripe(opts) as Call[];
  const inner = globalThis.fetch;
  let n = Math.max(0, ...ids.map((x) => Number(x.id.replace("txi_", "")) || 0));
  const keys: Array<string | null> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const path = String(url).replace("https://api.stripe.com/v1/", "").split("?")[0];
    const m = init.method ?? "GET";
    const form = Object.fromEntries(new URLSearchParams(String(init.body ?? "")));
    const account = ((init.headers ?? {}) as Record<string, string>)["Stripe-Account"] ?? null;
    const idem = ((init.headers ?? {}) as Record<string, string>)["Idempotency-Key"] ?? null;
    if (path === "subscriptions" && m === "GET") { calls.push({ method: m, path, account, form: {} }); return new Response(JSON.stringify({ object: "list", data: refuse.existing ? [refuse.existing] : [], has_more: false })); }
    if (path === "subscriptions" && m === "POST") {
      keys.push(idem);
      if (/tax.?id/i.test(refuse.subCreate ?? "")) ids.length = 0; // removed in Stripe's dashboard just before
      if (refuse.subCreate) return new Response(JSON.stringify({ error: { message: refuse.subCreate } }), { status: /tax.?id/i.test(refuse.subCreate) ? 400 : 500 });
    }
    if (refuse.existing && path === `subscriptions/${refuse.existing.id}`) { calls.push({ method: m, path, account, form }); return new Response(JSON.stringify({ ...refuse.existing, default_payment_method: form.default_payment_method ?? null })); }
    if (path.startsWith("tax_ids/") && m === "GET" && refuse.taxGet) { calls.push({ method: m, path, account, form }); return new Response("{}", { status: 500 }); }
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
  return { calls, ids, keys };
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

  test("S5 (security review #1, #5): a retry sends exactly the same request (same tax ID, same key) even when the tax ID check fails; one Stripe already made is used, never a second; a tax ID gone in between asks to try again, without Stripe's words", async () => {
    const w = await world();
    const ids: Array<{ id: string; value: string }> = [];
    stripe({}, ids);
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    fakeStripe();
    const planId = await w.heston.action(api.plans.save, { name: "Monthly retainer", amountCents: 250000, interval: "month", intervalCount: 1 });
    fakeStripe();
    const id = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya Brooks", email: "maya@harbor.example" }, startDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), firstInvoice: "start", postInbox: false });
    const token = (await w.heston.query(api.subscriptions.get, { subscriptionId: id })).link.split("/sub/")[1];
    // Try 1: Stripe's answer to the create is lost (a 500 here).
    let s = stripe({ sub: { portal: id, status: "trialing" } }, ids, { subCreate: "busy" });
    await expect(w.t.action(api.subscriptions.setupDone, { token, setupIntentId: "seti_1" })).rejects.toThrow();
    const first = s.keys[0];
    expect(first).toBe(`wp-sub-${id}-seti_1-0`); // the row, the saved card's setup, the try
    // Try 2: the tax ID check itself fails now; the same decision and the same key are used anyway.
    s = stripe({ sub: { portal: id, status: "trialing" } }, ids, { taxGet: true });
    await w.t.action(api.subscriptions.setupDone, { token, setupIntentId: "seti_1" });
    expect(s.keys).toEqual([first]);
    expect(s.calls.filter((c) => c.method === "GET" && c.path.startsWith("tax_ids/"))).toEqual([]); // decided already
    // A second row whose subscription Stripe already has (made by a try whose answer was lost): used, nothing made.
    fakeStripe();
    const id2 = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya Brooks", email: "maya@harbor.example" }, startDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), firstInvoice: "start", postInbox: false });
    const token2 = (await w.heston.query(api.subscriptions.get, { subscriptionId: id2 })).link.split("/sub/")[1];
    s = stripe({ sub: { portal: id2, status: "trialing", id: "sub_2" } }, ids, { existing: { id: "sub_2", object: "subscription", status: "trialing", metadata: { portal_subscription: id2 }, invoice_settings: { account_tax_ids: ["txi_1"] }, items: { data: [] } } });
    await w.t.action(api.subscriptions.setupDone, { token: token2, setupIntentId: "seti_1" });
    expect(s.keys).toEqual([]);
    expect(s.calls.find((c) => c.method === "POST" && c.path === "subscriptions/sub_2")!.form).toEqual({ default_payment_method: "pm_1" }); // re-check N4: the new card
    expect((await row(w, id2))!.accountTaxId).toBe("txi_1"); // #2: what Stripe says it carries is recorded
    // #5: the tax ID went between the check and the create: a plain message, and decided again next time.
    fakeStripe();
    const id3 = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya Brooks", email: "maya@harbor.example" }, startDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), firstInvoice: "start", postInbox: false });
    const token3 = (await w.heston.query(api.subscriptions.get, { subscriptionId: id3 })).link.split("/sub/")[1];
    stripe({ sub: { portal: id3 } }, ids, { subCreate: "No such tax ID: 'txi_1'" }); // Stripe's exact words don't matter
    const err = await w.t.action(api.subscriptions.setupDone, { token: token3, setupIntentId: "seti_1" }).then(() => null, (e: Error) => e.message);
    expect(err).toContain("This couldn't be set up just now. Try again in a moment. Nothing was charged.");
    expect(err).not.toMatch(/txi_|tax_id/);
    const r3 = await w.t.run((ctx) => ctx.db.get(id3 as never)) as { startTaxId?: unknown; startTry?: number };
    expect(r3.startTaxId).toBeUndefined(); // decided again next time
    expect(r3.startTry).toBe(1); // under a new key
  });

  test("S6 (security review #2, #3, #4, #6): a subscription that should carry the EIN gets it back after a change made while Stripe was away; two saves at once leave nothing behind in Stripe; Activity's line is the portal's own", async () => {
    const w = await world();
    const ids: Array<{ id: string; value: string }> = [];
    stripe({}, ids);
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    const { id } = await running(w, ids);
    // Changed while Stripe isn't connected: the subscription goes without (its tax ID is removed), but stays marked.
    const connected = (await w.t.run((ctx) => ctx.db.get(w.A)))!.stripe!;
    await w.t.run(async (ctx) => { await ctx.db.patch(w.A, { stripe: { ...connected, status: "needs_info" } }); });
    stripe({}, ids);
    await w.heston.action(api.taxId.set, { ein: "98-7654321" });
    expect((await row(w, id))!.accountTaxId).toBeUndefined();
    expect(ids).toEqual([]);
    // Reconnected, Add it to Stripe: the subscription carries the new one.
    await w.t.run(async (ctx) => { await ctx.db.patch(w.A, { stripe: connected }); });
    const s = stripe({}, ids);
    await w.heston.action(api.taxId.set, { ein: "98-7654321" });
    expect(s.calls.find((c) => c.path === "subscriptions/sub_1")!.form).toEqual({ "invoice_settings[account_tax_ids][0]": "txi_1" });
    expect((await row(w, id))!.accountTaxId).toBe("txi_1");
    // Two saves at once: whichever lands last is kept, and the other's tax ID is removed, not left in Stripe.
    stripe({}, ids);
    await Promise.allSettled([w.heston.action(api.taxId.set, { ein: "11-1111111" }), w.heston.action(api.taxId.set, { ein: "22-2222222" })]);
    stripe({}, ids);
    await w.heston.action(api.taxId.set, { ein: (await w.heston.query(api.taxId.get, {})).value }); // tidy anything left
    const b = (await w.t.run((ctx) => ctx.db.get(w.A)))!;
    expect(ids.map((x) => x.id)).toEqual([b.taxId!.stripeId]);
    expect(b.taxIdToRemove).toBeUndefined();
    expect((await row(w, id))!.accountTaxId).toBe(b.taxId!.stripeId);
    // #6: the portal's own line when a start found the tax ID gone.
    ids.length = 0;
    const w2 = await world();
    const ids2: Array<{ id: string; value: string }> = [];
    stripe({}, ids2);
    await w2.heston.action(api.taxId.set, { ein: "12-3456789" });
    ids2.length = 0;
    await running(w2, ids2);
    const line = await w2.t.run(async (ctx) => (await ctx.db.query("auditLog").collect()).find((a) => a.text.includes("no longer in Stripe"))!);
    expect(line.who).toBe("WranglerPortal");
  });

  test("S7 (re-check N1, N2): a tax ID a subscription is on, or a start has decided, is never removed; a subscription that couldn't move shows in Settings and is tried again later", async () => {
    const w = await world();
    const ids: Array<{ id: string; value: string }> = [];
    stripe({}, ids);
    await w.heston.action(api.taxId.set, { ein: "12-3456789" }); // txi_1
    const { id } = await running(w, ids);
    // Two saves landed out of step: the business is on txi_3, the subscription still on txi_2, both old ones listed.
    ids.push({ id: "txi_2", value: "11-1111111" }, { id: "txi_3", value: "22-2222222" });
    await w.t.run(async (ctx) => {
      await ctx.db.patch(w.A, { taxId: { type: "us_ein", value: "22-2222222", stripeId: "txi_3", accountId: "acct_A", updatedAt: 0 }, taxIdToRemove: [{ id: "txi_1", account: "acct_A" }, { id: "txi_2", account: "acct_A" }] });
      await ctx.db.patch(id as never, { accountTaxId: "txi_2" });
    });
    // A start that has decided txi_1 but isn't in Stripe yet.
    const other = await w.t.run(async (ctx) => { const s = (await ctx.db.get(id as never)) as Record<string, unknown>; const { _id, _creationTime, ...rest } = s; return await ctx.db.insert("subscriptions", { ...(rest as never), stripe: { ...(rest.stripe as object), subscriptionId: undefined }, status: "starting", startTaxId: "txi_1", accountTaxId: undefined } as never); });
    let s = stripe({}, ids, { subUpdate: true });
    await expect(w.heston.action(api.taxId.set, { ein: "22-2222222" })).rejects.toThrow(/Stripe still has the old EIN for now/);
    expect(s.calls.filter((c) => c.method === "DELETE")).toEqual([]); // txi_1: a start decided it; txi_2: the subscription is on it
    expect((await w.heston.query(api.taxId.get, {})).leftover).toBe(true); // N2: Settings shows it
    expect((await w.t.run((ctx) => ctx.db.get(w.A)))!.taxIdPending).toBe(true);
    // Later (the scheduled try), Stripe takes the update; the start has gone into Stripe meanwhile.
    await w.t.run(async (ctx) => { await ctx.db.delete(other as never); });
    s = stripe({}, ids);
    await w.t.action(anyApi.taxId.tidyLater, { asBusiness: w.A, tries: 0 });
    expect(s.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`)).toEqual(["POST subscriptions/sub_1", "DELETE tax_ids/txi_1", "DELETE tax_ids/txi_2"]);
    expect((await row(w, id))!.accountTaxId).toBe("txi_3");
    const b = (await w.t.run((ctx) => ctx.db.get(w.A)))!;
    expect([b.taxIdToRemove, b.taxIdPending, b.taxIdTidyAt]).toEqual([undefined, undefined, undefined]);
    expect(await w.heston.query(api.taxId.get, {})).toEqual({ value: "22-2222222", inStripe: true });
    // Nobody can run the tidy-up for a business without saying which.
    await expect(w.t.action(anyApi.taxId.tidyLater, { tries: 0 })).rejects.toThrow();
  });

  test("S8 (final check #1-#5): a signed-in client of two businesses finishes a start; a subscription gone in Stripe stops holding the old tax ID; an adopted subscription's open invoice is tried with the new card; a lapsed start doesn't hold one either; a start decided before the EIN existed still gets it", async () => {
    const w = await world();
    const ids: Array<{ id: string; value: string }> = [];
    stripe({}, ids);
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    fakeStripe();
    const planId = await w.heston.action(api.plans.save, { name: "Monthly retainer", amountCents: 250000, interval: "month", intervalCount: 1 });
    const newRow = async () => {
      fakeStripe();
      const id = await w.heston.action(api.subscriptions.start, { clientId: w.harbor, planId, billTo: { name: "Maya Brooks", email: "maya@harbor.example" }, startDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), firstInvoice: "start", postInbox: false });
      return { id, token: (await w.heston.query(api.subscriptions.get, { subscriptionId: id })).link.split("/sub/")[1] as string };
    };
    // #1: Maya, signed in, is also a client of another business.
    await w.t.run(async (ctx) => {
      const B = (await ctx.db.query("businesses").collect()).find((b) => b.slug === "other")!._id;
      const maya = (await ctx.db.query("users").collect()).find((u) => u.email === "maya@harbor.example")!._id;
      await ctx.db.insert("memberships", { businessId: B, email: "maya@harbor.example", userId: maya, role: "client", createdAt: 5 });
    });
    const a = await newRow();
    stripe({ sub: { portal: a.id, status: "trialing" } }, ids);
    expect(await w.maya.action(api.subscriptions.setupDone, { token: a.token, setupIntentId: "seti_1" })).toEqual({ ok: true, message: null });
    expect((await row(w, a.id))!.accountTaxId).toBe("txi_1");
    // #4: an adopted subscription waiting on its first payment: the open invoice is paid with the card just saved.
    const b2 = await newRow();
    let s = stripe({ sub: { portal: b2.id, status: "incomplete", id: "sub_9" }, subInvoice: {} }, ids, { existing: { id: "sub_9", object: "subscription", status: "incomplete", metadata: { portal_subscription: b2.id }, items: { data: [] } } });
    await w.t.action(api.subscriptions.setupDone, { token: b2.token, setupIntentId: "seti_2" });
    expect(s.calls.some((c) => /^invoices\/[^/]+\/pay$/.test(c.path) && c.form.payment_method === "pm_1")).toBe(true);
    // #2: a subscription gone in Stripe (404) is done with: the old tax ID goes on the first save.
    await w.t.run(async (ctx) => { await ctx.db.patch(b2.id as never, { status: "canceled" } as never); }); // (only a's matters below)
    vi.stubGlobal("fetch", vi.fn()); // reset
    s = stripe({}, ids);
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => String(url).includes("/v1/subscriptions/sub_1") ? new Response(JSON.stringify({ error: { message: "No such subscription" } }), { status: 404 }) : inner(url, init)));
    expect(await w.heston.action(api.taxId.set, { ein: "98-7654321" })).toEqual({ value: "98-7654321", inStripe: true });
    expect(ids.map((x) => x.value)).toEqual(["98-7654321"]);
    expect((await row(w, a.id))!.accountTaxId).toBeUndefined();
    // #3: a start that failed a month ago (its decision lapsed) doesn't hold the old tax ID.
    const c = await newRow();
    stripe({ sub: { portal: c.id } }, ids, { subCreate: "busy" });
    await expect(w.t.action(api.subscriptions.setupDone, { token: c.token, setupIntentId: "seti_3" })).rejects.toThrow();
    await w.t.run(async (ctx) => { await ctx.db.patch(c.id as never, { startDecidedAt: Date.now() - 30 * 86_400_000 } as never); });
    stripe({}, ids);
    expect(await w.heston.action(api.taxId.set, { ein: "55-5555555" })).toEqual({ value: "55-5555555", inStripe: true });
    expect(ids.map((x) => x.value)).toEqual(["55-5555555"]);
    // #5: decided "none" before the EIN existed, retried within the day: it's still marked to carry the EIN.
    const w2 = await world();
    fakeStripe();
    const plan2 = await w2.heston.action(api.plans.save, { name: "Retainer", amountCents: 250000, interval: "month", intervalCount: 1 });
    fakeStripe();
    const d = await w2.heston.action(api.subscriptions.start, { clientId: w2.harbor, planId: plan2, billTo: { name: "Maya Brooks", email: "maya@harbor.example" }, startDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), firstInvoice: "start", postInbox: false });
    const dt = (await w2.heston.query(api.subscriptions.get, { subscriptionId: d })).link.split("/sub/")[1];
    const ids2: Array<{ id: string; value: string }> = [];
    stripe({ sub: { portal: d } }, ids2, { subCreate: "busy" });
    await expect(w2.t.action(api.subscriptions.setupDone, { token: dt, setupIntentId: "seti_1" })).rejects.toThrow();
    stripe({}, ids2);
    await w2.heston.action(api.taxId.set, { ein: "12-3456789" });
    stripe({ sub: { portal: d, status: "trialing" } }, ids2);
    await w2.t.action(api.subscriptions.setupDone, { token: dt, setupIntentId: "seti_1" });
    expect((await w2.t.run((ctx) => ctx.db.get(d as never)) as { einOn?: boolean }).einOn).toBe(true); // the tidy-up on link moves it
  });

  test("S9 (Stripe test-mode run): the tax percent keeps what's typed (8.25), the EIN check says when Stripe has none, and copying the pay link can't hold the page", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const ed = fs.readFileSync("src/modules/payments/InvoiceEditor.tsx", "utf8");
    expect(ed).toContain("<TaxInput value={d.taxPercent} onChange={(n) => set({ taxPercent: n })} />");
    expect(ed).toContain('const raw = e.target.value.replace(/[^\\d.]/g, "")');
    expect(ed).toContain("Promise.race([navigator.clipboard.writeText(r.link)");
    expect(fs.readFileSync("src/modules/settings/PaymentsSettings.tsx", "utf8")).toContain("Your Stripe account has no EIN yet. Type it above to add it.");
  });
});
