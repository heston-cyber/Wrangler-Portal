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
function stripeWithTaxIds(existing: Array<{ id: string; type: string; value: string }> = []) {
  const calls = fakeStripe() as Call[];
  const inner = globalThis.fetch;
  const ids = [...existing];
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const path = String(url).replace("https://api.stripe.com/v1/", "").split("?")[0];
    const m = init.method ?? "GET";
    const h = (init.headers ?? {}) as Record<string, string>;
    if (path === "tax_ids" || path.startsWith("tax_ids/")) {
      const form = Object.fromEntries(new URLSearchParams(String(init.body ?? "")));
      calls.push({ method: m, path, account: h["Stripe-Account"] ?? null, form });
      if (m === "POST") { const t = { id: `txi_${++n}`, type: form.type, value: form.value }; ids.push(t); return new Response(JSON.stringify({ ...t, object: "tax_id" })); }
      if (m === "DELETE") { const i = ids.findIndex((x) => x.id === path.split("/")[1]); if (i >= 0) ids.splice(i, 1); return new Response(JSON.stringify({ id: path.split("/")[1], deleted: true })); }
      return new Response(JSON.stringify({ data: ids }));
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
    expect(calls.filter((c) => c.path === "tax_ids")).toEqual([expect.objectContaining({ method: "POST", account: "acct_A", form: { type: "us_ein", value: "12-3456789" } })]);
    expect(await w.heston.query(api.taxId.get, {})).toEqual({ value: "12-3456789", inStripe: true });
    const activity = await w.t.run(async (ctx) => JSON.stringify(await ctx.db.query("auditLog").collect()));
    expect(activity).toContain("set the business's EIN");
    expect(activity).not.toContain("3456789");
    await expect(w.heston.action(api.taxId.set, { ein: "12-34" })).rejects.toThrow(/nine digits/);
  });

  test("E3: changing it replaces Stripe's (old one removed first); clearing it removes it from both", async () => {
    const w = await world();
    const { calls, ids } = stripeWithTaxIds();
    await w.heston.action(api.taxId.set, { ein: "12-3456789" });
    await w.heston.action(api.taxId.set, { ein: "98-7654321" });
    expect(calls.filter((c) => c.path.startsWith("tax_ids")).map((c) => `${c.method} ${c.path}`)).toEqual(["POST tax_ids", "DELETE tax_ids/txi_1", "POST tax_ids"]);
    expect(ids.map((x) => x.value)).toEqual(["98-7654321"]);
    // Saving the same number again doesn't touch Stripe.
    await w.heston.action(api.taxId.set, { ein: "987654321" });
    expect(calls.filter((c) => c.path.startsWith("tax_ids"))).toHaveLength(3);
    expect(await w.heston.action(api.taxId.set, { ein: "" })).toEqual({ value: null, inStripe: false });
    expect(ids).toEqual([]);
    expect(await w.heston.query(api.taxId.get, {})).toBeNull();
  });

  test("E4: one already set in Stripe is brought in when the portal has none", async () => {
    const w = await world();
    stripeWithTaxIds([{ id: "txi_old", type: "us_ein", value: "551234567" }]);
    expect(await w.heston.action(api.taxId.load, {})).toEqual({ value: "55-1234567", inStripe: true });
    expect(await w.heston.query(api.taxId.get, {})).toEqual({ value: "55-1234567", inStripe: true });
    expect(await w.heston.action(api.taxId.load, {})).toBeNull(); // already there: nothing more
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
    // The paper and the PDF print it (invoices and receipts; never a quote).
    expect(readFileSync("src/modules/payments/common.tsx", "utf8")).toContain('{business.ein && <small className="inv-ein">EIN {business.ein}</small>}');
    expect(readFileSync("src/modules/payments/pdf.tsx", "utf8")).toContain("{!quote && d.business.ein ? <Text style={s.legal}>EIN {d.business.ein}</Text> : null}");
    expect(readFileSync("src/modules/payments/QuotePaper.tsx", "utf8")).not.toContain("ein");
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
    await w.boss.action(api.taxId.set, { ein: "98-7654321" }).catch(() => undefined); // B has no Stripe: kept on B only
    expect(await w.heston.query(api.taxId.get, {})).toEqual({ value: "12-3456789", inStripe: true });
    await expect(w.maya.query(api.taxId.get, {})).rejects.toThrow(/Not allowed/);
    await expect(w.maya.action(api.taxId.set, { ein: "11-1111111" })).rejects.toThrow(/Not allowed/);
    await expect(w.t.query(api.taxId.get, {})).rejects.toThrow();
    // The connector's Settings › Payments read leaves it out, and it isn't a site action.
    expect(JSON.stringify(await w.heston.query(api.payments.settings, {}))).not.toContain("3456789");
    expect(readFileSync("convex/lib/siteActions.ts", "utf8")).not.toMatch(/taxId\./);
  });
});
