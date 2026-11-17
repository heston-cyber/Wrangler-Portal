// Shot lists (Nov 16; D179–D182; frames "5h / …" in the Design Log's "Handoff ready: Shot lists").
//   - D179: one list per shoot day. A list is made on a project in pre-pro and linked to one of the project's shoots
//     once that day is scheduled; a shoot has at most one list. A setup can move to another day's list.
//   - The owner (and a team member with Shoots and call sheets) writes and ticks; D180: the shoot's booked crew can
//     also tick, from a call sheet that was sent to them (vendorPortal.tickShot), when the sheet's block allows it.
//     Clients and guests only read it, on their call sheet.
//   - D182: a tick carries the time it was made on the phone; one made offline lands when it arrives, unless a newer
//     tick of that shot, or a Reset, came in after it (lib/shotList.ts tickLands).
import { mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAll } from "./lib/access";
import { label } from "./lib/bookingRows";
import { MAX_PASTE, MAX_SETUPS, MAX_SHOTS, NOTE_MAX, TEXT_MAX, initialsOf, isTime, nextCode, parsePaste, progress, serverTime, shotBlocks, tickLands, tidy } from "./lib/shotList";

type Ctx = QueryCtx | MutationCtx;
type List = Doc<"shotLists">;

// ---------- reading ----------

const setupsOf = async (ctx: Ctx, listId: Id<"shotLists">) => ctx.db.query("shotSetups").withIndex("by_list", (q) => q.eq("listId", listId)).collect();
const shotsOf = async (ctx: Ctx, listId: Id<"shotLists">) => ctx.db.query("shots").withIndex("by_list", (q) => q.eq("listId", listId)).collect();

/** The project's scheduled shoots in date order, numbered Day 1, Day 2 … */
export async function shootDays(ctx: Ctx, projectId: Id<"projects"> | undefined) {
  if (!projectId) return [];
  const shoots = (await ctx.db.query("shoots").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect()).filter((s) => s.status === "scheduled");
  return shoots.sort((a, b) => a.date.localeCompare(b.date) || a.call.localeCompare(b.call)).map((s, i) => ({ s, day: i + 1 }));
}

/** One list, as every page shows it: its setups in order, each with its shots, and the day it's for. */
export async function listView(ctx: Ctx, list: List) {
  const setups = (await setupsOf(ctx, list._id)).sort((a, b) => a.order - b.order);
  const shots = (await shotsOf(ctx, list._id)).sort((a, b) => a.order - b.order);
  const days = await shootDays(ctx, list.projectId);
  const d = list.shootId ? days.find((x) => x.s._id === list.shootId) : undefined;
  const p = list.projectId ? await ctx.db.get(list.projectId) : null;
  return {
    _id: list._id, title: list.title ?? null, project: p ? { _id: p._id, label: label(p), name: p.name, client: p.client ?? null } : null,
    shoot: d ? { _id: d.s._id, day: d.day, date: d.s.date, call: d.s.call, wrap: d.s.wrap ?? null, location: d.s.location } : null,
    ...progress(shots),
    setups: setups.map((x) => ({
      _id: x._id, gap: !!x.gap, code: x.code ?? null, start: x.start ?? null, end: x.end ?? null, title: x.title, note: x.note ?? null,
      shots: shots.filter((s) => s.setupId === x._id).map((s) => ({ _id: s._id, number: s.number, text: s.text, note: s.note ?? null, done: s.done ? { name: s.done.name, initials: s.done.initials } : null })),
    })),
  };
}

async function ownList(ctx: Ctx, listId: string) {
  const id = ctx.db.normalizeId("shotLists", listId);
  const l = id ? await ctx.db.get(id) : null;
  if (!l) throw new ConvexError("This shot list isn't here any more.");
  return l;
}
async function ownSetup(ctx: Ctx, setupId: string) {
  const id = ctx.db.normalizeId("shotSetups", setupId);
  const x = id ? await ctx.db.get(id) : null;
  if (!x) throw new ConvexError("This setup isn't here any more.");
  return { x, l: await ownList(ctx, x.listId) };
}
async function ownShot(ctx: Ctx, shotId: string) {
  const id = ctx.db.normalizeId("shots", shotId);
  const s = id ? await ctx.db.get(id) : null;
  if (!s) throw new ConvexError("This shot isn't here any more.");
  return { s, l: await ownList(ctx, s.listId) };
}
const touch = (ctx: MutationCtx, l: List) => ctx.db.patch(l._id, { updatedAt: Date.now() });

/** A shoot this list may be linked to: on the same project, still on, and without a list of its own already. */
async function checkShoot(ctx: MutationCtx, projectId: Id<"projects"> | undefined, shootId: string, except?: Id<"shotLists">) {
  const id = ctx.db.normalizeId("shoots", shootId);
  const s = id ? await ctx.db.get(id) : null;
  // D204: a list on its own can take any shoot day (it then lives on that shoot's project).
  if (!s || (projectId && s.projectId !== projectId) || s.status !== "scheduled") throw new ConvexError("Pick one of this project's shoot days.");
  const other = (await ctx.db.query("shotLists").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).collect()).find((x) => x._id !== except);
  if (other) throw new ConvexError("That shoot day already has a shot list.");
  return s;
}

// ---------- the owner: lists ----------

/** Pre-pro › Shot lists: every list, newest change first. */
export const all = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "shoots");
    const out = [];
    for (const l of await ctx.db.query("shotLists").collect()) {
      const p = l.projectId ? await ctx.db.get(l.projectId) : null;
      if (l.projectId && !p) continue;
      const days = await shootDays(ctx, l.projectId);
      const d = l.shootId ? days.find((x) => x.s._id === l.shootId) : undefined;
      out.push({ _id: l._id, title: l.title ?? null, project: p ? { _id: p._id, label: label(p), client: p.client ?? null } : null, setups: (await setupsOf(ctx, l._id)).filter((x) => !x.gap).length, shoot: d ? { day: d.day, date: d.s.date } : null, ...progress(await shotsOf(ctx, l._id)), updatedAt: l.updatedAt });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** New shot list: the projects, each with its shoot days (a day that already has a list can't take another). */
export const newOptions = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "shoots");
    const lists = await ctx.db.query("shotLists").collect();
    const out = [];
    for (const p of (await ctx.db.query("projects").collect()).sort((a, b) => b.createdAt - a.createdAt)) {
      const days = await shootDays(ctx, p._id);
      out.push({ _id: p._id, label: label(p), client: p.client ?? null, days: days.map((d) => ({ _id: d.s._id, day: d.day, date: d.s.date, taken: lists.some((l) => l.shootId === d.s._id) })) });
    }
    return out;
  },
});

/** A project's lists (its Overview card) and its shoot days (for New shot list and linking). */
export const forProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    await requireAll(ctx, "shoots");
    const id = ctx.db.normalizeId("projects", projectId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) return null;
    const lists = await ctx.db.query("shotLists").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect();
    const days = await shootDays(ctx, p._id);
    return {
      lists: await Promise.all(lists.map((l) => listView(ctx, l))),
      days: days.map((d) => ({ _id: d.s._id, day: d.day, date: d.s.date, taken: lists.some((l) => l.shootId === d.s._id) })),
    };
  },
});

/** The editor: the list, and the project's shoot days it could be linked to. */
export const get = query({
  args: { listId: v.string() },
  handler: async (ctx, { listId }) => {
    await requireAll(ctx, "shoots");
    const id = ctx.db.normalizeId("shotLists", listId);
    const l = id ? await ctx.db.get(id) : null;
    if (!l) return null;
    const lists = l.projectId ? await ctx.db.query("shotLists").withIndex("by_project", (q) => q.eq("projectId", l.projectId)).collect() : [l];
    const days = await shootDays(ctx, l.projectId);
    return {
      ...(await listView(ctx, l)),
      days: days.map((d) => ({ _id: d.s._id, day: d.day, date: d.s.date, taken: lists.some((x) => x.shootId === d.s._id && x._id !== l._id) })),
      // Other lists on the project, for "Move to Day 2's list".
      others: await Promise.all(lists.filter((x) => x._id !== l._id).map(async (x) => {
        const d = x.shootId ? days.find((y) => y.s._id === x.shootId) : undefined;
        return { _id: x._id, title: x.title ?? null, day: d?.day ?? null, date: d?.s.date ?? null };
      })),
    };
  },
});

/** The shoot's Shot list tab: the list linked to this shoot, or null. */
export const forShoot = query({
  args: { shootId: v.string() },
  handler: async (ctx, { shootId }) => {
    await requireAll(ctx, "shoots");
    const id = ctx.db.normalizeId("shoots", shootId);
    const s = id ? await ctx.db.get(id) : null;
    if (!s) return null;
    const l = await ctx.db.query("shotLists").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).first();
    return l ? await listView(ctx, l) : null;
  },
});

export const create = mutation({
  args: { projectId: v.optional(v.string()), shootId: v.optional(v.string()), title: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "shoots");
    // D204 (Nov 16): a list can be made on its own (it needs a name then) and attached later.
    let projectId: Id<"projects"> | undefined;
    if (a.projectId) {
      const id = ctx.db.normalizeId("projects", a.projectId);
      const p = id ? await ctx.db.get(id) : null;
      if (!p) throw new ConvexError("This project doesn't exist any more.");
      projectId = p._id;
    }
    const s = a.shootId ? await checkShoot(ctx, projectId, a.shootId) : null;
    const now = Date.now();
    const title = tidy(a.title, 60);
    if (!projectId && !s && !title) throw new ConvexError("Give the shot list a name.");
    return await ctx.db.insert("shotLists", { ...(s ? { projectId: s.projectId, shootId: s._id } : projectId ? { projectId } : {}), ...(title ? { title } : {}), createdAt: now, updatedAt: now });
  },
});

/** Rename, and link to a shoot day (or unlink with shootId null). */
export const update = mutation({
  args: { listId: v.string(), title: v.optional(v.string()), shootId: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "shoots");
    const l = await ownList(ctx, a.listId);
    const patch: Partial<List> = { updatedAt: Date.now() };
    if (a.title !== undefined) patch.title = tidy(a.title, 60) || undefined;
    if (a.shootId === null) patch.shootId = undefined;
    else if (a.shootId !== undefined) { const sh = await checkShoot(ctx, l.projectId, a.shootId, l._id); patch.shootId = sh._id; patch.projectId = sh.projectId; }
    await ctx.db.patch(l._id, patch);
    return null;
  },
});

export const remove = mutation({
  args: { listId: v.string() },
  handler: async (ctx, { listId }) => {
    await requireAll(ctx, "shoots");
    const l = await ownList(ctx, listId);
    for (const s of await shotsOf(ctx, l._id)) await ctx.db.delete(s._id);
    for (const x of await setupsOf(ctx, l._id)) await ctx.db.delete(x._id);
    await ctx.db.delete(l._id);
    return null;
  },
});

// ---------- the owner: setups and gap lines ----------

const setupFields = { code: v.optional(v.string()), start: v.optional(v.string()), end: v.optional(v.string()), title: v.optional(v.string()), note: v.optional(v.string()) };
function cleanSetup(a: { code?: string; start?: string; end?: string; title?: string; note?: string }, gap: boolean) {
  const start = tidy(a.start, 5), end = tidy(a.end, 5);
  if (start && !isTime(start)) throw new ConvexError("Pick a start time, or leave it empty.");
  if (end && !isTime(end)) throw new ConvexError("Pick an end time, or leave it empty.");
  if (start && end && end <= start) throw new ConvexError("The end is before the start.");
  const title = tidy(a.title, 120);
  if (!title) throw new ConvexError(gap ? "Say what happens in this gap." : "Give the setup a title.");
  return { code: gap ? undefined : tidy(a.code, 12) || undefined, start: start || undefined, end: end || undefined, title, note: tidy(a.note, NOTE_MAX) || undefined };
}

export const addSetup = mutation({
  args: { listId: v.string(), gap: v.optional(v.boolean()), ...setupFields },
  handler: async (ctx, a) => {
    await requireAll(ctx, "shoots");
    const l = await ownList(ctx, a.listId);
    const setups = (await setupsOf(ctx, l._id)).sort((x, y) => x.order - y.order);
    if (setups.length >= MAX_SETUPS) throw new ConvexError(`A list holds up to ${MAX_SETUPS} setups.`);
    const gap = !!a.gap;
    const f = cleanSetup({ ...a, title: a.title ?? (gap ? "" : "New setup") }, gap);
    const code = gap ? undefined : f.code ?? nextCode(setups.filter((x) => !x.gap).map((x) => x.code ?? ""));
    const id = await ctx.db.insert("shotSetups", { listId: l._id, order: (setups.at(-1)?.order ?? 0) + 1, ...(gap ? { gap: true } : {}), ...(code ? { code } : {}),
      ...(f.start ? { start: f.start } : {}), ...(f.end ? { end: f.end } : {}), title: f.title, ...(f.note ? { note: f.note } : {}), createdAt: Date.now() });
    await touch(ctx, l);
    return id;
  },
});

export const editSetup = mutation({
  args: { setupId: v.string(), ...setupFields },
  handler: async (ctx, a) => {
    await requireAll(ctx, "shoots");
    const { x, l } = await ownSetup(ctx, a.setupId);
    const f = cleanSetup({ code: a.code ?? x.code, start: a.start ?? x.start, end: a.end ?? x.end, title: a.title ?? x.title, note: a.note ?? x.note }, !!x.gap);
    await ctx.db.patch(x._id, { code: f.code, start: f.start, end: f.end, title: f.title, note: f.note });
    await touch(ctx, l);
    return null;
  },
});

export const removeSetup = mutation({
  args: { setupId: v.string() },
  handler: async (ctx, { setupId }) => {
    await requireAll(ctx, "shoots");
    const { x, l } = await ownSetup(ctx, setupId);
    for (const s of await ctx.db.query("shots").withIndex("by_setup", (q) => q.eq("setupId", x._id)).collect()) await ctx.db.delete(s._id);
    await ctx.db.delete(x._id);
    await touch(ctx, l);
    return null;
  },
});

/** Drag a setup to a new place, or (D179) move it, with its shots, to another day's list on the same project. Shot
 *  numbers already used on that list give way to the next free numbers there. */
export const moveSetup = mutation({
  args: { setupId: v.string(), index: v.number(), listId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "shoots");
    const { x, l } = await ownSetup(ctx, a.setupId);
    let to = l;
    if (a.listId && a.listId !== l._id) {
      to = await ownList(ctx, a.listId);
      if (to.projectId !== l.projectId) throw new ConvexError("A setup can only move to a list on the same project."); // both on their own counts as the same
      const theirs = await shotsOf(ctx, to._id);
      const mine = (await ctx.db.query("shots").withIndex("by_setup", (q) => q.eq("setupId", x._id)).collect()).sort((p, q) => p.order - q.order);
      if (theirs.length + mine.length > MAX_SHOTS) throw new ConvexError(`A list holds up to ${MAX_SHOTS} shots.`);
      if ((await setupsOf(ctx, to._id)).length >= MAX_SETUPS) throw new ConvexError(`A list holds up to ${MAX_SETUPS} setups.`);
      const used = new Set(theirs.map((s) => s.number));
      let next = Math.max(0, ...used, ...mine.map((s) => s.number)) + 1;
      for (const s of mine) {
        let n = s.number;
        if (used.has(n)) { while (used.has(next)) next++; n = next++; }
        used.add(n);
        await ctx.db.patch(s._id, { listId: to._id, number: n });
      }
      await ctx.db.patch(x._id, { listId: to._id });
      await touch(ctx, to);
    }
    const rest = (await setupsOf(ctx, to._id)).filter((y) => y._id !== x._id).sort((p, q) => p.order - q.order);
    const i = Math.max(0, Math.min(Math.floor(a.index), rest.length));
    rest.splice(i, 0, x);
    for (let k = 0; k < rest.length; k++) if (rest[k].order !== k + 1 || rest[k]._id === x._id) await ctx.db.patch(rest[k]._id, { order: k + 1 });
    await touch(ctx, l);
    return null;
  },
});

// ---------- the owner: shots ----------

/** Add one or many shots to a setup: the Paste shots dialog, or one typed line (lib/shotList.ts parsePaste). */
export const addShots = mutation({
  args: { setupId: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "shoots");
    const { x, l } = await ownSetup(ctx, a.setupId);
    if (x.gap) throw new ConvexError("A gap line has no shots.");
    if (a.text.split(/\r?\n/).filter((t) => t.trim()).length > MAX_PASTE) throw new ConvexError(`Paste up to ${MAX_PASTE} shots at a time.`);
    const all = await shotsOf(ctx, l._id);
    const rows = parsePaste(a.text, all.map((s) => s.number));
    if (!rows.length) throw new ConvexError("Type a shot first.");
    if (all.length + rows.length > MAX_SHOTS) throw new ConvexError(`A list holds up to ${MAX_SHOTS} shots.`);
    let order = Math.max(0, ...all.filter((s) => s.setupId === x._id).map((s) => s.order));
    const now = Date.now();
    for (const r of rows) await ctx.db.insert("shots", { listId: l._id, setupId: x._id, order: ++order, number: r.number, text: r.text, createdAt: now });
    await touch(ctx, l);
    return { added: rows.length, numbers: rows.map((r) => r.number) };
  },
});

export const editShot = mutation({
  args: { shotId: v.string(), text: v.optional(v.string()), note: v.optional(v.string()), number: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "shoots");
    const { s, l } = await ownShot(ctx, a.shotId);
    const patch: Partial<Doc<"shots">> = {};
    if (a.text !== undefined) { const t = tidy(a.text, TEXT_MAX); if (!t) throw new ConvexError("Say what the shot is."); patch.text = t; }
    if (a.note !== undefined) patch.note = tidy(a.note, NOTE_MAX) || undefined;
    if (a.number !== undefined && a.number !== s.number) {
      if (!Number.isInteger(a.number) || a.number < 1 || a.number > 9999) throw new ConvexError("A shot number is 1 to 9999.");
      if ((await shotsOf(ctx, l._id)).some((y) => y._id !== s._id && y.number === a.number)) throw new ConvexError(`#${a.number} is already on this list.`);
      patch.number = a.number;
    }
    await ctx.db.patch(s._id, patch);
    await touch(ctx, l);
    return null;
  },
});

export const removeShot = mutation({
  args: { shotId: v.string() },
  handler: async (ctx, { shotId }) => {
    await requireAll(ctx, "shoots");
    const { s, l } = await ownShot(ctx, shotId);
    await ctx.db.delete(s._id);
    await touch(ctx, l);
    return null;
  },
});

/** Drag a shot to a new place, in its setup or another setup of the same list ("Move to setup ›"). */
export const moveShot = mutation({
  args: { shotId: v.string(), setupId: v.string(), index: v.number() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "shoots");
    const { s, l } = await ownShot(ctx, a.shotId);
    const { x } = await ownSetup(ctx, a.setupId);
    if (x.listId !== l._id || x.gap) throw new ConvexError("Pick a setup on this list.");
    const rest = (await ctx.db.query("shots").withIndex("by_setup", (q) => q.eq("setupId", x._id)).collect()).filter((y) => y._id !== s._id).sort((p, q) => p.order - q.order);
    const i = Math.max(0, Math.min(Math.floor(a.index), rest.length));
    rest.splice(i, 0, s);
    for (let k = 0; k < rest.length; k++) await ctx.db.patch(rest[k]._id, { order: k + 1, ...(rest[k]._id === s._id ? { setupId: x._id } : {}) });
    await touch(ctx, l);
    return null;
  },
});

// ---------- ticking (D180, D182) ----------

/** Set a shot done or not done, as `who` at the time it was made. Shared by the owner's tick and the crew's. */
export async function applyTick(ctx: MutationCtx, s: Doc<"shots">, l: List, done: boolean, at: number, who: { name: string; userId?: Id<"users">; vendorId?: Id<"vendors"> }, sent?: number) {
  if (!Number.isFinite(at) || (sent !== undefined && !Number.isFinite(sent))) throw new ConvexError("That tick has no time.");
  // Review L1: `at` and `sent` are the phone's clock (when it was ticked, when it was sent); how long it waited is
  // measured on the phone and taken from the server's now, so a phone clock that's off doesn't matter.
  const now = Date.now();
  const r = tickLands(serverTime(at, sent, now), now, s.tickAt, l.resetAt);
  if (!r.lands) return { landed: false as const };
  await ctx.db.patch(s._id, { tickAt: r.at, done: done ? { name: who.name, initials: initialsOf(who.name), ...(who.userId ? { userId: who.userId } : {}), ...(who.vendorId ? { vendorId: who.vendorId } : {}) } : undefined });
  return { landed: true as const };
}

export const tick = mutation({
  args: { shotId: v.string(), done: v.boolean(), at: v.number(), sent: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const me = await requireAll(ctx, "shoots");
    const { s, l } = await ownShot(ctx, a.shotId);
    return await applyTick(ctx, s, l, a.done, a.at, { name: me.name, userId: me.userId }, a.sent);
  },
});

/** Reset (asks first in the page): every shot back to not done, for everyone. Ticks made before it don't come back. */
export const reset = mutation({
  args: { listId: v.string() },
  handler: async (ctx, { listId }) => {
    await requireAll(ctx, "shoots");
    const l = await ownList(ctx, listId);
    const now = Date.now();
    let cleared = 0;
    for (const s of await shotsOf(ctx, l._id)) { if (s.done) cleared++; await ctx.db.patch(s._id, { done: undefined, tickAt: now }); }
    await ctx.db.patch(l._id, { resetAt: now, updatedAt: now });
    return { cleared };
  },
});

// ---------- the Shot list block (D181) ----------

/** "Day 1 · Tue 11/3 · H-01, H-02" (the block's shoot-day picker). */
export function pickLabel(v: Awaited<ReturnType<typeof listView>>, withProject = true) {
  const d = v.shoot ? `Day ${v.shoot.day} · ${new Date(`${v.shoot.date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "numeric", day: "numeric" }).replace(",", "")}` : v.title || "No shoot day yet";
  const codes = v.setups.filter((x) => !x.gap && x.code).map((x) => x.code);
  return [withProject && v.project && !v.shoot ? v.project.label : null, d, codes.length ? codes.join(", ") : null].filter(Boolean).join(" · ");
}

/** The lists a builder page can show in its Shot list block: a call sheet's or briefing's project's lists (a call sheet's
 *  own shoot day first, as `defaultId`), or every list for a proposal. (The builder only asks when the caller has Shoots and call sheets.) */
export const forBuild = query({
  args: { buildId: v.string() },
  handler: async (ctx, { buildId }) => {
    await requireAll(ctx, "shoots");
    const id = ctx.db.normalizeId("wsBuilds", buildId);
    const build = id ? await ctx.db.get(id) : null;
    // Review L3: only the pages that can hold the block (never a contract).
    if (!id || !build || (build.kind !== "callsheet" && build.kind !== "briefing" && build.kind !== "proposal")) return null;
    let projectId: Id<"projects"> | null = null, defaultId: Id<"shotLists"> | null = null;
    const cs = await ctx.db.query("callSheets").withIndex("by_build", (q) => q.eq("buildId", id)).first();
    if (cs) {
      projectId = cs.projectId;
      defaultId = (await ctx.db.query("shotLists").withIndex("by_shoot", (q) => q.eq("shootId", cs.shootId)).first())?._id ?? null;
    } else {
      const b = await ctx.db.query("briefings").withIndex("by_build", (q) => q.eq("buildId", id)).first();
      projectId = b?.projectId ?? null;
    }
    const lists = projectId ? await ctx.db.query("shotLists").withIndex("by_project", (q) => q.eq("projectId", projectId!)).collect() : await ctx.db.query("shotLists").collect();
    const views = await Promise.all(lists.map((l) => listView(ctx, l)));
    return { defaultId, callSheet: !!cs, lists: views.sort((a, b) => (a.shoot?.date ?? "9").localeCompare(b.shoot?.date ?? "9")).map((x) => ({ ...x, pick: pickLabel(x) })) };
  },
});

/** The lists a sent page's Shot list blocks show, live (D181), for one reader. Crew see who ticked and may tick (D180,
 *  where the block allows); clients and guests see the shots only. Null when the page has no Shot list block. */
export async function readerShots(ctx: QueryCtx, page: unknown, projectId: Id<"projects">, shootId: Id<"shoots"> | null, crew: boolean) {
  const blocks = shotBlocks(page);
  if (!blocks.length) return null;
  const defaultId = shootId ? (await ctx.db.query("shotLists").withIndex("by_shoot", (q) => q.eq("shootId", shootId)).first())?._id ?? null : null;
  const ids = new Set<string>(blocks.map((b) => b.listId ?? defaultId ?? "").filter(Boolean));
  const lists = [];
  for (const raw of ids) {
    const id = ctx.db.normalizeId("shotLists", raw);
    const l = id ? await ctx.db.get(id) : null;
    if (!l || l.projectId !== projectId) continue; // only the page's own project's lists
    const vw = await listView(ctx, l);
    // Review M1: the crew tick only their own shoot day's list (D180); review L5: no project label for clients and guests.
    lists.push({ _id: vw._id, pick: pickLabel(vw, crew), tickable: crew && !!shootId && l.shootId === shootId, setups: vw.setups.map((x) => ({ ...x, shots: x.shots.map((s) => ({ ...s, done: crew ? s.done : null })) })) });
  }
  return { defaultId, lists, canTick: crew && blocks.some((b) => b.crewTick) && lists.some((l) => l.tickable) };
}
