// Phase 4 · shoots. T4.1: schedule → the client's Inbox and email 29 → they confirm → saved with their name and the
// time, and the owner hears. T4.2: a moved shoot asks again everywhere (Inbox, email 30, the confirmation cleared).
// Plus: who can see and do what, and cancelling.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { todayCentral } from "../convex/lib/bookings";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
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
const day = (n: number) => { const d = new Date(`${todayCentral()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Maya can open the project (an invited project share); Jo can't (no share). Jordan is booked as a shooter. */
async function setup(w: W) {
  await w.t.run(async (ctx) => {
    const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: (await ctx.db.query("users").first())!._id });
    await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: "maya@harbor.example", addedAt: 0 });
  });
  const vendor = await w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: "jordan@ellisfilms.com", roles: ["Shooter"], rates: [], invite: false }) as Id<"vendors">;
  const booking = await w.heston.mutation(api.bookings.create, { vendorId: vendor, projectId: w.p, role: "Shooter", start: day(4), end: day(4), cents: 100_000, unit: "day" }) as Id<"vendorBookings">;
  return { booking };
}
const base = (booking: Id<"vendorBookings">) => ({ date: day(4), call: "07:00", wrap: "17:00", location: "Harbor Coffee, 412 Main St.", parking: "Behind the shop",
  prepare: ["Shop open and lights on by 7:00", "Two baristas on shift for B-roll", ""], withOwner: true, bookingIds: [booking], calendar: true });

describe("shoots", () => {
  test("T4.1 schedule → Inbox and email 29 → the client confirms → the owner hears", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { booking } = await setup(w);
    const { shootId, told } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, ...base(booking) }) as { shootId: Id<"shoots">; told: number };
    expect(told).toBe(1);
    const card = await w.heston.query(api.shoots.forProject, { projectId: w.p });
    expect(card.shoots).toEqual([expect.objectContaining({ date: day(4), call: "07:00", wrap: "17:00", prepare: ["Shop open and lights on by 7:00", "Two baristas on shift for B-roll"], confirmed: null,
      crew: [{ name: "Heston", role: "Director", owner: true, bookingId: null }, { name: "Jordan Ellis", role: "Shooter", owner: false, bookingId: booking }] })]);
    expect(card.crew).toEqual([expect.objectContaining({ bookingId: booking, name: "Jordan Ellis", role: "Shooter" })]);

    // Maya's Inbox and email 29; Jo (no share) gets nothing.
    const inbox = await w.maya.query(api.inbox.mine, {});
    const item = inbox.items?.find?.((i: { kind: string }) => i.kind === "shoot") ?? inbox.find?.((i: { kind: string }) => i.kind === "shoot");
    expect(item).toMatchObject({ title: expect.stringMatching(/^Shoot scheduled: .+ · 7:00 AM$/), text: "Harbor Coffee, 412 Main St. Please confirm.", link: `/shoots/${shootId}` });
    await settle(w);
    const m29 = mails.find((m) => m.subject.startsWith("Your shoot for 26127 Launch is set"))!;
    expect(m29.to).toBe("maya@harbor.example");
    expect(m29.text).toContain("Hi Maya,");
    expect(m29.text).toContain(`https://app.wranglerportal.com/shoots/${shootId}`);
    expect(mails.some((m) => m.to === "jo@harbor.example")).toBe(false);

    // The client's page and Coming up card.
    expect(await w.maya.query(api.shoots.forClientProject, { projectId: w.p })).toEqual([{ _id: shootId, date: day(4), call: "07:00", location: "Harbor Coffee, 412 Main St.", confirmed: false }]);
    const page = await w.maya.query(api.shoots.page, { shootId });
    expect(page).toMatchObject({ parking: "Behind the shop", project: { label: "26127 Launch" }, business: "Wrangler Productions", confirmed: null });
    expect(await w.jo.query(api.shoots.page, { shootId })).toBeNull();
    await expect(w.jo.mutation(api.shoots.confirm, { shootId })).rejects.toThrow(/isn't here/);

    // Confirm: saved with her name and the time; the owner gets a note; a second press changes nothing.
    expect(await w.maya.mutation(api.shoots.confirm, { shootId })).toEqual({ already: false });
    expect(await w.maya.mutation(api.shoots.confirm, { shootId })).toEqual({ already: true });
    expect((await w.maya.query(api.shoots.page, { shootId })).confirmed).toMatchObject({ name: "Maya Brooks", at: expect.any(Number) });
    expect((await w.heston.query(api.shoots.forProject, { projectId: w.p })).shoots[0].confirmed).toMatchObject({ name: "Maya Brooks" });
    await settle(w);
    expect(mails.find((m) => m.subject === "Maya Brooks confirmed the shoot: 26127 Launch")!.to).toBe("heston@wranglerproductions.com");
  });

  test("T4.2 a moved shoot asks again everywhere; other edits just save; cancel takes it away", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { booking } = await setup(w);
    const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, ...base(booking) }) as { shootId: Id<"shoots"> };
    await w.maya.mutation(api.shoots.confirm, { shootId });
    // Only what to prepare changes: saved, nobody asked again.
    expect(await w.heston.mutation(api.shoots.update, { shootId, ...base(booking), prepare: ["Menu boards up to date"] })).toEqual({ moved: false, told: 0 });
    expect((await w.maya.query(api.shoots.page, { shootId })).confirmed).not.toBeNull();
    // The date moves: the confirmation clears, Inbox and email 30.
    expect(await w.heston.mutation(api.shoots.update, { shootId, ...base(booking), date: day(5) })).toEqual({ moved: true, told: 1 });
    const page = await w.maya.query(api.shoots.page, { shootId });
    expect(page).toMatchObject({ date: day(5), confirmed: null, moved: { date: day(4), call: "07:00" } });
    const items = await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).filter((i) => i.kind === "shoot").map((i) => i.title));
    expect(items).toHaveLength(2);
    expect(items[1]).toMatch(/^Shoot moved: now .+ \(was .+\)$/);
    await settle(w);
    const m30 = mails.find((m) => m.subject.startsWith("Your shoot for 26127 Launch has moved"))!;
    expect(m30.text).toContain("Same call time: 7:00 AM.");
    expect(m30.text).toContain("Confirm the new date");
    expect(mails.filter((m) => m.subject.startsWith("Your shoot for 26127 Launch is set"))).toHaveLength(1);
    // Checks.
    await expect(w.heston.mutation(api.shoots.update, { shootId, ...base(booking), date: day(-1) })).rejects.toThrow(/passed/);
    await expect(w.heston.mutation(api.shoots.update, { shootId, ...base(booking), wrap: "06:00" })).rejects.toThrow(/before the call/);
    await expect(w.heston.mutation(api.shoots.schedule, { projectId: w.p, ...base(booking), location: "  " })).rejects.toThrow(/where/);
    // Cancel: gone from the client's pages, with an Inbox line.
    await w.heston.mutation(api.shoots.cancel, { shootId });
    expect(await w.maya.query(api.shoots.page, { shootId })).toBeNull();
    expect(await w.maya.query(api.shoots.forClientProject, { projectId: w.p })).toEqual([]);
    expect((await w.heston.query(api.shoots.forProject, { projectId: w.p })).shoots).toEqual([]);
    expect(await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).some((i) => i.title.startsWith("Shoot cancelled")))).toBe(true);
  });

  test("another business, vendors and clients can't schedule or see the owner's side", async () => {
    const w = await world();
    stub([]);
    const { booking } = await setup(w);
    const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, ...base(booking) }) as { shootId: Id<"shoots"> };
    expect(await w.boss.query(api.shoots.forProject, { projectId: w.p })).toBeNull();
    await expect(w.boss.mutation(api.shoots.schedule, { projectId: w.p, ...base(booking) })).rejects.toThrow();
    await expect(w.boss.mutation(api.shoots.cancel, { shootId })).rejects.toThrow();
    await expect(w.maya.query(api.shoots.forProject, { projectId: w.p })).rejects.toThrow(/Not allowed/);
    await expect(w.maya.mutation(api.shoots.update, { shootId, ...base(booking) })).rejects.toThrow(/Not allowed/);
    expect(await w.boss.query(api.shoots.page, { shootId })).toBeNull();
  });
});
