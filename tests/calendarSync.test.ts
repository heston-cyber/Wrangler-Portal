// T5b.4 (Phase 5b step 5, D143): Production › Calendar, two-way with Google Calendar. Google is faked here (fetch is
// stubbed): sign-in, the calendar list, and events with Google's incremental sync (sync tokens, 410 when one expires,
// deleted events coming back as "cancelled"). Nothing real is called.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { todayCentral } from "../convex/lib/bookings";
import { fromGoogle, toGoogle } from "../convex/lib/gcal";
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
const PICKED = "wrangler@group.calendar.google.com", PERSONAL = "heston@gmail.com";

type Ev = Record<string, any> & { id: string; updated: string; status: string };
/** A stand-in Google Calendar: events per calendar with a change log, so sync tokens work like Google's. */
function fakeGoogle() {
  const g = {
    calls: [] as Array<{ method: string; url: string; body: any }>,
    cals: new Map<string, Map<string, Ev>>([[PICKED, new Map()], [PERSONAL, new Map()]]),
    log: [] as Array<{ seq: number; cal: string; id: string }>, seq: 0, last: 0,
    expired: new Set<string>(), // sync tokens Google forgot (answers 410)
    refreshFails: false, emails: [] as string[],
    stamp() { g.last = Math.max(Date.now(), g.last + 1); return new Date(g.last).toISOString(); },
    touch(cal: string, e: Ev) { g.cals.get(cal)!.set(e.id, e); g.log.push({ seq: ++g.seq, cal, id: e.id }); },
    /** Changes made by someone in Google itself (a minute "later" than anything the portal did in the test). */
    inGoogle: {
      add(cal: string, e: Partial<Ev> & { id: string }) { g.last = Math.max(Date.now() + 60_000, g.last + 1); g.touch(cal, { status: "confirmed", ...e, updated: new Date(g.last).toISOString() } as Ev); },
      change(cal: string, id: string, patch: Partial<Ev>) { g.last = Math.max(Date.now() + 60_000, g.last + 1); g.touch(cal, { ...g.cals.get(cal)!.get(id)!, ...patch, updated: new Date(g.last).toISOString() }); },
      remove(cal: string, id: string) { g.last = Math.max(Date.now() + 60_000, g.last + 1); g.touch(cal, { ...g.cals.get(cal)!.get(id)!, status: "cancelled", updated: new Date(g.last).toISOString() }); },
    },
    live: (cal: string) => [...g.cals.get(cal)!.values()].filter((e) => e.status !== "cancelled"),
    writes: () => g.calls.filter((c) => c.method !== "GET" && c.url.includes("/events")),
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const ok = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status });
    if (url === "https://api.resend.com/emails") { g.emails.push(JSON.parse(String(init?.body)).subject); return ok({ id: "em" }); }
    const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body ? String(init.body) : null;
    g.calls.push({ method, url, body });
    if (url === "https://oauth2.googleapis.com/token") {
      if (g.refreshFails && String(body).includes("refresh_token")) return ok({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
      return ok({ access_token: "gat", expires_in: 3600, refresh_token: "grt", id_token: idToken("heston@wranglerproductions.com") });
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return ok({});
    if (url.includes("/users/me/calendarList")) return ok({ items: [{ id: PERSONAL, summary: "Personal", primary: true, accessRole: "owner" }, { id: PICKED, summary: "Wrangler Productions", accessRole: "owner" }, { id: "en.usa#holiday@group.v.calendar.google.com", summary: "Holidays", accessRole: "reader" }] });
    const m = /\/calendars\/([^/?]+)\/events(?:\/([^?]+))?(?:\?(.*))?$/.exec(url);
    if (m) {
      const cal = decodeURIComponent(m[1]);
      const events = g.cals.get(cal) ?? new Map<string, Ev>();
      if (!g.cals.has(cal)) g.cals.set(cal, events);
      const id = m[2] ? decodeURIComponent(m[2]) : null;
      const q = new URLSearchParams(m[3] ?? "");
      if (method === "GET" && !id) {
        const tok = q.get("syncToken");
        if (tok && g.expired.has(tok)) return ok({ error: { message: "Sync token is no longer valid" } }, 410);
        const since = tok ? Number(tok.split(":")[1]) : null;
        const items = since === null ? [...events.values()].filter((e) => e.status !== "cancelled")
          : [...new Set(g.log.filter((l) => l.cal === cal && l.seq > since).map((l) => l.id))].map((i) => events.get(i)!);
        return ok({ items, nextSyncToken: `${cal}:${g.seq}` });
      }
      if (method === "POST") {
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
const settle = async (w: W) => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] }); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const pull = async (w: W) => { const r = await w.heston.action(api.calendarSync.syncNow, {}); await settle(w); return r; };
const range = (w: W, as = w.heston) => as.query(api.calendarSync.range, { from: day(-3), to: day(30) });

async function connect(w: W) {
  process.env.GOOGLE_CLIENT_ID = "gid"; process.env.GOOGLE_CLIENT_SECRET = "gsecret";
  const url = new URL(await w.heston.action(api.calendar.authUrl, {}));
  const r = await w.t.fetch(`/calendar/callback?code=c1&state=${url.searchParams.get("state")}`, { method: "GET" });
  const back = new URL(r.headers.get("location")!);
  await w.heston.action(api.calendar.finish, { code: back.searchParams.get("gcode")!, state: back.searchParams.get("gstate")! });
  await w.heston.mutation(api.calendar.save, { calendarId: PICKED, calendarName: "Wrangler Productions", inviteVendors: true, inviteClient: false });
  await settle(w);
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
    expect(post.body.id).toMatch(/^wp[0-9a-f]+$/);
    expect(post.body.extendedProperties.private).toMatchObject({ portalEvent: "1", portalLinkProject: w.p });
    const ev = (await range(w)).events.find((e: any) => e._id === id);
    expect(ev).toMatchObject({ title: "Location scout · Floor Trader", pending: false, htmlLink: expect.stringContaining("calendar.google.com") });
    // A retried create makes one event, not two (the portal picks the id).
    await w.t.run(async (ctx) => { await ctx.db.patch(id as Id<"calendarEvents">, { pending: "create", pendingAt: Date.now() }); });
    await w.t.action(anyApi.calendarSync.push, { eventId: id });
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

  test("5 a shoot moved in Google moves the portal's shoot, emails nobody, and leaves one Dashboard note", async () => {
    const w = await world();
    const g = fakeGoogle();
    await connect(w);
    await inviteMaya(w);
    const { shootId, ev } = await withShoot(w, g);
    const sent = g.emails.length;
    // Someone drags it to the next day, 10–5, in Google.
    g.inGoogle.change(PICKED, ev.id, toGoogle({ date: day(5), endDate: day(5), start: "10:00", end: "17:00" }));
    const writes = g.writes().length;
    await pull(w);
    const s = (await shootRow(w, shootId))!;
    expect(s).toMatchObject({ date: day(5), call: "10:00", wrap: "17:00", location: "Floor Trader, Oklahoma City", moved: { date: day(4), call: "09:00" } });
    expect(s.confirmed).toBeUndefined();
    expect(s.history.at(-1)!.text).toMatch(/^Moved in Google Calendar from/);
    expect(g.emails.length).toBe(sent); // nobody emailed
    expect(g.writes().length).toBe(writes); // and nothing written back to Google
    const inbox = await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).filter((i) => i.kind === "shoot"));
    const inboxBefore = inbox.length;
    // One Dashboard note, even after more pulls.
    await pull(w); await pull(w);
    const needs = (await w.heston.query(api.home.needs, {})).filter((n: any) => n.kind === "shootMoved");
    expect(needs).toEqual([expect.objectContaining({ shootId, date: day(5), call: "10:00", wasDate: day(4), wasCall: "09:00", people: 1, crew: 1 })]);
    expect(g.writes().length).toBe(writes);
    // On the calendar the shoot is at its new time (the portal layer), not twice.
    const r = await range(w);
    expect(r.shoots.map((x: any) => [x._id, x.date, x.call, x.movedInGoogle])).toEqual([[shootId, day(5), "10:00", true]]);
    expect(r.events).toHaveLength(0);
    // "Ask the client to confirm" sends the portal's usual move message (Inbox + email 30), once; the note goes.
    await w.heston.mutation(api.calendarSync.askConfirmAgain, { shootId });
    await settle(w);
    expect(g.emails.length).toBe(sent + 1);
    expect(g.emails.at(-1)).toMatch(/moved|confirm/i);
    expect((await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).filter((i) => i.kind === "shoot"))).length).toBe(inboxBefore + 1);
    expect((await w.heston.query(api.home.needs, {})).filter((n: any) => n.kind === "shootMoved")).toEqual([]);
    // A later portal edit wins over an older Google change it hasn't seen yet (last write wins), and Google gets it.
    await w.heston.mutation(api.shoots.update, { shootId, date: day(6), call: "08:00", wrap: "12:00", location: "Floor Trader, Oklahoma City", prepare: [], withOwner: true, bookingIds: [], calendar: true });
    await settle(w);
    expect(g.cals.get(PICKED)!.get(ev.id)!.start.dateTime).toBe(`${day(6)}T08:00:00`);
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
    expect(g.writes().filter((c) => c.url.includes("/events/wpd") || c.body?.id?.startsWith?.("wpd")).every((c) => c.url.includes("sendUpdates=none"))).toBe(true);
    // On the calendar page they come from the project (the "Edit dates" layer), not from Google.
    expect((await range(w)).dates).toEqual([{ projectId: w.p, project: "Launch", label: "Cut 2 due", date: day(6) }]);
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
    // The cron pulls each business as itself.
    const lists = g.calls.length;
    await w.t.action(anyApi.calendarSync.pullAll, {});
    expect(g.calls.length).toBeGreaterThan(lists);
  });

  test("9 a disconnected connection shows the disconnected state, hides Google's events, keeps shoots, and throws nothing", async () => {
    const w = await world();
    const g = fakeGoogle();
    g.inGoogle.add(PICKED, { id: "g1", summary: "Team call", ...toGoogle({ date: day(1), endDate: day(1), start: "10:00", end: "10:30" }) });
    await connect(w);
    await withShoot(w, g);
    // Google stops letting the portal in.
    g.refreshFails = true;
    await w.t.run(async (ctx) => { const c = (await ctx.db.query("calendars").first())!; await ctx.db.patch(c._id, { accessExpiresAt: 0 }); });
    expect(await w.heston.action(api.calendarSync.syncNow, {})).toEqual({ state: "disconnected" });
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
    g.refreshFails = false;
    await connect(w);
    const back = await range(w);
    expect(back.conn.state).toBe("ok");
    expect(back.events.map((e: any) => e.title)).toEqual(["Team call"]);
  });

  test("times: Google's forms to the portal's and back", () => {
    expect(fromGoogle({ dateTime: "2026-11-05T15:00:00Z" }, { dateTime: "2026-11-05T22:00:00Z" })).toEqual({ date: "2026-11-05", endDate: "2026-11-05", start: "09:00", end: "16:00" });
    expect(fromGoogle({ date: "2026-11-26" }, { date: "2026-11-28" })).toEqual({ date: "2026-11-26", endDate: "2026-11-27" });
    expect(fromGoogle({ dateTime: "2026-11-05T22:00:00-06:00" }, { dateTime: "2026-11-06T00:00:00-06:00" })).toEqual({ date: "2026-11-05", endDate: "2026-11-05", start: "22:00", end: "23:59" });
    expect(toGoogle({ date: "2026-11-26", endDate: "2026-11-27" })).toEqual({ start: { date: "2026-11-26" }, end: { date: "2026-11-28" } });
  });
});
