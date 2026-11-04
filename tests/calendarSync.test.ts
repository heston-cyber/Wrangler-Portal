// T5b.4 (Phase 5b step 5, D143): Production › Calendar, two-way with Google Calendar. Google is faked here (fetch is
// stubbed): sign-in (one account per sign-in code, each with its own tokens), the calendar list, and events with
// Google's incremental sync (sync tokens, 410 when one expires, deleted events coming back as "cancelled"), and Google's
// rule for event ids (base32hex). Nothing real is called.
// "review" tests (Nov 4): one for each independent review finding; each failed before its fix.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { readdirSync, readFileSync } from "node:fs";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { todayCentral } from "../convex/lib/bookings";
import { dateEventId, fromGoogle, newEventId, toGoogle } from "../convex/lib/gcal";
import { eventId as shootEventId } from "../convex/calendar";
import { moveNeedsAsk, snap15 } from "../src/modules/production/calendarModel";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://stoic-marlin-221.convex.site";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; });
type W = Awaited<ReturnType<typeof world>>;
const day = (n: number) => { const d = new Date(`${todayCentral()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const idToken = (email: string) => `x.${btoa(JSON.stringify({ email })).replace(/=+$/, "")}.y`;
const PICKED = "wrangler@group.calendar.google.com", PERSONAL = "heston@gmail.com", BOSS_CAL = "boss@other.example", HOLIDAYS = "en.usa#holiday@group.v.calendar.google.com";
const GOOGLE_ID = /^[a-v0-9]{5,1024}$/; // Google's rule for event ids (base32hex)

/** Google accounts, by the sign-in code that connects them. */
const ACCOUNTS: Record<string, { email: string; cals: Array<Record<string, unknown>> }> = {
  c1: { email: "heston@wranglerproductions.com", cals: [{ id: PERSONAL, summary: "Personal", primary: true, accessRole: "owner" }, { id: PICKED, summary: "Wrangler Productions", accessRole: "owner" }, { id: HOLIDAYS, summary: "Holidays", accessRole: "reader" }] },
  c2: { email: "boss@other.example", cals: [{ id: BOSS_CAL, summary: "Other Films", primary: true, accessRole: "owner" }, { id: PICKED, summary: "Shared team", accessRole: "writer" }] },
  c3: { email: "heston.studio@gmail.com", cals: [{ id: PICKED, summary: "Wrangler Productions", primary: true, accessRole: "owner" }] },
};

type Ev = Record<string, any> & { id: string; updated: string; status: string };
/** A stand-in Google Calendar: events per calendar with a change log, so sync tokens work like Google's. */
function fakeGoogle() {
  const g = {
    calls: [] as Array<{ method: string; url: string; body: any; acct: string | null }>,
    cals: new Map<string, Map<string, Ev>>([[PICKED, new Map()], [PERSONAL, new Map()], [BOSS_CAL, new Map()]]),
    log: [] as Array<{ seq: number; cal: string; id: string }>, seq: 0, last: 0, n: 0,
    expired: new Set<string>(), // sync tokens Google forgot (answers 410)
    stale: new Set<string>(),   // access tokens Google answers 401 to
    refreshFails: false, emails: [] as string[], revokes: [] as string[],
    onRevoke: null as null | (() => Promise<void>),
    stamp() { g.last = Math.max(Date.now(), g.last + 1); return new Date(g.last).toISOString(); },
    touch(cal: string, e: Ev) { if (!g.cals.has(cal)) g.cals.set(cal, new Map()); g.cals.get(cal)!.set(e.id, e); g.log.push({ seq: ++g.seq, cal, id: e.id }); },
    /** Changes made by someone in Google itself (a minute "later" than anything the portal did in the test). */
    inGoogle: {
      add(cal: string, e: Partial<Ev> & { id: string }) { g.last = Math.max(Date.now() + 60_000, g.last + 1); g.touch(cal, { status: "confirmed", ...e, updated: new Date(g.last).toISOString() } as Ev); },
      change(cal: string, id: string, patch: Partial<Ev>) { g.last = Math.max(Date.now() + 60_000, g.last + 1); g.touch(cal, { ...g.cals.get(cal)!.get(id)!, ...patch, updated: new Date(g.last).toISOString() }); },
      remove(cal: string, id: string) { g.last = Math.max(Date.now() + 60_000, g.last + 1); g.touch(cal, { ...g.cals.get(cal)!.get(id)!, status: "cancelled", updated: new Date(g.last).toISOString() }); },
    },
    live: (cal: string) => [...(g.cals.get(cal) ?? new Map<string, Ev>()).values()].filter((e) => e.status !== "cancelled"),
    writes: () => g.calls.filter((c) => c.method !== "GET" && c.url.includes("/events")),
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const ok = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status });
    if (url === "https://api.resend.com/emails") { g.emails.push(JSON.parse(String(init?.body)).subject); return ok({ id: "em" }); }
    const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body ? String(init.body) : null;
    const bearer = String((init?.headers as Record<string, string> | undefined)?.authorization ?? "").replace(/^Bearer /, "");
    const acct = /^gat-(c\d)-/.exec(bearer)?.[1] ?? null;
    g.calls.push({ method, url, body, acct });
    if (url === "https://oauth2.googleapis.com/token") {
      const f = new URLSearchParams(String(body));
      if (f.get("grant_type") === "refresh_token") {
        if (g.refreshFails) return ok({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
        const a = /^grt-(c\d)$/.exec(f.get("refresh_token") ?? "")?.[1] ?? "c1";
        return ok({ access_token: `gat-${a}-${++g.n}`, expires_in: 3600 });
      }
      const a = ACCOUNTS[f.get("code") ?? ""] ? f.get("code")! : "c1";
      return ok({ access_token: `gat-${a}-${++g.n}`, expires_in: 3600, refresh_token: `grt-${a}`, id_token: idToken(ACCOUNTS[a].email) });
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) { g.revokes.push(url); if (g.onRevoke) await g.onRevoke(); return ok({}); }
    if (g.stale.has(bearer) || !acct) return ok({ error: { message: "Invalid Credentials" } }, 401);
    if (url.includes("/users/me/calendarList")) return ok({ items: ACCOUNTS[acct].cals });
    const m = /\/calendars\/([^/?]+)\/events(?:\/([^?]+))?(?:\?(.*))?$/.exec(url);
    if (m) {
      const cal = decodeURIComponent(m[1]);
      if (!g.cals.has(cal)) g.cals.set(cal, new Map());
      const events = g.cals.get(cal)!;
      const id = m[2] ? decodeURIComponent(m[2]) : null;
      const q = new URLSearchParams(m[3] ?? "");
      if (method === "GET" && !id) {
        const tok = q.get("syncToken");
        if (tok && g.expired.has(tok)) return ok({ error: { message: "Sync token is no longer valid" } }, 410);
        const since = tok ? Number(tok.split(":").at(-1)) : null;
        const items = since === null ? [...events.values()].filter((e) => e.status !== "cancelled")
          : [...new Set(g.log.filter((l) => l.cal === cal && l.seq > since).map((l) => l.id))].map((i) => events.get(i)!);
        return ok({ items, nextSyncToken: `${cal}:${g.seq}` });
      }
      if (method === "POST") {
        if (!body?.id || !GOOGLE_ID.test(body.id)) return ok({ error: { message: "Invalid resource id value." } }, 400); // as Google answers
        const e: Ev = { ...body, id: body.id, status: "confirmed", updated: g.stamp(), htmlLink: `https://calendar.google.com/event?eid=${body.id}` };
        if (events.has(e.id)) return ok({ error: { message: "duplicate" } }, 409);
        g.touch(cal, e);
        return ok(e);
      }
      if (method === "PATCH") {
        const cur = events.get(id!);
        if (!cur) return ok({ error: { message: "Not Found" } }, 404);
        const e = { ...cur, ...body, updated: g.stamp() };
        g.touch(cal, e);
        return ok(e);
      }
      if (method === "DELETE") {
        const cur = events.get(id!);
        if (!cur || cur.status === "cancelled") return ok({ error: { message: "Gone" } }, 410);
        g.touch(cal, { ...cur, status: "cancelled", updated: g.stamp() });
        return new Response(null, { status: 204 });
      }
    }
    return new Response("{}", { status: 500 });
  }));
  return g;
}
type G = ReturnType<typeof fakeGoogle>;
/** Puts a check in front of the fake: return a Response to answer instead of it. */
function intercept(f: (url: string, init: RequestInit | undefined) => Response | null | undefined | Promise<Response | null | undefined>) {
  const inner = globalThis.fetch;
  vi.stubGlobal("fetch", async (u: any, i?: RequestInit) => (await f(String(u), i)) ?? inner(u, i));
}
const settle = async (w: W) => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] }); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const pull = async (w: W, as = w.heston) => { const r = await as.action(api.calendarSync.syncNow, {}); await settle(w); return r; };
const range = (w: W, as = w.heston) => as.query(api.calendarSync.range, { from: day(-3), to: day(30) });

/** Connect Google as an owner: Google's page, back to Settings › Calendar, then the calendar picked. */
async function connect(w: W, as = w.heston, code = "c1", calendarId = PICKED) {
  process.env.GOOGLE_CLIENT_ID = "gid"; process.env.GOOGLE_CLIENT_SECRET = "gsecret";
  const url = new URL(await as.action(api.calendar.authUrl, {}));
  const r = await w.t.fetch(`/calendar/callback?code=${code}&state=${url.searchParams.get("state")}`, { method: "GET" });
  const back = new URL(r.headers.get("location")!);
  await as.action(api.calendar.finish, { code: back.searchParams.get("gcode")!, state: back.searchParams.get("gstate")! });
  await as.mutation(api.calendar.save, { calendarId, calendarName: "Picked", inviteVendors: true, inviteClient: false });
  await settle(w);
}
/** Google stops letting the portal in (the saved sign-in is refused), and a pull finds out. */
async function breakSignIn(w: W, g: G) {
  g.refreshFails = true;
  await w.t.run(async (ctx) => { for (const c of await ctx.db.query("calendars").collect()) await ctx.db.patch(c._id, { accessExpiresAt: 0 }); });
  expect(await w.heston.action(api.calendarSync.syncNow, {})).toEqual({ state: "disconnected" });
  g.refreshFails = false;
}
async function withShoot(w: W, g: G) {
  const vendor = await w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: "jordan@ellisfilms.com", roles: ["Shooter"], rates: [], invite: false }) as Id<"vendors">;
  const booking = await w.heston.mutation(api.bookings.create, { vendorId: vendor, projectId: w.p, role: "Shooter", start: day(4), end: day(4), cents: 100_000, unit: "day" }) as Id<"vendorBookings">;
  const base = { date: day(4), call: "09:00", wrap: "16:00", location: "Floor Trader, Oklahoma City", prepare: [], withOwner: true, bookingIds: [booking], calendar: true };
  const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, ...base }) as { shootId: Id<"shoots"> };
  await settle(w);
  const ev = g.live(PICKED).find((e) => e.extendedProperties?.private?.portalShoot === shootId)!;
  expect(ev).toBeTruthy();
  return { shootId, base, ev };
}
/** Maya (Harbor Coffee) can open the project: she gets the shoot's Inbox items and emails 29/30. */
async function inviteMaya(w: W) {
  await w.heston.mutation(api.shares.create, { target: { kind: "client", client: "Harbor Coffee" }, access: "comment", who: "invited", emails: ["maya@harbor.example"], allVersions: true, downloads: false, emailNewVersions: false });
  await settle(w);
}
const shootRow = (w: W, id: Id<"shoots">) => w.t.run(async (ctx) => ctx.db.get(id));
const notes = async (w: W, as = w.heston) => (await as.query(api.home.needs, {})).filter((n: any) => n.kind === "shootMoved");
const sendUpdates = (c: { url: string }) => new URL(c.url).searchParams.get("sendUpdates");

describe("T5b.4 calendar sync", () => {
  test("1 incremental pull: new, changed and deleted events; an expired sync token reads the calendar in full again", async () => {
    const w = await world();
    const g = fakeGoogle();
    g.inGoogle.add(PICKED, { id: "g1", summary: "Team call", ...toGoogle({ date: day(1), endDate: day(1), start: "10:00", end: "10:30" }), attendees: [{ email: "sam@rivera.example", displayName: "Sam Rivera" }, { email: "heston@wranglerproductions.com", self: true }] });
    g.inGoogle.add(PERSONAL, { id: "p1", summary: "Dinner", ...toGoogle({ date: day(1), endDate: day(1), start: "17:00", end: "18:00" }) });
    await connect(w);
    let r = await range(w);
    // Only the picked calendar is shown at first; all three calendars are in the list.
    expect(r.conn).toMatchObject({ state: "ok", picked: PICKED });
    expect(r.conn.calendars.map((c: any) => [c.name, c.on, c.writable])).toEqual([["Personal", false, true], ["Wrangler Productions", true, true], ["Holidays", false, false]]);
    expect(r.events.map((e: any) => [e.title, e.date, e.start, e.end, e.guests])).toEqual([["Team call", day(1), "10:00", "10:30", ["Sam Rivera"]]]);
    // The first read was a full one; the next ones send the sync token.
    const lists = () => g.calls.filter((c) => c.method === "GET" && c.url.includes(`/calendars/${encodeURIComponent(PICKED)}/events`));
    expect(lists()[0].url).toContain("timeMin=");
    expect(lists()[0].url).toContain("singleEvents=true");
    // Personal turned on: its events come in.
    await w.heston.mutation(api.calendarSync.setShown, { calendarId: PERSONAL, on: true });
    await settle(w);
    expect((await range(w)).events.map((e: any) => e.title).sort()).toEqual(["Dinner", "Team call"]);
    // New, changed, deleted in Google → the next pull (incremental) has them.
    g.inGoogle.add(PICKED, { id: "g2", summary: "Studio rental", ...toGoogle({ date: day(3), endDate: day(3) }) });
    g.inGoogle.change(PICKED, "g1", { summary: "Team call (moved)", ...toGoogle({ date: day(2), endDate: day(2), start: "11:00", end: "11:30" }) });
    g.inGoogle.remove(PERSONAL, "p1");
    expect(await pull(w)).toEqual({ state: "ok" });
    expect(lists().at(-1)!.url).toContain("syncToken=");
    r = await range(w);
    expect(r.events.map((e: any) => [e.title, e.date, e.start]).sort()).toEqual([["Studio rental", day(3), null], ["Team call (moved)", day(2), "11:00"]]);
    expect(r.conn.lastSyncedAt).toBeTypeOf("number");
    // 410: the token expired. Read in full again; what Google no longer has is dropped.
    const before = lists().length;
    for (const cal of g.cals.keys()) for (let n = 0; n <= g.seq; n++) g.expired.add(`${cal}:${n}`);
    g.cals.get(PICKED)!.delete("g2"); // gone without a trace (no "cancelled" entry): only a full read finds that out
    await pull(w);
    const after = lists().slice(before).filter((c) => c.url.includes(encodeURIComponent(PICKED)));
    expect(after.map((c) => (c.url.includes("syncToken=") ? "incremental" : "full"))).toEqual(["incremental", "full"]);
    expect((await range(w)).events.map((e: any) => e.title)).toEqual(["Team call (moved)"]);
    // Hidden again: its events aren't kept.
    await w.heston.mutation(api.calendarSync.setShown, { calendarId: PERSONAL, on: false });
    expect((await range(w)).conn.calendars.find((c: any) => c.id === PERSONAL).on).toBe(false);
  });

  test("2 an event made in the portal lands in Google on the picked calendar (guests invited by Google); edit and delete go too", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    const id = await w.heston.mutation(api.calendarSync.create, { title: "Location scout · Floor Trader", date: day(9), endDate: day(9), start: "10:00", end: "11:00", location: "Floor Trader, Oklahoma City", guests: ["Sam@Rivera.example"], projectId: w.p });
    await settle(w);
    const post = g.calls.find((c) => c.method === "POST" && c.url.includes("/events"))!;
    expect(post.url).toContain(`/calendars/${encodeURIComponent(PICKED)}/events?sendUpdates=all`);
    expect(post.body).toMatchObject({ summary: "Location scout · Floor Trader", location: "Floor Trader, Oklahoma City", start: { dateTime: `${day(9)}T10:00:00`, timeZone: "America/Chicago" }, end: { dateTime: `${day(9)}T11:00:00` }, attendees: [{ email: "sam@rivera.example" }] });
    expect(post.body.id).toMatch(GOOGLE_ID);
    expect(post.body.extendedProperties.private).toMatchObject({ portalEvent: "1", portalLinkProject: w.p });
    const ev = (await range(w)).events.find((e: any) => e._id === id);
    expect(ev).toMatchObject({ title: "Location scout · Floor Trader", pending: false, htmlLink: expect.stringContaining("calendar.google.com") });
    // A retried create makes one event, not two (the portal picks the id).
    await w.t.run(async (ctx) => { await ctx.db.patch(id as Id<"calendarEvents">, { pending: "create", pendingAt: Date.now() }); });
    await w.t.action(anyApi.calendarSync.push, { eventId: id, asBusiness: w.A });
    expect(g.live(PICKED)).toHaveLength(1);
    // Edit (no time change, same guests): Google doesn't email anyone.
    await w.heston.mutation(api.calendarSync.update, { eventId: id, title: "Scout", date: day(9), endDate: day(9), start: "10:00", end: "11:00", location: "", guests: ["sam@rivera.example"], notify: false });
    await settle(w);
    const patch = g.writes().at(-1)!;
    expect(patch.method).toBe("PATCH");
    expect(patch.url).toContain("sendUpdates=none");
    expect(patch.body.attendees).toBeUndefined(); // guest list unchanged: not sent
    expect(g.live(PICKED)[0].summary).toBe("Scout");
    // Another calendar it can only read: refused.
    await expect(w.heston.mutation(api.calendarSync.create, { title: "x", date: day(9), endDate: day(9), guests: [], calendarId: "en.usa#holiday@group.v.calendar.google.com" })).rejects.toThrow(/can't add events/);
    // Delete: gone from Google, guests get Google's cancellation.
    await w.heston.mutation(api.calendarSync.remove, { eventId: id });
    expect((await range(w)).events).toHaveLength(0); // hidden at once
    await settle(w);
    expect(g.writes().at(-1)!).toMatchObject({ method: "DELETE" });
    expect(g.writes().at(-1)!.url).toContain("sendUpdates=all");
    expect(g.live(PICKED)).toHaveLength(0);
    expect(await w.t.run(async (ctx) => ctx.db.get(id as Id<"calendarEvents">))).toBeNull();
  });

  test("3+4 a drag-move writes to Google and Undo puts it back; with guests it asks first: Move only (sendUpdates none) or Move and notify (all)", async () => {
    const w = await world();
    const g = fakeGoogle();
    g.inGoogle.add(PICKED, { id: "solo", summary: "Dinner", ...toGoogle({ date: day(2), endDate: day(2), start: "17:00", end: "18:00" }) });
    g.inGoogle.add(PICKED, { id: "team", summary: "Floor Trader interviews", ...toGoogle({ date: day(2), endDate: day(2), start: "09:00", end: "16:00" }), attendees: [{ email: "jordan@ellisfilms.com", displayName: "Jordan Ellis" }, { email: "sam@rivera.example", displayName: "Sam Rivera" }] });
    await connect(w);
    const evs = (await range(w)).events;
    const solo = evs.find((e: any) => e.title === "Dinner"), team = evs.find((e: any) => e.title === "Floor Trader interviews");
    // The page asks only when there are guests (and never for a resize or move that doesn't change the time).
    expect(moveNeedsAsk(solo)).toBe(false);
    expect(moveNeedsAsk(team)).toBe(true);
    expect(snap15(17 * 60 + 53)).toBe(18 * 60);
    expect(snap15(17 * 60 + 52)).toBe(17 * 60 + 45);
    // No guests: dropped on Wednesday 6–7 PM; written at once with sendUpdates=none.
    await w.heston.mutation(api.calendarSync.move, { eventId: solo._id, date: day(3), endDate: day(3), start: "18:00", end: "19:00", notify: false });
    expect((await range(w)).events.find((e: any) => e._id === solo._id)).toMatchObject({ date: day(3), start: "18:00", canUndo: true });
    await settle(w);
    expect(g.cals.get(PICKED)!.get("solo")!.start).toEqual({ dateTime: `${day(3)}T18:00:00`, timeZone: "America/Chicago" });
    expect(g.writes().at(-1)!.url).toContain("sendUpdates=none");
    // Undo: back where it was, in the portal and in Google.
    await w.heston.mutation(api.calendarSync.undoMove, { eventId: solo._id });
    await settle(w);
    expect(g.cals.get(PICKED)!.get("solo")!.start.dateTime).toBe(`${day(2)}T17:00:00`);
    expect((await range(w)).events.find((e: any) => e._id === solo._id)).toMatchObject({ date: day(2), start: "17:00", canUndo: false });
    await expect(w.heston.mutation(api.calendarSync.undoMove, { eventId: solo._id })).rejects.toThrow(/too late/);
    // Guests, "Move only": Google moves it and emails nobody.
    await w.heston.mutation(api.calendarSync.move, { eventId: team._id, date: day(9), endDate: day(9), start: "09:00", end: "16:00", notify: false });
    await settle(w);
    expect(g.writes().at(-1)!.url).toContain("sendUpdates=none");
    expect(g.writes().at(-1)!.body.attendees).toBeUndefined();
    // "Move and notify": Google emails the guests the new time. Undo tells them again (they'd have the wrong time otherwise).
    await w.heston.mutation(api.calendarSync.move, { eventId: team._id, date: day(10), endDate: day(10), start: "09:00", end: "16:00", notify: true });
    await settle(w);
    expect(g.writes().at(-1)!.url).toContain("sendUpdates=all");
    await w.heston.mutation(api.calendarSync.undoMove, { eventId: team._id });
    await settle(w);
    expect(g.writes().at(-1)!.url).toContain("sendUpdates=all");
    expect(g.cals.get(PICKED)!.get("team")!.start.dateTime).toBe(`${day(9)}T09:00:00`);
    // Resize (end only) works the same way.
    await w.heston.mutation(api.calendarSync.move, { eventId: solo._id, date: day(2), endDate: day(2), start: "17:00", end: "19:30", notify: false });
    await settle(w);
    expect(g.cals.get(PICKED)!.get("solo")!.end.dateTime).toBe(`${day(2)}T19:30:00`);
  });

  test("5 a shoot moved in Google moves the portal's shoot, emails nobody, keeps the confirmation, and leaves one Dashboard note", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    await inviteMaya(w);
    const { shootId, ev } = await withShoot(w, g);
    await w.maya.mutation(api.shoots.confirm, { shootId });
    await settle(w);
    const sent = g.emails.length;
    // Someone drags it to the next day, 10–5, in Google.
    g.inGoogle.change(PICKED, ev.id, toGoogle({ date: day(5), endDate: day(5), start: "10:00", end: "17:00" }));
    const writes = g.writes().length;
    await pull(w);
    const s = (await shootRow(w, shootId))!;
    expect(s).toMatchObject({ date: day(5), call: "10:00", wrap: "17:00", location: "Floor Trader, Oklahoma City" });
    // Heston (Nov 4): the confirmation stands and nothing says "moved" until he presses Ask to confirm.
    expect(s.confirmed).toMatchObject({ email: "maya@harbor.example" });
    expect(s.moved).toBeUndefined();
    expect(s.history.at(-1)!.text).toMatch(/^Moved in Google Calendar from/);
    expect(g.emails.length).toBe(sent); // nobody emailed
    expect(g.writes().length).toBe(writes); // and nothing written back to Google
    const inbox = await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).filter((i) => i.kind === "shoot"));
    const inboxBefore = inbox.length;
    // One Dashboard note, even after more pulls.
    await pull(w); await pull(w);
    expect(await notes(w)).toEqual([expect.objectContaining({ shootId, date: day(5), call: "10:00", wasDate: day(4), wasCall: "09:00", people: 1, crew: 1, kept: false })]);
    expect(g.writes().length).toBe(writes);
    // On the calendar the shoot is at its new time (the portal layer), not twice.
    const r = await range(w);
    expect(r.shoots.map((x: any) => [x._id, x.date, x.call, x.movedInGoogle, x.confirmed])).toEqual([[shootId, day(5), "10:00", true, true]]);
    expect(r.events).toHaveLength(0);
    // "Ask the client to confirm" sends the portal's usual move message (Inbox + email 30), once; the note goes, and
    // only now is the confirmation cleared and the shoot shown as moved.
    await w.heston.mutation(api.calendarSync.askConfirmAgain, { shootId });
    await settle(w);
    expect(g.emails.length).toBe(sent + 1);
    expect(g.emails.at(-1)).toMatch(/moved|confirm/i);
    expect((await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).filter((i) => i.kind === "shoot"))).length).toBe(inboxBefore + 1);
    expect(await notes(w)).toEqual([]);
    expect(await shootRow(w, shootId)).toMatchObject({ moved: { date: day(4), call: "09:00" } });
    expect((await shootRow(w, shootId))!.confirmed).toBeUndefined();
    // A later portal edit wins over an older Google change it hasn't seen yet (last write wins), and Google gets it.
    await w.heston.mutation(api.shoots.update, { shootId, date: day(6), call: "08:00", wrap: "12:00", location: "Floor Trader, Oklahoma City", prepare: [], withOwner: true, bookingIds: [], calendar: true });
    await settle(w);
    expect(g.cals.get(PICKED)!.get(ev.id)!.start.dateTime).toBe(`${day(6)}T08:00:00`);
    // A new place set in Google counts as a move too (Heston, Nov 4).
    g.inGoogle.change(PICKED, ev.id, { location: "Harbor Coffee, 412 Main St." });
    await pull(w);
    expect(await shootRow(w, shootId)).toMatchObject({ location: "Harbor Coffee, 412 Main St.", date: day(6) });
    expect(await notes(w)).toEqual([expect.objectContaining({ shootId, kept: false })]);
    // "Done" keeps things as they are (the confirmation too).
    await w.heston.mutation(api.calendarSync.shootMoveDone, { shootId });
    expect(await notes(w)).toEqual([]);
    // Deleted in Google: off the calendar (unticked); the shoot stays.
    g.inGoogle.remove(PICKED, ev.id);
    await pull(w);
    expect(await shootRow(w, shootId)).toMatchObject({ status: "scheduled", calendar: false, date: day(6) });
  });

  test("5b dragging a shoot keeps the portal's own move (asks the client again, email 30) and Undo takes it all back", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    await inviteMaya(w);
    const { shootId, ev } = await withShoot(w, g);
    const sent = g.emails.length, w0 = g.writes().length;
    // Fake timers from here, so the email held back for the Undo (12 s) really runs in the test.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const run = () => w.t.finishAllScheduledFunctions(vi.runAllTimers);
    await w.heston.mutation(api.calendarSync.moveShoot, { shootId, date: day(5), call: "10:00", wrap: "17:00", notify: false });
    const firstAt = (await shootRow(w, shootId))!.createdAt; // email 29's key; email 30 for this move would be another
    const inbox = await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).filter((i) => i.kind === "shoot" && i.title.startsWith("Shoot moved")));
    expect(inbox).toHaveLength(1);
    await w.heston.mutation(api.calendarSync.undoShoot, { shootId });
    await run();
    expect(await w.t.run(async (ctx) => (await ctx.db.query("emailLog").collect()).filter((l) => l.key.includes(`shoot:${shootId}:`) && l.key.split(":")[2] !== String(firstAt)).length)).toBe(0);
    expect(await shootRow(w, shootId)).toMatchObject({ date: day(4), call: "09:00", wrap: "16:00" });
    expect(g.emails.length).toBe(sent); // email 30 was held for the Undo, then not sent
    expect(await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).filter((i) => i.kind === "shoot" && i.title.startsWith("Shoot moved")))).toHaveLength(0);
    expect(g.cals.get(PICKED)!.get(ev.id)!.start.dateTime).toBe(`${day(4)}T09:00:00`);
    expect(g.writes().slice(w0).filter((c) => c.url.includes(ev.id)).every((c) => c.url.includes("sendUpdates=none"))).toBe(true);
    // Not undone: the email goes after the wait; Move and notify lets Google email the crew.
    await w.heston.mutation(api.calendarSync.moveShoot, { shootId, date: day(5), call: "10:00", wrap: "17:00", notify: true });
    await run();
    vi.useRealTimers();
    expect(g.emails.length).toBe(sent + 1);
    expect(g.writes().at(-1)!.url).toContain("sendUpdates=all");
    expect(g.cals.get(PICKED)!.get(ev.id)!.start.dateTime).toBe(`${day(5)}T10:00:00`);
    // Its own write coming back in a pull changes nothing and makes no note.
    await pull(w);
    expect((await w.heston.query(api.home.needs, {})).filter((n: any) => n.kind === "shootMoved")).toEqual([]);
  });

  test("6 edit dates go to Google as all-day events, portal → Google only", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    await w.heston.mutation(api.projects.setKeyDates, { projectId: w.p, dates: [{ label: "Cut 2 due", date: day(6) }, { label: "Shoot", date: day(4) }] });
    await settle(w);
    const dates = () => g.live(PICKED).filter((e) => e.extendedProperties?.private?.portalDate);
    expect(dates()).toHaveLength(1); // "Shoot" isn't an edit date
    expect(dates()[0]).toMatchObject({ summary: "Cut 2 due · Launch", start: { date: day(6) }, end: { date: day(7) }, transparency: "transparent" });
    expect(g.writes().filter((c) => c.url.includes("/events/pdt") || c.body?.id?.startsWith?.("pdt")).every((c) => c.url.includes("sendUpdates=none"))).toBe(true);
    // On the calendar page they come from the project (the "Edit dates" layer), not from Google.
    expect((await range(w)).dates).toEqual([{ projectId: w.p, project: "Launch", label: "Cut 2 due", date: day(6), saving: false }]);
    expect((await range(w)).events).toHaveLength(0);
    // Moved in Google: the portal keeps its date and puts Google's back.
    const id = dates()[0].id;
    g.inGoogle.change(PICKED, id, toGoogle({ date: day(8), endDate: day(8) }));
    await pull(w);
    expect((await w.t.run(async (ctx) => ctx.db.get(w.p)))!.keyDates).toEqual([{ label: "Shoot", date: day(4) }, { label: "Cut 2 due", date: day(6) }]);
    expect(g.cals.get(PICKED)!.get(id)!.start).toEqual({ date: day(6) });
    // Deleted in Google: written again.
    g.inGoogle.remove(PICKED, id);
    await pull(w);
    expect(dates()).toHaveLength(1);
    // Dragged in the portal: Google follows. Removed in the portal: deleted in Google.
    await w.heston.mutation(api.calendarSync.moveDate, { projectId: w.p, label: "Cut 2 due", from: day(6), to: day(7) });
    await settle(w);
    expect(dates()[0].start).toEqual({ date: day(7) });
    await w.heston.mutation(api.projects.setKeyDates, { projectId: w.p, dates: [] });
    await settle(w);
    expect(dates()).toHaveLength(0);
  });

  test("7 no echo loops: the portal's own writes coming back change nothing, write nothing and email nobody", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    await inviteMaya(w);
    await withShoot(w, g);
    await w.heston.mutation(api.projects.setKeyDates, { projectId: w.p, dates: [{ label: "Cut 1 due", date: day(5) }] });
    const id = await w.heston.mutation(api.calendarSync.create, { title: "Team call", date: day(2), endDate: day(2), start: "10:00", end: "11:00", guests: ["sam@rivera.example"] });
    await settle(w);
    await w.heston.mutation(api.calendarSync.move, { eventId: id, date: day(3), endDate: day(3), start: "10:00", end: "11:00", notify: true });
    await settle(w);
    await pull(w);
    const snapshot = async () => w.t.run(async (ctx) => ({ shoots: await ctx.db.query("shoots").collect(), rows: (await ctx.db.query("calendarEvents").collect()).map(({ syncedAt: _s, seen: _n, ...r }) => r), inbox: (await ctx.db.query("inboxItems").collect()).length }));
    const before = await snapshot();
    const writes = g.writes().length, emails = g.emails.length;
    for (let i = 0; i < 3; i++) await pull(w);
    expect(g.writes().length).toBe(writes);
    expect(g.emails.length).toBe(emails);
    expect(await snapshot()).toEqual(before);
    expect((await w.heston.query(api.home.needs, {})).filter((n: any) => n.kind === "shootMoved")).toEqual([]);
  });

  test("8 another business's owner sees none of it and can change none of it", async () => {
    const w = await world();
    const g = fakeGoogle();
    g.inGoogle.add(PICKED, { id: "g1", summary: "Team call", ...toGoogle({ date: day(1), endDate: day(1), start: "10:00", end: "10:30" }) });
    await connect(w);
    const { shootId } = await withShoot(w, g);
    const ev = (await range(w)).events[0];
    const r = await range(w, w.boss);
    expect(r).toMatchObject({ conn: { state: "none" }, events: [], shoots: [], dates: [] });
    await expect(w.boss.mutation(api.calendarSync.move, { eventId: ev._id, date: day(3), endDate: day(3), start: "10:00", end: "11:00", notify: false })).rejects.toThrow();
    await expect(w.boss.mutation(api.calendarSync.moveShoot, { shootId, date: day(5), call: "10:00", notify: false })).rejects.toThrow();
    await expect(w.boss.action(api.calendarSync.syncNow, {})).resolves.toEqual({ state: "off" }); // nothing of theirs to sync
    await expect(w.maya.query(api.calendarSync.range, { from: day(0), to: day(7) })).rejects.toThrow(/Not allowed/);
    expect((await range(w)).events[0]).toMatchObject({ date: day(1), start: "10:00" });
    // The cron pulls each business as itself (one scheduled pull each).
    const lists = g.calls.length;
    expect(await w.t.action(anyApi.calendarSync.pullAll, {})).toBe(1);
    await settle(w);
    expect(g.calls.length).toBeGreaterThan(lists);
  });

  test("9 a disconnected connection shows the disconnected state, hides Google's events, keeps shoots, and throws nothing", async () => {
    const w = await world();
    const g = fakeGoogle();
    g.inGoogle.add(PICKED, { id: "g1", summary: "Team call", ...toGoogle({ date: day(1), endDate: day(1), start: "10:00", end: "10:30" }) });
    await connect(w);
    await withShoot(w, g);
    // Google stops letting the portal in.
    await breakSignIn(w, g);
    const r = await range(w);
    expect(r.conn).toMatchObject({ state: "disconnected", disconnectedAt: expect.any(Number) });
    expect(r.conn.calendars.length).toBeGreaterThan(0); // the list stays, greyed
    expect(r.events).toHaveLength(0); // hidden, not deleted
    expect(await w.t.run(async (ctx) => (await ctx.db.query("calendarEvents").collect()).length)).toBe(1);
    expect(r.shoots).toHaveLength(1);
    await expect(w.t.action(anyApi.calendarSync.pullAll, {})).resolves.toBe(0); // the cron skips it
    await expect(w.heston.mutation(api.calendarSync.create, { title: "x", date: day(2), endDate: day(2), guests: [] })).rejects.toThrow(/Reconnect Google/);
    expect((await w.heston.query(api.calendar.settings, {})).connection).toMatchObject({ disconnected: true });
    // Reconnect: the same account picks up where it left off.
    await connect(w);
    const back = await range(w);
    expect(back.conn.state).toBe("ok");
    expect(back.events.map((e: any) => e.title)).toEqual(["Team call"]);
  });

  test("times: Google's forms to the portal's and back", () => {
    expect(fromGoogle({ dateTime: "2026-11-05T15:00:00Z" }, { dateTime: "2026-11-05T22:00:00Z" })).toEqual({ date: "2026-11-05", endDate: "2026-11-05", start: "09:00", end: "16:00" });
    // A dateTime with no offset is read in its own timeZone, never the server's (Nov 3: failed in UTC CI).
    expect(fromGoogle({ dateTime: "2026-11-05T17:00:00", timeZone: "America/Chicago" }, { dateTime: "2026-11-05T18:30:00", timeZone: "America/Chicago" })).toEqual({ date: "2026-11-05", endDate: "2026-11-05", start: "17:00", end: "18:30" });
    expect(fromGoogle({ dateTime: "2026-11-05T17:00:00", timeZone: "America/New_York" }, { dateTime: "2026-11-05T18:00:00", timeZone: "America/New_York" })).toEqual({ date: "2026-11-05", endDate: "2026-11-05", start: "16:00", end: "17:00" });
    expect(fromGoogle({ dateTime: "2026-03-08T03:30:00", timeZone: "America/Chicago" }, undefined)).toMatchObject({ date: "2026-03-08", start: "03:30" }); // the spring-forward day
    expect(fromGoogle({ dateTime: "2026-11-05T17:00:00", timeZone: "Not/AZone" }, undefined)).toMatchObject({ start: "17:00" }); // unknown zone: the business's
    expect(fromGoogle({ date: "2026-11-26" }, { date: "2026-11-28" })).toEqual({ date: "2026-11-26", endDate: "2026-11-27" });
    expect(fromGoogle({ dateTime: "2026-11-05T22:00:00-06:00" }, { dateTime: "2026-11-06T00:00:00-06:00" })).toEqual({ date: "2026-11-05", endDate: "2026-11-05", start: "22:00", end: "23:59" });
    expect(toGoogle({ date: "2026-11-26", endDate: "2026-11-27" })).toEqual({ start: { date: "2026-11-26" }, end: { date: "2026-11-28" } });
  });
});

// ======================= independent review fixes (Nov 4) =======================
const internalApi = anyApi;
const B_PROJECT = "Other Films Secret Feature";

describe("T5b.4 review fixes", () => {
  test("H1 two businesses connect and reconnect, the cron runs: each business's rows and Google writes stay its own", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w); // Heston (A): Google account c1, Wrangler Productions picked
    await connect(w, w.boss, "c2", BOSS_CAL); // Other Films (B): its own account
    const bProject = await w.boss.mutation(api.library.createProject, { name: B_PROJECT }) as Id<"projects">;
    await w.boss.mutation(api.projects.setKeyDates, { projectId: bProject, dates: [{ label: "Rough cut due", date: day(8) }] });
    await w.heston.mutation(api.projects.setKeyDates, { projectId: w.p, dates: [{ label: "Cut 2 due", date: day(6) }] });
    await w.boss.mutation(api.calendarSync.setShown, { calendarId: PICKED, on: true }); // B also shows the shared team calendar
    await settle(w);
    g.inGoogle.add(PICKED, { id: "teamcall1", summary: "Team call", ...toGoogle({ date: day(2), endDate: day(2), start: "10:00", end: "11:00" }) });
    g.inGoogle.add(BOSS_CAL, { id: "bossdinner1", summary: "Boss: dinner with investor", ...toGoogle({ date: day(2), endDate: day(2), start: "19:00", end: "21:00" }) });
    // Both lose Google and reconnect (the reconnect is what used to run an unscoped pull), then the cron runs.
    await breakSignIn(w, g);
    await connect(w);
    g.refreshFails = true;
    await w.t.run(async (ctx) => { for (const c of await ctx.db.query("calendars").collect()) await ctx.db.patch(c._id, { accessExpiresAt: 0 }); });
    expect(await w.boss.action(api.calendarSync.syncNow, {})).toEqual({ state: "disconnected" });
    g.refreshFails = false;
    await connect(w, w.boss, "c2", BOSS_CAL);
    expect(await w.t.action(internalApi.calendarSync.pullAll, {})).toBe(2);
    await settle(w);
    // B's project never reaches A's calendar, nor A's B's; each business's dates go on its own picked calendar.
    const titles = (cal: string) => g.live(cal).map((e) => e.summary).sort();
    expect(titles(PICKED)).toEqual(["Cut 2 due · Launch", "Team call"]);
    expect(titles(BOSS_CAL)).toEqual(["Boss: dinner with investor", `Rough cut due · ${B_PROJECT}`]);
    // Every write to a calendar used that business's own Google account.
    for (const c of g.writes()) expect(c.acct).toBe(c.url.includes(encodeURIComponent(BOSS_CAL)) ? "c2" : "c1");
    // The portal's rows: each business's own, from its own calendars.
    const rows = await w.t.run(async (ctx) => (await ctx.db.query("calendarEvents").collect()).map((r) => [r.businessId === w.A ? "A" : "B", r.calendarId, r.kind, r.title]));
    const B = await w.t.run(async (ctx) => (await ctx.db.query("businesses").collect()).find((b) => b._id !== w.A)!._id);
    expect(rows.filter(([b]) => b === "A").every(([, cal]) => cal === PICKED)).toBe(true);
    expect(rows.filter(([, , , t]) => String(t).includes(B_PROJECT)).every(([b]) => b === "B")).toBe(true);
    expect(rows.filter(([, , , t]) => t === "Boss: dinner with investor").map(([b]) => b)).toEqual(["B"]);
    expect(rows.filter(([b, , kind]) => b === "B" && kind === "date").map(([, cal]) => cal)).toEqual([BOSS_CAL]);
    expect((await range(w)).events.map((e: any) => e.title)).toEqual(["Team call"]);
    // B shows the shared team calendar too: there A's edit date is just a Google event to B, read-only.
    expect((await range(w, w.boss)).events.map((e: any) => [e.title, e.readOnly]).sort()).toEqual([["Boss: dinner with investor", false], ["Cut 2 due · Launch", true], ["Team call", false]]);
    expect(rows.filter(([b, , kind]) => b === "B" && kind === "date")).toHaveLength(1);
    expect(B).not.toBe(w.A);
  });

  test("H1 calendar sync's internal functions refuse to run for no business", async () => {
    const w = await world();
    fakeGoogle();
    await connect(w);
    const [row] = await w.t.run(async (ctx) => [await ctx.db.insert("calendarEvents", { businessId: w.A, kind: "google", calendarId: PICKED, googleId: "abcdef12", title: "x", date: day(1), endDate: day(1), guests: [], gUpdated: 0, syncedAt: 0, createdAt: 0 })]);
    const nobody = /one business at a time/;
    await expect(w.t.action(internalApi.calendarSync.pull, {})).rejects.toThrow(nobody);
    await expect(w.t.action(internalApi.calendarSync.push, { eventId: row })).rejects.toThrow(nobody);
    await expect(w.t.action(internalApi.calendarSync.pushDates, {})).rejects.toThrow(nobody);
    await expect(w.t.query(internalApi.calendarSync.datesPlan, {})).rejects.toThrow(nobody);
    await expect(w.t.mutation(internalApi.calendarSync.apply, { calendarId: PICKED, items: [] })).rejects.toThrow(nobody);
    await expect(w.t.mutation(internalApi.calendarSync.lock, {})).rejects.toThrow(nobody);
    await expect(w.t.mutation(internalApi.calendarSync.purge, { why: "all", before: Date.now() })).rejects.toThrow(nobody);
    await expect(w.t.query(internalApi.calendar.getConnection, {})).rejects.toThrow(nobody);
    await expect(w.t.action(internalApi.calendar.resync, {})).rejects.toThrow(nobody);
    // With the business, they run.
    await expect(w.t.query(internalApi.calendarSync.datesPlan, { asBusiness: w.A })).resolves.toMatchObject({ calendarId: PICKED });
  });

  test("H1 no plain action in convex/ schedules a job without saying which business it's for", () => {
    // Scheduled jobs don't carry the caller's sign-in, so a job scheduled from a plain action runs for no business unless
    // the action schedules through forBusiness(...) or passes asBusiness. Known older ones, reviewed and listed here:
    // they act on one record they name (a Stripe invoice, a subscription), not on "the business's" data.
    const KNOWN: Record<string, string> = {
      "subscriptions.ts setupDone": "importInvoice by Stripe account + invoice id",
      "subscriptions.ts cancel": "sendCancelled by subscription id",
    };
    const offenders: string[] = [];
    for (const f of readdirSync("convex").filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(`convex/${f}`, "utf8");
      for (const m of src.matchAll(/export const (\w+) = action\(/g)) {
        const rest = src.slice(m.index! + m[0].length);
        const end = rest.search(/\nexport (const|async function|function|class) /);
        const body = end < 0 ? rest : rest.slice(0, end);
        for (const line of body.split("\n").filter((l) => /ctx\.scheduler\./.test(l))) {
          if (/forBusiness\(|asBusiness/.test(line) || /^\s*const ctx = forBusiness\(/m.test(body)) continue;
          if (!KNOWN[`${f} ${m[1]}`]) offenders.push(`${f} ${m[1]}: ${line.trim().slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("H2 a client confirming between a Google move and the next pull doesn't undo the move; nobody is emailed", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    await inviteMaya(w);
    const { shootId, ev } = await withShoot(w, g);
    g.inGoogle.change(PICKED, ev.id, toGoogle({ date: day(5), endDate: day(5), start: "10:00", end: "17:00" }));
    g.cals.get(PICKED)!.get(ev.id)!.updated = new Date(Date.now()).toISOString(); // Google's change, now
    await new Promise((r) => setTimeout(r, 5));
    await w.maya.mutation(api.shoots.confirm, { shootId }); // Maya confirms after it, at the time she still sees
    await settle(w);
    const w0 = g.writes().length, e0 = g.emails.length;
    await pull(w);
    expect(g.writes().slice(w0).filter((c) => c.url.includes(ev.id))).toEqual([]); // Heston's Google move stands
    expect(g.cals.get(PICKED)!.get(ev.id)!.start.dateTime).toBe(`${day(5)}T10:00:00`);
    expect(await shootRow(w, shootId)).toMatchObject({ date: day(5), call: "10:00", confirmed: { email: "maya@harbor.example" } });
    expect(await notes(w)).toEqual([expect.objectContaining({ shootId, kept: false })]);
    expect(g.emails.length).toBe(e0);
  });

  test("H2 a portal change newer than Google's is written over it with sendUpdates=none, and the owner gets a note", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    const { shootId, ev } = await withShoot(w, g); // Jordan (vendor) is a Google guest
    g.inGoogle.change(PICKED, ev.id, toGoogle({ date: day(7), endDate: day(7), start: "12:00", end: "14:00" }));
    // The portal changed the shoot after that (its own write not in Google yet).
    await w.t.run(async (ctx) => { await ctx.db.patch(shootId, { calAt: Date.now() + 120_000 }); });
    const w0 = g.writes().length;
    await pull(w);
    const mine = g.writes().slice(w0).filter((c) => c.url.includes(ev.id));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.map(sendUpdates)).toEqual(mine.map(() => "none"));
    expect(g.cals.get(PICKED)!.get(ev.id)!.start.dateTime).toBe(`${day(4)}T09:00:00`);
    expect(await shootRow(w, shootId)).toMatchObject({ date: day(4), call: "09:00" });
    expect(await notes(w)).toEqual([expect.objectContaining({ shootId, kept: true, wasDate: day(7), wasCall: "12:00", date: day(4) })]);
    expect(await w.heston.mutation(api.calendarSync.askConfirmAgain, { shootId })).toEqual({ told: 0 }); // nothing moved: just closes it
    expect(await notes(w)).toEqual([]);
    // Nothing else runs with "all" on its own: the next pulls write nothing.
    const w1 = g.writes().length;
    await pull(w);
    expect(g.writes().length).toBe(w1);
  });

  test("H3 the ids the portal picks are base32hex, so Google takes them; the pull keeps an edit-date error pushDates just recorded", async () => {
    expect(newEventId()).toMatch(GOOGLE_ID);
    expect(dateEventId("j57abc", "cut 2 due")).toMatch(GOOGLE_ID);
    expect(shootEventId("j57abc")).toMatch(GOOGLE_ID);
    const w = await world();
    const g = fakeGoogle(); // answers 400 to an id outside a-v, 0-9
    await connect(w);
    const id = await w.heston.mutation(api.calendarSync.create, { title: "Scout", date: day(9), endDate: day(9), start: "10:00", end: "11:00", guests: [] });
    await w.heston.mutation(api.projects.setKeyDates, { projectId: w.p, dates: [{ label: "Cut 2 due", date: day(6) }] });
    await settle(w);
    expect((await range(w)).events.find((e: any) => e._id === id)).toMatchObject({ pending: false, pushError: null });
    expect(g.live(PICKED).map((e) => e.summary).sort()).toEqual(["Cut 2 due · Launch", "Scout"]);
    // Google refuses edit dates for a while: the error shows in Settings and a pull doesn't wipe it while it's true.
    intercept((url, i) => (url.includes("/events") && url.includes("pdt") && i?.method === "PATCH" ? new Response(JSON.stringify({ error: { message: "Backend Error" } }), { status: 503 }) : null));
    await w.heston.mutation(api.calendarSync.moveDate, { projectId: w.p, label: "Cut 2 due", from: day(6), to: day(7) });
    await settle(w);
    expect((await w.heston.query(api.calendar.settings, {})).connection.lastError).toMatch(/edit date didn't reach/);
    expect(await pull(w)).toEqual({ state: "ok" });
    expect((await w.heston.query(api.calendar.settings, {})).connection.lastError).toMatch(/edit date didn't reach/);
    expect((await range(w)).dates).toEqual([expect.objectContaining({ date: day(7), saving: true })]);
  });

  test("M1 a shoot can't be dragged while Google is disconnected; the resync after Reconnect emails nobody", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    const { shootId, ev, base } = await withShoot(w, g);
    await breakSignIn(w, g);
    await expect(w.heston.mutation(api.calendarSync.moveShoot, { shootId, date: day(6), call: "09:00", wrap: "16:00", notify: false })).rejects.toThrow(/disconnected\. Reconnect Google/);
    // Edited from its project meanwhile (allowed): Google gets it after Reconnect, with nobody emailed.
    await w.heston.mutation(api.shoots.update, { shootId, ...base, date: day(6) });
    await settle(w);
    const w0 = g.writes().length;
    await connect(w);
    const writes = g.writes().slice(w0).filter((c) => c.url.includes(ev.id));
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.map(sendUpdates)).toEqual(writes.map(() => "none"));
    expect(g.cals.get(PICKED)!.get(ev.id)!.start.dateTime).toBe(`${day(6)}T09:00:00`);
  });

  test("M2 a failed write is tried again by the next pull; a Google change only beats it when it changed the same things", async () => {
    const w = await world();
    const g = fakeGoogle();
    g.inGoogle.add(PICKED, { id: "team01", summary: "Interviews", ...toGoogle({ date: day(2), endDate: day(2), start: "09:00", end: "10:00" }), attendees: [{ email: "sam@rivera.example" }] });
    await connect(w);
    let failing = true;
    intercept((url, i) => (failing && i?.method === "PATCH" && url.includes("/events/team01") ? new Response(JSON.stringify({ error: { message: "Backend Error" } }), { status: 503 }) : null));
    const ev = (await range(w)).events[0];
    await w.heston.mutation(api.calendarSync.move, { eventId: ev._id, date: day(3), endDate: day(3), start: "14:00", end: "15:00", notify: false });
    await settle(w);
    expect((await range(w)).events[0]).toMatchObject({ date: day(3), start: "14:00", pending: true, pushError: expect.stringContaining("503") });
    // Sam accepts in Google (a change to nothing the move touched), and Google renames it: the move stays, still waiting.
    g.inGoogle.change(PICKED, "team01", { summary: "Interviews (Floor Trader)", attendees: [{ email: "sam@rivera.example", responseStatus: "accepted" }] });
    await pull(w);
    expect((await range(w)).events[0]).toMatchObject({ title: "Interviews (Floor Trader)", date: day(3), start: "14:00", pending: true });
    // Google answers again: the next pull's retry writes the move (with Google's new title kept).
    failing = false;
    await pull(w);
    expect((await range(w)).events[0]).toMatchObject({ title: "Interviews (Floor Trader)", date: day(3), start: "14:00", pending: false, pushError: null });
    expect(g.cals.get(PICKED)!.get("team01")!).toMatchObject({ summary: "Interviews (Floor Trader)", start: { dateTime: `${day(3)}T14:00:00` } });
    // A Google change to the same thing (the time) while a portal move is still waiting: Google's is later, so it wins.
    failing = true;
    const now = (await range(w)).events[0];
    await w.heston.mutation(api.calendarSync.move, { eventId: now._id, date: day(4), endDate: day(4), start: "14:00", end: "15:00", notify: false });
    await settle(w);
    g.inGoogle.change(PICKED, "team01", toGoogle({ date: day(5), endDate: day(5), start: "08:00", end: "09:00" }));
    await pull(w);
    expect((await range(w)).events[0]).toMatchObject({ date: day(5), start: "08:00", pending: false, pushError: null });
  });

  test("M2 the calendar page can tell when a change has reached Google (shoots and edit dates)", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    const { shootId } = await withShoot(w, g);
    expect((await range(w)).shoots[0]).toMatchObject({ saving: false, calError: null });
    await w.heston.mutation(api.calendarSync.moveShoot, { shootId, date: day(5), call: "10:00", wrap: "17:00", notify: false });
    await w.heston.mutation(api.projects.setKeyDates, { projectId: w.p, dates: [{ label: "Cut 2 due", date: day(6) }] });
    expect((await range(w)).shoots[0]).toMatchObject({ saving: true });
    expect((await range(w)).dates[0]).toMatchObject({ saving: true });
    await settle(w);
    expect((await range(w)).shoots[0]).toMatchObject({ saving: false, calError: null });
    expect((await range(w)).dates[0]).toMatchObject({ saving: false });
    // A write Google refuses: the error is the shoot's own.
    intercept((url, i) => (i?.method === "PATCH" && url.includes("/events/shoot") ? new Response(JSON.stringify({ error: { message: "Backend Error" } }), { status: 503 }) : null));
    await w.heston.mutation(api.calendarSync.moveShoot, { shootId, date: day(6), call: "10:00", wrap: "17:00", notify: false });
    await settle(w);
    expect((await range(w)).shoots[0]).toMatchObject({ saving: false, calError: expect.stringContaining("503") });
  });

  test("M3 a cancelled copy of the shoot's event id on another calendar leaves the shoot alone", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    const { shootId, ev } = await withShoot(w, g);
    await w.heston.mutation(api.calendarSync.setShown, { calendarId: PERSONAL, on: true });
    await settle(w);
    g.inGoogle.add(PERSONAL, { id: ev.id, summary: "anything", ...toGoogle({ date: day(4), endDate: day(4), start: "09:00", end: "10:00" }), extendedProperties: { private: { portalShoot: shootId } } });
    g.inGoogle.change(PERSONAL, ev.id, toGoogle({ date: day(9), endDate: day(9), start: "09:00", end: "10:00" }));
    g.inGoogle.remove(PERSONAL, ev.id);
    await pull(w);
    expect(await shootRow(w, shootId)).toMatchObject({ calendar: true, date: day(4), calendarEvent: { id: ev.id, calendarId: PICKED } });
    expect(await notes(w)).toEqual([]);
  });

  test("M4 overlapping reads: 'seen' never goes down; only the pull holding the lock lets it go", async () => {
    const w = await world();
    fakeGoogle();
    await connect(w);
    const A = { asBusiness: w.A };
    const item = { id: "keep01", status: "confirmed", summary: "Still in Google", start: { dateTime: `${day(2)}T15:00:00Z` }, end: { dateTime: `${day(2)}T16:00:00Z` }, updated: new Date(Date.now() - 1000).toISOString() };
    const R1 = Date.now(), R2 = R1 + 1;
    await w.t.mutation(internalApi.calendarSync.apply, { ...A, calendarId: PICKED, items: [item], run: R2 }); // the newer read sees it
    await w.t.mutation(internalApi.calendarSync.apply, { ...A, calendarId: PICKED, items: [item], run: R1 }); // the older, slower one after
    await w.t.mutation(internalApi.calendarSync.sweep, { ...A, calendarId: PICKED, run: R2 }); // the newer one finishes
    expect(await w.t.run(async (ctx) => (await ctx.db.query("calendarEvents").collect()).filter((r) => r.googleId === "keep01").map((r) => r.seen))).toEqual([R2]);
    // A pull that ran past 3 minutes can't free the lock of the one that took over.
    const first = await w.t.mutation(internalApi.calendarSync.lock, A);
    expect(first).toBeTypeOf("string");
    await w.t.run(async (ctx) => { const c = (await ctx.db.query("calendars").first())!; await ctx.db.patch(c._id, { pullingSince: Date.now() - 4 * 60_000 }); });
    const second = await w.t.mutation(internalApi.calendarSync.lock, A);
    expect(second).toBeTypeOf("string");
    expect(await w.t.mutation(internalApi.calendarSync.unlock, { ...A, run: first, ok: true })).toBe(false);
    expect(await w.t.mutation(internalApi.calendarSync.lock, A)).toBeNull(); // still the second one's
    expect(await w.t.mutation(internalApi.calendarSync.unlock, { ...A, run: second, ok: true })).toBe(true);
  });

  test("M5 two businesses on one shared calendar: B never adopts or deletes A's edit dates (it sees them read-only)", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w); // Heston (A)
    await w.heston.mutation(api.projects.setKeyDates, { projectId: w.p, dates: [{ label: "Cut 2 due", date: day(6) }] });
    await settle(w);
    const aDates = () => g.live(PICKED).filter((e) => e.extendedProperties?.private?.portalDate === w.p);
    expect(aDates()).toHaveLength(1);
    await connect(w, w.boss, "c2", PICKED); // B picks the same shared calendar
    await w.t.action(internalApi.calendarSync.pullAll, {}); await settle(w);
    await w.t.action(internalApi.calendarSync.pullAll, {}); await settle(w);
    expect(aDates()).toHaveLength(1);
    expect(g.calls.filter((c) => c.method === "DELETE" && c.url.includes("/events/pdt"))).toEqual([]);
    const bRows = await w.t.run(async (ctx) => (await ctx.db.query("calendarEvents").collect()).filter((x) => x.businessId !== w.A));
    expect(bRows.map((r) => [r.kind, r.title, r.readOnly])).toEqual([["google", "Cut 2 due · Launch", true]]);
    const bEvent = (await range(w, w.boss)).events[0];
    await expect(w.boss.mutation(api.calendarSync.remove, { eventId: bEvent._id })).rejects.toThrow(/can't change this event/);
  });

  test("M6 a long full read (with timeMax) carries on from its saved page next time, and says 'partial' until it's done", async () => {
    const w = await world();
    fakeGoogle();
    await connect(w);
    // Google forgets the sync token, and the calendar now takes 50 pages to read in full.
    await w.t.run(async (ctx) => { const x = (await ctx.db.query("calendars").first())!; await ctx.db.patch(x._id, { lastSyncedAt: undefined, list: x.list!.map((y) => ({ ...y, syncToken: undefined })) }); });
    const urls: string[] = [];
    let served = 0;
    intercept((url, i) => {
      if ((i?.method ?? "GET") !== "GET" || !url.includes(`/calendars/${encodeURIComponent(PICKED)}/events?`) || url.includes("syncToken=")) return null;
      urls.push(url);
      served++;
      const n = Number(new URL(url).searchParams.get("pageToken") ?? 0) + 1;
      return new Response(JSON.stringify(n < 50 ? { items: [], nextPageToken: String(n) } : { items: [], nextSyncToken: `${PICKED}:999` }), { status: 200 });
    });
    expect(await pull(w)).toEqual({ state: "partial" }); // 40 pages
    expect(served).toBe(40);
    const q = new URL(urls[0]).searchParams;
    expect(Date.parse(q.get("timeMax")!) - Date.now()).toBeGreaterThan(380 * 86_400_000);
    expect(Date.parse(q.get("timeMax")!) - Date.now()).toBeLessThan(400 * 86_400_000);
    let c = await w.t.run(async (ctx) => (await ctx.db.query("calendars").first())!);
    expect(c.list!.find((x) => x.id === PICKED)).toMatchObject({ page: { token: "40" } });
    expect(c.list!.find((x) => x.id === PICKED)!.syncToken).toBeUndefined();
    expect(c.lastSyncedAt).toBeUndefined();
    expect(await pull(w)).toEqual({ state: "ok" }); // carries on from page 40 with the same query: 10 more pages
    expect(served).toBe(50);
    expect(new URL(urls[40]).searchParams.get("pageToken")).toBe("40");
    expect(new URL(urls[40]).searchParams.get("timeMin")).toBe(q.get("timeMin"));
    c = await w.t.run(async (ctx) => (await ctx.db.query("calendars").first())!);
    expect(c.list!.find((x) => x.id === PICKED)).toMatchObject({ syncToken: `${PICKED}:999` });
    expect(c.list!.find((x) => x.id === PICKED)!.page).toBeUndefined();
    expect(c.lastSyncedAt).toBeTypeOf("number");
  });

  test("M7 Disconnect: marked disconnected before Google is revoked, then cleaned up in batches; pullAll is one job per business", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    await inviteMaya(w);
    const { shootId, ev } = await withShoot(w, g);
    g.inGoogle.change(PICKED, ev.id, toGoogle({ date: day(5), endDate: day(5), start: "10:00", end: "17:00" }));
    await pull(w); // an open moved-in-Google note
    expect(await notes(w)).toHaveLength(1);
    await w.t.run(async (ctx) => { for (let i = 0; i < 450; i++) await ctx.db.insert("calendarEvents", { businessId: w.A, kind: "google", calendarId: PICKED, googleId: `bulk${String(i).padStart(4, "0")}`, title: "x", date: day(1), endDate: day(1), guests: [], gUpdated: 0, syncedAt: 0, createdAt: 0 }); });
    let atRevoke: any = null;
    g.onRevoke = async () => { atRevoke = await w.t.run(async (ctx) => ({ c: await ctx.db.query("calendars").first(), s: await ctx.db.get(shootId) })); };
    await w.heston.action(api.calendar.disconnect, {});
    expect(atRevoke.c.disconnectedAt).toBeTypeOf("number"); // nothing could sync while Google was being revoked
    expect(atRevoke.s.calendarEvent).toBeUndefined();
    expect(atRevoke.s.googleMove).toBeUndefined();
    expect(await w.t.run(async (ctx) => (await ctx.db.query("calendarEvents").collect()).length)).toBeGreaterThan(0); // still to go
    await settle(w);
    expect(await w.t.run(async (ctx) => (await ctx.db.query("calendarEvents").collect()).length)).toBe(0);
    expect((await w.heston.query(api.calendar.settings, {})).connection).toBeNull();
    expect(await notes(w)).toEqual([]);
  });

  test("L1 a dragged shoot's Undo closes once its email 30 could have gone", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    const { shootId } = await withShoot(w, g);
    await w.heston.mutation(api.calendarSync.moveShoot, { shootId, date: day(5), call: "10:00", wrap: "17:00", notify: false });
    await w.t.run(async (ctx) => { const s = (await ctx.db.get(shootId))!; await ctx.db.patch(shootId, { dragUndo: { ...s.dragUndo!, at: Date.now() - 10_500 } }); });
    expect((await range(w)).shoots[0].canUndo).toBe(false);
    await expect(w.heston.mutation(api.calendarSync.undoShoot, { shootId })).rejects.toThrow(/too late/);
  });

  test("L2 the Move dialog's guests include the client's people when Settings › Calendar invites them", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    await inviteMaya(w);
    await w.heston.mutation(api.calendar.save, { calendarId: PICKED, calendarName: "Picked", inviteVendors: true, inviteClient: true });
    await withShoot(w, g);
    expect((await range(w)).shoots[0]).toMatchObject({ guests: ["Jordan Ellis", "maya@harbor.example"], people: 1 });
  });

  test("L3 a Google move within 12 seconds of a drag keeps the drag's email 30, unless it moved the shoot back", async () => {
    for (const back of [false, true]) {
      const w = await world();
      const g = fakeGoogle();
      await connect(w);
      await inviteMaya(w);
      const { shootId, ev } = await withShoot(w, g);
      const sent = g.emails.length;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      await w.heston.mutation(api.calendarSync.moveShoot, { shootId, date: day(5), call: "10:00", wrap: "17:00", notify: false });
      vi.advanceTimersByTime(50);
      await w.t.finishInProgressScheduledFunctions(); // the drag's own write reaches Google; email 30 is still held
      expect(g.cals.get(PICKED)!.get(ev.id)!.start.dateTime).toBe(`${day(5)}T10:00:00`);
      g.inGoogle.change(PICKED, ev.id, back ? toGoogle({ date: day(4), endDate: day(4), start: "09:00", end: "16:00" }) : toGoogle({ date: day(6), endDate: day(6), start: "10:00", end: "17:00" }));
      await w.heston.action(api.calendarSync.syncNow, {});
      await w.t.finishAllScheduledFunctions(vi.runAllTimers);
      vi.useRealTimers();
      const moves = await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).filter((i) => i.kind === "shoot" && i.title.startsWith("Shoot moved")));
      if (back) {
        expect(g.emails.length).toBe(sent);
        expect(moves).toHaveLength(0);
        expect(await shootRow(w, shootId)).toMatchObject({ date: day(4), call: "09:00" });
        expect(await notes(w)).toEqual([]);
      } else {
        expect(g.emails.length).toBe(sent + 1);
        expect(moves).toHaveLength(1);
        expect(await shootRow(w, shootId)).toMatchObject({ date: day(6), call: "10:00" });
      }
    }
  });

  test("L4 a 401 gets one fresh token before the connection counts as disconnected", async () => {
    const w = await world();
    const g = fakeGoogle();
    g.inGoogle.add(PICKED, { id: "teamcall1", summary: "Team call", ...toGoogle({ date: day(1), endDate: day(1), start: "10:00", end: "10:30" }) });
    await connect(w);
    const c = await w.t.run(async (ctx) => (await ctx.db.query("calendars").first())!);
    g.stale.add(c.accessToken!); // Google stopped taking this token before it expired
    expect(await pull(w)).toEqual({ state: "ok" });
    expect((await range(w)).conn.state).toBe("ok");
    // Refused again with the fresh token too: now it's disconnected.
    intercept((url) => (url.includes("googleapis.com/calendar") ? new Response(JSON.stringify({ error: { message: "Invalid Credentials" } }), { status: 401 }) : null));
    expect(await pull(w)).toEqual({ state: "disconnected" });
  });

  test("L5 connecting a different Google account clears the shoots' links and open notes; their events are made again with nobody emailed", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    const { shootId, ev } = await withShoot(w, g);
    g.inGoogle.change(PICKED, ev.id, toGoogle({ date: day(5), endDate: day(5), start: "10:00", end: "17:00" }));
    await pull(w);
    expect(await notes(w)).toHaveLength(1);
    const w0 = g.writes().length;
    await connect(w, w.heston, "c3", PICKED); // heston.studio@gmail.com
    expect((await w.heston.query(api.calendar.settings, {})).connection.email).toBe("heston.studio@gmail.com");
    expect(await notes(w)).toEqual([]);
    const s = (await shootRow(w, shootId))!;
    expect(s.calendarEvent).toMatchObject({ id: ev.id, calendarId: PICKED }); // made again by the new account
    const again = g.writes().slice(w0).filter((c) => c.url.includes(ev.id));
    expect(again.length).toBeGreaterThan(0);
    expect(again.every((c) => c.acct === "c3" && sendUpdates(c) === "none")).toBe(true);
  });

  test("L6 an edit that changes the guests emails them only when the owner says so", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    const id = await w.heston.mutation(api.calendarSync.create, { title: "Scout", date: day(9), endDate: day(9), start: "10:00", end: "11:00", guests: ["sam@rivera.example"] });
    await settle(w);
    await w.heston.mutation(api.calendarSync.update, { eventId: id, title: "Scout", date: day(9), endDate: day(9), start: "10:00", end: "11:00", location: "", guests: ["sam@rivera.example", "jo@harbor.example"], notify: false });
    await settle(w);
    expect(sendUpdates(g.writes().at(-1)!)).toBe("none");
    expect(g.writes().at(-1)!.body.attendees).toEqual([{ email: "sam@rivera.example" }, { email: "jo@harbor.example" }]);
    await w.heston.mutation(api.calendarSync.update, { eventId: id, title: "Scout", date: day(9), endDate: day(9), start: "10:00", end: "11:00", location: "", guests: ["sam@rivera.example"], notify: true });
    await settle(w);
    expect(sendUpdates(g.writes().at(-1)!)).toBe("all");
  });
});
