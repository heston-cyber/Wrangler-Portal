// Phase 4 (Nov 2): shoots (frames S5 · Phase 4: Schedule a shoot 741:2529, the owner's Shoots card 741:1424, the client's
// Coming up card 738:8722 and Shoot page 738:9111 / 738:9492, Inbox 740:2435, emails 29 and 30).
//   - The owner schedules a shoot on a project: date, call, wrap, place, what to prepare, who's coming (them and
//     booked vendors). The project's portal people get an Inbox item and email 29, and confirm it in their portal.
//   - Moving the date, call time or place clears the confirmation and asks again (Inbox, email 30). Other edits
//     (what to prepare, who's coming) just save.
//   - Cancelling takes it off the client's pages with an Inbox line (no email: no frame for one).
//   - "Add to {calendar}" is saved now; the event is made once Settings › Calendar is connected (a later step).
import { internalAction, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe, requireSignedIn } from "./lib/access";
import { businessOf, postToInbox } from "./lib/inbox";
import { myProjects, portalPeople } from "./projects";
import { label } from "./lib/bookingRows";
import { todayCentral } from "./lib/bookings";
import { businessContact } from "./lib/business";
import { mailBrandOf } from "./lib/mail";
import { clock, ownerShootConfirmedMail, shootDay, shootMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { SITE } from "./lib/site";

type Ctx = QueryCtx | MutationCtx;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const tidy = (s: string | undefined, max: number) => (s ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const dot = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);
const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

const fields = {
  date: v.string(), call: v.string(), wrap: v.optional(v.string()), location: v.string(), parking: v.optional(v.string()),
  prepare: v.array(v.string()), withOwner: v.boolean(), bookingIds: v.array(v.id("vendorBookings")), calendar: v.boolean(),
};
type Fields = { date: string; call: string; wrap?: string; location: string; parking?: string; prepare: string[]; withOwner: boolean; bookingIds: Id<"vendorBookings">[]; calendar: boolean };

async function clean(ctx: Ctx, p: Doc<"projects">, a: Fields, ownerName: string) {
  if (!isDay(a.date)) throw new ConvexError("Pick the shoot date.");
  if (!isTime(a.call)) throw new ConvexError("Pick the call time.");
  if (a.wrap && !isTime(a.wrap)) throw new ConvexError("Pick a wrap time, or leave it empty.");
  if (a.wrap && a.wrap <= a.call) throw new ConvexError("Wrap is before the call time.");
  const location = tidy(a.location, 200);
  if (!location) throw new ConvexError("Say where the shoot is.");
  const prepare = a.prepare.map((l) => tidy(l, 200)).filter(Boolean);
  if (prepare.length > 20) throw new ConvexError("Keep what to prepare to 20 lines.");
  const crew: Doc<"shoots">["crew"] = a.withOwner ? [{ name: ownerName, role: "Director", owner: true }] : [];
  for (const id of [...new Set(a.bookingIds)]) {
    const k = await ctx.db.get(id);
    if (!k || k.projectId !== p._id || k.status === "declined" || k.status === "cancelled") throw new ConvexError("One of the crew isn't booked on this project any more.");
    const vendor = await ctx.db.get(k.vendorId);
    crew.push({ name: vendor?.name ?? "A vendor", role: k.role, vendorId: k.vendorId, bookingId: k._id });
  }
  return { date: a.date, call: a.call, ...(a.wrap ? { wrap: a.wrap } : {}), location, ...(tidy(a.parking, 120) ? { parking: tidy(a.parking, 120) } : {}), prepare, crew, calendar: a.calendar };
}

async function ownedProject(ctx: Ctx, projectId: string) {
  const id = ctx.db.normalizeId("projects", projectId);
  const p = id ? await ctx.db.get(id) : null;
  if (!p) throw new ConvexError("This project doesn't exist any more.");
  return p;
}
async function ownedShoot(ctx: Ctx, shootId: Id<"shoots">) {
  const s = await ctx.db.get(shootId);
  if (!s) throw new ConvexError("That shoot isn't here any more.");
  const p = await ctx.db.get(s.projectId);
  if (!p) throw new ConvexError("This project doesn't exist any more.");
  return { s, p };
}
const ownerName = async (ctx: Ctx, p: Doc<"projects">, me?: { name: string | null }) => {
  const biz = await businessOf(ctx, p);
  const b = biz ? await ctx.db.get(biz) : null;
  return b?.ownerName?.trim() || me?.name?.trim() || b?.name || "The director";
};

const view = (s: Doc<"shoots">) => ({
  _id: s._id, date: s.date, call: s.call, wrap: s.wrap ?? null, location: s.location, parking: s.parking ?? null, prepare: s.prepare,
  crew: s.crew.map((c) => ({ name: c.name, role: c.role, owner: !!c.owner, bookingId: c.bookingId ?? null })), status: s.status,
  confirmed: s.confirmed ? { name: s.confirmed.name, at: s.confirmed.at } : null, moved: s.moved ? { date: s.moved.date, call: s.moved.call } : null,
  calendar: !!s.calendar, onCalendar: !!s.calendarEvent,
});

/** Tells the project's portal people: an Inbox item each, and email 29 or 30 (scheduled after the write). */
async function tell(ctx: MutationCtx, p: Doc<"projects">, s: { _id: Id<"shoots">; date: string; call: string; location: string }, moved: Doc<"shoots">["moved"] | null, at: number) {
  const biz = await businessOf(ctx, p);
  if (!biz) return 0;
  const people = await portalPeople(ctx, p);
  const sameCallPlace = moved && moved.call === s.call && moved.location === s.location;
  for (const person of people) {
    await postToInbox(ctx, {
      businessId: biz, clientId: p.clientId, email: person.email, kind: "shoot",
      title: moved ? (moved.date !== s.date ? `Shoot moved: now ${shootDay(s.date)} (was ${shortDay(moved.date)})` : `Shoot changed: ${shootDay(s.date)} · ${clock(s.call)}`) : `Shoot scheduled: ${shootDay(s.date)} · ${clock(s.call)}`,
      text: moved ? (sameCallPlace ? "Same call time and place. Please confirm again." : `${clock(s.call)} call · ${dot(s.location)} Please confirm again.`) : `${dot(s.location)} Please confirm.`,
      link: `/shoots/${s._id}`, linkLabel: "Confirm", source: { module: "schedule", id: s._id }, key: `shoot:${s._id}:${at}`,
    });
  }
  if (people.length) await ctx.scheduler.runAfter(0, internal.shoots.mail, { shootId: s._id, at, emails: people.map((x) => x.email) });
  return people.length;
}

// ---------- the owner ----------

/** The project's Shoots card, and what Schedule a shoot needs (who can come). */
export const forProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const me = await requireMe(ctx);
    const id = ctx.db.normalizeId("projects", projectId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) return null;
    const shoots = (await ctx.db.query("shoots").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).filter((s) => s.status === "scheduled");
    const crew = [];
    for (const k of await ctx.db.query("vendorBookings").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()) {
      if (k.status === "declined" || k.status === "cancelled") continue;
      const vendor = await ctx.db.get(k.vendorId);
      crew.push({ bookingId: k._id, name: vendor?.name ?? "A vendor", role: k.role, start: k.start, end: k.end, status: k.status });
    }
    const people = (await portalPeople(ctx, p)).length;
    return { owner: await ownerName(ctx, p, me), shoots: shoots.map(view), crew, people, today: todayCentral() };
  },
});

export const schedule = mutation({
  args: { projectId: v.string(), ...fields },
  handler: async (ctx, a) => {
    const me = await requireMe(ctx);
    const p = await ownedProject(ctx, a.projectId);
    const f = await clean(ctx, p, a, await ownerName(ctx, p, me));
    if (f.date < todayCentral()) throw new ConvexError("That date has passed.");
    const now = Date.now();
    const shootId = await ctx.db.insert("shoots", { projectId: p._id, ...f, status: "scheduled", history: [{ at: now, text: "Scheduled" }], createdAt: now, updatedAt: now });
    const told = await tell(ctx, p, { _id: shootId, ...f }, null, now);
    return { shootId, told };
  },
});

/** Edit a shoot. A new date, call time or place asks the client to confirm again. */
export const update = mutation({
  args: { shootId: v.id("shoots"), ...fields },
  handler: async (ctx, a) => {
    const me = await requireMe(ctx);
    const { s, p } = await ownedShoot(ctx, a.shootId);
    if (s.status !== "scheduled") throw new ConvexError("That shoot was cancelled.");
    const f = await clean(ctx, p, a, await ownerName(ctx, p, me));
    const moved = f.date !== s.date || f.call !== s.call || f.location !== s.location;
    if (moved && f.date < todayCentral()) throw new ConvexError("That date has passed.");
    const now = Date.now();
    const was = { date: s.date, call: s.call, location: s.location, at: now };
    await ctx.db.patch(s._id, {
      ...f, wrap: f.wrap, parking: f.parking, updatedAt: now,
      ...(moved ? { moved: was, confirmed: undefined } : {}),
      history: [...s.history, { at: now, text: moved ? `Moved from ${shortDay(s.date)} ${clock(s.call)}${f.location !== s.location ? `, ${s.location}` : ""}` : "Details changed" }],
    });
    const told = moved ? await tell(ctx, p, { _id: s._id, ...f }, was, now) : 0;
    return { moved, told };
  },
});

export const cancel = mutation({
  args: { shootId: v.id("shoots") },
  handler: async (ctx, { shootId }) => {
    await requireMe(ctx);
    const { s, p } = await ownedShoot(ctx, shootId);
    if (s.status === "cancelled") return null;
    const now = Date.now();
    await ctx.db.patch(s._id, { status: "cancelled", updatedAt: now, history: [...s.history, { at: now, text: "Cancelled" }] });
    const biz = await businessOf(ctx, p);
    if (biz) for (const person of await portalPeople(ctx, p)) {
      await postToInbox(ctx, { businessId: biz, clientId: p.clientId, email: person.email, kind: "shoot", title: `Shoot cancelled: ${shootDay(s.date)}`,
        text: `${label(p)} · ${s.location}`, link: `/projects/${p._id}`, linkLabel: "Open project", source: { module: "schedule", id: s._id }, key: `shoot:${s._id}:cancelled` });
    }
    return null;
  },
});

// ---------- the client ----------

async function clientShoot(ctx: QueryCtx, shootId: string) {
  const me = await requireSignedIn(ctx);
  if (me.kind !== "client") return null;
  const id = ctx.db.normalizeId("shoots", shootId);
  const s = id ? await ctx.db.get(id) : null;
  if (!s || s.status !== "scheduled") return null;
  const row = (await myProjects(ctx, me.email)).get(s.projectId);
  if (!row) return null;
  const p = row.project;
  const b = p.businessId ? await ctx.db.get(p.businessId) : null;
  if (b?.modules?.projects === false) return null;
  return { me, s, p, b };
}

/** The Coming up card on the client's project page. */
export const forClientProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return [];
    const id = ctx.db.normalizeId("projects", projectId);
    if (!id || !(await myProjects(ctx, me.email)).has(id)) return [];
    const today = todayCentral();
    return (await ctx.db.query("shoots").withIndex("by_project", (q) => q.eq("projectId", id).gte("date", today)).collect())
      .filter((s) => s.status === "scheduled").map((s) => ({ _id: s._id, date: s.date, call: s.call, location: s.location, confirmed: !!s.confirmed }));
  },
});

/** One shoot as its client sees it. */
export const page = query({
  args: { shootId: v.string() },
  handler: async (ctx, { shootId }) => {
    const c = await clientShoot(ctx as QueryCtx, shootId);
    if (!c) return null;
    const contact = await businessContact(ctx, c.p.businessId ?? null);
    return {
      ...view(c.s), project: { _id: c.p._id, label: label(c.p) }, business: c.b?.name ?? contact.name, owner: c.b?.ownerName?.trim() || contact.name,
      replyTo: c.b?.replyTo || contact.ownerEmail, past: c.s.date < todayCentral(),
    };
  },
});

/** "Confirm the shoot": saved with their name and the time; the owner gets a note. */
export const confirm = mutation({
  args: { shootId: v.id("shoots") },
  handler: async (ctx, { shootId }) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") throw new ConvexError("Not allowed.");
    const s = await ctx.db.get(shootId);
    if (!s || s.status !== "scheduled" || !(await myProjects(ctx as unknown as QueryCtx, me.email)).has(s.projectId)) throw new ConvexError("This shoot isn't here any more.");
    if (s.confirmed) return { already: true };
    if (s.date < todayCentral()) throw new ConvexError("That shoot has passed.");
    const now = Date.now();
    const name = (me.name ?? "").trim() || me.email;
    await ctx.db.patch(s._id, { confirmed: { name, email: me.email, at: now }, updatedAt: now, history: [...s.history, { at: now, text: `Confirmed by ${name}` }] });
    await ctx.scheduler.runAfter(0, internal.shoots.mailOwner, { shootId, at: now });
    return { already: false };
  },
});

// ---------- emails ----------

export const mailData = internalQuery({
  args: { shootId: v.id("shoots") },
  handler: async (ctx, { shootId }) => {
    const s = await ctx.db.get(shootId);
    if (!s || s.status !== "scheduled") return null;
    const p = await ctx.db.get(s.projectId);
    if (!p) return null;
    const biz = await businessOf(ctx, p);
    return { s, project: label(p), projectId: p._id, biz, brand: await mailBrandOf(ctx, biz), owner: (await businessContact(ctx, biz)).ownerEmail };
  },
});
export const nameOf = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email.toLowerCase())).first())?.name ?? null,
});
export const mail = internalAction({
  args: { shootId: v.id("shoots"), at: v.number(), emails: v.array(v.string()) },
  handler: async (ctx, { shootId, at, emails }) => {
    const d = await ctx.runQuery(internal.shoots.mailData, { shootId });
    if (!d) return 0;
    const moved = d.s.moved && d.s.moved.at === at ? d.s.moved : null;
    let sent = 0;
    for (const email of emails) {
      const m = shootMail(d.brand, { name: await ctx.runQuery(internal.shoots.nameOf, { email }), project: d.project, date: d.s.date, call: d.s.call, location: d.s.location, moved, link: `${SITE()}/shoots/${shootId}` });
      try {
        if ((await deliverOnce(ctx, `shoot:${shootId}:${at}:${email.toLowerCase()}`, "shoot", email, m, d.brand.replyTo, d.biz)) === "sent") sent++;
        await ctx.runMutation(internal.emails.markInboxEmailed, { key: `shoot:${shootId}:${at}`, email });
      } catch (e) { console.error("shoot email", String((e as Error).message).slice(0, 120)); }
    }
    return sent;
  },
});
export const mailOwner = internalAction({
  args: { shootId: v.id("shoots"), at: v.number() },
  handler: async (ctx, { shootId, at }) => {
    const d = await ctx.runQuery(internal.shoots.mailData, { shootId });
    if (!d?.s.confirmed || !d.owner) return;
    await deliverOnce(ctx, `shoot-confirmed:${shootId}:${at}`, "shoot_confirmed", d.owner, ownerShootConfirmedMail(d.brand, {
      who: d.s.confirmed.name, project: d.project, date: d.s.date, call: d.s.call, link: `${SITE()}/projects/${d.projectId}`,
    }), d.brand.replyTo, d.biz);
  },
});
