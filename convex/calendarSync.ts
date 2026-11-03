// Phase 5b step 5 (Nov 3, D143): Production › Calendar, two-way synced with Google Calendar.
//
// Pull. Each shown Google Calendar (and always the one picked in Settings › Calendar) is read with Google's incremental
// sync: the first read is a full one (from 90 days back, repeating events as single occurrences), then only what
// changed since its `nextSyncToken`; Google answering 410 means the token expired, so that calendar is read in full
// again and anything it no longer has is dropped. A cron pulls every business every 5 minutes; Sync now pulls at once.
// Push. Events made, edited, moved or deleted here are saved first (marked pending) and then written to Google by
// `push`; the portal picks each new event's id itself, so a retry can't make two. Shoots keep their own Phase 4 write
// (calendar.syncShoot); each project's edit dates are written by `pushDates` as all-day events, portal → Google only.
// Conflicts: last write wins. A Google change is taken when its `updated` is later than the portal's last write of
// that event and later than any portal edit still waiting to go; a portal edit made after Google's change wins and is
// written over it.
// No loops. Every write records the `updated` Google answers with; when that same version comes back in a pull it
// matches and nothing happens. A shoot moved in Google is moved in the portal without a write back to Google and
// without any email: the owner gets a Dashboard note instead. Edit dates changed in Google are written back as the
// portal has them.
// Disconnected: when Google refuses the saved sign-in, the connection is marked disconnected; nothing throws, Google's
// events are hidden (not deleted), shoots and edit dates stay, and nothing is written until Reconnect Google.
import { action } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { Disconnected, accessToken, gcal, hasKeys, queueCalendar } from "./calendar";
import { addDays, dateEventId, fromGoogle, isDay, isTime, newEventId, spanError, toGoogle, updatedMs, type Span } from "./lib/gcal";
import { todayCentral } from "./lib/bookings";
import { label } from "./lib/bookingRows";
import { portalPeople } from "./projects";
import { tell } from "./shoots";
import { clock } from "./lib/mails";
import { defaultBusiness } from "./lib/business";

type Ctx = QueryCtx | MutationCtx;
type Row = Doc<"calendarEvents">;
const MIN = 60_000;
const FULL_BACK_DAYS = 90;
const UNDO_MS = 60_000;          // the toast offers Undo for about 8 seconds; the server allows a minute
const SHOOT_MAIL_DELAY = 12_000; // a dragged shoot's email 30 waits out the Undo
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

async function conn(ctx: Ctx) { return await ctx.db.query("calendars").first(); }

/** The calendar list, with the picked calendar on it even before the first pull. */
function calendarsOf(c: Doc<"calendars">) {
  const list = c.list ?? [];
  if (c.calendarId && !list.some((x) => x.id === c.calendarId)) return [{ id: c.calendarId, name: c.calendarName ?? "Your calendar", color: 0, on: true, writable: true, primary: false }, ...list];
  return list;
}
function state(c: Doc<"calendars"> | null): "none" | "disconnected" | "ok" {
  if (!c) return "none";
  return c.disconnectedAt ? "disconnected" : "ok";
}

// ---------- what the pages read ----------

/** Production › Calendar: one stretch of days (a month, a week, the agenda's next days). */
export const range = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    await requireMe(ctx);
    if (!isDay(from) || !isDay(to) || to < from) throw new ConvexError("Pick the days to show.");
    if (to > addDays(from, 100)) to = addDays(from, 100);
    const c = await conn(ctx);
    const cals = c ? calendarsOf(c) : [];
    const on = new Set(cals.filter((x) => x.on).map((x) => x.id));
    const events = [];
    if (c && !c.disconnectedAt) {
      for (const r of await ctx.db.query("calendarEvents").withIndex("by_date", (q) => q.gte("date", addDays(from, -62)).lte("date", to)).collect()) {
        if (r.kind !== "google" || r.endDate < from || !on.has(r.calendarId) || r.pending === "delete") continue;
        events.push({
          _id: r._id, calendarId: r.calendarId, title: r.title, location: r.location ?? null, date: r.date, endDate: r.endDate, start: r.start ?? null, end: r.end ?? null,
          guests: r.guests.map((g) => g.name || g.email), guestEmails: r.guests.map((g) => g.email), recurring: !!r.recurring, readOnly: !!r.readOnly, htmlLink: r.htmlLink ?? null,
          pending: !!r.pending, pushError: r.pushError ?? null, syncedAt: r.syncedAt || null, shootId: r.shootId ?? null, projectId: r.projectId ?? null, canUndo: !!r.prev && Date.now() - r.prev.at < UNDO_MS,
        });
      }
    }
    const shoots = [];
    const people = new Map<string, number>();
    for (const s of await ctx.db.query("shoots").withIndex("by_date", (q) => q.gte("date", from).lte("date", to)).collect()) {
      if (s.status !== "scheduled") continue;
      const p = await ctx.db.get(s.projectId);
      if (!p) continue;
      if (!people.has(p._id)) people.set(p._id, (await portalPeople(ctx, p)).length);
      const client = p.clientId ? (await ctx.db.get(p.clientId))?.name ?? null : null;
      const sheet = await ctx.db.query("callSheets").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).first();
      // Who Google emails about it: the booked vendors (when Settings › Calendar invites them).
      const guests = c?.inviteVendors && s.calendarEvent ? s.crew.filter((m) => m.vendorId).map((m) => m.name) : [];
      shoots.push({
        _id: s._id, projectId: p._id, project: p.name, label: label(p), client, date: s.date, call: s.call, wrap: s.wrap ?? null, location: s.location,
        crew: s.crew.map((m) => m.name), guests, people: people.get(p._id) ?? 0, confirmed: !!s.confirmed, sheetId: sheet?._id ?? null,
        onGoogle: !!s.calendarEvent, syncedAt: s.calendarEvent?.at ?? null, canUndo: !!s.dragUndo && Date.now() - s.dragUndo.at < UNDO_MS,
        movedInGoogle: !!s.googleMove && !s.googleMove.doneAt,
      });
    }
    const dates = [];
    for (const p of await ctx.db.query("projects").collect()) {
      for (const d of p.keyDates ?? []) {
        if (d.date < from || d.date > to || /^shoot$/i.test(d.label.trim())) continue;
        dates.push({ projectId: p._id, project: p.name, label: d.label, date: d.date });
      }
    }
    return {
      today: todayCentral(),
      conn: c ? { state: state(c), email: c.email, lastSyncedAt: c.lastSyncedAt ?? null, disconnectedAt: c.disconnectedAt ?? null, picked: c.calendarId ?? null, keys: hasKeys(),
        calendars: cals.map((x) => ({ id: x.id, name: x.name, color: x.color, on: x.on, writable: x.writable, picked: x.id === c.calendarId })) }
        : { state: "none" as const, email: null, lastSyncedAt: null, disconnectedAt: null, picked: null, keys: hasKeys(), calendars: [] },
      events, shoots: shoots.sort((a, b) => a.date.localeCompare(b.date) || a.call.localeCompare(b.call)), dates,
    };
  },
});

/** New event: projects and upcoming shoots it can be linked to. */
export const linkOptions = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const today = todayCentral();
    const shoots = [];
    for (const s of await ctx.db.query("shoots").withIndex("by_date", (q) => q.gte("date", addDays(today, -7))).take(100)) {
      if (s.status !== "scheduled") continue;
      const p = await ctx.db.get(s.projectId);
      if (p) shoots.push({ _id: s._id, label: `Shoot ${shortDay(s.date)} · ${p.name}` });
    }
    const projects = (await ctx.db.query("projects").order("desc").take(200)).filter((p) => !(p.stage === "delivery" && p.deliveryUnlockedAt)).map((p) => ({ _id: p._id, label: label(p) }));
    return { shoots, projects };
  },
});

// ---------- the show / hide list ----------

export const setShown = mutation({
  args: { calendarId: v.string(), on: v.boolean() },
  handler: async (ctx, { calendarId, on }) => {
    await requireMe(ctx);
    const c = await conn(ctx);
    if (!c) throw new ConvexError("Connect Google Calendar first.");
    const list = calendarsOf(c);
    if (!list.some((x) => x.id === calendarId)) throw new ConvexError("That calendar isn't on your Google account any more.");
    const picked = calendarId === c.calendarId;
    await ctx.db.patch(c._id, { list: list.map((x) => (x.id === calendarId ? { ...x, on, ...(!on && !picked ? { syncToken: undefined, syncedAt: undefined } : {}) } : x)) });
    if (on) await ctx.scheduler.runAfter(0, internal.calendarSync.pull, {});
    else if (!picked) { // hidden: its events aren't kept (the picked one is always kept: shoots and edit dates are on it)
      for (const r of await ctx.db.query("calendarEvents").withIndex("by_google", (q) => q.eq("calendarId", calendarId)).collect()) if (r.kind === "google" && !r.pending) await ctx.db.delete(r._id);
    }
    return null;
  },
});

// ---------- events made, edited, moved and deleted here ----------

const spanArgs = { date: v.string(), endDate: v.string(), start: v.optional(v.string()), end: v.optional(v.string()) };
const eventArgs = { title: v.string(), ...spanArgs, location: v.optional(v.string()), guests: v.array(v.string()), shootId: v.optional(v.string()), projectId: v.optional(v.string()) };
type EventArgs = { title: string; date: string; endDate: string; start?: string; end?: string; location?: string; guests: string[]; shootId?: string; projectId?: string };

async function writable(ctx: MutationCtx) {
  const c = await conn(ctx);
  if (!c || !hasKeys()) throw new ConvexError("Connect Google Calendar first (Settings › Calendar).");
  if (c.disconnectedAt) throw new ConvexError("Google Calendar is disconnected. Reconnect Google, then try again.");
  return c;
}
function cleanSpan(a: Span): Span {
  const s: Span = { date: a.date, endDate: a.endDate || a.date, ...(a.start ? { start: a.start, end: a.end } : {}) };
  const err = spanError(s);
  if (err) throw new ConvexError(err);
  return s;
}
async function cleanEvent(ctx: MutationCtx, a: EventArgs) {
  const title = a.title.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!title) throw new ConvexError("Give the event a title.");
  const span = cleanSpan(a);
  const guests = [...new Set(a.guests.map((g) => g.trim().toLowerCase()).filter(Boolean))];
  const bad = guests.find((g) => !EMAIL.test(g) || g.length > 200);
  if (bad) throw new ConvexError(`“${bad}” isn't an email address.`);
  if (guests.length > 50) throw new ConvexError("Up to 50 guests.");
  const shootId = a.shootId ? ctx.db.normalizeId("shoots", a.shootId) : null;
  if (a.shootId && (!shootId || !(await ctx.db.get(shootId)))) throw new ConvexError("That shoot isn't here any more.");
  const projectId = a.projectId ? ctx.db.normalizeId("projects", a.projectId) : null;
  if (a.projectId && (!projectId || !(await ctx.db.get(projectId)))) throw new ConvexError("That project isn't here any more.");
  return { title, ...span, location: (a.location ?? "").trim().slice(0, 300) || undefined, guests, shootId: shootId ?? undefined, projectId: projectId ?? undefined };
}
async function ownRow(ctx: Ctx, eventId: string) {
  const id = ctx.db.normalizeId("calendarEvents", eventId);
  const r = id ? await ctx.db.get(id) : null;
  if (!r || r.kind !== "google" || r.pending === "delete") throw new ConvexError("That event isn't here any more.");
  if (r.readOnly) throw new ConvexError("You can't change this event here: it's on a calendar you can only read, or someone else's invite.");
  return r;
}

export const create = mutation({
  args: { ...eventArgs, calendarId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const c = await writable(ctx);
    const calendarId = a.calendarId || c.calendarId;
    if (!calendarId) throw new ConvexError("Pick the calendar for new events in Settings › Calendar first.");
    const cal = calendarsOf(c).find((x) => x.id === calendarId);
    if (!cal || !cal.writable) throw new ConvexError("You can't add events to that calendar.");
    const e = await cleanEvent(ctx, a);
    const now = Date.now();
    const id = await ctx.db.insert("calendarEvents", {
      kind: "google", calendarId, googleId: newEventId(), title: e.title, ...(e.location ? { location: e.location } : {}), date: e.date, endDate: e.endDate, ...(e.start ? { start: e.start, end: e.end } : {}),
      guests: e.guests.map((email) => ({ email })), gUpdated: 0, pending: "create", pendingAt: now, sendUpdates: e.guests.length ? "all" : "none", guestsDirty: true,
      ...(e.shootId ? { shootId: e.shootId } : {}), ...(e.projectId ? { projectId: e.projectId } : {}), syncedAt: 0, createdAt: now,
    });
    if (!cal.on) await ctx.db.patch(c._id, { list: calendarsOf(c).map((x) => (x.id === calendarId ? { ...x, on: true } : x)) }); // so it shows
    await ctx.scheduler.runAfter(0, internal.calendarSync.push, { eventId: id });
    return id;
  },
});

/** Edit. `notify`: whether Google emails the guests about the change (asked when it has guests and the time moved). */
export const update = mutation({
  args: { eventId: v.string(), ...eventArgs, notify: v.boolean() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    await writable(ctx);
    const r = await ownRow(ctx, a.eventId);
    const e = await cleanEvent(ctx, a);
    const guestsDirty = JSON.stringify(r.guests.map((g) => g.email).sort()) !== JSON.stringify([...e.guests].sort());
    const now = Date.now();
    await ctx.db.patch(r._id, {
      title: e.title, location: e.location, date: e.date, endDate: e.endDate, start: e.start, end: e.end, shootId: e.shootId, projectId: e.projectId,
      ...(guestsDirty ? { guests: e.guests.map((email) => ({ email, ...(r.guests.find((g) => g.email === email)?.name ? { name: r.guests.find((g) => g.email === email)!.name } : {}) })), guestsDirty: true } : {}),
      pending: r.pending === "create" ? "create" : "update", pendingAt: now, sendUpdates: a.notify || (guestsDirty && e.guests.length) ? "all" : "none", prev: undefined, pushError: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.calendarSync.push, { eventId: r._id });
    return null;
  },
});

/** Drag to move or resize (the expanded view). Undo puts it back. */
export const move = mutation({
  args: { eventId: v.string(), ...spanArgs, notify: v.boolean() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    await writable(ctx);
    const r = await ownRow(ctx, a.eventId);
    const s = cleanSpan(a);
    if (!r.start !== !s.start) throw new ConvexError("Use Edit to change an all-day event to a timed one.");
    const now = Date.now();
    await ctx.db.patch(r._id, {
      date: s.date, endDate: s.endDate, start: s.start, end: s.end, pending: r.pending === "create" ? "create" : "update", pendingAt: now, pushError: undefined,
      sendUpdates: a.notify ? "all" : "none", prev: { date: r.date, endDate: r.endDate, ...(r.start ? { start: r.start, end: r.end } : {}), at: now, notify: a.notify },
    });
    await ctx.scheduler.runAfter(0, internal.calendarSync.push, { eventId: r._id });
    return null;
  },
});

export const undoMove = mutation({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    await requireMe(ctx);
    await writable(ctx);
    const r = await ownRow(ctx, eventId);
    if (!r.prev || Date.now() - r.prev.at > UNDO_MS) throw new ConvexError("It's too late to undo that move. Move it back instead.");
    const now = Date.now();
    await ctx.db.patch(r._id, { date: r.prev.date, endDate: r.prev.endDate, start: r.prev.start, end: r.prev.end, prev: undefined, pending: r.pending === "create" ? "create" : "update", pendingAt: now, sendUpdates: r.prev.notify ? "all" : "none" });
    await ctx.scheduler.runAfter(0, internal.calendarSync.push, { eventId: r._id });
    return null;
  },
});

export const remove = mutation({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    await requireMe(ctx);
    await writable(ctx);
    const r = await ownRow(ctx, eventId);
    // Guests get Google's cancellation (the confirm says so).
    await ctx.db.patch(r._id, { pending: "delete", pendingAt: Date.now(), sendUpdates: r.guests.length ? "all" : "none" });
    await ctx.scheduler.runAfter(0, internal.calendarSync.push, { eventId: r._id });
    return null;
  },
});

// ---------- shoots and edit dates moved on the calendar ----------

/** A shoot dragged to another day or time. As editing the shoot does: its people are asked to confirm again (Inbox,
 *  email 30), held back for the Undo; Google emails its guests only with "Move and notify". */
export const moveShoot = mutation({
  args: { shootId: v.string(), date: v.string(), call: v.string(), wrap: v.optional(v.string()), notify: v.boolean() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("shoots", a.shootId);
    const s = id ? await ctx.db.get(id) : null;
    if (!s || s.status !== "scheduled") throw new ConvexError("That shoot isn't here any more.");
    const p = await ctx.db.get(s.projectId);
    if (!p) throw new ConvexError("This project doesn't exist any more.");
    if (!isDay(a.date) || !isTime(a.call) || (a.wrap && !isTime(a.wrap))) throw new ConvexError("Pick the day and time.");
    if (a.wrap && a.wrap <= a.call) throw new ConvexError("Wrap is before the call time.");
    if (a.date < todayCentral()) throw new ConvexError("That date has passed.");
    if (a.date === s.date && a.call === s.call && (a.wrap ?? null) === (s.wrap ?? null)) return { told: 0 };
    const now = Date.now();
    const was = { date: s.date, call: s.call, location: s.location, at: now };
    const moved = a.date !== s.date || a.call !== s.call;
    await ctx.db.patch(s._id, {
      date: a.date, call: a.call, wrap: a.wrap, updatedAt: now,
      ...(moved ? { moved: was, confirmed: undefined } : {}),
      dragUndo: { at: now, was: { date: s.date, call: s.call, wrap: s.wrap ?? null, moved: s.moved ?? null, confirmed: s.confirmed ?? null, notify: a.notify } },
      history: [...s.history, { at: now, text: moved ? `Moved on the calendar from ${shortDay(s.date)} ${clock(s.call)}` : "Wrap changed on the calendar" }],
    });
    const told = moved ? await tell(ctx, p, { _id: s._id, date: a.date, call: a.call, location: s.location }, was, now, SHOOT_MAIL_DELAY) : 0;
    await queueCalendar(ctx, s._id, a.notify ? "all" : "none");
    return { told };
  },
});

export const undoShoot = mutation({
  args: { shootId: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("shoots", a.shootId);
    const s = id ? await ctx.db.get(id) : null;
    if (!s || s.status !== "scheduled") throw new ConvexError("That shoot isn't here any more.");
    const u = s.dragUndo;
    if (!u || Date.now() - u.at > UNDO_MS) throw new ConvexError("It's too late to undo that move. Move it back instead.");
    const w = u.was as { date: string; call: string; wrap: string | null; moved: Doc<"shoots">["moved"] | null; confirmed: Doc<"shoots">["confirmed"] | null; notify: boolean };
    const now = Date.now();
    await ctx.db.patch(s._id, {
      date: w.date, call: w.call, wrap: w.wrap ?? undefined, moved: w.moved ?? undefined, confirmed: w.confirmed ?? undefined, dragUndo: undefined, updatedAt: now,
      history: [...s.history, { at: now, text: "Move undone" }],
    });
    // The "please confirm again" Inbox items go (their email hasn't left yet, and now won't).
    const p = await ctx.db.get(s.projectId);
    if (p) for (const person of await portalPeople(ctx, p)) {
      const it = await ctx.db.query("inboxItems").withIndex("by_key", (q) => q.eq("key", `shoot:${s._id}:${u.at}:${person.email.toLowerCase()}`)).first();
      if (it) await ctx.db.delete(it._id);
    }
    await queueCalendar(ctx, s._id, w.notify ? "all" : "none");
    return null;
  },
});

/** An edit date dragged to another day (Undo moves it back the same way). Written to Google from here. */
export const moveDate = mutation({
  args: { projectId: v.string(), label: v.string(), from: v.string(), to: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("projects", a.projectId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) throw new ConvexError("This project doesn't exist any more.");
    if (!isDay(a.to)) throw new ConvexError("Pick the day.");
    const dates = [...(p.keyDates ?? [])];
    const i = dates.findIndex((d) => d.label === a.label && d.date === a.from);
    if (i < 0) throw new ConvexError("That date changed meanwhile. Refresh and try again.");
    dates[i] = { label: dates[i].label, date: a.to };
    dates.sort((x, y) => x.date.localeCompare(y.date));
    await ctx.db.patch(p._id, { keyDates: dates, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.calendarSync.pushDates, {});
    return null;
  },
});

// ---------- the Dashboard note for a shoot moved in Google ----------

async function movedShoot(ctx: MutationCtx, shootId: string) {
  const id = ctx.db.normalizeId("shoots", shootId);
  const s = id ? await ctx.db.get(id) : null;
  if (!s?.googleMove) throw new ConvexError("That shoot isn't here any more.");
  return { s, g: s.googleMove };
}
/** Done: the owner told the crew and client themselves (or there was nothing to tell). */
export const shootMoveDone = mutation({
  args: { shootId: v.string() },
  handler: async (ctx, { shootId }) => {
    await requireMe(ctx);
    const { s, g } = await movedShoot(ctx, shootId);
    if (!g.doneAt) await ctx.db.patch(s._id, { googleMove: { ...g, doneAt: Date.now() } });
    return null;
  },
});
/** Ask the client to confirm again: the same Inbox item and email 30 a move made in the portal sends. */
export const askConfirmAgain = mutation({
  args: { shootId: v.string() },
  handler: async (ctx, { shootId }) => {
    await requireMe(ctx);
    const { s, g } = await movedShoot(ctx, shootId);
    if (g.doneAt) return { told: 0 };
    const p = await ctx.db.get(s.projectId);
    if (!p || s.status !== "scheduled") throw new ConvexError("That shoot isn't here any more.");
    const now = Date.now();
    await ctx.db.patch(s._id, { googleMove: { ...g, doneAt: now, told: true }, moved: { date: g.was.date, call: g.was.call, location: g.was.location, at: now }, updatedAt: now });
    return { told: await tell(ctx, p, s, { date: g.was.date, call: g.was.call, location: g.was.location, at: now }, now) };
  },
});

/** For home.ts: shoots moved in Google, not dealt with yet. */
export async function shootMoveNeeds(ctx: QueryCtx) {
  const out = [];
  for (const s of await ctx.db.query("shoots").withIndex("by_date", (q) => q.gte("date", addDays(todayCentral(), -1))).collect()) {
    if (!s.googleMove || s.googleMove.doneAt || s.status !== "scheduled") continue;
    const p = await ctx.db.get(s.projectId);
    if (!p) continue;
    const sheet = await ctx.db.query("callSheets").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).first();
    out.push({ kind: "shootMoved" as const, at: s.googleMove.at, shootId: s._id, projectId: p._id, project: label(p), date: s.date, call: s.call, wasDate: s.googleMove.was.date, wasCall: s.googleMove.was.call,
      people: (await portalPeople(ctx, p)).length, crew: s.crew.filter((m) => !m.owner).length, sheetId: sheet?.status === "sent" ? sheet._id : null });
  }
  return out;
}

// ---------- Sync now and the cron ----------

export const syncNow = action({
  args: {},
  handler: async (ctx): Promise<{ state: string }> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    if (!hasKeys()) throw new ConvexError("Google Calendar isn't set up for the portal yet (the Google sign-in keys go in Convex).");
    return { state: await ctx.runAction(internal.calendarSync.pull, {}) };
  },
});

/** Every business with a Google connection (the cron). Trusted server code: it sees every business. */
export const connections = internalQuery({
  args: {},
  handler: async (ctx) => {
    const def = (await defaultBusiness(ctx))?._id ?? null;
    return (await ctx.db.query("calendars").collect()).filter((c) => !c.disconnectedAt).map((c) => c.businessId ?? def).filter((b): b is Id<"businesses"> => !!b);
  },
});
export const pullAll = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!hasKeys()) return 0;
    const bizs: Array<Id<"businesses">> = await ctx.runQuery(internal.calendarSync.connections, {});
    for (const b of bizs) {
      try { await ctx.runAction(internal.calendarSync.pull, { asBusiness: b }); } catch (e) { console.error("calendar pull", String((e as Error).message).slice(0, 160)); }
    }
    return bizs.length;
  },
});

// ---------- pull ----------

type Slim = {
  id: string; status?: string; summary?: string; location?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string };
  attendees?: Array<{ email: string; name?: string; self?: boolean }>; recurring?: boolean; updated?: string; htmlLink?: string; mine?: boolean; canEdit?: boolean;
  priv?: Record<string, string>;
};
function slim(e: any): Slim {
  return {
    id: String(e.id), status: e.status, summary: typeof e.summary === "string" ? e.summary.slice(0, 200) : undefined, location: typeof e.location === "string" ? e.location.slice(0, 300) : undefined,
    start: e.start ? { date: e.start.date, dateTime: e.start.dateTime } : undefined, end: e.end ? { date: e.end.date, dateTime: e.end.dateTime } : undefined,
    attendees: Array.isArray(e.attendees) ? e.attendees.filter((x: any) => x?.email && !x.resource).slice(0, 60).map((x: any) => ({ email: String(x.email).toLowerCase(), ...(x.displayName ? { name: String(x.displayName).slice(0, 80) } : {}), ...(x.self ? { self: true } : {}) })) : undefined,
    recurring: !!e.recurringEventId, updated: e.updated, htmlLink: typeof e.htmlLink === "string" ? e.htmlLink : undefined,
    mine: !e.organizer || !!e.organizer.self, canEdit: !!e.guestsCanModify,
    priv: e.extendedProperties?.private && typeof e.extendedProperties.private === "object" ? Object.fromEntries(Object.entries(e.extendedProperties.private).filter(([k]) => /^portal/.test(k)).map(([k, x]) => [k, String(x)])) : undefined,
  };
}

export const pull = internalAction({
  args: {},
  handler: async (ctx): Promise<string> => {
    if (!hasKeys()) return "off";
    const c: Doc<"calendars"> | null = await ctx.runQuery(internal.calendar.getConnection, {});
    if (!c) return "off";
    if (c.disconnectedAt) return "disconnected";
    if (!(await ctx.runMutation(internal.calendarSync.lock, {}))) return "busy";
    let result = "ok";
    try {
      const token = await accessToken(ctx);
      const lr = await gcal(token, "GET", "/users/me/calendarList?maxResults=250");
      if (lr.status === 401) { await ctx.runMutation(internal.calendar.markDisconnected, {}); return (result = "disconnected"); }
      if (lr.status !== 200) throw new Error(`calendar list ${lr.status}`);
      const items = (lr.json?.items ?? []).map((x: any) => ({ id: String(x.id), name: String(x.summaryOverride ?? x.summary ?? x.id).slice(0, 120), primary: !!x.primary, writable: x.accessRole === "owner" || x.accessRole === "writer" }));
      const toPull: Array<{ id: string; syncToken?: string }> = await ctx.runMutation(internal.calendarSync.setList, { items });
      for (const cal of toPull) {
        const r = await pullCalendar(ctx, token, cal.id, cal.syncToken);
        if (r === "disconnected") return (result = "disconnected");
      }
      await ctx.runAction(internal.calendarSync.pushDates, {});
      await ctx.runMutation(internal.calendar.patchConnection, { clearError: true });
      return result;
    } catch (e) {
      if (e instanceof Disconnected) return (result = "disconnected");
      result = "failed";
      await ctx.runMutation(internal.calendar.patchConnection, { lastError: `Google Calendar didn't sync: ${String((e as Error).message).slice(0, 160)}` });
      return result;
    } finally {
      await ctx.runMutation(internal.calendarSync.unlock, { ok: result === "ok" });
    }
  },
});

async function pullCalendar(ctx: { runMutation: any }, token: string, calendarId: string, syncToken?: string): Promise<string> {
  let tok = syncToken;
  for (let attempt = 0; attempt < 2; attempt++) {
    const full = !tok;
    const run = Date.now();
    let page: string | undefined;
    for (let n = 0; n < 40; n++) {
      const q = new URLSearchParams({ singleEvents: "true", maxResults: "250" });
      if (full) q.set("timeMin", new Date(Date.now() - FULL_BACK_DAYS * 86_400_000).toISOString()); else q.set("syncToken", tok!);
      if (page) q.set("pageToken", page);
      const r = await gcal(token, "GET", `/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
      if (r.status === 410) { tok = undefined; await ctx.runMutation(internal.calendarSync.saveToken, { calendarId }); break; } // expired: read it in full again
      if (r.status === 401) { await ctx.runMutation(internal.calendar.markDisconnected, {}); return "disconnected"; }
      if (r.status === 404) { await ctx.runMutation(internal.calendarSync.calendarGone, { calendarId }); return "gone"; }
      if (r.status !== 200) throw new Error(`events ${r.status}: ${r.json?.error?.message ?? ""}`);
      await ctx.runMutation(internal.calendarSync.apply, { calendarId, items: (r.json?.items ?? []).map(slim), run: full ? run : undefined });
      page = r.json?.nextPageToken;
      if (page) continue;
      if (full) await ctx.runMutation(internal.calendarSync.sweep, { calendarId, run });
      await ctx.runMutation(internal.calendarSync.saveToken, { calendarId, syncToken: r.json?.nextSyncToken });
      return "ok";
    }
    if (tok) return "ok"; // stopped at the page cap: the next pull carries on with the same token
  }
  return "ok";
}

export const lock = internalMutation({
  args: {},
  handler: async (ctx) => {
    const c = await ctx.db.query("calendars").first();
    if (!c) return false;
    if (c.pullingSince && Date.now() - c.pullingSince < 3 * MIN) return false;
    await ctx.db.patch(c._id, { pullingSince: Date.now() });
    return true;
  },
});
export const unlock = internalMutation({
  args: { ok: v.boolean() },
  handler: async (ctx, { ok }) => {
    const c = await ctx.db.query("calendars").first();
    if (c) await ctx.db.patch(c._id, { pullingSince: undefined, ...(ok ? { lastSyncedAt: Date.now() } : {}) });
  },
});

/** The account's calendars, merged with what's saved. Returns the ones to pull: shown ones and the picked one. */
export const setList = internalMutation({
  args: { items: v.array(v.object({ id: v.string(), name: v.string(), primary: v.boolean(), writable: v.boolean() })) },
  handler: async (ctx, { items }) => {
    const c = await ctx.db.query("calendars").first();
    if (!c) return [];
    const old = new Map((c.list ?? []).map((x) => [x.id, x]));
    const used = new Set((c.list ?? []).map((x) => x.color));
    let next = 0;
    const color = (id: string) => {
      const o = old.get(id);
      if (o) return o.color;
      if (id === c.calendarId && !used.has(0)) { used.add(0); return 0; }
      while (used.has(next)) next++;
      used.add(next);
      return next;
    };
    const list = items.slice(0, 100).map((x) => {
      const o = old.get(x.id);
      return { id: x.id, name: x.name, primary: x.primary, writable: x.writable, color: color(x.id), on: o ? o.on : x.id === c.calendarId, ...(o?.syncToken ? { syncToken: o.syncToken } : {}), ...(o?.syncedAt ? { syncedAt: o.syncedAt } : {}) };
    });
    // A calendar gone from the account: its events go too.
    for (const o of c.list ?? []) if (!list.some((x) => x.id === o.id)) for (const r of await ctx.db.query("calendarEvents").withIndex("by_google", (q) => q.eq("calendarId", o.id)).collect()) if (r.kind === "google") await ctx.db.delete(r._id);
    await ctx.db.patch(c._id, { list });
    return list.filter((x) => x.on || x.id === c.calendarId).map((x) => ({ id: x.id, ...(x.syncToken ? { syncToken: x.syncToken } : {}) }));
  },
});
export const saveToken = internalMutation({
  args: { calendarId: v.string(), syncToken: v.optional(v.string()) },
  handler: async (ctx, { calendarId, syncToken }) => {
    const c = await ctx.db.query("calendars").first();
    if (!c?.list) return;
    await ctx.db.patch(c._id, { list: c.list.map((x) => (x.id === calendarId ? { ...x, syncToken, ...(syncToken ? { syncedAt: Date.now() } : {}) } : x)) });
  },
});
export const calendarGone = internalMutation({
  args: { calendarId: v.string() },
  handler: async (ctx, { calendarId }) => {
    const c = await ctx.db.query("calendars").first();
    if (c?.list) await ctx.db.patch(c._id, { list: c.list.filter((x) => x.id !== calendarId || x.id === c.calendarId) });
    for (const r of await ctx.db.query("calendarEvents").withIndex("by_google", (q) => q.eq("calendarId", calendarId)).collect()) if (r.kind === "google") await ctx.db.delete(r._id);
  },
});
/** After a full read: what Google no longer has goes (not events made here and still on their way to Google). */
export const sweep = internalMutation({
  args: { calendarId: v.string(), run: v.number() },
  handler: async (ctx, { calendarId, run }) => {
    for (const r of await ctx.db.query("calendarEvents").withIndex("by_google", (q) => q.eq("calendarId", calendarId)).collect()) {
      if (r.kind !== "google" || r.pending === "create" || (r.seen ?? 0) >= run) continue;
      await ctx.db.delete(r._id);
    }
  },
});

/** "shoot" + the shoot id in hex (calendar.eventId), back to the id. */
function shootFromEventId(id: string): string | null {
  const m = /^shoot((?:[0-9a-f]{2})+)$/.exec(id);
  if (!m) return null;
  try { return new TextDecoder().decode(new Uint8Array(m[1].match(/../g)!.map((h) => parseInt(h, 16)))); } catch { return null; }
}
const defaultEnd = (call: string) => { const h = Number(call.slice(0, 2)); return h >= 22 ? "23:59" : `${String(h + 2).padStart(2, "0")}${call.slice(2)}`; };

const slimV = v.object({
  id: v.string(), status: v.optional(v.string()), summary: v.optional(v.string()), location: v.optional(v.string()),
  start: v.optional(v.object({ date: v.optional(v.string()), dateTime: v.optional(v.string()) })), end: v.optional(v.object({ date: v.optional(v.string()), dateTime: v.optional(v.string()) })),
  attendees: v.optional(v.array(v.object({ email: v.string(), name: v.optional(v.string()), self: v.optional(v.boolean()) }))),
  recurring: v.optional(v.boolean()), updated: v.optional(v.string()), htmlLink: v.optional(v.string()), mine: v.optional(v.boolean()), canEdit: v.optional(v.boolean()),
  priv: v.optional(v.record(v.string(), v.string())),
});

/** One page of Google's answer. */
export const apply = internalMutation({
  args: { calendarId: v.string(), items: v.array(slimV), run: v.optional(v.number()) },
  handler: async (ctx, { calendarId, items, run }) => {
    const c = await ctx.db.query("calendars").first();
    if (!c) return;
    const writableCal = calendarsOf(c).find((x) => x.id === calendarId)?.writable ?? true;
    const now = Date.now();
    for (const it of items) {
      const up = updatedMs(it.updated) || (it.status === "cancelled" ? now : 0); // a deletion may come with only its id
      const row = await ctx.db.query("calendarEvents").withIndex("by_google", (q) => q.eq("calendarId", calendarId).eq("googleId", it.id)).first();
      const shootRef = it.priv?.portalShoot ?? (it.status === "cancelled" ? shootFromEventId(it.id) : null);
      if (shootRef) { await applyShoot(ctx, calendarId, it, shootRef, up); continue; }
      if (it.status === "cancelled") {
        if (!row) continue;
        if (row.pending && row.pending !== "delete" && (row.pendingAt ?? 0) > up && up) continue; // edited here after: the write finds it gone
        await ctx.db.delete(row._id); // an edit date comes back with the next pushDates (portal → Google only)
        continue;
      }
      if (it.priv?.portalDate || row?.kind === "date") {
        // An edit date: Google's changes don't come back. Changed there → written again as the portal has it.
        if (row) { if (up > row.gUpdated) await ctx.db.patch(row._id, { sig: "", gUpdated: up }); }
        else if (it.priv?.portalDate) {
          const span = fromGoogle(it.start, it.end);
          const pid = ctx.db.normalizeId("projects", it.priv.portalDate);
          await ctx.db.insert("calendarEvents", { kind: "date", calendarId, googleId: it.id, title: it.summary ?? "", date: span?.date ?? "1970-01-01", endDate: span?.endDate ?? "1970-01-01", guests: [], gUpdated: up, sig: "", dateKey: it.priv.portalDateKey ?? "", ...(pid ? { projectId: pid } : {}), syncedAt: now, createdAt: now });
        }
        continue;
      }
      const span = fromGoogle(it.start, it.end);
      if (!span) continue;
      if (row) {
        if (row.pending && (row.pendingAt ?? 0) >= up) { if (run) await ctx.db.patch(row._id, { seen: run }); continue; } // the portal's later edit wins (its write is on its way)
        if (up <= row.gUpdated) { if (run && row.seen !== run) await ctx.db.patch(row._id, { seen: run }); continue; } // our own write coming back, or nothing new
      }
      const guests = (it.attendees ?? []).filter((a) => !a.self).map((a) => ({ email: a.email, ...(a.name ? { name: a.name } : {}) }));
      const fields = {
        title: it.summary?.trim() || "(No title)", location: it.location?.trim() || undefined, date: span.date, endDate: span.endDate, start: span.start, end: span.end, guests,
        recurring: it.recurring || undefined, readOnly: !writableCal || (it.mine === false && !it.canEdit) || undefined, htmlLink: it.htmlLink, gUpdated: up, syncedAt: now,
        ...(run ? { seen: run } : {}),
      };
      if (row) await ctx.db.patch(row._id, { ...fields, pending: undefined, pendingAt: undefined, prev: undefined, guestsDirty: undefined, pushError: undefined });
      else await ctx.db.insert("calendarEvents", { kind: "google", calendarId, googleId: it.id, ...fields, createdAt: now });
    }
  },
});

async function applyShoot(ctx: MutationCtx, calendarId: string, it: { id: string; status?: string; location?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string } }, shootRef: string, up: number) {
  const id = ctx.db.normalizeId("shoots", shootRef);
  const s = id ? await ctx.db.get(id) : null;
  if (!s || s.status !== "scheduled" || !s.calendarEvent || s.calendarEvent.id !== it.id) return; // not (or no longer) this shoot's event: the portal tidies it
  const ev = s.calendarEvent;
  if (ev.updated && up <= ev.updated) return; // the portal's own write coming back
  const now = Date.now();
  if (s.updatedAt > up) { await queueCalendar(ctx, s._id); return; } // changed here after Google: the portal's version is written over it
  if (it.status === "cancelled") {
    // Deleted in Google: it comes off the calendar (unticked); the shoot itself stays.
    await ctx.db.patch(s._id, { calendar: false, calendarEvent: undefined, updatedAt: now, history: [...s.history, { at: now, text: "Taken off Google Calendar (deleted there)" }] });
    return;
  }
  const span = fromGoogle(it.start, it.end);
  if (!span) return;
  const call = span.start ?? s.call;
  let wrap = span.start ? span.end : s.wrap;
  if (span.start && !s.wrap && wrap === defaultEnd(call)) wrap = undefined; // the end the portal adds when there's no wrap
  if (wrap && wrap <= call) wrap = undefined;
  const location = it.location?.trim() ? it.location.trim().slice(0, 200) : s.location;
  const record = { ...ev, calendarId, updated: up, at: now };
  const moved = span.date !== s.date || call !== s.call || location !== s.location;
  if (!moved && (wrap ?? null) === (s.wrap ?? null)) { await ctx.db.patch(s._id, { calendarEvent: record }); return; }
  const was = { date: s.date, call: s.call, ...(s.wrap ? { wrap: s.wrap } : {}), location: s.location };
  await ctx.db.patch(s._id, {
    date: span.date, call, wrap, location, calendarEvent: record, updatedAt: now,
    ...(moved ? { moved: { date: s.date, call: s.call, location: s.location, at: now }, confirmed: undefined, googleMove: { at: now, was: s.googleMove && !s.googleMove.doneAt ? s.googleMove.was : was } } : {}),
    history: [...s.history, { at: now, text: moved ? `Moved in Google Calendar from ${shortDay(s.date)} ${clock(s.call)}${location !== s.location ? `, ${s.location}` : ""}` : "Wrap changed in Google Calendar" }],
  });
}

// ---------- push ----------

export const rowFor = internalQuery({ args: { eventId: v.id("calendarEvents") }, handler: async (ctx, { eventId }) => ctx.db.get(eventId) });

export const push = internalAction({
  args: { eventId: v.id("calendarEvents") },
  handler: async (ctx, { eventId }): Promise<string> => {
    const r: Row | null = await ctx.runQuery(internal.calendarSync.rowFor, { eventId });
    if (!r || !r.pending) return "nothing";
    const c: Doc<"calendars"> | null = await ctx.runQuery(internal.calendar.getConnection, {});
    if (!hasKeys() || !c || c.disconnectedAt) { await ctx.runMutation(internal.calendarSync.pushFailed, { eventId, pendingAt: r.pendingAt ?? 0, error: "Google Calendar is disconnected." }); return "disconnected"; }
    try {
      const token = await accessToken(ctx);
      const path = (id?: string) => `/calendars/${encodeURIComponent(r.calendarId)}/events${id ? `/${encodeURIComponent(id)}` : ""}?sendUpdates=${r.sendUpdates ?? "none"}`;
      if (r.pending === "delete") {
        const d = await gcal(token, "DELETE", path(r.googleId));
        if (d.status >= 300 && d.status !== 404 && d.status !== 410) throw new Error(`${d.status}: ${d.json?.error?.message ?? ""}`);
        await ctx.runMutation(internal.calendarSync.gone, { eventId });
        return "deleted";
      }
      const body: Record<string, unknown> = { summary: r.title, location: r.location ?? "", ...toGoogle(r), status: "confirmed" };
      if (r.guestsDirty || r.pending === "create") body.attendees = r.guests.map((g) => ({ email: g.email }));
      if (r.pending === "create") {
        const priv: Record<string, string> = { portalEvent: "1" };
        if (r.shootId) priv.portalLinkShoot = String(r.shootId);
        if (r.projectId) priv.portalLinkProject = String(r.projectId);
        body.extendedProperties = { private: priv };
      }
      let w = r.pending === "create" ? await gcal(token, "POST", path(), { ...body, id: r.googleId }) : await gcal(token, "PATCH", path(r.googleId), body);
      if (w.status === 409) w = await gcal(token, "PATCH", path(r.googleId), body); // a retried create: it's there already
      if (r.pending !== "create" && (w.status === 404 || w.status === 410)) { await ctx.runMutation(internal.calendarSync.gone, { eventId }); return "gone"; } // deleted in Google first
      if (w.status === 401) { await ctx.runMutation(internal.calendar.markDisconnected, {}); throw new Disconnected("401"); }
      if (w.status >= 300 || !w.json?.id) throw new Error(`${w.status}: ${w.json?.error?.message ?? w.text.slice(0, 120)}`);
      await ctx.runMutation(internal.calendarSync.pushed, { eventId, pendingAt: r.pendingAt ?? 0, updated: updatedMs(w.json.updated) || Date.now(), htmlLink: typeof w.json.htmlLink === "string" ? w.json.htmlLink : undefined });
      return "written";
    } catch (e) {
      await ctx.runMutation(internal.calendarSync.pushFailed, { eventId, pendingAt: r.pendingAt ?? 0, error: e instanceof Disconnected ? "Google Calendar is disconnected." : String((e as Error).message).slice(0, 200) });
      return "failed";
    }
  },
});
export const pushed = internalMutation({
  args: { eventId: v.id("calendarEvents"), pendingAt: v.number(), updated: v.number(), htmlLink: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.eventId);
    if (!r) return;
    const same = (r.pendingAt ?? 0) === a.pendingAt; // nothing newer waiting (a newer edit has its own push queued)
    await ctx.db.patch(r._id, { gUpdated: Math.max(r.gUpdated, a.updated), syncedAt: Date.now(), pushError: undefined, ...(a.htmlLink ? { htmlLink: a.htmlLink } : {}), ...(same ? { pending: undefined, pendingAt: undefined, guestsDirty: undefined } : r.pending === "create" ? { pending: "update" as const } : {}) });
  },
});
export const pushFailed = internalMutation({
  args: { eventId: v.id("calendarEvents"), pendingAt: v.number(), error: v.string() },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.eventId);
    if (r && (r.pendingAt ?? 0) === a.pendingAt) await ctx.db.patch(r._id, { pushError: a.error });
  },
});
export const gone = internalMutation({ args: { eventId: v.id("calendarEvents") }, handler: async (ctx, { eventId }) => { if (await ctx.db.get(eventId)) await ctx.db.delete(eventId); } });

// ---------- edit dates → Google (all day, portal → Google only) ----------

/** What should be on the picked calendar, against what the portal wrote before. */
export const datesPlan = internalQuery({
  args: {},
  handler: async (ctx) => {
    const c = await ctx.db.query("calendars").first();
    if (!c?.calendarId || c.disconnectedAt) return null;
    const calendarId = c.calendarId;
    const from = addDays(todayCentral(), -30);
    const wanted = new Map<string, { googleId: string; projectId: Id<"projects">; dateKey: string; title: string; date: string; sig: string }>();
    const exists = new Set<string>();
    for (const p of await ctx.db.query("projects").collect()) {
      const seen = new Map<string, number>();
      for (const d of p.keyDates ?? []) {
        if (/^shoot$/i.test(d.label.trim())) continue;
        const base = d.label.trim().toLowerCase();
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        const dateKey = n === 1 ? base : `${base}#${n}`;
        const googleId = dateEventId(p._id, dateKey);
        exists.add(googleId);
        if (d.date < from) continue;
        const title = `${d.label} · ${p.name}`;
        wanted.set(googleId, { googleId, projectId: p._id, dateKey, title, date: d.date, sig: `${calendarId}|${title}|${d.date}` });
      }
    }
    const upserts: Array<{ googleId: string; projectId: Id<"projects">; dateKey: string; title: string; date: string; sig: string; oldCalendarId?: string }> = [];
    const deletes: Array<{ rowId: Id<"calendarEvents">; googleId: string; calendarId: string }> = [];
    const have = new Set<string>();
    for (const r of await ctx.db.query("calendarEvents").withIndex("by_kind", (q) => q.eq("kind", "date")).collect()) {
      const w = wanted.get(r.googleId);
      if (w && !have.has(r.googleId)) {
        have.add(r.googleId);
        if (r.sig !== w.sig || r.calendarId !== calendarId) upserts.push({ ...w, ...(r.calendarId !== calendarId ? { oldCalendarId: r.calendarId } : {}) });
        if (r.calendarId !== calendarId) deletes.push({ rowId: r._id, googleId: r.googleId, calendarId: r.calendarId });
        continue;
      }
      // Not wanted: a date removed (or a project gone). One that has only gone by stays on the calendar.
      if (exists.has(r.googleId) && r.date < from && r.calendarId === calendarId) continue;
      deletes.push({ rowId: r._id, googleId: r.googleId, calendarId: r.calendarId });
    }
    for (const [id, w] of wanted) if (!have.has(id)) upserts.push(w);
    return { calendarId, upserts, deletes };
  },
});

export const pushDates = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    if (!hasKeys()) return 0;
    const plan: { calendarId: string; upserts: Array<{ googleId: string; projectId: Id<"projects">; dateKey: string; title: string; date: string; sig: string }>; deletes: Array<{ rowId: Id<"calendarEvents">; googleId: string; calendarId: string }> } | null = await ctx.runQuery(internal.calendarSync.datesPlan, {});
    if (!plan || (!plan.upserts.length && !plan.deletes.length)) return 0;
    let token: string;
    try { token = await accessToken(ctx); } catch { return 0; }
    let n = 0;
    try {
      for (const d of plan.deletes) {
        const r = await gcal(token, "DELETE", `/calendars/${encodeURIComponent(d.calendarId)}/events/${encodeURIComponent(d.googleId)}?sendUpdates=none`);
        if (r.status >= 300 && r.status !== 404 && r.status !== 410) throw new Error(`delete ${r.status}`);
        await ctx.runMutation(internal.calendarSync.gone, { eventId: d.rowId });
        n++;
      }
      for (const u of plan.upserts.slice(0, 200)) {
        const path = (id?: string) => `/calendars/${encodeURIComponent(plan.calendarId)}/events${id ? `/${encodeURIComponent(id)}` : ""}?sendUpdates=none`;
        const body = {
          summary: u.title, ...toGoogle({ date: u.date, endDate: u.date }), transparency: "transparent", status: "confirmed",
          description: "An edit date from Wrangler Portal. Change it in the portal: changes made here are put back.",
          extendedProperties: { private: { portalDate: String(u.projectId), portalDateKey: u.dateKey } },
        };
        let r = await gcal(token, "PATCH", path(u.googleId), body);
        if (r.status === 404 || r.status === 410) r = await gcal(token, "POST", path(), { ...body, id: u.googleId });
        if (r.status === 409) r = await gcal(token, "PATCH", path(u.googleId), body);
        if (r.status >= 300 || !r.json?.id) throw new Error(`${r.status}: ${r.json?.error?.message ?? ""}`);
        await ctx.runMutation(internal.calendarSync.datePushed, { calendarId: plan.calendarId, googleId: u.googleId, projectId: u.projectId, dateKey: u.dateKey, title: u.title, date: u.date, sig: u.sig, updated: updatedMs(r.json.updated) || Date.now(), htmlLink: typeof r.json.htmlLink === "string" ? r.json.htmlLink : undefined });
        n++;
      }
    } catch (e) {
      if (!(e instanceof Disconnected)) await ctx.runMutation(internal.calendar.patchConnection, { lastError: `An edit date didn't reach your calendar: ${String((e as Error).message).slice(0, 160)}` });
    }
    return n;
  },
});
export const datePushed = internalMutation({
  args: { calendarId: v.string(), googleId: v.string(), projectId: v.id("projects"), dateKey: v.string(), title: v.string(), date: v.string(), sig: v.string(), updated: v.number(), htmlLink: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const now = Date.now();
    const fields = { kind: "date" as const, calendarId: a.calendarId, googleId: a.googleId, projectId: a.projectId, dateKey: a.dateKey, title: a.title, date: a.date, endDate: a.date, guests: [], gUpdated: a.updated, sig: a.sig, syncedAt: now, ...(a.htmlLink ? { htmlLink: a.htmlLink } : {}) };
    const row = await ctx.db.query("calendarEvents").withIndex("by_google", (q) => q.eq("calendarId", a.calendarId).eq("googleId", a.googleId)).first();
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("calendarEvents", { ...fields, createdAt: now });
  },
});

