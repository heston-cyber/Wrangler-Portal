// Phase 3c step 4 · the vendor side. T3c.4: an invited vendor can make an account (role "vendor"), and a vendor who
// works for two businesses has one login with each business's work kept apart (D94); they see only their own bookings
// and the briefings sent to them, accept or decline (with a reason the owner sees), and press "I've read it" (the owner
// sees Read). Vendors are refused on the owner's and the client's sides; owners and clients are refused here. D102.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";

const api = anyApi;
beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://handsome-hummingbird-11.convex.site";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
  const { generateKeyPairSync } = await import("node:crypto");
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.JWT_PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...pair.publicKey.export({ format: "jwk" }) }] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
type Sent = { to: string; subject: string; text: string };
const stub = (mails: Sent[]) => vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
  return new Response("{}", { status: 500 });
}));
const settle = async (w: W) => { vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const JORDAN = "jordan@ellisfilms.com";
const pdf = (w: W) => w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4 brief"], { type: "application/pdf" })));

/** Jordan as a vendor of Wrangler (A) and of Other Films (B), with a login; a booking from each. */
async function twoBusinesses(w: W) {
  const a = await w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: JORDAN, roles: ["Shooter"], rates: [], invite: true }) as Id<"vendors">;
  const b = await w.boss.mutation(api.vendors.add, { name: "Jordan E.", email: JORDAN, roles: ["Shooter"], rates: [], invite: true }) as Id<"vendors">;
  const sub = await w.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: JORDAN, name: "Jordan Ellis", role: "vendor" });
    const biz = (id: Id<"vendors">) => ctx.db.get(id).then((x) => x!.businessId!);
    for (const id of [a, b]) await ctx.db.insert("memberships", { businessId: await biz(id), email: JORDAN, userId, role: "vendor", createdAt: Date.now() });
    return `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
  });
  const otherProject = await w.t.run(async (ctx) => ctx.db.insert("projects", { businessId: (await ctx.db.get(b))!.businessId, name: "Fern & Field lookbook", createdAt: 0 }));
  const kA = await w.heston.mutation(api.bookings.create, { vendorId: a, projectId: w.p, role: "Shooter", start: "2030-11-06", end: "2030-11-07", cents: 100_000, unit: "day", note: "Two days, run and gun." }) as Id<"vendorBookings">;
  const kB = await w.boss.mutation(api.bookings.create, { vendorId: b, projectId: otherProject, role: "Shooter", start: "2030-11-15", end: "2030-11-15", cents: 60_000, unit: "day" }) as Id<"vendorBookings">;
  return { a, b, kA, kB, jordan: w.t.withIdentity({ subject: sub }) };
}

describe("the vendor side", () => {
  test("an invited vendor can make an account; anyone else still can't; the invite email goes out", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const signUp = (email: string) => w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email, password: "longenoughpassword" } });
    await w.heston.mutation(api.vendors.add, { name: "Riley Chen", email: "riley@chen.example", roles: ["Editor"], rates: [], invite: false });
    await expect(signUp("riley@chen.example")).rejects.toThrow(/hasn't been invited/); // on the list, not invited yet
    const id = (await w.heston.query(api.vendors.list, {}))[0]._id;
    await w.heston.mutation(api.vendors.invite, { vendorId: id });
    await settle(w);
    expect(mails.map((m) => [m.to, m.subject])).toEqual([["riley@chen.example", "Heston at Wrangler Productions invited you to WranglerPortal"]]);
    expect(mails[0].text).toContain("https://app.wranglerportal.com/?invited=riley@chen.example&side=vendor");
    await signUp("riley@chen.example");
    const user = await w.t.run((ctx) => ctx.db.query("users").withIndex("email", (q) => q.eq("email", "riley@chen.example")).unique());
    expect(user).toMatchObject({ role: "vendor", name: "Riley Chen" });
    const ms = await w.t.run((ctx) => ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", "riley@chen.example")).collect());
    expect(ms.map((m) => [m.role, m.businessId])).toEqual([["vendor", w.A]]);
    // Nov 2 (replacing D102): a vendor can also be invited as a client; it's the same login, with a switch.
    await w.boss.mutation(api.clients.invite, { email: "riley@chen.example" });
  });

  test("T3c.4 one login, two businesses kept apart (D94); accept, decline with a reason, I've read it", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { kA, kB, jordan } = await twoBusinesses(w);
    const mine = await jordan.query(api.vendorPortal.businesses, {});
    expect(mine.list.map((b: { name: string }) => b.name)).toEqual(["Wrangler Productions", "Other Films"]);
    const [A, B] = mine.list.map((b: { businessId: string }) => b.businessId);

    const homeA = await jordan.query(api.vendorPortal.home, { businessId: A });
    expect(homeA).toMatchObject({ business: "Wrangler Productions", name: "Jordan Ellis", offered: [expect.objectContaining({ _id: kA, project: "26127 Launch", role: "Shooter", expectedCents: 200_000, note: "Two days, run and gun." })], upcoming: [] });
    expect((await jordan.query(api.vendorPortal.home, { businessId: B })).offered.map((x: { _id: string }) => x._id)).toEqual([kB]);
    expect(await jordan.query(api.vendorPortal.counts, { businessId: B })).toMatchObject({ offered: 1, total: 1 });
    // A booking opens with its own business, whichever is picked in the switcher.
    expect(await jordan.query(api.vendorPortal.booking, { bookingId: kB })).toMatchObject({ business: "Other Films", project: "Fern & Field lookbook" });

    await jordan.mutation(api.vendorPortal.accept, { bookingId: kA });
    await expect(jordan.mutation(api.vendorPortal.accept, { bookingId: kA })).rejects.toThrow(/already accepted/);
    expect((await w.heston.query(api.bookings.get, { bookingId: kA })).state).toBe("accepted");
    await expect(jordan.mutation(api.vendorPortal.decline, { bookingId: kB, reason: " " })).rejects.toThrow(/Pick a reason/);
    await jordan.mutation(api.vendorPortal.decline, { bookingId: kB, reason: "Booked that day", note: "Free the 16th if that helps." });
    expect(await w.boss.query(api.bookings.get, { bookingId: kB })).toMatchObject({ state: "declined", declineReason: "Booked that day: Free the 16th if that helps." });

    // A briefing sent to Jordan: on Home to read, then "I've read it"; the owner sees Read.
    const brief = await w.heston.mutation(api.briefings.create, { bookingId: kA }) as Id<"briefings">;
    expect(await jordan.query(api.vendorPortal.briefing, { briefingId: brief })).toBeNull(); // a draft isn't theirs to see
    const jordanId = (await w.heston.query(api.bookings.get, { bookingId: kA })).vendorId;
    await w.heston.action(api.briefings.share, { briefingId: brief, storageId: await pdf(w), to: [{ vendorId: jordanId, email: "ignored@example.com" }] }); // D147: Share
    expect((await jordan.query(api.vendorPortal.home, { businessId: A })).toRead.map((x: { _id: string }) => x._id)).toEqual([brief]);
    expect(await jordan.query(api.vendorPortal.briefing, { briefingId: brief })).toMatchObject({ title: "Shoot brief · 26127 Launch", kind: "Shoot brief", readAt: null, pdfUrl: expect.any(String) });
    await jordan.mutation(api.vendorPortal.markRead, { briefingId: brief });
    expect((await w.heston.query(api.briefings.get, { briefingId: brief })).state).toBe("read");
    expect((await w.heston.query(api.bookings.get, { bookingId: kA })).brief).toBe("read");
    expect((await jordan.query(api.vendorPortal.home, { businessId: A })).toRead).toEqual([]);
    await settle(w); // Nov 2: the owner hears they read it, once
    await jordan.mutation(api.vendorPortal.markRead, { briefingId: brief });
    await settle(w);
    expect(mails.filter((m) => m.subject === "Jordan Ellis read the brief: 26127 Launch").map((m) => m.to)).toEqual(["heston@wranglerproductions.com"]);
  });

  test("T3c.4 isolation: only their own work; vendors are refused elsewhere; others are refused here", async () => {
    const w = await world();
    stub([]);
    const { kA, jordan } = await twoBusinesses(w);
    // Someone else's booking in the same business isn't theirs.
    const riley = await w.heston.mutation(api.vendors.add, { name: "Riley Chen", email: "riley@chen.example", roles: ["Editor"], rates: [], invite: false }) as Id<"vendors">;
    const kR = await w.heston.mutation(api.bookings.create, { vendorId: riley, projectId: w.p, role: "Editor", start: "2030-11-08", end: "2030-11-09", cents: 50_000, unit: "day" }) as Id<"vendorBookings">;
    expect(await jordan.query(api.vendorPortal.booking, { bookingId: kR })).toBeNull();
    await expect(jordan.mutation(api.vendorPortal.accept, { bookingId: kR })).rejects.toThrow(/isn't here/);
    // A business they don't work for can't be picked.
    const C = await w.t.run((ctx) => ctx.db.insert("businesses", { slug: "third", name: "Third Co", createdAt: 2 }));
    await expect(jordan.query(api.vendorPortal.home, { businessId: C })).rejects.toThrow(/Not allowed/);
    // Taken off Wrangler's list: Wrangler's work is gone for them; Other Films' stays.
    const A = (await jordan.query(api.vendorPortal.businesses, {})).list[0].businessId;
    const a = (await w.heston.query(api.vendors.list, {})).find((x: { name: string }) => x.name === "Jordan Ellis")._id;
    await w.heston.mutation(api.vendors.archive, { vendorId: a, archived: true });
    await expect(jordan.query(api.vendorPortal.home, { businessId: A })).rejects.toThrow(/Not allowed/);
    expect(await jordan.query(api.vendorPortal.booking, { bookingId: kA })).toBeNull();
    // Vendors are refused on the owner's and client's sides; owners and clients are refused here.
    await expect(jordan.query(api.vendors.list, {})).rejects.toThrow(/Not allowed/);
    await expect(jordan.query(api.inbox.mine, {})).rejects.toThrow(/Not allowed/);
    await expect(jordan.query(api.business.brand, {})).rejects.toThrow(/Not allowed/);
    await expect(w.heston.query(api.vendorPortal.home, {})).rejects.toThrow(/Not allowed/);
    await expect(w.maya.query(api.vendorPortal.businesses, {})).rejects.toThrow(/Not allowed/);
    expect((await jordan.query(api.users.me, {})).role).toBe("vendor");
  });
});

describe("the vendor side, part 2", () => {
  test("accepting emails the owner; an editor gets Review access until 30 days after the last day; cancelling ends it", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { kA, jordan } = await twoBusinesses(w);
    await jordan.mutation(api.vendorPortal.accept, { bookingId: kA });
    await settle(w);
    expect(mails.filter((m) => m.to === "heston@wranglerproductions.com").map((m) => m.subject)).toEqual(["Jordan Ellis accepted the booking: 26127 Launch"]);
    expect((await jordan.query(api.vendorPortal.reviews, {})).rows).toEqual([]); // a shooter: no Review access
    // An editing booking: a comment link to the project's cuts, in their portal, ending 30 days after the last day.
    const a = (await w.heston.query(api.vendors.list, {}))[0]._id;
    const kE = await w.heston.mutation(api.bookings.create, { vendorId: a, projectId: w.p, role: "Editor", start: "2030-11-08", end: "2030-11-14", cents: 9_000, unit: "hour", hours: 30 }) as Id<"vendorBookings">;
    await jordan.mutation(api.vendorPortal.accept, { bookingId: kE });
    const r = (await jordan.query(api.vendorPortal.reviews, {})).rows;
    expect(r).toEqual([expect.objectContaining({ project: "26127 Launch", role: "Editor", token: expect.any(String) })]);
    expect(r[0].expiresAt).toBe(Date.parse("2030-11-14T23:59:59-06:00") + 30 * 86_400_000);
    const sh = await w.t.run((ctx) => ctx.db.query("shares").withIndex("by_token", (q) => q.eq("token", r[0].token)).unique());
    expect(sh).toMatchObject({ kind: "project", projectId: w.p, access: "comment", who: "link", downloads: false, emailNewVersions: false });
    await w.heston.mutation(api.bookings.cancel, { bookingId: kE });
    expect((await jordan.query(api.vendorPortal.reviews, {})).rows).toEqual([]);
    expect((await w.t.run((ctx) => ctx.db.get(sh!._id)))!.offAt).toBeTypeOf("number");
  });

  test("T3c.4 invoices: hours × the agreed rate or line items, a draft, then sent (email 26, the owner's Home alert, the vendor page)", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { a, kA, jordan } = await twoBusinesses(w);
    await expect(jordan.mutation(api.vendorPortal.saveInvoice, { bookingId: kA, mode: "hours", hours: [{ label: "Nov 6", qty: 1 }], lines: [], send: true })).rejects.toThrow(/accepted/);
    await jordan.mutation(api.vendorPortal.accept, { bookingId: kA });
    const form = await jordan.query(api.vendorPortal.invoiceForm, {});
    expect(form.bookings).toEqual([expect.objectContaining({ _id: kA, label: "26127 Launch · Shooter", rate: { cents: 100_000, unit: "day" }, expectedCents: 200_000 })]);
    expect(form.nextNumber).toBe("INV-0001");
    const draft = await jordan.mutation(api.vendorPortal.saveInvoice, { bookingId: kA, mode: "hours", hours: [{ label: "Nov 6 · shoot", qty: 1 }], lines: [], number: "JE-014", send: false }) as Id<"vendorInvoices">;
    expect(await w.heston.query(api.vendors.invoices, { vendorId: a })).toEqual([]); // drafts are theirs only
    await expect(jordan.mutation(api.vendorPortal.saveInvoice, { invoiceId: draft, bookingId: kA, mode: "hours", hours: [{ label: "x", qty: 0 }], lines: [], send: true })).rejects.toThrow(/more than 0/);
    await jordan.mutation(api.vendorPortal.saveInvoice, { invoiceId: draft, bookingId: kA, mode: "hours", hours: [{ label: "Nov 6 · shoot", qty: 1 }, { label: "Nov 7 · shoot", qty: 1 }], lines: [], number: "JE-014", note: "Thanks!", send: true });
    await settle(w);
    const m = mails.find((x) => x.subject === "Jordan Ellis sent invoice JE-014")!;
    expect(m.to).toBe("heston@wranglerproductions.com");
    expect(m.text).toContain("26127 Launch · Shooter, 2 days · $2,000.00");
    expect(m.text).toContain("It matches the agreed rate on the booking.");
    expect(await jordan.query(api.vendorPortal.invoice, { invoiceId: draft })).toMatchObject({ status: "sent", totalCents: 200_000, amount: "2 days" });
    await expect(jordan.mutation(api.vendorPortal.saveInvoice, { invoiceId: draft, bookingId: kA, mode: "lines", hours: [], lines: [{ description: "x", cents: 1 }], send: false })).rejects.toThrow(/can't change/);
    await expect(jordan.mutation(api.vendorPortal.deleteInvoice, { invoiceId: draft })).rejects.toThrow(/stays/);
    const needs = await w.heston.query(api.home.needs, {});
    expect(needs[0]).toMatchObject({ kind: "vendorInvoice", vendor: "Jordan Ellis", number: "JE-014", totalCents: 200_000 });
    expect(await w.heston.query(api.vendors.invoices, { vendorId: a })).toEqual([expect.objectContaining({ number: "JE-014", status: "sent", totalCents: 200_000 })]);
    expect((await w.heston.query(api.vendors.get, { vendorId: a })).totals).toMatchObject({ waitingCents: 200_000, waitingCount: 1 });
    // Line items: a different total says so; another business never sees it.
    await jordan.mutation(api.vendorPortal.saveInvoice, { bookingId: kA, mode: "lines", hours: [], lines: [{ description: "Extra drive", cents: 15_000 }], send: true });
    await settle(w);
    expect(mails.some((x) => x.text.includes("less than the booking's expected $2,000.00"))).toBe(false); // line items: no rate comparison
    expect((await w.boss.query(api.home.needs, {})).filter((n: { kind: string }) => n.kind === "vendorInvoice")).toEqual([]);
  });

  test("Settings: details, a PDF W-9 per business (D100), the payment method and a note, never bank numbers (D101)", async () => {
    const w = await world();
    stub([]);
    const { a, jordan } = await twoBusinesses(w);
    const [A, B] = (await jordan.query(api.vendorPortal.businesses, {})).list.map((b: { businessId: string }) => b.businessId);
    await jordan.mutation(api.vendorPortal.saveDetails, { businessId: A, name: "Jordan Ellis", businessName: "Ellis Films", address: "1 Main St, OKC", payMethod: "ACH", payNote: "Send a remittance email" });
    await expect(jordan.mutation(api.vendorPortal.saveDetails, { businessId: A, name: "Jordan Ellis", payMethod: "ACH", payNote: "Routing 103000648 acct 12345678" })).rejects.toThrow(/account and routing/);
    await expect(jordan.mutation(api.vendorPortal.saveDetails, { businessId: A, name: "Jordan Ellis", payMethod: "Wire" })).rejects.toThrow(/how you get paid/);
    expect(await w.heston.query(api.vendors.get, { vendorId: a })).toMatchObject({ businessName: "Ellis Films", address: "1 Main St, OKC", payMethod: { method: "ACH", note: "Send a remittance email" } });
    const up = await w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4 w9"], { type: "application/pdf" })));
    await jordan.mutation(api.vendorPortal.setW9, { businessId: A, storageId: up, name: "W-9 2026.pdf" });
    expect((await w.heston.query(api.vendors.get, { vendorId: a })).w9).toMatchObject({ name: "W-9 2026.pdf", canOpen: true });
    expect((await jordan.query(api.vendorPortal.settings, { businessId: B })).w9).toBeNull(); // one per business
    const png = await w.t.run((ctx) => ctx.storage.store(new Blob(["x"], { type: "image/png" })));
    // Second 5e review: refused, and the refused file is deleted rather than left in storage.
    expect(await jordan.mutation(api.vendorPortal.setW9, { businessId: B, storageId: png, name: "w9.png" })).toEqual({ error: "Upload the W-9 as a PDF, up to 10 MB." });
    expect(await w.t.run(async (ctx) => !!(await ctx.storage.get(png)))).toBe(false);
  });
});
