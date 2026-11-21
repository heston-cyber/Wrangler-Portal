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
function stripe(list: unknown[] = []) {
  const calls = fakeStripe() as Call[];
  const inner = globalThis.fetch;
  const prices = new Map<string, number>();
  const seen: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const [path, query = ""] = String(url).replace("https://api.stripe.com/v1/", "").split("?");
    const m = init.method ?? "GET";
    const form = Object.fromEntries(new URLSearchParams(String(init.body ?? "")));
    if (path === "products" && m === "GET") {
      seen.push({ method: m, path, query: decodeURIComponent(query), account: ((init.headers ?? {}) as Record<string, string>)["Stripe-Account"] ?? null, form });
      return new Response(JSON.stringify({ data: list, has_more: false }));
    }
    if (path === "invoiceitems" && form["pricing[price]"]) {
      seen.push({ method: m, path, account: null, form });
      const body = new URLSearchParams(String(init.body));
      body.set("amount", String((prices.get(form["pricing[price]"]) ?? 0) * Number(form.quantity ?? 1)));
      return inner(url, { ...init, body: body.toString() });
    }
    const res = await inner(url, init);
    if (path === "prices" && m === "POST") { const j = await res.clone().json(); prices.set(j.id, Number(form.unit_amount)); }
    return res;
  }));
  return { calls, seen, prices };
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
    ]);
    expect(await w.heston.action(api.products.sync, {})).toEqual({ added: 2, seen: 2 });
    expect(seen[0]).toMatchObject({ account: "acct_A", query: expect.stringContaining("expand[0]=data.default_price") });
    expect((await w.heston.query(api.products.list, {})).map((p: { name: string; archived: boolean }) => [p.name, p.archived])).toEqual([["Drone add-on", false], ["Old item", true]]);
    expect(await w.heston.action(api.products.sync, {})).toEqual({ added: 0, seen: 2 }); // again: nothing doubles
    expect(await products(w)).toHaveLength(2);
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
    expect((await w.t.run((ctx) => ctx.db.get(id)))!.status).toBe("open"); // Stripe's total matched the portal's
    // A product whose price changed after it was picked: the old price isn't billed; the line is plain.
    const id2 = await draft(w, [{ id: "1", description: half.name, qty: 1, unitCents: half.amountCents, item: pick(half) }]);
    await w.heston.action(api.products.save, { productId: a, name: "Half-day shoot", amountCents: 125000 });
    const second = stripe(); // a fresh stand-in for the second invoice
    await w.heston.action(api.invoices.send, { invoiceId: id2 });
    expect(second.calls.filter((x) => x.path === "invoiceitems")).toEqual([expect.objectContaining({ form: expect.objectContaining({ amount: "120000" }) })]);
    expect(second.seen.filter((x) => x.path === "invoiceitems")).toEqual([]); // nothing billed by price
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
    await expect(w.boss.action(api.products.save, { productId: a, name: "Mine now", amountCents: 1 })).rejects.toThrow(/Connect Stripe first|isn't here/);
    await expect(w.maya.query(api.products.list, {})).rejects.toThrow(/Not allowed/);
    await expect(w.t.query(api.products.picker, {})).rejects.toThrow();
  });

  test("P5: a quote line from the library stays a library line on the invoice made from the quote", async () => {
    const src = (await import("node:fs")).readFileSync("convex/quotes.ts", "utf8");
    expect(src).toContain("...(l.item ? { item: l.item } : {}) })); // a library line stays one");
    expect(src).toContain("const item = await keepItem(ctx, l.item);");
    const ed = (await import("node:fs")).readFileSync("src/modules/payments/Quotes.tsx", "utf8");
    expect(ed).toContain("Add from library");
    expect((await import("node:fs")).readFileSync("src/modules/payments/InvoiceEditor.tsx", "utf8")).toContain("Add from library");
  });
});
