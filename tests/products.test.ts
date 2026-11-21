// Nov 21 (Heston: the Stripe product library; approved 11:00). Payments › Products and Add from library on invoices
// and quotes. Stripe is the stand-in from payHarness (test mode), with Stripe's product list and per-price lines added.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { due, fakeStripe, world } from "./payHarness";

const api = anyApi;

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
  process.env.RESEND_API_KEY = "re_test";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
type Call = { method: string; path: string; query?: string; account: string | null; form: Record<string, string> };

/** The stand-in plus Stripe's product list, and invoice lines billed by price (Stripe works out their amount). */
function stripe(list: unknown[] = [], opts: { hasMore?: boolean } = {}) {
  const calls = fakeStripe() as Call[];
  const inner = globalThis.fetch;
  const prices = new Map<string, number>();
  // Review L2: what Stripe holds now, for the send's check (a price turned off, a product archived, package pricing).
  const priceState = new Map<string, { product: string; active: boolean; extra?: Record<string, unknown> }>();
  const productActive = new Map<string, boolean>();
  const seen: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const [path, query = ""] = String(url).replace("https://api.stripe.com/v1/", "").split("?");
    const m = init.method ?? "GET";
    const form = Object.fromEntries(new URLSearchParams(String(init.body ?? "")));
    const account = ((init.headers ?? {}) as Record<string, string>)["Stripe-Account"] ?? null;
    if (path === "products" && m === "GET") {
      seen.push({ method: m, path, query: decodeURIComponent(query), account, form });
      return new Response(JSON.stringify({ data: list, has_more: !!opts.hasMore }));
    }
    if (/^prices\/[^/]+$/.test(path) && m === "GET") {
      const id = path.split("/")[1];
      seen.push({ method: m, path, query: decodeURIComponent(query), account, form });
      const st = priceState.get(id);
      if (!st) return new Response(JSON.stringify({ error: { message: "No such price" } }), { status: 404 });
      return new Response(JSON.stringify({ id, object: "price", type: "one_time", currency: "usd", billing_scheme: "per_unit", unit_amount: prices.get(id), active: st.active, product: { id: st.product, active: productActive.get(st.product) ?? true }, ...st.extra }));
    }
    if (/^prices\/[^/]+$/.test(path) && m === "POST" && form.active) { const st = priceState.get(path.split("/")[1]); if (st) st.active = form.active === "true"; }
    if (/^products\/[^/]+$/.test(path) && m === "POST" && form.active) productActive.set(path.split("/")[1], form.active === "true");
    if (path === "invoiceitems" && form["pricing[price]"]) {
      seen.push({ method: m, path, account: null, form });
      const body = new URLSearchParams(String(init.body));
      body.set("amount", String((prices.get(form["pricing[price]"]) ?? 0) * Number(form.quantity ?? 1)));
      return inner(url, { ...init, body: body.toString() });
    }
    const res = await inner(url, init);
    if (path === "prices" && m === "POST") { const j = await res.clone().json(); prices.set(j.id, Number(form.unit_amount)); priceState.set(j.id, { product: form.product, active: true }); }
    return res;
  }));
  return { calls, seen, prices, priceState, productActive };
}
const products = (w: W) => w.t.run(async (ctx) => await ctx.db.query("products").collect());
const draft = (w: W, lines: unknown[]) => w.heston.mutation(api.invoices.saveDraft, {
  clientId: w.harbor, projectId: w.p, kind: "other", title: "Shoot day", billTo: { name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee" }, lines, dueDate: due,
}) as Promise<Id<"invoices">>;

describe("Payments › Products", () => {
  test("P1: a new product is a one-time product and price in the business's Stripe; editing the price makes a new price and retires the old", async () => {
    const w = await world();
    const { calls } = stripe();
    const id = await w.heston.action(api.products.save, { name: "Half-day shoot", description: "4 hours, one camera", amountCents: 120000 });
    const prod = calls.find((c) => c.method === "POST" && c.path === "products")!;
    expect(prod).toMatchObject({ account: "acct_A", form: expect.objectContaining({ name: "Half-day shoot", "metadata[portal_kind]": "item" }) });
    const price = calls.find((c) => c.method === "POST" && c.path === "prices")!;
    expect(price.form).toMatchObject({ product: "prod_0", currency: "usd", unit_amount: "120000" });
    expect(Object.keys(price.form).some((k) => k.startsWith("recurring"))).toBe(false); // one-time, not a plan
    expect(calls.some((c) => c.path === "products/prod_0" && c.form.default_price === "price_0")).toBe(true);
    expect(await w.heston.query(api.products.get, { productId: id })).toEqual({ _id: id, name: "Half-day shoot", description: "4 hours, one camera", amountCents: 120000, archived: false });
    // A name change only updates the product.
    await w.heston.action(api.products.save, { productId: id, name: "Half-day shoot (4 hrs)", description: "4 hours, one camera", amountCents: 120000 });
    expect(calls.filter((c) => c.method === "POST" && c.path === "prices")).toHaveLength(1);
    // A price change: a new price, made the default; the old one retired.
    await w.heston.action(api.products.save, { productId: id, name: "Half-day shoot (4 hrs)", amountCents: 135000 });
    expect(calls.filter((c) => c.method === "POST" && c.path === "prices")).toHaveLength(2);
    expect(calls.some((c) => c.path === "prices/price_0" && c.form.active === "false")).toBe(true);
    expect((await products(w))[0]).toMatchObject({ amountCents: 135000, stripe: expect.objectContaining({ priceId: "price_1" }) });
    // Archive takes it off the picker; bringing it back puts it on again.
    expect(await w.heston.query(api.products.picker, {})).toHaveLength(1);
    await w.heston.action(api.products.setArchived, { productId: id, archived: true });
    expect(calls.some((c) => c.path === "products/prod_0" && c.form.active === "false")).toBe(true);
    expect(await w.heston.query(api.products.picker, {})).toEqual([]);
    await w.heston.action(api.products.setArchived, { productId: id, archived: false });
    expect(await w.heston.query(api.products.picker, {})).toHaveLength(1);
  });

  test("P2: Bring in from Stripe: one-time dollar products come in (and update); plans and other currencies don't", async () => {
    const w = await world();
    const { seen } = stripe([
      { id: "prod_a", name: "Drone add-on", description: "Aerials", active: true, default_price: { id: "price_a", type: "one_time", currency: "usd", unit_amount: 45000, active: true } },
      { id: "prod_b", name: "Monthly retainer", active: true, default_price: { id: "price_b", type: "recurring", currency: "usd", unit_amount: 250000, active: true } },
      { id: "prod_c", name: "Euro thing", active: true, default_price: { id: "price_c", type: "one_time", currency: "eur", unit_amount: 1000, active: true } },
      { id: "prod_d", name: "Old item", active: false, default_price: { id: "price_d", type: "one_time", currency: "usd", unit_amount: 9900, active: true } },
      { id: "prod_e", name: "No price", active: true, default_price: null },
      // Review L1: package pricing ("$100 per 10") doesn't bill unit × quantity, so it isn't a library item.
      { id: "prod_f", name: "Prints", active: true, default_price: { id: "price_f", type: "one_time", currency: "usd", unit_amount: 10000, active: true, billing_scheme: "per_unit", transform_quantity: { divide_by: 10, round: "up" } } },
      { id: "prod_g", name: "Tiered", active: true, default_price: { id: "price_g", type: "one_time", currency: "usd", unit_amount: null, active: true, billing_scheme: "tiered" } },
      { id: "prod_h", name: "  Spaced name  ", active: true, default_price: { id: "price_h", type: "one_time", currency: "usd", unit_amount: 5000, active: true } }, // review I1
    ]);
    expect(await w.heston.action(api.products.sync, {})).toEqual({ added: 3, seen: 3, retired: 0, truncated: false });
    expect(seen[0]).toMatchObject({ account: "acct_A", query: expect.stringContaining("expand[0]=data.default_price") });
    expect((await w.heston.query(api.products.list, {})).map((p: { name: string; archived: boolean }) => [p.name, p.archived])).toEqual([["Drone add-on", false], ["Old item", true], ["Spaced name", false]]);
    expect(await w.heston.action(api.products.sync, {})).toEqual({ added: 0, seen: 3, retired: 0, truncated: false }); // again: nothing doubles
    expect(await products(w)).toHaveLength(3);
    // Review T3: an update comes in; one that's no longer a one-time item (here: gone) is archived, after a full read only.
    stripe([{ id: "prod_a", name: "Drone add-on (4K)", active: true, default_price: { id: "price_a2", type: "one_time", currency: "usd", unit_amount: 50000, active: true } },
      { id: "prod_d", name: "Old item", active: false, default_price: { id: "price_d", type: "one_time", currency: "usd", unit_amount: 9900, active: true } }], { hasMore: true });
    expect(await w.heston.action(api.products.sync, {})).toMatchObject({ added: 0, retired: 0, truncated: true }); // more than 1,000: nothing retired
    expect((await w.heston.query(api.products.picker, {})).map((p: { name: string }) => p.name)).toEqual(["Drone add-on (4K)", "Spaced name"]);
    stripe([{ id: "prod_a", name: "Drone add-on (4K)", active: true, default_price: { id: "price_a2", type: "one_time", currency: "usd", unit_amount: 50000, active: true } }]);
    expect(await w.heston.action(api.products.sync, {})).toEqual({ added: 0, seen: 1, retired: 1, truncated: false });
    expect((await w.heston.query(api.products.picker, {})).map((p: { name: string; amountCents: number }) => [p.name, p.amountCents])).toEqual([["Drone add-on (4K)", 50000]]);
    // Review L4/L5: the same product id on another Stripe account is its own row, and a product from the other key mode isn't offered.
    await w.t.run(async (ctx) => { await ctx.db.insert("products", { businessId: w.A, name: "Live one", amountCents: 1, stripe: { accountId: "acct_A", productId: "prod_live", priceId: "price_live", livemode: true }, createdAt: 0, updatedAt: 0 }); });
    expect((await w.heston.query(api.products.picker, {})).map((p: { name: string }) => p.name)).toEqual(["Drone add-on (4K)"]);
  });

  test("P3: an unchanged library line bills Stripe's price; an edited one, or one whose product changed or was archived, is a plain line", async () => {
    const w = await world();
    const { seen } = stripe();
    const a = await w.heston.action(api.products.save, { name: "Half-day shoot", amountCents: 120000 });
    const b = await w.heston.action(api.products.save, { name: "Drone add-on", amountCents: 45000 });
    const c = await w.heston.action(api.products.save, { name: "Color grade", amountCents: 30000 });
    const pick = (p: { _id: string; priceId: string; amountCents: number; name: string }) => ({ productId: p._id, priceId: p.priceId, unitCents: p.amountCents, description: p.name });
    const lib = await w.heston.query(api.products.picker, {}) as Array<{ _id: string; priceId: string; amountCents: number; name: string }>;
    const [color, drone, half] = lib; // by name
    expect([color._id, drone._id, half._id]).toEqual([c, b, a]);
    const id = await draft(w, [
      { id: "1", description: half.name, qty: 2, unitCents: half.amountCents, item: pick(half) }, // unchanged: by price, 2 of them
      { id: "2", description: "Drone add-on, sunrise", qty: 1, unitCents: drone.amountCents, item: pick(drone) }, // words changed: plain
      { id: "3", description: color.name, qty: 1, unitCents: color.amountCents, item: pick(color) }, // archived before send: plain
    ]);
    await w.heston.action(api.products.setArchived, { productId: c, archived: true });
    await w.heston.action(api.invoices.send, { invoiceId: id });
    const items = seen.filter((x) => x.path === "invoiceitems");
    expect(items).toEqual([expect.objectContaining({ form: expect.objectContaining({ "pricing[price]": half.priceId, quantity: "2" }) })]);
    expect(items[0].form.amount).toBeUndefined(); // review T4: Stripe's price sets the amount, never ours
    expect(items[0].form.currency).toBeUndefined();
    expect(seen.find((x) => x.method === "GET" && x.path === `prices/${half.priceId}`)).toMatchObject({ account: "acct_A", query: expect.stringContaining("expand[0]=product") }); // asked Stripe first
    expect((await w.t.run((ctx) => ctx.db.get(id)))!.status).toBe("open"); // Stripe's total matched the portal's
    // A product whose price changed after it was picked: the old price isn't billed; the line is plain.
    const id2 = await draft(w, [{ id: "1", description: half.name, qty: 1, unitCents: half.amountCents, item: pick(half) }]);
    await w.heston.action(api.products.save, { productId: a, name: "Half-day shoot", amountCents: 125000 });
    const second = stripe(); // a fresh stand-in for the second invoice
    await w.heston.action(api.invoices.send, { invoiceId: id2 });
    expect(second.calls.filter((x) => x.path === "invoiceitems")).toEqual([expect.objectContaining({ form: expect.objectContaining({ amount: "120000" }) })]);
    expect(second.seen.filter((x) => x.path === "invoiceitems")).toEqual([]); // nothing billed by price
  });

  test("P3b (review L2, M1): a price turned off or a product archived in Stripe's dashboard bills as a plain line; the client's page never shows the library's price or ids", async () => {
    const w = await world();
    const s = stripe();
    await w.heston.action(api.products.save, { name: "Half-day shoot", amountCents: 120000 });
    await w.heston.action(api.products.save, { name: "Drone add-on", amountCents: 45000 });
    const [drone, half] = await w.heston.query(api.products.picker, {}) as Array<{ _id: string; priceId: string; amountCents: number; name: string }>;
    const pick = (p: typeof half) => ({ productId: p._id, priceId: p.priceId, unitCents: p.amountCents, description: p.name });
    s.priceState.get(half.priceId)!.active = false; // turned off in Stripe's dashboard; the portal doesn't know yet
    s.productActive.set(s.priceState.get(drone.priceId)!.product, false); // archived in Stripe's dashboard
    const id = await draft(w, [
      { id: "1", description: half.name, qty: 1, unitCents: half.amountCents, item: pick(half) },
      { id: "2", description: drone.name, qty: 1, unitCents: drone.amountCents, item: pick(drone) },
    ]);
    await w.heston.action(api.invoices.send, { invoiceId: id });
    expect(s.seen.filter((x) => x.path === "invoiceitems")).toEqual([]); // nothing by price
    expect(s.calls.filter((x) => x.path === "invoiceitems").map((x) => x.form.amount)).toEqual(["120000", "45000"]);
    expect((await w.t.run((ctx) => ctx.db.get(id)))!.status).toBe("open");
    // M1: the client's invoice page (anyone with the link) carries the lines only, never what they were picked from.
    const token = (await w.t.run((ctx) => ctx.db.get(id)))!.payToken!;
    const page = await w.t.query(api.invoicePay.page, { token });
    expect(page.lines).toEqual([{ id: "1", description: "Half-day shoot", qty: 1, unitCents: 120000 }, { id: "2", description: "Drone add-on", qty: 1, unitCents: 45000 }]);
    expect(JSON.stringify(page)).not.toMatch(/price_|"item"|productId/);
  });

  test("P4: a line can only carry this business's product, at its current price (never another business's)", async () => {
    const w = await world();
    stripe();
    const a = await w.heston.action(api.products.save, { name: "Half-day shoot", amountCents: 120000 });
    const mine = (await products(w))[0];
    const theirs = await w.t.run(async (ctx) => {
      const b = (await ctx.db.query("businesses").collect()).find((x) => x.slug === "other")!;
      return await ctx.db.insert("products", { businessId: b._id, name: "B's thing", amountCents: 100, stripe: { accountId: "acct_B", productId: "prod_B", priceId: "price_B", livemode: false }, createdAt: 0, updatedAt: 0 });
    });
    const id = await draft(w, [
      { id: "1", description: "Half-day shoot", qty: 1, unitCents: 120000, item: { productId: a, priceId: mine.stripe.priceId, unitCents: 120000, description: "Half-day shoot" } },
      { id: "2", description: "B's thing", qty: 1, unitCents: 100, item: { productId: theirs, priceId: "price_B", unitCents: 100, description: "B's thing" } },
      { id: "3", description: "Half-day shoot", qty: 1, unitCents: 1, item: { productId: a, priceId: "price_forged", unitCents: 1, description: "Half-day shoot" } },
    ]);
    const lines = (await w.t.run((ctx) => ctx.db.get(id)))!.lines;
    expect(lines.map((l) => !!l.item)).toEqual([true, false, false]);
    expect(lines[0].item).toEqual({ productId: a, priceId: mine.stripe.priceId, unitCents: 120000, description: "Half-day shoot" });
    // Another business's owner sees none of this library; a client and nobody are refused.
    expect(await w.boss.query(api.products.list, {})).toEqual([{ _id: theirs, name: "B's thing", description: null, amountCents: 100, archived: false }]);
    expect(await w.boss.query(api.products.get, { productId: a })).toBeNull();
    // Review T1: B connected to its own Stripe, so the tenancy check itself is what refuses; Stripe is never called.
    await w.t.run(async (ctx) => { const b = (await ctx.db.query("businesses").collect()).find((x) => x.slug === "other")!; await ctx.db.patch(b._id, { stripe: { accountId: "acct_B", status: "connected", chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, livemode: false, startedAt: 0, checkedAt: 0 } }); });
    const before = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await expect(w.boss.action(api.products.save, { productId: a, name: "Mine now", amountCents: 1 })).rejects.toThrow("That product isn't here.");
    await expect(w.boss.action(api.products.setArchived, { productId: a, archived: true })).rejects.toThrow("That product isn't here.");
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(before);
    expect(await w.boss.query(api.products.picker, {})).toEqual([expect.objectContaining({ _id: theirs, name: "B's thing" })]); // B's own only
    expect((await products(w)).find((p) => p._id === a)).toMatchObject({ name: "Half-day shoot", amountCents: 120000 }); // unchanged
    await expect(w.maya.query(api.products.list, {})).rejects.toThrow(/Not allowed/);
    await expect(w.t.query(api.products.picker, {})).rejects.toThrow();
  });

  test("P5 (review T2): a quote line from the library keeps the server's price (a forged one is ignored), stays a library line on the invoice made from the quote, and bills by price", async () => {
    const w = await world();
    const s = stripe();
    await w.heston.action(api.products.save, { name: "Half-day shoot", amountCents: 120000 });
    const [half] = await w.heston.query(api.products.picker, {}) as Array<{ _id: string; priceId: string; amountCents: number; name: string }>;
    const B = await w.t.run(async (ctx) => (await ctx.db.query("businesses").collect()).find((x) => x.slug === "other")!._id);
    const theirs = await w.t.run((ctx) => ctx.db.insert("products", { businessId: B, name: "B's thing", amountCents: 100, stripe: { accountId: "acct_B", productId: "prod_B", priceId: "price_B", livemode: false }, createdAt: 0, updatedAt: 0 }));
    const qId = await w.heston.mutation(api.quotes.save, { who: { clientId: w.harbor, name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee" }, projectId: w.p, title: "Shoot day", deposit: { kind: "percent", value: 25 }, lines: [
      { id: "1", description: "Half-day shoot", qty: 1, unitCents: 120000, item: { productId: half._id, priceId: half.priceId, unitCents: 1, description: "Half-day shoot" } }, // forged unit price
      { id: "2", description: "B's thing", qty: 1, unitCents: 100, item: { productId: theirs, priceId: "price_B", unitCents: 100, description: "B's thing" } }, // another business's
    ] }) as Id<"quotes">;
    const q = await w.t.run((ctx) => ctx.db.get(qId));
    expect(q!.lines.map((l) => l.item ?? null)).toEqual([{ productId: half._id, priceId: half.priceId, unitCents: 120000, description: "Half-day shoot" }, null]);
    const invoiceId = await w.heston.mutation(anyApi.quotes.makeInvoice, { quoteId: qId, what: "full" }) as Id<"invoices">;
    const inv = await w.t.run((ctx) => ctx.db.get(invoiceId));
    expect(inv!.lines[0].item).toEqual(q!.lines[0].item);
    await w.heston.action(api.invoices.send, { invoiceId });
    expect(s.seen.filter((x) => x.path === "invoiceitems")).toEqual([expect.objectContaining({ form: expect.objectContaining({ "pricing[price]": half.priceId, quantity: "1" }) })]);
    expect((await w.t.run((ctx) => ctx.db.get(invoiceId)))!.status).toBe("open");
    expect((await import("node:fs")).readFileSync("src/modules/payments/Quotes.tsx", "utf8")).toContain("Add from library");
    expect((await import("node:fs")).readFileSync("src/modules/payments/InvoiceEditor.tsx", "utf8")).toContain("Add from library");
  });
});
