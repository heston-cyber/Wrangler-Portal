// Phase 7 step 2 (Heston, Nov 18: "Approved"): a new business's setup (D109, D111, D114). T7.2 (business): Finish later
// keeps every answer and the step they were on; the Home checklist reflects what's done. T7.8: Wrangler never sees setup.
// T7.9: the new business's emails carry its own name. A team member and another business can't change it.
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
type Sent = { to: string; subject: string; text: string; from?: string };
const stub = (mails: Sent[]) => vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text, from: b.from }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
  return new Response("{}", { status: 500 });
}));
const settle = async (w: W) => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const PW = "longenoughpassword";
const NORA = "nora@juniperash.example";
const codeIn = (m: Sent) => /\b(\d{6})\b/.exec(m.text)![1];

async function newBusiness(w: W, mails: Sent[]) {
  await w.heston.mutation(api.platform.invite, { business: "Juniper & Ash Studio", email: NORA });
  await settle(w);
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email: NORA, password: PW, name: "Nora Ash" } });
  const code = codeIn(mails.filter((m) => m.to === NORA).pop()!);
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: NORA, code } });
  const sub = await w.t.run(async (ctx) => {
    const u = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", NORA)).unique())!;
    return `${u._id}|${await ctx.db.insert("authSessions", { userId: u._id, expirationTime: Date.now() + 3_600_000 })}`;
  });
  return w.t.withIdentity({ subject: sub });
}

describe("Phase 7 step 2 · a new business's setup", () => {
  test("T7.8 Wrangler never sees setup; another business's owner and a client can't change it", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    expect(await w.heston.query(api.setup.state, {})).toBeNull();
    await expect(w.heston.mutation(api.setup.saveRates, { hourly: 1 })).rejects.toThrow(/Settings › Pricing/);
    await expect(w.heston.mutation(api.setup.firstClient, { company: "X Co", name: "X", email: "x@x.example" })).rejects.toThrow(/Clients › Companies/);
    const nora = await newBusiness(w, mails);
    expect(await nora.query(api.setup.state, {})).toMatchObject({ business: "Juniper & Ash Studio", first: "Nora", step: 0, finished: false, hidden: false,
      done: { business: false, email: false, pricing: false, connections: false, client: false }, connections: { stripe: false, dropbox: false, claude: false, calendar: false } });
    expect(await w.maya.query(api.setup.state, {})).toBeNull();
    expect(await w.t.query(api.setup.state, {})).toBeNull();
    await expect(w.maya.mutation(api.setup.step, { done: "business", at: 1 })).rejects.toThrow();
    await w.heston.mutation(api.setup.step, { done: "business", at: 1 }); // Heston's own business: nothing happens
    expect((await nora.query(api.setup.state, {})).done.business).toBe(false);
  });

  test("T7.2 each step saves; Finish later keeps the step; pricing makes rates; the first client is invited in the business's own name; all done ends setup", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const nora = await newBusiness(w, mails);
    // Step 2 (with the business's own settings mutation) and Finish later on step 3.
    await nora.mutation(api.business.updateSettings, { name: "Juniper & Ash Studio", legalName: "Juniper & Ash Studio LLC", accent: "#2F7BFF", background: "#06080D" });
    await nora.mutation(api.setup.step, { done: "business", at: 1 });
    await nora.mutation(api.setup.step, { at: 1 }); // Finish later on step 3
    let st = await nora.query(api.setup.state, {});
    expect(st).toMatchObject({ step: 1, done: { business: true, email: false } });
    // Step 3, step 4.
    await nora.mutation(api.business.updateSettings, { emailFromName: "Juniper & Ash", replyTo: "hello@juniperash.example", address: "1 Main St, Tulsa, OK 74103", privacyUrl: "https://juniperash.example/privacy" });
    await nora.mutation(api.setup.step, { done: "email", at: 2 });
    await expect(nora.mutation(api.setup.saveRates, { hourly: -5 })).rejects.toThrow(/\$0 or more/);
    await nora.mutation(api.setup.saveRates, { hourly: 150, daily: 1200, shooting: 200 });
    st = await nora.query(api.setup.state, {});
    expect(st.rates).toEqual({ hourly: 150, daily: 1200, shooting: 200, editing: null });
    expect(st.done.pricing).toBe(true);
    const r = await nora.query(api.crm.rates, {});
    expect(r.rates.kinds).toEqual([{ id: "shooting", name: "Shooting", unit: "hour", clientCents: 20000 }]);
    expect(r.rates.defaults).toEqual({ hourlyCents: 15000, dailyCents: 120000 });
    // Wrangler's rates are untouched.
    expect((await w.heston.query(api.crm.rates, {})).rates.kinds.find((k: { id: string }) => k.id === "travel")).toBeTruthy();
    await nora.mutation(api.setup.step, { done: "connections", at: 4 });
    // Step 6: the first client, emailed in Juniper & Ash's name (T7.9).
    mails.length = 0;
    await nora.mutation(api.setup.firstClient, { company: "Fern & Field", name: "Priya Shah", email: "Priya@FernAndField.example" });
    await settle(w);
    const invite = mails.find((m) => m.to === "priya@fernandfield.example")!;
    expect(invite.from).toMatch(/Juniper & Ash/);
    expect(invite.text).not.toMatch(/Wrangler Productions/);
    const dir = await nora.query(api.clients.directory, {});
    expect(JSON.stringify(dir)).toContain("Fern & Field");
    expect(JSON.stringify(await w.heston.query(api.clients.directory, {}))).not.toContain("Fern & Field"); // only Nora's
    st = await nora.query(api.setup.state, {});
    expect(st).toMatchObject({ finished: true, done: { business: true, email: true, pricing: true, connections: true, client: true } });
    expect((await w.heston.query(api.platform.overview, {})).rows.find((x: { name: string }) => x.name === "Juniper & Ash Studio")).toMatchObject({ status: "active", clients: 0 });
    // Hide the checklist.
    await nora.mutation(api.setup.hide, { hidden: true });
    expect((await nora.query(api.setup.state, {})).hidden).toBe(true);
  });
});
