// Phase 8c (Heston, Nov 18, 21:25: "Approved"): money through the one connector. D209: Claude prepares; paying,
// charging and refunding are Heston's own buttons on the site; anything sent (an invoice, a quote, a reminder) asks.
//   T8c.1 a draft invoice is made directly and nothing is sent; sending is an ask whose Confirm page shows the invoice
//         as the client will get it; Confirm hands the Stripe send to the page, signed in as Heston, and records how it went
//   T8c.2 never through it: paying, charging, refunding, starting or changing a subscription, Stripe keys
//   T8c.3 recording a vendor payment, approving their invoice, a reminder: asks, and the page names who and how much
//   T8c.4 the 8c review's fixes: a quote's Send shows exactly who it reaches; nothing a confirmed send uses can change
//         while it goes out; an invoice says its kind; money decisions ask; links and the 1099 address stay out
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { world, due } from "./payHarness";
import { ACTIONS } from "../convex/lib/siteActions";
import type { Id } from "../convex/_generated/dataModel";
import { scrub } from "../convex/lib/siteGuard";

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
  const keyB = (await w.boss.action(api.portalKeys.createKey, {})).key as string;
  const as = (k: string) => async (name: string, args: Record<string, unknown> = {}) => {
    const r = await w.t.fetch("/portal-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${k}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    const j = await r.json();
    return { error: j.result.isError === true, text: j.result.content[0].text as string, data: j.result.structuredContent as Record<string, any> };
  };
  return { w, a: as(key), b: as(keyB), calls };
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
    expect(res.runOnPage).toBe(true);
    expect((await x.a("request_status", { request_id: r2.data.request_id })).data.status).toBe("running");
    await expect(x.w.heston.mutation(api.confirm.confirm, { id: r2.data.request_id, hash: g2.hash })).rejects.toThrow(/already been confirmed/);
    // Only the owner who confirmed starts it; Stripe (stubbed to fail here) refuses, so it's recorded as not done.
    await expect(x.w.boss.action(api.confirm.runConfirmed, { id: r2.data.request_id })).rejects.toThrow();
    await expect(x.w.maya.action(api.confirm.runConfirmed, { id: r2.data.request_id })).rejects.toThrow();
    await expect(x.w.heston.action(api.confirm.runConfirmed, { id: r2.data.request_id })).rejects.toThrow();
    expect((await x.a("request_status", { request_id: r2.data.request_id })).data.status).toBe("failed");
    await expect(x.w.heston.action(api.confirm.runConfirmed, { id: r2.data.request_id })).rejects.toThrow(/isn't waiting to go out/); // never twice
    const reached = x.calls.length;
    // Started late (a page that woke up after 2 minutes): nothing goes, and it ran out.
    const r3 = await x.a("site_ask", { action: "invoices.send", args: { invoiceId }, heston_ok: "yes, send it" });
    await x.w.heston.mutation(api.confirm.confirm, { id: r3.data.request_id, hash: (await x.w.heston.query(api.confirm.get, { id: r3.data.request_id })).hash });
    await x.w.t.run(async (ctx) => { await ctx.db.patch(r3.data.request_id as never, { doneAt: Date.now() - 3 * 60_000 } as never); });
    await expect(x.w.heston.action(api.confirm.runConfirmed, { id: r3.data.request_id })).rejects.toThrow(/too long since you confirmed/);
    expect((await x.a("request_status", { request_id: r3.data.request_id })).data).toMatchObject({ status: "failed", error: expect.stringMatching(/too long/) });
    expect((await x.w.t.run((ctx) => ctx.db.query("auditLog").collect())).map((l) => l.text)).toEqual(expect.arrayContaining([expect.stringMatching(/didn't start, so nothing was sent/)]));
    // Changed after Confirm (Heston's own edit on the site): it doesn't start.
    const r4 = await x.a("site_ask", { action: "invoices.send", args: { invoiceId }, heston_ok: "yes, send it now" });
    await x.w.heston.mutation(api.confirm.confirm, { id: r4.data.request_id, hash: (await x.w.heston.query(api.confirm.get, { id: r4.data.request_id })).hash });
    await x.w.heston.mutation(api.invoices.saveDraft, { invoiceId, ...draft(x.w), memo: "Changed after Confirm" });
    await expect(x.w.heston.action(api.confirm.runConfirmed, { id: r4.data.request_id })).rejects.toThrow(/changed since you confirmed/);
    expect(x.calls.length).toBe(reached); // the refused starts reached nothing outside
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

  test("T8c.3 recording a vendor payment, approving their invoice and an invoice reminder all ask; the page names who and how much", async () => {
    const x = await setup();
    for (const action of ["vendorPayments.markPaid", "vendorPayments.approve", "vendorPayments.decline", "invoiceReminders.sendReminder", "invoiceReminders.setReminders", "quotes.voidQuote", "vendorPayouts.askSetup", "footage.reinstate", "footage.dismissLatePaid", "footage.stop", "delivery.setTerm", "delivery.renewed", "crm.logEntry", "footage.markDone"]) {
      expect(ACTIONS[action].mode, action).toBe("ask");
    }
    // The money-area changes Claude makes directly: exactly these (none moves money, charges, refunds or reaches anyone).
    expect(Object.entries(ACTIONS).filter(([, e]) => e.area === "money" && e.mode === "change").map(([k]) => k).sort())
      .toEqual(["footage.recordDrive", "invoices.draftFinal", "invoices.saveDraft", "quotes.answerMove", "quotes.later", "quotes.save", "quotes.stopLink"]);
    const vendorId = await x.w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: "jordan@ellisfilms.com", roles: ["Shooter"], rates: [], invite: false }) as Id<"vendors">;
    const bookingId = await x.w.heston.mutation(api.bookings.create, { vendorId, projectId: x.w.p, role: "Shooter", start: "2030-01-01", end: "2030-01-01", cents: 100_000, unit: "day" }) as Id<"vendorBookings">;
    const invoiceId = await x.w.t.run(async (ctx) => {
      await ctx.db.patch(vendorId, { address: "12 Secret Ln, Tulsa OK" } as never);
      return await ctx.db.insert("vendorInvoices", { businessId: x.w.A, vendorId, bookingId, projectId: x.w.p, number: "JE-007", mode: "lines", hours: [], lines: [{ description: "Shoot day", cents: 120_000 }], rate: { cents: 100_000, unit: "day" }, totalCents: 120_000, status: "approved", createdAt: 0, updatedAt: 0 } as never);
    });
    const r = await x.a("site_ask", { action: "vendorPayments.markPaid", args: { invoiceId, paidOn: "2026-01-05", method: "ACH" }, heston_ok: "yes, I paid Jordan" });
    expect(r.error).toBe(false);
    expect(r.data.what_goes_out).toEqual(expect.arrayContaining([
      { label: "Vendor", value: "Jordan Ellis <jordan@ellisfilms.com>" }, { label: "Total", value: "$1,200.00" }, { label: "Paid on", value: "2026-01-05 by ACH" },
      expect.objectContaining({ label: "Sends", value: expect.stringMatching(/jordan@ellisfilms\.com/) }),
    ]));
    const v = await x.a("site_read", { action: "vendorPayments.get", args: { invoiceId } });
    expect(JSON.stringify(v.data)).not.toContain("Secret Ln");
  });

  test("T8c.4 a quote's Send shows who it reaches; what a confirmed send uses is locked while it goes out; an invoice says its kind", async () => {
    const x = await setup();
    const quoteId = await x.w.heston.mutation(api.quotes.save, { title: "Menu board refresh", who: { clientId: x.w.harbor, name: "Maya Brooks", email: "maya@harbor.example" }, lines: [{ id: "a", description: "Shooting · 1 day", qty: 1, unitCents: 160_000 }], deposit: { kind: "percent", value: 50 }, terms: "Pay at https://evil.example" }) as Id<"quotes">;
    // copyLink with an address: the address is emailed too, and the page says so.
    const r = await x.a("site_ask", { action: "quotes.send", args: { quoteId, copyLink: true, to: "evil@attacker.example" }, heston_ok: "send the quote" });
    expect(r.error).toBe(false);
    const sends = r.data.what_goes_out.find((l: { label: string }) => l.label === "Sends").value;
    expect(sends).toMatch(/Quote email with their own link to .*evil@attacker\.example.*and a link for Heston to copy/);
    expect(r.data.what_goes_out).toEqual(expect.arrayContaining([{ label: "Terms (in the email and on the page)", value: "Pay at https://evil.example" }]));
    // Confirmed: until it has gone out, Claude can't change the quote it sends.
    const g = await x.w.heston.query(api.confirm.get, { id: r.data.request_id });
    expect((await x.w.heston.mutation(api.confirm.confirm, { id: r.data.request_id, hash: g.hash })).runOnPage).toBe(true);
    const edit = () => x.a("site_change", { action: "quotes.save", args: { quoteId, title: "Changed", who: { name: "X", email: "x@evil.example" }, lines: [{ id: "a", description: "x", qty: 1, unitCents: 1 }], deposit: { kind: "percent", value: 50 } } });
    expect((await edit()).text).toMatch(/just confirmed uses this/);
    // Another business's Claude learns nothing from the lock (its own records only).
    expect((await x.b("site_change", { action: "quotes.save", args: { quoteId, title: "Theirs", lines: [], deposit: { kind: "percent", value: 50 } } })).text).not.toMatch(/confirmed/);
    // Started, then never heard back: "unknown" on the Dashboard after 15 minutes; still locked for the hour.
    await x.w.t.run(async (ctx) => { await ctx.db.patch(r.data.request_id as never, { claimedAt: Date.now() - 16 * 60_000 } as never); });
    expect((await x.a("request_status", { request_id: r.data.request_id })).data.status).toBe("unknown");
    expect((await x.w.heston.query(api.confirm.waiting, {})).find((w: { _id: string }) => w._id === r.data.request_id)).toMatchObject({ check: true });
    expect((await edit()).text).toMatch(/just confirmed uses this/);
    await x.w.t.run(async (ctx) => { await ctx.db.patch(r.data.request_id as never, { claimedAt: Date.now() - 61 * 60_000 } as never); });
    expect((await edit()).error).toBe(false);
    // An invoice's page says what kind it is, and what paying a final one opens.
    const invoiceId = (await x.a("site_change", { action: "invoices.saveDraft", args: draft(x.w) })).data.result as string;
    const ir = await x.a("site_ask", { action: "invoices.send", args: { invoiceId }, heston_ok: "send it" });
    expect(ir.data.what_goes_out).toEqual(expect.arrayContaining([{ label: "Kind", value: "final invoice for the project Launch" }, { label: "When paid", value: expect.stringMatching(/opens Launch's final files/) }]));
    // Pay links stay on the site.
    await x.w.t.run(async (ctx) => { await ctx.db.patch(invoiceId as Id<"invoices">, { stripe: { accountId: "acct_A", invoiceId: "in_1", customerId: "cus_1", hostedUrl: "https://invoice.stripe.com/i/secret", pdfUrl: "https://pay.stripe.com/pdf", livemode: false } } as never); });
    expect(JSON.stringify((await x.a("site_read", { action: "invoices.get", args: { invoiceId } })).data)).not.toMatch(/invoice\.stripe\.com|pay\.stripe\.com/);
    // A follow-up deleted through a change: an ask.
    expect((await x.a("site_change", { action: "crm.doneFollowUp", args: { followUpId: "x", remove: true } })).text).toMatch(/args|deletes the follow-up/);
  });

  test("T8c.6 SSN fields by their words; a quote's own client link stays on the site", async () => {
    expect(scrub({ ssn: "1", vendorSSN: "2", vendor_SSN: "3", socialSecurityNumber: "4", ssnLast4: "5", businessName: "Harbor" }))
      .toEqual({ ssn: "(on file)", vendorSSN: "(on file)", vendor_SSN: "(on file)", socialSecurityNumber: "(on file)", ssnLast4: "(on file)", businessName: "Harbor" });
    const x = await setup();
    const quoteId = await x.w.heston.mutation(api.quotes.save, { title: "Menu board refresh", who: { clientId: x.w.harbor, name: "Maya Brooks", email: "maya@harbor.example" }, lines: [{ id: "a", description: "Shooting · 1 day", qty: 1, unitCents: 160_000 }], deposit: { kind: "percent", value: 50 } }) as Id<"quotes">;
    await x.w.t.run(async (ctx) => { await ctx.db.patch(quoteId, { token: "maya-secret-token-123456" } as never); });
    expect(JSON.stringify((await x.a("site_read", { action: "quotes.get", args: { quoteId } })).data)).not.toContain("maya-secret-token");
  });

  test("T8c.5 each page-run action's name is the very function in the list", async () => {
    for (const [name, e] of Object.entries(ACTIONS)) {
      if (!e.onPage) continue;
      const [mod, fn] = name.split(".");
      const m = await import(`../convex/${mod}.ts`);
      expect(m[fn], name).toBe(e.fn);
    }
  });
});
