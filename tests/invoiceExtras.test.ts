// Phase 2 Part B, step 4c: the deposit drafted from a signed contract, and refunds and disputes from Stripe's events.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { signForTest } from "../convex/lib/stripeApi";
import { fakeStripe, sent, world, refreshNow } from "./payHarness";

const api = anyApi;
const internal = anyApi;
const SECRET = "whsec_pay";

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = SECRET;
  process.env.EMAIL_ONLY_TO = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("a signed contract's deposit", () => {
  test("becomes one portal draft (for the owner to send), billed to the signer's client; never sent", async () => {
    const w = await world();
    const doc = await w.t.run(async (ctx) => ctx.db.insert("wsDocuments", { businessId: w.A, number: 18, title: "Service Agreement", status: "completed", currentVersion: 1, createdAt: 0, updatedAt: 0 }));
    expect(await w.t.query(internal.invoices.connectedFor, { businessId: w.A })).toBe(true);
    const args = { documentId: doc, versionNumber: 1, label: "WS-00018", docTitle: "Service Agreement", amountCents: 300000, description: "Deposit (25%)", billTo: { name: "Maya Brooks", email: "Maya@Harbor.example" }, dueDays: 3 };
    const a = await w.t.mutation(internal.invoices.draftFromContract, args);
    const b = await w.t.mutation(internal.invoices.draftFromContract, args);
    expect(a.made).toBe(true);
    expect(b).toEqual({ invoiceId: a.invoiceId, made: false });
    const inv = await w.heston.query(api.invoices.get, { invoiceId: a.invoiceId });
    expect(inv).toMatchObject({ status: "draft", kind: "deposit", title: "Deposit (25%) · WS-00018", totalCents: 300000, clientId: w.harbor, billTo: { email: "maya@harbor.example" },
      lines: [{ description: "Deposit (25%) · Service Agreement", qty: 1, unitCents: 300000 }] });
    expect(inv.history[0]).toMatchObject({ kind: "created", detail: "from WS-00018 (signed)" });
    // A business without Stripe connected keeps Sign's old path.
    await w.t.run(async (ctx) => { await ctx.db.patch(w.A, { stripe: undefined }); });
    expect(await w.t.query(internal.invoices.connectedFor, { businessId: w.A })).toBe(false);
  });
});

describe("the final invoice from a signed contract", () => {
  test("Project › Invoices offers the balance of each signed builder contract; Draft makes one draft, billed to the signer", async () => {
    const w = await world();
    const page = { type: "doc", content: [
      { type: "items", attrs: { rows: [{ qty: 1, rate: 9000 }, { qty: 2, rate: 1500 }] } },
      { type: "payment", attrs: { depositPct: 25, invoiceDeposit: true } },
    ] };
    const doc = await w.t.run(async (ctx) => {
      const d = await ctx.db.insert("wsDocuments", { businessId: w.A, number: 18, title: "Service Agreement", status: "completed", currentVersion: 1, sentVersion: 1, sentAt: 5, createdAt: 0, updatedAt: 0 });
      const b = await ctx.db.insert("wsBuilds", { businessId: w.A, title: "Service Agreement", blocks: page, fields: {}, style: {}, signers: [], documentId: d, createdAt: 0, updatedAt: 0 });
      await ctx.db.patch(d, { buildId: b });
      await ctx.db.insert("wsSignings", { businessId: w.A, documentId: d, versionNumber: 1, signerKey: "client", name: "Maya Brooks", email: "maya@harbor.example", order: 0, token: "t1", status: "signed" });
      // A contract still out for signing isn't offered.
      const out = await ctx.db.insert("wsDocuments", { businessId: w.A, number: 19, title: "Change order", status: "sent", currentVersion: 1, sentVersion: 1, sentAt: 6, createdAt: 0, updatedAt: 0 });
      await ctx.db.insert("wsSignings", { businessId: w.A, documentId: out, versionNumber: 1, signerKey: "client", name: "Maya Brooks", email: "maya@harbor.example", order: 0, token: "t2", status: "sent" });
      return d;
    });
    const opts = await w.heston.query(api.invoices.finalOptions, { projectId: w.p });
    expect(opts).toEqual([expect.objectContaining({ documentId: doc, label: "WS-00018", totalCents: 1200000, depositCents: 300000, balanceCents: 900000, invoiceId: null })]);
    const id = await w.heston.mutation(api.invoices.draftFinal, { projectId: w.p, documentId: doc });
    expect(await w.heston.mutation(api.invoices.draftFinal, { projectId: w.p, documentId: doc })).toBe(id); // one per contract
    const inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv).toMatchObject({ status: "draft", kind: "final", title: "Final invoice · WS-00018", totalCents: 900000, clientId: w.harbor, projectId: w.p,
      billTo: { name: "Maya Brooks", email: "maya@harbor.example" }, memo: "Contract total $12,000.00, less the $3,000.00 deposit (WS-00018).",
      lines: [{ description: "Balance · Service Agreement", qty: 1, unitCents: 900000 }] });
    expect((await w.heston.query(api.invoices.finalOptions, { projectId: w.p }))[0].invoiceId).toBe(id);
    // Another business's owner gets nothing and can't draft it.
    expect(await w.boss.query(api.invoices.finalOptions, { projectId: w.p })).toEqual([]);
    await expect(w.boss.mutation(api.invoices.draftFinal, { projectId: w.p, documentId: doc })).rejects.toThrow();
    // A client can't.
    await expect(w.maya.mutation(api.invoices.draftFinal, { projectId: w.p, documentId: doc })).rejects.toThrow();
  });
});

describe("refunds and disputes", () => {
  test("recorded on the invoice the payment belongs to; another account's event changes nothing", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const { id, token } = await sent(w);
    const paid = { status: "paid", amount_paid: 450000, status_transitions: { paid_at: Math.floor(Date.now() / 1000) }, payment: { type: "payment_intent", payment_intent: { id: "pi_1", status: "succeeded", amount: 450000, payment_method: { type: "card", card: { brand: "visa", last4: "4242" } } } } };
    fakeStripe({ payments: [paid], invoiceStatus: "paid" });
    await refreshNow(w, token);
    await w.t.finishAllScheduledFunctions(vi.runAllTimers);
    const post = async (evId: string, type: string, account: string, obj: Record<string, unknown>) => {
      const body = JSON.stringify({ id: evId, type, account, livemode: false, data: { object: obj } });
      return (await w.t.fetch("/stripe/connect", { method: "POST", body, headers: { "stripe-signature": await signForTest(body, SECRET) } })).status;
    };
    expect(await post("evt_r0", "charge.refunded", "acct_OTHER", { id: "ch_1", payment_intent: "pi_1", amount_refunded: 50000 })).toBe(200);
    expect((await w.heston.query(api.invoices.get, { invoiceId: id })).refundedCents).toBe(0);
    expect(await post("evt_r1", "charge.refunded", "acct_A", { id: "ch_1", payment_intent: "pi_1", amount_refunded: 50000 })).toBe(200);
    expect(await post("evt_d1", "charge.dispute.created", "acct_A", { id: "dp_1", payment_intent: "pi_1", amount: 400000, status: "needs_response", reason: "fraudulent" })).toBe(200);
    const inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv.refundedCents).toBe(50000);
    expect(inv.disputed).toMatchObject({ status: "needs_response", cents: 400000, reason: "fraudulent" });
    expect(inv.history.slice(-2).map((h: { kind: string; detail: string }) => `${h.kind}: ${h.detail}`)).toEqual(["refunded: $500.00 refunded in Stripe", "disputed: $4,000.00 disputed (fraudulent). Respond in Stripe."]);
  });
});

void (null as unknown as Id<"invoices">);
