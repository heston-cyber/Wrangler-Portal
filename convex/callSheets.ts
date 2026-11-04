// Phase 5b step 3 (Nov 3) · call sheets (D126; S5 · Phase 5b: List 765:2852, Empty 771:6965, Templates 765:3564,
// New 765:4235, Questions 766:2956 … 766:5581, Editor 765:2056, Detail 766:6342, phone 769:7589, Send 766:6190,
// Add a guest 766:6270, emails 40 768:6432 and 42 768:6484).
//   - One call sheet per shoot, written in the Docs builder (a wsBuilds row of kind "callsheet"), from a saved template,
//     a blank page, or the five-step quick questionnaire that fills a template.
//   - Who gets it: crew (vendors booked on the project for that day), the client's people (their portal people), and
//     guests (D127). Step 4: a guest gets email 41 with their own link, signs in with an emailed code (guests.ts), and
//     reads only the sheets they're on while each is active (lib/guests.ts); the owner can end their access by hand.
//   - Send, Remind and Send an update are the owner's own clicks. Send freezes the copy everyone reads; email 40 goes to
//     each person once; opening it in the portal is recorded per person; Remind goes only to people who haven't opened
//     it; Send an update freezes the new copy and sends email 42 once per person per update.
//   - Readers: a client person (client side, /call-sheets/<id>) or a booked vendor (vendor side, vendorPortal.ts), each
//     only for a sheet that was sent to them, on a project or booking they still have.
import { focusBusiness, internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
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
import { callSheetMail, callSheetUpdateMail, guestCallSheetMail } from "./lib/mails";
import { addPass, dropPasses, hasOwnLogin, ownLoginHere, projectClosed, sheetBusiness } from "./lib/guests";
import { defaultBusiness } from "./lib/business";
import { deliverOnce } from "./invoiceReminders";
import { SITE } from "./lib/site";
import { defaultStyle, insertBuild } from "./builder";
import { randomToken } from "./lib/hash";
import { fieldValues, newId, nodesOf, pageOf, type BuildDoc, type ExtraSigner, type Fields, type Page, type Style } from "./lib/wsBuilder";
import {
  STARTER_TEMPLATES, WEATHER_DAYS, addDay, bakeWeather, callFor, callSheetProblems, clockOf, daysBetween, defaultAnswers, fillSheet, locationOf, migrateWeather, rowsOf, samePage,
  sheetDay, sheetDayLong, sheetFields, weatherAddress, weatherLine, weatherOf, weatherView, whatChanged,
  type Answers, type ContactRow, type CrewRow, type LocationAttrs, type ScheduleRow, type WeatherView,
} from "./lib/callSheet";
import { forecast, geocode } from "./lib/weather";

type Ctx = QueryCtx | MutationCtx;
type Sheet = Doc<"callSheets">;
type Person = Sheet["recipients"][number];
const MAX_PEOPLE = 80;
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const tidy = (s: string | undefined | null, max: number) => (s ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const by = (me: { name?: string | null; email: string }) => me.name || me.email;
const hist = (cs: Sheet, kind: string, me: { name?: string | null; email: string } | null, detail?: string) =>
  [...cs.history, { at: Date.now(), kind, ...(me ? { by: by(me) } : {}), ...(detail ? { detail: detail.slice(0, 200) } : {}) }].slice(-80);
const openBooking = (k: Doc<"vendorBookings"> | null) => !!k && (k.status === "offered" || k.status === "accepted");
/** A booking that puts this vendor on this shoot: still open, and named on the shoot or covering its day. */
const coversShoot = (k: Doc<"vendorBookings"> | null, s: Doc<"shoots">) =>
  !!k && openBooking(k) && (s.crew.some((c) => String(c.bookingId ?? "") === String(k._id)) || (k.start <= s.date && s.date <= k.end));

// ---------- the shoot, and who can be on its sheet ----------

export async function shootOf(ctx: Ctx, shootId: Id<"shoots">) {
  const s = await ctx.db.get(shootId);
  const p = s ? await ctx.db.get(s.projectId) : null;
  if (!s || !p) return null;
  const client = p.clientId ? (await ctx.db.get(p.clientId))?.name ?? null : null;
  return { s, p, client, title: client ? `${p.name} · ${client}` : label(p) };
}

type Candidate = Omit<Person, "on" | "addedAt"> & { access: boolean; note: string | null };
/** Crew: vendors booked on the project for the shoot's day (or named on the shoot). Client people: the project's
 *  client's people; only those who can open the project in the portal can read the sheet. */
async function candidates(ctx: Ctx, s: Doc<"shoots">, p: Doc<"projects">): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const k of await ctx.db.query("vendorBookings").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()) {
    if (!coversShoot(k, s)) continue;
    const vendor = await ctx.db.get(k.vendorId);
    if (!vendor || vendor.archivedAt) continue;
    const access = !!vendor.invitedAt;
    out.push({ id: `crew:${k._id}`, kind: "crew", name: vendor.name, email: vendor.email.toLowerCase(), role: k.role, vendorId: vendor._id, bookingId: k._id,
      access, note: access ? `Booked for ${sheetDay(s.date).replace(/^\w+ /, "")}` : "Not invited to the portal yet" });
  }
  if (p.clientId) {
    const live = new Set((await portalPeople(ctx, p)).map((x) => x.email.toLowerCase()));
    const people = (await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", p.clientId!)).collect()).filter((x) => !x.removedAt);
    for (const x of people) {
      const email = x.email.toLowerCase();
      if (out.some((o) => o.email === email)) continue;
      const user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).first();
      const access = live.has(email);
      out.push({ id: `client:${email}`, kind: "client", name: x.name || user?.name || email, email, role: x.role === "signer" ? "Main contact" : "Contact",
        access, note: access ? (x.role === "signer" ? "Main contact" : null) : "Can't open this project in the portal yet" });
    }
  }
  return out;
}

/** The stored list plus anyone new (unticked), with whether each can read it in the portal. */
async function peopleOf(ctx: Ctx, cs: Sheet, s: Doc<"shoots">, p: Doc<"projects">) {
  const cands = await candidates(ctx, s, p);
  const byId = new Map(cands.map((c) => [c.id, c]));
  const out: Array<Person & { access: boolean; note: string | null }> = [];
  for (const r of cs.recipients) {
    const c = byId.get(r.id);
    if (r.kind === "guest") { out.push({ ...r, ...(await guestAccess(ctx, cs, r, s, p)) }); continue; }
    out.push({ ...r, access: !!c?.access, note: c ? c.note : r.kind === "crew" ? "No longer booked for this day" : "No longer one of the client's people" });
  }
  for (const c of cands) if (!cs.recipients.some((r) => r.id === c.id)) out.push({ ...c, on: false, addedAt: 0 });
  return out;
}

/** Step 4 (D127): whether a guest can have this sheet. Never an email with a login of its own (it keeps that login and
 *  gets no guest powers); not after the owner ended it; not once the shoot is over or cancelled, or the project closed. */
async function guestAccess(ctx: Ctx, cs: Sheet, r: Person, s: Doc<"shoots">, p: Doc<"projects">): Promise<{ access: boolean; note: string | null }> {
  if (await hasOwnLogin(ctx.db, r.email)) {
    // Review L1: say why only for a login with this business; anything else gets the same neutral note.
    const here = await ownLoginHere(ctx.db, r.email, await sheetBusiness(ctx, cs), (await defaultBusiness(ctx))?._id ?? null);
    return { access: false, note: here ? "Has their own portal login: add them as crew or a client person instead" : "Can't get a guest link" };
  }
  if (r.endedAt) return { access: false, note: "Access ended" };
  if (s.status !== "scheduled") return { access: false, note: "The shoot was cancelled" };
  if (s.date < todayCentral()) return { access: false, note: "The shoot is over" };
  if (projectClosed(p)) return { access: false, note: "The project is closed" };
  return { access: true, note: null };
}

const firstOn = <T extends { on: boolean }>(people: T[]) => people.filter((x) => x.on);
/** Who it actually goes to: ticked, and able to read it (crew and client people in the portal, guests by their link). */
const reachable = <T extends Person & { access: boolean }>(people: T[]) => people.filter((x) => x.on && x.access);

async function businessPhone(ctx: Ctx) {
  const row = await ctx.db.query("wsProfile").first();
  return String((row?.business as { phone?: string } | undefined)?.phone ?? "");
}
async function ownerName(ctx: Ctx, p: Doc<"projects">, me?: { name: string | null }) {
  const biz = await businessOf(ctx, p);
  const b = biz ? await ctx.db.get(biz) : null;
  return b?.ownerName?.trim() || me?.name?.trim() || b?.name || "The producer";
}

/** The page data a new sheet starts with, from the shoot (and the questionnaire's answers, when there are some). */
async function sheetData(ctx: Ctx, sh: NonNullable<Awaited<ReturnType<typeof shootOf>>>, people: Array<Person>, a: Answers | null, me: { name: string | null }) {
  const s = sh.s;
  const location: LocationAttrs = a
    ? { crewCall: a.crewCall, talentCall: a.talentCall, wrap: a.wrap, name: a.locationName, address: a.address, parking: a.parking, weather: false } // D148: a Weather block instead
    : { crewCall: s.call, talentCall: "", wrap: s.wrap ?? "", name: s.location, address: "", parking: s.parking ?? "", weather: false };
  const schedule: ScheduleRow[] = a ? a.schedule.filter((r) => r.time || r.what).map((r) => ({ id: r.id || newId(), time: r.time, what: r.what, who: r.who, notes: "" })) : [];
  const on = firstOn(people);
  const crew: CrewRow[] = on.map((x) => ({
    id: newId(), name: x.name, role: x.kind === "client" ? `${sh.client ?? "Client"}${x.role ? ` · ${x.role}` : ""}` : x.kind === "guest" ? `${x.role || "Guest"} (guest)` : x.role ?? "",
    call: x.kind === "guest" ? location.talentCall || location.crewCall : location.crewCall, phone: "",
  }));
  const main = on.find((x) => x.kind === "client");
  const contacts: ContactRow[] = [{ id: newId(), label: "Producer", name: await ownerName(ctx, sh.p, me), phone: await businessPhone(ctx) }, ...(main ? [{ id: newId(), label: "Client", name: main.name, phone: "" }] : [])];
  return { location, schedule, crew, contacts, notes: a?.notes ?? "" };
}

async function makeBuild(ctx: MutationCtx, cs: { shootId: Id<"shoots"> }, sh: NonNullable<Awaited<ReturnType<typeof shootOf>>>, people: Person[], t: Doc<"wsTemplates"> | null, a: Answers | null, me: { name: string | null }) {
  const d = await sheetData(ctx, sh, people, a, me);
  if (!a && t) { const rows = nodesOf(pageOf(t.blocks), "schedule").flatMap((n) => rowsOf<ScheduleRow>(n)); if (rows.length) d.schedule = rows.map((r) => ({ ...r, id: newId() })); }
  if (!d.schedule.length) d.schedule = [{ id: newId(), time: d.location.crewCall, what: "Crew call and load-in", who: "Crew", notes: "" }];
  const page = fillSheet(t ? pageOf(t.blocks) : null, { ...d, ...(a ? { weather: !!a.weather } : {}) });
  const fields = sheetFields((t?.fields as Partial<Fields> | undefined)?.custom, { title: sh.title, date: sh.s.date, client: sh.client ?? "", project: label(sh.p) });
  const buildId = await insertBuild(ctx, { title: `${sh.title} · ${sheetDay(sh.s.date).replace(/^\w+ /, "")}`, page, fields, ...(t ? { style: t.style as Style, templateId: t._id } : {}) });
  await ctx.db.patch(buildId, { kind: "callsheet" });
  return buildId;
}

// ---------- the owner: lists ----------

/** The four starter templates (765:3564), added once per business. */
export const ensureStarters = mutation({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    if (await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", "callSheetStarters")).first()) return { added: 0 };
    await ctx.db.insert("counters", { key: "callSheetStarters", value: 1 });
    const style = await defaultStyle(ctx);
    const now = Date.now();
    for (const t of STARTER_TEMPLATES) await ctx.db.insert("wsTemplates", { name: t.name, description: t.description, kind: "callsheet", blocks: t.page(), fields: { project: "", custom: [] }, style, createdAt: now, updatedAt: now });
    return { added: STARTER_TEMPLATES.length };
  },
});

async function templateRows(ctx: QueryCtx) {
  const all = await ctx.db.query("callSheets").collect();
  return (await ctx.db.query("wsTemplates").withIndex("by_updated").order("desc").collect()).filter((t) => t.kind === "callsheet")
    .map((t) => ({ _id: t._id, name: t.name, description: t.description ?? "", used: all.filter((c) => c.templateId === t._id).length }));
}

type Row = { _id: Id<"callSheets">; title: string; date: string; people: number; guests: number; state: "questions" | "draft" | "sent"; opened: number; of: number; sentAt: number | null; editedAt: number; how: Sheet["how"]; buildId: Id<"wsBuilds"> | null };
export async function sheetRow(ctx: QueryCtx, cs: Sheet): Promise<Row | null> {
  const sh = await shootOf(ctx, cs.shootId);
  if (!sh) return null;
  const build = cs.buildId ? await ctx.db.get(cs.buildId) : null;
  const sentTo = cs.recipients.filter((r) => r.sentAt);
  return {
    _id: cs._id, title: sh.title, date: sh.s.date, people: cs.recipients.filter((r) => r.on).length, guests: cs.recipients.filter((r) => r.on && r.kind === "guest").length,
    state: cs.status === "sent" ? "sent" : build ? "draft" : "questions", opened: sentTo.filter((r) => r.openedAt).length, of: sentTo.length,
    sentAt: cs.sentAt ?? null, editedAt: Math.max(cs.updatedAt, build?.updatedAt ?? 0), how: cs.how, buildId: cs.buildId ?? null,
  };
}

/** Production › Call sheets (765:2852 / 771:6965) and its Templates tab (765:3564). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const today = todayCentral();
    const rows: Row[] = [];
    for (const cs of await ctx.db.query("callSheets").collect()) { const r = await sheetRow(ctx, cs); if (r) rows.push(r); }
    const up = rows.filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const past = rows.filter((r) => r.date < today).sort((a, b) => b.date.localeCompare(a.date));
    return { today, rows: [...up, ...past], templates: await templateRows(ctx) };
  },
});

/** New call sheet (765:4235): upcoming shoots that don't have a call sheet yet, and the templates. */
export const newOptions = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const today = todayCentral();
    const taken = new Set((await ctx.db.query("callSheets").collect()).map((c) => String(c.shootId)));
    const shoots = [];
    for (const s of (await ctx.db.query("shoots").withIndex("by_date", (q) => q.gte("date", today)).collect()).filter((x) => x.status === "scheduled" && !taken.has(String(x._id)))) {
      const sh = await shootOf(ctx, s._id);
      if (sh) shoots.push({ _id: s._id, label: `${sh.title} · ${sheetDay(s.date)}`, date: s.date });
    }
    return { shoots, templates: await templateRows(ctx) };
  },
});

/** One call sheet: the questionnaire, the editor's people, and the Detail page (766:6342). */
export const get = query({
  args: { callSheetId: v.string() },
  handler: async (ctx, { callSheetId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("callSheets", callSheetId);
    const cs = id ? await ctx.db.get(id) : null;
    if (!cs) return null;
    const sh = await shootOf(ctx, cs.shootId);
    if (!sh) return null;
    const build = cs.buildId ? await ctx.db.get(cs.buildId) : null;
    const people = await peopleOf(ctx, cs, sh.s, sh.p);
    const raw = build ? migrateWeather(pageOf(build.blocks)).page : null;
    // D148: the page as it would be sent (the Weather block's line as shown), against the copy that was sent.
    const page = raw ? bakeWeather(raw, viewOf(cs, raw, sh.s)) : null;
    // The editor's Weather block: the forecast's own state (it puts the block's typed line over it as you type).
    const weather = raw ? viewOf(cs, raw, sh.s, true) : null;
    const sentPage = cs.sent ? migrateWeather(pageOf(cs.sent.page)).page : null;
    const changed = !!(cs.sent && build && (!samePage(sentPage, page) || cs.sent.title !== build.title || !samePage((cs.sent.fields as Fields)?.custom, (build.fields as Fields)?.custom)));
    const values = build ? fieldValues(build.fields as Fields, page!) : {};
    const loc = page ? locationOf(nodesOf(page, "location")[0]) : null;
    return {
      _id: cs._id, status: cs.status, how: cs.how, step: cs.step ?? 0, answers: (cs.answers as Answers | undefined) ?? null, buildId: cs.buildId ?? null, templateId: cs.templateId ?? null,
      title: sh.title, client: sh.client, project: { _id: sh.p._id, label: label(sh.p) }, today: todayCentral(),
      shoot: { _id: sh.s._id, date: sh.s.date, call: sh.s.call, wrap: sh.s.wrap ?? null, location: sh.s.location, parking: sh.s.parking ?? null },
      crewCall: loc?.crewCall || sh.s.call, place: loc?.name || sh.s.location,
      people: people.map((x) => ({ id: x.id, kind: x.kind, name: x.name, email: x.email, role: x.role ?? null, on: x.on, access: x.access, note: x.note,
        sentAt: x.sentAt ?? null, openedAt: x.openedAt ?? null, lastOpenedAt: x.lastOpenedAt ?? null, remindedAt: x.remindedAt ?? null, endedAt: x.endedAt ?? null })),
      templates: await templateRows(ctx),
      sent: cs.sent ? { at: cs.sent.at, round: cs.sent.round } : null, sentAt: cs.sentAt ?? null, updates: cs.updates ?? 0,
      changed, changes: changed && sentPage && page ? whatChanged(sentPage, page, values) : [],
      weather, // D148: the Weather block's state for the editor (null: the sheet has none)
      history: cs.history.slice(-20),
    };
  },
});

// ---------- the owner: making one ----------

async function sheetFor(ctx: Ctx, callSheetId: Id<"callSheets">) {
  const cs = await ctx.db.get(callSheetId);
  if (!cs) throw new ConvexError("That call sheet isn't here any more.");
  const sh = await shootOf(ctx, cs.shootId);
  if (!sh) throw new ConvexError("That shoot isn't here any more.");
  return { cs, sh };
}

/** New call sheet: Start the questions, Use a template, or Start blank. One per shoot. */
export const create = mutation({
  args: { shootId: v.id("shoots"), how: v.union(v.literal("questions"), v.literal("template"), v.literal("blank")), templateId: v.optional(v.id("wsTemplates")) },
  handler: async (ctx, a) => {
    const me = await requireMe(ctx);
    const sh = await shootOf(ctx, a.shootId);
    if (!sh || sh.s.status !== "scheduled") throw new ConvexError("That shoot isn't here any more.");
    const had = await ctx.db.query("callSheets").withIndex("by_shoot", (q) => q.eq("shootId", a.shootId)).first();
    if (had) throw new ConvexError("That shoot already has a call sheet.");
    const t = a.templateId ? await ctx.db.get(a.templateId) : null;
    if (a.templateId && (!t || t.kind !== "callsheet")) throw new ConvexError("That call sheet template isn't here.");
    if (a.how === "template" && !t) throw new ConvexError("Pick a template.");
    const now = Date.now();
    // Who gets it, to start: everyone who can read it in the portal.
    const recipients: Person[] = (await candidates(ctx, sh.s, sh.p)).map(({ access, note: _n, ...c }) => ({ ...c, on: access, addedAt: now }));
    const fallback = t ?? (await ctx.db.query("wsTemplates").collect()).find((x) => x.kind === "callsheet" && x.name === STARTER_TEMPLATES[0].name) ?? null;
    const base = { shootId: sh.s._id, projectId: sh.p._id, how: a.how, status: "draft" as const, recipients, history: [{ at: now, kind: "created", by: by(me), detail: a.how === "questions" ? "from the questions" : t ? `from the template "${t.name}"` : "blank" }], createdAt: now, updatedAt: now };
    if (a.how === "questions") return ctx.db.insert("callSheets", { ...base, answers: defaultAnswers(sh.s, fallback?._id ?? null), step: 0, ...(fallback ? { templateId: fallback._id } : {}) });
    const buildId = await makeBuild(ctx, { shootId: sh.s._id }, sh, recipients, a.how === "template" ? t : null, null, me);
    return ctx.db.insert("callSheets", { ...base, buildId, ...(a.how === "template" && t ? { templateId: t._id } : {}) });
  },
});

const scheduleRow = v.object({ id: v.string(), time: v.string(), what: v.string(), who: v.string() });
const answersArg = v.object({
  templateId: v.optional(v.union(v.id("wsTemplates"), v.null())), crewCall: v.string(), talentCall: v.string(), wrap: v.string(),
  locationName: v.string(), address: v.string(), parking: v.string(), weather: v.boolean(), schedule: v.array(scheduleRow), notes: v.string(),
});
const isTime = (s: string) => !s || /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
function cleanAnswers(a: Answers): Answers {
  for (const t of [a.crewCall, a.talentCall, a.wrap, ...a.schedule.map((r) => r.time)]) if (!isTime(t)) throw new ConvexError("Pick a time, or leave it empty.");
  if (a.schedule.length > 40) throw new ConvexError("Keep the schedule to 40 rows here; add more in the editor.");
  return {
    templateId: a.templateId ?? null, crewCall: a.crewCall, talentCall: a.talentCall, wrap: a.wrap, locationName: tidy(a.locationName, 200), address: tidy(a.address, 300),
    parking: tidy(a.parking, 400), weather: a.weather, notes: tidy(a.notes, 1000),
    schedule: a.schedule.map((r) => ({ id: tidy(r.id, 20) || newId(), time: r.time, what: tidy(r.what, 200), who: tidy(r.who, 80) })),
  };
}

/** The questionnaire saves as you go ("Save and finish later"). */
export const saveAnswers = mutation({
  args: { callSheetId: v.id("callSheets"), answers: answersArg, step: v.number() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const { cs } = await sheetFor(ctx, a.callSheetId);
    if (cs.buildId) throw new ConvexError("This call sheet is already made. Change it in the editor.");
    const ans = cleanAnswers(a.answers as Answers);
    if (ans.templateId) { const t = await ctx.db.get(ans.templateId as Id<"wsTemplates">); if (!t || t.kind !== "callsheet") throw new ConvexError("That call sheet template isn't here."); }
    await ctx.db.patch(cs._id, { answers: ans, step: Math.max(0, Math.min(4, Math.round(a.step))), templateId: (ans.templateId as Id<"wsTemplates"> | null) ?? undefined, updatedAt: Date.now() });
    return null;
  },
});

/** "Make the call sheet": the answers fill the template (or a blank page) and it opens in the editor. */
export const make = mutation({
  args: { callSheetId: v.id("callSheets") },
  handler: async (ctx, { callSheetId }) => {
    const me = await requireMe(ctx);
    const { cs, sh } = await sheetFor(ctx, callSheetId);
    if (cs.buildId) return cs.buildId;
    const a = cs.answers as Answers | undefined;
    if (!a) throw new ConvexError("Answer the questions first.");
    const t = a.templateId ? await ctx.db.get(a.templateId as Id<"wsTemplates">) : null;
    const people = (await peopleOf(ctx, cs, sh.s, sh.p)).filter((x) => x.on);
    const buildId = await makeBuild(ctx, cs, sh, people, t && t.kind === "callsheet" ? t : null, a, me);
    await ctx.db.patch(cs._id, { buildId, ...(t ? { templateId: t._id } : {}), updatedAt: Date.now(), history: hist(cs, "made", me) });
    return buildId;
  },
});

/** Tick or untick someone (crew, client people, guests). */
export const toggle = mutation({
  args: { callSheetId: v.id("callSheets"), id: v.string(), on: v.boolean() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const { cs, sh } = await sheetFor(ctx, a.callSheetId);
    const people = await peopleOf(ctx, cs, sh.s, sh.p);
    const x = people.find((r) => r.id === a.id);
    if (!x) throw new ConvexError("That person isn't on this shoot.");
    if (a.on && x.kind !== "guest" && !x.access) throw new ConvexError(x.note ?? "They can't open the portal yet.");
    const stored = cs.recipients.some((r) => r.id === a.id);
    const { access: _a, note: _n, ...row } = x;
    const recipients = stored ? cs.recipients.map((r) => (r.id === a.id ? { ...r, on: a.on } : r)) : [...cs.recipients, { ...row, on: a.on, addedAt: Date.now() }];
    if (recipients.length > MAX_PEOPLE) throw new ConvexError(`A call sheet can go to up to ${MAX_PEOPLE} people.`);
    await ctx.db.patch(cs._id, { recipients, updatedAt: Date.now() });
    return null;
  },
});

/** Add a guest (766:6270): talent or another one-off person, with their own pass (lib/guests.ts, D127). */
export const addGuest = mutation({
  args: { callSheetId: v.id("callSheets"), name: v.string(), email: v.string(), role: v.string() },
  handler: async (ctx, a) => {
    const me = await requireMe(ctx);
    const { cs } = await sheetFor(ctx, a.callSheetId);
    const name = tidy(a.name, 120), email = a.email.trim().toLowerCase(), role = tidy(a.role, 60) || "Talent";
    if (!name) throw new ConvexError("Enter their name.");
    if (!isEmail(email)) throw new ConvexError("Enter their email.");
    if (cs.recipients.some((r) => r.email === email)) throw new ConvexError("They're already on this call sheet.");
    if (cs.recipients.length >= MAX_PEOPLE) throw new ConvexError(`A call sheet can go to up to ${MAX_PEOPLE} people.`);
    // Step 4: their pass holds the link token for email 41. An email with a login of its own can be listed, but is never
    // sent the guest link (its access shows as such on the sheet).
    const id = `guest:${randomToken(9)}`;
    await ctx.db.patch(cs._id, { recipients: [...cs.recipients, { id, kind: "guest", name, email, role, on: true, addedAt: Date.now() }], updatedAt: Date.now(), history: hist(cs, "guest", me, `${name} (${role})`) });
    await addPass(ctx, cs, id, email);
    return id;
  },
});

export const removeGuest = mutation({
  args: { callSheetId: v.id("callSheets"), id: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const { cs } = await sheetFor(ctx, a.callSheetId);
    if (!cs.recipients.some((r) => r.id === a.id && r.kind === "guest")) throw new ConvexError("That guest isn't on this call sheet.");
    await ctx.db.patch(cs._id, { recipients: cs.recipients.filter((r) => r.id !== a.id), updatedAt: Date.now() });
    await dropPasses(ctx, cs._id, a.id); // their link stops working
    return null;
  },
});

/** End a guest's access by hand (the Detail page's Guest access). Their link and login then show Access ended. */
export const endGuest = mutation({
  args: { callSheetId: v.id("callSheets"), id: v.string() },
  handler: async (ctx, a) => {
    const me = await requireMe(ctx);
    const { cs } = await sheetFor(ctx, a.callSheetId);
    const g = cs.recipients.find((r) => r.id === a.id && r.kind === "guest");
    if (!g) throw new ConvexError("That guest isn't on this call sheet.");
    if (g.endedAt) return null;
    const now = Date.now();
    await ctx.db.patch(cs._id, { recipients: cs.recipients.map((r) => (r.id === a.id ? { ...r, endedAt: now } : r)), updatedAt: now, history: hist(cs, "guest-ended", me, g.name) });
    for (const p of await ctx.db.query("guestPasses").withIndex("by_sheet", (q) => q.eq("callSheetId", cs._id)).collect()) if (p.personId === a.id) await ctx.db.patch(p._id, { sentAt: undefined });
    return null;
  },
});

/** Review L3: Restore access for a guest whose access was ended. Not at once: they get the sheet again (email 41, a
 *  working link) on the next Send an update or Remind. */
export const restoreGuest = mutation({
  args: { callSheetId: v.id("callSheets"), id: v.string() },
  handler: async (ctx, a) => {
    const me = await requireMe(ctx);
    const { cs } = await sheetFor(ctx, a.callSheetId);
    const g = cs.recipients.find((r) => r.id === a.id && r.kind === "guest");
    if (!g) throw new ConvexError("That guest isn't on this call sheet.");
    if (!g.endedAt) return null;
    const now = Date.now();
    const back = (r: Person): Person => {
      const { endedAt: _e, sentAt: _s, openedAt: _o, lastOpenedAt: _l, remindedAt: _r, round: _n, ...rest } = r;
      return { ...rest, on: true, grant: (r.grant ?? 0) + 1 };
    };
    await ctx.db.patch(cs._id, { recipients: cs.recipients.map((r) => (r.id === a.id ? back(r) : r)), updatedAt: now, history: hist(cs, "guest-restored", me, g.name) });
    return null;
  },
});

export const deleteDraft = mutation({
  args: { callSheetId: v.id("callSheets") },
  handler: async (ctx, { callSheetId }) => {
    await requireMe(ctx);
    const cs = await ctx.db.get(callSheetId);
    if (!cs) return null;
    if (cs.status !== "draft") throw new ConvexError("A sent call sheet stays, so you can see who opened it.");
    if (cs.buildId) await ctx.db.delete(cs.buildId);
    await dropPasses(ctx, cs._id);
    await ctx.db.delete(cs._id);
    return null;
  },
});

// ---------- the owner: Send, Send an update, Remind ----------

type Out = { id: string; email: string; name: string; kind: "crew" | "client" | "guest"; mail: "first" | "update" | "remind"; key: string; call: string; was?: string; inbox?: string };
// Review L3: each email goes once per recipient (their id on the sheet), not per address: a guest removed and added again
// is a new recipient, and one whose access was restored (grant) gets email 41 again.
const firstKey = (cs: Sheet, x: Person) => `callsheet:${cs._id}:first:${x.id}${x.grant ? `:g${x.grant}` : ""}`;
const updateKey = (cs: Sheet, round: number, x: Person) => `callsheet:${cs._id}:update:${round}:${x.id}`;
const remindKey = (cs: Sheet, x: Person) => `callsheet:${cs._id}:remind:${(x.reminders ?? 0) + 1}:${x.id}`;

/** Review L2/L5: a guest it was just sent to: their pass says so (the /guest list's hint), and a pass locked by wrong
 *  codes opens again. */
async function passesSent(ctx: MutationCtx, cs: Sheet, ids: string[], date: string) {
  if (!ids.length) return;
  const now = Date.now();
  for (const p of await ctx.db.query("guestPasses").withIndex("by_sheet", (q) => q.eq("callSheetId", cs._id)).collect())
    if (ids.includes(p.personId)) await ctx.db.patch(p._id, { sentAt: now, date, lockedAt: undefined, wrongCount: undefined, wrongDay: undefined });
}
const guestIds = (xs: Array<{ id: string; kind: string }>) => xs.filter((x) => x.kind === "guest").map((x) => x.id);

async function frozenCopy(ctx: MutationCtx, cs: Sheet, s: Doc<"shoots">) {
  const build = cs.buildId ? await ctx.db.get(cs.buildId) : null;
  if (!build) throw new ConvexError("Make the call sheet first.");
  // D148: the copy everyone reads carries the Weather block's line as shown now (typed, or the forecast).
  const raw = migrateWeather(pageOf(build.blocks)).page;
  const doc: BuildDoc = { title: build.title, page: bakeWeather(raw, viewOf(cs, raw, s)), fields: build.fields as Fields, signers: (build.signers as ExtraSigner[]) ?? [], style: build.style as Style };
  const problems = callSheetProblems(doc);
  if (problems.length) throw new ConvexError(problems[0]);
  return { build, doc };
}

/** Inbox items for the client's people (a link to the sheet in their portal). */
async function tellClients(ctx: MutationCtx, cs: Sheet, p: Doc<"projects">, out: Out[], key: string, title: string, text: (o: Out) => string) {
  const biz = await businessOf(ctx, p);
  if (!biz) return;
  for (const o of out.filter((x) => x.kind === "client")) {
    await postToInbox(ctx, { businessId: biz, clientId: p.clientId, email: o.email, kind: "shoot", title, text: text(o), link: `/call-sheets/${cs._id}`, linkLabel: "Open the call sheet", source: { module: "schedule", id: cs._id }, key });
  }
}

/** Send call sheet (766:6190): to the ticked crew, client people and guests (each group can be left out); email 40 each
 *  (41 for a guest), once. Guests are left out unless `guests` is true. */
export const send = mutation({
  args: { callSheetId: v.id("callSheets"), crew: v.boolean(), client: v.boolean(), guests: v.optional(v.boolean()), message: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const me = await requireMe(ctx);
    const { cs, sh } = await sheetFor(ctx, a.callSheetId);
    if (cs.status === "sent") throw new ConvexError("It's already been sent. Use Send an update.");
    const { build, doc } = await frozenCopy(ctx, cs, sh.s);
    const people = await peopleOf(ctx, cs, sh.s, sh.p);
    const left = (k: string) => (k === "crew" && !a.crew) || (k === "client" && !a.client) || (k === "guest" && !a.guests);
    const go = reachable(people).filter((x) => !left(x.kind));
    if (!go.length) throw new ConvexError("Tick at least one person who can open it.");
    const now = Date.now();
    const ids = new Set(go.map((x) => x.id));
    const recipients: Person[] = people.filter((x) => x.addedAt || ids.has(x.id) || x.on).map(({ access: _a, note: _n, ...r }) => ({
      ...r, addedAt: r.addedAt || now, ...(left(r.kind) ? { on: false } : {}), ...(ids.has(r.id) ? { sentAt: now } : {}),
    }));
    const out: Out[] = go.map((x) => ({ id: x.id, email: x.email, name: x.name, kind: x.kind, mail: "first", key: firstKey(cs, x), call: callFor(doc.page, x), inbox: `callsheet:${cs._id}:first` }));
    await ctx.db.patch(cs._id, {
      status: "sent", sentAt: now, recipients, updates: 0, updatedAt: now,
      sent: { title: build.title, page: doc.page, fields: doc.fields, style: doc.style, at: now, round: 0, heading: sh.title, date: sh.s.date },
      history: hist(cs, "sent", me, `${go.length} ${go.length === 1 ? "person" : "people"}`),
    });
    await ctx.db.patch(build._id, { renderedAt: now });
    await passesSent(ctx, cs, guestIds(go), sh.s.date);
    await tellClients(ctx, cs, sh.p, out, `callsheet:${cs._id}:first`, `Call sheet: ${sheetDay(sh.s.date)}`, (o) => `${sh.title}${o.call ? ` · your call ${clockOf(o.call)}` : ""}`);
    await ctx.scheduler.runAfter(0, internal.callSheets.mail, { callSheetId: cs._id, out, message: tidy(a.message, 500) || undefined });
    return { sent: go.length, skipped: people.filter((x) => x.on && !x.access && !left(x.kind)).map((x) => x.name), guests: go.filter((x) => x.kind === "guest").length };
  },
});

/** Send an update: the new copy for everyone; email 42 once per person per update (40 for anyone new on it). */
export const sendUpdate = mutation({
  args: { callSheetId: v.id("callSheets"), changed: v.string(), message: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const me = await requireMe(ctx);
    const { cs, sh } = await sheetFor(ctx, a.callSheetId);
    if (cs.status !== "sent" || !cs.sent) throw new ConvexError("Send it first.");
    const { build, doc } = await frozenCopy(ctx, cs, sh.s);
    const changed = tidy(a.changed, 120) || whatChanged(migrateWeather(pageOf(cs.sent.page)).page, doc.page, fieldValues(doc.fields, doc.page))[0] || "";
    if (!changed) throw new ConvexError("Say what changed.");
    const people = await peopleOf(ctx, cs, sh.s, sh.p);
    const go = reachable(people);
    if (!go.length) throw new ConvexError("Nobody on it can open it.");
    const now = Date.now();
    const round = (cs.updates ?? 0) + 1;
    const before = pageOf(cs.sent.page);
    const ids = new Set(go.map((x) => x.id));
    const out: Out[] = go.map((x) => x.sentAt
      ? { id: x.id, email: x.email, name: x.name, kind: x.kind, mail: "update", key: updateKey(cs, round, x), call: callFor(doc.page, x), was: callFor(before, x), inbox: `callsheet:${cs._id}:update:${round}` }
      : { id: x.id, email: x.email, name: x.name, kind: x.kind, mail: "first", key: firstKey(cs, x), call: callFor(doc.page, x), inbox: `callsheet:${cs._id}:update:${round}` });
    const recipients: Person[] = people.filter((x) => x.addedAt || x.on).map(({ access: _a, note: _n, ...r }) => ({
      ...r, addedAt: r.addedAt || now, ...(ids.has(r.id) ? (r.sentAt ? { round } : { sentAt: now }) : {}),
    }));
    await ctx.db.patch(cs._id, {
      recipients, updates: round, updatedAt: now, sent: { title: build.title, page: doc.page, fields: doc.fields, style: doc.style, at: now, round, heading: sh.title, date: sh.s.date },
      history: hist(cs, "update", me, changed),
    });
    await passesSent(ctx, cs, guestIds(go), sh.s.date);
    await tellClients(ctx, cs, sh.p, out, `callsheet:${cs._id}:update:${round}`, `Call sheet updated: ${sheetDay(sh.s.date)}`, () => `${changed}.`);
    await ctx.scheduler.runAfter(0, internal.callSheets.mail, { callSheetId: cs._id, out, changed, message: tidy(a.message, 500) || undefined });
    return { sent: out.length };
  },
});

/** Remind (766:6342): email 40 again, only to people it went to who haven't opened it (one person, or all of them). */
export const remind = mutation({
  args: { callSheetId: v.id("callSheets"), id: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const me = await requireMe(ctx);
    const { cs, sh } = await sheetFor(ctx, a.callSheetId);
    if (cs.status !== "sent" || !cs.sent) throw new ConvexError("Send it first.");
    const now = Date.now();
    const page = pageOf(cs.sent.page);
    const people = await peopleOf(ctx, cs, sh.s, sh.p);
    // Review L3: a guest it hasn't gone to (access restored, or added after Send) gets email 41 from Remind too.
    const restored = (x: Person) => x.kind === "guest" && !x.sentAt;
    const go = people.filter((x) => ((x.sentAt && !x.openedAt) || restored(x)) && x.on && x.access && (!a.id || x.id === a.id) && !(x.remindedAt && now - x.remindedAt < 10 * 60_000));
    if (a.id && !go.length) {
      const x = people.find((r) => r.id === a.id);
      throw new ConvexError(!x ? "That person isn't on this call sheet." : x.openedAt ? "They've opened it already." : x.remindedAt && now - x.remindedAt < 10 * 60_000 ? "You reminded them a moment ago." : "They can't be reminded.");
    }
    if (!go.length) return { sent: 0 };
    const ids = new Set(go.map((x) => x.id));
    const out: Out[] = go.map((x) => restored(x)
      ? { id: x.id, email: x.email, name: x.name, kind: x.kind, mail: "first", key: firstKey(cs, x), call: callFor(page, x) }
      : { id: x.id, email: x.email, name: x.name, kind: x.kind, mail: "remind", key: remindKey(cs, x), call: callFor(page, x) });
    const fresh = new Set(go.filter(restored).map((x) => x.id));
    await ctx.db.patch(cs._id, {
      recipients: cs.recipients.map((r) => (fresh.has(r.id) ? { ...r, sentAt: now, round: cs.sent!.round } : ids.has(r.id) ? { ...r, remindedAt: now, reminders: (r.reminders ?? 0) + 1 } : r)), updatedAt: now,
      history: hist(cs, "remind", me, go.map((x) => x.name).join(", ")),
    });
    await passesSent(ctx, cs, guestIds(go), sh.s.date);
    await ctx.scheduler.runAfter(0, internal.callSheets.mail, { callSheetId: cs._id, out });
    return { sent: go.length };
  },
});

// ---------- emails 40 and 42 ----------

export const mailData = internalQuery({
  args: { callSheetId: v.id("callSheets") },
  handler: async (ctx, { callSheetId }) => {
    const cs = await ctx.db.get(callSheetId);
    if (!cs?.sent) return null;
    const sh = await shootOf(ctx, cs.shootId);
    if (!sh) return null;
    const biz = await businessOf(ctx, sh.p);
    const page = pageOf(cs.sent.page);
    const loc = locationOf(nodesOf(page, "location")[0]);
    // Step 4: each guest's own link (their pass's token), for email 41 and their copy of 42.
    const links: Record<string, string> = {};
    for (const p of await ctx.db.query("guestPasses").withIndex("by_sheet", (q) => q.eq("callSheetId", cs._id)).collect()) links[p.personId] = p.token;
    // Review L6: the heading and date as sent (Remind goes out later, and the project or shoot may have changed since).
    return { biz, brand: await mailBrandOf(ctx, biz), title: cs.sent.heading ?? sh.title, date: cs.sent.date ?? sh.s.date, where: loc.name || sh.s.location, from: await ownerName(ctx, sh.p), status: cs.status, links };
  },
});

const outArg = v.array(v.object({ id: v.string(), email: v.string(), name: v.string(), kind: v.union(v.literal("crew"), v.literal("client"), v.literal("guest")), mail: v.union(v.literal("first"), v.literal("update"), v.literal("remind")), key: v.string(), call: v.string(), was: v.optional(v.string()), inbox: v.optional(v.string()) }));
export const mail = internalAction({
  args: { callSheetId: v.id("callSheets"), out: outArg, changed: v.optional(v.string()), message: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const d = await ctx.runQuery(internal.callSheets.mailData, { callSheetId: a.callSheetId });
    if (!d || d.status !== "sent") return 0;
    let sent = 0;
    for (const o of a.out) {
      const token = o.kind === "guest" ? d.links[o.id] : null;
      if (o.kind === "guest" && !token) continue; // a guest taken off the sheet since: no link, no email
      const link = o.kind === "guest" ? `${SITE()}/guest/${token}` : o.kind === "crew" ? `${SITE()}/vendor/call-sheets/${a.callSheetId}` : `${SITE()}/call-sheets/${a.callSheetId}`;
      const kind = `${o.kind === "crew" ? "vendor_" : o.kind === "guest" ? "guest_" : ""}${o.mail === "update" ? "callsheet_update" : "callsheet"}`;
      const first = { name: o.name, title: d.title, dayLong: sheetDayLong(d.date), call: clockOf(o.call), where: d.where, from: d.from, message: o.mail === "first" ? a.message : null, reminder: o.mail === "remind", link };
      const m = o.mail === "update"
        ? callSheetUpdateMail(d.brand, { name: o.name, title: d.title, dayLong: sheetDayLong(d.date), changed: a.changed ?? "The call sheet changed", call: clockOf(o.call), was: o.was !== undefined ? clockOf(o.was) : null, from: d.from, message: a.message, link })
        : o.kind === "guest" ? guestCallSheetMail(d.brand, first) : callSheetMail(d.brand, { ...first, date: d.date });
      try {
        if ((await deliverOnce(ctx, o.key, kind, o.email, m, d.brand.replyTo, d.biz)) === "sent") sent++;
        if (o.kind === "client" && o.inbox) await ctx.runMutation(internal.emails.markInboxEmailed, { key: o.inbox, email: o.email });
      } catch (e) { console.error("call sheet email", String((e as Error).message).slice(0, 120)); }
    }
    return sent;
  },
});

// ---------- readers: the client's people ----------

/** What a reader sees: the copy that was sent (never the owner's unsent edits), and their own call. */
export async function readerView(ctx: QueryCtx, cs: Sheet, me: Person) {
  const sh = await shootOf(ctx, cs.shootId);
  if (!sh || !cs.sent) return null;
  const page = pageOf(cs.sent.page);
  const fields = cs.sent.fields as Fields;
  // Review L9: only the fill-in values this page uses (the others, e.g. the business's own details, stay out).
  const all = fieldValues(fields, page);
  const used = new Set([...JSON.stringify(page).matchAll(/(?<!\{)\{([a-z][a-z0-9_.]{0,40})\}(?!\})/gi)].map((m) => m[1]));
  const values = Object.fromEntries(Object.entries(all).filter(([k]) => used.has(k)));
  const contact = await businessContact(ctx, cs.businessId ?? null);
  const b = cs.businessId ? await ctx.db.get(cs.businessId) : null;
  const st = cs.sent.style as Partial<Style> | undefined;
  return {
    // Review L6: the heading and date as sent, not the project or shoot as they are now.
    _id: cs._id, title: cs.sent.heading ?? sh.title, docTitle: cs.sent.title, date: cs.sent.date ?? sh.s.date, project: { _id: sh.p._id, label: label(sh.p) }, page, values,
    accent: typeof st?.accent === "string" ? st.accent : null, sentAt: cs.sent.at, updated: cs.sent.round > 0,
    business: b?.name ?? contact.name, owner: b?.ownerName?.trim() || contact.name, replyTo: b?.replyTo || contact.ownerEmail,
    me: { name: me.name, kind: me.kind, role: me.role ?? null, call: callFor(page, me) }, openedAt: me.openedAt ?? null,
  };
}

async function clientSheet(ctx: QueryCtx, callSheetId: string) {
  const me = await requireSignedIn(ctx);
  if (me.kind !== "client") return null;
  const id = ctx.db.normalizeId("callSheets", callSheetId);
  const cs = id ? await ctx.db.get(id) : null;
  if (!cs || cs.status !== "sent" || !cs.sent) return null;
  const email = me.email.toLowerCase();
  // Review M1: still ticked (the owner can take someone off after Send) and the shoot still on.
  const r = cs.recipients.find((x) => x.kind === "client" && x.email === email && x.sentAt && x.on);
  if (!r || !(await myProjects(ctx, email)).has(cs.projectId)) return null;
  const shoot = await ctx.db.get(cs.shootId);
  if (!shoot || shoot.status !== "scheduled") return null;
  return { cs, r, email };
}

/** /call-sheets/<id> on the client side: only for one of the client's people it was sent to, on a project they can open. */
export const forClient = query({
  args: { callSheetId: v.string() },
  handler: async (ctx, { callSheetId }) => {
    const c = await clientSheet(ctx, callSheetId);
    return c ? await readerView(ctx, c.cs, c.r) : null;
  },
});

/** The call sheets sent to this client person on one project (their project page). */
export const forClientProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return [];
    const id = ctx.db.normalizeId("projects", projectId);
    const email = me.email.toLowerCase();
    if (!id || !(await myProjects(ctx, email)).has(id)) return [];
    const out = [];
    for (const cs of await ctx.db.query("callSheets").withIndex("by_project", (q) => q.eq("projectId", id)).collect()) {
      const r = cs.status === "sent" && cs.sent ? cs.recipients.find((x) => x.kind === "client" && x.email === email && x.sentAt && x.on) : null;
      const s = r ? await ctx.db.get(cs.shootId) : null;
      // The live shoot date decides whether it's still coming up; the date shown is the one sent (review L6).
      if (r && s && s.status === "scheduled" && s.date >= todayCentral()) out.push({ _id: cs._id, date: cs.sent!.date ?? s.date, call: callFor(pageOf(cs.sent!.page), r), opened: !!r.openedAt, sentAt: cs.sent!.at });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  },
});

/** Opening it records "opened" for that person (the owner's Detail page shows who has). */
export const opened = mutation({
  args: { callSheetId: v.string() },
  handler: async (ctx, { callSheetId }) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") throw new ConvexError("Not allowed.");
    const id = ctx.db.normalizeId("callSheets", callSheetId);
    const raw = id ? await ctx.db.get(id) : null;
    if (raw) focusBusiness(ctx, raw.businessId); // a client of more than one business acts for this sheet's
    const c = await clientSheet(ctx as unknown as QueryCtx, callSheetId);
    if (!c) throw new ConvexError("This call sheet isn't here.");
    await markOpened(ctx, c.cs, c.r.id, c.r.name);
    return null;
  },
});

export async function markOpened(ctx: MutationCtx, cs: Sheet, personId: string, name: string) {
  const now = Date.now();
  const first = !cs.recipients.find((r) => r.id === personId)?.openedAt;
  // A reload within a minute isn't another open.
  const r0 = cs.recipients.find((r) => r.id === personId);
  if (!first && r0?.lastOpenedAt && now - r0.lastOpenedAt < 60_000) return;
  await ctx.db.patch(cs._id, {
    recipients: cs.recipients.map((r) => (r.id === personId ? { ...r, ...(first ? { openedAt: now } : {}), lastOpenedAt: now } : r)),
    ...(first ? { history: hist(cs, "opened", null, name) } : {}),
  });
}

/** The vendor side's check (vendorPortal.ts): this vendor is on the sheet it was sent to, and still booked. */
export async function sentToVendor(ctx: Ctx, cs: Sheet | null, vendorId: Id<"vendors">) {
  if (!cs || cs.status !== "sent" || !cs.sent) return null;
  // Review M1: still ticked, the shoot still on, and the booking still covering it (the rule that put them on it).
  const r = cs.recipients.find((x) => x.kind === "crew" && x.vendorId === vendorId && x.sentAt && x.on);
  if (!r?.bookingId) return null;
  const k = await ctx.db.get(r.bookingId);
  const s = await ctx.db.get(cs.shootId);
  return k && s && s.status === "scheduled" && k.vendorId === vendorId && k.projectId === cs.projectId && coversShoot(k, s) ? r : null;
}

// ---------- D148 (Nov 4): the Weather block's forecast ----------
// The forecast fills once the shoot is within a week and refreshes the day before (the daily cron, crons.ts), or when the
// owner presses Refresh forecast. It's kept on the sheet (callSheets.weather), never in the page: the editor shows it, and
// Send / Send an update bake it into the copy everyone reads. A typed-over line is the owner's and nothing changes it.
// Readers keep the copy that was sent: a refresh that changes the line after sending only nudges the owner (Dashboard
// "Needs you", weatherNeeds); nobody is emailed.

/** The Weather block's state on this page (null: the page has none). */
function viewOf(cs: Sheet, page: Page, s: Doc<"shoots">, forecastOnly = false): WeatherView | null {
  const n = nodesOf(page, "weather")[0];
  if (!n) return null;
  const { address, place } = weatherAddress(page, s.location);
  return weatherView(forecastOnly ? { typed: false, line: "" } : weatherOf(n), cs.weather, { date: s.date, address, place, today: todayCentral() });
}

/** Whether the forecast should be looked up now: within a week of the shoot (today included), and not filled yet for
 *  this address and day, or not refreshed yet on the day before. `force` (Refresh forecast): whenever it's within a week. */
function needsForecast(cs: Sheet, page: Page, s: Doc<"shoots">, today: string, force = false) {
  if (s.status !== "scheduled" || !nodesOf(page, "weather").length) return false;
  const days = daysBetween(today, s.date);
  if (days < 0 || days > WEATHER_DAYS) return false;
  if (force) return true;
  const { address } = weatherAddress(page, s.location);
  const w = cs.weather;
  if (!w || w.date !== s.date || w.address !== address || w.state !== "forecast") return true;
  return days <= 1 && !w.dayBefore;
}

/** The cron's list: every business's sheets that need a forecast now. Trusted server code (it sees every business, and
 *  reads nothing but which sheets); each sheet's lookup then runs as its own business (weatherOne with asBusiness). */
export const weatherDue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayCentral();
    const out: Array<{ callSheetId: Id<"callSheets">; biz: Id<"businesses"> | null }> = [];
    for (const s of await ctx.db.query("shoots").withIndex("by_date", (q) => q.gte("date", today).lte("date", addDay(today, WEATHER_DAYS))).collect()) {
      const cs = await ctx.db.query("callSheets").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).first();
      const build = cs?.buildId ? await ctx.db.get(cs.buildId) : null;
      if (cs && build && needsForecast(cs, migrateWeather(pageOf(build.blocks)).page, s, today)) out.push({ callSheetId: cs._id, biz: cs.businessId ?? null });
    }
    return out;
  },
});

/** What one lookup needs: the address (to Census, unless its geocode is kept), the day, and the kept point (to NWS). */
export const weatherInput = internalQuery({
  args: { callSheetId: v.id("callSheets"), force: v.optional(v.boolean()) },
  handler: async (ctx, { callSheetId, force }) => {
    const cs = await ctx.db.get(callSheetId);
    const s = cs ? await ctx.db.get(cs.shootId) : null;
    const build = cs?.buildId ? await ctx.db.get(cs.buildId) : null;
    if (!cs || !s || !build) return null;
    const page = migrateWeather(pageOf(build.blocks)).page;
    if (!needsForecast(cs, page, s, todayCentral(), !!force)) return null;
    const { address } = weatherAddress(page, s.location);
    const geo = cs.geo && cs.geo.address === address ? { lat: cs.geo.lat ?? null, lon: cs.geo.lon ?? null } : null;
    return { address, date: s.date, geo };
  },
});

const kindArg = v.union(v.literal("forecast"), v.literal("early"), v.literal("none"), v.literal("error"));
export const weatherStore = internalMutation({
  args: { callSheetId: v.id("callSheets"), address: v.string(), date: v.string(), kind: kindArg, line: v.optional(v.string()), geo: v.optional(v.object({ lat: v.optional(v.number()), lon: v.optional(v.number()) })) },
  handler: async (ctx, a) => {
    const cs = await ctx.db.get(a.callSheetId);
    if (!cs) return null;
    const now = Date.now();
    const w = cs.weather;
    const same = !!w && w.address === a.address && w.date === a.date;
    // The service didn't answer: a forecast already here for this address and day stays (tried again next run).
    const keep = a.kind === "error" && same && w!.state === "forecast";
    const weather = keep ? w! : {
      address: a.address, date: a.date, state: a.kind === "forecast" ? "forecast" as const : a.kind === "early" ? "early" as const : "none" as const,
      line: a.kind === "forecast" ? (a.line ?? "").slice(0, 160) : "", at: now,
      ...(a.kind === "forecast" && daysBetween(todayCentral(), a.date) <= 1 ? { dayBefore: true } : {}),
    };
    await ctx.db.patch(cs._id, { weather, ...(a.geo ? { geo: { address: a.address, ...a.geo, at: now } } : {}) });
    return weather.state;
  },
});

/** One sheet's lookup: Census (the address only, once per address) → NWS (the point only) → kept on the sheet. */
export const weatherOne = internalAction({
  args: { callSheetId: v.id("callSheets"), force: v.optional(v.boolean()) },
  handler: async (ctx, { callSheetId, force }): Promise<string | null> => {
    const inp: { address: string; date: string; geo: { lat: number | null; lon: number | null } | null } | null = await ctx.runQuery(internal.callSheets.weatherInput, { callSheetId, force });
    if (!inp) return null;
    let point = inp.geo;
    let found: { lat?: number; lon?: number } | undefined;
    if (!point) {
      const g = await geocode(inp.address);
      if (g.kind === "error") return await ctx.runMutation(internal.callSheets.weatherStore, { callSheetId, address: inp.address, date: inp.date, kind: "error" });
      found = g.kind === "found" ? { lat: g.geo.lat, lon: g.geo.lon } : {};
      point = { lat: found.lat ?? null, lon: found.lon ?? null };
    }
    const r = point.lat !== null && point.lon !== null ? await forecast({ lat: point.lat, lon: point.lon }, inp.date) : { kind: "none" as const };
    return await ctx.runMutation(internal.callSheets.weatherStore, { callSheetId, address: inp.address, date: inp.date, kind: r.kind, ...(r.kind === "forecast" ? { line: r.line } : {}), ...(found ? { geo: found } : {}) });
  },
});

/** The daily cron (crons.ts): each sheet that needs it gets its own lookup, as its own business. */
export const weatherAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const due: Array<{ callSheetId: Id<"callSheets">; biz: Id<"businesses"> | null }> = await ctx.runQuery(internal.callSheets.weatherDue, {});
    for (const d of due) await ctx.scheduler.runAfter(0, internal.callSheets.weatherOne, { callSheetId: d.callSheetId, ...(d.biz ? { asBusiness: d.biz } : {}) });
    return due.length;
  },
});

/** Refresh forecast (the editor's Weather block): looks it up again now, when the shoot is within a week. */
export const refreshWeather = mutation({
  args: { callSheetId: v.id("callSheets") },
  handler: async (ctx, { callSheetId }) => {
    await requireMe(ctx);
    const { cs, sh } = await sheetFor(ctx, callSheetId);
    if (!cs.buildId) throw new ConvexError("Make the call sheet first.");
    const days = daysBetween(todayCentral(), sh.s.date);
    if (days > WEATHER_DAYS) return { state: "early" as const };
    if (days < 0) throw new ConvexError("The shoot is over.");
    if (cs.weather && Date.now() - cs.weather.at < 30_000) return { state: "recent" as const }; // a double press
    await ctx.scheduler.runAfter(0, internal.callSheets.weatherOne, { callSheetId, force: true });
    return { state: "looking" as const };
  },
});

/** Dashboard "Needs you": a sent sheet whose forecast changed after it was sent ("Weather changed for {shoot}: Send an
 *  update"). Readers still see the sent line until the owner sends an update; nobody is emailed. */
export async function weatherNeeds(ctx: QueryCtx) {
  const today = todayCentral();
  const out: Array<{ kind: "weatherChanged"; at: number; callSheetId: Id<"callSheets">; title: string; date: string; line: string; was: string }> = [];
  for (const cs of await ctx.db.query("callSheets").withIndex("by_status", (q) => q.eq("status", "sent")).collect()) {
    if (!cs.sent || !cs.buildId || cs.weather?.state !== "forecast" || cs.weather.at <= cs.sent.at) continue;
    const was = weatherLine(pageOf(cs.sent.page));
    if (was === null) continue;
    const sh = await shootOf(ctx, cs.shootId);
    const build = await ctx.db.get(cs.buildId);
    if (!sh || !build || sh.s.status !== "scheduled" || sh.s.date < today) continue;
    const view = viewOf(cs, migrateWeather(pageOf(build.blocks)).page, sh.s);
    if (!view || view.state !== "forecast" || view.line === was) continue;
    out.push({ kind: "weatherChanged", at: cs.weather.at, callSheetId: cs._id, title: cs.sent.heading ?? sh.title, date: sh.s.date, line: view.line, was });
  }
  return out;
}

/** D148 migration: call sheets and call-sheet templates whose location block had "Add the weather the day before" ticked
 *  get a Weather block (lib/callSheet.ts migrateWeather). Pages are also migrated as they're opened; this does the rest.
 *  Safe to run again: a page already done is left alone. */
export const migrateWeatherBlocks = internalMutation({
  args: {},
  handler: async (ctx) => {
    let builds = 0, templates = 0;
    for (const b of (await ctx.db.query("wsBuilds").collect()).filter((x) => x.kind === "callsheet")) {
      const m = migrateWeather(pageOf(b.blocks));
      if (m.changed) { await ctx.db.patch(b._id, { blocks: m.page }); builds++; }
    }
    for (const t of (await ctx.db.query("wsTemplates").collect()).filter((x) => x.kind === "callsheet")) {
      const m = migrateWeather(pageOf(t.blocks));
      if (m.changed) { await ctx.db.patch(t._id, { blocks: m.page }); templates++; }
    }
    return { builds, templates };
  },
});
