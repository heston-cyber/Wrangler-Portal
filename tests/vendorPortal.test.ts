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
    expect(mails[0].text).toContain("https://app.wranglerportal.com/?invited=riley@chen.example");
    await signUp("riley@chen.example");
    const user = await w.t.run((ctx) => ctx.db.query("users").withIndex("email", (q) => q.eq("email", "riley@chen.example")).unique());
    expect(user).toMatchObject({ role: "vendor", name: "Riley Chen" });
    const ms = await w.t.run((ctx) => ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", "riley@chen.example")).collect());
    expect(ms.map((m) => [m.role, m.businessId])).toEqual([["vendor", w.A]]);
    // D102: once someone is a vendor anywhere, their email can't be invited as a client (here or by another business).
    await expect(w.boss.mutation(api.clients.invite, { email: "riley@chen.example" })).rejects.toThrow(/one of your vendors/);
  });

  test("T3c.4 one login, two businesses kept apart (D94); accept, decline with a reason, I've read it", async () => {
    const w = await world();
    stub([]);
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
    await w.heston.action(api.briefings.send, { briefingId: brief, storageId: await pdf(w) });
    expect((await jordan.query(api.vendorPortal.home, { businessId: A })).toRead.map((x: { _id: string }) => x._id)).toEqual([brief]);
    expect(await jordan.query(api.vendorPortal.briefing, { briefingId: brief })).toMatchObject({ title: "Shoot brief · 26127 Launch", kind: "Shoot brief", readAt: null, pdfUrl: expect.any(String) });
    await jordan.mutation(api.vendorPortal.markRead, { briefingId: brief });
    expect((await w.heston.query(api.briefings.get, { briefingId: brief })).state).toBe("read");
    expect((await w.heston.query(api.bookings.get, { bookingId: kA })).brief).toBe("read");
    expect((await jordan.query(api.vendorPortal.home, { businessId: A })).toRead).toEqual([]);
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
