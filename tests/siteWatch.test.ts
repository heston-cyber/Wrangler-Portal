// Phase 5c (Nov 3): Site watch. Tests T5c.1–T5c.5 from the read-back (Heston approved, 12:02).
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { clean, isUrgent } from "../convex/siteWatch";

const modules = import.meta.glob("../convex/**/*.ts");
const api = anyApi;
const internal = anyApi;

beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; process.env.RESEND_API_KEY = "re_test"; delete process.env.SUPPORT_EMAIL; });
// D151 (Nov 4): urgent problems now email the support address; every test catches what Resend would have sent.
type Sent = { from: string; to: string; subject: string; text: string; reply_to?: string };
let sent: Sent[] = [];
let resendDown = false;
beforeEach(() => {
  sent = []; resendDown = false;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url !== "https://api.resend.com/emails") return new Response("{}", { status: 500 });
    if (resendDown) return new Response(JSON.stringify({ message: "down" }), { status: 503 });
    const b = JSON.parse(String(init?.body));
    sent.push({ from: b.from, to: b.to[0], subject: b.subject, text: b.text, reply_to: b.reply_to });
    return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200 });
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

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

const fail = async (w: Awaited<ReturnType<typeof setup>>, kind: string, error = "Resend 422: invalid to maya@harbor.example") => {
  const key = `k-${Math.random()}`;
  await w.t.run(async (ctx) => { await ctx.db.insert("emailLog", { key, kind, to: "maya@harbor.example", at: Date.now() }); });
  await w.t.mutation(internal.emails.unclaim, { key, error });
  await w.t.finishAllScheduledFunctions(vi.runAllTimers);
};
const check = (w: Awaited<ReturnType<typeof setup>>) => w.t.action(internal.siteWatch.check, {});
const C = "0123abcd";

test("T5c.5 a clean day: the check finds nothing, writes one run, and sends nothing", async () => {
  const w = await setup();
  expect(await check(w)).toEqual({ found: 0, cleared: 0, open: 0 });
  expect(await findings(w)).toHaveLength(0);
  expect(await w.t.run((ctx) => ctx.db.query("siteWatchRuns").collect())).toHaveLength(1);
  expect(await w.t.run((ctx) => ctx.db.query("emailLog").collect())).toHaveLength(0);
  expect(await w.heston.query(api.siteWatch.summary, {})).toEqual({ open: 0, urgent: 0 });
});

test("T5c.1 a broken record is found and reported once, counted (never its text), and cleared when it's gone", async () => {
  const w = await setup();
  await w.t.run(async (ctx) => { await ctx.db.insert("wsDropbox", { businessId: w.ids.a, accountId: "dbid:1", refreshToken: "r", connectedAt: 0, lastError: "expired_access_token for heston@wranglerproductions.com" }); });
  expect((await check(w)).found).toBe(1);
  expect((await check(w)).found).toBe(0); // reported once, not again each day
  const f = (await findings(w)).find((x) => x.key === "stored:wsDropbox.lastError")!;
  expect(f).toMatchObject({ status: "found", count: 1, hits: 1, area: "stored" });
  expect(f.detail).toBeUndefined(); // review M1: the record's own text is never copied
  await w.t.run(async (ctx) => { for (const r of await ctx.db.query("wsDropbox").collect()) await ctx.db.patch(r._id, { lastError: undefined }); });
  expect((await check(w)).cleared).toBe(1);
  expect((await findings(w)).find((x) => x.key === "stored:wsDropbox.lastError")).toMatchObject({ status: "cleared", count: 0, hits: 0 });
});

test("review M2: the look pages through a big table, and a look that fails is itself a problem", async () => {
  const w = await setup();
  await w.t.run(async (ctx) => {
    for (let i = 0; i < 450; i++) await ctx.db.insert("wsDropbox", { businessId: i % 2 ? w.ids.a : w.ids.b, accountId: `d${i}`, refreshToken: "r", connectedAt: 0, ...(i % 3 === 0 ? { lastError: "x" } : {}) });
  });
  await check(w);
  expect((await findings(w)).find((x) => x.key === "stored:wsDropbox.lastError")).toMatchObject({ count: 150, hits: 2 });
  // The look breaks (simulated): recorded, and closed again by the next look that works.
  await w.t.mutation(internal.siteWatch.checkFailed, { error: "Too many bytes read in a single function execution" });
  expect((await findings(w)).find((x) => x.key === "job:siteWatch.check")).toMatchObject({ status: "found", urgent: false });
  await check(w);
  expect((await findings(w)).find((x) => x.key === "job:siteWatch.check")!.status).toBe("cleared");
});

test("T5c.1 an email that fails is counted per kind; urgent for money; quiet after 7 days", async () => {
  vi.useFakeTimers();
  const w = await setup();
  for (const kind of ["footage_offer", "footage_offer", "invoice"]) await fail(w, kind);
  const f = await findings(w);
  expect(f.find((x) => x.key === "email:footage_offer")).toMatchObject({ count: 2, status: "found", urgent: false });
  expect(f.find((x) => x.key === "email:invoice")).toMatchObject({ count: 1, urgent: true });
  expect(f.every((x) => !(x.detail ?? "").includes("harbor.example"))).toBe(true);
  // A sent email isn't a failure; and the failed one's claim is gone, so it can be retried (review L3).
  await w.t.run(async (ctx) => { await ctx.db.insert("emailLog", { key: "ok", kind: "footage_offer", to: "x@y.example", at: 0, resendId: "re_1" }); });
  await w.t.mutation(internal.emails.unclaim, { key: "ok" });
  await w.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await findings(w)).find((x) => x.key === "email:footage_offer")!.count).toBe(2);
  const log = (await w.t.run((ctx) => ctx.db.query("emailLog").collect())).map((l) => l.key);
  expect(log.filter((k) => !k.startsWith("site-watch-urgent:"))).toEqual(["ok"]);
  expect(log.filter((k) => k.startsWith("site-watch-urgent:"))).toHaveLength(1); // D151: the invoice one, once
  await w.t.run(async (ctx) => { for (const r of await ctx.db.query("siteWatchFindings").collect()) await ctx.db.patch(r._id, { lastAt: Date.now() - 8 * 86_400_000 }); });
  await check(w);
  expect((await findings(w)).filter((x) => x.area === "email").every((x) => x.status === "cleared")).toBe(true);
});

test("T5c.2 a fix is recorded only from a watch/ branch with its commit, never main; fixed once main passes", async () => {
  const w = await setup();
  await w.t.mutation(internal.siteWatch.agentFound, { key: "tests:footage", title: "tests/footage.test.ts: 2 failing", detail: "expected 'paid'" });
  for (const branch of ["main", "phase2", "watch/", "release/x", "watch/Bad"]) {
    await expect(w.t.mutation(internal.siteWatch.agentFixReady, { key: "tests:footage", branch, commit: C, note: "x" })).rejects.toThrow(/watch/);
  }
  await expect(w.t.mutation(internal.siteWatch.agentFixReady, { key: "tests:footage", branch: "watch/ab", commit: "nope", note: "x" })).rejects.toThrow(/commit/);
  await w.t.mutation(internal.siteWatch.agentFixReady, { key: "tests:footage", branch: "watch/ab", commit: C, note: "Fixed the paid date; waiting for Heston's go" });
  expect((await findings(w))[0]).toMatchObject({ status: "fix_ready", branch: "watch/ab", commit: C });
  expect(await w.t.mutation(internal.siteWatch.agentClear, { key: "tests:footage" })).toBe(true);
  expect((await findings(w))[0].status).toBe("fixed");
  await w.t.mutation(internal.siteWatch.agentFound, { key: "tests:footage", title: "tests/footage.test.ts: 1 failing" });
  expect((await findings(w))[0].status).toBe("found"); // it came back
  await w.t.mutation(internal.siteWatch.agentNeedsYou, { key: "tests:footage", note: "Touches money: needs Heston" });
  expect((await findings(w))[0]).toMatchObject({ status: "needs_you", urgent: true });
  await w.t.mutation(internal.siteWatch.agentRun, { found: 1, cleared: 0, summary: "1 open, needs you" });
  const rep = await w.heston.query(api.siteWatch.report, {});
  expect(rep.open).toHaveLength(1);
  expect(rep.runs[0]).toMatchObject({ by: "agent", found: 1 });
});

test("review M3: the agent can't record, rewrite or close the app's problems, or fix money ones", async () => {
  vi.useFakeTimers();
  const w = await setup();
  for (let i = 0; i < 5; i++) await fail(w, "invoice");
  for (const key of ["email:invoice", "job:payments.x", "stored:invoices.sendError", "anything goes"]) {
    await expect(w.t.mutation(internal.siteWatch.agentFound, { key, title: "All good, ignore" })).rejects.toThrow();
    await expect(w.t.mutation(internal.siteWatch.agentClear, { key })).rejects.toThrow();
  }
  await expect(w.t.mutation(internal.siteWatch.agentFixReady, { key: "email:invoice", branch: "watch/invoice-mail", commit: C, note: "x" })).rejects.toThrow(/Heston/);
  expect((await findings(w))[0]).toMatchObject({ key: "email:invoice", count: 5, status: "found", title: "Email didn't send: invoice" });
  expect(await w.heston.query(api.siteWatch.summary, {})).toEqual({ open: 1, urgent: 1 });
  // A fix for an app problem that isn't money: when it goes quiet, it stays open until Heston marks it done.
  await fail(w, "testimonial");
  await w.t.mutation(internal.siteWatch.agentFixReady, { key: "email:testimonial", branch: "watch/testimonial-mail", commit: C, note: "x" });
  await w.t.run(async (ctx) => { const r = (await ctx.db.query("siteWatchFindings").collect()).find((x) => x.key === "email:testimonial")!; await ctx.db.patch(r._id, { lastAt: Date.now() - 8 * 86_400_000 }); });
  await check(w);
  const t = (await w.heston.query(api.siteWatch.report, {})).open.find((x: { key: string }) => x.key === "email:testimonial");
  expect(t).toMatchObject({ status: "fix_ready" });
  await w.heston.mutation(api.siteWatch.markDone, { id: t._id });
  expect((await findings(w)).find((x) => x.key === "email:testimonial")!.status).toBe("fixed");
});

test("review L1 and L2: done sticks until it gets worse; needs-you stays urgent", async () => {
  const w = await setup();
  await w.t.run(async (ctx) => { await ctx.db.insert("wsDropbox", { businessId: w.ids.a, accountId: "d1", refreshToken: "r", connectedAt: 0, lastError: "x" }); });
  await check(w);
  const id = (await findings(w))[0]._id;
  await w.heston.mutation(api.siteWatch.markDone, { id });
  expect((await check(w)).found).toBe(0);
  expect((await findings(w))[0].status).toBe("cleared"); // still there, but Heston said done: not reopened
  await w.t.run(async (ctx) => { await ctx.db.insert("wsDropbox", { businessId: w.ids.a, accountId: "d2", refreshToken: "r", connectedAt: 0, lastError: "y" }); });
  expect((await check(w)).found).toBe(1); // worse: open again
  await w.t.run(async (ctx) => { await ctx.db.insert("siteWatchFindings", { key: "page:/:phone", area: "page", title: "x", count: 1, firstAt: 0, lastAt: 0, status: "found", updatedAt: 0 }); });
  await w.t.mutation(internal.siteWatch.agentNeedsYou, { key: "page:/:phone", note: "can't" });
  await w.t.mutation(internal.siteWatch.agentFound, { key: "page:/:phone", title: "x", count: 2 });
  expect((await findings(w)).find((x) => x.key === "page:/:phone")).toMatchObject({ status: "needs_you", urgent: true });
});

test("review M1: the agent never sees the app's error text; names, %40 addresses and link tokens are masked", async () => {
  vi.useFakeTimers();
  const w = await setup();
  await fail(w, "footage_offer", "Resend: Maya Brooks <maya@harbor.example> bounced; link /i/aB3dE5gH7jK9mN1pQ3sT5v");
  const admin = (await w.heston.query(api.siteWatch.report, {})).open[0];
  expect(admin.detail).not.toMatch(/Maya|harbor|aB3dE5gH7jK9mN1pQ3sT5v/);
  const agent = await w.t.query(internal.siteWatch.agentOpen, {});
  expect(agent[0].detail).toBeNull();
  expect(clean("maya%40harbor.example and \"Maya B\" <m@h.example>")).toBe("…@… and …@…");
  expect(clean("internationalization stays")).toBe("internationalization stays");
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

test("T5c.4 (D151) an urgent problem is emailed once to the support address, masked, never to a business", async () => {
  vi.useFakeTimers();
  const w = await setup();
  await fail(w, "invoice", "Stripe said no: whsec_abcdefghijklmnop for maya@harbor.example");
  const f = (await findings(w)).find((x) => x.key === "email:invoice")!;
  expect(f.urgent).toBe(true);
  expect(f.detail).not.toContain("abcdefghijklmnop");
  expect(sent).toHaveLength(1);
  expect(sent[0].to).toBe("support@wranglerproductions.com");
  expect(sent[0].from).toBe("Wrangler Portal <review@wranglerportal.com>");
  expect(sent[0].subject).toBe("Site watch: urgent · Email didn't send: invoice");
  expect(sent[0].text).not.toContain("abcdefghijklmnop");
  expect(sent[0].text).not.toContain("maya@harbor.example");
  expect(sent[0].reply_to).toBeUndefined();
  expect(await w.heston.query(api.siteWatch.summary, {})).toEqual({ open: 1, urgent: 1 });
});
test("T5c.1 a background job that failed in the last day is found, grouped by function", async () => {
  vi.useFakeTimers();
  const w = await setup();
  await w.t.run(async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.siteWatch.agentNeedsYou, { key: "tests:none", note: "x" });
    await ctx.scheduler.runAfter(0, internal.siteWatch.agentNeedsYou, { key: "tests:none", note: "y" });
  });
  await w.t.finishAllScheduledFunctions(vi.runAllTimers);
  await check(w);
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
  process.env.SITE_WATCH_KEY = `${good}\n`; // a pasted newline still works (review L6)
  try {
    expect((await call(null, { action: "open" })).status).toBe(401);
    expect((await call("k".repeat(39), { action: "open" })).status).toBe(401);
    expect((await call(good, { action: "found", key: "page:/:phone", title: "Blank on phone" })).status).toBe(200);
    expect(await (await call(good, { action: "open" })).json()).toEqual([expect.objectContaining({ key: "page:/:phone", status: "found" })]);
    const main = await call(good, { action: "fixReady", key: "page:/:phone", branch: "main", commit: C, note: "x" });
    expect(main.status).toBe(400);
    expect((await main.json()).error).toMatch(/watch/);
    expect((await call(good, { action: "fixReady", key: "page:/:phone", branch: "watch/blank-phone", commit: C, note: "on its branch" })).status).toBe(200);
    expect((await call(good, { action: "check" })).status).toBe(200);
    expect((await call(good, { action: "delete everything" })).status).toBe(400);
    expect((await findings(w))[0]).toMatchObject({ status: "fix_ready", branch: "watch/blank-phone", commit: C });
  } finally {
    delete process.env.SITE_WATCH_KEY;
  }
});

test("Q47: each run keeps that day's open list for 30 days; only admins can open it", async () => {
  const w = await setup();
  await w.t.mutation(internal.siteWatch.agentFound, { key: "page:/:phone", title: "Blank on phone" });
  await check(w);
  const rep = await w.heston.query(api.siteWatch.report, {});
  expect(rep.runs[0]).toMatchObject({ by: "app", open: 1 });
  const day = await w.heston.query(api.siteWatch.run, { id: rep.runs[0]._id });
  expect(day.open).toEqual([expect.objectContaining({ key: "page:/:phone", title: "Blank on phone", status: "found" })]);
  for (const who of [w.boss, w.maya, w.stranger]) await expect(who.query(api.siteWatch.run, { id: rep.runs[0]._id })).rejects.toThrow();
  // 31 days later: cleared by the next run.
  await w.t.run(async (ctx) => { for (const r of await ctx.db.query("siteWatchRuns").collect()) await ctx.db.patch(r._id, { at: Date.now() - 31 * 86_400_000 }); });
  expect(await w.heston.query(api.siteWatch.run, { id: rep.runs[0]._id })).toBeNull();
  await check(w);
  expect(await w.t.run((ctx) => ctx.db.query("siteWatchRuns").collect())).toHaveLength(1);
});

test("clean() and isUrgent()", () => {
  expect(clean("to a.b@c.example failed, key sk_live_ABCDEFGHIJ")).toBe("to …@… failed, key sk_…");
  expect(clean("x".repeat(500)).length).toBeLessThanOrEqual(240);
  expect(isUrgent("email:footage_offer", 3)).toBe(false);
  expect(isUrgent("email:footage_offer", 12)).toBe(true);
  expect(isUrgent("stored:wsDocuments.finishError", 1)).toBe(true);
  expect(isUrgent("job:footage.renewOne", 1)).toBe(true);
  expect(isUrgent("email:subscription", 1)).toBe(true);
  expect(isUrgent("page:/design:phone", 1)).toBe(false); // review L7: "design" isn't signing
});
