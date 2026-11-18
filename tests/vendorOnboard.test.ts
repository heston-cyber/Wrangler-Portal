// Phase 7 step 4 (Heston, Nov 18: "Approved", "Onward"): a new vendor's onboarding (D108, D111, D94, D100, D101).
// Email 37 names their roles and opens the vendor side on that business. T7.2 (vendor): each step saves, Finish later
// keeps the step. T7.3: a vendor who works for two businesses does the login and profile once; the W-9 and payment method
// once per business, each kept to its business. A vendor from before Phase 7 sees only the tour. Owners, clients,
// strangers and another business's vendor are refused.
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
const PW = "longenoughpassword";
const RILEY = "riley@chencuts.example";
const codeIn = (m: Sent) => /\b(\d{6})\b/.exec(m.text)![1];
const pdf = (w: W) => w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4 w9"], { type: "application/pdf" })));

/** Riley, invited by Wrangler (A), makes a login with the emailed code. */
async function newVendor(w: W, mails: Sent[]) {
  const vendorId = await w.heston.mutation(api.vendors.add, { name: "Riley Chen", email: RILEY, roles: ["Editor", "Colourist"], rates: [{ role: "Editor", unit: "hour", cents: 7_500 }], invite: true }) as Id<"vendors">;
  await settle(w);
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email: RILEY, password: PW } });
  const code = codeIn(mails.filter((m) => m.to === RILEY).pop()!);
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: RILEY, code } });
  const sub = await w.t.run(async (ctx) => {
    const u = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", RILEY)).unique())!;
    return `${u._id}|${await ctx.db.insert("authSessions", { userId: u._id, expirationTime: Date.now() + 3_600_000 })}`;
  });
  return { vendorId, riley: w.t.withIdentity({ subject: sub }) };
}

describe("Phase 7 step 4 · a new vendor's onboarding", () => {
  test("email 37: their roles, who it's from, the 14-day link that opens this business's vendor side", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    await w.heston.mutation(api.vendors.add, { name: "Riley Chen", email: RILEY, roles: ["Editor", "Colourist"], rates: [], invite: true });
    await settle(w);
    const m = mails.find((x) => x.to === RILEY)!;
    expect(m.subject).toBe("Heston at Wrangler Productions invited you to WranglerPortal");
    expect(m.text).toContain("Wrangler Productions added you as a vendor.");
    expect(m.text).toMatch(/Roles:? Editor, Colourist/);
    expect(m.text).toMatch(/From:? Heston Hill/);
    expect(m.text).toContain("Set up takes about 5 minutes. You’ll create a password, then confirm your email with a code.");
    expect(m.text).toMatch(/The link works until [A-Z][a-z]{2} \d{1,2}\./);
    expect(m.text).toContain(`https://app.wranglerportal.com/?invited=${RILEY}&side=vendor&biz=${w.A}`);
    expect(m.text).toContain("Set up my vendor portal");
    expect(m.text).toContain("— Heston, Wrangler Productions");
  });

  test("T7.2 (vendor): Profile, W-9, Payment method and the tour; Finish later keeps the step", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { vendorId, riley } = await newVendor(w, mails);
    let st = await riley.query(api.vendorOnboard.state, { businessId: w.A });
    expect(st).toMatchObject({ kind: "full", step: 0, started: false, business: "Wrangler Productions",
      done: { profile: false, w9: false, pay: false, tour: false },
      profile: { name: "Riley Chen", roles: ["Editor", "Colourist"], rate: { cents: 7_500, unit: "hour" } } });
    // Profile (pre-filled from Add vendor), then Finish later on the W-9.
    await expect(riley.mutation(api.vendorOnboard.profile, { businessId: w.A, name: " ", roles: [] })).rejects.toThrow(/Add your name/);
    await riley.mutation(api.vendorOnboard.profile, { businessId: w.A, name: "Riley Chen", businessName: "Chen Cuts", roles: ["Editor", "Colourist"], rateCents: 7_500, rateUnit: "hour", basedIn: "Remote", gear: "DaVinci Resolve Studio, calibrated monitor", portfolio: "chencuts.com" });
    await riley.mutation(api.vendorOnboard.step, { businessId: w.A, at: 1 }); // Finish later on the W-9
    st = await riley.query(api.vendorOnboard.state, { businessId: w.A });
    expect(st).toMatchObject({ step: 1, started: true, done: { profile: true, w9: false }, profile: { businessName: "Chen Cuts", basedIn: "Remote", gear: "DaVinci Resolve Studio, calibrated monitor", portfolio: "chencuts.com" } });
    // An unchanged rate leaves the business's rates as typed; the owner sees the profile on the vendor page.
    const rec = await w.t.run((ctx) => ctx.db.get(vendorId));
    expect(rec).toMatchObject({ businessName: "Chen Cuts", gear: ["DaVinci Resolve Studio", "calibrated monitor"], rates: [{ role: "Editor", unit: "hour", cents: 7_500 }] });
    // W-9 through the Settings upload (one per business, D100).
    const storageId = await pdf(w);
    expect(await riley.mutation(api.vendorPortal.setW9, { businessId: w.A, storageId, name: "W-9 Riley.pdf" })).toEqual({ ok: true });
    // Payment method: the method and a note only (D101).
    await expect(riley.mutation(api.vendorOnboard.payMethod, { businessId: w.A, method: "ACH", note: "Routing 123456789, account 000123456789" })).rejects.toThrow(/account and routing numbers/);
    await expect(riley.mutation(api.vendorOnboard.payMethod, { businessId: w.A, method: "Bitcoin" })).rejects.toThrow(/Pick how you get paid/);
    await riley.mutation(api.vendorOnboard.payMethod, { businessId: w.A, method: "ACH", note: "Same account as my last invoice." });
    await riley.mutation(api.vendorOnboard.tour, { businessId: w.A, skipped: true });
    st = await riley.query(api.vendorOnboard.state, { businessId: w.A });
    expect(st).toMatchObject({ done: { profile: true, w9: true, pay: true, tour: false }, tourSkipped: true, w9: { name: "W-9 Riley.pdf" }, pay: { method: "ACH", note: "Same account as my last invoice." } });
    await riley.mutation(api.vendorOnboard.tour, { businessId: w.A, skipped: false });
    expect((await riley.query(api.vendorOnboard.state, { businessId: w.A })).done.tour).toBe(true);
    // Reviews (M2): once onboarding is done, the rate is the business's to change.
    await expect(riley.mutation(api.vendorOnboard.profile, { businessId: w.A, name: "Riley Chen", roles: ["Editor"], rateCents: 9_900, rateUnit: "hour" })).rejects.toThrow(/Ask them to change it/);
  });

  test("reviews: Your rate changes only the rate shown, only during onboarding, with an Activity line; bookings keep theirs", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { vendorId, riley } = await newVendor(w, mails);
    await w.t.run((ctx) => ctx.db.patch(vendorId, { rates: [{ role: "Editor", unit: "hour", cents: 7_500 }, { role: "Shooter", unit: "day", cents: 80_000 }] }));
    const k = await w.heston.mutation(api.bookings.create, { vendorId, projectId: w.p, role: "Editor", start: "2030-11-06", end: "2030-11-06", cents: 7_500, unit: "hour", hours: 8 }) as Id<"vendorBookings">;
    await expect(riley.mutation(api.vendorOnboard.profile, { businessId: w.A, name: "Riley Chen", roles: [], rateCents: -5 })).rejects.toThrow(/Check your rate/);
    await riley.mutation(api.vendorOnboard.profile, { businessId: w.A, name: "Riley Chen", roles: ["Lead Editor"], rateCents: 9_000, rateUnit: "hour" });
    expect((await w.t.run((ctx) => ctx.db.get(vendorId)))!.rates).toEqual([{ role: "Editor", unit: "hour", cents: 9_000 }, { role: "Shooter", unit: "day", cents: 80_000 }]);
    expect((await w.t.run((ctx) => ctx.db.get(k)))!.rate).toEqual({ cents: 7_500, unit: "hour" });
    const log = await w.t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(log.map((r) => r.text)).toContain("Riley Chen set their Editor rate in onboarding: $75.00 / hour to $90.00 / hour");
    // Nobody else may take the owner's name; account numbers stay out of every field (D101).
    await expect(riley.mutation(api.vendorOnboard.profile, { businessId: w.A, name: "Heston Hill", roles: [] })).rejects.toThrow(/That name is taken/);
    await expect(riley.mutation(api.vendorOnboard.profile, { businessId: w.A, name: "Riley Chen", roles: [], portfolio: "Routing 021000021 SSN 123-45-6789" })).rejects.toThrow(/Portfolio: leave out account/);
    await expect(riley.mutation(api.vendorPortal.saveDetails, { businessId: w.A, name: "Riley Chen", businessName: "acct 1234/5678/9012" })).rejects.toThrow(/Business name: leave out account/);
    await expect(riley.mutation(api.vendorOnboard.payMethod, { businessId: w.A, method: "ACH", note: "ACH routing 021.000.021 account 123-456-7890" })).rejects.toThrow(/account and routing/);
  });

  test("reviews: a W-9 must be named .pdf, a browser that sends no type still works, and the download link serves only a real PDF", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { vendorId, riley } = await newVendor(w, mails);
    expect(await riley.mutation(api.vendorPortal.setW9, { businessId: w.A, storageId: await pdf(w), name: "W-9 Riley.pdf.exe" })).toEqual({ error: "Upload the W-9 as a PDF, up to 10 MB." });
    const fake = await w.t.run((ctx) => ctx.storage.store(new Blob(["MZ not a pdf"], { type: "application/octet-stream" })));
    expect(await riley.mutation(api.vendorPortal.setW9, { businessId: w.A, storageId: fake, name: "W-9.pdf" })).toEqual({ ok: true });
    const link = await w.heston.mutation(api.vendors.w9Link, { vendorId }) as string;
    const res = await w.t.fetch(`/f/${link.split("/f/")[1]}`, { method: "GET" });
    expect(res.status).toBe(415);
    await riley.mutation(api.vendorPortal.setW9, { businessId: w.A, storageId: await pdf(w), name: "W-9.pdf" });
    const ok = await w.t.fetch(`/f/${(await w.heston.mutation(api.vendors.w9Link, { vendorId }) as string).split("/f/")[1]}`, { method: "GET" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Disposition")).toBe('attachment; filename="W-9.pdf"');
  });

  test("reviews: an expired invite doesn't come back when another business invites the same person; a new address starts fresh", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    await w.heston.mutation(api.vendors.add, { name: "Eve", email: "eve@x.example", roles: ["Editor"], rates: [], invite: true });
    await w.t.run(async (ctx) => { const x = (await ctx.db.query("vendors").withIndex("by_email", (q) => q.eq("email", "eve@x.example")).collect())[0]; await ctx.db.patch(x._id, { inviteExpiresAt: Date.now() - 1 }); });
    expect(await w.t.query(api.clients.canSignUp, { email: "eve@x.example" })).toMatchObject({ ok: false, reason: "expired" });
    await w.boss.mutation(api.vendors.add, { name: "Eve", email: "eve@x.example", roles: ["Editor"], rates: [], invite: true });
    expect(await w.t.query(api.clients.canSignUp, { email: "eve@x.example" })).toMatchObject({ ok: true }); // the live one counts
    await settle(w);
    await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email: "eve@x.example", password: "longenoughpassword" } });
    const ms = await w.t.run((ctx) => ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", "eve@x.example")).collect());
    expect(ms.map((m) => m.businessId)).not.toContain(w.A);
    // An owner who changes a vendor's email: the next person doesn't see the last one's payment note or onboarding.
    const { vendorId, riley } = await newVendor(w, mails);
    await riley.mutation(api.vendorOnboard.payMethod, { businessId: w.A, method: "Zelle", note: "Zelle to my phone" });
    await w.heston.mutation(api.vendors.update, { vendorId, name: "Riley Chen", email: "riley.new@chencuts.example", roles: ["Editor"], rates: [] });
    const moved = (await w.t.run((ctx) => ctx.db.get(vendorId)))!;
    expect([moved.payMethod, moved.onboard]).toEqual([undefined, undefined]);
  });

  test("reviews: a business sends at most 3 invites a day to one address", async () => {
    const w = await world();
    stub([]);
    const id = await w.heston.mutation(api.vendors.add, { name: "Sam", email: "sam@x.example", roles: [], rates: [], invite: true }) as Id<"vendors">;
    await w.heston.mutation(api.vendors.invite, { vendorId: id });
    await w.heston.mutation(api.vendors.invite, { vendorId: id });
    await expect(w.heston.mutation(api.vendors.invite, { vendorId: id })).rejects.toThrow(/a lot for one day/);
  });

  test("T7.3 one login and profile; the W-9 and payment method once per business, each kept to its business (D94)", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { vendorId: a, riley } = await newVendor(w, mails);
    await riley.mutation(api.vendorOnboard.profile, { businessId: w.A, name: "Riley Chen", businessName: "Chen Cuts", roles: ["Editor"], basedIn: "Remote", portfolio: "chencuts.com" });
    await riley.mutation(api.vendorPortal.setW9, { businessId: w.A, storageId: await pdf(w), name: "W-9 for Wrangler.pdf" });
    await riley.mutation(api.vendorOnboard.payMethod, { businessId: w.A, method: "Zelle", note: "Zelle to my email" });
    // Another business adds Riley: the email says they already have a login; no new sign-up.
    mails.length = 0;
    const b = await w.boss.mutation(api.vendors.add, { name: "Riley C.", email: RILEY, roles: ["Editor"], rates: [], invite: true }) as Id<"vendors">;
    await settle(w);
    const B = (await w.t.run((ctx) => ctx.db.get(b)))!.businessId!;
    const m = mails.find((x) => x.to === RILEY)!;
    expect(m.text).toContain("You already have a WranglerPortal login");
    expect(m.text).toContain("Sign in to WranglerPortal");
    expect(m.text).toContain(`&biz=${B}&have=1`); // step 5: an email with a login opens on Sign in
    const sb = await riley.query(api.vendorOnboard.state, { businessId: B });
    expect(sb).toMatchObject({ kind: "short", signedInAs: "Riley Chen", done: { profile: true, w9: false, pay: false, tour: true } });
    // Nothing of Wrangler's copy shows on the other business's: not the W-9, the payment note, or the profile.
    const json = JSON.stringify(sb);
    for (const s of ["W-9 for Wrangler.pdf", "Zelle to my email", "Chen Cuts", "chencuts.com"]) expect(json).not.toContain(s);
    // B's W-9 and method are B's own; A's stay as they were.
    await riley.mutation(api.vendorPortal.setW9, { businessId: B, storageId: await pdf(w), name: "W-9 for B.pdf" });
    await riley.mutation(api.vendorOnboard.payMethod, { businessId: B, method: "Check" });
    await riley.mutation(api.vendorOnboard.step, { businessId: B, at: 2 });
    expect(await riley.query(api.vendorOnboard.state, { businessId: B })).toMatchObject({ step: 2, done: { w9: true, pay: true }, w9: { name: "W-9 for B.pdf" }, pay: { method: "Check" } });
    const recA = (await w.t.run((ctx) => ctx.db.get(a)))!;
    expect(recA).toMatchObject({ w9: { name: "W-9 for Wrangler.pdf" }, payMethod: { method: "Zelle", note: "Zelle to my email" } });
    // The short flow has no profile step; a step past the end is held to it.
    await riley.mutation(api.vendorOnboard.step, { businessId: B, at: 9 });
    expect((await riley.query(api.vendorOnboard.state, { businessId: B })).step).toBe(2);
    // Each owner sees only their own copy.
    expect((await w.t.run((ctx) => ctx.db.get(b)))!).toMatchObject({ w9: { name: "W-9 for B.pdf" }, payMethod: { method: "Check" } });
  });

  test("a vendor from before Phase 7 gets only the tour; nobody else may call these", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { vendorId, riley } = await newVendor(w, mails);
    await w.t.run((ctx) => ctx.db.patch(vendorId, { inviteExpiresAt: undefined })); // invited before D134
    expect(await riley.query(api.vendorOnboard.state, { businessId: w.A })).toMatchObject({ kind: "existing", done: { profile: true, tour: false } });
    for (const who of [w.heston, w.boss, w.maya, w.t]) {
      await expect(who.query(api.vendorOnboard.state, { businessId: w.A })).rejects.toThrow();
      await expect(who.mutation(api.vendorOnboard.payMethod, { businessId: w.A, method: "ACH" })).rejects.toThrow();
    }
    // Riley isn't a vendor of the other business: refused there, and nothing of Riley's changes.
    const before = await w.t.run((ctx) => ctx.db.get(vendorId));
    const B = await w.t.run(async (ctx) => (await ctx.db.query("businesses").collect()).find((b) => b._id !== w.A)!._id);
    await expect(riley.query(api.vendorOnboard.state, { businessId: B })).rejects.toThrow(/Not allowed/);
    await expect(riley.mutation(api.vendorOnboard.profile, { businessId: B, name: "X", roles: [] })).rejects.toThrow(/Not allowed/);
    await expect(riley.mutation(api.vendorOnboard.payMethod, { businessId: B, method: "ACH" })).rejects.toThrow(/Not allowed/);
    expect(await w.t.run((ctx) => ctx.db.get(vendorId))).toEqual(before);
  });
});
