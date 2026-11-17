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
import { businessInScope } from "./lib/business";
import { audit } from "./lib/audit";
import { label } from "./lib/bookingRows";
import type { Perm } from "./lib/perms";
import { queueCalendar } from "./calendar";
import { linkClient } from "./lib/functions";
import { clientPeople } from "./lib/placed";

type Ctx = QueryCtx | MutationCtx;
export type HomeType = "client" | "project" | "shoot" | "lead";
export type Home = { type: HomeType; id: string } | null;

// ---------- the kinds (what can live where, the doc's table) ----------

type KindDef = {
  table: "shoots" | "shotLists" | "quotes" | "estimates" | "proposals" | "invoices" | "subscriptions" | "briefings" | "deals" | "briefs" | "fileRequests" | "creativeDocs" | "canvases" | "brandKits" | "tasks" | "todoLists";
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
  // Hierarchy 3c: made on their own as drafts; sent (by the owner's click) once on a project or a client. Once sent
  // they stay with that client, like money documents.
  brief: { table: "briefs", noun: "kickoff brief", perm: "projects", homes: ["client", "project"], sent: (d) => d.status !== "draft" },
  fileRequest: { table: "fileRequests", noun: "file request", perm: "projects", homes: ["client", "project"], sent: (d) => d.status !== "draft", fixed: (d) => (d.status === "cancelled" ? "That request was cancelled." : null) },
  // 5l (Creative planning): made on their own or anywhere, attached later. Never sent, so they move freely.
  creativeDoc: { table: "creativeDocs", noun: "creative doc", perm: "projects", homes: ["client", "project", "shoot", "lead"] },
  canvas: { table: "canvases", noun: "canvas", perm: "projects", homes: ["client", "project", "shoot", "lead"] },
  kit: { table: "brandKits", noun: "brand kit", perm: "projects", homes: ["client", "project", "lead"] },
  // 5m Work: tasks and to-do lists (a task's subtasks follow it).
  task: { table: "tasks", noun: "task", perm: "projects", homes: ["client", "project", "shoot", "lead"], fixed: (d) => (d.parentId ? "A subtask goes where its task goes." : null) },
  todoList: { table: "todoLists", noun: "to-do list", perm: "projects", homes: ["client", "project", "shoot", "lead"] },
} as const satisfies Record<string, KindDef>;
export type Kind = keyof typeof KINDS;
const MONEY = ["quote", "estimate", "proposal", "invoice", "subscription"] as Kind[];
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
    // 3c review L3: a sent brief or request with no client went to the people of where it was: it can only be let go.
    if (!was && (k === "brief" || k === "fileRequest") && to) throw new ConvexError(`This ${def.noun} was already sent: it stays where it is, or goes on its own.`);
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
      // Money documents keep their client in step with their home (the code that sends them reads it). A brief or file
      // request keeps clientId only when it's on a client itself (on a project, the project's client is read).
      if (has(k, "client") && to.type !== "client" && (MONEY as readonly string[]).includes(k)) patch.clientId = to.clientId ?? undefined;
      // One kickoff brief goes to a project.
      if (k === "brief" && to.type === "project" && d.status !== "draft" && (await ctx.db.query("briefs").withIndex("by_project", (q) => q.eq("projectId", to.id as Id<"projects">)).collect()).some((x) => x._id !== d._id && x.status !== "draft"))
        throw new ConvexError("That project already has its kickoff brief.");
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
    // Review M2: a creative thing that changes client stops being shared (the old client's people lose it).
    if (a.kind === "canvas" || a.kind === "creativeDoc" || a.kind === "kit") {
      const sh = d.shootId ? await ctx.db.get(d.shootId as Id<"shoots">) : null;
      const was = (await clientNow(ctx, d)) ?? (sh?.projectId ? String((await ctx.db.get(sh.projectId))?.clientId ?? "") || null : null);
      if (was && String(to?.clientId ?? "") !== was) await creativeLinksOff(ctx, a.kind, d._id, was as Id<"clients">);
    }
    // Delivery review M9: a shoot day or lead now with another client takes its boards, docs and kits out of sharing too.
    if ((a.kind === "shoot" || a.kind === "lead") && String((await clientNow(ctx, d)) ?? "") !== String(to?.clientId ?? "")) {
      const f = a.kind === "shoot" ? "shootId" : "dealId";
      for (const t of ["canvases", "creativeDocs", "brandKits"] as const)
        for (const r of (await ctx.db.query(t).collect()).filter((x) => String((x as Record<string, unknown>)[f] ?? "") === String(d._id)))
          await creativeLinksOff(ctx, t === "canvases" ? "canvas" : t === "creativeDocs" ? "creativeDoc" : "kit", r._id, (await clientNow(ctx, d)) as Id<"clients"> | null);
    }
    if (a.kind === "task") for (const sub of await ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentId", d._id as Id<"tasks">)).collect()) await ctx.db.patch(sub._id, patch as never);
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
    const name = a.kind === "creativeDoc" ? ((await ctx.db.get(d.buildId as Id<"wsBuilds">))?.title ?? def.noun) : String(d.title ?? d.name ?? d.number ?? (a.kind === "shoot" ? `${d.date} · ${d.location}` : def.noun));
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


/** Q5 (review L7): who counts as crew here (this business's vendors, archived ones aside) and who is a client's person
 *  here (anyone on a client's shares or review links, booked editors' own Review links aside, a client contact, or a
 *  client login of this business). Read once per change, however many boards it touches. */
const crewCache = new WeakMap<object, Promise<{ crew: Set<string>; theirs: Set<string> }>>();
function crewAndClients(ctx: MutationCtx) {
  let p = crewCache.get(ctx);
  if (!p) {
    p = (async () => {
      const crew = new Set((await ctx.db.query("vendors").collect()).filter((x) => !x.archivedAt).map((x) => (x.email ?? "").toLowerCase()).filter(Boolean));
      const editorShares = new Set((await ctx.db.query("vendorBookings").collect()).map((k) => String(k.reviewShareId ?? "")).filter(Boolean));
      const theirs = new Set<string>();
      for (const s of await ctx.db.query("shares").collect()) {
        if (editorShares.has(String(s._id))) continue;
        for (const m of await ctx.db.query("shareMembers").withIndex("by_share", (q) => q.eq("shareId", s._id)).collect()) theirs.add(m.email.toLowerCase());
      }
      for (const x of await ctx.db.query("clientPeople").collect()) theirs.add(x.email.toLowerCase());
      const biz = businessInScope(ctx);
      for (const m of await ctx.db.query("memberships").collect()) if (m.role === "client" && !m.revokedAt && (!biz || m.businessId === biz)) theirs.add(m.email.toLowerCase());
      for (const i of await ctx.db.query("invites").collect()) if (!i.revokedAt && (!biz || i.businessId === biz)) theirs.add(String(i.email ?? "").toLowerCase());
      return { crew, theirs };
    })();
    crewCache.set(ctx, p);
  }
  return p.then((x) => ({ crew: x.crew, theirs: new Set(x.theirs) }));
}

/** Review M2 (Nov 17): a canvas, creative doc or brand kit leaving a client: its share links stop (the old client's
 *  people lose it at once, as with a project's review links). The owner can share again. Returns how many stopped.
 *  Heston (Nov 17, Q5): on a board, crew keep their links (they work for the business, not the client): a person whose
 *  email is one of the business's vendors and isn't a client's person here (crewAndClients). The view-only link stops. */
async function creativeLinksOff(ctx: MutationCtx, kind: "canvas" | "creativeDoc" | "kit", id: string, from?: Id<"clients"> | null) {
  let n = 0;
  if (kind === "canvas") {
    const c = await ctx.db.get(id as Id<"canvases">);
    if (c?.link?.on) { await ctx.db.patch(c._id, { link: { ...c.link, on: false } }); n++; }
    const { crew, theirs } = await crewAndClients(ctx);
    const old = from ? await ctx.db.get(from) : null;
    if (old) for (const x of await clientPeople(ctx, old)) theirs.add(x.email.toLowerCase());
    for (const pp of await ctx.db.query("canvasPeople").withIndex("by_canvas", (q) => q.eq("canvasId", id as Id<"canvases">)).collect()) {
      const e = pp.email.toLowerCase();
      if (crew.has(e) && !theirs.has(e)) continue;
      await ctx.db.delete(pp._id); n++;
    }
  } else if (kind === "creativeDoc") {
    const d = await ctx.db.get(id as Id<"creativeDocs">);
    if (d?.share?.on) { await ctx.db.patch(d._id, { share: { ...d.share, on: false } }); n++; }
  } else {
    const k = await ctx.db.get(id as Id<"brandKits">);
    if (k?.share?.on) { await ctx.db.patch(k._id, { share: { ...k.share, on: false } }); n++; }
  }
  return n;
}

// ---------- Move a project (D204: everything on it goes with it) ----------


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
  // 3c review H: a sent kickoff brief or file request holds the client's answers and files: it stays with that client
  // (at client level), like sent money documents; drafts go with the project.
  for (const k of ["brief", "fileRequest"] as Kind[])
    for (const r of (await ctx.db.query(KINDS[k].table as "briefs").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()) as Array<Record<string, unknown> & { _id: string }>) {
      if ((KINDS[k] as KindDef).sent?.(r)) sentStay.push({ kind: k, id: r._id, name: k === "brief" ? "Kickoff brief" : String(r.title ?? "File request") });
      else moving++;
    }
  for (const t of ["shoots", "shotLists", "briefings", "vendorBookings", "videos", "callSheets", "creativeDocs", "canvases", "brandKits", "tasks", "todoLists"] as const)
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
  // Sent briefs and requests leave the project for its old client (or for no home, when it had none).
  for (const x of sentStay) if (x.kind === "brief" || x.kind === "fileRequest") await ctx.db.patch(x.id as Id<"briefs">, { projectId: undefined, clientId: p.clientId } as never);
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
  // The old client's people lose it at once: its project shares and the review links shared for one of its cuts are
  // turned off (Heston, Nov 16, "Approved"); the owner can share again. Client shares follow the project's client.
  let sharesOff = 0;
  const off = async (sh: Doc<"shares">) => { if (!sh.offAt && sh.kind !== "client") { await ctx.db.patch(sh._id, { offAt: Date.now() }); sharesOff++; } };
  if (p.clientId) {
    // A booked editor's Review access is a project share too: it isn't the client's, so it stays (3c review, older).
    const crew = new Set((await ctx.db.query("vendorBookings").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).map((k) => String(k.reviewShareId ?? "")));
    for (const sh of await ctx.db.query("shares").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()) if (!crew.has(sh._id)) await off(sh);
    for (const vid of await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect())
      for (const sh of await ctx.db.query("shares").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()) await off((await ctx.db.get(sh._id))!);
  }
  // Review M2: boards, creative docs and brand kits on it (or on its shoot days) stop being shared.
  if (p.clientId) {
    const shootIds = new Set((await ctx.db.query("shoots").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).map((x) => String(x._id)));
    const on = (r: { projectId?: Id<"projects">; shootId?: Id<"shoots"> }) => r.projectId === p._id || (!!r.shootId && shootIds.has(String(r.shootId)));
    for (const c of (await ctx.db.query("canvases").collect()).filter(on)) sharesOff += await creativeLinksOff(ctx, "canvas", c._id, p.clientId);
    for (const c of (await ctx.db.query("creativeDocs").collect()).filter(on)) sharesOff += await creativeLinksOff(ctx, "creativeDoc", c._id);
    for (const c of (await ctx.db.query("brandKits").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect())) sharesOff += await creativeLinksOff(ctx, "kit", c._id);
  }
  // 5n: links the old client's people made to its Delivery stop working too.
  if (p.clientId) for (const dl of await ctx.db.query("deliveries").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect())
    for (const l of await ctx.db.query("deliveryLinks").withIndex("by_delivery", (q) => q.eq("deliveryId", dl._id)).collect()) if (l.on) { await ctx.db.patch(l._id, { on: false }); sharesOff++; }
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

// ---------- Projects (the new menu's Projects page: by client, with "On their own") ----------

const STAGE_NAME: Record<string, string> = { discovery: "Discovery", strategy: "Strategy", production: "Production", polish: "Polish", delivery: "Delivery" };

/** Every project with its client (or none), stage and a one-line summary; the clients with projects; the loose count. */
export const projectsBoard = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "projects");
    const projects = await ctx.db.query("projects").collect();
    const clients = new Map((await ctx.db.query("clients").collect()).map((c) => [c._id as string, c]));
    const count = new Map<string, { shoots: number; next: string | null; lists: number; docs: number; cuts: number }>();
    const of = (id: string | undefined) => { if (!id) return null; let c = count.get(id); if (!c) count.set(id, (c = { shoots: 0, next: null, lists: 0, docs: 0, cuts: 0 })); return c; };
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    for (const s of await ctx.db.query("shoots").collect()) {
      const c = of(s.projectId); if (!c || s.status !== "scheduled") continue;
      c.shoots++; if (s.date >= today && (!c.next || s.date < c.next)) c.next = s.date;
    }
    for (const l of await ctx.db.query("shotLists").collect()) { const c = of(l.projectId); if (c) c.lists++; }
    for (const t of ["quotes", "proposals", "invoices", "briefs", "fileRequests"] as const)
      for (const d of (await ctx.db.query(t).collect()) as Array<{ projectId?: Id<"projects"> }>) { const c = of(d.projectId); if (c) c.docs++; }
    for (const v of await ctx.db.query("videos").collect()) { const c = of(v.projectId); if (c) c.cuts++; }
    let loose = 0;
    for (const k of Object.keys(KINDS) as Kind[]) {
      const def = KINDS[k] as KindDef;
      try { await requireAll(ctx, def.perm); } catch { continue; }
      for (const r of (await ctx.db.query(def.table).collect()) as Array<Record<string, unknown>>) if (!homeOf(k, r) && r.status !== "cancelled" && !(k === "task" && (r.parentId || r.status === "done"))) loose++;
    }
    return {
      today, loose,
      projects: projects.map((p) => {
        const c = count.get(p._id) ?? { shoots: 0, next: null, lists: 0, docs: 0, cuts: 0 };
        const cl = p.clientId ? clients.get(p.clientId) : undefined;
        return { _id: p._id, label: label(p), clientId: cl?._id ?? null, client: cl?.name ?? null, stage: p.stage ?? "discovery", stageName: STAGE_NAME[p.stage ?? "discovery"], ...c, updatedAt: p.updatedAt ?? p.createdAt };
      }).sort((a, b) => b.updatedAt - a.updatedAt),
    };
  },
});

/** The clients a project can move to (Move to client…). */
export const clientChoices = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "projects"); await requireAll(ctx, "clients"); // both (a list passes on either)
    return (await ctx.db.query("clients").collect()).map((c) => ({ _id: c._id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  },
});

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
        if (!homeOf(k, r) && r.status !== "cancelled" && !(k === "task" && (r.parentId || r.status === "done"))) out.push({ kind: k, id: r._id, name: k === "creativeDoc" ? ((await ctx.db.get(r.buildId as Id<"wsBuilds">))?.title ?? def.noun) : String(r.title ?? r.name ?? r.number ?? def.noun), at: Number(r.updatedAt ?? r._creationTime) });
    }
    return out.sort((x, y) => y.at - x.at);
  },
});
