// Nov 21 (Heston: "Fix the older issues", approved 09:13): three older money issues from the Create-without-emailing
// review. P-a: a send whose reply from Stripe was lost doesn't pretend nothing went out (no second invoice).
// P-b: an invoice stuck "sending" can be finished from the site (Finish sending), the way it was started.
// P-c: an invoice paid the moment it's finalized (a credit balance) opens the final files and moves the card, once.
// Stripe is the stand-in from payHarness (test mode); `breakStripe` makes chosen calls fail on the way there or back.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { due, fakeStripe, world } from "./payHarness";

const api = anyApi;
const internal = anyApi;
const MIN = 60_000;

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
const draft = (w: W, kind: "final" | "deposit" = "final") => w.heston.mutation(api.invoices.saveDraft, {
  clientId: w.harbor, projectId: w.p, kind, title: "Final invoice", billTo: { name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee" },
  lines: [{ id: "a", description: "Final payment", qty: 1, unitCents: 450000 }], dueDate: due,
}) as Promise<Id<"invoices">>;
const settle = (w: W) => w.t.finishAllScheduledFunctions(vi.runAllTimers);
const doc = (w: W, id: Id<"invoices">) => w.t.run((ctx) => ctx.db.get(id));
const made = (calls: { method: string; path: string }[]) => calls.filter((c) => c.method === "POST" && c.path === "invoices").length;

/** Wrap the stand-in so Stripe tells the truth about in_1 (review 2 #6: the plain stand-in always says "open").
 *  It's a draft once made, open once a finalize reaches it, gone once deleted. `rule` can make a call fail on the way
 *  there ("there": Stripe never sees it), lose its reply ("back": Stripe acted), or be refused ("refuse"), and can move
 *  Stripe's state (as if something happened in between). */
type St = { in_1: "none" | "draft" | "open" | "void" | "uncollectible" | "gone"; total?: number; forceTotal?: number };
function breakStripe(rule: (method: string, path: string, st: St) => "there" | "back" | "refuse" | null, st: St = { in_1: "none" }) {
  const inner = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const path = String(url).replace("https://api.stripe.com/v1/", "").split("?")[0];
    const m = init.method ?? "GET";
    const r = rule(m, path, st);
    if (r === "there") throw new TypeError("fetch failed");
    if (r === "refuse") return new Response(JSON.stringify({ error: { message: "This invoice can't be deleted" } }), { status: 400 });
    let res = await inner(url, init);
    if (path === "invoices" && m === "POST") { st.in_1 = "draft"; st.total = 0; } // a new draft starts at nothing
    if (path === "invoiceitems" && m === "POST") st.total = (st.total ?? 0) + Number(new URLSearchParams(String(init.body ?? "")).get("amount"));
    if (path === "invoices/in_1/finalize") st.in_1 = "open";
    if (path === "invoices/in_1" && m === "DELETE") st.in_1 = "gone";
    if (path === "invoices/in_1" && m === "GET") {
      if (st.in_1 === "gone") res = new Response(JSON.stringify({ error: { message: "No such invoice" } }), { status: 404 });
      else { const j = await res.json(); res = new Response(JSON.stringify({ ...j, status: st.in_1, total: st.forceTotal ?? (st.total || j.total) })); }
    } else if (path === "invoices/in_1/finalize") {
      const j = await res.json();
      res = new Response(JSON.stringify({ ...j, total: st.forceTotal ?? (st.total || j.total) }));
    }
    if (r === "back") throw new TypeError("fetch failed");
    return res;
  }));
  return st;
}
const keyOf = (path: string) => vi.mocked(globalThis.fetch).mock.calls.filter((c) => String(c[0]).endsWith(path)).map((c) => ((c[1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"]);
const finalizeLost = (m: string, p: string) => (m === "POST" && p === "invoices/in_1/finalize" ? "back" : null);

describe("A send that stopped partway", () => {
  test("R1 (P-a): Stripe finalized it but the reply was lost: the portal asks Stripe and records it sent; one Stripe invoice", async () => {
    vi.useFakeTimers();
    const w = await world();
    const calls = fakeStripe();
    breakStripe(finalizeLost);
    const id = await draft(w);
    expect(await w.heston.action(api.invoices.send, { invoiceId: id })).toEqual({ number: "WRNGLR-0001" });
    expect(calls.find((c) => c.path === "invoices/in_1/finalize")!).toBeTruthy();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false); // the live invoice wasn't "cleaned up"
    expect(made(calls)).toBe(1);
    const i = (await doc(w, id))!;
    expect(i).toMatchObject({ status: "open", stripe: expect.objectContaining({ invoiceId: "in_1" }), sentAt: expect.any(Number) });
    await settle(w);
    expect((await w.t.run(async (ctx) => (await ctx.db.query("emailLog").collect()).map((r) => r.key)))).toContain(`invoice-sent:${id}`);
  });

  test("R1b (P-a): finalize carries this attempt's own key (Stripe answers a repeat of it without acting again)", async () => {
    vi.useFakeTimers();
    const w = await world();
    const calls = fakeStripe();
    const id = await draft(w);
    await w.heston.action(api.invoices.send, { invoiceId: id });
    const fin = calls.find((c) => c.path === "invoices/in_1/finalize")!;
    expect(fin).toBeTruthy();
    const headers = (vi.mocked(globalThis.fetch).mock.calls.find((c) => String(c[0]).endsWith("invoices/in_1/finalize"))![1] as RequestInit).headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toMatch(new RegExp(`^wp-fin-${id}-a1$`));
  });

  test("R2 (P-a, P-b): Stripe unreachable for the check too: it stays sending; Finish sending after 5 minutes picks it up, no second invoice", async () => {
    vi.useFakeTimers();
    const w = await world();
    const calls = fakeStripe();
    let down = true;
    breakStripe((m, p) => (m === "POST" && p === "invoices/in_1/finalize" ? "back" : down && m === "GET" && p === "invoices/in_1" && calls.some((c) => c.path === "invoices/in_1/finalize") ? "there" : null));
    const id = await draft(w);
    await expect(w.heston.action(api.invoices.send, { invoiceId: id })).rejects.toThrow(/may have gone through.*15 minutes.*Finish sending/);
    expect((await doc(w, id))!).toMatchObject({ status: "sending", pending: expect.objectContaining({ draftId: "in_1", mode: "email" }) });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    const got = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(got).toMatchObject({ pendingMode: "email", sendError: expect.stringMatching(/Finish sending/) });
    // Too soon: refused, nothing touched.
    await expect(w.heston.action(api.invoices.finishSend, { invoiceId: id })).rejects.toThrow(/already being sent/);
    // Still down after 5 minutes: it stops again rather than starting a second invoice blind.
    vi.setSystemTime(Date.now() + 16 * MIN);
    await expect(w.heston.action(api.invoices.finishSend, { invoiceId: id })).rejects.toThrow(/may have gone through/);
    expect(made(calls)).toBe(1);
    expect((await doc(w, id))!.status).toBe("sending");
    // Stripe answers again: Finish sending records the one it already made.
    down = false;
    vi.setSystemTime(Date.now() + 16 * MIN);
    expect(await w.heston.action(api.invoices.finishSend, { invoiceId: id })).toEqual({ number: "WRNGLR-0001", emailed: true });
    expect(made(calls)).toBe(1);
    expect((await doc(w, id))!).toMatchObject({ status: "open", sentAt: expect.any(Number) });
  });

  test("R3: Stripe still holds a plain draft: it's deleted and the invoice goes back to draft, as before", async () => {
    vi.useFakeTimers();
    const w = await world();
    const calls = fakeStripe();
    breakStripe((m, p) => (m === "POST" && p === "invoices/in_1/finalize" ? "there" : null)); // never reached Stripe
    const id = await draft(w);
    await expect(w.heston.action(api.invoices.send, { invoiceId: id })).rejects.toThrow(/Nothing was sent/);
    expect(calls.some((c) => c.method === "DELETE" && c.path === "invoices/in_1")).toBe(true);
    expect((await doc(w, id))!).toMatchObject({ status: "draft", sendError: expect.stringMatching(/Nothing was sent/) });
  });

  test("R4 (P-b): Finish sending on one being made without emailing carries on without emailing", async () => {
    vi.useFakeTimers();
    const w = await world();
    const calls = fakeStripe();
    let down = true;
    breakStripe((m, p) => (m === "POST" && p === "invoices/in_1/finalize" ? "back" : down && m === "GET" && p === "invoices/in_1" && calls.some((c) => c.path === "invoices/in_1/finalize") ? "there" : null));
    const id = await draft(w);
    await expect(w.heston.action(api.invoices.create, { invoiceId: id })).rejects.toThrow(/may have gone through/);
    expect((await doc(w, id))!.pending).toMatchObject({ mode: "quiet" });
    down = false;
    vi.setSystemTime(Date.now() + 16 * MIN);
    expect(await w.heston.action(api.invoices.finishSend, { invoiceId: id })).toEqual({ number: "WRNGLR-0001", emailed: false });
    expect((await doc(w, id))!).toMatchObject({ status: "open", quiet: true });
    await settle(w);
    expect(calls.filter((c) => c.path.startsWith("https://api.resend.com")).length).toBe(0);
    expect(await w.t.run(async (ctx) => await ctx.db.query("inboxItems").collect())).toEqual([]);
  });

  test("R5: Finish sending is only for the business's own payments side, and only for a send under way", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const id = await draft(w);
    await expect(w.heston.action(api.invoices.finishSend, { invoiceId: id })).rejects.toThrow(/isn't partway through sending/);
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { status: "sending", number: "WRNGLR-0001", pending: { draftId: "in_1", mode: "email" }, updatedAt: 0 }); });
    await expect(w.boss.action(api.invoices.finishSend, { invoiceId: id })).rejects.toThrow(/isn't here/);
    await expect(w.maya.action(api.invoices.finishSend, { invoiceId: id })).rejects.toThrow(/Not allowed/);
    await expect(w.t.action(api.invoices.finishSend, { invoiceId: id })).rejects.toThrow();
    expect((await doc(w, id))!.status).toBe("sending");
  });
});

describe("Review 2 (Nov 21): what Stripe holds, for certain", () => {
  test("R7: the cleanup delete is refused because the finalize landed meanwhile: recorded as sent, one Stripe invoice", async () => {
    vi.useFakeTimers();
    const w = await world();
    const calls = fakeStripe();
    // The finalize's reply is lost and Stripe hasn't applied it when first asked; it lands just before the delete.
    breakStripe((m, p, st) => {
      if (m === "POST" && p === "invoices/in_1/finalize") return "there";
      if (m === "DELETE" && p === "invoices/in_1") { st.in_1 = "open"; return "refuse"; }
      return null;
    });
    const id = await draft(w);
    expect(await w.heston.action(api.invoices.send, { invoiceId: id })).toEqual({ number: "WRNGLR-0001" });
    expect(made(calls)).toBe(1);
    expect((await doc(w, id))!).toMatchObject({ status: "open", stripe: expect.objectContaining({ invoiceId: "in_1" }) });
  });

  test("R7b: the delete is refused and Stripe still says draft: it stays sending (nothing forgotten); Finish sending rebuilds with new keys", async () => {
    vi.useFakeTimers();
    const w = await world();
    const calls = fakeStripe();
    let refuse = true;
    breakStripe((m, p) => (m === "POST" && p === "invoices/in_1/finalize" && refuse ? "there" : m === "DELETE" && refuse ? "refuse" : null));
    const id = await draft(w);
    await expect(w.heston.action(api.invoices.send, { invoiceId: id })).rejects.toThrow(/may have gone through/);
    expect((await doc(w, id))!).toMatchObject({ status: "sending", pending: expect.objectContaining({ draftId: "in_1" }) });
    refuse = false;
    vi.setSystemTime(Date.now() + 16 * MIN);
    expect(await w.heston.action(api.invoices.finishSend, { invoiceId: id })).toEqual({ number: "WRNGLR-0001", emailed: true });
    expect(vi.mocked(globalThis.fetch).mock.calls.filter((c) => (c[1] as RequestInit).method === "DELETE")).toHaveLength(2); // the refused one, then the real one
    expect(calls.filter((c) => c.method === "DELETE" && c.path === "invoices/in_1")).toHaveLength(1); // only the real one reached Stripe
    expect(keyOf("v1/invoices")).toEqual([`wp-inv-${id}-a1`, `wp-inv-${id}-a2`]); // the rebuild used this attempt's keys
    expect((await doc(w, id))!.status).toBe("open");
  });

  test("R8: Stripe says the invoice is gone (404) after a failed send: back to draft, nothing was sent", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    breakStripe((m, p, st) => {
      if (m === "POST" && p === "invoices/in_1/finalize") return "there";
      if (m === "GET" && p === "invoices/in_1" && st.in_1 === "draft" && vi.mocked(globalThis.fetch).mock.calls.some((c) => String(c[0]).endsWith("/finalize"))) st.in_1 = "gone";
      return null;
    });
    const id = await draft(w);
    await expect(w.heston.action(api.invoices.send, { invoiceId: id })).rejects.toThrow(/Nothing was sent/);
    expect((await doc(w, id))!).toMatchObject({ status: "draft" });
  });

  const stuckOn = async (w: W, id: Id<"invoices">) => {
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { status: "sending", number: "WRNGLR-0001", sendAttempt: 1, pending: { customerId: "cus_1", draftId: "in_1", mode: "email" }, updatedAt: 0 }); });
  };

  test("R9: picking up a stuck send: void in Stripe starts again; uncollectible is recorded as uncollectible; a wrong total isn't recorded", async () => {
    vi.useFakeTimers();
    // Void: rebuilt as a new invoice with this attempt's keys.
    let w = await world();
    let calls = fakeStripe();
    let id = await draft(w);
    await stuckOn(w, id);
    breakStripe(() => null, { in_1: "void" });
    expect(await w.heston.action(api.invoices.finishSend, { invoiceId: id })).toEqual({ number: "WRNGLR-0001", emailed: true });
    expect(made(calls)).toBe(1);
    expect(keyOf("v1/invoices")).toEqual([`wp-inv-${id}-a2`]);
    // Uncollectible (marked so in Stripe while the portal was stuck): recorded as it is, not as open.
    w = await world();
    fakeStripe();
    id = await draft(w);
    await stuckOn(w, id);
    breakStripe(() => null, { in_1: "uncollectible" });
    await w.heston.action(api.invoices.finishSend, { invoiceId: id });
    expect((await doc(w, id))!.status).toBe("uncollectible");
    // Stripe holds it for a different amount: it stays sending, with the reason, and nothing is recorded.
    w = await world();
    calls = fakeStripe();
    id = await draft(w);
    await stuckOn(w, id);
    breakStripe(() => null, { in_1: "open", forceTotal: 100 });
    await expect(w.heston.action(api.invoices.finishSend, { invoiceId: id })).rejects.toThrow(/for \$1\.00, not the portal's \$4,?500\.00|for \$1\.00, not the portal's \$4500\.00/);
    expect((await doc(w, id))!).toMatchObject({ status: "sending", sendError: expect.stringMatching(/Check it in Stripe/) });
    expect(made(calls)).toBe(0);
  });

  test("R10: a stale attempt's writes are ignored, and a send is recorded once (the paid steps don't run twice)", async () => {
    vi.useFakeTimers();
    const w = await world();
    fakeStripe();
    const id = await draft(w);
    await w.t.run(async (ctx) => { await ctx.db.patch(id, { status: "sending", number: "WRNGLR-0001", sendAttempt: 2, pending: { draftId: "in_2", mode: "email" }, updatedAt: Date.now() }); });
    await w.t.mutation(internal.invoices.recordSendFailed, { invoiceId: id, attempt: 1, message: "old" });
    await w.t.mutation(internal.invoices.recordPending, { invoiceId: id, attempt: 1, pending: { draftId: "in_old" } });
    expect((await doc(w, id))!).toMatchObject({ status: "sending", pending: expect.objectContaining({ draftId: "in_2" }) });
    const paid = { accountId: "acct_A", customerId: "cus_1", invoice: { id: "in_2", status: "paid", number: "WRNGLR-0001", total: 450000, amount_paid: 450000, amount_remaining: 0 } };
    await w.t.mutation(internal.invoices.recordSent, { invoiceId: id, attempt: 2, by: "Heston", email: true, stripe: paid });
    await w.t.mutation(internal.invoices.recordSent, { invoiceId: id, attempt: 2, by: "Heston", email: true, stripe: paid });
    const kinds = (await doc(w, id))!.history.map((h) => h.kind);
    expect(kinds.filter((k) => k === "paid")).toHaveLength(1);
    expect(kinds.filter((k) => k === "sent")).toHaveLength(1);
    // A different Stripe invoice turning up afterwards is flagged, never written over this one.
    await w.t.mutation(internal.invoices.recordSent, { invoiceId: id, attempt: 1, by: "Heston", email: true, stripe: { ...paid, invoice: { ...paid.invoice, id: "in_9", number: "X-9" } } });
    const i = (await doc(w, id))!;
    expect(i.stripe!.invoiceId).toBe("in_2");
    expect(i.sendError).toMatch(/Stripe also holds X-9/);
  });
});

describe("Paid the moment it's finalized (a credit balance covered it)", () => {
  test("R6 (P-c): a final invoice paid at send opens the final files and moves the card to Paid, once", async () => {
    vi.useFakeTimers();
    const w = await world();
    const deal = await w.t.run((ctx) => ctx.db.insert("deals", { businessId: w.A, title: "Harbor launch film", stage: "delivered", source: "hand", projectId: w.p, clientId: w.harbor, history: [], createdAt: 0, updatedAt: 0 } as never)) as Id<"deals">;
    const calls = fakeStripe();
    // Stripe answers the finalize as already paid.
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const res = await inner(url, init);
      if (!String(url).endsWith("invoices/in_1/finalize")) return res;
      const j = await res.json();
      return new Response(JSON.stringify({ ...j, status: "paid", amount_paid: j.total, amount_remaining: 0, status_transitions: { paid_at: Math.floor(Date.now() / 1000) } }));
    }));
    const id = await draft(w);
    await w.heston.action(api.invoices.send, { invoiceId: id });
    const i = (await doc(w, id))!;
    expect(i).toMatchObject({ status: "paid", paidAt: expect.any(Number) });
    const kinds = i.history.map((h) => h.kind);
    expect(kinds.filter((k) => k === "paid")).toHaveLength(1);
    expect(kinds.filter((k) => k === "delivery_waiting" || k === "delivery_opened")).toHaveLength(1);
    expect((await w.t.run((ctx) => ctx.db.get(deal)))!.stage).toBe("paid");
    // Stripe's own update arriving later changes nothing more.
    await w.t.mutation(internal.invoices.applyStripeInvoice, { accountId: "acct_A", invoice: { id: "in_1", status: "paid", total: 450000, amount_paid: 450000, amount_remaining: 0, number: "WRNGLR-0001" }, eventType: "invoice.paid" });
    const after = (await doc(w, id))!.history.map((h) => h.kind);
    expect(after).toEqual(kinds);
    expect(calls.length).toBeGreaterThan(0);
  });

  test("R6b: paid later by Stripe's update (the usual way) still does the same, once", async () => {
    vi.useFakeTimers();
    const w = await world();
    const deal = await w.t.run((ctx) => ctx.db.insert("deals", { businessId: w.A, title: "Harbor launch film", stage: "delivered", source: "hand", projectId: w.p, clientId: w.harbor, history: [], createdAt: 0, updatedAt: 0 } as never)) as Id<"deals">;
    fakeStripe();
    const id = await draft(w);
    await w.heston.action(api.invoices.send, { invoiceId: id });
    const paid = { id: "in_1", status: "paid", total: 450000, amount_paid: 450000, amount_remaining: 0, number: "WRNGLR-0001" };
    await w.t.mutation(internal.invoices.applyStripeInvoice, { accountId: "acct_A", invoice: paid, eventType: "invoice.paid" });
    await w.t.mutation(internal.invoices.applyStripeInvoice, { accountId: "acct_A", invoice: paid, eventType: "invoice.paid" });
    const kinds = (await doc(w, id))!.history.map((h) => h.kind);
    expect(kinds.filter((k) => k === "paid")).toHaveLength(1);
    expect(kinds.filter((k) => k === "delivery_waiting" || k === "delivery_opened")).toHaveLength(1);
    expect((await w.t.run((ctx) => ctx.db.get(deal)))!.stage).toBe("paid");
  });
});
