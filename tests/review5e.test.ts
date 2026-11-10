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

test("H3 an alert lands only in its own business's bell; one with no business is dropped (Site watch aside)", async () => {
  const w = await world();
  const internal = anyApi;
  const { B, bossId } = await w.t.run(async (ctx) => {
    const B = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const bossId = await ctx.db.insert("users", { email: "boss@other.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: B, email: "boss@other.example", userId: bossId, role: "owner", createdAt: 1 });
    return { B, bossId };
  });
  const items = () => w.t.run(async (ctx) => (await ctx.db.query("bellItems").collect()).map((x) => ({ biz: x.businessId, user: x.userId, kind: x.kind })));
  expect(await w.t.mutation(internal.bell.post, { kind: "payments", title: "A payment failed", key: "k1" })).toBe(0);
  expect(await items()).toEqual([]);
  await w.t.mutation(internal.bell.post, { businessId: B, kind: "payments", title: "Other's payment failed", key: "k2" });
  expect(await items()).toEqual([{ biz: B, user: bossId, kind: "payments" }]);
  await w.t.mutation(internal.bell.post, { kind: "sitewatch", title: "The portal needs a look", key: "k3" });
  expect((await items()).filter((x) => x.kind === "sitewatch").map((x) => x.biz)).toEqual([w.A]);
});

test("bell gap: an Editor hears about client notes on a project they're assigned to, and only those", async () => {
  const w = await world();
  const internal = anyApi;
  const { p1, p2, eds } = await w.t.run(async (ctx) => {
    const p1 = await ctx.db.insert("projects", { businessId: w.A, name: "Theirs", createdAt: 0 });
    const p2 = await ctx.db.insert("projects", { businessId: w.A, name: "Not theirs", createdAt: 0 });
    const eds: Id<"users">[] = [];
    for (const email of ["ed@x.example", "ed2@x.example"]) {
      const u = await ctx.db.insert("users", { email, name: "Ed", role: "team", emailVerificationTime: 0 });
      await ctx.db.insert("memberships", { businessId: w.A, email, userId: u, role: "team", teamRole: "editor", perms: switches(["projects", "review"]), createdAt: 1 });
      eds.push(u);
    }
    await ctx.db.insert("projectTeam", { businessId: w.A, projectId: p1, userId: eds[0], createdAt: 0 });
    return { p1, p2, eds };
  });
  await w.t.mutation(internal.bell.post, { businessId: w.A, kind: "notes", title: "Notes on theirs", key: "n1", projectId: p1 });
  await w.t.mutation(internal.bell.post, { businessId: w.A, kind: "notes", title: "Notes on another", key: "n2", projectId: p2 });
  const got = await w.t.run(async (ctx) => (await ctx.db.query("bellItems").collect()).filter((x) => eds.includes(x.userId)).map((x) => [x.userId === eds[0] ? "assigned" : "other", x.title]));
  expect(got).toEqual([["assigned", "Notes on theirs"]]);
});

// ---------- M5: "See what a project is worth" hides every job amount (Heston, Nov 6, answer b) ----------
import { setup as matrixWorld } from "./matrix";

test("M5 a Producer with the worth switch off: no proposal or quote totals, no contract payment, no booking rates; saving the contract keeps its payment", async () => {
  const { t, ids } = await matrixWorld();
  const anyIds = ids as Record<string, any>;
  await t.run(async (ctx) => {
    await ctx.db.patch(ids.wsVersionId, { payment: { amountCents: 500000, description: "Deposit" } });
    const m = await ctx.db.get(ids.teamMemberId);
    await ctx.db.patch(ids.teamMemberId, { perms: { ...(m as any).perms, value: false } });
  });
  const owner = t.withIdentity({ subject: anyIds.ownerSub });
  const producer = t.withIdentity({ subject: ids.producerSub });
  // The owner sees them (the same world, so a hidden value is the switch, not missing data).
  expect((await owner.query(api.sign.list, {})).find((d: any) => d._id === ids.docId).amount).toBe(5000);
  expect((await owner.query(api.sign.get, { documentId: ids.docId })).version.payment).toMatchObject({ amountCents: 500000 });
  expect(typeof (await owner.query(api.bookings.get, { bookingId: ids.bookingId })).expectedCents).toBe("number");
  // The Producer doesn't.
  for (const p of await producer.query(api.proposals.list, {})) expect(p.totalCents).toBeNull();
  const company = await producer.query(api.proposals.forCompany, { clientId: ids.clientRecId });
  expect(company.filter((x: any) => x.kind === "quote")).toEqual([]); // quotes are Payments'
  for (const x of company) expect(x.totalCents).toBeNull();
  expect((await producer.query(api.sign.list, {})).find((d: any) => d._id === ids.docId).amount).toBeNull();
  const doc = await producer.query(api.sign.get, { documentId: ids.docId });
  expect(doc.paymentHidden).toBe(true);
  expect(doc.version.payment).toBeUndefined();
  expect(JSON.stringify(doc)).not.toContain("500000");
  const booking = await producer.query(api.bookings.get, { bookingId: ids.bookingId });
  expect(booking).toMatchObject({ rate: null, expectedCents: null, suggestedCents: null });
  for (const b of await producer.query(api.bookings.list, {})) expect(b.rate).toBeNull();
  const form = await producer.query(api.bookings.form, {});
  expect(form.rates.costs).toEqual([]);
  for (const v of form.vendors) expect(v.rates).toEqual([]);
  // Saving the contract's layout without seeing the payment leaves the payment as it was.
  await producer.mutation(api.sign.saveLayout, { versionId: ids.wsVersionId, title: "T", signers: [], boxes: [], signingOrder: "any", payment: null });
  expect((await t.run((ctx) => ctx.db.get(ids.wsVersionId)))?.payment).toMatchObject({ amountCents: 500000 });
});

test("M5 Reports without the worth switch: totals stay, each finished job's own amount goes", async () => {
  const { t, ids } = await matrixWorld();
  const bookkeeper = t.withIdentity({ subject: ids.bookkeeperSub });
  await t.run(async (ctx) => {
    const m = (await ctx.db.query("memberships").collect()).find((x) => x.teamRole === "bookkeeper")!;
    await ctx.db.patch(m._id, { perms: { ...(m as any).perms, value: false } });
    const d = await ctx.db.get(ids.dealId);
    await ctx.db.patch(ids.dealId, { stage: "delivered", valueCents: 250000, history: [...(d?.history ?? []), { kind: "delivered", at: Date.now() }] } as never);
  });
  const today = new Date().toISOString().slice(0, 10);
  const r = await bookkeeper.query(api.reports.page, { from: `${Number(today.slice(0, 4)) - 1}-01-01`, to: today, tz: "UTC" });
  expect(r.byProject).toBeNull();
  expect(r.detail.finished.length).toBeGreaterThan(0);
  for (const f of r.detail.finished) expect(f.cents).toBeNull();
  expect(typeof r.summary.revenueCents).toBe("number");
});
