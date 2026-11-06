// Phase 5e step 2 (Nov 5): Settings › Security. Change password (email 51, other devices signed out), five wrong tries
// rest the sign-in (D146), change email with a code to the new address (D158: the login and the person's contact rows
// move; email 50 to the old address), and devices (email 47 for an owner or team member on a new browser).
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";

const api = anyApi;
beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://x.convex.site";
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
const settle = async (w: W) => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const codeIn = (m: Sent) => /\b(\d{6})\b/.exec(m.text)![1];
const PW = "longenoughpassword";
const CASEY = "casey@harbor.example";

/** An invited client with a real password account; returns a session for them. */
async function account(w: W, mails: Sent[], email = CASEY) {
  await w.heston.mutation(api.clients.invite, { email, name: "Casey" });
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email, password: PW } });
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email, code: codeIn(mails.filter((m) => m.to === email).pop()!) } });
  return session(w, email);
}
async function session(w: W, email: string) {
  const sub = await w.t.run(async (ctx) => {
    const u = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).unique())!;
    return `${u._id}|${await ctx.db.insert("authSessions", { userId: u._id, expirationTime: Date.now() + 3_600_000 })}`;
  });
  return { as: w.t.withIdentity({ subject: sub }), userId: sub.split("|")[0] as Id<"users">, sessionId: sub.split("|")[1] as Id<"authSessions"> };
}
const signInWith = (w: W, email: string, password: string) => w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", email, password } }) as Promise<{ tokens?: unknown }>;

describe("Phase 5e · Security", () => {
  test("S1 change password: the current one is checked; other devices are signed out; email 51", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const c = await account(w, mails);
    const other = await session(w, CASEY);
    expect(await c.as.action(api.security.changePassword, { current: "not my password", next: "brandnewpassword1" })).toEqual({ error: "wrong" });
    expect(await c.as.action(api.security.changePassword, { current: PW, next: "short" })).toEqual({ error: "short" });
    expect(await c.as.action(api.security.changePassword, { current: PW, next: "brandnewpassword1" })).toEqual({ ok: true });
    await settle(w);
    expect(mails.find((m) => m.subject === "Your portal password was changed")?.to).toBe(CASEY);
    expect((await signInWith(w, CASEY, "brandnewpassword1")).tokens).toBeTruthy();
    await expect(signInWith(w, CASEY, PW)).rejects.toThrow();
    // This device stays signed in; the other one is gone.
    const sessions = await w.t.run((ctx) => ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", c.userId)).collect());
    expect(sessions.map((s) => s._id)).toContain(c.sessionId);
    expect(sessions.map((s) => s._id)).not.toContain(other.sessionId);
    expect((await c.as.query(api.security.state, {})).passwordChangedAt).toBeGreaterThan(Date.now() - 60_000);
    // A call-sheet guest or someone signed out can't.
    await expect(w.t.action(api.security.changePassword, { current: PW, next: "brandnewpassword2" })).rejects.toThrow(/Sign in first/);
  }, 30_000);

  test("S2 five wrong passwords rest the sign-in; the page can say so; an unknown email says nothing", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    await account(w, mails);
    expect(await w.t.query(api.security.signInLocked, { email: CASEY })).toEqual({ locked: false });
    for (let i = 0; i < 5; i++) await expect(signInWith(w, CASEY, "wrong password " + i)).rejects.toThrow();
    const lock = await w.t.query(api.security.signInLocked, { email: CASEY });
    expect(lock).toMatchObject({ locked: true });
    expect(lock.minutes).toBeGreaterThanOrEqual(10);
    // Even the right password waits now.
    await expect(signInWith(w, CASEY, PW)).rejects.toThrow();
    expect(await w.t.query(api.security.signInLocked, { email: "nobody@else.example" })).toEqual({ locked: false });
  }, 30_000);

  test("S3 change email: a code to the new address; the login and the person's rows move; email 50 to the old address", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    // Maya is Harbor Coffee's client person; give her a password account the way she'd have one.
    await w.t.run(async (ctx) => { const u = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "maya@harbor.example")).unique())!; await ctx.db.insert("authAccounts", { userId: u._id, provider: "password", providerAccountId: "maya@harbor.example", secret: "x" } as never); });
    await expect(w.maya.mutation(api.security.startEmailChange, { newEmail: "jo@harbor.example" })).rejects.toThrow(/already has a portal login/);
    await expect(w.maya.mutation(api.security.startEmailChange, { newEmail: "heston@wranglerproductions.com" })).rejects.toThrow(/already has a portal login/);
    await w.maya.mutation(api.security.startEmailChange, { newEmail: "Maya.New@Harbor.example" });
    await settle(w);
    const codeMail = mails.find((m) => m.to === "maya.new@harbor.example")!;
    expect(codeMail.subject).toMatch(/is your code to confirm your new email/);
    expect((await w.maya.query(api.security.state, {})).pending).toMatchObject({ newEmail: "maya.new@harbor.example" });
    expect(await w.maya.mutation(api.security.confirmEmailChange, { code: "000000" })).toEqual({ error: "wrong" });
    expect(await w.maya.mutation(api.security.confirmEmailChange, { code: codeIn(codeMail) })).toEqual({ ok: true, email: "maya.new@harbor.example" });
    await settle(w);
    const after = await w.t.run(async (ctx) => ({
      user: (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "maya.new@harbor.example")).unique())?.name,
      acct: (await ctx.db.query("authAccounts").withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", "maya.new@harbor.example")).unique()) !== null,
      ms: (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", "maya.new@harbor.example")).collect()).length,
      oldMs: (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", "maya@harbor.example")).collect()).length,
      person: (await ctx.db.query("clientPeople").collect()).filter((p) => p.email === "maya.new@harbor.example").length,
    }));
    expect(after).toEqual({ user: "Maya Brooks", acct: true, ms: 1, oldMs: 0, person: 1 });
    expect(mails.find((m) => m.to === "maya@harbor.example" && m.subject === "The email you sign in with was changed")?.text).toContain("maya.new@harbor.example");
    // She's still Harbor Coffee's client, under the new address.
    expect(await w.maya.query(api.users.me, {})).toMatchObject({ email: "maya.new@harbor.example", role: "client" });
  }, 30_000);

  test("S4 five wrong codes cancel the change; an expired code does nothing", async () => {
    const w = await world();
    stub([]);
    await w.maya.mutation(api.security.startEmailChange, { newEmail: "maya2@harbor.example" });
    for (let i = 0; i < 4; i++) expect(await w.maya.mutation(api.security.confirmEmailChange, { code: "000000" })).toEqual({ error: "wrong" });
    expect(await w.maya.mutation(api.security.confirmEmailChange, { code: "000000" })).toEqual({ error: "tooMany" });
    expect((await w.maya.query(api.security.state, {})).pending).toBeNull();
    await w.maya.mutation(api.security.startEmailChange, { newEmail: "maya2@harbor.example" });
    await w.t.run(async (ctx) => { for (const r of await ctx.db.query("emailChanges").collect()) await ctx.db.patch(r._id, { until: Date.now() - 1 }); });
    expect(await w.maya.mutation(api.security.confirmEmailChange, { code: "123456" })).toEqual({ error: "expired" });
    expect((await w.maya.query(api.users.me, {})).email).toBe("maya@harbor.example");
  }, 30_000);

  test("S5 devices: a new browser emails the owner (47), not a client; you can sign out your own other devices only", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const h1 = await session(w, "heston@wranglerproductions.com");
    const h2 = await session(w, "heston@wranglerproductions.com");
    await h1.as.mutation(api.security.seenDevice, { deviceKey: "macchromekey0000000000", label: "Mac · Chrome" });
    await h2.as.mutation(api.security.seenDevice, { deviceKey: "iphonesafarikey0000000", label: "iPhone · Safari" });
    await settle(w);
    expect(mails.filter((m) => m.subject === "New sign-in to your portal").map((m) => m.text)).toEqual([expect.stringContaining("iPhone · Safari")]);
    const st = await h1.as.query(api.security.state, {});
    expect(st.devices.map((d: { label: string; current: boolean }) => [d.label, d.current]).sort()).toEqual([["Mac · Chrome", true], ["iPhone · Safari", false]]);
    // A client's new browsers don't email.
    const m1 = await session(w, "maya@harbor.example"), m2 = await session(w, "maya@harbor.example");
    await m1.as.mutation(api.security.seenDevice, { deviceKey: "mayakeyone000000000000", label: "Mac · Safari" });
    await m2.as.mutation(api.security.seenDevice, { deviceKey: "mayakeytwo000000000000", label: "iPhone · Safari" });
    await settle(w);
    expect(mails.filter((m) => m.to === "maya@harbor.example")).toEqual([]);
    // Someone else's device, or the one you're on, can't be signed out from here.
    await expect(m1.as.mutation(api.security.signOutDevice, { sessionId: h2.sessionId })).rejects.toThrow(/isn't yours/);
    await expect(h1.as.mutation(api.security.signOutDevice, { sessionId: h1.sessionId })).rejects.toThrow(/Sign out/);
    await h1.as.mutation(api.security.signOutDevice, { sessionId: h2.sessionId });
    expect(await w.t.run((ctx) => ctx.db.get(h2.sessionId))).toBeNull();
    expect((await h1.as.query(api.security.state, {})).devices.map((d: { label: string }) => d.label)).toEqual(["Mac · Chrome"]);
  }, 30_000);
});
