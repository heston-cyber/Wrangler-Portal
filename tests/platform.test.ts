// Phase 7 step 1 (Heston, Nov 18: "Approved"): invites last 14 days (D134), the platform admin page and business invites
// (D106, D110, D113). T7.4: a new business sees nothing of Wrangler's, and the admin page shows counts only. T7.5: with
// sign-up off, nobody makes an account or a business without an invite. T7.6: invites stop after 14 days; Resend works.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { inviteFor } from "../convex/lib/invites";
import { ensureMembership } from "../convex/lib/business";

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
const SAM = "sam@northline.example";
const DAY = 86_400_000;
const codeIn = (m: Sent) => /\b(\d{6})\b/.exec(m.text)![1];

async function signUp(w: W, mails: Sent[], email: string, name: string) {
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email, password: PW, name } });
  const code = codeIn(mails.filter((m) => m.to === email).pop()!);
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email, code } });
  const sub = await w.t.run(async (ctx) => {
    const u = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).unique())!;
    return `${u._id}|${await ctx.db.insert("authSessions", { userId: u._id, expirationTime: Date.now() + 3_600_000 })}`;
  });
  return w.t.withIdentity({ subject: sub });
}

describe("Phase 7 step 1 · invites and the platform admin page", () => {
  test("T7.5 sign-up stays off: no invite, no account and no business; only the platform admin opens the admin page", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const before = await w.t.run((ctx) => ctx.db.query("businesses").collect());
    expect(await w.t.query(api.clients.canSignUp, { email: "stranger@else.example" })).toEqual({ ok: false, reason: "notInvited" });
    await expect(w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email: "stranger@else.example", password: PW } })).rejects.toThrow(/hasn't been invited/);
    expect(await w.t.run((ctx) => ctx.db.query("businesses").collect())).toHaveLength(before.length);
    expect(await w.heston.query(api.platform.me, {})).toEqual({ admin: true });
    for (const who of [w.boss, w.maya, w.t]) {
      expect(await who.query(api.platform.me, {})).toEqual({ admin: false });
      await expect(who.query(api.platform.overview, {})).rejects.toThrow();
      await expect(who.mutation(api.platform.invite, { business: "Sneaky Co", email: "x@sneaky.example" })).rejects.toThrow();
    }
  });

  test("T7.4 a business invite: email 38, the owner signs up and gets a new, empty business of their own; the admin page shows counts only", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    await expect(w.heston.mutation(api.platform.invite, { business: "Northline Creative", email: "maya@harbor.example" })).rejects.toThrow(/already in use/); // a client's login
    await expect(w.heston.mutation(api.platform.invite, { business: "Northline Creative", email: "heston@wranglerproductions.com" })).rejects.toThrow(/already in use/);
    await w.heston.mutation(api.platform.invite, { business: "Northline Creative", email: " Sam@Northline.example ", note: "Here's the portal I told you about." });
    await settle(w);
    const m = mails.find((x) => x.to === SAM)!;
    expect(m.subject).toBe("Heston Hill invited Northline Creative to WranglerPortal");
    expect(m.text).toContain("Free while WranglerPortal is in beta. Before paid plans start, you choose a plan or export your data.");
    expect(m.text).toContain("Here's the portal I told you about.");
    expect(m.text).toContain("https://app.wranglerportal.com/?invited=sam@northline.example&side=owner");
    let o = await w.heston.query(api.platform.overview, {});
    expect(o.rows.find((r: { name: string }) => r.name === "Northline Creative")).toMatchObject({ kind: "invite", status: "invited", email: SAM });
    expect(o.rows[0]).toMatchObject({ yours: true, status: "active" });
    expect(await w.t.query(api.clients.canSignUp, { email: SAM })).toEqual({ ok: true, reason: "invited" });

    const sam = await signUp(w, mails, SAM, "Sam Ortiz");
    const biz = await w.t.run(async (ctx) => (await ctx.db.query("businesses").collect()).find((b) => b.name === "Northline Creative")!);
    expect(biz).toMatchObject({ slug: "northline-creative", ownerName: "Sam Ortiz" });
    expect(await sam.query(api.platform.me, {})).toEqual({ admin: false });
    await expect(sam.query(api.platform.overview, {})).rejects.toThrow();
    expect((await sam.query(api.business.settings, {})).name).toBe("Northline Creative");
    // Nothing of Wrangler's: its clients, projects and invoices aren't there.
    expect(JSON.stringify(await sam.query(api.clients.directory, {}))).not.toMatch(/Harbor/);
    expect(await sam.query(api.projects.mine, {}).catch(() => [])).not.toContainEqual(expect.objectContaining({ _id: w.p }));
    // The invite is used: a second sign-up path or a second business can't come from it.
    expect(await w.t.run(async (ctx) => (await ctx.db.query("businessInvites").collect())[0])).toMatchObject({ acceptedAt: expect.any(Number), businessId: biz._id });
    o = await w.heston.query(api.platform.overview, {});
    const row = o.rows.find((r: { name: string }) => r.name === "Northline Creative");
    expect(row).toMatchObject({ kind: "business", status: "setting_up", owner: "Sam Ortiz", clients: 0, vendors: 0 });
    expect(Object.keys(row).sort()).toEqual(["_id", "clients", "email", "expiresAt", "kind", "lastActive", "name", "owner", "since", "status", "team", "vendors", "yours"]); // counts only (D110)
    expect(JSON.stringify(o)).not.toMatch(/harbor|Maya|Harbor Coffee/); // never a business's clients
    await expect(w.heston.mutation(api.platform.invite, { business: "Northline Again", email: SAM })).rejects.toThrow(/already in use/);
  });

  test("T7.6 invites work 14 days; Resend gives 14 more; an invite sent before Nov 18 keeps working; a cancelled one stops", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const t0 = Date.now();
    vi.useFakeTimers({ now: t0, toFake: ["Date"] });
    // A client's invite.
    await w.heston.mutation(api.clients.invite, { email: "pat@patel.example", name: "Pat Patel" });
    // A vendor's portal invite.
    const vendorId = await w.heston.mutation(api.vendors.add, { name: "Lee Park", email: "lee@park.example", roles: ["Shooter"], rates: [], invite: true }) as Id<"vendors">;
    // A business invite.
    const { inviteId } = await w.heston.mutation(api.platform.invite, { business: "Park Studio", email: "leo@parkstudio.example" });
    // An old client invite (no end date).
    await w.t.run((ctx) => ctx.db.insert("invites", { businessId: w.A, email: "old@friend.example", createdAt: 1 }));
    vi.setSystemTime(t0 + 14 * DAY + 1);
    for (const email of ["pat@patel.example", "leo@parkstudio.example", "lee@park.example"]) {
      expect(await w.t.query(api.clients.canSignUp, { email })).toEqual({ ok: false, reason: "expired" });
      await expect(w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email, password: PW } })).rejects.toThrow(/expired/);
    }
    expect(await w.t.query(api.clients.canSignUp, { email: "old@friend.example" })).toEqual({ ok: true, reason: "invited" });
    expect((await w.heston.query(api.platform.overview, {})).rows.find((r: { name: string }) => r.name === "Park Studio")).toMatchObject({ status: "expired" });
    // Resend: the client invite again, the business invite again.
    await w.heston.mutation(api.clients.invite, { email: "pat@patel.example" });
    await w.heston.mutation(api.platform.resend, { inviteId });
    expect(await w.t.query(api.clients.canSignUp, { email: "pat@patel.example" })).toEqual({ ok: true, reason: "invited" });
    expect(await w.t.query(api.clients.canSignUp, { email: "leo@parkstudio.example" })).toEqual({ ok: true, reason: "invited" });
    await w.heston.mutation(api.platform.revoke, { inviteId });
    expect(await w.t.query(api.clients.canSignUp, { email: "leo@parkstudio.example" })).toEqual({ ok: false, reason: "notInvited" });
    await w.heston.mutation(api.vendors.invite, { vendorId }); // the vendor's invite, sent again
    expect(await w.t.query(api.clients.canSignUp, { email: "lee@park.example" })).toEqual({ ok: true, reason: "invited" });
    vi.useRealTimers();
  });

  test("Q4 (Nov 18) your business invite wins over another business's client or vendor invite; the other stays unaccepted; only you see the warning", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    // Another business invited this email as a client and as a vendor first.
    await w.heston.mutation(api.clients.invite, { email: SAM, name: "Sam Ortiz" });
    await w.heston.mutation(api.vendors.add, { name: "Sam Ortiz", email: SAM, roles: ["Editor"], rates: [], invite: true });
    expect((await w.t.run((ctx) => inviteFor(ctx, SAM))).kind).toBe("client");
    // The admin page warns, yes or no and nothing else; nobody else can ask.
    expect(await w.heston.query(api.platform.otherInvites, { email: SAM })).toEqual({ open: true, inUse: false });
    expect(await w.heston.query(api.platform.otherInvites, { email: "free@else.example" })).toEqual({ open: false, inUse: false });
    expect(await w.heston.query(api.platform.otherInvites, { email: "not an email" })).toEqual({ open: false, inUse: false });
    expect(await w.heston.query(api.platform.otherInvites, { email: "maya@harbor.example" })).toMatchObject({ inUse: true }); // a client's login: Send invite would refuse
    for (const who of [w.boss, w.maya, w.t]) await expect(who.query(api.platform.otherInvites, { email: SAM })).rejects.toThrow();
    // Your business invite goes out, and now it wins.
    await w.heston.mutation(api.platform.invite, { business: "Northline Creative", email: SAM });
    await settle(w);
    expect((await w.t.run((ctx) => inviteFor(ctx, SAM))).kind).toBe("business");
    expect(await w.t.query(api.clients.canSignUp, { email: SAM })).toEqual({ ok: true, reason: "invited" });
    const sam = await signUp(w, mails, SAM, "Sam Ortiz");
    // They own a new business; the other invites were not accepted and made no memberships.
    expect((await sam.query(api.business.settings, {})).name).toBe("Northline Creative");
    const after = await w.t.run(async (ctx) => ({
      user: (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", SAM)).unique())!,
      invites: await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", SAM)).collect(),
      vendors: await ctx.db.query("vendors").withIndex("by_email", (q) => q.eq("email", SAM)).collect(),
      memberships: (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", SAM)).collect()).filter((m) => !m.revokedAt),
    }));
    expect(after.user.role).toBe("owner");
    expect(after.invites.every((i) => !i.acceptedAt)).toBe(true);
    expect(after.vendors.every((x) => !x.joinedAt)).toBe(true);
    expect(after.memberships.map((m) => m.role)).toEqual(["owner"]);
    // Once used, the business invite is spent and doesn't come back; nothing more is added at a later sign-in.
    expect((await w.t.run((ctx) => inviteFor(ctx, SAM))).kind).toBe("client");
    expect(await w.heston.query(api.platform.otherInvites, { email: SAM })).toEqual({ open: true, inUse: true });
  });

  // Reviews (Phase 7b, M1): no path may leave the new owner holding client or vendor memberships of another business.
  const roles = (w: W, email: string) => w.t.run(async (ctx) => (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", email)).collect()).filter((m) => !m.revokedAt).map((m) => m.role).sort());

  test("Q4 reviews R1: a client invite that arrives while the owner's code is still pending makes no membership", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    await w.heston.mutation(api.platform.invite, { business: "Northline Creative", email: SAM });
    await settle(w);
    await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email: SAM, password: PW, name: "Sam Ortiz" } }); // no code entered yet
    await w.heston.mutation(api.clients.invite, { email: SAM, name: "Sam Ortiz" });
    expect(await roles(w, SAM)).toEqual([]);
    const code = codeIn(mails.filter((m) => m.to === SAM).pop()!);
    await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: SAM, code } });
    expect(await roles(w, SAM)).toEqual(["owner"]);
  });

  test("Q4 reviews R2: archiving and restoring a vendor row never gives an owner a vendor membership", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const vendorId = await w.heston.mutation(api.vendors.add, { name: "Sam Ortiz", email: SAM, roles: ["Editor"], rates: [], invite: true }) as Id<"vendors">;
    await w.heston.mutation(api.platform.invite, { business: "Northline Creative", email: SAM });
    await settle(w);
    await signUp(w, mails, SAM, "Sam Ortiz");
    await w.heston.mutation(api.vendors.archive, { vendorId, archived: true });
    await w.heston.mutation(api.vendors.archive, { vendorId, archived: false });
    await w.heston.mutation(api.vendors.invite, { vendorId }); // and the invite sent again
    expect(await roles(w, SAM)).toEqual(["owner"]);
  });

  test("Q4 reviews R3: memberships a call-sheet guest login already carries are switched off when the business invite is accepted", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const guest = await w.t.run((ctx) => ctx.db.insert("users", { email: SAM, name: "Sam", role: "guest" }));
    await w.heston.mutation(api.platform.invite, { business: "Northline Creative", email: SAM });
    await settle(w);
    const vendorId = await w.heston.mutation(api.vendors.add, { name: "Sam Ortiz", email: SAM, roles: ["Editor"], rates: [], invite: true }) as Id<"vendors">;
    await w.heston.mutation(api.clients.invite, { email: SAM, name: "Sam Ortiz" });
    expect(await roles(w, SAM)).toEqual([]); // a guest login gets nothing from another business's invite
    // (an older invite may already have put them there: the sign-up must still clear them)
    await w.t.run(async (ctx) => { await ensureMembership(ctx, w.A, SAM, "client", guest); await ensureMembership(ctx, w.A, SAM, "vendor", guest); await ctx.db.patch(vendorId, { joinedAt: Date.now() }); });
    expect(await roles(w, SAM)).toEqual(["client", "vendor"]);
    await signUp(w, mails, SAM, "Sam Ortiz");
    expect(await roles(w, SAM)).toEqual(["owner"]);
    expect((await w.t.run((ctx) => ctx.db.get(vendorId)))!.joinedAt).toBeUndefined();
  });

  test("Q4 an expired business invite never beats a live client invite", async () => {
    const w = await world();
    stub([]);
    const t0 = Date.now();
    vi.useFakeTimers({ now: t0, toFake: ["Date"] });
    await w.heston.mutation(api.platform.invite, { business: "Park Studio", email: "leo@parkstudio.example" });
    vi.setSystemTime(t0 + 13 * DAY);
    await w.heston.mutation(api.clients.invite, { email: "leo@parkstudio.example", name: "Leo Park" });
    expect((await w.t.run((ctx) => inviteFor(ctx, "leo@parkstudio.example"))).kind).toBe("business"); // still live: wins
    vi.setSystemTime(t0 + 15 * DAY);
    expect((await w.t.run((ctx) => inviteFor(ctx, "leo@parkstudio.example"))).kind).toBe("client"); // the business invite ran out
    expect(await w.heston.query(api.platform.otherInvites, { email: "leo@parkstudio.example" })).toEqual({ open: true, inUse: false });
    vi.useRealTimers();
  });
});
