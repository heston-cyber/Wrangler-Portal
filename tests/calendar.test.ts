// Phase 4 · Settings › Calendar and shoots on it (D32). Google is faked: sign-in, the calendar list, events.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { todayCentral } from "../convex/lib/bookings";

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

function fake() {
  const s = { calls: [] as Array<{ method: string; url: string; body: any }>, events: new Map<string, any>(), n: 0 };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const ok = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status });
    if (url === "https://api.resend.com/emails") return ok({ id: "em" });
    const body = typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body ? String(init.body) : null;
    s.calls.push({ method, url, body });
    if (url === "https://oauth2.googleapis.com/token") return ok({ access_token: "gat", expires_in: 3600, refresh_token: "grt", id_token: idToken("heston@wranglerproductions.com") });
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return ok({});
    if (url.includes("/users/me/calendarList")) return ok({ items: [{ id: "primary@x", summary: "Heston", primary: true }, { id: "heston-cal@group", summary: "Heston Calendar" }] });
    const m = /\/calendars\/([^/]+)\/events(?:\/([^?]+))?/.exec(url);
    if (m) {
      const id = m[2] ? decodeURIComponent(m[2]) : null;
      if (method === "POST") { const e = { ...body, id: body.id ?? `ev${++s.n}` }; if (s.events.has(e.id)) return ok({ error: { message: "duplicate" } }, 409); s.events.set(e.id, e); return ok(e); }
      if (method === "PATCH") { if (!s.events.has(id!)) return ok({}, 404); s.events.set(id!, { ...s.events.get(id!), ...body }); return ok(s.events.get(id!)); }
      if (method === "DELETE") { s.events.delete(id!); return new Response(null, { status: 204 }); }
    }
    return new Response("{}", { status: 500 });
  }));
  return s;
}
const settle = async (w: W) => { vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };

async function connect(w: W) {
  process.env.GOOGLE_CLIENT_ID = "gid"; process.env.GOOGLE_CLIENT_SECRET = "gsecret";
  const url = new URL(await w.heston.action(api.calendar.authUrl, {}));
  expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(url.searchParams.get("redirect_uri")).toBe("https://stoic-marlin-221.convex.site/calendar/callback");
  expect(url.searchParams.get("access_type")).toBe("offline");
  const r = await w.t.fetch(`/calendar/callback?code=c1&state=${url.searchParams.get("state")}`, { method: "GET" });
  expect(r.status).toBe(302);
  const back = new URL(r.headers.get("location")!);
  expect(back.pathname).toBe("/settings/calendar");
  // The page finishes it as the signed-in owner who started it.
  expect(await w.heston.action(api.calendar.finish, { code: back.searchParams.get("gcode")!, state: back.searchParams.get("gstate")! })).toEqual({ email: "heston@wranglerproductions.com" });
}

describe("calendar", () => {
  test("connect → pick a calendar → shoots go on it, move with it, come off it; invites as set", async () => {
    const w = await world();
    const s = fake();
    expect(await w.heston.query(api.calendar.settings, {})).toMatchObject({ keys: false, connection: null });
    await expect(w.heston.action(api.calendar.authUrl, {})).rejects.toThrow(/keys go in Convex/);
    await connect(w);
    expect((await w.heston.query(api.calendar.settings, {})).connection).toMatchObject({ email: "heston@wranglerproductions.com", calendarId: null, inviteVendors: true, inviteClient: false });
    expect(await w.heston.action(api.calendar.calendars, {})).toEqual([{ id: "primary@x", name: "Heston", primary: true }, { id: "heston-cal@group", name: "Heston Calendar", primary: false }]);
    await w.heston.mutation(api.calendar.save, { calendarId: "heston-cal@group", calendarName: "Heston Calendar", inviteVendors: true, inviteClient: false });
    expect((await w.heston.query(api.shoots.forProject, { projectId: w.p })).calendar).toBe("Heston Calendar");

    const vendor = await w.heston.mutation(api.vendors.add, { name: "Jordan Ellis", email: "jordan@ellisfilms.com", roles: ["Shooter"], rates: [], invite: false }) as Id<"vendors">;
    const booking = await w.heston.mutation(api.bookings.create, { vendorId: vendor, projectId: w.p, role: "Shooter", start: day(4), end: day(4), cents: 100_000, unit: "day" }) as Id<"vendorBookings">;
    const base = { date: day(4), call: "07:00", wrap: "17:00", location: "Harbor Coffee, 412 Main St.", prepare: ["Lights on"], withOwner: true, bookingIds: [booking], calendar: true };
    const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, ...base }) as { shootId: Id<"shoots"> };
    await settle(w);
    const ev = [...s.events.values()][0];
    expect(ev.id).toMatch(/^shoot[0-9a-f]+$/);
    expect(ev).toMatchObject({ guestsCanSeeOtherGuests: false, guestsCanInviteOthers: false });
    expect(ev).toMatchObject({ summary: "Shoot · 26127 Launch", location: "Harbor Coffee, 412 Main St.", start: { dateTime: `${day(4)}T07:00:00`, timeZone: "America/Chicago" }, end: { dateTime: `${day(4)}T17:00:00` }, attendees: [{ email: "jordan@ellisfilms.com" }] });
    expect(s.calls.find((c) => c.method === "POST" && c.url.includes("/events"))!.url).toContain("/calendars/heston-cal%40group/events?sendUpdates=all");
    // Two syncs at once make one event, not two.
    await Promise.all([w.t.action(anyApi.calendar.syncShoot, { shootId, asBusiness: w.A }), w.t.action(anyApi.calendar.syncShoot, { shootId, asBusiness: w.A })]);
    expect(s.events.size).toBe(1);
    // Moved: the same event moves.
    await w.heston.mutation(api.shoots.update, { shootId, ...base, date: day(5) });
    await settle(w);
    expect(s.events.size).toBe(1);
    expect([...s.events.values()][0].start.dateTime).toBe(`${day(5)}T07:00:00`);
    // Unticked: it comes off. Ticked again: back on. Cancelled: off.
    await w.heston.mutation(api.shoots.update, { shootId, ...base, date: day(5), calendar: false });
    await settle(w);
    expect(s.events.size).toBe(0);
    await w.heston.mutation(api.shoots.update, { shootId, ...base, date: day(5) });
    await settle(w);
    expect(s.events.size).toBe(1);
    await w.heston.mutation(api.shoots.cancel, { shootId });
    await settle(w);
    expect(s.events.size).toBe(0);
    // Disconnect: the connection goes; shoots save without events.
    await w.heston.action(api.calendar.disconnect, {});
    expect((await w.heston.query(api.calendar.settings, {})).connection).toBeNull();
    await w.heston.mutation(api.shoots.schedule, { projectId: w.p, ...base });
    await settle(w);
    expect(s.events.size).toBe(0);
  });

  test("only the owner, and only their own business's connection", async () => {
    const w = await world();
    fake();
    await connect(w);
    expect((await w.boss.query(api.calendar.settings, {})).connection).toBeNull();
    await expect(w.boss.mutation(api.calendar.save, { calendarId: "x", calendarName: "x", inviteVendors: false, inviteClient: false })).rejects.toThrow(/Connect Google Calendar first/);
    await expect(w.maya.query(api.calendar.settings, {})).rejects.toThrow(/Not allowed/);
    await expect(w.maya.action(api.calendar.calendars, {})).rejects.toThrow();
    // A consent link started by another business's owner connects nothing for them when Heston approves it.
    const url = new URL(await w.boss.action(api.calendar.authUrl, {}));
    await expect(w.heston.action(api.calendar.finish, { code: "c2", state: url.searchParams.get("state")! })).rejects.toThrow(/someone else/);
    await expect(w.boss.action(api.calendar.finish, { code: "c2", state: url.searchParams.get("state")! })).rejects.toThrow(/expired/); // used up
    await expect(w.heston.action(api.calendar.finish, { code: "c", state: "forged" })).rejects.toThrow(/expired/);
  });
});
