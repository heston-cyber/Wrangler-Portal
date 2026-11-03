// Phase 5c (Nov 3): Site watch. Tests T5c.1–T5c.5 from the read-back (Heston approved, 12:02).
import { convexTest } from "convex-test";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { clean, isUrgent } from "../convex/siteWatch";

const modules = import.meta.glob("../convex/**/*.ts");
const api = anyApi;
const internal = anyApi;

beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });
afterEach(() => { vi.useRealTimers(); });

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    await ctx.db.insert("memberships", { businessId: a, email: "heston@wranglerproductions.com", userId: owner, role: "owner", createdAt: 0 });
    const b = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const boss = await ctx.db.insert("users", { email: "boss@otherfilms.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: b, email: "boss@otherfilms.example", userId: boss, role: "owner", createdAt: 1 });
    const maya = await ctx.db.insert("users", { email: "maya@harbor.example", name: "Maya", role: "client" });
    await ctx.db.insert("memberships", { businessId: a, email: "maya@harbor.example", userId: maya, role: "client", createdAt: 0 });
    const stranger = await ctx.db.insert("users", { email: "who@example.com", name: "Who" });
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    return { a, b, owner: await sess(owner), boss: await sess(boss), maya: await sess(maya), stranger: await sess(stranger) };
  });
  const as = (sub: string) => t.withIdentity({ subject: sub });
  return { t, ids, heston: as(ids.owner), boss: as(ids.boss), maya: as(ids.maya), stranger: as(ids.stranger) };
}

const findings = (w: Awaited<ReturnType<typeof setup>>) => w.t.run((ctx) => ctx.db.query("siteWatchFindings").collect());

test("T5c.5 a clean day: the check finds nothing, writes one run, and sends nothing", async () => {
  const w = await setup();
  expect(await w.t.mutation(internal.siteWatch.check, {})).toEqual({ found: 0, cleared: 0, open: 0 });
  expect(await findings(w)).toHaveLength(0);
  expect(await w.t.run((ctx) => ctx.db.query("siteWatchRuns").collect())).toHaveLength(1);
  expect(await w.t.run((ctx) => ctx.db.query("emailLog").collect())).toHaveLength(0);
  expect(await w.heston.query(api.siteWatch.summary, {})).toEqual({ open: 0, urgent: 0 });
});

test("T5c.1 a broken record is found and reported once, counted, and cleared when it's gone", async () => {
  const w = await setup();
  // A Sign Dropbox connection left with an error.
  await w.t.run(async (ctx) => { await ctx.db.insert("wsDropbox", { businessId: w.ids.a, accountId: "dbid:1", refreshToken: "r", connectedAt: 0, lastError: "expired_access_token for heston@wranglerproductions.com" }); });
  const r1 = await w.t.mutation(internal.siteWatch.check, {});
  expect(r1.found).toBeGreaterThanOrEqual(1);
  const again = await w.t.mutation(internal.siteWatch.check, {});
  expect(again.found).toBe(0); // reported once, not again each day
  const f = (await findings(w)).find((x) => x.key === "stored:wsDropbox.lastError")!;
  expect(f).toMatchObject({ status: "found", count: 1, hits: 1, area: "stored" });
  expect(f.detail).not.toContain("@wranglerproductions.com"); // addresses masked
  // Fixed: the next check clears it.
  await w.t.run(async (ctx) => { for (const r of await ctx.db.query("wsDropbox").collect()) await ctx.db.patch(r._id, { lastError: undefined }); });
  expect((await w.t.mutation(internal.siteWatch.check, {})).cleared).toBeGreaterThanOrEqual(1);
  expect((await findings(w)).find((x) => x.key === "stored:wsDropbox.lastError")).toMatchObject({ status: "cleared", count: 0 });
});

test("T5c.1 an email that fails is counted per kind; urgent for money; quiet after 7 days", async () => {
  const w = await setup();
  for (const kind of ["footage_offer", "footage_offer", "invoice"]) {
    await w.t.run(async (ctx) => { await ctx.db.insert("emailLog", { key: `k-${Math.random()}`, kind, to: "maya@harbor.example", at: Date.now() }); });
    const key = (await w.t.run((ctx) => ctx.db.query("emailLog").collect())).find((l) => l.kind === kind && !l.resendId)!.key;
    await w.t.mutation(internal.emails.unclaim, { key, error: "Resend 422: invalid to maya@harbor.example" });
  }
  const f = await findings(w);
  expect(f.find((x) => x.key === "email:footage_offer")).toMatchObject({ count: 2, status: "found", urgent: false });
  expect(f.find((x) => x.key === "email:invoice")).toMatchObject({ count: 1, urgent: true });
  expect(f.every((x) => !(x.detail ?? "").includes("harbor.example"))).toBe(true);
  // A sent email isn't a failure.
  await w.t.run(async (ctx) => { await ctx.db.insert("emailLog", { key: "ok", kind: "footage_offer", to: "x@y.example", at: 0, resendId: "re_1" }); });
  await w.t.mutation(internal.emails.unclaim, { key: "ok" });
  expect((await findings(w)).find((x) => x.key === "email:footage_offer")!.count).toBe(2);
  // Nothing new for 7 days: cleared.
  await w.t.run(async (ctx) => { for (const r of await ctx.db.query("siteWatchFindings").collect()) await ctx.db.patch(r._id, { lastAt: Date.now() - 8 * 86_400_000 }); });
  await w.t.mutation(internal.siteWatch.check, {});
  expect((await findings(w)).every((x) => x.status === "cleared")).toBe(true);
});

test("T5c.2 a fix is recorded only from a watch/ branch, never main; fixed once the problem is gone", async () => {
  const w = await setup();
  await w.t.mutation(internal.siteWatch.agentFound, { key: "tests:footage", title: "tests/footage.test.ts: 2 failing", detail: "expected 'paid'" });
  for (const branch of ["main", "phase2", "watch/", "release/x"]) {
    await expect(w.t.mutation(internal.siteWatch.agentFixReady, { key: "tests:footage", branch, note: "x" })).rejects.toThrow(/watch/);
  }
  await w.t.mutation(internal.siteWatch.agentFixReady, { key: "tests:footage", branch: "watch/footage-paid-date", note: "Fixed the paid date; on the preview, waiting for Heston's go" });
  expect((await findings(w))[0]).toMatchObject({ status: "fix_ready", branch: "watch/footage-paid-date" });
  expect(await w.t.mutation(internal.siteWatch.agentClear, { key: "tests:footage" })).toBe(true);
  expect((await findings(w))[0].status).toBe("fixed");
  // It came back: open again.
  await w.t.mutation(internal.siteWatch.agentFound, { key: "tests:footage", title: "tests/footage.test.ts: 1 failing" });
  expect((await findings(w))[0].status).toBe("found");
  await expect(w.t.mutation(internal.siteWatch.agentFound, { key: "anything goes", title: "x" })).rejects.toThrow();
  // Can't fix safely: it's Heston's, and urgent.
  await w.t.mutation(internal.siteWatch.agentNeedsYou, { key: "tests:footage", note: "Touches money: needs Heston" });
  expect((await findings(w))[0]).toMatchObject({ status: "needs_you", urgent: true });
  await w.t.mutation(internal.siteWatch.agentRun, { found: 1, cleared: 0, summary: "1 open, needs you" });
  const rep = await w.heston.query(api.siteWatch.report, {});
  expect(rep.open).toHaveLength(1);
  expect(rep.runs[0]).toMatchObject({ by: "agent", found: 1 });
});

test("T5c.3 nobody but the portal's admins sees or changes it: not another business's owner, a client or a stranger", async () => {
  const w = await setup();
  await w.t.mutation(internal.siteWatch.agentFound, { key: "page:/projects", title: "Console error on /projects (phone)" });
  const id = (await findings(w))[0]._id;
  for (const who of [w.boss, w.maya, w.stranger, w.t]) {
    await expect(who.query(api.siteWatch.report, {})).rejects.toThrow();
    expect(await who.query(api.siteWatch.summary, {})).toBeNull();
    await expect(who.mutation(api.siteWatch.markDone, { id })).rejects.toThrow();
  }
  expect((await findings(w))[0].status).toBe("found");
  expect(await w.heston.query(api.siteWatch.summary, {})).toEqual({ open: 1, urgent: 0 });
  await w.heston.mutation(api.siteWatch.markDone, { id });
  expect((await findings(w))[0].status).toBe("cleared");
});

test("T5c.4 urgent problems are marked urgent and sent nowhere until the support address exists", async () => {
  const w = await setup();
  await w.t.mutation(internal.siteWatch.agentFound, { key: "job:payments.stripeWebhook", title: "Background job failed: payments.stripeWebhook", detail: "No signature whsec_abcdefghijklmnop" });
  const f = (await findings(w))[0];
  expect(f.urgent).toBe(true);
  expect(f.detail).not.toContain("abcdefghijklmnop");
  expect(await w.t.run((ctx) => ctx.db.query("emailLog").collect())).toHaveLength(0);
  expect(await w.heston.query(api.siteWatch.summary, {})).toEqual({ open: 1, urgent: 1 });
});

test("T5c.1 a background job that failed in the last day is found, grouped by function", async () => {
  vi.useFakeTimers();
  const w = await setup();
  // A job that throws (no such problem to mark), twice.
  await w.t.run(async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.siteWatch.agentNeedsYou, { key: "tests:none", note: "x" });
    await ctx.scheduler.runAfter(0, internal.siteWatch.agentNeedsYou, { key: "tests:none", note: "y" });
  });
  await w.t.finishAllScheduledFunctions(vi.runAllTimers);
  await w.t.mutation(internal.siteWatch.check, {});
  const f = (await findings(w)).find((x) => x.area === "job")!;
  expect(f).toMatchObject({ key: "job:siteWatch.agentNeedsYou", count: 2, status: "found" });
  // convex-test keeps no error text on a failed job (real Convex does: state.error), so only the count is checked here.
});

test("the agent's door: shut without SITE_WATCH_KEY, refuses a wrong key, and never records a fix from main", async () => {
  const w = await setup();
  const call = (key: string | null, body: unknown) => w.t.fetch("/site-watch", { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) });
  const good = "k".repeat(40);
  delete process.env.SITE_WATCH_KEY;
  expect((await call(good, { action: "open" })).status).toBe(401); // no key set: shut
  process.env.SITE_WATCH_KEY = "short";
  expect((await call("short", { action: "open" })).status).toBe(401); // too short: shut
  process.env.SITE_WATCH_KEY = good;
  try {
    expect((await call(null, { action: "open" })).status).toBe(401);
    expect((await call("k".repeat(39), { action: "open" })).status).toBe(401);
    expect((await call(good, { action: "found", key: "page:/:phone", title: "Blank on phone" })).status).toBe(200);
    const open = await (await call(good, { action: "open" })).json();
    expect(open).toEqual([expect.objectContaining({ key: "page:/:phone", status: "found" })]);
    const main = await call(good, { action: "fixReady", key: "page:/:phone", branch: "main", note: "x" });
    expect(main.status).toBe(400);
    expect((await main.json()).error).toMatch(/watch/);
    expect((await call(good, { action: "fixReady", key: "page:/:phone", branch: "watch/blank-phone", note: "on its branch" })).status).toBe(200);
    expect((await call(good, { action: "check" })).status).toBe(200);
    expect((await call(good, { action: "delete everything" })).status).toBe(400);
    expect((await findings(w))[0]).toMatchObject({ status: "fix_ready", branch: "watch/blank-phone" });
  } finally {
    delete process.env.SITE_WATCH_KEY;
  }
});

test("clean() and isUrgent()", () => {
  expect(clean("to a.b@c.example failed, key sk_live_ABCDEFGHIJ")).toBe("to …@… failed, key sk_…");
  expect(clean("x".repeat(500)).length).toBeLessThanOrEqual(240);
  expect(isUrgent("email:footage_offer", 3)).toBe(false);
  expect(isUrgent("email:footage_offer", 12)).toBe(true);
  expect(isUrgent("stored:wsDocuments.finishError", 1)).toBe(true);
});
