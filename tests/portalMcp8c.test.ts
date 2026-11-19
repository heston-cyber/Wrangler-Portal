// Phase 8c (Heston, Nov 18, 21:25: "Approved"): money through the one connector. D209: Claude prepares; paying,
// charging and refunding are Heston's own buttons on the site; anything sent (an invoice, a quote, a reminder) asks.
//   T8c.1 a draft invoice is made directly and nothing is sent; sending is an ask whose Confirm page shows the invoice
//         as the client will get it; Confirm hands the Stripe send to the page, signed in as Heston, and records how it went
//   T8c.2 never through it: paying, charging, refunding, starting or changing a subscription, Stripe keys
//   T8c.3 recording a vendor payment, approving their invoice, a reminder: asks
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { world, due } from "./payHarness";
import { ACTIONS } from "../convex/lib/siteActions";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function setup() {
  const w = await world();
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => { calls.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url); return new Response("{}", { status: 500 }); }));
  const key = (await w.heston.action(api.portalKeys.createKey, {})).key as string;
  const a = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await w.t.fetch("/portal-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    const j = await r.json();
    return { error: j.result.isError === true, text: j.result.content[0].text as string, data: j.result.structuredContent as Record<string, any> };
  };
  return { w, a, calls };
}
const draft = (w: Awaited<ReturnType<typeof world>>) => ({ clientId: w.harbor, projectId: w.p, kind: "final", title: "Final invoice", billTo: { name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee" },
  lines: [{ id: "a", description: "Final payment", qty: 1, unitCents: 450000 }], dueDate: due, memo: "Thank you, Maya." });

describe("Phase 8c · money through the connector", () => {
  test("T8c.1 a draft invoice directly; sending asks, shows the invoice, and runs from Heston's Confirm page", async () => {
    const x = await setup();
    const made = await x.a("site_change", { action: "invoices.saveDraft", args: draft(x.w) });
    expect(made.error).toBe(false);
    const invoiceId = made.data.result as string;
    expect((await x.w.t.run((ctx) => ctx.db.get(invoiceId as never)) as { status: string }).status).toBe("draft");
    expect((await x.a("site_change", { action: "invoices.send", args: { invoiceId } })).text).toMatch(/needs Heston/);
    const r = await x.a("site_ask", { action: "invoices.send", args: { invoiceId }, heston_ok: "yes, send Maya the final invoice" });
    expect(r.error).toBe(false);
    expect(r.data.what_goes_out).toEqual(expect.arrayContaining([
      { label: "Bill to", value: "Maya Brooks (Harbor Coffee) <maya@harbor.example>" },
      { label: "Lines", value: "Final payment · 1 × $4,500.00" },
      { label: "Total", value: "$4,500.00" },
      { label: "Sends", value: "Invoice email with its pay link to Maya Brooks (Harbor Coffee) <maya@harbor.example>" },
    ]));
    expect(r.data.what_goes_out.filter((l: { label: string }) => l.label === "Sends")).toHaveLength(1);
    expect(x.calls.filter((u) => u.includes("stripe.com"))).toEqual([]); // nothing reached Stripe
    // A change to the invoice after the ask: Confirm refuses.
    await x.w.heston.mutation(api.invoices.saveDraft, { invoiceId, ...draft(x.w), lines: [{ id: "a", description: "Final payment", qty: 1, unitCents: 990000 }] });
    const g = await x.w.heston.query(api.confirm.get, { id: r.data.request_id });
    expect(g.changed).toBe(true);
    await expect(x.w.heston.mutation(api.confirm.confirm, { id: r.data.request_id, hash: g.hash })).rejects.toThrow(/changed since Claude asked/);
    // Asked again: Confirm hands the send to the page (it talks to Stripe), and nothing else can press it.
    const r2 = await x.a("site_ask", { action: "invoices.send", args: { invoiceId }, heston_ok: "yes, the new total" });
    const g2 = await x.w.heston.query(api.confirm.get, { id: r2.data.request_id });
    await expect(x.w.boss.mutation(api.confirm.confirm, { id: r2.data.request_id, hash: g2.hash })).rejects.toThrow();
    const res = await x.w.heston.mutation(api.confirm.confirm, { id: r2.data.request_id, hash: g2.hash });
    expect(res.runOnPage).toEqual({ fn: "invoices:send", args: { invoiceId } });
    expect((await x.a("request_status", { request_id: r2.data.request_id })).data.status).toBe("running");
    await expect(x.w.heston.mutation(api.confirm.confirm, { id: r2.data.request_id, hash: g2.hash })).rejects.toThrow(/already been confirmed/);
    await x.w.maya.mutation(api.confirm.finished, { id: r2.data.request_id, ok: true }).catch(() => null); // not the owner: nothing
    expect((await x.a("request_status", { request_id: r2.data.request_id })).data.status).toBe("running");
    await x.w.heston.mutation(api.confirm.finished, { id: r2.data.request_id, ok: false, error: "Stripe said no" });
    expect((await x.a("request_status", { request_id: r2.data.request_id })).data).toMatchObject({ status: "failed", error: "Stripe said no" });
  });

  test("T8c.2 never through it: paying, charging, refunding, subscriptions, Stripe keys", async () => {
    const x = await setup();
    for (const name of ["vendorPayouts.pay", "vendorPayouts.balance", "vendorPayouts.nothingWentOut", "subscriptions.start", "subscriptions.changePlan", "subscriptions.pause", "subscriptions.resume", "subscriptions.cancel", "plans.save", "payments.connect", "payments.disconnect", "invoicePay.start", "crm.makeContract", "quotes.draftFrom", "proposals.send"]) {
      expect(ACTIONS[name], name).toBeUndefined();
      expect((await x.a("site_change", { action: name, args: {} })).text).toMatch(/no action called/);
    }
    for (const [name, e] of Object.entries(ACTIONS)) if (e.area === "money") expect(/pay|charge|refund/i.test(name) && e.mode === "change", name).toBe(false);
    const s = await x.a("site_read", { action: "payments.settings" });
    expect(s.error).toBe(false);
    expect(JSON.stringify(s.data)).not.toMatch(/sk_|rk_|whsec_/);
  });

  test("T8c.3 recording a vendor payment, approving their invoice and an invoice reminder all ask", async () => {
    const x = await setup();
    for (const action of ["vendorPayments.markPaid", "vendorPayments.approve", "vendorPayments.decline", "invoiceReminders.sendReminder", "invoiceReminders.setReminders", "quotes.voidQuote", "vendorPayouts.askSetup"]) {
      expect((await x.a("site_change", { action, args: {} })).text, action).toMatch(/needs Heston/);
    }
  });
});
