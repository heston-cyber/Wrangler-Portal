// Phase 5e step 4 (Nov 5): the notification centre. Every owner email lands in the bell (even switched off), the team gets
// the kinds their switches cover, phone alerts follow each person's switches (D146 defaults), the feed is kept 90 days.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { bellLink } from "../convex/lib/bell";

const api = anyApi;
const internal = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const stub = () => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "em" }), { status: 200 })));

async function teamMember(w: Awaited<ReturnType<typeof world>>, email: string, role: "producer" | "editor" | "bookkeeper") {
  const { SUGGESTED } = await import("../convex/lib/perms");
  const sub = await w.t.run(async (ctx) => {
    const u = await ctx.db.insert("users", { email, name: email.split("@")[0], role: "team", emailVerificationTime: 0 });
    await ctx.db.insert("memberships", { businessId: w.A, email, userId: u, role: "team", teamRole: role, perms: { ...SUGGESTED[role] }, createdAt: 0 });
    return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
  });
  return { userId: sub.split("|")[0] as Id<"users">, as: w.t.withIdentity({ subject: sub }) };
}

describe("Phase 5e · Notification centre", () => {
  test("N1 an owner email reaches the bell, from a client's action too, once per event, with its portal link", async () => {
    const w = await world();
    stub();
    const tid = await w.t.run(async (ctx) => {
      const noteId = await ctx.db.insert("inboxNotes", { businessId: w.A, clientId: w.harbor, title: "A few words?", text: "x", status: "sent", draftedBy: "owner", createdAt: 0, updatedAt: 0 });
      return ctx.db.insert("testimonials", { businessId: w.A, noteId, projectId: w.p, clientId: w.harbor, email: "maya@harbor.example", name: "Maya Brooks", working: "Easy.", film: "Sold coffee.", permission: true, createdAt: 0, updatedAt: 0 } as never);
    });
    await w.maya.action(internal.testimonials.mailOwner, { testimonialId: tid }); // as the client who wrote it
    await w.maya.action(internal.testimonials.mailOwner, { testimonialId: tid }); // a repeat run adds nothing
    const f = await w.heston.query(api.bell.feed, {});
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]).toMatchObject({ kind: "notes", unread: true, link: "/clients/testimonials" });
    expect(f.unread).toBe(1);
    expect(await w.heston.query(api.bell.unread, {})).toBe(1);
    // Nobody else's bell: the client, another business's owner, a signed-out caller.
    await expect(w.maya.query(api.bell.unread, {})).rejects.toThrow(/Not allowed/);
    await expect(w.maya.query(api.bell.feed, {})).rejects.toThrow(/Not allowed/);
    expect((await w.boss.query(api.bell.feed, {})).rows).toEqual([]);
    await expect(w.t.query(api.bell.feed, {})).rejects.toThrow(/Sign in first/);
    await expect(w.boss.mutation(api.bell.markRead, { itemId: f.rows[0]._id })).rejects.toThrow(/isn't yours/);
    await w.heston.mutation(api.bell.markRead, { itemId: f.rows[0]._id });
    expect(await w.heston.query(api.bell.unread, {})).toBe(0);
  });

  test("N2 the bell keeps showing a kind whose email is switched off; a bell switch off stops it", async () => {
    const w = await world();
    stub();
    await w.t.mutation(internal.bell.post, { businessId: w.A, kind: "payments", title: "Harbor Coffee paid $500.00", key: "k1", link: "/payments/invoices/x" });
    await w.heston.mutation(api.bell.setPref, { kind: "payments", bell: false });
    await w.t.mutation(internal.bell.post, { businessId: w.A, kind: "payments", title: "Harbor Coffee paid $200.00", key: "k2" });
    await w.t.mutation(internal.bell.post, { businessId: w.A, kind: "quotes", title: "Quote accepted", key: "k3" });
    const f = await w.heston.query(api.bell.feed, {});
    expect(f.rows.map((r: { title: string }) => r.title)).toEqual(["Quote accepted", "Harbor Coffee paid $500.00"]);
    expect(f.counts).toMatchObject({ all: 2, payments: 1, quotes: 1 });
    expect((await w.heston.query(api.bell.feed, { kinds: ["payments", "vendors"] })).rows).toHaveLength(1);
    await w.heston.mutation(api.bell.markAllRead, {});
    expect(await w.heston.query(api.bell.unread, {})).toBe(0);
    expect(bellLink("Open it: https://app.wranglerportal.com/payments/invoices/abc?x=1 now", "https://app.wranglerportal.com")).toBe("/payments/invoices/abc?x=1");
    expect(bellLink("Elsewhere: https://evil.example/payments", "https://app.wranglerportal.com")).toBeNull();
  });

  test("N3 the team gets only the kinds their switches cover; an Editor only items naming their projects; Site watch is the owner's", async () => {
    const w = await world();
    const ed = await teamMember(w, "ed@x.example", "editor");
    const bk = await teamMember(w, "bk@x.example", "bookkeeper");
    for (const [kind, key] of [["payments", "a"], ["notes", "b"], ["sitewatch", "c"], ["contracts", "d"]] as const) {
      await w.t.mutation(internal.bell.post, { businessId: w.A, kind, title: kind, key });
    }
    expect((await ed.as.query(api.bell.feed, {})).rows).toEqual([]); // D157: nothing business-wide for an Editor
    const other = await w.t.run(async (ctx) => ctx.db.insert("projects", { businessId: w.A, name: "Not theirs", createdAt: 0 }));
    await w.t.run(async (ctx) => { await ctx.db.insert("projectTeam", { businessId: w.A, projectId: w.p, userId: ed.userId, createdAt: 0 }); });
    await w.t.mutation(internal.bell.post, { businessId: w.A, kind: "notes", title: "Notes on their cut", key: "e1", projectId: w.p });
    await w.t.mutation(internal.bell.post, { businessId: w.A, kind: "notes", title: "Notes on another cut", key: "e2", projectId: other });
    expect((await ed.as.query(api.bell.feed, {})).rows.map((r: { title: string }) => r.title)).toEqual(["Notes on their cut"]);
    expect((await bk.as.query(api.bell.feed, {})).rows.map((r: { kind: string }) => r.kind)).toEqual(["payments"]);
    expect((await w.heston.query(api.bell.feed, {})).rows).toHaveLength(6);
    // Settings › Notifications lists only an Editor's own kinds.
    expect((await ed.as.query(api.bell.prefs, {})).kinds.map((k: { kind: string }) => k.kind)).toEqual(["notes", "uploads"]);
    // Nothing for another business's owner, even with the same kinds.
    expect((await w.boss.query(api.bell.feed, {})).rows).toEqual([]);
  });

  test("N4 phone alerts: D146 defaults, per-kind switches, Turn all off, and every phone a person turns on", async () => {
    const w = await world();
    const p = await w.heston.query(api.bell.prefs, {});
    expect(p.kinds.filter((k: { phone: boolean }) => k.phone).map((k: { kind: string }) => k.kind)).toEqual(["quotes", "contracts", "payments", "messages"]);
    expect(p.kinds.every((k: { bell: boolean }) => k.bell)).toBe(true);
    await w.heston.mutation(api.bell.subscribe, { endpoint: "https://push.example/aaaaaaaaaaaa", p256dh: "p", auth: "a", label: "iPhone · Safari" });
    await w.heston.mutation(api.bell.subscribe, { endpoint: "https://push.example/bbbbbbbbbbbb", p256dh: "p", auth: "a", label: "Mac · Chrome" });
    await expect(w.heston.mutation(api.bell.subscribe, { endpoint: "javascript:alert(1)", p256dh: "p", auth: "a", label: "x" })).rejects.toThrow(/isn't valid/);
    await expect(w.maya.mutation(api.bell.subscribe, { endpoint: "https://push.example/cccccccccccc", p256dh: "p", auth: "a", label: "x" })).rejects.toThrow(/Not allowed/);
    expect((await w.heston.query(api.bell.prefs, {})).devices).toHaveLength(2);
    // The same phone signed in as someone else moves to them.
    const ed = await teamMember(w, "ed@x.example", "editor");
    await ed.as.mutation(api.bell.subscribe, { endpoint: "https://push.example/bbbbbbbbbbbb", p256dh: "p", auth: "a", label: "Mac · Chrome" });
    expect((await w.heston.query(api.bell.prefs, {})).devices.map((d: { label: string }) => d.label)).toEqual(["iPhone · Safari"]);
    // A payment schedules a phone alert; a kind switched off for the phone doesn't.
    const jobs = async () => w.t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((j) => j.name.includes("push")).length);
    await w.t.mutation(internal.bell.post, { businessId: w.A, kind: "payments", title: "Paid", key: "p1" });
    expect(await jobs()).toBe(1);
    await w.t.mutation(internal.bell.post, { businessId: w.A, kind: "uploads", title: "Files", key: "u1" });
    expect(await jobs()).toBe(1);
    await w.heston.mutation(api.bell.phoneAllOff, {});
    await w.t.mutation(internal.bell.post, { businessId: w.A, kind: "payments", title: "Paid again", key: "p2" });
    expect(await jobs()).toBe(1);
    expect((await w.heston.query(api.bell.prefs, {})).kinds.some((k: { phone: boolean }) => k.phone)).toBe(false);
    await w.heston.mutation(api.bell.unsubscribe, { endpoint: "https://push.example/aaaaaaaaaaaa" });
    expect((await w.heston.query(api.bell.prefs, {})).devices).toEqual([]);
  });

  test("N5 a gone phone is dropped; items older than 90 days are purged", async () => {
    const w = await world();
    await w.heston.mutation(api.bell.subscribe, { endpoint: "https://push.example/aaaaaaaaaaaa", p256dh: "p", auth: "a", label: "iPhone" });
    const sub = await w.t.run(async (ctx) => (await ctx.db.query("pushSubs").first())!._id);
    await w.t.mutation(internal.bell.pushResult, { subId: sub, gone: false, ok: false });
    expect(await w.t.run(async (ctx) => (await ctx.db.get(sub))?.fails)).toBe(1);
    await w.t.mutation(internal.bell.pushResult, { subId: sub, gone: true, ok: false });
    expect(await w.t.run(async (ctx) => ctx.db.get(sub))).toBeNull();
    const heston = await w.t.run(async (ctx) => (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "heston@wranglerproductions.com")).first())!._id as Id<"users">);
    await w.t.run(async (ctx) => {
      await ctx.db.insert("bellItems", { businessId: w.A, userId: heston, kind: "notes", title: "old", key: "o", at: Date.now() - 91 * 86_400_000 });
      await ctx.db.insert("bellItems", { businessId: w.A, userId: heston, kind: "notes", title: "new", key: "n", at: Date.now() - 80 * 86_400_000 });
    });
    expect(await w.t.mutation(internal.bell.purge, {})).toBe(1);
    expect((await w.heston.query(api.bell.feed, {})).rows.map((r: { title: string }) => r.title)).toEqual(["new"]);
  });
});
