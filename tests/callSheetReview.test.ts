// Phase 5b step 4 · fixes from the independent review of steps 3 and 4 (M1, L1–L9). Each test failed before its fix.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { todayCentral } from "../convex/lib/bookings";
import { nodesOf, pageOf, buildProblems, line, type Page, type BuildDoc, type Fields } from "../convex/lib/wsBuilder";
import { STARTER_TEMPLATES } from "../convex/lib/callSheet";

const api = anyApi;
beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
  process.env.CONVEX_SITE_URL = "https://handsome-hummingbird-11.convex.site";
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
const settle = async (w: W) => { vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const day = (n: number) => { const d = new Date(`${todayCentral()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const JORDAN = "jordan@ellisfilms.com", RILEY = "riley@example.com", MAYA = "maya@harbor.example";
const sheetMails = (mails: Sent[], to: string) => mails.filter((m) => m.to === to && /call sheet/i.test(m.subject));
const codeOf = (mails: Sent[], to: string) => { const m = [...mails].reverse().find((x) => x.to === to && /is your WranglerPortal code$/.test(x.subject)); return m ? /\b(\d{6})\b/.exec(m.text)![1] : null; };

async function setup(w: W) {
  await w.t.run(async (ctx) => {
    const owner = (await ctx.db.query("users").first())!._id;
    const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: owner });
    await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: MAYA, addedAt: 0 });
  });
  const jordan = await w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: JORDAN, roles: ["Camera"], rates: [], invite: true }) as Id<"vendors">;
  const kJ = await w.heston.mutation(api.bookings.create, { vendorId: jordan, projectId: w.p, role: "Camera", start: day(4), end: day(4), cents: 100_000, unit: "day" }) as Id<"vendorBookings">;
  const jSub = await w.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: JORDAN, name: "Jordan Ellis", role: "vendor" });
    await ctx.db.insert("memberships", { businessId: w.A, email: JORDAN, userId, role: "vendor", createdAt: Date.now() });
    return `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
  });
  const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, date: day(4), call: "07:30", wrap: "13:00", location: "Studio B", parking: "", prepare: [], withOwner: true, bookingIds: [kJ], calendar: false }) as { shootId: Id<"shoots"> };
  await w.heston.mutation(api.callSheets.ensureStarters, {});
  const tpl = (await w.heston.query(api.callSheets.newOptions, {})).templates.find((t: { name: string }) => t.name === "Standard shoot day")._id;
  const csId = await w.heston.mutation(api.callSheets.create, { shootId, how: "template", templateId: tpl }) as Id<"callSheets">;
  return { shootId, kJ, csId, tpl, jordan: w.t.withIdentity({ subject: jSub }) };
}
const tokenOf = (w: W, callSheetId: Id<"callSheets">, personId: string) =>
  w.t.run(async (ctx) => (await ctx.db.query("guestPasses").withIndex("by_sheet", (q) => q.eq("callSheetId", callSheetId)).collect()).find((p) => p.personId === personId)?.token ?? null);
const passOf = (w: W, token: string) => w.t.run(async (ctx) => (await ctx.db.query("guestPasses").withIndex("by_token", (q) => q.eq("token", token)).unique())!);
const unwait = (w: W, token: string) => w.t.run(async (ctx) => { const p = (await ctx.db.query("guestPasses").withIndex("by_token", (q) => q.eq("token", token)).unique())!; await ctx.db.patch(p._id, { codeSentAt: 0 }); });
async function signInAsGuest(w: W, mails: Sent[], token: string, email: string) {
  await unwait(w, token);
  await w.t.action(api.guests.sendCode, { token });
  await w.t.action(api.auth.signIn, { provider: "guest", params: { token, code: codeOf(mails, email)! } });
  const sub = await w.t.run(async (ctx) => {
    const u = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).collect())[0];
    const s = (await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", u._id)).collect()).sort((a, b) => b._creationTime - a._creationTime)[0];
    return `${u._id}|${s._id}`;
  });
  return w.t.withIdentity({ subject: sub });
}
async function editLocation(w: W, csId: Id<"callSheets">, name: string) {
  const cs = await w.heston.query(api.callSheets.get, { callSheetId: csId });
  const b = await w.heston.query(api.builder.getBuild, { buildId: cs.buildId });
  const edited: Page = JSON.parse(JSON.stringify(pageOf(b.blocks)));
  (nodesOf(edited, "location")[0].attrs as { name: string }).name = name;
  await w.heston.mutation(api.builder.saveBuild, { buildId: cs.buildId, title: b.title, blocks: edited, fields: b.fields, signers: [], style: b.style });
}

describe("review fixes", () => {
  test("M1: people unticked after Send, a cancelled shoot, a booking that no longer covers the shoot: no email and nothing to read", async () => {
    const w = await world(); const mails: Sent[] = []; stub(mails);
    const { csId, kJ, jordan, shootId } = await setup(w);
    await w.heston.mutation(api.callSheets.send, { callSheetId: csId, crew: true, client: true });
    await settle(w);
    await w.heston.mutation(api.callSheets.toggle, { callSheetId: csId, id: `client:${MAYA}`, on: false });
    await w.heston.mutation(api.callSheets.toggle, { callSheetId: csId, id: `crew:${kJ}`, on: false });
    await editLocation(w, csId, "SECRET NEW LOCATION");
    await w.heston.mutation(api.callSheets.addGuest, { callSheetId: csId, name: "Riley Quinn", email: RILEY, role: "Talent" });
    mails.length = 0;
    await w.heston.mutation(api.callSheets.sendUpdate, { callSheetId: csId, changed: "Location moved" });
    await settle(w);
    expect(sheetMails(mails, MAYA)).toEqual([]);
    expect(sheetMails(mails, JORDAN)).toEqual([]);
    expect(await w.maya.query(api.callSheets.forClient, { callSheetId: csId })).toBeNull();
    expect(await w.maya.query(api.callSheets.forClientProject, { projectId: w.p })).toEqual([]);
    await expect(w.maya.mutation(api.callSheets.opened, { callSheetId: csId })).rejects.toThrow(/isn't here/);
    expect(await jordan.query(api.vendorPortal.callSheet, { callSheetId: csId })).toBeNull();
    // Ticked again, they read it; a booking moved off the day (and off the shoot's crew) ends Jordan's; a cancelled shoot ends both.
    await w.heston.mutation(api.callSheets.toggle, { callSheetId: csId, id: `client:${MAYA}`, on: true });
    await w.t.run(async (ctx) => { const x = (await ctx.db.get(csId))!; await ctx.db.patch(csId, { recipients: x.recipients.map((r) => (r.id === `crew:${kJ}` ? { ...r, on: true } : r)) }); });
    expect(await w.maya.query(api.callSheets.forClient, { callSheetId: csId })).not.toBeNull();
    expect(await jordan.query(api.vendorPortal.callSheet, { callSheetId: csId })).not.toBeNull();
    await w.t.run(async (ctx) => { await ctx.db.patch(kJ, { start: day(9), end: day(9) }); await ctx.db.patch(shootId, { crew: [] }); });
    expect(await jordan.query(api.vendorPortal.callSheet, { callSheetId: csId })).toBeNull();
    await w.heston.mutation(api.shoots.cancel, { shootId });
    expect(await w.maya.query(api.callSheets.forClient, { callSheetId: csId })).toBeNull();
  }, 60_000);

  test("L1: another business's owner can't tell whether an email has a login elsewhere; this business's owner is told why", async () => {
    const w = await world(); stub([]);
    const pB = await w.boss.mutation(api.library.createProject, { name: "B project", client: "B client" }) as Id<"projects">;
    const { shootId } = await w.boss.mutation(api.shoots.schedule, { projectId: pB, date: day(5), call: "08:00", location: "X", prepare: [], withOwner: true, bookingIds: [], calendar: false }) as { shootId: Id<"shoots"> };
    const csB = await w.boss.mutation(api.callSheets.create, { shootId, how: "blank" }) as Id<"callSheets">;
    const a = await w.boss.mutation(api.callSheets.addGuest, { callSheetId: csB, name: "Maya", email: MAYA, role: "Talent" });
    const people = (await w.boss.query(api.callSheets.get, { callSheetId: csB })).people;
    expect(people.find((p: { id: string }) => p.id === a).note).toBe("Can't get a guest link");
    expect(JSON.stringify(people)).not.toMatch(/own portal login/);
    // Business A's own client, added as a guest on A's sheet: A's owner is told why.
    const { csId } = await setup(w);
    const s = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: csId, name: "Sam", email: "sam@elsewhere.example", role: "Talent" });
    expect((await w.heston.query(api.callSheets.get, { callSheetId: csId })).people.find((p: { id: string }) => p.id === s).note).toMatch(/own portal login/);
  }, 30_000);

  test("L2: /guest lists only businesses that sent the guest something, and defaults to one with sheets coming up", async () => {
    const w = await world(); const mails: Sent[] = []; stub(mails);
    const { csId } = await setup(w);
    const riley = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: csId, name: "Riley Quinn", email: RILEY, role: "Talent" }) as string;
    await w.heston.mutation(api.callSheets.send, { callSheetId: csId, crew: true, client: true, guests: true });
    await settle(w);
    const rileyIn = await signInAsGuest(w, mails, (await tokenOf(w, csId, riley))!, RILEY);
    const pB = await w.boss.mutation(api.library.createProject, { name: "B project" }) as Id<"projects">;
    const { shootId } = await w.boss.mutation(api.shoots.schedule, { projectId: pB, date: day(5), call: "08:00", location: "X", prepare: [], withOwner: true, bookingIds: [], calendar: false }) as { shootId: Id<"shoots"> };
    const csB = await w.boss.mutation(api.callSheets.create, { shootId, how: "blank" }) as Id<"callSheets">;
    await w.boss.mutation(api.callSheets.addGuest, { callSheetId: csB, name: "Riley Quinn", email: RILEY, role: "Talent" });
    let home = await rileyIn.query(api.guests.home, {});
    expect(home.businesses.map((b: { name: string }) => b.name)).toEqual(["Wrangler Productions"]); // B's draft never shows
    expect(home.sheets).toHaveLength(1);
    // Once B sends it, B shows too; the default stays the soonest shoot (A's, day 4).
    await w.t.run(async (ctx) => { await ctx.db.patch(csB, { status: "sent", sent: { title: "B", page: { type: "doc", content: [] }, fields: {}, style: {}, at: 1, round: 0 }, recipients: (await ctx.db.get(csB))!.recipients.map((r) => ({ ...r, sentAt: 1 })) }); });
    await w.t.run(async (ctx) => { for (const p of await ctx.db.query("guestPasses").withIndex("by_sheet", (q) => q.eq("callSheetId", csB)).collect()) await ctx.db.patch(p._id, { sentAt: 1, date: day(5) }); });
    home = await rileyIn.query(api.guests.home, {});
    expect(home.businesses.map((b: { name: string }) => b.name)).toEqual(["Wrangler Productions", "Other Films"]);
    expect(home.businessId).toBe(w.A);
    expect(home.sheets).toHaveLength(1);
  }, 60_000);

  test("L3: a removed-and-re-added guest gets email 41 with a working link; Restore access sends again only with the next update or reminder", async () => {
    const w = await world(); const mails: Sent[] = []; stub(mails);
    const { csId } = await setup(w);
    const g1 = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: csId, name: "Riley Quinn", email: RILEY, role: "Talent" }) as string;
    const t1 = (await tokenOf(w, csId, g1))!;
    await w.heston.mutation(api.callSheets.send, { callSheetId: csId, crew: true, client: true, guests: true });
    await settle(w);
    await w.heston.mutation(api.callSheets.removeGuest, { callSheetId: csId, id: g1 });
    const g2 = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: csId, name: "Riley Quinn", email: RILEY, role: "Talent" }) as string;
    const t2 = (await tokenOf(w, csId, g2))!;
    mails.length = 0;
    await w.heston.mutation(api.callSheets.sendUpdate, { callSheetId: csId, changed: "Riley is back" });
    await settle(w);
    expect(sheetMails(mails, RILEY)).toHaveLength(1);
    expect(sheetMails(mails, RILEY)[0].text).toContain(`/guest/${t2}`);
    expect(await w.t.query(api.guests.intro, { token: t1 })).toEqual({ state: "missing" });
    expect((await w.t.query(api.guests.intro, { token: t2 })).state).toBe("active");

    // Ended, then restored: nothing at once; the next update sends email 41 again (and the link works again).
    await w.heston.mutation(api.callSheets.endGuest, { callSheetId: csId, id: g2 });
    expect((await w.t.query(api.guests.intro, { token: t2 })).state).toBe("ended");
    await w.heston.mutation(api.callSheets.restoreGuest, { callSheetId: csId, id: g2 });
    let me = (await w.heston.query(api.callSheets.get, { callSheetId: csId })).people.find((p: { id: string }) => p.id === g2);
    expect(me).toMatchObject({ endedAt: null, sentAt: null, access: true, on: true });
    expect(await w.t.query(api.guests.intro, { token: t2 })).toEqual({ state: "missing" }); // not until it's sent again
    mails.length = 0;
    await w.heston.mutation(api.callSheets.sendUpdate, { callSheetId: csId, changed: "Lunch at noon" });
    await settle(w);
    expect(sheetMails(mails, RILEY).map((m) => m.subject)).toEqual([expect.stringMatching(/^Call sheet for /)]); // 41, not 42
    expect((await w.t.query(api.guests.intro, { token: t2 })).state).toBe("active");
    // And by Remind.
    await w.heston.mutation(api.callSheets.endGuest, { callSheetId: csId, id: g2 });
    await w.heston.mutation(api.callSheets.restoreGuest, { callSheetId: csId, id: g2 });
    mails.length = 0;
    expect(await w.heston.mutation(api.callSheets.remind, { callSheetId: csId, id: g2 })).toEqual({ sent: 1 });
    await settle(w);
    expect(sheetMails(mails, RILEY)).toHaveLength(1);
    me = (await w.heston.query(api.callSheets.get, { callSheetId: csId })).people.find((p: { id: string }) => p.id === g2);
    expect(me.sentAt).toBeTypeOf("number");
    expect((await w.t.query(api.guests.intro, { token: t2 })).state).toBe("active");
  }, 60_000);

  test("L4: after the guest login becomes a client account, the old guest token is nobody", async () => {
    const w = await world(); const mails: Sent[] = []; stub(mails);
    const { csId } = await setup(w);
    const riley = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: csId, name: "Riley Quinn", email: RILEY, role: "Talent" }) as string;
    await w.heston.mutation(api.callSheets.send, { callSheetId: csId, crew: true, client: true, guests: true });
    await settle(w);
    const rileyIn = await signInAsGuest(w, mails, (await tokenOf(w, csId, riley))!, RILEY);
    const oldId = (await rileyIn.query(api.users.me, {})).id;
    await w.heston.mutation(api.clients.invite, { email: RILEY, name: "Riley Quinn" });
    mails.length = 0;
    await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email: RILEY, password: "longenoughpassword" } });
    const code = /\b(\d{6})\b/.exec(mails[mails.length - 1].text)![1];
    const done = await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: RILEY, code } }) as { tokens?: unknown };
    expect(done.tokens).toBeTruthy();
    const rows = await w.t.run(async (ctx) => ctx.db.query("users").withIndex("email", (q) => q.eq("email", RILEY)).collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "client", name: "Riley Quinn" });
    expect(rows[0]._id).not.toBe(oldId);
    // The old guest identity: nobody.
    expect(await rileyIn.query(api.users.me, {})).toBeNull();
    await expect(rileyIn.query(api.clients.account, {})).rejects.toThrow(/Not allowed|Sign in first/);
    expect(await rileyIn.query(api.invoicePay.mine, {})).toEqual([]);
    await expect(rileyIn.query(api.guests.home, {})).rejects.toThrow(/Not allowed|Sign in first/);
    // The new account signs in with its password, as the client.
    const back = await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", email: RILEY, password: "longenoughpassword" } }) as { tokens?: unknown };
    expect(back.tokens).toBeTruthy();
    const memberships = await w.t.run(async (ctx) => ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", RILEY)).collect());
    expect(memberships.every((m) => !m.userId || m.userId === rows[0]._id)).toBe(true);
  }, 60_000);

  test("L5: 15 wrong codes in a day lock the pass until the owner sends it again", async () => {
    const w = await world(); const mails: Sent[] = []; stub(mails);
    const { csId } = await setup(w);
    const riley = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: csId, name: "Riley Quinn", email: RILEY, role: "Talent" }) as string;
    await w.heston.mutation(api.callSheets.send, { callSheetId: csId, crew: true, client: true, guests: true });
    await settle(w);
    const tok = (await tokenOf(w, csId, riley))!;
    let last: unknown = null;
    for (let round = 0; round < 3; round++) {
      await unwait(w, tok);
      await w.t.action(api.guests.sendCode, { token: tok });
      const good = codeOf(mails, RILEY)!;
      const bad = good === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++) last = await w.t.action(api.auth.signIn, { provider: "guest", params: { token: tok, code: bad } }).catch((e: Error) => e.message);
    }
    expect(String(last)).toMatch(/Too many wrong codes/);
    expect((await passOf(w, tok)).lockedAt).toBeTypeOf("number");
    await unwait(w, tok);
    await expect(w.t.action(api.guests.sendCode, { token: tok })).rejects.toThrow(/Too many wrong codes/);
    // The owner sends it again: the pass opens, and a fresh code signs in.
    await w.heston.mutation(api.callSheets.sendUpdate, { callSheetId: csId, changed: "Sent again" });
    expect((await passOf(w, tok)).lockedAt).toBeUndefined();
    await unwait(w, tok);
    await w.t.action(api.guests.sendCode, { token: tok });
    const ok = await w.t.action(api.auth.signIn, { provider: "guest", params: { token: tok, code: codeOf(mails, RILEY)! } }) as { tokens?: unknown };
    expect(ok.tokens).toBeTruthy();
  }, 60_000);

  test("L6: readers and Remind show the heading and date as sent, not the project or shoot as they are now", async () => {
    const w = await world(); const mails: Sent[] = []; stub(mails);
    const { csId, shootId } = await setup(w);
    const riley = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: csId, name: "Riley Quinn", email: RILEY, role: "Talent" }) as string;
    await w.heston.mutation(api.callSheets.send, { callSheetId: csId, crew: true, client: true, guests: true });
    await settle(w);
    const rileyIn = await signInAsGuest(w, mails, (await tokenOf(w, csId, riley))!, RILEY);
    await w.t.run(async (ctx) => { await ctx.db.patch(w.p, { name: "Renamed" }); await ctx.db.patch(shootId, { date: day(7) }); });
    const mv = await w.maya.query(api.callSheets.forClient, { callSheetId: csId });
    expect(mv).toMatchObject({ title: "Launch · Harbor Coffee", date: day(4) });
    expect(await rileyIn.query(api.guests.sheet, { token: (await tokenOf(w, csId, riley))! })).toMatchObject({ title: "Launch · Harbor Coffee", date: day(4) });
    expect((await w.t.query(api.guests.intro, { token: (await tokenOf(w, csId, riley))! })).title).toBe("Launch · Harbor Coffee");
    mails.length = 0;
    await w.heston.mutation(api.callSheets.remind, { callSheetId: csId });
    await settle(w);
    const r = sheetMails(mails, RILEY)[0];
    expect(r.subject).toContain("Launch · Harbor Coffee");
    expect(r.subject).not.toContain("Renamed");
    const d4 = new Date(`${day(4)}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" });
    expect(r.subject).toContain(d4);
  }, 60_000);

  test("L8: a call-sheet template keeps no people when updated; call blocks don't count in, and don't go into, a contract", async () => {
    const w = await world(); stub([]);
    const { tpl } = await setup(w);
    const page = STARTER_TEMPLATES[0].page();
    for (const n of page.content ?? []) {
      if (n.type === "crew") n.attrs = { rows: [{ id: "a", name: "Jordan Ellis", role: "Camera", call: "07:30", phone: "555-0100" }] };
      if (n.type === "location") n.attrs = { ...(n.attrs ?? {}), name: "Studio B", address: "1 Film Row" };
    }
    await w.heston.mutation(api.builder.updateTemplate, { templateId: tpl, name: "Standard shoot day", blocks: page, fields: { project: "", custom: [] }, style: {} });
    const saved = await w.t.run(async (ctx) => ctx.db.get(tpl as Id<"wsTemplates">));
    const sp = pageOf(saved!.blocks);
    expect(nodesOf(sp, "crew")[0].attrs!.rows).toEqual([]);
    expect(nodesOf(sp, "location")[0].attrs!.name).toBe("");
    const fields: Fields = { business: { name: "", legalName: "", contact: "", title: "", email: "", phone: "", address: "" }, client: { name: "", company: "", email: "", phone: "", address: "" }, project: "", date: "", custom: [] } as unknown as Fields;
    const doc = (content: Page["content"]): BuildDoc => ({ title: "Contract", page: { type: "doc", content }, fields, signers: [], style: {} as BuildDoc["style"] });
    const onlyCall = buildProblems(doc([{ type: "schedule", attrs: { rows: [] } }]));
    expect(onlyCall).toContain("Add some content.");
    expect(onlyCall.some((p) => /Call sheet blocks/.test(p))).toBe(true);
    expect(buildProblems(doc([line("Terms")])).some((p) => /Call sheet blocks/.test(p))).toBe(false);
  }, 30_000);

  test("L9: a reader gets only the fill-in values the sheet uses", async () => {
    const w = await world(); stub([]);
    const { csId } = await setup(w);
    await w.heston.mutation(api.callSheets.send, { callSheetId: csId, crew: true, client: true });
    const v = await w.maya.query(api.callSheets.forClient, { callSheetId: csId });
    const used = new Set([...JSON.stringify(v.page).matchAll(/\{([a-z][a-z0-9_.]{0,40})\}/gi)].map((m) => m[1]));
    expect(Object.keys(v.values).every((k) => used.has(k))).toBe(true);
    expect(v.values).not.toHaveProperty("business.email");
    expect(v.values).not.toHaveProperty("client.email");
  }, 30_000);
});
