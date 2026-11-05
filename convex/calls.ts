// Phase 5d step 1 (Nov 4, D119, D144, Q54–Q56, Q86): booking calls with leads. Frames S5 · Phase 5d: Settings ›
// Booking calls (801:8966), the lead's page (801:10421 pick a time, 801:10512 your details, 801:10611 booked,
// 801:10666 no times open), Manage your call (802:10221) and its Cancel dialog, the lead page's Upcoming call card,
// emails 43 and 52–56.
//   - The page is app.wranglerportal.com/book/<business slug>. No login. It's open only while Google Calendar is
//     connected and Settings › Booking calls has been saved.
//   - Open times come from the hours offered (the business's wall clock), less what's busy on the calendar ticked under
//     "Calendar checked" (read from Google when the page opens, at most once a minute) and the calls already booked.
//   - A pick is held, then that time is read from Google once more before it's booked: two leads can't both get it,
//     and a meeting added in Google a minute ago still counts. The Google event has a Meet link and invites the lead.
//   - The lead moves or cancels from a private link (email 43). The owner gets emails 52–54 (switch "Booked calls" in
//     Notifications) and a Needs you row on the Dashboard until Done. A lead who books twice keeps one card.
//   - Signed in as another business's owner, the page shows nothing of this one (the database guard), like other links.
import { focusBusiness, internalAction, internalMutation, internalQuery, mutation, query, type Scope } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { bump, bumpDay } from "./lib/rate";
import { randomToken } from "./lib/hash";
import { SITE } from "./lib/site";
import { TZ, momentOf } from "./lib/gcal";
import { DEFAULT_PREFS, busyFrom, checkPrefs, openSlots, window, type CallPrefs, type Span } from "./lib/callSlots";
import { Disconnected, google, hasKeys, scopedAction } from "./calendar";
import { businessContact } from "./lib/business";
import { mailBrandOf } from "./lib/mail";
import { callBookedMail, callCancelledMail, callMovedMail, ownerCallMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { callLine } from "./messages";

type Ctx = QueryCtx | MutationCtx;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const READ_EVERY = 60_000;          // the calendar is read again at most once a minute
const FRESH_FOR = 10 * 60_000;      // a booking needs busy times read in the last 10 minutes
const MAX_UPCOMING = 3;             // per email address
const HOLD_FOR = 5 * 60_000;        // review L1: a held time or a move still unchecked after this is let go
/** Review M2: the Google event's id is fixed up front (lower-case hex is valid for Google), so it can always be removed. */
export const callEventId = (callId: string) => `call${Array.from(new TextEncoder().encode(callId), (b) => b.toString(16).padStart(2, "0")).join("")}`.slice(0, 1000);
const tidy = (s: string | undefined, max: number) => (s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, max);
const validZone = (tz: string) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };

const prefsOf = (row: Doc<"callSettings"> | null): CallPrefs => (row ? { lengthMin: row.lengthMin, bufferMin: row.bufferMin, aheadDays: row.aheadDays, noticeHours: row.noticeHours, hours: row.hours } : DEFAULT_PREFS);
const settingsRow = (ctx: Ctx) => ctx.db.query("callSettings").first();
const connection = (ctx: Ctx) => ctx.db.query("calendars").first();
/** Open for booking: Google set up, connected, a calendar to write to, and the settings saved. */
async function openState(ctx: Ctx) {
  const row = await settingsRow(ctx);
  const conn = await connection(ctx);
  const open = !!row && hasKeys() && !!conn && !conn.disconnectedAt && !!conn.calendarId;
  return { row, conn, open, checkId: row?.calendarId ?? conn?.calendarId ?? null };
}

async function bizBySlug(ctx: Ctx, slug: string) {
  const s = slug.trim().toLowerCase();
  if (!SLUG.test(s)) return null;
  return await ctx.db.query("businesses").withIndex("by_slug", (q) => q.eq("slug", s)).unique();
}
/** A signed-in owner of another business: the guard hides this one from them (they're told to use a private window). */
const otherOwner = (ctx: object, biz: Id<"businesses">) => { const s = (ctx as { scope?: Scope | null }).scope; return !!s?.isOwner && s.owner !== biz; };

/** Calls that hold a time: booked or held, and any new time being checked. `except`: a call being moved. */
async function takenSpans(ctx: Ctx, now: number, except?: Id<"calls">): Promise<Span[]> {
  const out: Span[] = [];
  for (const c of await ctx.db.query("calls").withIndex("by_start", (q) => q.gte("start", now - 86_400_000)).collect()) {
    if (c._id === except) continue;
    if (c.status === "booked" || c.status === "holding") out.push({ s: c.start, e: c.end });
    if (c.moving) out.push({ s: c.moving.start, e: c.moving.end });
  }
  return out;
}

async function brandBits(ctx: Ctx, biz: Doc<"businesses">) {
  return { name: biz.name, legalName: biz.legalName ?? null, owner: null as string | null, logoUrl: biz.logoFileId ? await ctx.storage.getUrl(biz.logoFileId) : null };
}

// ---------- the lead's page (no login) ----------

/** /book/<slug>: the business, the call, and the open times (moments; the page shows them in the lead's zone).
 *  With `token` (moving a booked call), that call's own time doesn't block. */
export const page = query({
  args: { slug: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, { slug, token }) => {
    const biz = await bizBySlug(ctx, slug);
    if (!biz) return null;
    if (otherOwner(ctx, biz._id)) return { state: "otherOwner" as const, business: await brandBits(ctx, biz) };
    focusBusiness(ctx, biz._id);
    const { row, open } = await openState(ctx);
    const business = await brandBits(ctx, biz);
    if (!open || !row) return { state: "closed" as const, business };
    const now = Date.now();
    const mine = token && TOKEN.test(token) ? await ctx.db.query("calls").withIndex("by_token", (q) => q.eq("token", token)).unique() : null;
    const busy = row.busy && row.busy.at > now - FRESH_FOR ? row.busy.spans : null;
    const slots = busy ? openSlots(prefsOf(row), now, busy, await takenSpans(ctx, now, mine?._id), 600, row.busy!.e) : [];
    return {
      state: "open" as const, business, lengthMin: row.lengthMin,
      reading: !busy || (!!row.readingAt && row.readingAt > now - 30_000), readAt: row.busy?.at ?? null, error: !busy && !!row.busy?.error, slots,
    };
  },
});

/** The page asks for busy times to be read again (when it opens, and Check again). At most once a minute. */
export const refresh = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const biz = await bizBySlug(ctx, slug);
    if (!biz || otherOwner(ctx, biz._id)) return null;
    focusBusiness(ctx, biz._id);
    const { row, open } = await openState(ctx);
    if (!open || !row) return null;
    const now = Date.now();
    if (row.busy && row.busy.at > now - READ_EVERY) return "fresh";
    if (row.readingAt && row.readingAt > now - 30_000) return "reading";
    await bump(ctx, "callRead", String(biz._id));
    await ctx.db.patch(row._id, { readingAt: now });
    await ctx.scheduler.runAfter(0, internal.calls.readBusy, {});
    return "reading";
  },
});

async function dealFor(ctx: MutationCtx, name: string, email: string, note: string, when: string) {
  const now = Date.now();
  const all = await ctx.db.query("deals").collect();
  const deal = all.find((d) => !d.closedAt && ((d.contactEmail ?? "").toLowerCase() === email || (d.lead?.email ?? "").toLowerCase() === email));
  if (deal) {
    await ctx.db.patch(deal._id, { history: [...deal.history, { kind: "call", at: now, detail: `Booked a call: ${when}` }], updatedAt: now });
    return deal._id;
  }
  return await ctx.db.insert("deals", {
    title: name.slice(0, 160), stage: "lead", source: "call", contactEmail: email,
    lead: { name, email, ...(note ? { message: note } : {}), fields: [], at: now },
    history: [{ kind: "call", at: now, detail: `Booked a call: ${when}` }], createdAt: now, updatedAt: now,
  });
}
const centralWhen = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Book a time. It's held while Google is read once more for it; the page follows the call by its token. */
export const book = mutation({
  args: { slug: v.string(), start: v.number(), name: v.string(), email: v.string(), note: v.optional(v.string()), tz: v.string(), website: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const biz = await bizBySlug(ctx, a.slug);
    if (!biz || otherOwner(ctx, biz._id)) throw new ConvexError("This booking page isn't open.");
    focusBusiness(ctx, biz._id);
    // The hidden field only a robot fills in: it looks booked, and nothing is made.
    if (tidy(a.website, 200)) return { token: null, error: null };
    const { row, open } = await openState(ctx);
    if (!open || !row) throw new ConvexError("This booking page isn't open.");
    const name = tidy(a.name, 120), email = a.email.trim().toLowerCase(), note = tidy(a.note, 2000);
    if (!name) throw new ConvexError("Add your name.");
    if (email.length > 254 || !EMAIL.test(email)) throw new ConvexError("Check your email address.");
    const tz = validZone(a.tz) ? a.tz : TZ;
    await bump(ctx, "callBook", `${biz._id}:${email}`);
    const now = Date.now();
    // Not thrown: a throw would undo the read of the calendar this asks for.
    if (!row.busy || row.busy.at < now - FRESH_FOR) {
      await ctx.scheduler.runAfter(0, internal.calls.readBusy, {});
      return { token: null, error: "The open times have changed. Pick a time again." };
    }
    if (!openSlots(prefsOf(row), now, row.busy.spans, await takenSpans(ctx, now), 600, row.busy.e).includes(a.start)) return { token: null, error: "That time was just taken. Pick another." };
    const upcoming = (await ctx.db.query("calls").withIndex("by_email", (q) => q.eq("email", email).gte("start", now)).collect()).filter((c) => c.status === "booked" || c.status === "holding");
    if (upcoming.length >= MAX_UPCOMING) throw new ConvexError("You already have calls booked. Move one of those instead.");
    // Review M1: the business-wide limits count only calls actually made, so junk attempts can't use them up.
    await bump(ctx, "callBookBiz", String(biz._id));
    await bumpDay(ctx, "callBookDay", String(biz._id));
    const end = a.start + row.lengthMin * 60_000;
    const dealId = await dealFor(ctx, name, email, note, centralWhen(a.start));
    const token = randomToken(18);
    const callId = await ctx.db.insert("calls", { dealId, name, email, ...(note ? { note } : {}), start: a.start, end, tz, status: "holding", token, history: [{ at: now, text: "Picked on the booking page" }], createdAt: now, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.calls.confirm, { callId });
    await ctx.scheduler.runAfter(HOLD_FOR, internal.calls.expire, { callId }); // review L1: a hold that never resolves
    return { token, error: null };
  },
});

async function callByToken(ctx: Ctx, token: string) {
  if (!TOKEN.test(token)) return null;
  const c = await ctx.db.query("calls").withIndex("by_token", (q) => q.eq("token", token)).unique();
  if (!c) return null;
  focusBusiness(ctx, c.businessId);
  return c;
}

/** /call/<token>: the lead's own call (email 43's Reschedule or cancel). */
export const manage = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const c = await callByToken(ctx, token);
    if (!c) return null;
    const biz = c.businessId ? await ctx.db.get(c.businessId) : null;
    if (!biz) return null;
    const now = Date.now();
    return {
      status: c.status, name: c.name, email: c.email, start: c.start, end: c.end, tz: c.tz, meet: c.meet ?? null, slug: biz.slug,
      business: { ...(await brandBits(ctx, biz)), owner: biz.ownerName ?? null }, moving: !!c.moving, moveFailed: c.moveFailed ?? null, moveTaken: c.moveTaken ?? null, past: c.end <= now,
      canChange: (c.status === "booked") && c.start > now && !c.moving,
    };
  },
});

/** The lead cancels (Cancel the call?). Off both calendars; emails 55 and 53. */
export const cancel = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const c = await callByToken(ctx, token);
    if (!c) throw new ConvexError("This link doesn't work.");
    await bump(ctx, "callChange", token);
    if (c.status === "cancelled") return;
    if (c.status === "holding") throw new ConvexError("Your call is still being booked. Try again in a moment.");
    if (c.status !== "booked") throw new ConvexError("This call isn't booked.");
    if (c.start <= Date.now()) throw new ConvexError("This call has already started.");
    const now = Date.now();
    await ctx.db.patch(c._id, { status: "cancelled", cancelledBy: "lead", moving: undefined, notice: { kind: "cancelled", at: now }, history: [...c.history, { at: now, text: "Cancelled by the lead" }], updatedAt: now });
    if (c.dealId) { const d = await ctx.db.get(c.dealId); if (d) await ctx.db.patch(d._id, { history: [...d.history, { kind: "call", at: now, detail: `Cancelled their call: ${centralWhen(c.start)}` }], updatedAt: now }); }
    await callLine(ctx, { ...c, status: "cancelled" }, "cancelled"); // Phase 5d step 2: a line in the lead's thread
    await ctx.scheduler.runAfter(0, internal.calls.dropEvent, { callId: c._id });
    await ctx.scheduler.runAfter(0, internal.calls.mail, { callId: c._id, what: "cancelled", at: now });
  },
});

/** The lead picks a new time. Checked with Google like a new booking; emails 56 and 54 once it's moved. */
export const reschedule = mutation({
  args: { token: v.string(), start: v.number(), tz: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const c = await callByToken(ctx, a.token);
    if (!c) throw new ConvexError("This link doesn't work.");
    await bump(ctx, "callChange", a.token);
    await bump(ctx, "callChangeBiz", String(c.businessId ?? "default"));
    if (c.status !== "booked") throw new ConvexError("This call isn't booked.");
    if (c.moving) throw new ConvexError("A new time is already being checked.");
    const now = Date.now();
    if (c.start <= now) throw new ConvexError("This call has already started.");
    const { row, open } = await openState(ctx);
    if (!open || !row) throw new ConvexError("Calls can't be moved here right now. Reply to the email instead.");
    if (!row.busy || row.busy.at < now - FRESH_FOR) {
      await ctx.scheduler.runAfter(0, internal.calls.readBusy, {});
      return { error: "The open times have changed. Pick a time again." };
    }
    if (!openSlots(prefsOf(row), now, row.busy.spans, await takenSpans(ctx, now, c._id), 600, row.busy.e).includes(a.start)) return { error: "That time was just taken. Pick another." };
    const tz = a.tz && validZone(a.tz) ? a.tz : c.tz;
    await ctx.db.patch(c._id, { moving: { start: a.start, end: a.start + (c.end - c.start), at: now }, moveTaken: undefined, moveFailed: undefined, tz, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.calls.confirmMove, { callId: c._id });
    await ctx.scheduler.runAfter(HOLD_FOR, internal.calls.expire, { callId: c._id });
    return { error: null };
  },
});

// ---------- Google (run for one business, without anyone's sign-in) ----------

export const readInputs = internalQuery({
  args: { callId: v.optional(v.id("calls")) },
  handler: async (ctx, { callId }) => {
    const { row, conn, checkId } = await openState(ctx);
    const call = callId ? await ctx.db.get(callId) : null;
    return { prefs: prefsOf(row), hasRow: !!row, checkId, writeId: conn?.calendarId ?? null, call, business: (await businessContact(ctx, call?.businessId ?? row?.businessId ?? null)).name };
  },
});
export const saveBusy = internalMutation({
  args: { at: v.number(), s: v.number(), e: v.number(), spans: v.array(v.object({ s: v.number(), e: v.number() })), error: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const row = await settingsRow(ctx);
    if (!row) return;
    if (a.error) { await ctx.db.patch(row._id, { readingAt: undefined, busy: { ...(row.busy ?? { at: 0, s: a.s, e: a.e, spans: [] }), error: a.error.slice(0, 200) } }); return; }
    await ctx.db.patch(row._id, { readingAt: undefined, busy: { at: a.at, s: a.s, e: a.e, spans: a.spans.slice(0, 3000) } });
  },
});

type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any; text: string }>;
async function busyBetween(call: Call, calendarId: string, s: number, e: number): Promise<Array<Span & { id?: string }>> {
  const out: Array<Span & { id?: string }> = [];
  let page: string | undefined;
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ timeMin: new Date(s).toISOString(), timeMax: new Date(e).toISOString(), singleEvents: "true", maxResults: "2500", showDeleted: "false", ...(page ? { pageToken: page } : {}) });
    const r = await call("GET", `/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
    if (r.status !== 200) throw new Error(`${r.status}: ${r.json?.error?.message ?? r.text.slice(0, 120)}`);
    const items = (r.json?.items ?? []) as Array<{ id?: string } & Parameters<typeof busyFrom>[0][number]>;
    for (const it of items) for (const sp of busyFrom([it], momentOf)) out.push({ ...sp, id: it.id });
    page = r.json?.nextPageToken;
    if (!page) break;
  }
  return out;
}

/** Reads what's busy on the checked calendar for the whole bookable window. */
export const readBusy = internalAction({
  args: {},
  handler: async (ctx): Promise<string> => {
    scopedAction(ctx);
    const d = await ctx.runQuery(internal.calls.readInputs, {});
    if (!d.hasRow || !d.checkId) return "off";
    const now = Date.now();
    const w = window(d.prefs, now);
    try {
      const call = await google(ctx);
      const spans = (await busyBetween(call, d.checkId, w.s, w.e)).map(({ s, e }) => ({ s, e }));
      await ctx.runMutation(internal.calls.saveBusy, { at: now, s: w.s, e: w.e, spans });
      return "ok";
    } catch (e) {
      await ctx.runMutation(internal.calls.saveBusy, { at: now, s: w.s, e: w.e, spans: [], error: e instanceof Disconnected ? "Google Calendar isn't connected." : String((e as Error).message) });
      return "failed";
    }
  },
});

const overlaps = (a: Span, b: Span) => a.s < b.e && b.s < a.e;

/** A held time: read Google once more for it; then book it (event with a Meet link, the lead invited) or say taken. */
export const confirm = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }): Promise<string> => {
    scopedAction(ctx);
    const d = await ctx.runQuery(internal.calls.readInputs, { callId });
    const c = d.call;
    if (!c || c.status !== "holding") return "skipped";
    const guard = { s: c.start - d.prefs.bufferMin * 60_000, e: c.end + d.prefs.bufferMin * 60_000 };
    let call: Call;
    try { call = await google(ctx); } catch (e) {
      await ctx.runMutation(internal.calls.booked, { callId, error: e instanceof Disconnected ? "Google Calendar isn't connected." : String((e as Error).message) });
      return "booked without calendar";
    }
    try {
      if (d.checkId && (await busyBetween(call, d.checkId, guard.s, guard.e)).some((b) => overlaps(guard, b))) {
        await ctx.runMutation(internal.calls.taken, { callId });
        return "taken";
      }
    } catch { /* couldn't read: the time was free a few minutes ago, so it's booked */ }
    if (!d.writeId) { await ctx.runMutation(internal.calls.booked, { callId, error: "No calendar picked in Settings › Calendar." }); return "booked without calendar"; }
    // Review H1: Google sends this invite from the owner's account to an address nobody has checked, so nothing the lead
    // typed goes in it (their name and note stay in the portal and email 52).
    const body = {
      id: callEventId(callId),
      summary: `Call with ${d.business}`,
      description: `Booked on the ${d.business} booking page. The lead's details are in Wrangler Portal.`,
      start: { dateTime: new Date(c.start).toISOString(), timeZone: TZ }, end: { dateTime: new Date(c.end).toISOString(), timeZone: TZ },
      attendees: [{ email: c.email, displayName: c.name }],
      conferenceData: { createRequest: { requestId: `call-${callId}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
      guestsCanModify: false, guestsCanInviteOthers: false,
    };
    try {
      let r = await call("POST", `/calendars/${encodeURIComponent(d.writeId)}/events?conferenceDataVersion=1&sendUpdates=all`, body);
      if (r.status === 409) r = await call("GET", `/calendars/${encodeURIComponent(d.writeId)}/events/${encodeURIComponent(body.id)}`); // a retry: it was made already
      if (r.status >= 300 || !r.json?.id) throw new Error(`${r.status}: ${r.json?.error?.message ?? r.text.slice(0, 120)}`);
      const meet = (r.json.hangoutLink as string | undefined) ?? ((r.json.conferenceData?.entryPoints ?? []) as Array<{ entryPointType?: string; uri?: string }>).find((x) => x.entryPointType === "video")?.uri;
      await ctx.runMutation(internal.calls.booked, { callId, event: { id: String(r.json.id), calendarId: d.writeId }, ...(meet ? { meet } : {}) });
      return "booked";
    } catch (e) {
      await ctx.runMutation(internal.calls.booked, { callId, error: e instanceof Disconnected ? "Google Calendar isn't connected." : String((e as Error).message) });
      return "booked without calendar";
    }
  },
});

export const booked = internalMutation({
  args: { callId: v.id("calls"), event: v.optional(v.object({ id: v.string(), calendarId: v.string() })), meet: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const c = await ctx.db.get(a.callId);
    if (!c) return;
    if (c.status !== "holding") { // let go meanwhile (review L1, M2): the event made for it comes off again
      if (a.event) { await ctx.db.patch(c._id, { event: a.event }); await ctx.scheduler.runAfter(0, internal.calls.dropEvent, { callId: c._id, force: true }); }
      return;
    }
    const now = Date.now();
    await ctx.db.patch(c._id, {
      status: "booked", ...(a.event ? { event: a.event } : {}), ...(a.meet ? { meet: a.meet } : {}), ...(a.error ? { calError: a.error.slice(0, 200) } : {}),
      notice: { kind: "booked", at: now }, history: [...c.history, { at: now, text: a.error ? "Booked (it didn't reach your calendar)" : "Booked" }], updatedAt: now,
    });
    await callLine(ctx, { ...c, ...(a.meet ? { meet: a.meet } : {}) }, "booked");
    await ctx.scheduler.runAfter(0, internal.calls.mail, { callId: c._id, what: "booked", at: now });
  },
});
export const taken = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const c = await ctx.db.get(callId);
    if (!c || c.status !== "holding") return;
    const now = Date.now();
    await ctx.db.patch(c._id, { status: "taken", history: [...c.history, { at: now, text: "The time was taken on the calendar meanwhile" }], updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.calls.readBusy, {});
  },
});

/** A new time for a booked call: read Google for it (its own event doesn't count), then move the event. */
export const confirmMove = internalAction({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }): Promise<string> => {
    scopedAction(ctx);
    const d = await ctx.runQuery(internal.calls.readInputs, { callId });
    const c = d.call;
    if (!c || c.status !== "booked" || !c.moving) return "skipped";
    const to = c.moving;
    const guard = { s: to.start - d.prefs.bufferMin * 60_000, e: to.end + d.prefs.bufferMin * 60_000 };
    try {
      const call = await google(ctx);
      if (d.checkId && (await busyBetween(call, d.checkId, guard.s, guard.e)).some((b) => b.id !== c.event?.id && overlaps(guard, b))) {
        await ctx.runMutation(internal.calls.moved, { callId, taken: true });
        return "taken";
      }
      if (c.event) {
        const r = await call("PATCH", `/calendars/${encodeURIComponent(c.event.calendarId)}/events/${encodeURIComponent(c.event.id)}?sendUpdates=all`, { start: { dateTime: new Date(to.start).toISOString(), timeZone: TZ }, end: { dateTime: new Date(to.end).toISOString(), timeZone: TZ } });
        if (r.status >= 300) throw new Error(`${r.status}: ${r.json?.error?.message ?? r.text.slice(0, 120)}`);
      }
      await ctx.runMutation(internal.calls.moved, { callId });
      return "moved";
    } catch {
      // Review M3: the portal and the calendar must agree: the call stays where it was, and the lead is told to try again.
      await ctx.runMutation(internal.calls.moved, { callId, failed: true });
      return "not moved";
    }
  },
});
export const moved = internalMutation({
  args: { callId: v.id("calls"), taken: v.optional(v.boolean()), failed: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const c = await ctx.db.get(a.callId);
    if (!c || c.status !== "booked" || !c.moving) return;
    const now = Date.now();
    if (a.failed) { await ctx.db.patch(c._id, { moving: undefined, moveFailed: now, updatedAt: now }); return; }
    if (a.taken) {
      await ctx.db.patch(c._id, { moving: undefined, moveTaken: now, updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.calls.readBusy, {});
      return;
    }
    await ctx.db.patch(c._id, {
      was: { start: c.start, end: c.end }, start: c.moving.start, end: c.moving.end, moving: undefined, calError: undefined,
      notice: { kind: "moved", at: now }, history: [...c.history, { at: now, text: `Moved by the lead (was ${centralWhen(c.start)})` }], updatedAt: now,
    });
    if (c.dealId) { const d = await ctx.db.get(c.dealId); if (d) await ctx.db.patch(d._id, { history: [...d.history, { kind: "call", at: now, detail: `Moved their call: ${centralWhen(c.moving.start)}` }], updatedAt: now }); }
    await callLine(ctx, { ...c, start: c.moving.start, end: c.moving.end }, "moved");
    await ctx.scheduler.runAfter(0, internal.calls.mail, { callId: c._id, what: "moved", at: now });
  },
});

/** A cancelled call comes off the calendar (Google tells the lead too). */
export const dropEvent = internalAction({
  args: { callId: v.id("calls"), force: v.optional(v.boolean()) },
  handler: async (ctx, { callId, force }): Promise<string> => {
    scopedAction(ctx);
    const d = await ctx.runQuery(internal.calls.readInputs, { callId });
    if (!d.call || (!force && d.call.status !== "cancelled")) return "nothing";
    const ev = d.call.event ?? (d.writeId ? { id: callEventId(callId), calendarId: d.writeId } : null);
    if (!ev) return "nothing";
    try {
      const call = await google(ctx);
      const r = await call("DELETE", `/calendars/${encodeURIComponent(ev.calendarId)}/events/${encodeURIComponent(ev.id)}?sendUpdates=all`);
      if (r.status >= 300 && r.status !== 404 && r.status !== 410) throw new Error(`${r.status}`);
      return "removed";
    } catch (e) {
      await ctx.runMutation(internal.calls.calFailed, { callId, error: `It didn't come off your calendar: ${String((e as Error).message).slice(0, 120)}` }); // review L5
      return "failed";
    }
  },
});
export const calFailed = internalMutation({
  args: { callId: v.id("calls"), error: v.string() },
  handler: async (ctx, { callId, error }) => { const c = await ctx.db.get(callId); if (c) await ctx.db.patch(c._id, { calError: error.slice(0, 200) }); },
});
/** Review L1: a hold or a move nobody resolved (a job that died) is let go after five minutes. */
export const expire = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const c = await ctx.db.get(callId);
    if (!c) return;
    const now = Date.now();
    if (c.status === "holding" && now - c.createdAt >= HOLD_FOR - 1000) await ctx.db.patch(c._id, { status: "taken", history: [...c.history, { at: now, text: "Not booked: the calendar couldn't be checked" }], updatedAt: now });
    else if (c.moving && now - c.moving.at >= HOLD_FOR - 1000) await ctx.db.patch(c._id, { moving: undefined, moveFailed: now, updatedAt: now });
  },
});

// ---------- emails 43, 52–56 ----------

export const mailData = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const c = await ctx.db.get(callId);
    if (!c) return null;
    const contact = await businessContact(ctx, c.businessId ?? null);
    const biz = c.businessId ? await ctx.db.get(c.businessId) : null;
    return { c, brand: await mailBrandOf(ctx, c.businessId ?? null), ownerEmail: contact.ownerEmail, slug: biz?.slug ?? "", businessId: c.businessId ?? null };
  },
});
export const mail = internalAction({
  args: { callId: v.id("calls"), what: v.union(v.literal("booked"), v.literal("moved"), v.literal("cancelled")), at: v.number() },
  handler: async (ctx, { callId, what, at }): Promise<void> => {
    const d = await ctx.runQuery(internal.calls.mailData, { callId });
    if (!d) return;
    const { c, brand } = d;
    const manage = `${SITE()}/call/${c.token}`;
    const lead = what === "booked" ? callBookedMail(brand, { name: c.name, start: c.start, end: c.end, tz: c.tz, meet: c.meet ?? null, invite: !!c.event, link: manage })
      : what === "moved" ? callMovedMail(brand, { name: c.name, start: c.start, end: c.end, wasStart: c.was?.start ?? c.start, wasEnd: c.was?.end ?? c.end, tz: c.tz, meet: c.meet ?? null, link: manage })
      : callCancelledMail(brand, { name: c.name, start: c.start, end: c.end, tz: c.tz, bookLink: `${SITE()}/book/${d.slug}` });
    await deliverOnce(ctx, `call:${what}:lead:${callId}:${at}`, `call_${what}_lead`, c.email, lead, brand.replyTo, d.businessId);
    const owner = ownerCallMail(brand, { kind: what, who: c.name, email: c.email, start: c.start, end: c.end, ...(what === "moved" && c.was ? { wasStart: c.was.start, wasEnd: c.was.end } : {}), note: what === "booked" ? c.note ?? null : null, onCalendar: !!c.event && !c.calError, link: `${SITE()}/clients/deals/${c.dealId ?? ""}` });
    await deliverOnce(ctx, `call:${what}:owner:${callId}:${at}`, `call_${what}_owner`, d.ownerEmail, owner, c.email, d.businessId);
  },
});

// ---------- the owner ----------

/** Settings › Booking calls. */
export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const { row, conn, open, checkId } = await openState(ctx);
    const mine = (ctx as { scope?: Scope | null }).scope?.owner ?? null;
    const slug = (mine ? await ctx.db.get(mine) : null)?.slug ?? "";
    const list = (conn?.list ?? []).map((c) => ({ id: c.id, name: c.name, primary: c.primary }));
    return {
      prefs: prefsOf(row), saved: !!row, open, link: `${SITE()}/book/${slug}`,
      calendar: conn && !conn.disconnectedAt && hasKeys() ? { email: conn.email, checkId, checkName: list.find((c) => c.id === checkId)?.name ?? conn.calendarName ?? checkId, writeName: conn.calendarName ?? null, list } : null,
      readError: row?.busy?.error ?? null,
    };
  },
});

export const saveSettings = mutation({
  args: { lengthMin: v.number(), bufferMin: v.number(), aheadDays: v.number(), noticeHours: v.number(), hours: v.array(v.object({ on: v.boolean(), start: v.string(), end: v.string() })), calendarId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    let p: CallPrefs;
    try { p = checkPrefs(a); } catch (e) { throw new ConvexError((e as Error).message); }
    const conn = await connection(ctx);
    if (!conn || conn.disconnectedAt) throw new ConvexError("Connect Google Calendar first (Settings › Calendar).");
    const ids = new Set([...(conn.list ?? []).map((c) => c.id), ...(conn.calendarId ? [conn.calendarId] : [])]);
    if (a.calendarId && !ids.has(a.calendarId)) throw new ConvexError("Pick one of your calendars.");
    const row = await settingsRow(ctx);
    const now = Date.now();
    const changedCal = (a.calendarId ?? conn.calendarId) !== (row?.calendarId ?? conn.calendarId);
    const fields = { ...p, ...(a.calendarId ? { calendarId: a.calendarId } : {}), updatedAt: now };
    if (row) await ctx.db.patch(row._id, { ...fields, ...(changedCal ? { busy: undefined } : {}) });
    else await ctx.db.insert("callSettings", fields);
  },
});

/** The lead page's Upcoming call card (and past ones). */
export const forDeal = query({
  args: { dealId: v.string() },
  handler: async (ctx, { dealId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("deals", dealId);
    if (!id) return [];
    const now = Date.now();
    return (await ctx.db.query("calls").withIndex("by_deal", (q) => q.eq("dealId", id)).collect())
      .filter((c) => c.status !== "taken")
      .sort((a, b) => b.start - a.start)
      .map((c) => ({ _id: c._id, start: c.start, end: c.end, status: c.status, meet: c.meet ?? null, onCalendar: !!c.event, calError: c.calError ?? null, upcoming: c.end > now && c.status !== "cancelled", note: c.note ?? null, was: c.was ?? null }));
  },
});

/** Done on the Dashboard's Needs you row. */
export const done = mutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    await requireMe(ctx);
    const c = await ctx.db.get(callId);
    if (!c?.notice || c.notice.doneAt) return;
    await ctx.db.patch(c._id, { notice: { ...c.notice, doneAt: Date.now() } });
  },
});

/** For home.needs: a call booked, moved or cancelled that the owner hasn't marked Done. */
export async function callNeeds(ctx: QueryCtx) {
  const out = [];
  for (const c of await ctx.db.query("calls").withIndex("by_start", (q) => q.gte("start", Date.now() - 7 * 86_400_000)).collect()) {
    if (!c.notice || c.notice.doneAt || c.status === "taken" || c.status === "holding") continue;
    out.push({ kind: "call" as const, at: c.notice.at, callId: c._id, dealId: c.dealId ?? null, who: c.name, what: c.notice.kind, start: c.start, end: c.end, was: c.was?.start ?? null, calError: c.calError ?? null });
  }
  return out;
}
