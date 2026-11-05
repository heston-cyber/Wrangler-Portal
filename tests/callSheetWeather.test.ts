// D148 (Nov 4) · weather on call sheets. The Weather block fills from the US National Weather Service within a week of the
// shoot (not earlier) and refreshes the day before; a typed-over line is kept and "Use the forecast again" restores the
// forecast; an address Census can't place, or NWS failing, gives "no forecast" without breaking the sheet; every NWS
// request carries our User-Agent and nothing but coordinates; a forecast that changes after the sheet was sent nudges the
// owner (Dashboard "Needs you"), never anyone else, while readers keep the line that was sent; another business's owner
// can't read or change it; the old "Add the weather the day before" tick becomes a Weather block, once. Review fixes
// (Nov 4): W10 L9 no redirects followed; W11 L10 only the Location block's address is ever looked up; W12 L11 the
// Refresh guard counts each try.
// Census and NWS are stubbed: nothing real is reached.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { internal } from "../convex/_generated/api";
import { world } from "./payHarness";
import { todayCentral } from "../convex/lib/bookings";
import { nodesOf, pageOf, type Page, type PNode } from "../convex/lib/wsBuilder";
import { fillSheet, emptyLocation, migrateWeather, weatherAddress, weatherLine, weatherOf, whatChanged } from "../convex/lib/callSheet";
import { NWS_USER_AGENT, forecast, forecastLine, geocode } from "../convex/lib/weather";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
type Req = { url: string; headers: Record<string, string>; body: unknown; redirect: RequestRedirect | undefined };
const START = Date.parse("2026-11-10T18:00:00Z"); // noon in Chicago
const DAY = 86_400_000;
const ymd = (base: string, n: number) => { const d = new Date(`${base}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ADDRESS = "1 Film Row, Austin, TX 78701";
const POINT = "/points/30.2672,-97.7431";
const FORECAST_URL = "https://api.weather.gov/gridpoints/EWX/156,91/forecast";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

/** The NWS forecast as the stub serves it: day and night periods for the next eight days (from the faked clock). */
const wx = { temp: 62, short: "Sunny", nwsDown: false };
function periods() {
  const today = todayCentral();
  return Array.from({ length: 8 }, (_, i) => ymd(today, i)).flatMap((d) => [
    { startTime: `${d}T06:00:00-06:00`, isDaytime: true, temperature: wx.temp, windSpeed: "5 to 10 mph", shortForecast: wx.short, probabilityOfPrecipitation: { value: 10 } },
    { startTime: `${d}T18:00:00-06:00`, isDaytime: false, temperature: 48, windSpeed: "5 mph", shortForecast: "Clear", probabilityOfPrecipitation: { value: null } },
  ]);
}
function stub(reqs: Req[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    reqs.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body ?? null, redirect: init?.redirect });
    if (url.startsWith("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?")) {
      const a = new URL(url).searchParams.get("address") ?? "";
      return json({ result: { addressMatches: /Film Row/.test(a) ? [{ coordinates: { x: -97.743061, y: 30.267153 } }] : [] } });
    }
    if (url.startsWith("https://api.weather.gov/points/")) return wx.nwsDown ? new Response("down", { status: 503 }) : json({ properties: { forecast: FORECAST_URL } });
    if (url === FORECAST_URL) return wx.nwsDown ? new Response("down", { status: 503 }) : json({ properties: { periods: periods() } });
    if (url === "https://api.resend.com/emails") return json({ id: "em" });
    return new Response("{}", { status: 500 });
  }));
}
const settle = (w: W) => w.t.finishAllScheduledFunctions(vi.runAllTimers);
const at = (days: number) => vi.setSystemTime(START + days * DAY);
const outside = (reqs: Req[]) => reqs.filter((r) => !r.url.startsWith("https://api.resend.com/"));
const mails = (reqs: Req[]) => reqs.filter((r) => r.url.startsWith("https://api.resend.com/"));

/** A shoot `inDays` away with a call sheet made from the questions, weather on. */
async function sheet(w: W, inDays: number, weather = true) {
  // Maya can open the project (so the sheet has someone to go to).
  await w.t.run(async (ctx) => {
    if (await ctx.db.query("shares").first()) return;
    const owner = (await ctx.db.query("users").first())!._id;
    const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: owner });
    await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: "maya@harbor.example", addedAt: 0 });
  });
  const date = ymd(todayCentral(), inDays);
  const { shootId } = await w.heston.mutation(api.shoots.schedule, { projectId: w.p, date, call: "07:30", wrap: "13:00", location: "Studio B", parking: "", prepare: [], withOwner: true, bookingIds: [], calendar: false }) as { shootId: Id<"shoots"> };
  const csId = await w.heston.mutation(api.callSheets.create, { shootId, how: "questions" }) as Id<"callSheets">;
  await w.heston.mutation(api.callSheets.saveAnswers, { callSheetId: csId, step: 4, answers: {
    templateId: null, crewCall: "07:30", talentCall: "09:00", wrap: "13:00", locationName: "Studio B", address: ADDRESS, parking: "", weather, schedule: [{ id: "r1", time: "07:30", what: "Load-in", who: "Crew" }], notes: "",
  } });
  const buildId = await w.heston.mutation(api.callSheets.make, { callSheetId: csId }) as Id<"wsBuilds">;
  return { csId, buildId, shootId, date };
}
async function edit(w: W, buildId: Id<"wsBuilds">, fn: (page: Page) => void) {
  const b = await w.heston.query(api.builder.getBuild, { buildId });
  const page = JSON.parse(JSON.stringify(pageOf(b.blocks))) as Page;
  fn(page);
  await w.heston.mutation(api.builder.saveBuild, { buildId, title: b.title, blocks: page, fields: b.fields, signers: [], style: b.style });
}
const setWeather = (attrs: { typed: boolean; line: string }) => (p: Page) => { nodesOf(p, "weather")[0].attrs = attrs; };
const cron = async (w: W) => { await w.t.action(internal.callSheets.weatherAll, {}); await settle(w); };
const view = async (w: W, csId: Id<"callSheets">) => (await w.heston.query(api.callSheets.get, { callSheetId: csId })).weather;
const needs = async (w: W, who: "heston" | "boss" = "heston") => ((await w[who].query(api.home.needs, {})) as Array<{ kind: string; callSheetId?: string; title?: string; line?: string }>).filter((n) => n.kind === "weatherChanged");

describe("weather on call sheets (D148)", () => {
  test("W1 the forecast line from NWS periods: short forecast · high/low · rain · wind", () => {
    const p = [
      { startTime: "2026-11-13T06:00:00-06:00", isDaytime: true, temperature: 62, windSpeed: "8 mph", shortForecast: "Sunny", probabilityOfPrecipitation: { value: 10 } },
      { startTime: "2026-11-13T18:00:00-06:00", isDaytime: false, temperature: 48, windSpeed: "5 mph", shortForecast: "Clear", probabilityOfPrecipitation: { value: null } },
    ];
    expect(forecastLine(p, "2026-11-13")).toBe("Sunny · 62°/48° · 10% rain · wind 8 mph");
    expect(forecastLine(p, "2026-11-14")).toBeNull(); // not in the forecast yet
  });

  test("W2 fills within 7 days and not earlier; refreshes the day before, once; nobody is emailed", async () => {
    vi.useFakeTimers({ now: START });
    const w = await world();
    const reqs: Req[] = [];
    stub(reqs);
    wx.temp = 62; wx.short = "Sunny"; wx.nwsDown = false;
    const { csId, buildId, date } = await sheet(w, 10);
    // The questions' toggle: one Weather block, right after the location block; the old tick stays off.
    const page = pageOf((await w.heston.query(api.builder.getBuild, { buildId })).blocks);
    const types = (page.content ?? []).map((n) => n.type);
    expect(types.filter((t) => t === "weather")).toHaveLength(1);
    expect(types.indexOf("weather")).toBe(types.indexOf("location") + 1);
    expect(nodesOf(page, "location")[0].attrs!.weather).toBe(false);
    await settle(w);
    reqs.length = 0;

    // 10 days away: too early, nothing is looked up.
    await cron(w);
    expect(outside(reqs)).toEqual([]);
    expect(await view(w, csId)).toMatchObject({ state: "early", line: "", date, fillsOn: ymd(date, -7), due: false });
    expect(await w.heston.mutation(api.callSheets.refreshWeather, { callSheetId: csId })).toEqual({ state: "early" });
    await settle(w);
    expect(outside(reqs)).toEqual([]);

    // 8 days away: still nothing.
    at(2);
    await cron(w);
    expect(outside(reqs)).toEqual([]);

    // 7 days away: it fills.
    at(3);
    await cron(w);
    expect(outside(reqs).map((r) => r.url.split("?")[0])).toEqual(["https://geocoding.geo.census.gov/geocoder/locations/onelineaddress", `https://api.weather.gov${POINT}`, FORECAST_URL]);
    expect(await view(w, csId)).toMatchObject({ state: "forecast", line: "Sunny · 62°/48° · 10% rain · wind 5 to 10 mph", place: "Studio B" });
    // Filled: the next days don't look it up again (and the geocode is kept: Census isn't asked twice).
    reqs.length = 0;
    at(4); await cron(w);
    at(5); await cron(w);
    expect(outside(reqs)).toEqual([]);

    // The day before: refreshed, once, with the kept point (NWS only).
    at(9);
    wx.temp = 55; wx.short = "Rain";
    await cron(w);
    expect(outside(reqs).map((r) => r.url)).toEqual([`https://api.weather.gov${POINT}`, FORECAST_URL]);
    expect(await view(w, csId)).toMatchObject({ state: "forecast", line: "Rain · 55°/48° · 10% rain · wind 5 to 10 mph" });
    reqs.length = 0;
    await cron(w);
    expect(outside(reqs)).toEqual([]);
    expect(mails(reqs)).toEqual([]); // never an email
  });

  test("W3 a typed-over line is kept by the refresh; Use the forecast again restores the forecast", async () => {
    vi.useFakeTimers({ now: START });
    const w = await world();
    const reqs: Req[] = [];
    stub(reqs);
    wx.temp = 62; wx.short = "Sunny"; wx.nwsDown = false;
    const { csId, buildId } = await sheet(w, 3);
    await cron(w);
    expect(await view(w, csId)).toMatchObject({ state: "forecast", line: expect.stringMatching(/^Sunny · 62°/) });

    await edit(w, buildId, setWeather({ typed: true, line: "Rain after 3 PM, bring covers" }));
    // The editor gets the forecast's own state (it puts the typed line over it); what would be sent is the typed line.
    const g = await w.heston.query(api.callSheets.get, { callSheetId: csId });
    expect(g.weather.state).toBe("forecast");
    expect(g.weather.forecast).toMatch(/^Sunny/);

    // The day before: the forecast refreshes, the typed line doesn't change.
    at(2);
    wx.temp = 40; wx.short = "Snow";
    await cron(w);
    const r = await w.heston.mutation(api.callSheets.send, { callSheetId: csId, crew: true, client: true });
    expect(r.sent).toBeGreaterThan(0);
    const cs = await w.t.run(async (ctx) => ctx.db.get(csId));
    expect(weatherOf(nodesOf(pageOf(cs!.sent!.page), "weather")[0])).toEqual({ typed: true, line: "Rain after 3 PM, bring covers" });
    expect(cs!.weather).toMatchObject({ state: "forecast", line: expect.stringMatching(/^Snow · 40°/), dayBefore: true });

    // Use the forecast again: the line is the forecast again (and it's a change to send).
    await edit(w, buildId, setWeather({ typed: false, line: "" }));
    const after = await w.heston.query(api.callSheets.get, { callSheetId: csId });
    expect(after.weather).toMatchObject({ state: "forecast", line: expect.stringMatching(/^Snow · 40°/) });
    expect(after.changed).toBe(true);
    expect(after.changes).toEqual([expect.stringMatching(/^Weather: Snow · 40°/)]);
  });

  test("W4 no forecast: an address Census can't place (not in the US) or NWS down; the sheet still works", async () => {
    vi.useFakeTimers({ now: START });
    const w = await world();
    const reqs: Req[] = [];
    stub(reqs);
    wx.temp = 62; wx.short = "Sunny"; wx.nwsDown = false;
    const { csId, buildId } = await sheet(w, 2);
    await edit(w, buildId, (p) => { nodesOf(p, "location")[0].attrs!.address = "10 Downing Street, London SW1A 2AA"; });
    await settle(w);
    reqs.length = 0;
    await cron(w);
    expect(outside(reqs).map((r) => r.url.split("?")[0])).toEqual(["https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"]); // NWS never asked
    expect(await view(w, csId)).toMatchObject({ state: "none", line: "" });
    // Kept: the same address isn't sent to Census again.
    reqs.length = 0;
    await cron(w);
    expect(outside(reqs)).toEqual([]);
    expect((await w.heston.query(api.callSheets.get, { callSheetId: csId })).status).toBe("draft");
    expect((await w.heston.mutation(api.callSheets.send, { callSheetId: csId, crew: true, client: true })).sent).toBeGreaterThan(0);
    const sent = await w.t.run(async (ctx) => ctx.db.get(csId));
    expect(weatherLine(pageOf(sent!.sent!.page))).toBe(""); // an empty line (readers show nothing)

    // NWS down: no forecast, and nothing breaks; once it's back, the next run fills it.
    const two = await sheet(w, 3);
    wx.nwsDown = true;
    await cron(w);
    expect(await view(w, two.csId)).toMatchObject({ state: "none", line: "" });
    expect(await w.heston.query(api.callSheets.get, { callSheetId: two.csId })).toMatchObject({ status: "draft", buildId: two.buildId });
    wx.nwsDown = false;
    at(1);
    await cron(w);
    expect(await view(w, two.csId)).toMatchObject({ state: "forecast", line: expect.stringMatching(/^Sunny/) });
    // A forecast already here stays when NWS fails on the day-before refresh.
    at(2);
    wx.nwsDown = true;
    await cron(w);
    expect(await view(w, two.csId)).toMatchObject({ state: "forecast", line: expect.stringMatching(/^Sunny/) });
  });

  test("W5 every NWS request carries the User-Agent and only coordinates; only the address goes to Census", async () => {
    vi.useFakeTimers({ now: START });
    const w = await world();
    const reqs: Req[] = [];
    stub(reqs);
    wx.nwsDown = false;
    const { csId } = await sheet(w, 4);
    await settle(w);
    reqs.length = 0;
    expect(await w.heston.mutation(api.callSheets.refreshWeather, { callSheetId: csId })).toEqual({ state: "looking" });
    await settle(w);
    const nws = reqs.filter((r) => r.url.startsWith("https://api.weather.gov/"));
    expect(nws.length).toBe(2);
    for (const r of nws) {
      expect(r.headers["user-agent"]).toBe(NWS_USER_AGENT);
      expect(r.headers["user-agent"]).toBe("WranglerPortal (support@wranglerproductions.com)");
      expect(r.body).toBeNull();
      expect(r.url).not.toMatch(/Film|Austin|Studio|Harbor|Launch|78701/i);
      expect(new URL(r.url).search).toBe("");
    }
    expect(nws[0].url).toBe(`https://api.weather.gov${POINT}`);
    const census = reqs.filter((r) => r.url.startsWith("https://geocoding.geo.census.gov/"));
    expect(census).toHaveLength(1);
    expect([...new URL(census[0].url).searchParams.keys()].sort()).toEqual(["address", "benchmark", "format"]);
    expect(new URL(census[0].url).searchParams.get("address")).toBe(ADDRESS);
    expect(census[0].body).toBeNull();
    // Review L9: no request follows a redirect.
    for (const r of [...nws, ...census]) expect(r.redirect).toBe("error");
    expect(reqs.filter((r) => !r.url.startsWith("https://api.weather.gov/") && !r.url.startsWith("https://geocoding.geo.census.gov/") && !r.url.startsWith("https://api.resend.com/"))).toEqual([]);
  });

  test("W6 a forecast change after sending nudges the owner (not before sending); readers keep the line that was sent", async () => {
    vi.useFakeTimers({ now: START });
    const w = await world();
    const reqs: Req[] = [];
    stub(reqs);
    wx.temp = 62; wx.short = "Sunny"; wx.nwsDown = false;
    const { csId } = await sheet(w, 3);
    await cron(w);
    // Not sent yet: a change in the forecast is just the sheet's line, no nudge.
    at(1);
    wx.temp = 64;
    await w.heston.mutation(api.callSheets.refreshWeather, { callSheetId: csId });
    await settle(w);
    expect((await view(w, csId)).line).toMatch(/^Sunny · 64°/);
    expect(await needs(w)).toEqual([]);

    await w.heston.mutation(api.callSheets.send, { callSheetId: csId, crew: true, client: true });
    await settle(w);
    const sentMails = mails(reqs).length;
    const read = async () => weatherLine(pageOf((await w.maya.query(api.callSheets.forClient, { callSheetId: csId })).page));
    expect(await read()).toMatch(/^Sunny · 64°/);
    expect(await needs(w)).toEqual([]); // sent with the current line

    // The day before: the forecast changes. The owner is nudged; Maya still reads the line that was sent; no email.
    at(2);
    wx.temp = 50; wx.short = "Showers";
    await cron(w);
    expect(await needs(w)).toEqual([expect.objectContaining({ kind: "weatherChanged", callSheetId: csId, title: "Launch · Harbor Coffee", line: expect.stringMatching(/^Showers · 50°/) })]);
    expect(await read()).toMatch(/^Sunny · 64°/);
    expect(mails(reqs).length).toBe(sentMails);
    // Another business's owner sees none of it.
    expect(await needs(w, "boss")).toEqual([]);

    // Send an update: readers get the new line and the nudge goes.
    const g = await w.heston.query(api.callSheets.get, { callSheetId: csId });
    expect(g.changes[0]).toMatch(/^Weather: Showers · 50°/);
    await w.heston.mutation(api.callSheets.sendUpdate, { callSheetId: csId, changed: "" });
    await settle(w);
    expect(await read()).toMatch(/^Showers · 50°/);
    expect(await needs(w)).toEqual([]);
  });

  test("W7 another business's owner can't read or change a sheet's weather", async () => {
    vi.useFakeTimers({ now: START });
    const w = await world();
    const reqs: Req[] = [];
    stub(reqs);
    wx.nwsDown = false;
    const { csId, buildId } = await sheet(w, 3);
    await cron(w);
    const before = await w.t.run(async (ctx) => ({ cs: await ctx.db.get(csId), b: await ctx.db.get(buildId) }));
    reqs.length = 0;
    expect(await w.boss.query(api.callSheets.get, { callSheetId: csId })).toBeNull();
    expect(await w.boss.query(api.builder.getBuild, { buildId })).toBeNull();
    await expect(w.boss.mutation(api.callSheets.refreshWeather, { callSheetId: csId })).rejects.toThrow();
    await expect(w.boss.mutation(api.builder.saveBuild, { buildId, title: "x", blocks: { type: "doc", content: [] }, fields: {}, signers: [], style: {} })).rejects.toThrow();
    await settle(w);
    expect(outside(reqs)).toEqual([]);
    const after = await w.t.run(async (ctx) => ({ cs: await ctx.db.get(csId), b: await ctx.db.get(buildId) }));
    expect(after).toEqual(before);
    // Its own lookups run as its own business: B's scope can't reach A's sheet.
    const B = await w.t.run(async (ctx) => (await ctx.db.query("businesses").collect()).find((b) => b.slug === "other")!._id);
    expect(await w.t.query(internal.callSheets.weatherInput, { callSheetId: csId, force: true, asBusiness: B })).toBeNull();
    expect(await w.t.mutation(internal.callSheets.weatherStore, { callSheetId: csId, address: "x", date: "2026-11-13", kind: "forecast", line: "Hacked", asBusiness: B })).toBeNull(); // invisible to B
    expect((await w.t.run(async (ctx) => ctx.db.get(csId)))!.weather).toEqual(before.cs!.weather);
  });

  test("W8 the old tick box becomes a Weather block once (lazy on open, and the internal migration is idempotent)", async () => {
    vi.useFakeTimers({ now: START });
    const w = await world();
    stub([]);
    const old: Page = { type: "doc", content: [
      { type: "paragraph", attrs: { size: "title" }, content: [{ type: "text", text: "Call sheet" }] },
      { type: "location", attrs: { ...emptyLocation(), name: "Studio B", address: ADDRESS, weather: true } },
      { type: "schedule", attrs: { rows: [] } },
    ] };
    const { buildId, templateId, plainId } = await w.t.run(async (ctx) => ({
      buildId: await ctx.db.insert("wsBuilds", { businessId: w.A, title: "Old", blocks: old, fields: {}, style: {}, signers: [], kind: "callsheet", createdAt: 0, updatedAt: 0 }),
      templateId: await ctx.db.insert("wsTemplates", { businessId: w.A, name: "Old template", kind: "callsheet", blocks: old, fields: {}, style: {}, createdAt: 0, updatedAt: 0 }),
      plainId: await ctx.db.insert("wsBuilds", { businessId: w.A, title: "No weather", blocks: { ...old, content: [old.content[0], { type: "location", attrs: emptyLocation() }] }, fields: {}, style: {}, signers: [], kind: "callsheet", createdAt: 0, updatedAt: 0 }),
    }));
    const check = (p: Page) => {
      expect((p.content ?? []).map((n: PNode) => n.type)).toEqual(["paragraph", "location", "weather", "schedule"]);
      expect(nodesOf(p, "location")[0].attrs!.weather).toBe(false);
      expect(weatherOf(nodesOf(p, "weather")[0])).toEqual({ typed: false, line: "" });
    };
    // Lazy: opening it in the editor shows the block (stored as it was until the editor saves).
    check(pageOf((await w.heston.query(api.builder.getBuild, { buildId })).blocks));
    check(pageOf((await w.heston.query(api.builder.getTemplate, { templateId })).blocks));
    // The internal migration: once, then nothing left to do.
    expect(await w.t.mutation(internal.callSheets.migrateWeatherBlocks, {})).toEqual({ builds: 1, templates: 1 });
    expect(await w.t.mutation(internal.callSheets.migrateWeatherBlocks, {})).toEqual({ builds: 0, templates: 0 });
    const stored = await w.t.run(async (ctx) => ({ b: await ctx.db.get(buildId), t: await ctx.db.get(templateId), plain: await ctx.db.get(plainId) }));
    check(pageOf(stored.b!.blocks));
    check(pageOf(stored.t!.blocks));
    expect(nodesOf(pageOf(stored.plain!.blocks), "weather")).toHaveLength(0); // never ticked: no block
    // The pure function: a page that already has a block only loses the tick; a migrated page is left alone.
    const once = migrateWeather(old);
    expect(once.changed).toBe(true);
    expect(migrateWeather(once.page)).toEqual({ page: once.page, changed: false });
    const both = migrateWeather({ type: "doc", content: [...old.content, { type: "weather", attrs: { typed: true, line: "Hot" } }] });
    expect(nodesOf(both.page, "weather").map((n) => weatherOf(n))).toEqual([{ typed: true, line: "Hot" }]);
  });

  test("W9 the questions' toggle off: no Weather block; whatChanged names the weather", () => {
    const d = { location: emptyLocation(), schedule: [], crew: [], contacts: [] };
    const tpl: Page = { type: "doc", content: [{ type: "location", attrs: emptyLocation() }, { type: "weather", attrs: { typed: false, line: "" } }] };
    expect(nodesOf(fillSheet(tpl, { ...d, weather: false }), "weather")).toHaveLength(0);
    expect(nodesOf(fillSheet(tpl, { ...d, weather: true }), "weather")).toHaveLength(1);
    expect(nodesOf(fillSheet(tpl, d), "weather")).toHaveLength(1); // a template keeps its own
    expect(nodesOf(fillSheet(null, d), "weather")).toHaveLength(0);
    const a: Page = { type: "doc", content: [{ type: "weather", attrs: { typed: false, line: "Sunny" } }] };
    const b: Page = { type: "doc", content: [{ type: "weather", attrs: { typed: false, line: "Rain" } }] };
    expect(whatChanged(a, b)).toEqual(["Weather: Rain"]);
    expect(whatChanged(a, a)).toEqual([]);
  });

  test("W10 review L9: Census and NWS are asked never to follow a redirect; a refused redirect is 'try again later'", async () => {
    const seen: Array<RequestRedirect | undefined> = [];
    // fetch with redirect "error" rejects (TypeError) when the server answers with a redirect.
    const redirecting = (async (_u: string | URL | Request, init?: RequestInit) => { seen.push(init?.redirect); throw new TypeError("redirect mode is set to error"); }) as typeof fetch;
    expect(await geocode(ADDRESS, redirecting)).toEqual({ kind: "error" });
    expect(await forecast({ lat: 30.2672, lon: -97.7431 }, "2026-11-13", redirecting)).toEqual({ kind: "error" });
    expect(seen).toEqual(["error", "error"]);
  });

  test("W11 review L10: only the Location block's address goes to Census; no address is 'no forecast', asking for one", async () => {
    // The pure rule: the place name and the shoot's location text are never the address.
    const page = (attrs: Partial<ReturnType<typeof emptyLocation>>): Page => ({ type: "doc", content: [{ type: "location", attrs: { ...emptyLocation(), ...attrs } }, { type: "weather", attrs: { typed: false, line: "" } }] });
    expect(weatherAddress(page({ name: "The Hills' house", address: "" }), "Riverside Loft")).toEqual({ address: "", place: "The Hills' house" });
    expect(weatherAddress(page({ name: "", address: "" }), "Riverside Loft")).toEqual({ address: "", place: "Riverside Loft" });
    expect(weatherAddress(page({ name: "Studio B", address: ` ${ADDRESS} ` }), "x").address).toBe(ADDRESS);

    vi.useFakeTimers({ now: START });
    const w = await world();
    const reqs: Req[] = [];
    stub(reqs);
    wx.nwsDown = false;
    const { csId, buildId } = await sheet(w, 3);
    await edit(w, buildId, (p) => { nodesOf(p, "location")[0].attrs!.address = ""; }); // place name "Studio B" and the shoot's "Studio B" stay
    await settle(w);
    reqs.length = 0;
    await cron(w);
    expect(outside(reqs)).toEqual([]); // nothing looked up: not the place name, not the shoot's location
    expect(await view(w, csId)).toMatchObject({ state: "none", line: "", noAddress: true, place: "Studio B" });
    await expect(w.heston.mutation(api.callSheets.refreshWeather, { callSheetId: csId })).rejects.toThrow("There is no address on the sheet. Add one to get the forecast.");
    expect(await w.t.query(internal.callSheets.weatherInput, { callSheetId: csId, force: true })).toBeNull();
    await settle(w);
    expect(outside(reqs)).toEqual([]);
    // More than a week away with no address: still "no forecast" (it would never fill), not "not yet".
    const far = await sheet(w, 10);
    await edit(w, far.buildId, (p) => { nodesOf(p, "location")[0].attrs!.address = ""; });
    expect(await view(w, far.csId)).toMatchObject({ state: "none", noAddress: true });
    // The address added: looked up as usual (the address only).
    await edit(w, buildId, (p) => { nodesOf(p, "location")[0].attrs!.address = ADDRESS; });
    await cron(w);
    expect(await view(w, csId)).toMatchObject({ state: "forecast", noAddress: false });
    const census = outside(reqs).filter((r) => r.url.startsWith("https://geocoding.geo.census.gov/"));
    expect(census.map((r) => new URL(r.url).searchParams.get("address"))).toEqual([ADDRESS]);
  });

  test("W12 review L11: Refresh's 30-second guard keys on each try, so a lookup that failed (forecast kept) still counts", async () => {
    vi.useFakeTimers({ now: START });
    const w = await world();
    const reqs: Req[] = [];
    stub(reqs);
    wx.nwsDown = false; wx.temp = 62; wx.short = "Sunny";
    const { csId } = await sheet(w, 3);
    await cron(w);
    const filled = (await w.t.run(async (ctx) => ctx.db.get(csId)))!.weather!.at;
    // A minute on, NWS is down: Refresh tries, fails, and the forecast (and its time) stay.
    vi.setSystemTime(Date.now() + 60_000);
    wx.nwsDown = true;
    expect(await w.heston.mutation(api.callSheets.refreshWeather, { callSheetId: csId })).toEqual({ state: "looking" });
    // A double press before the lookup has even run: refused.
    expect(await w.heston.mutation(api.callSheets.refreshWeather, { callSheetId: csId })).toEqual({ state: "recent" });
    await settle(w);
    const after = (await w.t.run(async (ctx) => ctx.db.get(csId)))!;
    expect(after.weather!.at).toBe(filled); // didn't move: the old guard would let the next press through
    expect(after.weatherTriedAt).toBeGreaterThan(filled);
    reqs.length = 0;
    vi.setSystemTime(Date.now() + 10_000);
    expect(await w.heston.mutation(api.callSheets.refreshWeather, { callSheetId: csId })).toEqual({ state: "recent" });
    await settle(w);
    expect(outside(reqs)).toEqual([]);
    // 30 seconds after the last try: it may look again.
    vi.setSystemTime(Date.now() + 31_000);
    wx.nwsDown = false; wx.temp = 70;
    expect(await w.heston.mutation(api.callSheets.refreshWeather, { callSheetId: csId })).toEqual({ state: "looking" });
    await settle(w);
    expect((await view(w, csId)).line).toMatch(/^Sunny · 70°/);
  });
});
