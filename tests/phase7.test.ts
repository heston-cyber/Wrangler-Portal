// Phase 7 step 5 (Heston, Nov 18: "Onward"). T7.1: a business owner, their client and their vendor each go from the invite
// email to finished onboarding (the phone and computer layouts are checked by eye on the preview). Decision 4 of the
// read-back: sign-in codes for another business's people come from WranglerPortal; Wrangler's own people keep Wrangler
// Productions' name.
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
type Sent = { to: string; subject: string; text: string; from: string };
const stub = (mails: Sent[]) => vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text, from: b.from }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
  return new Response("{}", { status: 500 });
}));
const settle = async (w: W) => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const PW = "longenoughpassword";
const NORA = "nora@juniperash.example", PRIYA = "priya@fernfield.example", RILEY = "riley@chencuts.example", SAM = "sam@harbor.example";
const isCode = (m: Sent) => / is your WranglerPortal code$/.test(m.subject);

/** Makes a login from an invite: sign up, then the emailed code. Returns the session and the code email. */
async function join(w: W, mails: Sent[], email: string) {
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email, password: PW } });
  const code = mails.filter((m) => m.to === email && isCode(m)).pop()!;
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email, code: /\b(\d{6})\b/.exec(code.text)![1] } });
  const sub = await w.t.run(async (ctx) => {
    const u = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).unique())!;
    return `${u._id}|${await ctx.db.insert("authSessions", { userId: u._id, expirationTime: Date.now() + 3_600_000 })}`;
  });
  return { as: w.t.withIdentity({ subject: sub }), code };
}
const pdf = (w: W) => w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4 w9"], { type: "application/pdf" })));

describe("Phase 7 step 5", () => {
  test("T7.1 a business owner, their client and their vendor each go from the invite to finished onboarding; codes say WranglerPortal", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    // The owner: email 38, the code from WranglerPortal, then setup to the end.
    await w.heston.mutation(api.platform.invite, { business: "Juniper & Ash Studio", email: NORA });
    await settle(w);
    expect(mails.find((m) => m.to === NORA)!.subject).toBe("Heston Hill invited Juniper & Ash Studio to WranglerPortal");
    const { as: nora, code: noraCode } = await join(w, mails, NORA);
    expect(noraCode.from).toBe("WranglerPortal <review@wranglerportal.com>");
    await nora.mutation(api.business.updateSettings, { name: "Juniper & Ash Studio", legalName: "Juniper & Ash Studio LLC", accent: "#2F7BFF" });
    await nora.mutation(api.setup.step, { done: "business", at: 1 });
    await nora.mutation(api.business.updateSettings, { emailFromName: "Juniper & Ash", replyTo: "hello@juniperash.example" });
    await nora.mutation(api.setup.step, { done: "email", at: 2 });
    await nora.mutation(api.setup.saveRates, { hourly: 150 });
    await nora.mutation(api.setup.step, { done: "connections", at: 4 });
    mails.length = 0;
    await nora.mutation(api.setup.firstClient, { company: "Fern & Field", name: "Priya Shah", email: PRIYA });
    await settle(w);
    expect((await nora.query(api.setup.state, {})).finished).toBe(true);
    // Their client: the invite in Juniper & Ash's name, the code from WranglerPortal, then About you to the tour.
    expect(mails.find((m) => m.to === PRIYA)!.from).toMatch(/Juniper & Ash/);
    const { as: priya, code: priyaCode } = await join(w, mails, PRIYA);
    expect(priyaCode.from).toBe("WranglerPortal <review@wranglerportal.com>");
    expect(priyaCode.text).not.toMatch(/Wrangler Productions/);
    await priya.mutation(api.clientOnboard.about, { name: "Priya Shah" });
    await priya.mutation(api.clientOnboard.company, { billingName: "Priya Shah" });
    await priya.mutation(api.clientOnboard.step, { done: "prefs", at: 3 });
    await priya.mutation(api.clientOnboard.tour, { skipped: false });
    expect((await priya.query(api.clientOnboard.state, {})).done).toEqual({ about: true, company: true, prefs: true, tour: true });
    // Their vendor: email 37 in Juniper & Ash's name, the code from WranglerPortal, then Profile to the tour.
    mails.length = 0;
    await nora.mutation(api.vendors.add, { name: "Riley Chen", email: RILEY, roles: ["Editor"], rates: [], invite: true });
    await settle(w);
    const invite = mails.find((m) => m.to === RILEY)!;
    expect(invite.from).toMatch(/Juniper & Ash/);
    expect(invite.text).toContain("Juniper & Ash Studio added you as a vendor.");
    const { as: riley, code: rileyCode } = await join(w, mails, RILEY);
    expect(rileyCode.from).toBe("WranglerPortal <review@wranglerportal.com>");
    const J = (await riley.query(api.vendorPortal.businesses, {})).list[0].businessId as Id<"businesses">;
    await riley.mutation(api.vendorOnboard.profile, { businessId: J, name: "Riley Chen", roles: ["Editor"] });
    await riley.mutation(api.vendorPortal.setW9, { businessId: J, storageId: await pdf(w), name: "W-9.pdf" });
    await riley.mutation(api.vendorOnboard.payMethod, { businessId: J, method: "Zelle" });
    await riley.mutation(api.vendorOnboard.step, { businessId: J, at: 3 });
    await riley.mutation(api.vendorOnboard.tour, { businessId: J, skipped: false });
    expect(await riley.query(api.vendorOnboard.state, { businessId: J })).toMatchObject({ kind: "full", business: "Juniper & Ash Studio", done: { profile: true, w9: true, pay: true, tour: true } });
    // None of it reached Wrangler: Heston's lists don't show Juniper & Ash's client or vendor.
    expect(JSON.stringify(await w.heston.query(api.clients.directory, {}))).not.toContain("Fern & Field");
    expect((await w.heston.query(api.vendors.list, {})).map((x: { email: string }) => x.email)).not.toContain(RILEY);
  });

  test("decision 4: Wrangler's own people keep Wrangler Productions' name on their codes", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const personId = await w.heston.mutation(api.clients.addPerson, { clientId: w.harbor, email: SAM, name: "Sam", role: "contact" });
    await w.heston.mutation(api.clients.invitePerson, { personId });
    await settle(w);
    const { code } = await join(w, mails, SAM);
    expect(code.from).toBe("Wrangler Productions <review@wranglerportal.com>");
    // A password reset for a Wrangler client is Wrangler's too.
    mails.length = 0;
    await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "reset", email: SAM } });
    expect(mails.find((m) => m.to === SAM)!.from).toBe("Wrangler Productions <review@wranglerportal.com>");
  });
});
