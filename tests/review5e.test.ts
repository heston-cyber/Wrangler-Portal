// Wrangler Portal, Phase 5e review fixes (Nov 6): one test per finding of the end-of-5e independent review, with
// Heston's answers ("Go and approved"): (a) W-9s and vendor payment details for the owner and the Vendor payments
// switch; (b) "See what a project is worth" hides every job amount; (c) the Settings switch covers Booking calls,
// Brand kit and the business's look only; (d) a Bookkeeper may approve and pay, each step in Activity.
import { beforeAll, expect, test } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { PERMS } from "../convex/lib/perms";

const api = anyApi;
const modules = import.meta.glob("../convex/**/*.ts");

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://x.convex.site";
});

type Perm = (typeof PERMS)[number];
const switches = (on: Perm[]) => Object.fromEntries(PERMS.map((p) => [p, on.includes(p)]));

async function world() {
  const t = convexTest(schema, modules);
  const w = await t.run(async (ctx) => {
    const A = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    const heston = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    await ctx.db.insert("memberships", { businessId: A, email: "heston@wranglerproductions.com", userId: heston, role: "owner", createdAt: 0 });
    const hestonSub = `${heston}|${await ctx.db.insert("authSessions", { userId: heston, expirationTime: Date.now() + 3_600_000 })}`;
    return { A, hestonSub };
  });
  const member = async (email: string, role: "producer" | "editor" | "bookkeeper", on: Perm[]) => {
    const sub = await t.run(async (ctx) => {
      const u = await ctx.db.insert("users", { email, name: email.split("@")[0], role: "team", emailVerificationTime: 0 });
      await ctx.db.insert("memberships", { businessId: w.A, email, userId: u, role: "team", teamRole: role, perms: switches(on), createdAt: 1 });
      return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
    });
    return t.withIdentity({ subject: sub });
  };
  return { t, ...w, heston: t.withIdentity({ subject: w.hestonSub }), member };
}

async function vendorWithW9(w: Awaited<ReturnType<typeof world>>) {
  return w.t.run(async (ctx) => {
    const file = await ctx.storage.store(new Blob(["%PDF w9"]));
    return ctx.db.insert("vendors", {
      businessId: w.A, name: "Jordan Ellis", email: "jordan@x.example", roles: ["Shooter"], rates: [{ role: "Shooter", unit: "day", cents: 80000 }],
      w9: { fileId: file, name: "w9.pdf", uploadedAt: 1 }, payMethod: { method: "Zelle", note: "jordan@bank" },
      payout: { recipientId: "rcp_SECRET", mode: "test", ready: true, payoutMethodId: "pm_SECRET", last4: "6789", bankName: "Bank", checkedAt: 1 },
      createdAt: 0, updatedAt: 0,
    } as never) as Promise<Id<"vendors">>;
  });
}

test("H2 a Producer without Vendor payments sees that a W-9 is on file, never the file, the payout or what was paid", async () => {
  const w = await world();
  const vendorId = await vendorWithW9(w);
  const producer = await w.member("pro@x.example", "producer", ["production", "value"]);
  const x = await producer.query(api.vendors.get, { vendorId });
  expect(x.w9).toMatchObject({ name: "w9.pdf", url: null });
  expect(x.payMethod).toBeUndefined();
  expect(x.totals).toBeNull();
  expect(JSON.stringify(x)).not.toMatch(/rcp_SECRET|pm_SECRET|6789|jordan@bank/);
  expect((await producer.query(api.vendors.list, {}))[0].paidThisYearCents).toBeNull();
  expect(await producer.query(api.vendors.invoices, { vendorId })).toBeNull();
  // The owner, and someone with the switch, see them (the Stripe ids never leave the server for anyone).
  const owner = await w.heston.query(api.vendors.get, { vendorId });
  expect(owner.w9.url).toMatch(/^http/);
  expect(owner.payMethod).toMatchObject({ method: "Zelle" });
  expect(owner.totals).toMatchObject({ paidThisYearCents: 0 });
  expect(JSON.stringify(owner)).not.toMatch(/rcp_SECRET|pm_SECRET/);
  const payer = await w.member("pay@x.example", "producer", ["production", "vendorPayments", "value"]);
  expect((await payer.query(api.vendors.get, { vendorId })).w9.url).toMatch(/^http/);
});

test("M5 without 'See what a project is worth', a vendor's rates are hidden and saving the vendor keeps them", async () => {
  const w = await world();
  const vendorId = await vendorWithW9(w);
  const producer = await w.member("pro@x.example", "producer", ["production"]);
  const x = await producer.query(api.vendors.get, { vendorId });
  expect(x).toMatchObject({ rates: [], costs: [], ratesHidden: true });
  await producer.mutation(api.vendors.update, { vendorId, name: "Jordan Ellis", email: "jordan@x.example", roles: ["Shooter"], rates: [], notes: "Great" });
  const saved = await w.t.run((ctx) => ctx.db.get(vendorId));
  expect(saved).toMatchObject({ notes: "Great", rates: [{ role: "Shooter", unit: "day", cents: 80000 }] });
});

test("the vendor form's Save sends only its own fields (it used to send the whole record and fail)", async () => {
  const w = await world();
  const vendorId = await vendorWithW9(w);
  // The fields the page's form sends (Vendors.tsx save), built from what vendors.get returns.
  const x = await w.heston.query(api.vendors.get, { vendorId });
  const body = { name: x.name, email: x.email, roles: x.roles, notes: "Edited", rates: x.rates.map((r: { role: string; unit: string; cents: number }) => ({ role: r.role, unit: r.unit, cents: r.cents })) };
  await w.heston.mutation(api.vendors.update, { vendorId, ...body });
  expect((await w.t.run((ctx) => ctx.db.get(vendorId)))?.notes).toBe("Edited");
});
