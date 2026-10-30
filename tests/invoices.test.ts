// Phase 2 Part B, step 2: invoices (owner side). Stripe is a stand-in fetch that remembers what it was asked to make.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { signForTest } from "../convex/lib/stripeApi";
import { totals } from "../convex/invoices";

const api = anyApi;
const modules = import.meta.glob("../convex/**/*.ts");
const SECRET = "whsec_inv";

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = SECRET;
});
afterEach(() => vi.unstubAllGlobals());

type Call = { method: string; path: string; form: Record<string, string>; account: string | null };
function fakeStripe(opts: { totalOverride?: number } = {}) {
  const calls: Call[] = [];
  const invoices = new Map<string, { id: string; total: number; status: string; number?: string; customer: string }>();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const h = (init.headers ?? {}) as Record<string, string>;
    const path = url.replace("https://api.stripe.com/v1/", "");
    const form = Object.fromEntries(new URLSearchParams(String(init.body ?? "")));
    calls.push({ method: init.method ?? "GET", path, form, account: h["Stripe-Account"] ?? null });
    const ok = (o: unknown) => new Response(JSON.stringify(o));
    if (path === "customers") return ok({ id: "cus_1" });
    if (path === "tax_rates") return ok({ id: "txr_1" });
    if (path === "invoices") { const inv = { id: `in_${invoices.size + 1}`, total: 0, status: "draft", customer: form.customer }; invoices.set(inv.id, inv); return ok(inv); }
    if (path === "invoiceitems") { const inv = invoices.get(form.invoice)!; inv.total += Number(form.amount); return ok({ id: "ii" }); }
    const m = /^invoices\/(in_\d+)(\/(finalize|void))?$/.exec(path);
    if (m) {
      const inv = invoices.get(m[1])!;
      if (form.number) inv.number = form.number;
      if (m[3] === "finalize") inv.status = "open";
      if (m[3] === "void") inv.status = "void";
      const total = opts.totalOverride ?? inv.total;
      return ok({ ...inv, total, amount_paid: 0, amount_remaining: total, livemode: false, hosted_invoice_url: `https://invoice.stripe.com/${inv.id}`, invoice_pdf: `https://pay.stripe.com/${inv.id}.pdf` });
    }
    return new Response(JSON.stringify({ error: { message: `unexpected ${path}` } }), { status: 400 });
  }));
  return calls;
}

async function world() {
  const t = convexTest(schema, modules);
  const w = await t.run(async (ctx) => {
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const stripe = { accountId: "acct_A", status: "connected" as const, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, livemode: false, startedAt: 0, checkedAt: 0 };
    const A = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0, stripe });
    const B = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const heston = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    await ctx.db.insert("memberships", { businessId: A, email: "heston@wranglerproductions.com", userId: heston, role: "owner", createdAt: 0 });
    const boss = await ctx.db.insert("users", { email: "boss@other.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: B, email: "boss@other.example", userId: boss, role: "owner", createdAt: 1 });
    const maya = await ctx.db.insert("users", { email: "maya@harbor.example", name: "Maya", role: "client" });
    await ctx.db.insert("memberships", { businessId: A, email: "maya@harbor.example", userId: maya, role: "client", createdAt: 0 });
    const harbor = await ctx.db.insert("clients", { businessId: A, name: "Harbor Coffee", createdAt: 0 });
    await ctx.db.insert("clientPeople", { businessId: A, clientId: harbor, email: "maya@harbor.example", name: "Maya Brooks", role: "signer", createdAt: 0 });
    const p = await ctx.db.insert("projects", { businessId: A, name: "Launch", jobNumber: "26127", client: "Harbor Coffee", clientId: harbor, createdAt: 0 });
    await ctx.db.insert("deliveryFiles", { businessId: A, projectId: p, name: "Final.mov", kind: "dropbox", dropboxPath: "/Final.mov", createdAt: 0 });
    return { A, B, harbor, p, hestonSub: await sess(heston), bossSub: await sess(boss), mayaSub: await sess(maya) };
  });
  return { t, ...w, heston: t.withIdentity({ subject: w.hestonSub }), boss: t.withIdentity({ subject: w.bossSub }), maya: t.withIdentity({ subject: w.mayaSub }) };
}

const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
const draft = (w: Awaited<ReturnType<typeof world>>, extra: Record<string, unknown> = {}) => ({
  clientId: w.harbor, projectId: w.p, kind: "final", title: "Final invoice", billTo: { name: "Maya Brooks", email: "Maya@Harbor.example", company: "Harbor Coffee" },
  lines: [{ id: "a", description: "Final payment · 26127 Launch", qty: 1, unitCents: 450000 }, { id: "b", description: "Extra round", qty: 2, unitCents: 25000 }],
  dueDate: due, memo: "Thank you, Maya.", ...extra,
});

describe("totals", () => {
  test("subtotal, discount, then tax on what's left", () => {
    expect(totals({ lines: [{ qty: 2, unitCents: 1000 }, { qty: 1, unitCents: 500 }], discountCents: 500, taxPercent: 10 })).toEqual({ subtotal: 2500, discount: 500, tax: 200, total: 2200 });
    expect(totals({ lines: [{ qty: 1, unitCents: 100 }], discountCents: 900 })).toMatchObject({ discount: 100, total: 0 });
  });
});

describe("drafts and sending", () => {
  test("a draft lives only in the portal; Send makes it in the business's Stripe account with its number, then finalizes", async () => {
    const w = await world();
    const calls = fakeStripe();
    const id = await w.heston.mutation(api.invoices.saveDraft, draft(w));
    expect(calls).toHaveLength(0);
    let inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv).toMatchObject({ status: "draft", totalCents: 500000, number: null, billTo: { email: "maya@harbor.example" } });

    expect(await w.heston.action(api.invoices.send, { invoiceId: id })).toEqual({ number: "WRNGLR-0001" });
    expect(calls.every((c) => c.account === "acct_A")).toBe(true); // everything on the connected account
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST customers", "POST invoices", "POST invoiceitems", "POST invoiceitems", "POST invoices/in_1", "GET invoices/in_1", "POST invoices/in_1/finalize",
    ]);
    const create = calls[1].form;
    expect(create).toMatchObject({ collection_method: "send_invoice", auto_advance: "false", description: "Thank you, Maya.", "metadata[portal_invoice]": id });
    expect(calls[3].form).toMatchObject({ amount: "50000", description: "Extra round (2 × $250.00)" });
    expect(calls[4].form).toEqual({ number: "WRNGLR-0001" });
    expect(calls.some((c) => /\/send$/.test(c.path))).toBe(false); // Stripe's own email stays off
    inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv).toMatchObject({ status: "due", number: "WRNGLR-0001", stripe: { invoiceId: "in_1", hostedUrl: "https://invoice.stripe.com/in_1" } });
    expect(inv.history.map((h: { kind: string }) => h.kind)).toEqual(["created", "sent"]);

    // Sent invoices don't change, and can't be sent twice.
    await expect(w.heston.mutation(api.invoices.saveDraft, { invoiceId: id, ...draft(w) })).rejects.toThrow(/Only drafts/);
    await expect(w.heston.action(api.invoices.send, { invoiceId: id })).rejects.toThrow(/already/);
    // The next one counts on; the customer is reused.
    const id2 = await w.heston.mutation(api.invoices.saveDraft, draft(w, { kind: "other", title: "Extra shoot day" }));
    const calls2 = fakeStripe();
    expect(await w.heston.action(api.invoices.send, { invoiceId: id2 })).toEqual({ number: "WRNGLR-0002" });
    expect(calls2.some((c) => c.path === "customers")).toBe(false);
  });

  test("checks before sending: Stripe connected, a real total, a due date ahead; a failed send goes back to draft and keeps its number", async () => {
    const w = await world();
    fakeStripe();
    const small = await w.heston.mutation(api.invoices.saveDraft, draft(w, { lines: [{ id: "a", description: "Tiny", qty: 1, unitCents: 10 }] }));
    await expect(w.heston.action(api.invoices.send, { invoiceId: small })).rejects.toThrow(/at least \$0.50/);
    const past = await w.heston.mutation(api.invoices.saveDraft, draft(w, { dueDate: "2020-01-01" }));
    await expect(w.heston.action(api.invoices.send, { invoiceId: past })).rejects.toThrow(/due date has passed/);

    // Stripe's total disagrees: nothing is finalized; the draft keeps its number for the retry.
    const calls = fakeStripe({ totalOverride: 1 });
    const id = await w.heston.mutation(api.invoices.saveDraft, draft(w));
    await expect(w.heston.action(api.invoices.send, { invoiceId: id })).rejects.toThrow(/doesn't match/);
    expect(calls.some((c) => c.path.endsWith("/finalize"))).toBe(false);
    const back = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(back).toMatchObject({ status: "draft", number: "WRNGLR-0001" });
    expect(back.sendError).toMatch(/doesn't match/);

    await w.t.run(async (ctx) => { await ctx.db.patch(w.A, { stripe: undefined }); });
    await expect(w.heston.action(api.invoices.send, { invoiceId: id })).rejects.toThrow(/Connect Stripe first/);
  });

  test("void: only an unpaid sent invoice; a draft is deleted instead", async () => {
    const w = await world();
    fakeStripe();
    const id = await w.heston.mutation(api.invoices.saveDraft, draft(w));
    await expect(w.heston.action(api.invoices.voidInvoice, { invoiceId: id })).rejects.toThrow(/delete it instead/);
    await w.heston.action(api.invoices.send, { invoiceId: id });
    await w.heston.action(api.invoices.voidInvoice, { invoiceId: id });
    expect(await w.heston.query(api.invoices.get, { invoiceId: id })).toMatchObject({ status: "void" });
    const d = await w.heston.mutation(api.invoices.saveDraft, draft(w));
    await w.heston.mutation(api.invoices.deleteDraft, { invoiceId: d });
    expect(await w.heston.query(api.invoices.get, { invoiceId: d })).toBeNull();
  });

  test("only the owner, only their own business", async () => {
    const w = await world();
    fakeStripe();
    const id = await w.heston.mutation(api.invoices.saveDraft, draft(w));
    await expect(w.maya.query(api.invoices.list, {})).rejects.toThrow();
    await expect(w.maya.mutation(api.invoices.saveDraft, draft(w))).rejects.toThrow();
    expect(await w.boss.query(api.invoices.list, {})).toEqual([]);
    expect(await w.boss.query(api.invoices.get, { invoiceId: id })).toBeNull();
    await expect(w.boss.action(api.invoices.send, { invoiceId: id })).rejects.toThrow();
    await expect(w.boss.mutation(api.invoices.saveDraft, draft(w))).rejects.toThrow(); // Wrangler's client and project
  });
});

describe("Stripe's events", () => {
  test("partly paid, then paid in full: a paid final invoice opens the project's final files; another account's event is ignored", async () => {
    const w = await world();
    fakeStripe();
    const id = await w.heston.mutation(api.invoices.saveDraft, draft(w));
    await w.heston.action(api.invoices.send, { invoiceId: id });
    const post = async (evId: string, type: string, account: string, obj: Record<string, unknown>) => {
      const body = JSON.stringify({ id: evId, type, account, livemode: false, data: { object: obj } });
      return (await w.t.fetch("/stripe/connect", { method: "POST", body, headers: { "stripe-signature": await signForTest(body, SECRET) } })).status;
    };
    expect(await post("evt_a", "invoice.updated", "acct_A", { id: "in_1", status: "open", total: 500000, amount_paid: 100000, amount_remaining: 400000 })).toBe(200);
    expect(await w.heston.query(api.invoices.get, { invoiceId: id })).toMatchObject({ status: "partly_paid", amountPaidCents: 100000 });

    // Another business's account can't touch it.
    expect(await post("evt_b", "invoice.paid", "acct_OTHER", { id: "in_1", status: "paid", total: 500000, amount_paid: 500000, amount_remaining: 0 })).toBe(200);
    expect((await w.heston.query(api.invoices.get, { invoiceId: id })).status).toBe("partly_paid");

    expect(await post("evt_c", "invoice.paid", "acct_A", { id: "in_1", status: "paid", total: 500000, amount_paid: 500000, amount_remaining: 0 })).toBe(200);
    const inv = await w.heston.query(api.invoices.get, { invoiceId: id });
    expect(inv).toMatchObject({ status: "paid", amountRemainingCents: 0 });
    expect(inv.history.map((h: { kind: string }) => h.kind)).toEqual(["created", "sent", "part_paid", "paid", "delivery_opened"]);
    const project = await w.t.run(async (ctx) => ctx.db.get(w.p));
    expect(project?.deliveryUnlockedAt).toBeTruthy();

    expect(await post("evt_d", "invoice.payment_failed", "acct_A", { id: "in_1", status: "paid", total: 500000, amount_paid: 500000, amount_remaining: 0 })).toBe(200);
  });
});
