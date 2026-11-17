// How everything connects (Nov 16; D204–D206; the Claude doc "Wrangler Portal — How everything connects", approved 18:48;
// the data layer approved 19:39). Every kind of thing can be made on its own and given ONE home later: a lead, a client,
// a project or a shoot day. A project's client is read through the project, so moving a project between clients (or out
// of one) carries everything on it with no relinking. Money documents keep their `clientId` in step with their home (the
// code that sends them reads it), and one already sent stays with the client it went to.
//
// This file: the picker's places (`places`), Attach/Move for one thing (`move`), Move for a project (`moveProject`), and
// the "Not attached" list (`loose`). Shoots, kickoff briefs, file requests and vendor bookings follow in the next step.
import { mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAll } from "./lib/access";
import { audit } from "./lib/audit";
import { label } from "./lib/bookingRows";
import type { Perm } from "./lib/perms";
import { queueCalendar } from "./calendar";
import { linkClient } from "./lib/functions";

type Ctx = QueryCtx | MutationCtx;
export type HomeType = "client" | "project" | "shoot" | "lead";
export type Home = { type: HomeType; id: string } | null;

// ---------- the kinds (what can live where, the doc's table) ----------

type KindDef = {
  table: "shoots" | "shotLists" | "quotes" | "estimates" | "proposals" | "invoices" | "subscriptions" | "briefings" | "deals";
  noun: string;
  perm: Perm;
  homes: HomeType[];
  /** Addressed to someone or already sent (review H1): it can file under another project of the same client, never
   *  leave that client (who it's billed or sent to belongs to that client). */
  sent?: (d: Record<string, unknown>) => boolean;
  /** A reason it can't move at all (e.g. a briefing tied to a booking). */
  fixed?: (d: Record<string, unknown>) => string | null;
};
export const KINDS = {
  // D205: a shoot day moves between projects (or to none) with its call sheet and shot list; crew booked on its
  // project keep it there.
  shoot: { table: "shoots", noun: "shoot", perm: "shoots", homes: ["project"], fixed: (d) => (Array.isArray(d.crew) && (d.crew as Array<{ bookingId?: string }>).some((c) => c.bookingId) ? "Crew booked on this project are on this shoot: take them off it first." : d.status !== "scheduled" ? "That shoot was cancelled." : null) },
  shotList: { table: "shotLists", noun: "shot list", perm: "shoots", homes: ["project", "shoot"] },
  quote: { table: "quotes", noun: "quote", perm: "payments", homes: ["lead", "client", "project"], sent: (d) => d.status !== "draft" || !!d.contact },
  estimate: { table: "estimates", noun: "estimate", perm: "clients", homes: ["lead", "client", "project"] },
  proposal: { table: "proposals", noun: "proposal", perm: "docs", homes: ["lead", "client", "project"], sent: (d) => !["draft", "waiting", "ready"].includes(String(d.status)) || !!d.contact },
  // An invoice is billed to someone from the start (billTo), and a subscription has its customer from the start (L2).
  invoice: { table: "invoices", noun: "invoice", perm: "payments", homes: ["client", "project"], sent: () => true },
  subscription: { table: "subscriptions", noun: "subscription", perm: "payments", homes: ["client", "project"], sent: () => true },
  briefing: { table: "briefings", noun: "briefing", perm: "production", homes: ["project"], fixed: (d) => (d.bookingId ? "This briefing is for a booking: it stays with that booking's project." : null) },
  lead: { table: "deals", noun: "lead", perm: "clients", homes: ["client"] },
} as const satisfies Record<string, KindDef>;
export type Kind = keyof typeof KINDS;
const kindArg = v.union(...(Object.keys(KINDS) as Kind[]).map((k) => v.literal(k)));

/** The fields a kind's home is written to. */
const FIELD: Record<HomeType, "clientId" | "projectId" | "shootId" | "dealId"> = { client: "clientId", project: "projectId", shoot: "shootId", lead: "dealId" };
const has = (k: Kind, t: HomeType) => (KINDS[k].homes as readonly HomeType[]).includes(t);

/** A thing's home as it stands (the nearest one set). */
export function homeOf(k: Kind, d: Record<string, unknown>): Home {
  for (const t of ["shoot", "project", "lead", "client"] as HomeType[]) if (has(k, t) && d[FIELD[t]]) return { type: t, id: String(d[FIELD[t]]) };
  return null;
}

// ---------- resolving a place ----------

type Place = { type: HomeType; id: string; clientId: Id<"clients"> | null; projectId: Id<"projects"> | null; shoot: Doc<"shoots"> | null; dealId: Id<"deals"> | null; name: string };

async function resolve(ctx: Ctx, h: NonNullable<Home>): Promise<Place> {
  const missing = () => { throw new ConvexError("That place isn't here any more."); };
  if (h.type === "client") {
    const id = ctx.db.normalizeId("clients", h.id); const c = id ? await ctx.db.get(id) : null;
    if (!c) missing();
    return { type: "client", id: c!._id, clientId: c!._id, projectId: null, shoot: null, dealId: null, name: c!.name };
  }
  if (h.type === "project") {
    const id = ctx.db.normalizeId("projects", h.id); const p = id ? await ctx.db.get(id) : null;
    if (!p) missing();
    return { type: "project", id: p!._id, clientId: p!.clientId ?? null, projectId: p!._id, shoot: null, dealId: null, name: label(p!) };
  }
  if (h.type === "shoot") {
    const id = ctx.db.normalizeId("shoots", h.id); const s = id ? await ctx.db.get(id) : null;
    if (!s || s.status !== "scheduled") missing();
    const p = await (s!.projectId ? ctx.db.get(s!.projectId) : null);
    return { type: "shoot", id: s!._id, clientId: p?.clientId ?? null, projectId: s!.projectId ?? null, shoot: s!, dealId: null, name: `${p ? label(p) : "Shoot"} · ${s!.date}` };
  }
  const id = ctx.db.normalizeId("deals", h.id); const d = id ? await ctx.db.get(id) : null;
  if (!d) missing();
  return { type: "lead", id: d!._id, clientId: d!.clientId ?? null, projectId: null, shoot: null, dealId: d!._id, name: d!.title };
}

/** The client a thing is with now (read through its home, or its own clientId for money documents). */
async function clientNow(ctx: Ctx, d: Record<string, unknown>): Promise<string | null> {
  if (d.clientId) return String(d.clientId);
  if (d.projectId) return String((await ctx.db.get(d.projectId as Id<"projects">))?.clientId ?? "") || null;
  if (d.dealId) return String((await ctx.db.get(d.dealId as Id<"deals">))?.clientId ?? "") || null;
  return null;
}

// ---------- Attach / Move one thing ----------

/** The patch that gives `d` (of kind `k`) the home `to`, after every rule. Shared by `move` and `moveProject`. */
async function patchFor(ctx: MutationCtx, k: Kind, d: Record<string, unknown> & { _id: string }, to: Place | null) {
  const def = KINDS[k] as KindDef;
  if (to && !has(k, to.type)) throw new ConvexError(`A ${def.noun} can't go on a ${to.type === "lead" ? "lead" : to.type === "shoot" ? "shoot day" : to.type}.`);
  const why = def.fixed?.(d);
  if (why) throw new ConvexError(why);
  if (def.sent?.(d)) {
    const was = await clientNow(ctx, d);
    if (was && (!to || String(to.clientId ?? "") !== was)) throw new ConvexError(`This ${def.noun} is addressed to someone or already sent: it stays with the client it's for. File it under one of their projects, or under the client.`);
  }
  const patch: Record<string, unknown> = {};
  for (const t of def.homes) patch[FIELD[t]] = undefined;
  if (to) {
    if (k === "shotList") {
      // One list per shoot day (D179); on a shoot day it lives on that shoot's project.
      if (to.type === "shoot") {
        const other = (await ctx.db.query("shotLists").withIndex("by_shoot", (q) => q.eq("shootId", to.shoot!._id)).collect()).find((x) => x._id !== d._id);
        if (other) throw new ConvexError("That shoot day already has a shot list.");
        patch.projectId = to.projectId ?? undefined; patch.shootId = to.shoot!._id;
      } else patch.projectId = to.projectId ?? undefined;
    } else {
      patch[FIELD[to.type]] = to.type === "shoot" ? to.shoot!._id : to.id;
      // Money documents keep their client in step with their home (the code that sends them reads it).
      if (has(k, "client") && to.type !== "client") patch.clientId = to.clientId ?? undefined;
    }
  } else if (k === "shotList" && !d.title) patch.title = "Shot list"; // a list on its own needs a name
  return patch;
}

/** The switch each kind of place needs (review M1): a caller only sees and uses places their switches cover. */
const PLACE_PERM: Record<HomeType, Perm> = { client: "clients", lead: "clients", project: "projects", shoot: "shoots" };
async function canPlace(ctx: Ctx, t: HomeType) { try { await requireAll(ctx, PLACE_PERM[t]); return true; } catch { return false; } }

export const move = mutation({
  args: { kind: kindArg, id: v.string(), to: v.union(v.null(), v.object({ type: v.union(v.literal("client"), v.literal("project"), v.literal("shoot"), v.literal("lead")), id: v.string() })) },
  handler: async (ctx, a) => {
    const def = KINDS[a.kind as Kind] as KindDef;
    await requireAll(ctx, def.perm);
    const id = ctx.db.normalizeId(def.table, a.id);
    const d = id ? (await ctx.db.get(id)) as (Record<string, unknown> & { _id: string }) | null : null;
    if (!d) throw new ConvexError(`This ${def.noun} isn't here any more.`);
    if (a.to && !(await canPlace(ctx, a.to.type))) throw new ConvexError("Not allowed.");
    const to = a.to ? await resolve(ctx, a.to) : null;
    const patch = await patchFor(ctx, a.kind as Kind, d, to);
    await ctx.db.patch(d._id as never, patch as never);
    if (a.kind === "shoot") {
      // A new client: the old client's confirmation goes, and the calendar event is brought up to date (review M4).
      const was = await clientNow(ctx, d);
      if (String(was) !== String(to?.clientId ?? null)) await clientChanged(ctx, d._id as Id<"shoots">, await clientName(ctx, was), to?.clientId ?? null);
      else if (String(d.projectId ?? "") !== String(to?.projectId ?? "")) await recal(ctx, d._id as Id<"shoots">); // re-review L-f
      // Its day-of things go with it: the call sheet and the shot list live on the shoot's project.
      for (const cs of await ctx.db.query("callSheets").withIndex("by_shoot", (q) => q.eq("shootId", d._id as Id<"shoots">)).collect()) await ctx.db.patch(cs._id, { projectId: to?.projectId ?? undefined });
      for (const l of await ctx.db.query("shotLists").withIndex("by_shoot", (q) => q.eq("shootId", d._id as Id<"shoots">)).collect()) await ctx.db.patch(l._id, { projectId: to?.projectId ?? undefined });
    }
    // A lead moved to another client takes its unaddressed quotes, proposals and estimates along; the rest stay with
    // their client and leave the lead (review M7).
    if (a.kind === "lead" && String(d.clientId ?? "") !== String(to?.clientId ?? "")) {
      const docs: Array<{ def2: KindDef; r: Record<string, unknown> & { _id: string } }> = [];
      for (const k of ["quote", "proposal", "estimate"] as Kind[]) {
        const def2 = KINDS[k] as KindDef;
        for (const r of (await ctx.db.query(def2.table as "quotes").withIndex("by_deal", (q) => q.eq("dealId", d._id as Id<"deals">)).collect()) as Array<Record<string, unknown> & { _id: string }>) docs.push({ def2, r });
      }
      // Re-review L-b: the lead's quotes need Payments and its proposals Docs, as when moving them one by one.
      for (const perm of new Set(docs.map((x) => x.def2.perm))) await requireAll(ctx, perm);
      for (const { def2, r } of docs) {
        const theirs = (r.clientId as Id<"clients"> | undefined) ?? (d.clientId as Id<"clients"> | undefined);
        // Addressed or sent with a client to stay with: it stays and leaves the lead. With no client anywhere it goes
        // with the lead (re-review M-e). The rest follow.
        if (def2.sent?.(r) && theirs) await ctx.db.patch(r._id as Id<"quotes">, { dealId: undefined, clientId: theirs } as never);
        else await ctx.db.patch(r._id as Id<"quotes">, { clientId: to?.clientId ?? undefined } as never);
      }
    }
    const name = String(d.title ?? d.number ?? (a.kind === "shoot" ? `${d.date} · ${d.location}` : def.noun));
    await audit(ctx, { kind: "moved", text: to ? `Moved ${def.noun} "${name}" to ${to.name}` : `Took ${def.noun} "${name}" off its ${homeOf(a.kind as Kind, d)?.type ?? "home"} (on its own now)` });
    return null;
  },
});

// A shoot whose call sheet was sent moves too (Heston, Nov 16: "able to move no problem"): its crew and guests keep
// reading it; the old client's people lose it with the project (callSheets.clientSheet checks their projects).
/** Review M4: a shoot now with another client (or none) loses the old client's confirmation. Its calendar event is
 *  rewritten with "none": Google emails nobody (rule 3; re-review H). Ask to confirm stays the owner's own click. */
async function clientChanged(ctx: MutationCtx, shootId: Id<"shoots">, from: string | null, to: Id<"clients"> | null) {
  const s = await ctx.db.get(shootId);
  if (!s) return;
  // Heston (Nov 16): the new client's people join the calendar event, and are told, only when he presses Ask to confirm.
  await ctx.db.patch(s._id, { confirmed: undefined, moved: undefined, clientHold: to ? { at: Date.now(), ...(from ? { from } : {}) } : undefined });
  await recal(ctx, shootId);
}
const clientName = async (ctx: Ctx, id: string | null) => (id ? (await ctx.db.get(id as Id<"clients">))?.name ?? null : null);
/** The shoot's calendar event brought up to date quietly (a new project name and link, its guests), emailing nobody. */
async function recal(ctx: MutationCtx, shootId: Id<"shoots">) {
  const s = await ctx.db.get(shootId);
  if (!s || !(s.calendar || s.calendarEvent)) return;
  await ctx.db.patch(s._id, { calAt: Date.now() });
  await queueCalendar(ctx, s._id, "none");
}

// ---------- Move a project (D204: everything on it goes with it) ----------

const MONEY = ["quote", "estimate", "proposal", "invoice", "subscription"] as Kind[];

/** What moving a project takes along and what stays (the confirmation: "Move Launch and its 11 things to Northline?"). */
async function projectContents(ctx: Ctx, p: Doc<"projects">) {
  const sentStay: Array<{ kind: Kind; id: string; name: string }> = [];
  let moving = 0, money = 0;
  for (const k of MONEY) {
    const t = KINDS[k].table as "quotes";
    const rows = (await ctx.db.query(t).collect()).filter((x) => (x as { projectId?: string }).projectId === p._id) as Array<Record<string, unknown> & { _id: string }>;
    for (const r of rows) {
      if (k !== "estimate") money++;
      // Addressed or sent: it stays with its client (H3: the project's old one when it has none of its own). One with no
      // client anywhere leaves the project and stays unattached (re-review M-d: the new client never sees it).
      if ((KINDS[k] as KindDef).sent?.(r)) sentStay.push({ kind: k, id: r._id, name: String(r.title ?? r.number ?? KINDS[k].noun) });
      else moving++;
    }
  }
  for (const t of ["shoots", "shotLists", "briefings", "briefs", "fileRequests", "vendorBookings", "videos", "callSheets"] as const)
    moving += (await ctx.db.query(t).withIndex("by_project" as never, ((q: { eq: (f: string, v: unknown) => unknown }) => q.eq("projectId", p._id)) as never).collect()).length;
  return { moving, sentStay, money };
}

/** Review M2: a project carrying quotes, proposals, invoices or subscriptions also needs the Payments switch to move. */
async function mayMoveProject(ctx: Ctx, p: Doc<"projects">, toClient = true) {
  await requireAll(ctx, "projects");
  if (toClient) await requireAll(ctx, "clients"); // re-review L-h: as filing anything under a client (M1)
  if ((await projectContents(ctx, p)).money) await requireAll(ctx, "payments");
}

/**
 * Moves project `p` to client `to` (or on its own), with everything on it (D204). The one way a project's client
 * changes (review M3): Move, the project's name dialog, the register and Dropbox all come here. Callers check access.
 */
export async function moveProjectCore(ctx: MutationCtx, p: Doc<"projects">, to: Doc<"clients"> | null) {
  if ((p.clientId ?? null) === (to?._id ?? null)) return { moved: 0, stayed: 0, sharesOff: 0 };
  // Review M5: footage kept or paid for is the client's; it can't follow the project to someone else.
  const fs = await ctx.db.query("footageStorage").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect();
  if (p.clientId && fs.some((f) => f.status === "kept" || f.status === "paid"))
    throw new ConvexError(`${p.client ?? "The client"} is keeping this project's footage: it stays with them.`);
  const { sentStay } = await projectContents(ctx, p);
  const stay = new Set(sentStay.map((x) => x.id));
  for (const k of MONEY) {
    const t = KINDS[k].table as "quotes";
    for (const r of (await ctx.db.query(t).collect()).filter((x) => (x as { projectId?: string }).projectId === p._id)) {
      // Addressed or sent: it leaves the project and stays with the client it's for (H1, H3).
      if (stay.has(r._id)) await ctx.db.patch(r._id, { projectId: undefined, clientId: (r as { clientId?: Id<"clients"> }).clientId ?? p.clientId } as never);
      // The rest keep their client in step with the project's new one.
      else await ctx.db.patch(r._id, { clientId: to?._id } as never);
    }
  }
  // Review H2: the name first (the writer relinks a project's client by name), then the exact client picked.
  await ctx.db.patch(p._id, { client: to?.name });
  await ctx.db.patch(p._id, { clientId: to?._id });
  if (((await ctx.db.get(p._id))?.clientId ?? null) !== (to?._id ?? null)) throw new ConvexError("The project didn't take its new client. Nothing was moved.");
  // Review M4: its shoot days lose the old client's confirmation; their calendar events are brought up to date.
  for (const s of await ctx.db.query("shoots").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect())
    if (s.status === "scheduled") await clientChanged(ctx, s._id, p.client ?? null, to?._id ?? null);
  // Unconfirmed footage storage offers go to the new client (or none).
  // Its answer was the old client's: the new client sees a fresh offer (re-review L-c).
  for (const f of fs) if (f.status === "offered" || f.status === "declined") await ctx.db.patch(f._id, { clientId: to?._id, status: "offered", answeredBy: undefined, updatedAt: Date.now() });
  // The old client's people lose it at once: a project share made for them is turned off (client shares follow the
  // project's client by themselves). Review links shared for one cut stay as they are.
  let sharesOff = 0;
  for (const s of await ctx.db.query("shares").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect())
    if (s.kind === "project" && !s.offAt) { await ctx.db.patch(s._id, { offAt: Date.now() }); sharesOff++; }
  await audit(ctx, { kind: "moved", text: to ? `Moved project ${label(p)} to ${to.name}` : `Moved project ${label(p)} out of ${p.client ?? "its client"} (on its own now)` });
  return { moved: 1, stayed: sentStay.length, sharesOff };
}

/** A client change made by typing a name (the name dialog, the register, Dropbox): the client by that name, made if new. */
export async function moveProjectByName(ctx: MutationCtx, p: Doc<"projects">, name: string | undefined) {
  const n = (name ?? "").trim();
  if (n.toLowerCase() === (p.client ?? "").trim().toLowerCase()) return;
  const id = n ? await linkClient(ctx.db, p.businessId, n) : undefined;
  await moveProjectCore(ctx, p, id ? await ctx.db.get(id) : null);
}

/** Heston (Nov 16): Move warns when the old client has been active on the project. Their messages on its thread and
 *  their review notes go with it, and the new client's people can read them. */
async function oldClientActivity(ctx: Ctx, p: Doc<"projects">) {
  if (!p.clientId) return null;
  let messages = 0, notes = 0;
  const th = await ctx.db.query("msgThreads").withIndex("by_project", (q) => q.eq("projectId", p._id)).first();
  if (th) messages = (await ctx.db.query("messages").withIndex("by_thread", (q) => q.eq("threadId", th._id)).collect()).filter((m) => m.side === "client").length;
  for (const vid of await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect())
    notes += (await ctx.db.query("notes").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()).filter((n) => n.authorKind === "client").length;
  return messages || notes ? { name: p.client ?? null, messages, notes } : null;
}

export const projectMove = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    await requireAll(ctx, "projects");
    const id = ctx.db.normalizeId("projects", projectId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) return null;
    const c = await projectContents(ctx, p);
    let payments = true;
    try { await requireAll(ctx, "payments"); } catch { payments = false; }
    // Without Payments the money documents aren't named, and the move needs someone who has it.
    return { label: label(p), clientId: p.clientId ?? null, client: p.client ?? null, things: c.moving, staying: payments ? c.sentStay : [], needsPayments: !payments && c.money > 0, oldClient: await oldClientActivity(ctx, p) };
  },
});

export const moveProject = mutation({
  args: { projectId: v.string(), clientId: v.union(v.null(), v.string()) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const id = ctx.db.normalizeId("projects", a.projectId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) throw new ConvexError("This project doesn't exist any more.");
    await mayMoveProject(ctx, p, !!a.clientId);
    let to: Doc<"clients"> | null = null;
    if (a.clientId) {
      const cid = ctx.db.normalizeId("clients", a.clientId);
      to = cid ? await ctx.db.get(cid) : null;
      if (!to) throw new ConvexError("That client isn't here any more.");
    }
    return await moveProjectCore(ctx, p, to);
  },
});

export { mayMoveProject };

// ---------- the picker, and "Not attached" ----------

/** The Attach/Move picker: the places this kind can go (a shoot day that already has a list is marked for shot lists). */
export const places = query({
  args: { kind: kindArg },
  handler: async (ctx, { kind }) => {
    const def = KINDS[kind as Kind] as KindDef;
    await requireAll(ctx, def.perm);
    const out: Array<{ type: HomeType; id: string; name: string; sub: string | null; taken?: boolean }> = [];
    const ok = async (t: HomeType) => has(kind as Kind, t) && (await canPlace(ctx, t));
    if (await ok("client")) for (const c of await ctx.db.query("clients").collect()) out.push({ type: "client", id: c._id, name: c.name, sub: null });
    if (await ok("lead")) for (const d of await ctx.db.query("deals").collect()) out.push({ type: "lead", id: d._id, name: d.title, sub: "Lead" });
    const projects = await ctx.db.query("projects").collect();
    if (await ok("project")) for (const p of projects) out.push({ type: "project", id: p._id, name: label(p), sub: p.client ?? "On its own" });
    if (await ok("shoot")) {
      const taken = new Set((await ctx.db.query("shotLists").collect()).map((l) => String(l.shootId ?? "")));
      for (const s of await ctx.db.query("shoots").collect()) {
        if (s.status !== "scheduled") continue;
        const p = projects.find((x) => x._id === s.projectId);
        out.push({ type: "shoot", id: s._id, name: `${p ? label(p) : "Shoot"} · ${s.date}`, sub: s.location, ...(kind === "shotList" ? { taken: taken.has(s._id) } : {}) });
      }
    }
    return out;
  },
});

/** Projects › Not attached: everything with no home yet, newest first (each kind only for someone with its switch). */
export const loose = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "projects");
    const out: Array<{ kind: Kind; id: string; name: string; at: number }> = [];
    for (const k of Object.keys(KINDS) as Kind[]) {
      const def = KINDS[k] as KindDef;
      try { await requireAll(ctx, def.perm); } catch { continue; }
      for (const r of (await ctx.db.query(def.table).collect()) as Array<Record<string, unknown> & { _id: string; _creationTime: number }>)
        if (!homeOf(k, r)) out.push({ kind: k, id: r._id, name: String(r.title ?? r.number ?? def.noun), at: Number(r.updatedAt ?? r._creationTime) });
    }
    return out.sort((x, y) => y.at - x.at);
  },
});
