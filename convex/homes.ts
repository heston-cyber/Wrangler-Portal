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

type Ctx = QueryCtx | MutationCtx;
export type HomeType = "client" | "project" | "shoot" | "lead";
export type Home = { type: HomeType; id: string } | null;

// ---------- the kinds (what can live where, the doc's table) ----------

type KindDef = {
  table: "shoots" | "shotLists" | "quotes" | "estimates" | "proposals" | "invoices" | "subscriptions" | "briefings" | "deals";
  noun: string;
  perm: Perm;
  homes: HomeType[];
  /** Already in a client's hands: it can file under another project of the same client, never leave that client. */
  sent?: (d: Record<string, unknown>) => boolean;
  /** A reason it can't move at all (e.g. a briefing tied to a booking). */
  fixed?: (d: Record<string, unknown>) => string | null;
};
export const KINDS = {
  // D205: a shoot day moves between projects (or to none) with its call sheet and shot list; crew booked on its
  // project keep it there.
  shoot: { table: "shoots", noun: "shoot", perm: "shoots", homes: ["project"], fixed: (d) => (Array.isArray(d.crew) && (d.crew as Array<{ bookingId?: string }>).some((c) => c.bookingId) ? "Crew booked on this project are on this shoot: take them off it first." : d.status !== "scheduled" ? "That shoot was cancelled." : null) },
  shotList: { table: "shotLists", noun: "shot list", perm: "shoots", homes: ["project", "shoot"] },
  quote: { table: "quotes", noun: "quote", perm: "payments", homes: ["lead", "client", "project"], sent: (d) => d.status !== "draft" },
  estimate: { table: "estimates", noun: "estimate", perm: "clients", homes: ["lead", "client", "project"] },
  proposal: { table: "proposals", noun: "proposal", perm: "docs", homes: ["lead", "client", "project"], sent: (d) => !["draft", "waiting", "ready"].includes(String(d.status)) },
  invoice: { table: "invoices", noun: "invoice", perm: "payments", homes: ["client", "project"], sent: (d) => d.status !== "draft" },
  subscription: { table: "subscriptions", noun: "subscription", perm: "payments", homes: ["client", "project"], sent: (d) => d.status !== "starting" },
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
    if (was && (!to || String(to.clientId ?? "") !== was)) throw new ConvexError(`This ${def.noun} was already sent: it stays with the client it went to. File it under one of their projects, or under the client.`);
  }
  const patch: Record<string, unknown> = {};
  for (const t of def.homes) patch[FIELD[t]] = undefined;
  if (to) {
    if (k === "shotList") {
      // One list per shoot day (D179); on a shoot day it lives on that shoot's project.
      if (to.type === "shoot") {
        const other = (await ctx.db.query("shotLists").withIndex("by_shoot", (q) => q.eq("shootId", to.shoot!._id)).collect()).find((x) => x._id !== d._id);
        if (other) throw new ConvexError("That shoot day already has a shot list.");
        patch.projectId = to.projectId; patch.shootId = to.shoot!._id;
      } else patch.projectId = to.projectId;
    } else {
      patch[FIELD[to.type]] = to.type === "shoot" ? to.shoot!._id : to.id;
      // Money documents keep their client in step with their home (the code that sends them reads it).
      if (has(k, "client") && to.type !== "client") patch.clientId = to.clientId ?? undefined;
    }
  } else if (k === "shotList" && !d.title) patch.title = "Shot list"; // a list on its own needs a name
  return patch;
}

export const move = mutation({
  args: { kind: kindArg, id: v.string(), to: v.union(v.null(), v.object({ type: v.union(v.literal("client"), v.literal("project"), v.literal("shoot"), v.literal("lead")), id: v.string() })) },
  handler: async (ctx, a) => {
    const def = KINDS[a.kind as Kind] as KindDef;
    await requireAll(ctx, def.perm);
    const id = ctx.db.normalizeId(def.table, a.id);
    const d = id ? (await ctx.db.get(id)) as (Record<string, unknown> & { _id: string }) | null : null;
    if (!d) throw new ConvexError(`This ${def.noun} isn't here any more.`);
    const to = a.to ? await resolve(ctx, a.to) : null;
    const patch = await patchFor(ctx, a.kind as Kind, d, to);
    await ctx.db.patch(d._id as never, patch as never);
    if (a.kind === "shoot") {
      // Its day-of things go with it: the call sheet and the shot list live on the shoot's project.
      for (const cs of await ctx.db.query("callSheets").withIndex("by_shoot", (q) => q.eq("shootId", d._id as Id<"shoots">)).collect()) await ctx.db.patch(cs._id, { projectId: to?.projectId ?? undefined });
      for (const l of await ctx.db.query("shotLists").withIndex("by_shoot", (q) => q.eq("shootId", d._id as Id<"shoots">)).collect()) await ctx.db.patch(l._id, { projectId: to?.projectId ?? undefined });
    }
    const name = String(d.title ?? d.number ?? (a.kind === "shoot" ? `${d.date} · ${d.location}` : def.noun));
    await audit(ctx, { kind: "moved", text: to ? `Moved ${def.noun} "${name}" to ${to.name}` : `Took ${def.noun} "${name}" off its ${homeOf(a.kind as Kind, d)?.type ?? "home"} (on its own now)` });
    return null;
  },
});

// ---------- Move a project (D204: everything on it goes with it) ----------

/** What moving a project takes along and what stays (the confirmation: "Move Launch and its 11 things to Northline?"). */
async function projectContents(ctx: Ctx, p: Doc<"projects">) {
  const sentStay: Array<{ kind: Kind; id: string; name: string }> = [];
  let moving = 0;
  for (const k of ["quote", "estimate", "proposal", "invoice", "subscription"] as Kind[]) {
    const t = KINDS[k].table as "quotes";
    const rows = (await ctx.db.query(t).collect()).filter((x) => (x as { projectId?: string }).projectId === p._id) as Array<Record<string, unknown> & { _id: string }>;
    for (const r of rows) {
      if ((KINDS[k] as KindDef).sent?.(r)) sentStay.push({ kind: k, id: r._id, name: String(r.title ?? r.number ?? KINDS[k].noun) });
      else moving++;
    }
  }
  for (const t of ["shoots", "shotLists", "briefings", "briefs", "fileRequests", "vendorBookings", "videos", "callSheets"] as const)
    moving += (await ctx.db.query(t).withIndex("by_project" as never, ((q: { eq: (f: string, v: unknown) => unknown }) => q.eq("projectId", p._id)) as never).collect()).length;
  return { moving, sentStay };
}

export const projectMove = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    await requireAll(ctx, "projects");
    const id = ctx.db.normalizeId("projects", projectId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) return null;
    const c = await projectContents(ctx, p);
    return { label: label(p), clientId: p.clientId ?? null, client: p.client ?? null, things: c.moving, staying: c.sentStay };
  },
});

export const moveProject = mutation({
  args: { projectId: v.string(), clientId: v.union(v.null(), v.string()) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const id = ctx.db.normalizeId("projects", a.projectId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) throw new ConvexError("This project doesn't exist any more.");
    let to: Doc<"clients"> | null = null;
    if (a.clientId) {
      const cid = ctx.db.normalizeId("clients", a.clientId);
      to = cid ? await ctx.db.get(cid) : null;
      if (!to) throw new ConvexError("That client isn't here any more.");
    }
    if ((p.clientId ?? null) === (to?._id ?? null)) return { moved: 0, stayed: 0 };
    const { sentStay } = await projectContents(ctx, p);
    // Money documents already sent stay with the client they went to: they leave the project, keeping that client.
    for (const s of sentStay) await ctx.db.patch(s.id as Id<"quotes">, { projectId: undefined } as never);
    // The rest keep their client in step with the project's new one.
    for (const k of ["quote", "estimate", "proposal", "invoice", "subscription"] as Kind[]) {
      const t = KINDS[k].table as "quotes";
      for (const r of (await ctx.db.query(t).collect()).filter((x) => (x as { projectId?: string }).projectId === p._id))
        await ctx.db.patch(r._id, { clientId: to?._id } as never);
    }
    await ctx.db.patch(p._id, { clientId: to?._id, client: to?.name });
    // The old client's people lose it at once: a project share made for them is turned off (client shares follow the
    // project's client by themselves). Review links shared for one cut stay as they are.
    let sharesOff = 0;
    for (const s of await ctx.db.query("shares").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect())
      if (s.kind === "project" && !s.offAt) { await ctx.db.patch(s._id, { offAt: Date.now() }); sharesOff++; }
    await audit(ctx, { kind: "moved", text: to ? `Moved project ${label(p)} to ${to.name}` : `Moved project ${label(p)} out of ${p.client ?? "its client"} (on its own now)` });
    return { moved: 1, stayed: sentStay.length, sharesOff };
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
    if (has(kind as Kind, "client")) for (const c of await ctx.db.query("clients").collect()) out.push({ type: "client", id: c._id, name: c.name, sub: null });
    if (has(kind as Kind, "lead")) for (const d of await ctx.db.query("deals").collect()) out.push({ type: "lead", id: d._id, name: d.title, sub: "Lead" });
    const projects = await ctx.db.query("projects").collect();
    if (has(kind as Kind, "project")) for (const p of projects) out.push({ type: "project", id: p._id, name: label(p), sub: p.client ?? "On its own" });
    if (has(kind as Kind, "shoot")) {
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
