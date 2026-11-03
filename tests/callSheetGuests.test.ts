// Phase 5b step 4 · call-sheet guests (D127). T5b.3: a guest signs in with their link and an emailed 6-digit code and
// sees only their own sheets; another guest's sheet, a sheet from another business and every other page are refused;
// after the project closes, the dates end, the shoot is cancelled or the owner ends it by hand they get Access ended
// and can read nothing; an owner, client or vendor email added as a guest keeps its own login and gets no guest powers;
// email 41 goes once per guest per send (42 for updates, with the guest's own link); a guest with no active sheet can't
// sign in; and a guest login invited since only becomes a full account once its email is proved.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { internal } from "../convex/_generated/api";
import { world } from "./payHarness";
import { todayCentral } from "../convex/lib/bookings";
import { guestCallSheetMail } from "../convex/lib/mails";
import { brandFrom } from "../convex/lib/mail";
import { masked, projectClosed } from "../convex/lib/guests";

const api = anyApi;
beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
  process.env.CONVEX_SITE_URL = "https://handsome-hummingbird-11.convex.site";
  // Convex Auth mints a JWT once sign-in succeeds; a throwaway RSA pair made here, never a real key.
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
  return new Response("{}", { status: 500 }); // nothing else may be reached
}));
const settle = async (w: W) => { vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const day = (n: number) => { const d = new Date(`${todayCentral()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const RILEY = "riley@example.com", PAT = "pat@example.com", SAMR = "sam@riverasound.example";
const sheetMails = (mails: Sent[], to: string) => mails.filter((m) => m.to === to && /call sheet/i.test(m.subject));
const codeOf = (mails: Sent[], to: string) => { const m = [...mails].reverse().find((x) => x.to === to && /is your WranglerPortal code$/.test(x.subject)); return m ? /\b(\d{6})\b/.exec(m.text)![1] : null; };

/** Maya can open the project; Sam Rivera is a vendor login (booked on another day, so not on the sheet). Two shoots on
 *  Launch: day 4 (Riley's sheet) and day 6 (Pat's). */
async function setup(w: W) {
  await w.t.run(async (ctx) => {
    const owner = (await ctx.db.query("users").first())!._id;
    const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: owner });
    await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: "maya@harbor.example", addedAt: 0 });
    const v = await ctx.db.insert("vendors", { businessId: w.A, name: "Sam Rivera", email: SAMR, roles: ["Sound"], rates: [], invitedAt: 0, createdAt: 0, updatedAt: 0 });
    const userId = await ctx.db.insert("users", { email: SAMR, name: "Sam Rivera", role: "vendor" });
    await ctx.db.insert("memberships", { businessId: w.A, email: SAMR, userId, role: "vendor", createdAt: 0 });
    void v;
  });
  const shoot = async (n: number) => (await w.heston.mutation(api.shoots.schedule, { projectId: w.p, date: day(n), call: "07:30", wrap: "13:00", location: "Studio B", parking: "", prepare: [], withOwner: true, bookingIds: [], calendar: false }) as { shootId: Id<"shoots"> }).shootId;
  const s1 = await shoot(4), s2 = await shoot(6);
  await w.heston.mutation(api.callSheets.ensureStarters, {});
  const tpl = (await w.heston.query(api.callSheets.newOptions, {})).templates.find((t: { name: string }) => t.name === "Standard shoot day")._id;
  const cs1 = await w.heston.mutation(api.callSheets.create, { shootId: s1, how: "template", templateId: tpl }) as Id<"callSheets">;
  const cs2 = await w.heston.mutation(api.callSheets.create, { shootId: s2, how: "template", templateId: tpl }) as Id<"callSheets">;
  return { s1, s2, cs1, cs2 };
}
const tokenOf = (w: W, callSheetId: Id<"callSheets">, personId: string) =>
  w.t.run(async (ctx) => (await ctx.db.query("guestPasses").withIndex("by_sheet", (q) => q.eq("callSheetId", callSheetId)).collect()).find((p) => p.personId === personId)!.token);

/** Signs in with the link and the emailed code, as the page does; returns a caller with that session. */
async function signInAsGuest(w: W, mails: Sent[], token: string, email: string) {
  await w.t.action(api.guests.sendCode, { token });
  const code = codeOf(mails, email)!;
  const r = await w.t.action(api.auth.signIn, { provider: "guest", params: { token, code } }) as { tokens?: unknown };
  expect(r.tokens).toBeTruthy();
  const sub = await w.t.run(async (ctx) => {
    const u = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).collect())[0];
    const s = (await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", u._id)).collect()).sort((a, b) => b._creationTime - a._creationTime)[0];
    return `${u._id}|${s._id}`;
  });
  return w.t.withIdentity({ subject: sub });
}

describe("call-sheet guests", () => {
  test("T5b.3 link, code, their own sheets only; email 41 once per guest per send; ended by hand, dates, closing", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { s1, cs1, cs2 } = await setup(w);
    const riley = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: cs1, name: "Riley Quinn", email: RILEY, role: "Talent" }) as string;
    const pat = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: cs2, name: "Pat Lee", email: PAT, role: "Stylist" }) as string;
    const rTok = await tokenOf(w, cs1, riley), pTok = await tokenOf(w, cs2, pat);
    expect(rTok).toMatch(/^[A-Za-z0-9_-]{24}$/);

    // Before it's sent, the link goes nowhere and no code can be had.
    expect(await w.t.query(api.guests.intro, { token: rTok })).toEqual({ state: "missing" });
    await expect(w.t.action(api.guests.sendCode, { token: rTok })).rejects.toThrow(/doesn't work/);

    // Send, with guests: email 41 to Riley, once, with her own link.
    let cs = await w.heston.query(api.callSheets.get, { callSheetId: cs1 });
    expect(cs.people.find((p: { id: string }) => p.id === riley)).toMatchObject({ kind: "guest", access: true, note: null, on: true });
    const r = await w.heston.mutation(api.callSheets.send, { callSheetId: cs1, crew: true, client: true, guests: true, message: "See you there." });
    expect(r).toMatchObject({ sent: 2, guests: 1, skipped: [] });
    await w.heston.mutation(api.callSheets.send, { callSheetId: cs2, crew: true, client: false, guests: true });
    await settle(w);
    const m41 = sheetMails(mails, RILEY);
    expect(m41).toHaveLength(1);
    expect(m41[0].subject).toMatch(/^Call sheet for \w+day, \w{3} \d+: Launch · Harbor Coffee$/);
    expect(m41[0].text).toContain("Hi Riley,");
    expect(m41[0].text).toContain("Wrangler Productions added you to the call sheet for");
    expect(m41[0].text).toContain("You sign in with a 6-digit code we email you. No account needed.");
    expect(m41[0].text).toContain(`https://app.wranglerportal.com/guest/${rTok}`);
    expect(m41[0].text).toContain("See you there.");
    expect(sheetMails(mails, PAT)).toHaveLength(1);
    // A retried job sends nothing twice.
    expect(await w.t.action(internal.callSheets.mail, { callSheetId: cs1, out: [{ id: riley, email: RILEY, name: "Riley Quinn", kind: "guest", mail: "first", key: `callsheet:${cs1}:first:${riley}`, call: "07:30" }] })).toBe(0);
    expect(sheetMails(mails, RILEY)).toHaveLength(1);

    // The link, signed out: whose sheet it is, the email masked; nothing else.
    const intro = await w.t.query(api.guests.intro, { token: rTok });
    expect(intro).toMatchObject({ state: "active", title: "Launch · Harbor Coffee", name: "Riley Quinn", email: "r•••@example.com", business: { name: "Wrangler Productions" } });
    expect(JSON.stringify(intro)).not.toContain(RILEY);
    expect(await w.t.query(api.guests.intro, { token: "x".repeat(24) })).toEqual({ state: "missing" });

    // The code: to her own address; a wrong one is refused (and counted); the emailed one signs her in.
    mails.length = 0;
    expect(await w.t.action(api.guests.sendCode, { token: rTok })).toEqual({ to: "r•••@example.com", minutes: 10 });
    expect(mails.map((m) => m.to)).toEqual([RILEY]);
    await expect(w.t.action(api.guests.sendCode, { token: rTok })).rejects.toThrow(/Wait half a minute/);
    const code = codeOf(mails, RILEY)!;
    const wrong = code === "123456" ? "654321" : "123456";
    await expect(w.t.action(api.auth.signIn, { provider: "guest", params: { token: rTok, code: wrong } })).rejects.toThrow(/didn't match/);
    await expect(w.t.action(api.auth.signIn, { provider: "guest", params: { token: pTok, code } })).rejects.toThrow(/didn't match/); // another guest's link
    const ok = await w.t.action(api.auth.signIn, { provider: "guest", params: { token: rTok, code } }) as { tokens?: unknown };
    expect(ok.tokens).toBeTruthy();
    await expect(w.t.action(api.auth.signIn, { provider: "guest", params: { token: rTok, code } })).rejects.toThrow(/didn't match/); // used once
    const user = await w.t.run(async (ctx) => (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", RILEY)).collect()));
    expect(user).toHaveLength(1);
    expect(user[0]).toMatchObject({ role: "guest", name: "Riley Quinn" });
    // Five wrong tries wipe a code.
    await w.t.run(async (ctx) => { const p = (await ctx.db.query("guestPasses").withIndex("by_token", (q) => q.eq("token", pTok)).unique())!; await ctx.db.patch(p._id, { codeSentAt: 0 }); });
    await w.t.action(api.guests.sendCode, { token: pTok });
    const pc = codeOf(mails, PAT)!;
    for (let i = 0; i < 5; i++) await expect(w.t.action(api.auth.signIn, { provider: "guest", params: { token: pTok, code: pc === "000000" ? "111111" : "000000" } })).rejects.toThrow(/didn't match/);
    await expect(w.t.action(api.auth.signIn, { provider: "guest", params: { token: pTok, code: pc } })).rejects.toThrow(/didn't match/);

    // Signed in: only her own sheet, the whole sheet as sent.
    await w.t.run(async (ctx) => { const p = (await ctx.db.query("guestPasses").withIndex("by_token", (q) => q.eq("token", rTok)).unique())!; await ctx.db.patch(p._id, { codeSentAt: 0 }); });
    const rileyIn = await signInAsGuest(w, mails, rTok, RILEY);
    expect(await rileyIn.query(api.users.me, {})).toMatchObject({ role: "guest", allowed: false, sides: [] });
    const home = await rileyIn.query(api.guests.home, {});
    expect(home.sheets).toEqual([expect.objectContaining({ token: rTok, title: "Launch · Harbor Coffee", date: day(4), call: "07:30", place: "Studio B" })]);
    expect(home.businesses).toEqual([{ businessId: w.A, name: "Wrangler Productions" }]);
    const view = await rileyIn.query(api.guests.sheet, { token: rTok });
    expect(view).toMatchObject({ ended: false, title: "Launch · Harbor Coffee", me: { name: "Riley Quinn", kind: "guest" }, business: "Wrangler Productions" });
    expect(view.project).toBeUndefined(); // no way into the project
    expect(JSON.stringify(view.page)).toContain("Maya Brooks"); // the whole sheet, other people on it included
    // Another guest's sheet, another business's sheet, and every other page: refused.
    expect(await rileyIn.query(api.guests.sheet, { token: pTok })).toBeNull();
    await expect(rileyIn.mutation(api.guests.opened, { token: pTok })).rejects.toThrow(/isn't here/);
    for (const [ref, args] of [
      [api.callSheets.get, { callSheetId: cs1 }], [api.callSheets.list, {}], [api.library.overview, {}], [api.projects.mine, {}], [api.inbox.mine, {}],
      [api.documents.mine, {}], [api.clients.account, {}], [api.vendorPortal.home, {}], [api.production.shoots, {}], [api.shares.mine, {}],
    ] as const) await expect(rileyIn.query(ref, args)).rejects.toThrow(/Not allowed/);
    expect(await rileyIn.query(api.callSheets.forClient, { callSheetId: cs1 }).catch(() => "refused")).toBe("refused");
    expect(await rileyIn.query(api.invoicePay.mine, {})).toEqual([]);
    await expect(rileyIn.mutation(api.callSheets.endGuest, { callSheetId: cs1, id: riley })).rejects.toThrow(/Not allowed/);

    // Another business: B's sheet for Riley's email can't be reached with a forged pass that says it's A's.
    const bSheet = await w.t.run(async (ctx) => {
      const B = (await ctx.db.query("businesses").withIndex("by_slug", (q) => q.eq("slug", "other")).unique())!._id;
      const p = await ctx.db.insert("projects", { businessId: B, name: "Other", createdAt: 0 });
      const s = await ctx.db.insert("shoots", { businessId: B, projectId: p, date: day(5), call: "08:00", location: "Elsewhere", prepare: [], crew: [], status: "scheduled", history: [], createdAt: 0, updatedAt: 0 });
      const c = await ctx.db.insert("callSheets", { businessId: B, shootId: s, projectId: p, how: "blank", status: "sent", sentAt: 0, updates: 0,
        recipients: [{ id: "guest:b", kind: "guest", name: "Riley Quinn", email: RILEY, on: true, sentAt: 0, addedAt: 0 }],
        sent: { title: "Secret", page: { type: "doc", content: [] }, fields: {}, style: {}, at: 0, round: 0 }, history: [], createdAt: 0, updatedAt: 0 });
      await ctx.db.insert("guestPasses", { businessId: w.A, callSheetId: c, personId: "guest:b", email: RILEY, token: "forgedforgedforgedforged", createdAt: 0 });
      return c;
    });
    expect(await rileyIn.query(api.guests.sheet, { token: "forgedforgedforgedforged" })).toBeNull();
    expect(await w.t.query(api.guests.intro, { token: "forgedforgedforgedforged" })).toEqual({ state: "missing" });
    expect(JSON.stringify(await rileyIn.query(api.guests.home, {}))).not.toContain(String(bSheet));

    // Opening it shows on the owner's Detail page; Remind skips her then.
    await rileyIn.mutation(api.guests.opened, { token: rTok });
    cs = await w.heston.query(api.callSheets.get, { callSheetId: cs1 });
    expect(cs.people.find((p: { id: string }) => p.id === riley).openedAt).toBeTypeOf("number");
    expect((await w.heston.query(api.callSheets.list, {})).rows.find((x: { _id: string }) => x._id === cs1)).toMatchObject({ opened: 1, of: 2, guests: 1 });
    mails.length = 0;
    await w.heston.mutation(api.callSheets.remind, { callSheetId: cs2 }); // Pat hasn't opened: email 41 again, as a reminder
    await settle(w);
    expect(sheetMails(mails, PAT).map((m) => m.subject)).toEqual([expect.stringMatching(/^Reminder: call sheet for /)]);
    expect(sheetMails(mails, PAT)[0].text).toContain(`/guest/${pTok}`);

    // Send an update: 42 once per guest per update, with her own link.
    mails.length = 0;
    await w.heston.mutation(api.callSheets.sendUpdate, { callSheetId: cs1, changed: "Talent call moved to 9:00 AM" });
    await settle(w);
    const up = sheetMails(mails, RILEY);
    expect(up).toHaveLength(1);
    expect(up[0].subject).toMatch(/^Call sheet updated for /);
    expect(up[0].text).toContain(`https://app.wranglerportal.com/guest/${rTok}`);
    expect((await rileyIn.query(api.guests.sheet, { token: rTok })).change).toMatchObject({ text: "Talent call moved to 9:00 AM" });

    // Ended by hand: Access ended (title and day only), nothing to read, no new code.
    await w.heston.mutation(api.callSheets.endGuest, { callSheetId: cs1, id: riley });
    expect(await rileyIn.query(api.guests.sheet, { token: rTok })).toEqual({ ended: true, title: "Launch · Harbor Coffee", date: day(4), business: { name: "Wrangler Productions", legalName: "Hill Creative LLC" } });
    expect((await rileyIn.query(api.guests.home, {})).sheets).toEqual([]);
    await expect(rileyIn.mutation(api.guests.opened, { token: rTok })).rejects.toThrow(/isn't here/);
    expect(await w.t.query(api.guests.intro, { token: rTok })).toMatchObject({ state: "ended", title: "Launch · Harbor Coffee" });
    await expect(w.t.action(api.guests.sendCode, { token: rTok })).rejects.toThrow(/no longer available/);
    cs = await w.heston.query(api.callSheets.get, { callSheetId: cs1 });
    expect(cs.people.find((p: { id: string }) => p.id === riley)).toMatchObject({ access: false, note: "Access ended", endedAt: expect.any(Number) });
    mails.length = 0;
    await w.heston.mutation(api.callSheets.sendUpdate, { callSheetId: cs1, changed: "Lunch at noon" });
    await settle(w);
    expect(sheetMails(mails, RILEY)).toEqual([]); // ended: no more emails
    // A guest with no active sheet can't sign in: a code issued earlier stops working too.
    await w.t.run(async (ctx) => { const p = (await ctx.db.query("guestPasses").withIndex("by_token", (q) => q.eq("token", rTok)).unique())!; await ctx.db.patch(p._id, { codeHash: "x", codeExpiresAt: Date.now() + 60_000 }); });
    await expect(w.t.action(api.auth.signIn, { provider: "guest", params: { token: rTok, code: "123456" } })).rejects.toThrow(/no longer available/);

    // Pat: the dates end (the day after the shoot), the shoot is cancelled, the project closes: Access ended each time.
    const patIn = await w.t.run(async (ctx) => { const p = (await ctx.db.query("guestPasses").withIndex("by_token", (q) => q.eq("token", pTok)).unique())!; await ctx.db.patch(p._id, { codeSentAt: 0 }); })
      .then(() => signInAsGuest(w, mails, pTok, PAT));
    expect((await patIn.query(api.guests.sheet, { token: pTok })).ended).toBe(false);
    expect(await patIn.query(api.guests.sheet, { token: rTok })).toBeNull(); // Riley's
    const s2 = (await w.t.run(async (ctx) => (await ctx.db.get(cs2))!.shootId));
    await w.t.run(async (ctx) => { await ctx.db.patch(s2, { date: day(0) }); });
    expect((await patIn.query(api.guests.sheet, { token: pTok })).ended).toBe(false); // through the shoot day
    await w.t.run(async (ctx) => { await ctx.db.patch(s2, { date: day(-1) }); });
    expect(await patIn.query(api.guests.sheet, { token: pTok })).toMatchObject({ ended: true });
    await w.t.run(async (ctx) => { await ctx.db.patch(s2, { date: day(6), status: "cancelled" }); });
    expect(await patIn.query(api.guests.sheet, { token: pTok })).toMatchObject({ ended: true });
    await w.t.run(async (ctx) => { await ctx.db.patch(s2, { status: "scheduled" }); });
    expect((await patIn.query(api.guests.sheet, { token: pTok })).ended).toBe(false);
    await w.t.run(async (ctx) => { await ctx.db.patch(w.p, { stage: "delivery" }); });
    expect((await patIn.query(api.guests.sheet, { token: pTok })).ended).toBe(false); // delivery stage alone isn't closed
    await w.t.run(async (ctx) => { await ctx.db.patch(w.p, { deliveryUnlockedAt: Date.now() }); });
    expect(await patIn.query(api.guests.sheet, { token: pTok })).toMatchObject({ ended: true });
    expect((await patIn.query(api.guests.home, {})).sheets).toEqual([]);
    await expect(w.t.action(api.guests.sendCode, { token: pTok })).rejects.toThrow(/no longer available/);
    void s1;
  }, 60_000);

  test("an owner, client or vendor email added as a guest keeps its own login and gets no guest powers", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { cs1 } = await setup(w);
    const ids: Record<string, string> = {};
    for (const [name, email] of [["Heston", "heston@wranglerproductions.com"], ["Sam", "sam@elsewhere.example"], ["Sam Rivera", SAMR]] as const)
      ids[email] = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: cs1, name, email, role: "Talent" }) as string;
    const cs = await w.heston.query(api.callSheets.get, { callSheetId: cs1 });
    for (const id of Object.values(ids)) expect(cs.people.find((p: { id: string }) => p.id === id)).toMatchObject({ access: false, note: expect.stringMatching(/own portal login/) });
    const r = await w.heston.mutation(api.callSheets.send, { callSheetId: cs1, crew: true, client: true, guests: true });
    expect(r.guests).toBe(0);
    expect(r.skipped.sort()).toEqual(["Heston", "Sam", "Sam Rivera"]);
    await settle(w);
    for (const e of Object.keys(ids)) expect(sheetMails(mails, e)).toEqual([]); // no email 41
    for (const [e, id] of Object.entries(ids)) {
      const tok = await tokenOf(w, cs1, id);
      await expect(w.t.action(api.guests.sendCode, { token: tok })).rejects.toThrow(/own WranglerPortal login/);
      // Even with a code planted on the pass, the guest provider won't sign them in.
      await w.t.run(async (ctx) => { const p = (await ctx.db.query("guestPasses").withIndex("by_token", (q) => q.eq("token", tok)).unique())!; await ctx.db.patch(p._id, { codeHash: "x", codeExpiresAt: Date.now() + 60_000 }); });
      await expect(w.t.action(api.auth.signIn, { provider: "guest", params: { token: tok, code: "123456" } })).rejects.toThrow(/own WranglerPortal login/);
      expect((await w.t.run(async (ctx) => ctx.db.query("users").withIndex("email", (q) => q.eq("email", e)).collect())).map((u) => u.role)).not.toContain("guest");
    }
    // Their own logins work as before, and get nothing from the guest functions.
    expect((await w.heston.query(api.users.me, {})).role).toBe("owner");
    expect((await w.sam.query(api.users.me, {})).role).toBe("client");
    expect(await w.sam.query(api.projects.mine, {})).toBeTruthy();
    await expect(w.sam.query(api.guests.home, {})).rejects.toThrow(/Not allowed/);
    await expect(w.heston.query(api.guests.sheet, { token: await tokenOf(w, cs1, ids["heston@wranglerproductions.com"]) })).rejects.toThrow(/Not allowed/);
  }, 30_000);

  test("a guest login never becomes an owner, client or vendor by its email; invited since, it becomes one only once proved", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const { cs1 } = await setup(w);
    const riley = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: cs1, name: "Riley Quinn", email: RILEY, role: "Talent" }) as string;
    await w.heston.mutation(api.callSheets.send, { callSheetId: cs1, crew: true, client: true, guests: true });
    await settle(w);
    const tok = await tokenOf(w, cs1, riley);
    const rileyIn = await signInAsGuest(w, mails, tok, RILEY);
    // A membership for her email (as if a business made her an owner) gives the guest session nothing.
    await w.t.run(async (ctx) => { await ctx.db.insert("memberships", { businessId: w.A, email: RILEY, role: "owner", createdAt: 0 }); });
    await expect(rileyIn.query(api.library.overview, {})).rejects.toThrow(/Not allowed/);
    await expect(rileyIn.query(api.guests.home, {})).rejects.toThrow(/Not allowed/); // and no guest powers either now
    expect((await rileyIn.query(api.users.me, {})).allowed).toBe(false);
    await w.t.run(async (ctx) => { for (const m of await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", RILEY)).collect()) await ctx.db.delete(m._id); });
    expect((await rileyIn.query(api.guests.home, {})).sheets).toHaveLength(1);

    // Invited as a client since: setting a password doesn't change the guest login until the email is proved.
    await w.heston.mutation(api.clients.invite, { email: RILEY, name: "Riley Quinn" });
    mails.length = 0;
    await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email: RILEY, password: "longenoughpassword" } });
    let rows = await w.t.run(async (ctx) => ctx.db.query("users").withIndex("email", (q) => q.eq("email", RILEY)).collect());
    expect(rows).toHaveLength(1); // one row per email
    expect(rows[0].role).toBe("guest");
    // The invite made a client membership for her email: from then on the guest login gets nothing (she signs in as herself).
    await expect(rileyIn.query(api.guests.home, {})).rejects.toThrow(/Not allowed/);
    await expect(rileyIn.query(api.projects.mine, {})).rejects.toThrow(/Not allowed/);
    const code = /\b(\d{6})\b/.exec(mails[mails.length - 1].text)![1];
    const done = await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: RILEY, code } }) as { tokens?: unknown };
    expect(done.tokens).toBeTruthy();
    rows = await w.t.run(async (ctx) => ctx.db.query("users").withIndex("email", (q) => q.eq("email", RILEY)).collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("client");
    // The old guest session is gone, and the guest link no longer signs in.
    const old = await w.t.run(async (ctx) => (await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", rows[0]._id)).collect()).length);
    expect(old).toBe(1); // only the new password session
    await expect(rileyIn.query(api.guests.home, {})).rejects.toThrow();
    await w.t.run(async (ctx) => { const p = (await ctx.db.query("guestPasses").withIndex("by_token", (q) => q.eq("token", tok)).unique())!; await ctx.db.patch(p._id, { codeSentAt: 0 }); });
    await expect(w.t.action(api.guests.sendCode, { token: tok })).rejects.toThrow(/own WranglerPortal login/);
  }, 30_000);

  test("removing a guest or deleting a draft drops their link; the pieces", async () => {
    const w = await world();
    stub([]);
    const { cs1, cs2 } = await setup(w);
    const g = await w.heston.mutation(api.callSheets.addGuest, { callSheetId: cs1, name: "Riley Quinn", email: RILEY, role: "Talent" }) as string;
    const tok = await tokenOf(w, cs1, g);
    await w.heston.mutation(api.callSheets.removeGuest, { callSheetId: cs1, id: g });
    expect(await w.t.run(async (ctx) => ctx.db.query("guestPasses").withIndex("by_token", (q) => q.eq("token", tok)).unique())).toBeNull();
    await w.heston.mutation(api.callSheets.addGuest, { callSheetId: cs2, name: "Pat Lee", email: PAT, role: "Talent" });
    await w.heston.mutation(api.callSheets.deleteDraft, { callSheetId: cs2 });
    expect(await w.t.run(async (ctx) => ctx.db.query("guestPasses").withIndex("by_sheet", (q) => q.eq("callSheetId", cs2)).collect())).toEqual([]);
    // Guests added before passes existed get one from the backfill, once.
    await w.t.run(async (ctx) => { const c = (await ctx.db.get(cs1))!; await ctx.db.patch(cs1, { recipients: [...c.recipients, { id: "guest:old", kind: "guest", name: "Old", email: "old@example.com", on: true, addedAt: 0 }] }); });
    expect(await w.t.mutation(internal.guests.backfillPasses, {})).toEqual({ added: 1 });
    expect(await w.t.mutation(internal.guests.backfillPasses, {})).toEqual({ added: 0 });

    expect(masked("riley@example.com")).toBe("r•••@example.com");
    expect(projectClosed({ stage: "delivery", deliveryUnlockedAt: 1 })).toBe(true);
    expect(projectClosed({ stage: "delivery" })).toBe(false);
    expect(projectClosed({ stage: "polish", deliveryUnlockedAt: 1 })).toBe(false);
    const m = guestCallSheetMail(brandFrom(null, { ownerEmail: "h@w.co", logoUrl: null, isDefault: true }), { name: "Riley Quinn", title: "Product shoot · Harbor Coffee", dayLong: "Tuesday, Nov 3", call: "9:00 AM", where: "Studio B", from: "Heston Hill", link: "https://app.wranglerportal.com/guest/abc" });
    expect(m.subject).toBe("Call sheet for Tuesday, Nov 3: Product shoot · Harbor Coffee");
    for (const line of ["Hi Riley,", "added you to the call sheet for Tuesday, Nov 3.", "Your call", "9:00 AM", "Studio B", "Heston Hill", "No account needed.", "Your access ends the day after the shoot, or sooner if the project is closed, the shoot is cancelled or your access is ended.", "Open the call sheet"]) expect(m.text).toContain(line);
  });
});
