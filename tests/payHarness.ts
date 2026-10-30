// Shared by the payments tests (steps 3 and 4): a business connected to Stripe, Harbor Coffee with Maya and Jo, a
// client of another client (Sam), another business's owner, a stand-in Stripe, and a sent invoice.
import { vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const api = anyApi;
const modules = import.meta.glob("../convex/**/*.ts");

export type Call = { method: string; path: string; query: string; account: string | null };
export function fakeStripe(opts: { payments?: unknown[]; invoiceStatus?: string } = {}) {
  const calls: Call[] = [];
  let total = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const h = (init.headers ?? {}) as Record<string, string>;
    const [path, query = ""] = url.replace("https://api.stripe.com/v1/", "").split("?");
    const form = Object.fromEntries(new URLSearchParams(String(init.body ?? "")));
    calls.push({ method: init.method ?? "GET", path, query: decodeURIComponent(query), account: h["Stripe-Account"] ?? null });
    const ok = (o: unknown) => new Response(JSON.stringify(o));
    if (path === "customers") return ok({ id: "cus_1" });
    if (path === "accounts/acct_A") return ok({ id: "acct_A", capabilities: { card_payments: "active" } });
    if (path === "invoices") return ok({ id: "in_1", status: "draft" });
    if (path === "invoiceitems") { total += Number(form.amount); return ok({ id: "ii" }); }
    if (path === "invoice_payments") return ok({ data: opts.payments ?? [] });
    if (/^invoices\/in_1/.test(path)) {
      const status = path.endsWith("/finalize") ? "open" : opts.invoiceStatus ?? "open";
      if (!total) total = 450000; // a fresh stand-in (after Send) answers for the invoice made earlier
      return ok({ id: "in_1", status, number: "WRNGLR-0001", total, amount_paid: status === "paid" ? total : 0, amount_remaining: status === "paid" ? 0 : total, livemode: false,
        hosted_invoice_url: "https://invoice.stripe.com/i/in_1", invoice_pdf: "https://pay.stripe.com/in_1.pdf",
        ...(query.includes("confirmation_secret") ? { confirmation_secret: { client_secret: "pi_1_secret_abc", type: "payment_intent" } } : {}) });
    }
    return new Response(JSON.stringify({ error: { message: `unexpected ${path}` } }), { status: 400 });
  }));
  return calls;
}

export async function world() {
  const t = convexTest(schema, modules);
  const w = await t.run(async (ctx) => {
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const stripe = { accountId: "acct_A", status: "connected" as const, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, livemode: false, startedAt: 0, checkedAt: 0 };
    const A = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", legalName: "Hill Creative LLC", replyTo: "heston@wranglerproductions.com", createdAt: 0, stripe });
    const B = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const heston = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    await ctx.db.insert("memberships", { businessId: A, email: "heston@wranglerproductions.com", userId: heston, role: "owner", createdAt: 0 });
    const boss = await ctx.db.insert("users", { email: "boss@other.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: B, email: "boss@other.example", userId: boss, role: "owner", createdAt: 1 });
    const maya = await ctx.db.insert("users", { email: "maya@harbor.example", name: "Maya Brooks", role: "client" });
    await ctx.db.insert("memberships", { businessId: A, email: "maya@harbor.example", userId: maya, role: "client", createdAt: 0 });
    await ctx.db.insert("invites", { businessId: A, email: "maya@harbor.example", createdAt: 0, acceptedAt: 0, userId: maya });
    const jo = await ctx.db.insert("users", { email: "jo@harbor.example", name: "Jo", role: "client" });
    await ctx.db.insert("memberships", { businessId: A, email: "jo@harbor.example", userId: jo, role: "client", createdAt: 0 });
    await ctx.db.insert("invites", { businessId: A, email: "jo@harbor.example", createdAt: 0, acceptedAt: 0, userId: jo });
    const sam = await ctx.db.insert("users", { email: "sam@elsewhere.example", name: "Sam", role: "client" });
    await ctx.db.insert("memberships", { businessId: A, email: "sam@elsewhere.example", userId: sam, role: "client", createdAt: 0 });
    await ctx.db.insert("invites", { businessId: A, email: "sam@elsewhere.example", createdAt: 0, acceptedAt: 0, userId: sam });
    const harbor = await ctx.db.insert("clients", { businessId: A, name: "Harbor Coffee", createdAt: 0 });
    await ctx.db.insert("clientPeople", { businessId: A, clientId: harbor, email: "maya@harbor.example", name: "Maya Brooks", role: "signer", createdAt: 0 });
    await ctx.db.insert("clientPeople", { businessId: A, clientId: harbor, email: "jo@harbor.example", name: "Jo", role: "contact", createdAt: 0 });
    const p = await ctx.db.insert("projects", { businessId: A, name: "Launch", jobNumber: "26127", client: "Harbor Coffee", clientId: harbor, createdAt: 0 });
    return { A, harbor, p, hestonSub: await sess(heston), bossSub: await sess(boss), mayaSub: await sess(maya), joSub: await sess(jo), samSub: await sess(sam) };
  });
  const as = (sub: string) => t.withIdentity({ subject: sub });
  return { t, ...w, heston: as(w.hestonSub), boss: as(w.bossSub), maya: as(w.mayaSub), jo: as(w.joSub), sam: as(w.samSub) };
}

export const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
export async function sent(w: Awaited<ReturnType<typeof world>>) {
  const id = await w.heston.mutation(api.invoices.saveDraft, {
    clientId: w.harbor, projectId: w.p, kind: "final", title: "Final invoice", billTo: { name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee" },
    lines: [{ id: "a", description: "Final payment", qty: 1, unitCents: 450000 }], dueDate: due, memo: "Thank you, Maya.",
  });
  await w.heston.action(api.invoices.send, { invoiceId: id });
  const token = await w.t.run(async (ctx) => (await ctx.db.get(id as Id<"invoices">))!.payToken!);
  return { id: id as Id<"invoices">, token };
}

