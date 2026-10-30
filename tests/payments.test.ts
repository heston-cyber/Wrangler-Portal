// Phase 2 Part B, step 1: Settings › Payments (Stripe Connect). Stripe is a stand-in fetch here; the real platform
// key and webhook secret are pasted into Convex by Heston.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { signForTest, stripeSignatureOk, formOf, accountState } from "../convex/lib/stripeApi";

const api = anyApi;
const modules = import.meta.glob("../convex/**/*.ts");
const SECRET = "whsec_test_123";

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.STRIPE_PLATFORM_KEY = "sk_test_platform";
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = SECRET;
});
afterEach(() => vi.unstubAllGlobals());

type Call = { method: string; url: string; body: string; account: string | null; idem: string | null };
function fakeStripe(account: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const h = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method: init.method ?? "GET", url, body: String(init.body ?? ""), account: h["Stripe-Account"] ?? null, idem: h["Idempotency-Key"] ?? null });
    if (url.endsWith("/v1/accounts") && init.method === "POST") return new Response(JSON.stringify({ id: "acct_123", livemode: false, charges_enabled: false, details_submitted: false, requirements: { currently_due: ["business_type"] } }));
    if (url.includes("/v1/account_links")) return new Response(JSON.stringify({ url: "https://connect.stripe.com/setup/s/abc" }));
    if (url.includes("/v1/accounts/acct_123")) return new Response(JSON.stringify(account));
    return new Response(JSON.stringify({ error: { message: "unexpected" } }), { status: 400 });
  }));
  return calls;
}

async function world() {
  const t = convexTest(schema, modules);
  const w = await t.run(async (ctx) => {
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const A = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    const B = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const heston = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    await ctx.db.insert("memberships", { businessId: A, email: "heston@wranglerproductions.com", userId: heston, role: "owner", createdAt: 0 });
    const boss = await ctx.db.insert("users", { email: "boss@other.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: B, email: "boss@other.example", userId: boss, role: "owner", createdAt: 1 });
    const maya = await ctx.db.insert("users", { email: "maya@harbor.example", name: "Maya", role: "client" });
    await ctx.db.insert("memberships", { businessId: A, email: "maya@harbor.example", userId: maya, role: "client", createdAt: 0 });
    return { A, B, hestonSub: await sess(heston), bossSub: await sess(boss), mayaSub: await sess(maya) };
  });
  return { t, ...w, heston: t.withIdentity({ subject: w.hestonSub }), boss: t.withIdentity({ subject: w.bossSub }), maya: t.withIdentity({ subject: w.mayaSub }) };
}

const READY = { id: "acct_123", livemode: false, charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [], past_due: [] }, business_profile: { name: "Wrangler Productions" }, external_accounts: { data: [{ last4: "6789" }] } };

describe("connecting Stripe", () => {
  test("connect makes one connected account (business pays Stripe's fees, Stripe covers losses, full dashboard) and sends the owner to Stripe", async () => {
    const w = await world();
    expect(await w.heston.query(api.payments.settings, {})).toMatchObject({ platform: { ready: true, mode: "test" }, stripe: null });
    const calls = fakeStripe(READY);
    const r = await w.heston.action(api.payments.connect, {});
    expect(r.url).toBe("https://connect.stripe.com/setup/s/abc");
    const create = decodeURIComponent(calls[0].body);
    expect(create).toContain("controller[fees][payer]=account");
    expect(create).toContain("controller[losses][payments]=stripe");
    expect(create).toContain("controller[stripe_dashboard][type]=full");
    expect(create).toContain("email=heston@wranglerproductions.com");
    expect(calls[0].account).toBeNull(); // made on the platform
    expect(decodeURIComponent(calls[1].body)).toContain("return_url=https://app.wranglerportal.com/settings/payments?stripe=back");
    expect((await w.heston.query(api.payments.settings, {})).stripe).toMatchObject({ status: "needs_info", chargesEnabled: false });

    // Back from Stripe: everything filled in.
    expect(await w.heston.action(api.payments.refresh, {})).toEqual({ status: "connected" });
    expect((await w.heston.query(api.payments.settings, {})).stripe).toMatchObject({ status: "connected", bankLast4: "6789", displayName: "Wrangler Productions" });
    // Connecting again doesn't make a second account.
    const again = fakeStripe(READY);
    await w.heston.action(api.payments.connect, {});
    expect(again.some((c) => c.url.endsWith("/v1/accounts") && c.method === "POST")).toBe(false);
  });

  test("disconnect keeps the account; a refresh doesn't undo it; connecting again picks the same account up", async () => {
    const w = await world();
    fakeStripe(READY);
    await w.heston.action(api.payments.connect, {});
    await w.heston.action(api.payments.refresh, {});
    await w.heston.mutation(api.payments.disconnect, {});
    expect((await w.heston.query(api.payments.settings, {})).stripe).toMatchObject({ status: "disconnected" });
    await w.heston.action(api.payments.refresh, {});
    expect((await w.heston.query(api.payments.settings, {})).stripe.status).toBe("disconnected");
    const calls = fakeStripe(READY);
    await w.heston.action(api.payments.connect, {});
    expect(calls.map((c) => c.url.replace("https://api.stripe.com/v1/", ""))).toEqual(["account_links"]);
    await w.heston.action(api.payments.refresh, {});
    expect((await w.heston.query(api.payments.settings, {})).stripe.status).toBe("connected");
  });

  test("only the owner, and only their own business", async () => {
    const w = await world();
    fakeStripe(READY);
    await w.heston.action(api.payments.connect, {});
    await expect(w.maya.query(api.payments.settings, {})).rejects.toThrow();
    await expect(w.maya.action(api.payments.connect, {})).rejects.toThrow();
    expect((await w.boss.query(api.payments.settings, {})).stripe).toBeNull();
    await w.boss.mutation(api.payments.disconnect, {});
    expect((await w.heston.query(api.payments.settings, {})).stripe.status).not.toBe("disconnected");
  });
});

describe("the Connect webhook", () => {
  test("refuses a bad signature, applies account.updated once, and ignores another account's event", async () => {
    const w = await world();
    fakeStripe(READY);
    await w.heston.action(api.payments.connect, {});
    const ev = (id: string, account: string, obj: unknown) => JSON.stringify({ id, type: "account.updated", account, livemode: false, data: { object: obj } });
    const post = async (body: string, sig: string | null) => (await w.t.fetch("/stripe/connect", { method: "POST", body, headers: sig ? { "stripe-signature": sig } : {} })).status;

    const body = ev("evt_1", "acct_123", READY);
    expect(await post(body, null)).toBe(400);
    expect(await post(body, await signForTest(body, "whsec_wrong"))).toBe(400);
    expect(await post(body, await signForTest(body, SECRET, Math.floor(Date.now() / 1000) - 3600))).toBe(400); // too old
    expect(await post(body, await signForTest(body, SECRET))).toBe(200);
    expect((await w.heston.query(api.payments.settings, {})).stripe.status).toBe("connected");

    // The same event again changes nothing (here: an older "needs info" body under the same id).
    const replay = ev("evt_1", "acct_123", { ...READY, charges_enabled: false });
    expect(await post(replay, await signForTest(replay, SECRET))).toBe(200);
    expect((await w.heston.query(api.payments.settings, {})).stripe.status).toBe("connected");

    // A new payout bank: the portal reads the account again and shows the new last four.
    fakeStripe({ ...READY, external_accounts: { data: [{ last4: "5253" }] } });
    const bank = JSON.stringify({ id: "evt_4", type: "account.external_account.created", account: "acct_123", livemode: false, data: { object: { id: "ba_1", last4: "5253" } } });
    expect(await post(bank, await signForTest(bank, SECRET))).toBe(200);
    vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers();
    expect((await w.heston.query(api.payments.settings, {})).stripe.bankLast4).toBe("5253");

    // The business removes the portal inside Stripe: shown as disconnected.
    const gone = JSON.stringify({ id: "evt_3", type: "account.application.deauthorized", account: "acct_123", livemode: false, data: { object: { id: "ca_x" } } });
    expect(await post(gone, await signForTest(gone, SECRET))).toBe(200);
    expect((await w.heston.query(api.payments.settings, {})).stripe.status).toBe("disconnected");

    const stranger = ev("evt_2", "acct_999", { ...READY, id: "acct_999" });
    expect(await post(stranger, await signForTest(stranger, SECRET))).toBe(200);
    expect((await w.boss.query(api.payments.settings, {})).stripe).toBeNull();
  });
});

describe("helpers", () => {
  test("form fields, signatures and account states", async () => {
    expect(formOf({ a: { b: 1 }, c: ["x", "y"], d: undefined, e: [{ f: 2 }] })).toEqual({ "a[b]": "1", "c[0]": "x", "c[1]": "y", "e[0][f]": "2" });
    const sig = await signForTest("{}", SECRET);
    expect(await stripeSignatureOk("{}", sig, SECRET)).toBe(true);
    expect(await stripeSignatureOk("{ }", sig, SECRET)).toBe(false);
    expect(accountState({ charges_enabled: false, details_submitted: false, requirements: { currently_due: [] } }).status).toBe("pending");
    expect(accountState({ charges_enabled: false, details_submitted: true, requirements: { currently_due: ["x"] } }).status).toBe("needs_info");
    expect(accountState(READY).status).toBe("connected");
  });
});

describe("invoice number prefix (D52)", () => {
  test("business name, vowels out, first 6", async () => {
    const { invoicePrefix } = await import("../convex/lib/invoiceNumber");
    expect(invoicePrefix("Wrangler Productions")).toBe("WRNGLR");
    expect(invoicePrefix("Juniper & Ash")).toBe("JNPRSH");
    expect(invoicePrefix("Joy Coffee")).toBe("JYCFF");
    expect(invoicePrefix("Aeiou")).toBe("A");
    expect(invoicePrefix("Studio 54 Films")).toBe("STD54F");
  });
});
