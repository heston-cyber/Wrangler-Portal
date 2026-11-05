// Phase 5d step 1 (T5d.1–T5d.3): booking calls. The page is closed until Google Calendar is connected; open times
// follow the hours offered (Central), the shortest notice, what's busy on the checked calendar (with the buffer) and the
// calls already booked; a pick is checked with Google again before it's booked (a Meet link, the lead invited), or
// it's "taken"; two leads can't book one time; the robot field books nothing; a lead who books twice keeps one card;
// the lead moves and cancels from their own link only; emails 43, 52–56 (the owner's behind its switch); the owner's
// Needs you row until Done; another business's owner sees nothing.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { setup } from "./matrix";
import { openSlots, DEFAULT_PREFS } from "../convex/lib/callSlots";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
  process.env.GOOGLE_CLIENT_ID = "gid";
  process.env.GOOGLE_CLIENT_SECRET = "gsecret";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const MON = Date.parse("2030-01-07T13:57:00Z"); // Monday 7:57 AM Central (settling moves the clock a minute at a time)
const at = (iso: string) => Date.parse(iso);
type Sent = { to: string; subject: string; text: string };
type Google = { busy: Array<{ id: string; start: string; end: string; transparency?: string }>; made: any[]; patched: any[]; deleted: string[]; down?: boolean };

function stub(mails: Sent[], g: Google) {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response(JSON.stringify({ id: "re_1" }), { status: 200 }); }
    if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
    if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/")) {
      if (g.down) return new Response("{}", { status: 500 });
      if (method === "GET") {
        const q = new URL(url).searchParams;
        const s = Date.parse(q.get("timeMin")!), e = Date.parse(q.get("timeMax")!);
        const items = g.busy.filter((b) => Date.parse(b.start) < e && s < Date.parse(b.end)).map((b) => ({ id: b.id, status: "confirmed", ...(b.transparency ? { transparency: b.transparency } : {}), start: { dateTime: b.start }, end: { dateTime: b.end } }));
        return new Response(JSON.stringify({ items }), { status: 200 });
      }
      if (method === "POST") { const body = JSON.parse(String(init?.body)); g.made.push({ url, body }); const id = `ev${g.made.length}`; g.busy.push({ id, start: body.start.dateTime, end: body.end.dateTime }); return new Response(JSON.stringify({ id, hangoutLink: "https://meet.google.com/abc-defg-hij" }), { status: 200 }); }
      if (method === "PATCH") { const body = JSON.parse(String(init?.body)); g.patched.push({ url, body }); const id = decodeURIComponent(url.split("/events/")[1].split("?")[0]); g.busy = g.busy.map((b) => (b.id === id ? { ...b, start: body.start.dateTime, end: body.end.dateTime } : b)); return new Response(JSON.stringify({ id }), { status: 200 }); }
      if (method === "DELETE") { const id = decodeURIComponent(url.split("/events/")[1].split("?")[0]); g.deleted.push(id); g.busy = g.busy.filter((b) => b.id !== id); return new Response(null, { status: 204 }); }
    }
    return new Response("{}", { status: 500 });
  }));
}

async function world(opts: { busy?: Google["busy"] } = {}) {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(MON);
  const { t, ids } = await setup();
  const mails: Sent[] = [];
  const g: Google = { busy: opts.busy ?? [{ id: "meeting", start: "2030-01-07T19:00:00Z", end: "2030-01-07T20:00:00Z" }], made: [], patched: [], deleted: [] };
  stub(mails, g);
  const owner = t.withIdentity({ subject: ids.ownerSub });
  // The matrix's records belong to the default business (Wrangler); its Google connection is put there too.
  await owner.mutation(api.calls.done, { callId: ids.callId }); // any owner write makes the default business
  const slug = await t.run(async (ctx) => {
    const def = (await ctx.db.query("businesses").collect()).find((b) => b.slug !== "matrix")!;
    for (const c of await ctx.db.query("calendars").collect()) await ctx.db.patch(c._id, { businessId: def._id });
    return def.slug;
  });
  // A minute at a time, so a check with Google finishes before the five-minute hold runs out (as it does for real).
  const settle = () => t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(60_000));
  const open = async () => { await t.mutation(api.calls.refresh, { slug }); await settle(); return await t.query(api.calls.page, { slug }); };
  return { t, ids, mails, g, slug, owner, settle, open };
}
type W = Awaited<ReturnType<typeof world>>;
/** The pick only: the code email goes out; nothing else happens yet. */
const pick = (w: W, start: number, who = { name: "Tom Silva", email: "tom@lead.example" }, extra: Record<string, unknown> = {}) =>
  w.t.mutation(api.calls.book, { slug: w.slug, start, tz: "America/New_York", note: "A launch video.", ...who, ...extra });
/** Runs the code email (not the 10-minute let-go) and takes the code out of the mails seen. */
async function codeFor(w: W, email: string) {
  vi.advanceTimersByTime(1);
  await w.t.finishInProgressScheduledFunctions();
  const i = w.mails.map((m, j) => [m, j] as const).filter(([m]) => m.to === email && /is your code to book/.test(m.subject)).pop();
  if (!i) return null;
  w.mails.splice(i[1], 1);
  return i[0].subject.slice(0, 6);
}
/** Pick, then type the emailed code (Heston, Nov 4: the email is confirmed before a time is booked). */
async function book(w: W, start: number, who = { name: "Tom Silva", email: "tom@lead.example" }, extra: Record<string, unknown> = {}) {
  const r = await pick(w, start, who, extra);
  if (!r.token) return r;
  const code = await codeFor(w, who.email);
  expect((await w.t.mutation(api.calls.verify, { token: r.token, code })).error).toBeNull();
  return r;
}

describe("booking calls", () => {
  test("Closed until Google is set up; open times follow the hours, the notice, Google's busy times with the buffer, and calls booked", async () => {
    const w = await world();
    delete process.env.GOOGLE_CLIENT_ID;
    expect((await w.t.query(api.calls.page, { slug: w.slug })).state).toBe("closed");
    process.env.GOOGLE_CLIENT_ID = "gid";
    const p = await w.open();
    expect(p.state).toBe("open");
    const monday = p.slots.filter((s: number) => s < at("2030-01-08T06:00:00Z"));
    // 8 AM now + 4 hours' notice → noon. The 1–2 PM meeting and 10 minutes either side block 12:30 to 2:00.
    expect(monday).toEqual(["18:00", "20:30", "21:00", "21:30", "22:00", "22:30"].map((h) => at(`2030-01-07T${h}:00Z`))); // noon, then 2:30–4:30 PM Central
    // Saturday and Sunday aren't offered; the matrix's booked call (Saturday 9 AM) isn't a weekday anyway.
    expect(p.slots.some((s: number) => [0, 6].includes(new Date(s - 6 * 3_600_000).getUTCDay()))).toBe(false);
    // A free ("transparent") event doesn't block.
    w.g.busy.push({ id: "free", start: "2030-01-08T15:00:00Z", end: "2030-01-08T16:00:00Z", transparency: "transparent" });
    vi.setSystemTime(MON + 61_000);
    expect((await w.open()).slots).toContain(at("2030-01-08T15:00:00Z"));
  });

  test("Booking: checked with Google again, then a Meet event inviting the lead; a lead card; emails 43 and 52", async () => {
    const w = await world();
    await w.open();
    const r = await book(w, at("2030-01-08T16:00:00Z"));
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect((await w.t.query(api.calls.manage, { token: r.token })).status).toBe("holding");
    await w.settle();
    const m = await w.t.query(api.calls.manage, { token: r.token });
    expect(m).toMatchObject({ status: "booked", meet: "https://meet.google.com/abc-defg-hij", canChange: true, name: "Tom Silva" });
    expect(w.g.made).toHaveLength(1);
    expect(w.g.made[0].url).toContain("conferenceDataVersion=1");
    expect(w.g.made[0].url).toContain("sendUpdates=all");
    expect(w.g.made[0].body).toMatchObject({ attendees: [{ email: "tom@lead.example", displayName: "Tom Silva" }], conferenceData: { createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } } } });
    // Review H1: nothing the lead typed goes into the invite Google sends from the owner's account.
    expect(w.g.made[0].body.summary).toMatch(/^Call with /);
    expect(JSON.stringify(w.g.made[0].body)).not.toContain("A launch video.");
    expect(w.g.made[0].body.id).toMatch(/^call[0-9a-f]+$/);
    const deal = await w.t.run(async (ctx) => (await ctx.db.query("deals").collect()).find((d) => d.contactEmail === "tom@lead.example"));
    expect(deal).toMatchObject({ stage: "lead", source: "call", lead: { name: "Tom Silva", email: "tom@lead.example", message: "A launch video." } });
    const lead = w.mails.find((x) => x.to === "tom@lead.example")!;
    expect(lead.subject).toMatch(/is booked/);
    expect(lead.text).toContain("Tue, Jan 8 · 11:00 – 11:30 AM (Eastern Time)"); // the lead's own zone
    expect(lead.text).toContain("https://meet.google.com/abc-defg-hij");
    expect(lead.text).toContain(`https://app.wranglerportal.com/call/${r.token}`);
    const own = w.mails.find((x) => x.to === "heston@wranglerproductions.com")!;
    expect(own.subject).toMatch(/^Tom Silva booked a call/);
    expect(own.text).toContain("10:00 – 10:30 AM (Central Time)");
    expect(own.text).toContain(`/clients/deals/${deal!._id}`);
    // The owner: the lead page's card, and a Needs you row until Done.
    expect(await w.owner.query(api.calls.forDeal, { dealId: deal!._id })).toMatchObject([{ status: "booked", upcoming: true, onCalendar: true }]);
    const needs = (await w.owner.query(api.home.needs, {})).filter((n: { kind: string }) => n.kind === "call");
    expect(needs.find((n: { who: string }) => n.who === "Tom Silva")).toMatchObject({ what: "booked" });
    await w.owner.mutation(api.calls.done, { callId: needs.find((n: { who: string }) => n.who === "Tom Silva").callId });
    expect((await w.owner.query(api.home.needs, {})).some((n: { kind: string; who?: string }) => n.kind === "call" && n.who === "Tom Silva")).toBe(false);
    // The time is gone from the page now.
    expect((await w.t.query(api.calls.page, { slug: w.slug })).slots).not.toContain(at("2030-01-08T16:00:00Z"));
    // Booking again keeps the one card.
    vi.setSystemTime(MON + 61_000);
    await w.open();
    await book(w, at("2030-01-09T16:00:00Z"));
    await w.settle();
    expect(await w.t.run(async (ctx) => (await ctx.db.query("deals").collect()).filter((d) => d.contactEmail === "tom@lead.example").length)).toBe(1);
  });

  test("A meeting added in Google meanwhile: the held time is taken, nothing is made, nobody is emailed", async () => {
    const w = await world();
    await w.open();
    const r = await book(w, at("2030-01-08T16:00:00Z"));
    w.g.busy.push({ id: "late", start: "2030-01-08T16:00:00Z", end: "2030-01-08T17:00:00Z" });
    await w.settle();
    expect((await w.t.query(api.calls.manage, { token: r.token })).status).toBe("taken");
    expect(w.g.made).toHaveLength(0);
    expect(w.mails).toHaveLength(0);
  });

  test("Two leads can't book one time; the robot field books nothing; stale times ask to pick again; three upcoming at most", async () => {
    const w = await world();
    await w.open();
    const s = at("2030-01-08T16:00:00Z");
    expect((await book(w, s)).token).toBeTruthy();
    expect(await book(w, s, { name: "Ann", email: "ann@lead.example" })).toMatchObject({ token: null, error: "That time was just taken. Pick another." });
    const before = await w.t.run(async (ctx) => (await ctx.db.query("calls").collect()).length);
    expect(await book(w, at("2030-01-08T17:00:00Z"), { name: "Bot", email: "bot@x.example" }, { website: "http://spam" })).toEqual({ token: null, error: null });
    expect(await w.t.run(async (ctx) => (await ctx.db.query("calls").collect()).length)).toBe(before);
    await w.settle();
    // Busy times older than 10 minutes: pick again (and they're read again).
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(await book(w, at("2030-01-08T17:30:00Z"), { name: "Cy", email: "cy@lead.example" })).toMatchObject({ token: null, error: "The open times have changed. Pick a time again." });
    await w.settle();
    expect((await book(w, at("2030-01-08T17:30:00Z"), { name: "Cy", email: "cy@lead.example" })).token).toBeTruthy();
    await book(w, at("2030-01-09T16:00:00Z"), { name: "Cy", email: "cy@lead.example" });
    await book(w, at("2030-01-10T16:00:00Z"), { name: "Cy", email: "cy@lead.example" });
    await expect(book(w, at("2030-01-11T16:00:00Z"), { name: "Cy", email: "cy@lead.example" })).rejects.toThrow(/already have calls booked/);
    await expect(book(w, at("2030-01-08T19:30:00Z"), { name: "", email: "x@lead.example" })).rejects.toThrow(/name/);
    await expect(book(w, at("2030-01-08T19:30:00Z"), { name: "X", email: "nope" })).rejects.toThrow(/email/);
  });

  test("Junk picks don't use up the business's limit (review M1); nothing is offered past the period read from Google (L2)", async () => {
    const w = await world();
    const p = await w.open();
    for (let i = 0; i < 25; i++) expect((await book(w, 0, { name: "J", email: `j${i}@x.example` })).error).toMatch(/just taken/);
    expect((await book(w, p.slots[0])).token).toBeTruthy();
    const read = await w.t.run(async (ctx) => (await ctx.db.query("callSettings").first())!.busy!.e);
    expect(p.slots.every((x: number) => x + 30 * 60_000 <= read)).toBe(true);
  });

  test("The lead moves it (the event moves, emails 56 and 54), then cancels (off the calendar, emails 55 and 53)", async () => {
    const w = await world();
    await w.open();
    const { token } = await book(w, at("2030-01-08T16:00:00Z"));
    await w.settle();
    await w.open(); // the code's 10 minutes have passed by now: the page reads the calendar again
    w.mails.length = 0;
    expect(await w.t.mutation(api.calls.reschedule, { token, start: at("2030-01-09T17:00:00Z") })).toEqual({ error: null });
    expect((await w.t.query(api.calls.manage, { token })).moving).toBe(true);
    await w.settle();
    const m = await w.t.query(api.calls.manage, { token });
    expect(m).toMatchObject({ status: "booked", start: at("2030-01-09T17:00:00Z"), moving: false });
    expect(w.g.patched).toHaveLength(1);
    expect(w.g.patched[0].url).toContain("/events/ev1?sendUpdates=all");
    expect(w.mails.find((x) => x.to === "tom@lead.example")!.subject).toMatch(/is moved/);
    expect(w.mails.find((x) => x.to === "heston@wranglerproductions.com")!.subject).toMatch(/^Tom Silva moved their call/);
    // A time someone took in Google meanwhile: the call stays where it was, and the page says so.
    await w.open(); // busy times read again now (settling ran the clock on)
    w.g.busy.push({ id: "late", start: "2030-01-10T16:00:00Z", end: "2030-01-10T17:00:00Z" });
    expect(await w.t.mutation(api.calls.reschedule, { token, start: at("2030-01-10T16:00:00Z") })).toEqual({ error: null });
    await w.settle();
    const m2 = await w.t.query(api.calls.manage, { token });
    expect(m2.start).toBe(at("2030-01-09T17:00:00Z"));
    expect(m2.moveTaken).toBeTruthy();
    // Google failing during a move: the call stays put (review M3), and the lead is told.
    await w.open();
    w.g.down = true;
    expect(await w.t.mutation(api.calls.reschedule, { token, start: at("2030-01-10T19:00:00Z") })).toEqual({ error: null });
    await w.settle();
    w.g.down = false;
    const m3 = await w.t.query(api.calls.manage, { token });
    expect(m3).toMatchObject({ start: at("2030-01-09T17:00:00Z"), moving: false });
    expect(m3.moveFailed).toBeTruthy();
    // No cancelling while a new booking is still being checked (review M2).
    const held = await book(w, at("2030-01-11T16:00:00Z"), { name: "Ann", email: "ann@lead.example" });
    await expect(w.t.mutation(api.calls.cancel, { token: held.token })).rejects.toThrow(/still being booked/);
    // A hold nobody resolved is let go after five minutes (review L1).
    const stuck = await w.t.run(async (ctx) => (await ctx.db.query("calls").withIndex("by_token", (q) => q.eq("token", held.token)).unique())!._id);
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await w.t.mutation(api.calls.expire as never, { callId: stuck } as never);
    expect((await w.t.query(api.calls.manage, { token: held.token })).status).toBe("taken");
    w.mails.length = 0;
    await w.t.mutation(api.calls.cancel, { token });
    await w.settle();
    expect((await w.t.query(api.calls.manage, { token })).status).toBe("cancelled");
    expect(w.g.deleted).toEqual(["ev1"]);
    expect(w.mails.find((x) => x.to === "tom@lead.example")!.text).toContain(`https://app.wranglerportal.com/book/${w.slug}`);
    expect(w.mails.find((x) => x.to === "heston@wranglerproductions.com")!.subject).toMatch(/cancelled their call/);
    await expect(w.t.mutation(api.calls.reschedule, { token, start: at("2030-01-10T19:00:00Z") })).rejects.toThrow(/isn't booked/);
  });

  test("The owner's switch stops emails 52–54, never the lead's; a wrong link does nothing", async () => {
    const w = await world();
    await w.owner.mutation(api.notifications.setOwner, { key: "booked_calls", on: false });
    await w.open();
    const { token } = await book(w, at("2030-01-08T16:00:00Z"));
    await w.settle();
    expect(w.mails.map((x) => x.to)).toEqual(["tom@lead.example"]);
    expect(await w.t.query(api.calls.manage, { token: "y".repeat(24) })).toBeNull();
    await expect(w.t.mutation(api.calls.cancel, { token: "y".repeat(24) })).rejects.toThrow(/doesn't work/);
    expect((await w.t.query(api.calls.manage, { token })).status).toBe("booked");
  });

  test("Settings: saved and checked; the calendar must be one of theirs; another business's owner sees nothing", async () => {
    const w = await world();
    const s = await w.owner.query(api.calls.settings, {});
    expect(s).toMatchObject({ saved: true, open: true, link: `https://app.wranglerportal.com/book/${w.slug}`, calendar: { checkId: "cal@x" } });
    const prefs = { lengthMin: 45, bufferMin: 15, aheadDays: 14, noticeHours: 24, hours: DEFAULT_PREFS.hours };
    await w.owner.mutation(api.calls.saveSettings, prefs);
    expect((await w.owner.query(api.calls.settings, {})).prefs).toMatchObject({ lengthMin: 45, bufferMin: 15, aheadDays: 14, noticeHours: 24 });
    await expect(w.owner.mutation(api.calls.saveSettings, { ...prefs, lengthMin: 20 })).rejects.toThrow(/call length/);
    await expect(w.owner.mutation(api.calls.saveSettings, { ...prefs, calendarId: "someone-else@x" })).rejects.toThrow(/your calendars/);
    await expect(w.owner.mutation(api.calls.saveSettings, { ...prefs, hours: prefs.hours.map((h, i) => (i === 0 ? { on: true, start: "17:00", end: "09:00" } : h)) })).rejects.toThrow(/Monday ends before it starts/);
    // Another business's owner, signed in, on this page.
    const other = await w.t.run(async (ctx) => {
      const b = await ctx.db.insert("businesses", { slug: "other", name: "Other Co", createdAt: 0 });
      const u = await ctx.db.insert("users", { email: "boss@other.example", name: "Boss" });
      await ctx.db.insert("memberships", { businessId: b, email: "boss@other.example", userId: u, role: "owner", createdAt: 0 });
      return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
    });
    const boss = w.t.withIdentity({ subject: other });
    expect(await boss.query(api.calls.page, { slug: w.slug })).toMatchObject({ state: "otherOwner" });
    await expect(boss.mutation(api.calls.book, { slug: w.slug, start: at("2030-01-08T16:00:00Z"), name: "B", email: "b@x.example", tz: "UTC" })).rejects.toThrow(/isn't open/);
    expect(await boss.query(api.calls.manage, { token: "matrixcalltoken0123456789" })).toBeNull();
  });

  test("T5d.7 The emailed code: nothing is made until it's right; the time is held meanwhile; wrong 5 times or 10 minutes and it's let go; Send a new code", async () => {
    const w = await world();
    await w.open();
    const slot = at("2030-01-08T16:00:00Z");
    const deals = () => w.t.run(async (ctx) => (await ctx.db.query("deals").collect()).filter((d) => d.contactEmail === "tom@lead.example").length);
    const r = await pick(w, slot);
    const code = (await codeFor(w, "tom@lead.example"))!;
    expect(code).toMatch(/^\d{6}$/);
    expect(w.mails).toHaveLength(0); // only the code email: no owner email, no booked email yet
    const m = await w.t.query(api.calls.manage, { token: r.token });
    expect(m).toMatchObject({ status: "verifying", code: { triesLeft: 5 } });
    expect(w.g.made).toHaveLength(0);
    expect(await deals()).toBe(0);
    // The time is held for them: nobody else is offered it.
    expect((await w.t.query(api.calls.page, { slug: w.slug })).slots).not.toContain(slot);
    // The code is stored as a hash only.
    const row = await w.t.run(async (ctx) => (await ctx.db.query("calls").withIndex("by_token", (q) => q.eq("token", r.token)).unique())!);
    expect(JSON.stringify(row)).not.toContain(code);
    // Wrong codes count down; the right one books.
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await w.t.mutation(api.calls.verify, { token: r.token, code: wrong })).error).toMatch(/4 tries left/);
    expect((await w.t.mutation(api.calls.verify, { token: r.token, code: "12" })).error).toMatch(/3 tries left/);
    expect((await w.t.mutation(api.calls.verify, { token: r.token, code: code.slice(0, 3) + " " + code.slice(3) })).error).toBeNull();
    await w.settle();
    expect((await w.t.query(api.calls.manage, { token: r.token })).status).toBe("booked");
    expect(await deals()).toBe(1);
    expect(w.mails.map((x) => x.to).sort()).toEqual(["heston@wranglerproductions.com", "tom@lead.example"]);

    // Five wrong codes: let go, the time is offered again, and the right code no longer works.
    await w.open();
    const r2 = await pick(w, at("2030-01-08T17:00:00Z"), { name: "Ann", email: "ann@lead.example" });
    const c2 = (await codeFor(w, "ann@lead.example"))!;
    const bad = c2 === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) await w.t.mutation(api.calls.verify, { token: r2.token, code: bad });
    expect((await w.t.mutation(api.calls.verify, { token: r2.token, code: bad })).error).toMatch(/too many times/);
    expect((await w.t.mutation(api.calls.verify, { token: r2.token, code: c2 })).error).toMatch(/run out/);
    expect((await w.t.query(api.calls.manage, { token: r2.token })).status).toBe("lapsed");
    expect((await w.t.query(api.calls.page, { slug: w.slug })).slots).toContain(at("2030-01-08T17:00:00Z"));

    // Send a new code: the old one stops working, the new one books. Not twice in 30 seconds; three an hour.
    const r3 = await pick(w, at("2030-01-08T18:00:00Z"), { name: "Bo", email: "bo@lead.example" });
    const old = (await codeFor(w, "bo@lead.example"))!;
    await expect(w.t.mutation(api.calls.resendCode, { token: r3.token })).rejects.toThrow(/just sent/);
    vi.advanceTimersByTime(31_000);
    await w.t.mutation(api.calls.resendCode, { token: r3.token });
    const fresh = (await codeFor(w, "bo@lead.example"))!;
    if (fresh !== old) expect((await w.t.mutation(api.calls.verify, { token: r3.token, code: old })).error).toMatch(/isn't right/);
    expect((await w.t.mutation(api.calls.verify, { token: r3.token, code: fresh })).error).toBeNull();

    // Ten minutes without the code: let go (no card, no event, no other email).
    await w.settle();
    await w.open();
    const made = w.g.made.length;
    w.mails.length = 0;
    const r4 = await pick(w, at("2030-01-09T16:00:00Z"), { name: "Cy", email: "cy@lead.example" });
    const c4 = (await codeFor(w, "cy@lead.example"))!;
    await w.settle(); // the 10 minutes pass
    expect((await w.t.query(api.calls.manage, { token: r4.token })).status).toBe("lapsed");
    expect((await w.t.mutation(api.calls.verify, { token: r4.token, code: c4 })).error).toMatch(/run out/);
    expect(w.g.made.length).toBe(made);
    expect(w.mails).toHaveLength(0);
    expect(await w.t.run(async (ctx) => (await ctx.db.query("deals").collect()).some((d) => d.contactEmail === "cy@lead.example"))).toBe(false);
    // A made-up link does nothing.
    await expect(w.t.mutation(api.calls.verify, { token: "nosuchtoken0123456789", code: "123456" })).rejects.toThrow(/doesn't work/);
    await expect(w.t.mutation(api.calls.resendCode, { token: "nosuchtoken0123456789" })).rejects.toThrow(/doesn't work/);
  });

  test("T5d.8 The On/Off switch: off, the page is closed and nothing can be picked; booked calls can still be cancelled; only the owner switches it", async () => {
    const w = await world();
    await w.open();
    const { token } = await book(w, at("2030-01-08T16:00:00Z"));
    await w.settle();
    await expect(w.t.mutation(api.calls.setPaused, { paused: true })).rejects.toThrow();
    await w.owner.mutation(api.calls.setPaused, { paused: true });
    expect((await w.owner.query(api.calls.settings, {})).paused).toBe(true);
    expect((await w.t.query(api.calls.page, { slug: w.slug })).state).toBe("closed");
    await expect(pick(w, at("2030-01-08T17:00:00Z"), { name: "Ann", email: "ann@lead.example" })).rejects.toThrow(/isn't open/);
    await w.t.mutation(api.calls.cancel, { token });
    expect((await w.t.query(api.calls.manage, { token })).status).toBe("cancelled");
    await w.owner.mutation(api.calls.setPaused, { paused: false });
    expect((await w.open()).state).toBe("open");
  });

  test("Open times keep the business's 9 AM through a daylight-saving change", () => {
    const sat = Date.parse("2030-03-09T18:00:00Z"); // Saturday before the change (Mar 10)
    const s = openSlots({ ...DEFAULT_PREFS, noticeHours: 1, aheadDays: 7 }, sat, [], []);
    const nine = (iso: string) => s.includes(Date.parse(iso));
    expect(nine("2030-03-08T15:00:00Z")).toBe(false); // in the past
    expect(nine("2030-03-11T14:00:00Z")).toBe(true);  // Monday 9:00 CDT is 14:00 UTC
    expect(nine("2030-03-11T15:00:00Z")).toBe(true);  // and 10:00 CDT
    expect(s.every((x) => x >= sat + 3_600_000)).toBe(true);
  });
});
