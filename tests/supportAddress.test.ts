// D151 (Heston, Nov 4): Wrangler Portal is its own business. Its own mail goes to its support address
// (support@wranglerproductions.com); a business that uses the portal (Wrangler Productions included) gets its own mail
// through its own settings. Step "Platform address" (read-back approved Nov 4, 09:58).
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { REPLY_TO, SUPPORT } from "../convex/lib/email";

const modules = import.meta.glob("../convex/**/*.ts");
const api = anyApi;
const internal = anyApi;

type Sent = { from: string; to: string; subject: string; text: string };
let sent: Sent[] = [];
let resendDown = false;
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; process.env.RESEND_API_KEY = "re_test"; });
beforeEach(() => {
  sent = []; resendDown = false;
  delete process.env.SUPPORT_EMAIL; delete process.env.ALERT_EMAIL; delete process.env.EMAIL_ONLY_TO;
  vi.useFakeTimers();
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url !== "https://api.resend.com/emails") return new Response("{}", { status: 500 });
    if (resendDown) return new Response(JSON.stringify({ message: "down" }), { status: 503 });
    const b = JSON.parse(String(init?.body));
    sent.push({ from: b.from, to: b.to[0], subject: b.subject, text: b.text });
    return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200 });
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete process.env.SUPPORT_EMAIL; delete process.env.ALERT_EMAIL; });

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    await ctx.db.insert("memberships", { businessId: a, email: "heston@wranglerproductions.com", userId: owner, role: "owner", createdAt: 0 });
    const b = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const boss = await ctx.db.insert("users", { email: "boss@otherfilms.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: b, email: "boss@otherfilms.example", userId: boss, role: "owner", createdAt: 1 });
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    return { heston: await sess(owner), boss: await sess(boss) };
  });
  return { t, heston: t.withIdentity({ subject: ids.heston }), boss: t.withIdentity({ subject: ids.boss }) };
}
type W = Awaited<ReturnType<typeof setup>>;

const settle = (w: W) => w.t.finishAllScheduledFunctions(vi.runAllTimers);
const fail = async (w: W, kind: string, error = "Resend 422: invalid to maya@harbor.example") => {
  const key = `k-${Math.random()}`;
  await w.t.run(async (ctx) => { await ctx.db.insert("emailLog", { key, kind, to: "maya@harbor.example", at: Date.now() }); });
  await w.t.mutation(internal.emails.unclaim, { key, error });
  await settle(w);
};
const finding = (w: W, key: string) => w.t.run((ctx) => ctx.db.query("siteWatchFindings").withIndex("by_key", (q) => q.eq("key", key)).unique());
const urgentMails = () => sent.filter((m) => m.subject.startsWith("Site watch: urgent"));

test("T151.1 the portal's support address is support@wranglerproductions.com (SUPPORT_EMAIL can change it); replies with no reply-to go there", () => {
  expect(SUPPORT()).toBe("support@wranglerproductions.com");
  expect(REPLY_TO()).toBe("support@wranglerproductions.com");
  process.env.SUPPORT_EMAIL = "  help@wranglerportal.com ";
  expect(SUPPORT()).toBe("help@wranglerportal.com");
  expect(REPLY_TO()).toBe("help@wranglerportal.com");
});

test("T151.2 an urgent problem emails support once; again only after it closes and comes back; never a business owner", async () => {
  const w = await setup();
  await fail(w, "invoice");
  await fail(w, "invoice"); // same problem, still open: no second email
  expect(urgentMails()).toHaveLength(1);
  expect(urgentMails()[0].to).toBe("support@wranglerproductions.com");
  const f = (await finding(w, "email:invoice"))!;
  expect(f.alertedAt).toBeTypeOf("number");
  await w.heston.mutation(api.siteWatch.markDone, { id: f._id });
  expect((await finding(w, "email:invoice"))!.alertedAt).toBeUndefined();
  vi.advanceTimersByTime(60_000); // a minute later (fake timers hold the clock still)
  await fail(w, "invoice"); // it comes back
  expect(urgentMails()).toHaveLength(2);
  expect(sent.every((m) => m.to === "support@wranglerproductions.com")).toBe(true);
  expect(sent.some((m) => /heston@|boss@/.test(m.to))).toBe(false);
});

test("T151.3 a non-urgent problem sends nothing until it repeats 10 times (then it's urgent: one email)", async () => {
  const w = await setup();
  await fail(w, "footage_offer");
  expect(sent).toHaveLength(0);
  for (let i = 0; i < 9; i++) await fail(w, "footage_offer");
  expect((await finding(w, "email:footage_offer"))!.urgent).toBe(true);
  expect(urgentMails()).toHaveLength(1);
  await fail(w, "footage_offer");
  expect(urgentMails()).toHaveLength(1);
});

test("T151.4 when the urgent email can't send, it's counted and tried again on the next write", async () => {
  const w = await setup();
  resendDown = true;
  await fail(w, "invoice");
  expect(sent).toHaveLength(0);
  expect((await finding(w, "email:invoice"))!.alertedAt).toBeUndefined();
  expect(await finding(w, "email:site_watch_urgent")).toMatchObject({ status: "found", urgent: false }); // not urgent itself: no loop
  resendDown = false;
  await fail(w, "invoice");
  expect(urgentMails()).toHaveLength(1);
});

test("T151.5 the agent handing a problem to Heston (needs you) emails support once", async () => {
  const w = await setup();
  await w.t.mutation(internal.siteWatch.agentFound, { key: "tests:footage", title: "Footage tests fail" });
  await settle(w);
  expect(sent).toHaveLength(0);
  await w.t.mutation(internal.siteWatch.agentNeedsYou, { key: "tests:footage", note: "Touches renewals; yours to decide." });
  await settle(w);
  expect(urgentMails()).toHaveLength(1);
  expect(urgentMails()[0].text).toContain("Touches renewals; yours to decide.");
  await w.t.mutation(internal.siteWatch.agentNeedsYou, { key: "tests:footage", note: "Still yours." });
  await settle(w);
  expect(urgentMails()).toHaveLength(1);
});

test("T151.6 on the preview (EMAIL_ONLY_TO without support@), the urgent email is held, not sent", async () => {
  const w = await setup();
  process.env.EMAIL_ONLY_TO = "heston@wranglerproductions.com";
  try {
    await fail(w, "invoice");
    expect(sent).toHaveLength(0);
  } finally { delete process.env.EMAIL_ONLY_TO; }
});

test("T151.7 Settings › Notifications: each business's own address only; the old ALERT_EMAIL isn't added for Wrangler", async () => {
  const w = await setup();
  process.env.ALERT_EMAIL = "alerts@wranglerproductions.com";
  expect((await w.heston.query(api.notifications.owner, {})).to).toEqual(["heston@wranglerproductions.com"]);
  expect((await w.boss.query(api.notifications.owner, {})).to).toEqual(["boss@otherfilms.example"]);
});
