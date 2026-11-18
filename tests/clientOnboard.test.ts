// Phase 7 step 3 (Heston, Nov 18: "Approved"): a new client's onboarding (D107, D111, D112, D114). T7.2 (client): each
// step saves, Finish later keeps the step. T7.7: someone a client adds gets nothing until the owner approves (email 39 to
// the owner); approving adds them and sends their invite; declining sends nothing. T7.8: a client who was here before
// Phase 7 sees only the tour. Another business's owner and the client themselves can't decide a request.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
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
const PW = "longenoughpassword";
const PRIYA = "priya@harbor.example";
const codeIn = (m: Sent) => /\b(\d{6})\b/.exec(m.text)![1];

async function newClient(w: W, mails: Sent[]) {
  const personId = await w.heston.mutation(api.clients.addPerson, { clientId: w.harbor, email: PRIYA, name: "Priya", role: "contact" });
  await w.heston.mutation(api.clients.invitePerson, { personId });
  await settle(w);
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email: PRIYA, password: PW, name: "Priya" } });
  const code = codeIn(mails.filter((m) => m.to === PRIYA).pop()!);
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: PRIYA, code } });
  const sub = await w.t.run(async (ctx) => {
    const u = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", PRIYA)).unique())!;
    return `${u._id}|${await ctx.db.insert("authSessions", { userId: u._id, expirationTime: Date.now() + 3_600_000 })}`;
  });
  return w.t.withIdentity({ subject: sub });
}

describe("Phase 7 step 3 · a new client's onboarding", () => {
  test("T7.8 a client from before Phase 7 sees only the tour; the owner and a stranger have no client onboarding", async () => {
    const w = await world();
    stub([]);
    const st = await w.maya.query(api.clientOnboard.state, {});
    expect(st).toMatchObject({ existing: true, company: "Harbor Coffee", business: "Wrangler Productions", done: { tour: false } });
    await w.maya.mutation(api.clientOnboard.tour, { skipped: false });
    expect((await w.maya.query(api.clientOnboard.state, {})).done.tour).toBe(true);
    expect(await w.heston.query(api.clientOnboard.state, {})).toBeNull();
    expect(await w.t.query(api.clientOnboard.state, {})).toBeNull();
    await expect(w.heston.mutation(api.clientOnboard.about, { name: "Not a client" })).rejects.toThrow(/Not allowed/);
  });

  test("T7.2 a new client: About you, Your company, Finish later keeps the step", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const priya = await newClient(w, mails);
    let st = await priya.query(api.clientOnboard.state, {});
    expect(st).toMatchObject({ existing: false, step: 0, company: "Harbor Coffee", done: { about: false, company: false, prefs: false, tour: false } });
    await expect(priya.mutation(api.clientOnboard.about, { name: "Priya Shah", phone: "call me" })).rejects.toThrow(/phone/);
    await priya.mutation(api.clientOnboard.about, { name: "Priya Shah", title: "Marketing Lead", phone: "(405) 555-0101" });
    await priya.mutation(api.clientOnboard.step, { at: 1 }); // Finish later on Your company
    st = await priya.query(api.clientOnboard.state, {});
    expect(st).toMatchObject({ step: 1, done: { about: true, company: false }, about: { name: "Priya Shah", title: "Marketing Lead", phone: "(405) 555-0101" } });
    await expect(priya.mutation(api.clientOnboard.company, { billingEmail: "not an email" })).rejects.toThrow(/billing email/);
    await priya.mutation(api.clientOnboard.company, { billingName: "Priya Shah", billingEmail: "Billing@Harbor.example", address: "1 Dock St, Tulsa, OK", colors: ["#3b2a2d", "#E8D8C4", "nope"] });
    st = await priya.query(api.clientOnboard.state, {});
    expect(st.billing).toEqual({ name: "Priya Shah", email: "billing@harbor.example", address: "1 Dock St, Tulsa, OK" });
    expect(st.brand.colors).toEqual(["#3B2A2D", "#E8D8C4"]);
    expect(st.done.company).toBe(true);
    // The company's brand kit, as the owner sees it, has the colours.
    const kit = await w.t.run(async (ctx) => (await ctx.db.get(w.harbor))!.brandKit as { colors: Array<{ hex: string }> });
    expect(kit.colors.map((c) => c.hex)).toEqual(["#3B2A2D", "#E8D8C4"]);
  });

  test("T7.7 someone a client adds waits for the owner: email 39 to the owner, nothing to them until approved; decline sends nothing", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const priya = await newClient(w, mails);
    await priya.mutation(api.clientOnboard.about, { name: "Priya Shah" });
    mails.length = 0;
    await priya.mutation(api.clientOnboard.askColleague, { email: "Dan@Harbor.example", name: "Dan Ortiz" });
    await priya.mutation(api.clientOnboard.askColleague, { email: "lee@harbor.example" });
    await expect(priya.mutation(api.clientOnboard.askColleague, { email: "dan@harbor.example" })).rejects.toThrow(/already asked/);
    await expect(priya.mutation(api.clientOnboard.askColleague, { email: "maya@harbor.example" })).rejects.toThrow(/already have access/);
    await settle(w);
    expect(mails.filter((m) => m.to === "dan@harbor.example" || m.to === "lee@harbor.example")).toEqual([]);
    const owner = mails.find((m) => m.to === "heston@wranglerproductions.com" && /wants to add Dan Ortiz/.test(m.subject))!;
    expect(owner.subject).toBe("Priya Shah wants to add Dan Ortiz");
    expect(owner.text).toContain(`https://app.wranglerportal.com/clients/${w.harbor}`);
    const list = await w.heston.query(api.clientOnboard.requests, { clientId: w.harbor });
    expect(list.map((r: { email: string }) => r.email).sort()).toEqual(["dan@harbor.example", "lee@harbor.example"]);
    const dan = list.find((r: { email: string }) => r.email === "dan@harbor.example")!, lee = list.find((r: { email: string }) => r.email === "lee@harbor.example")!;
    // Only the owner (or a team member with Clients) decides: not the client, not another business.
    await expect(priya.mutation(api.clientOnboard.decide, { requestId: dan._id, approve: true })).rejects.toThrow();
    await expect(w.boss.mutation(api.clientOnboard.decide, { requestId: dan._id, approve: true })).rejects.toThrow(/isn't here/); // not theirs: invisible
    expect(await w.boss.query(api.clientOnboard.requests, { clientId: w.harbor })).toEqual([]);
    expect((await w.heston.query(api.clientOnboard.requests, { clientId: w.harbor })).length).toBe(2);
    mails.length = 0;
    await w.heston.mutation(api.clientOnboard.decide, { requestId: dan._id, approve: true });
    await w.heston.mutation(api.clientOnboard.decide, { requestId: lee._id, approve: false });
    await settle(w);
    expect(mails.map((m) => m.to)).toEqual(["dan@harbor.example"]);
    const people = await w.t.run((ctx) => ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", w.harbor)).collect());
    expect(people.find((p) => p.email === "dan@harbor.example")).toMatchObject({ role: "contact", name: "Dan Ortiz" });
    expect(people.find((p) => p.email === "lee@harbor.example")).toBeUndefined();
    expect((await priya.query(api.clientOnboard.state, {})).asked.map((r: { email: string; status: string }) => [r.email, r.status]).sort()).toEqual([["dan@harbor.example", "approved"], ["lee@harbor.example", "declined"]]);
  });
});
