// Nov 21 (Heston: "EIN should go on invoices as well, like it would in Stripe"; approved 11:00, invoices and receipts
// only). The EIN is kept in Stripe as the connected account's tax ID and printed on the portal's invoice page, receipt
// and PDF. The owner only reads or changes it; another business never sees it. Stripe is the stand-in (test mode).
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { readFileSync } from "node:fs";
import type { Id } from "../convex/_generated/dataModel";
import { due, fakeStripe, world } from "./payHarness";
import { cleanEin } from "../convex/taxId";

const api = anyApi;

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
  process.env.RESEND_API_KEY = "re_test";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
type Call = { method: string; path: string; account: string | null; form: Record<string, string> };

/** The stand-in, plus Stripe's tax IDs on the connected account. */
function stripeWithTaxIds(existing: Array<{ id: string; type: string; value: string; owner?: string }> = [], refuse: { create?: boolean; delete?: boolean; createStatus?: number; getDeleted?: boolean } = {}) {
  const calls = fakeStripe() as Call[];
  const inner = globalThis.fetch;
  const ids = [...existing];
  let n = Math.max(0, ...ids.map((x) => Number(x.id.replace("txi_", "")) || 0)); // new ids never repeat one already there
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const path = String(url).replace("https://api.stripe.com/v1/", "").split("?")[0];
    const m = init.method ?? "GET";
    const h = (init.headers ?? {}) as Record<string, string>;
    if (path === "tax_ids" || path.startsWith("tax_ids/")) {
      const form = Object.fromEntries(new URLSearchParams(String(init.body ?? "")));
      calls.push({ method: m, path, account: h["Stripe-Account"] ?? null, form });
      if (m === "POST") {
        if (refuse.create) return new Response(JSON.stringify({ error: { message: `Invalid value ${form.value}` } }), { status: refuse.createStatus ?? 400 });
        const t = { id: `txi_${++n}`, type: form.type, value: form.value }; ids.push(t); return new Response(JSON.stringify({ ...t, object: "tax_id" }));
      }
      const one = path.split("/")[1];
      if (m === "DELETE") {
        if (refuse.delete) return new Response(JSON.stringify({ error: { message: "try later" } }), { status: 500 });
        const i = ids.findIndex((x) => x.id === one); if (i < 0) return new Response(JSON.stringify({ error: { message: "No such tax ID" } }), { status: 404 });
        ids.splice(i, 1); return new Response(JSON.stringify({ id: one, deleted: true }));
      }
      if (one) {
        if (refuse.getDeleted) return new Response(JSON.stringify({ id: one, object: "tax_id", deleted: true }));
        const t = ids.find((x) => x.id === one); return t ? new Response(JSON.stringify(t)) : new Response(JSON.stringify({ error: { message: "No such tax ID" } }), { status: 404 });
      }
      return new Response(JSON.stringify({ data: ids.map((x) => ({ ...x, owner: { type: x.owner ?? "self" } })) }));
    }
    return inner(url, init);
  }));
  return { calls, ids };
}
const draft = (w: W) => w.heston.mutation(api.invoices.saveDraft, {
  clientId: w.harbor, projectId: w.p, kind: "final", title: "Final invoice", billTo: { name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee" },
  lines: [{ id: "a", description: "Final payment", qty: 1, unitCents: 450000 }], dueDate: due,
}) as Promise<Id<"invoices">>;

describe("The business's EIN", () => {
  test("E1: what's typed is tidied to 12-3456789; anything else isn't an EIN", () => {
    expect(cleanEin("123456789")).toBe("12-3456789");
    expect(cleanEin(" 12 3456789 ")).toBe("12-3456789");
    expect(cleanEin("12-3456789")).toBe("12-3456789");
    for (const bad of ["1234567", "12-34567890", "AB-1234567", ""]) expect(cleanEin(bad)).toBeNull();
  });

  test("E2: the owner saves it: added to Stripe as the connected account's own us_ein tax ID; Activity never shows the number", async () => {
    const w = await world();
    const { calls } = stripeWithTaxIds();
    expect(await w.heston.action(api.taxId.set, { ein: "123456789" })).toEqual({ value: "12-3456789", inStripe: true });
    expect(calls.filter((c) => c.path === "tax_ids" && c.method === "POST")).toEqual([expect.objectContaining({ method: "POST", account: "acct_A", form: { type: "us_ein", value: "12-3456789" } })]);
    expect(calls.find((c) => c.path === "tax_ids" && c.method === "GET")!.account).toBe("acct_A"); // looked first (review #7)
    expect(await w.heston.query(api.taxId.get, {})).toEqual({ value: "12-3456789", inStripe: true });
    const activity = await w.t.run(async (ctx) => JSON.stringify(await ctx.db.query("auditLog").collect()));
    expect(activity).toContain("set the business's EIN");
    expect(activity).not.toContain("3456789");
    await expect(w.heston.action(api.taxId.set, { ein: "12-34" })).rejects.toThrow(/nine digits/);
  });

  test("E3: changing it makes and saves the new one first, then removes the old; clearing it removes it from both", async () => {
    const w = await world();
    const { calls, ids } = stripeWithTaxIds();
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    await w.heston.action(api.taxId.set, { ein: "98-7654321" });
    expect(calls.filter((c) => c.path.startsWith("tax_ids") && c.method !== "GET").map((c) => `${c.method} ${c.path}`)).toEqual(["POST tax_ids", "POST tax_ids", "DELETE tax_ids/txi_1"]);
    expect(ids.map((x) => x.value)).toEqual(["98-7654321"]);
    // Saving the same number again finds it already in Stripe: nothing made, nothing removed.
    await w.heston.action(api.taxId.set, { ein: "987654321" });
    expect(calls.filter((c) => c.path.startsWith("tax_ids") && c.method !== "GET")).toHaveLength(3);
    expect(await w.heston.action(api.taxId.set, { ein: "" })).toEqual({ value: null, inStripe: false });
    expect(ids).toEqual([]);
    expect(await w.heston.query(api.taxId.get, {})).toBeNull();
  });

  test("E4: one already on the Stripe account is offered, and used only when the owner says so", async () => {
    const w = await world();
    // A customer's EIN on the same account (owner: customer) is never taken for the business's own (re-review).
    const { calls } = stripeWithTaxIds([{ id: "txi_cust", type: "us_ein", value: "991111111", owner: "customer" }, { id: "txi_old", type: "us_ein", value: "551234567" }]);
    expect(await w.heston.action(api.taxId.fromStripe, { use: false })).toEqual({ value: "55-1234567" });
    expect(await w.heston.query(api.taxId.get, {})).toBeNull(); // only looked
    expect(calls.find((c) => c.path === "tax_ids" && c.method === "GET")!.account).toBe("acct_A");
    expect(await w.heston.action(api.taxId.fromStripe, { use: true })).toEqual({ value: "55-1234567" });
    expect(await w.heston.query(api.taxId.get, {})).toEqual({ value: "55-1234567", inStripe: true });
    expect(await w.heston.action(api.taxId.fromStripe, { use: true })).toBeNull(); // already set: nothing more
    // Settings never does this on its own (a button), nor pushes a portal-only EIN to Stripe without a click.
    const page = readFileSync("src/modules/settings/PaymentsSettings.tsx", "utf8");
    expect(page).toContain("Check Stripe for an EIN");
    expect(page).toContain("Add it to Stripe");
    expect(page.slice(page.indexOf("function TaxIdBlock"), page.indexOf("function FootageStorage"))).not.toContain("useEffect");
  });

  test("E4b (review #1): a refused change leaves the old EIN in use, in Stripe and here; a tax ID removed in Stripe's dashboard doesn't break sending", async () => {
    const w = await world();
    let s = stripeWithTaxIds();
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    const ids0 = s.ids;
    s = stripeWithTaxIds(ids0, { create: true });
    await expect(w.heston.action(api.taxId.set, { ein: "98-7654321" })).rejects.toThrow("Stripe didn't accept that EIN. Check the number and try again.");
    expect(s.ids.map((x) => x.value)).toEqual(["12-3456789"]); // nothing removed
    expect(await w.heston.query(api.taxId.get, {})).toEqual({ value: "12-3456789", inStripe: true });
    // Review #8: Stripe's own words (which quote the number) never reach the page.
    await expect(w.heston.action(api.taxId.set, { ein: "98-7654321" })).rejects.not.toThrow(/7654321/);
    // Deleted in Stripe's dashboard: the send checks, forgets it, and sends without it.
    s = stripeWithTaxIds([]);
    const id = await draft(w);
    await w.heston.action(api.invoices.send, { invoiceId: id });
    expect(s.calls.find((c) => c.method === "POST" && c.path === "invoices")!.form["account_tax_ids[0]"]).toBeUndefined();
    expect((await w.t.run((ctx) => ctx.db.get(id)))!.status).toBe("open");
    expect(await w.heston.query(api.taxId.get, {})).toEqual({ value: "12-3456789", inStripe: false }); // Settings says so
  });

  test("E4c (review #3, #7): removed while Stripe isn't connected, it's removed from the account it was saved on; two saves don't make two", async () => {
    const w = await world();
    const s = stripeWithTaxIds();
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    expect(s.ids).toHaveLength(1);
    await w.t.run(async (ctx) => { await ctx.db.patch(w.A, { stripe: { ...(await ctx.db.get(w.A))!.stripe!, status: "needs_info" } }); });
    await w.heston.action(api.taxId.set, { ein: "" });
    expect(s.ids).toEqual([]);
    expect(s.calls.find((c) => c.method === "DELETE")!.account).toBe("acct_A");
    expect(await w.heston.query(api.taxId.get, {})).toBeNull();
  });

  test("E4d (re-review A, B): an old EIN Stripe won't remove yet is kept and removed on the next save; the same number again with Stripe away changes nothing", async () => {
    const w = await world();
    let s = stripeWithTaxIds();
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    s = stripeWithTaxIds(s.ids, { delete: true });
    await expect(w.heston.action(api.taxId.set, { ein: "98-7654321" })).rejects.toThrow("Saved. Stripe still has the old EIN for now; it's removed the next time you save, or with Try again below.");
    expect(s.ids.map((x) => x.id)).toEqual(["txi_1", "txi_2"]); // both still in Stripe
    expect(await w.heston.query(api.taxId.get, {})).toEqual({ value: "98-7654321", inStripe: true, leftover: true });
    expect((await w.t.run((ctx) => ctx.db.get(w.A)))!.taxIdToRemove).toEqual([{ id: "txi_1", account: "acct_A" }]);
    // Next save (Remove it on the page saves the same number): the old one goes, the new one stays, the note clears.
    const before = s.ids;
    s = stripeWithTaxIds(before);
    expect(await w.heston.action(api.taxId.set, { ein: "98-7654321" })).toEqual({ value: "98-7654321", inStripe: true });
    expect(s.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["tax_ids/txi_1"]);
    expect(s.ids.map((x) => x.value)).toEqual(["98-7654321"]);
    expect(await w.heston.query(api.taxId.get, {})).toEqual({ value: "98-7654321", inStripe: true });
    expect((await w.t.run((ctx) => ctx.db.get(w.A)))!.taxIdToRemove).toBeUndefined();
    // B: Stripe not connected, the same number typed again: nothing is made or removed, Stripe's copy is still known.
    await w.t.run(async (ctx) => { await ctx.db.patch(w.A, { stripe: { ...(await ctx.db.get(w.A))!.stripe!, status: "needs_info" } }); });
    s = stripeWithTaxIds(s.ids);
    expect(await w.heston.action(api.taxId.set, { ein: "987654321" })).toEqual({ value: "98-7654321", inStripe: true });
    expect(s.calls.filter((c) => c.path.startsWith("tax_ids"))).toEqual([]);
    expect(s.ids).toHaveLength(1);
    expect((await w.t.run((ctx) => ctx.db.get(w.A)))!.taxId!.stripeId).toBeDefined();
    // The page compares the cleaned number, so leaving the field unchanged doesn't save at all.
    expect(readFileSync("src/modules/settings/PaymentsSettings.tsx", "utf8")).toContain('const same = (a: string, b: string) => a.replace(/[\\s-]/g, "") === b.replace(/[\\s-]/g, "")');
  });

  test("E4e (re-review C, E, F): a tax ID Stripe answers as deleted is gone too, and Activity says so without the number; only a refused number is called a bad EIN", async () => {
    const w = await world();
    let s = stripeWithTaxIds();
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    s = stripeWithTaxIds(s.ids, { getDeleted: true });
    const id = await draft(w);
    await w.heston.action(api.invoices.send, { invoiceId: id });
    expect(s.calls.find((c) => c.method === "POST" && c.path === "invoices")!.form["account_tax_ids[0]"]).toBeUndefined();
    expect(await w.heston.query(api.taxId.get, {})).toEqual({ value: "12-3456789", inStripe: false });
    const activity = await w.t.run(async (ctx) => (await ctx.db.query("auditLog").collect()).map((a) => a.text).join("\n"));
    expect(activity).toContain("found the business's EIN no longer in Stripe");
    expect(activity).not.toMatch(/3456789/);
    // F: Stripe busy (429) or refusing for another reason isn't "check the number".
    stripeWithTaxIds([], { create: true, createStatus: 429 });
    await expect(w.heston.action(api.taxId.set, { ein: "98-7654321" })).rejects.toThrow("Stripe didn't answer as expected. Nothing changed; try again in a minute.");
    stripeWithTaxIds([], { create: true, createStatus: 403 });
    await expect(w.heston.action(api.taxId.set, { ein: "98-7654321" })).rejects.not.toThrow(/Check the number/);
    expect(await w.heston.query(api.taxId.get, {})).toEqual({ value: "12-3456789", inStripe: false }); // unchanged
  });

  test("E5: on the invoice: Stripe's copy carries the tax ID; the owner's view, the client's page and the receipt show it", async () => {
    const w = await world();
    const { calls } = stripeWithTaxIds();
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    const id = await draft(w);
    await w.heston.action(api.invoices.send, { invoiceId: id });
    expect(calls.find((c) => c.method === "POST" && c.path === "invoices")!.form).toMatchObject({ "account_tax_ids[0]": "txi_1" });
    const inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv.business.ein).toBe("12-3456789");
    const token = (await w.t.run((ctx) => ctx.db.get(id)))!.payToken!;
    expect((await w.t.query(api.invoicePay.page, { token })).business.ein).toBe("12-3456789");
    // Review #2: a made invoice keeps the EIN it was made with; changing or removing it later doesn't change it.
    await w.heston.action(api.taxId.set, { ein: "" });
    expect((await w.t.query(api.invoicePay.page, { token })).business.ein).toBe("12-3456789");
    expect((await w.heston.query(api.invoices.get, { invoiceId: id })).business.ein).toBe("12-3456789");
    // ...and one made before there was an EIN never shows one.
    const before = await draft(w);
    stripeWithTaxIds();
    await w.heston.action(api.invoices.send, { invoiceId: before });
    await w.heston.action(api.taxId.set, { ein: "55-1234567" });
    const t2 = (await w.t.run((ctx) => ctx.db.get(before)))!.payToken!;
    expect((await w.t.query(api.invoicePay.page, { token: t2 })).business.ein).toBeNull();
    // The paper and the PDF print it (invoices and receipts; never a quote).
    expect(readFileSync("src/modules/payments/common.tsx", "utf8")).toContain('{business.ein && <small className="inv-ein">EIN {business.ein}</small>}');
    expect(readFileSync("src/modules/payments/pdf.tsx", "utf8")).toContain("{!quote && d.business.ein ? <Text style={s.legal}>EIN {d.business.ein}</Text> : null}");
    expect(readFileSync("src/modules/payments/QuotePaper.tsx", "utf8")).not.toMatch(/\bein\b|EIN/);
  });

  test("E6: kept before Stripe was connected, or on a different Stripe account: it isn't put on Stripe's invoice", async () => {
    const w = await world();
    const { calls } = stripeWithTaxIds();
    await w.t.run(async (ctx) => { await ctx.db.patch(w.A, { taxId: { type: "us_ein", value: "12-3456789", stripeId: "txi_elsewhere", accountId: "acct_OLD", updatedAt: 0 } }); });
    expect(await w.heston.query(api.taxId.get, {})).toEqual({ value: "12-3456789", inStripe: false });
    const id = await draft(w);
    await w.heston.action(api.invoices.send, { invoiceId: id });
    expect(calls.find((c) => c.method === "POST" && c.path === "invoices")!.form["account_tax_ids[0]"]).toBeUndefined();
    expect((await w.heston.query(api.invoices.get, { invoiceId: id })).business.ein).toBe("12-3456789"); // the portal still prints it
  });

  test("E7: only the owner: another business's owner works on their own (never this one's); clients and nobody are refused; the connector can't reach it", async () => {
    const w = await world();
    stripeWithTaxIds();
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    expect(await w.boss.query(api.taxId.get, {})).toBeNull(); // B has none; A's isn't shown
    expect(await w.boss.action(api.taxId.set, { ein: "98-7654321" })).toEqual({ value: "98-7654321", inStripe: false }); // B has no Stripe
    expect(await w.boss.query(api.taxId.get, {})).toEqual({ value: "98-7654321", inStripe: false }); // landed on B
    expect(await w.heston.query(api.taxId.get, {})).toEqual({ value: "12-3456789", inStripe: true }); // A untouched
    await expect(w.maya.query(api.taxId.get, {})).rejects.toThrow(/Not allowed/);
    await expect(w.maya.action(api.taxId.set, { ein: "11-1111111" })).rejects.toThrow(/Not allowed/);
    await expect(w.t.query(api.taxId.get, {})).rejects.toThrow();
    // The connector's Settings › Payments read leaves it out, and it isn't a site action.
    expect(JSON.stringify(await w.heston.query(api.payments.settings, {}))).not.toContain("3456789");
    expect(readFileSync("convex/lib/siteActions.ts", "utf8")).not.toMatch(/taxId\./);
  });

  test("E8 (review #6): through the Claude connector, the invoice reads give only \"(on file)\", never the number", async () => {
    const w = await world();
    stripeWithTaxIds();
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    const id = await draft(w);
    await w.heston.action(api.invoices.send, { invoiceId: id });
    const key = (await w.heston.action(api.portalKeys.createKey, {})).key as string;
    const read = async (action: string, args: Record<string, unknown>) => {
      const r = await w.t.fetch("/portal-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "site_read", arguments: { action, args } } }) });
      return JSON.stringify(await r.json());
    };
    for (const [action, args] of [["invoices.get", { invoiceId: id }], ["invoices.options", {}]] as const) {
      const out = await read(action, args);
      expect(out, action).toContain("(on file)");
      expect(out, action).not.toMatch(/3456789|123456789/);
    }
  });
});
