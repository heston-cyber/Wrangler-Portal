// 5j (D194; Design Log "Handoff ready: Gear packing lists"): Production › Gear › Packing lists, the list editor, a
// shoot's Gear tab (its own copy of a saved list, or an empty one) and the on-set load-in and wrap passes. Lines from
// Gear keep the item (serial, In repair, clashes with other shoots that day); loose lines are just text. Ticks made
// offline land in the order they were made (the newer wins), as for shot lists (D182). At wrap a line can be marked
// lost or in repair, which updates the Gear item. Owner and team with Production.
import { mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAll } from "./lib/access";
import { serverTime, tickLands } from "./lib/shotList";
import { label } from "./lib/bookingRows";

type Ctx = QueryCtx | MutationCtx;
const tidy = (s: string | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const MAX_LINES = 300;

async function linesOf(ctx: Ctx, listId: Id<"packLists">) {
  return (await ctx.db.query("packLines").withIndex("by_list", (q) => q.eq("listId", listId)).collect()).sort((a, b) => a.order - b.order);
}
async function listOf(ctx: Ctx, listId: string) {
  const id = ctx.db.normalizeId("packLists", listId);
  const l = id ? await ctx.db.get(id) : null;
  if (!l) throw new ConvexError("That packing list isn't here any more.");
  return l;
}
async function lineOf(ctx: Ctx, lineId: string) {
  const id = ctx.db.normalizeId("packLines", lineId);
  const x = id ? await ctx.db.get(id) : null;
  if (!x) throw new ConvexError("That line isn't here any more.");
  return x;
}
const touch = (ctx: MutationCtx, l: Doc<"packLists">) => ctx.db.patch(l._id, { updatedAt: Date.now() });

/** A list with its lines; for a shoot's copy, each Gear line's clash with another shoot the same day. */
async function view(ctx: Ctx, l: Doc<"packLists">) {
  const lines = await linesOf(ctx, l._id);
  const shoot = l.shootId ? await ctx.db.get(l.shootId) : null;
  const sameDay = shoot ? (await ctx.db.query("shoots").withIndex("by_date", (q) => q.eq("date", shoot.date)).collect()).filter((x) => x._id !== shoot._id && x.status === "scheduled") : [];
  const busy = new Map<string, string>();
  for (const o of sameDay) {
    const p = o.projectId ? await ctx.db.get(o.projectId) : null;
    const name = p ? label(p) : "another shoot";
    const pl = await ctx.db.query("packLists").withIndex("by_shoot", (q) => q.eq("shootId", o._id)).first();
    if (pl) for (const x of await linesOf(ctx, pl._id)) if (x.gearId) busy.set(x.gearId, name);
    for (const b of await ctx.db.query("gearBookings").withIndex("by_shoot", (q) => q.eq("shootId", o._id)).collect()) busy.set(b.gearId, name);
  }
  const out = [];
  for (const x of lines) {
    const g = x.gearId ? await ctx.db.get(x.gearId) : null;
    out.push({
      _id: x._id, text: g?.name ?? x.text, qty: x.qty, gearId: x.gearId ?? null, serial4: g?.serial ? g.serial.slice(-4) : null, repair: g?.status === "in_repair", gone: !!x.gearId && !g,
      loaded: x.loaded ?? null, back: x.back ?? null, flag: x.flag ?? null, clash: x.gearId ? busy.get(x.gearId) ?? null : null,
    });
  }
  return { _id: l._id, name: l.name, shootId: l.shootId ?? null, fromListId: l.fromListId ?? null, lines: out, updatedAt: l.updatedAt };
}

// ---------- Production › Gear › Packing lists ----------

export const lists = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "production");
    const all = await ctx.db.query("packLists").collect();
    const saved = all.filter((l) => !l.shootId).sort((a, b) => b.updatedAt - a.updatedAt);
    const out = [];
    for (const l of saved) {
      const lines = await linesOf(ctx, l._id);
      const used = all.filter((x) => x.fromListId === l._id && x.shootId).length;
      out.push({ _id: l._id, name: l.name, lines: lines.length, fromGear: lines.filter((x) => x.gearId).length, loose: lines.filter((x) => !x.gearId).length, used, items: lines.slice(0, 6).map((x) => x.text), updatedAt: l.updatedAt });
    }
    return out;
  },
});

export const get = query({
  args: { listId: v.string() },
  handler: async (ctx, { listId }) => {
    await requireAll(ctx, "production");
    const id = ctx.db.normalizeId("packLists", listId);
    const l = id ? await ctx.db.get(id) : null;
    return l ? await view(ctx, l) : null;
  },
});

/** The Add from Gear popover: every item in service or in repair (flagged), and whether it's on this list already. */
export const gearChoices = query({
  args: { listId: v.string() },
  handler: async (ctx, { listId }) => {
    await requireAll(ctx, "production");
    const id = ctx.db.normalizeId("packLists", listId);
    const on = new Set(id ? (await linesOf(ctx, id)).map((x) => String(x.gearId ?? "")) : []);
    return (await ctx.db.query("gear").collect()).filter((g) => g.status !== "retired").sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => ({ _id: g._id, name: g.name, kind: g.kind, serial4: g.serial ? g.serial.slice(-4) : null, repair: g.status === "in_repair", on: on.has(g._id) }));
  },
});

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "production");
    const name = tidy(a.name, 80);
    if (!name) throw new ConvexError("Name the list.");
    const now = Date.now();
    return await ctx.db.insert("packLists", { name, createdAt: now, updatedAt: now });
  },
});

export const rename = mutation({
  args: { listId: v.string(), name: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "production");
    const l = await listOf(ctx, a.listId);
    const name = tidy(a.name, 80);
    if (!name) throw new ConvexError("Name the list.");
    await ctx.db.patch(l._id, { name, updatedAt: Date.now() });
    return null;
  },
});

async function copyLines(ctx: MutationCtx, from: Id<"packLists">, to: Id<"packLists">) {
  for (const x of await linesOf(ctx, from)) await ctx.db.insert("packLines", { listId: to, order: x.order, ...(x.gearId ? { gearId: x.gearId } : {}), text: x.text, qty: x.qty });
}

export const duplicate = mutation({
  args: { listId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "production");
    const l = await listOf(ctx, a.listId);
    const now = Date.now();
    const id = await ctx.db.insert("packLists", { name: `${l.name} (copy)`.slice(0, 80), createdAt: now, updatedAt: now });
    await copyLines(ctx, l._id, id);
    return id;
  },
});

export const remove = mutation({
  args: { listId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "production");
    const l = await listOf(ctx, a.listId);
    for (const x of await linesOf(ctx, l._id)) await ctx.db.delete(x._id);
    await ctx.db.delete(l._id);
    return null;
  },
});

// ---------- lines ----------

export const addGear = mutation({
  args: { listId: v.string(), gearIds: v.array(v.id("gear")) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "production");
    const l = await listOf(ctx, a.listId);
    const lines = await linesOf(ctx, l._id);
    const on = new Set(lines.map((x) => String(x.gearId ?? "")));
    let order = lines.length ? lines[lines.length - 1].order + 1 : 1, added = 0;
    for (const gid of a.gearIds) {
      const g = await ctx.db.get(gid);
      if (!g || on.has(gid)) continue;
      if (lines.length + added >= MAX_LINES) throw new ConvexError(`A list holds up to ${MAX_LINES} lines.`);
      await ctx.db.insert("packLines", { listId: l._id, order: order++, gearId: g._id, text: g.name, qty: 1 });
      on.add(gid);
      added++;
    }
    await touch(ctx, l);
    return added;
  },
});

export const addLine = mutation({
  args: { listId: v.string(), text: v.string(), qty: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "production");
    const l = await listOf(ctx, a.listId);
    const text = tidy(a.text, 120);
    if (!text) throw new ConvexError("Type what to pack.");
    const lines = await linesOf(ctx, l._id);
    if (lines.length >= MAX_LINES) throw new ConvexError(`A list holds up to ${MAX_LINES} lines.`);
    const qty = Math.max(1, Math.min(999, Math.round(a.qty ?? 1)));
    const id = await ctx.db.insert("packLines", { listId: l._id, order: lines.length ? lines[lines.length - 1].order + 1 : 1, text, qty });
    await touch(ctx, l);
    return id;
  },
});

export const editLine = mutation({
  args: { lineId: v.string(), text: v.optional(v.string()), qty: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "production");
    const x = await lineOf(ctx, a.lineId);
    const patch: Partial<Doc<"packLines">> = {};
    if (a.text !== undefined && !x.gearId) { const t = tidy(a.text, 120); if (!t) throw new ConvexError("Type what to pack."); patch.text = t; }
    if (a.qty !== undefined) patch.qty = Math.max(1, Math.min(999, Math.round(a.qty)));
    await ctx.db.patch(x._id, patch);
    return null;
  },
});

export const removeLine = mutation({
  args: { lineId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "production");
    const x = await lineOf(ctx, a.lineId);
    await ctx.db.delete(x._id);
    return null;
  },
});

/** Drag a line to a new place in its list. */
export const moveLine = mutation({
  args: { lineId: v.string(), index: v.number() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "production");
    const x = await lineOf(ctx, a.lineId);
    const rest = (await linesOf(ctx, x.listId)).filter((y) => y._id !== x._id);
    const i = Math.max(0, Math.min(rest.length, Math.round(a.index)));
    rest.splice(i, 0, x);
    for (let n = 0; n < rest.length; n++) if (rest[n].order !== n + 1) await ctx.db.patch(rest[n]._id, { order: n + 1 });
    return null;
  },
});

// ---------- a shoot's Gear tab ----------

export const forShoot = query({
  args: { shootId: v.string() },
  handler: async (ctx, { shootId }) => {
    await requireAll(ctx, "production");
    const id = ctx.db.normalizeId("shoots", shootId);
    const s = id ? await ctx.db.get(id) : null;
    if (!s) return null;
    const l = await ctx.db.query("packLists").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).first();
    return { list: l ? await view(ctx, l) : null, date: s.date };
  },
});

/** "A copy goes on this shoot. Your saved list stays as it is." (or Start an empty list). One packing list per shoot. */
export const useOnShoot = mutation({
  args: { shootId: v.string(), listId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "production");
    const sid = ctx.db.normalizeId("shoots", a.shootId);
    const s = sid ? await ctx.db.get(sid) : null;
    if (!s || s.status !== "scheduled") throw new ConvexError("That shoot isn't here any more.");
    if (await ctx.db.query("packLists").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).first()) throw new ConvexError("This shoot has its packing list already.");
    const from = a.listId ? await listOf(ctx, a.listId) : null;
    if (from?.shootId) throw new ConvexError("Pick a saved list.");
    const now = Date.now();
    const id = await ctx.db.insert("packLists", { name: from?.name ?? "Packing list", shootId: s._id, ...(from ? { fromListId: from._id } : {}), createdAt: now, updatedAt: now });
    if (from) await copyLines(ctx, from._id, id);
    return id;
  },
});

/** Load-in or wrap: tick a line (or untick). `at` is when it was ticked on the phone; `sent` when the phone sent it. */
export const tick = mutation({
  args: { lineId: v.string(), pass: v.union(v.literal("loaded"), v.literal("back")), done: v.boolean(), at: v.number(), sent: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const me = await requireAll(ctx, "production");
    const x = await lineOf(ctx, a.lineId);
    const l = await ctx.db.get(x.listId);
    if (!l?.shootId) throw new ConvexError("Ticks are for a shoot's list.");
    const now = Date.now();
    const t = tickLands(serverTime(a.at, a.sent, now), now, x.tickAt, undefined);
    if (!t.lands) return { landed: false };
    await ctx.db.patch(x._id, { [a.pass]: a.done ? { name: me.name?.trim() || me.email, at: t.at } : undefined, tickAt: t.at } as Partial<Doc<"packLines">>);
    return { landed: true };
  },
});

/** At wrap: Mark as lost or In repair (or clear it). A line from Gear updates the item, with a note on its record. */
export const flag = mutation({
  args: { lineId: v.string(), flag: v.union(v.literal("lost"), v.literal("repair"), v.null()) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "production");
    const x = await lineOf(ctx, a.lineId);
    const l = await ctx.db.get(x.listId);
    if (!l?.shootId) throw new ConvexError("Only a shoot's list is checked at wrap.");
    const s = await ctx.db.get(l.shootId);
    await ctx.db.patch(x._id, { flag: a.flag ?? undefined });
    const g = x.gearId ? await ctx.db.get(x.gearId) : null;
    if (g && a.flag) {
      const note = `${a.flag === "lost" ? "Lost" : "Sent for repair"} after the shoot on ${s?.date ?? "?"}.`;
      await ctx.db.patch(g._id, { status: a.flag === "lost" ? "retired" : "in_repair", notes: [g.notes, note].filter(Boolean).join("\n").slice(0, 2000), updatedAt: Date.now() });
    }
    return null;
  },
});
