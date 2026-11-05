// Phase 5d step 3 (Nov 4, Q57): gear. Owner-only (no client or vendor sees any of it).
//   - Production › Gear: a list with tiles; an item page; Add gear, Log maintenance, Export for insurer.
//   - A shoot's "Gear on this shoot" card. Two shoots on one day that need the same item are named, never blocked.
//   - The serial is stored whole but every screen shows only the last 4; the insurer export carries the whole one.
import { mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { todayCentral } from "./lib/bookings";

type Ctx = QueryCtx | MutationCtx;
export const KINDS = ["camera", "lens", "audio", "lighting", "grip", "drone", "computer", "other"] as const;
const kindV = v.union(v.literal("camera"), v.literal("lens"), v.literal("audio"), v.literal("lighting"), v.literal("grip"), v.literal("drone"), v.literal("computer"), v.literal("other"));
const statusV = v.union(v.literal("in_service"), v.literal("in_repair"), v.literal("retired"));
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
const tidy = (s: string | undefined, max: number) => (s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().replace(/[ \t]+/g, " ").slice(0, max);
const money = (n: number | undefined | null, what: string) => {
  if (n === undefined || n === null) return undefined;
  if (!Number.isInteger(n) || n < 0 || n > 100_000_000_00) throw new ConvexError(`${what} isn't a valid amount.`);
  return n;
};
const last4 = (s?: string) => (s ? s.slice(-4) : null);
const MAX_PHOTO = 10 * 1024 * 1024;

const fields = {
  name: v.string(), kind: kindV, serial: v.optional(v.string()), boughtOn: v.optional(v.string()),
  priceCents: v.optional(v.number()), insuredCents: v.optional(v.number()), notes: v.optional(v.string()),
};
type Fields = { name: string; kind: (typeof KINDS)[number]; serial?: string; boughtOn?: string; priceCents?: number; insuredCents?: number; notes?: string };

function cleanFields(a: Fields) {
  const name = tidy(a.name, 120);
  if (!name) throw new ConvexError("Give the gear a name.");
  const boughtOn = a.boughtOn?.trim() || undefined;
  if (boughtOn && !isDay(boughtOn)) throw new ConvexError("Pick the date it was bought, or leave it empty.");
  return { name, kind: a.kind, boughtOn, priceCents: money(a.priceCents, "The price"), insuredCents: money(a.insuredCents, "The insurance value"), notes: tidy(a.notes, 2000) || undefined };
}

async function owned(ctx: Ctx, gearId: string) {
  const id = ctx.db.normalizeId("gear", gearId);
  const g = id ? await ctx.db.get(id) : null;
  if (!g) throw new ConvexError("That gear isn't here any more.");
  return g;
}

/** The newest maintenance entry's next-due date, if any. */
async function dueOf(ctx: Ctx, gearId: Id<"gear">) {
  const rows = await ctx.db.query("gearMaintenance").withIndex("by_gear", (q) => q.eq("gearId", gearId)).order("desc").collect();
  const newest = rows[0];
  return { rows, nextDue: newest?.nextDue ?? null, last: newest?.date ?? null };
}

async function photoOf(ctx: Ctx, g: Doc<"gear">) { return g.photoId ? await ctx.storage.getUrl(g.photoId) : null; }

/** Production › Gear. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const today = todayCentral();
    const all = await ctx.db.query("gear").collect();
    const items = [];
    for (const g of all) {
      const d = await dueOf(ctx, g._id);
      items.push({
        _id: g._id, name: g.name, kind: g.kind, status: g.status, serialLast4: last4(g.serial), insuredCents: g.insuredCents ?? null,
        nextDue: d.nextDue, due: g.status !== "retired" && !!d.nextDue && d.nextDue <= today, photoUrl: await photoOf(ctx, g),
      });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    const live = items.filter((i) => i.status !== "retired");
    return {
      today, items,
      tiles: { items: live.length, insuredCents: live.reduce((n, i) => n + (i.insuredCents ?? 0), 0), inRepair: items.filter((i) => i.status === "in_repair").length, due: items.filter((i) => i.due).length },
      counts: { in_service: items.filter((i) => i.status === "in_service").length, in_repair: items.filter((i) => i.status === "in_repair").length, retired: items.filter((i) => i.status === "retired").length },
    };
  },
});

/** An item page. */
export const get = query({
  args: { gearId: v.string() },
  handler: async (ctx, { gearId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("gear", gearId);
    const g = id ? await ctx.db.get(id) : null;
    if (!g) return null;
    const today = todayCentral();
    const d = await dueOf(ctx, g._id);
    const shoots = [];
    for (const b of await ctx.db.query("gearBookings").withIndex("by_gear", (q) => q.eq("gearId", g._id)).collect()) {
      const s = await ctx.db.get(b.shootId);
      if (!s || s.status !== "scheduled") continue;
      const p = await ctx.db.get(s.projectId);
      shoots.push({ shootId: s._id, projectId: s.projectId, project: p?.name ?? "A project", date: s.date, call: s.call, location: s.location });
    }
    shoots.sort((a, b) => a.date.localeCompare(b.date));
    return {
      _id: g._id, name: g.name, kind: g.kind, status: g.status, serialLast4: last4(g.serial), boughtOn: g.boughtOn ?? null, priceCents: g.priceCents ?? null,
      insuredCents: g.insuredCents ?? null, notes: g.notes ?? "", photoUrl: await photoOf(ctx, g), today,
      nextDue: d.nextDue, due: g.status !== "retired" && !!d.nextDue && d.nextDue <= today,
      maintenance: d.rows.map((m) => ({ _id: m._id, date: m.date, what: m.what, costCents: m.costCents ?? null, nextDue: m.nextDue ?? null })),
      upcoming: shoots.filter((s) => s.date >= today), past: shoots.filter((s) => s.date < today).reverse().slice(0, 20),
    };
  },
});

export const add = mutation({
  args: fields,
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const now = Date.now();
    const f = cleanFields(a);
    const serial = tidy(a.serial, 80) || undefined;
    return await ctx.db.insert("gear", { ...f, ...(serial ? { serial } : {}), status: "in_service", createdAt: now, updatedAt: now });
  },
});

/** Edit the details. The serial is left alone unless a new one is sent (the page only ever holds the last 4). */
export const update = mutation({
  args: { gearId: v.id("gear"), ...fields },
  handler: async (ctx, { gearId, ...a }) => {
    await requireMe(ctx);
    const g = await owned(ctx, gearId);
    const f = cleanFields(a);
    const serial = tidy(a.serial, 80);
    await ctx.db.patch(g._id, { ...f, ...(serial ? { serial } : {}), updatedAt: Date.now() });
  },
});

export const setStatus = mutation({
  args: { gearId: v.id("gear"), status: statusV },
  handler: async (ctx, { gearId, status }) => {
    await requireMe(ctx);
    const g = await owned(ctx, gearId);
    await ctx.db.patch(g._id, { status, updatedAt: Date.now() });
  },
});

export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => { await requireMe(ctx); return await ctx.storage.generateUploadUrl(); },
});

/** After the browser uploads a photo: an image up to 10 MB. A refused file is deleted and the reason returned. */
export const setPhoto = mutation({
  args: { gearId: v.id("gear"), storageId: v.id("_storage") },
  handler: async (ctx, { gearId, storageId }) => {
    await requireMe(ctx);
    const meta = await ctx.db.system.get(storageId);
    if (!meta) return "The photo didn't upload. Try again.";
    const g = await ctx.db.get(gearId);
    const refuse = async (msg: string) => { await ctx.storage.delete(storageId); return msg; };
    if (!g) return refuse("That gear isn't here any more.");
    if (!/^image\/(png|jpeg|webp|gif)$/.test(meta.contentType ?? "")) return refuse("A photo needs to be a PNG, JPG, WebP or GIF.");
    if (meta.size > MAX_PHOTO) return refuse("That photo is over 10 MB.");
    if (g.photoId) await ctx.storage.delete(g.photoId).catch(() => null);
    await ctx.db.patch(g._id, { photoId: storageId, updatedAt: Date.now() });
    return null;
  },
});

export const removePhoto = mutation({
  args: { gearId: v.id("gear") },
  handler: async (ctx, { gearId }) => {
    await requireMe(ctx);
    const g = await owned(ctx, gearId);
    if (g.photoId) await ctx.storage.delete(g.photoId).catch(() => null);
    await ctx.db.patch(g._id, { photoId: undefined, updatedAt: Date.now() });
  },
});

export const logMaintenance = mutation({
  args: { gearId: v.id("gear"), date: v.string(), what: v.string(), costCents: v.optional(v.number()), nextDue: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const g = await owned(ctx, a.gearId);
    if (!isDay(a.date)) throw new ConvexError("Pick the date it was done.");
    const what = tidy(a.what, 300);
    if (!what) throw new ConvexError("Say what was done.");
    const nextDue = a.nextDue?.trim() || undefined;
    if (nextDue && !isDay(nextDue)) throw new ConvexError("Pick the next due date, or leave it empty.");
    if (nextDue && nextDue < a.date) throw new ConvexError("The next due date is before the date it was done.");
    await ctx.db.insert("gearMaintenance", { gearId: g._id, date: a.date, what, costCents: money(a.costCents, "The cost"), ...(nextDue ? { nextDue } : {}), createdAt: Date.now() });
    await ctx.db.patch(g._id, { updatedAt: Date.now() });
  },
});

// A spreadsheet cell that starts with = + - @ would run as a formula when opened; a leading ' keeps it text.
const cell = (s: string | number | undefined) => {
  let t = s === undefined ? "" : String(s);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const dollars = (c?: number) => (c === undefined ? "" : (c / 100).toFixed(2));

/** Export for insurer: name, kind, serial, bought, price, insurance value, then a total. Retired gear is left out. */
export const exportCsv = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const rows = (await ctx.db.query("gear").collect()).filter((g) => g.status !== "retired").sort((a, b) => a.name.localeCompare(b.name));
    const lines = [["Name", "Kind", "Serial", "Bought", "Price", "Insurance value"].join(",")];
    for (const g of rows) lines.push([cell(g.name), cell(g.kind), cell(g.serial), cell(g.boughtOn), cell(dollars(g.priceCents)), cell(dollars(g.insuredCents))].join(","));
    const total = rows.reduce((n, g) => n + (g.insuredCents ?? 0), 0);
    lines.push(["Total", "", "", "", "", dollars(total)].join(","));
    return { filename: `gear-${todayCentral()}.csv`, csv: `${lines.join("\n")}\n`, count: rows.length, totalCents: total };
  },
});

// ---- on a shoot ----

async function ownedShoot(ctx: Ctx, shootId: string) {
  const id = ctx.db.normalizeId("shoots", shootId);
  const s = id ? await ctx.db.get(id) : null;
  if (!s) throw new ConvexError("That shoot isn't here any more.");
  return s;
}

/** "Gear on this shoot": what's booked, what can still be added, and the same-day clashes. */
export const forShoot = query({
  args: { shootId: v.string() },
  handler: async (ctx, { shootId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("shoots", shootId);
    const s = id ? await ctx.db.get(id) : null;
    if (!s) return null;
    const mine = await ctx.db.query("gearBookings").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).collect();
    const have = new Set(mine.map((b) => String(b.gearId)));
    const items = [];
    for (const b of mine) {
      const g = await ctx.db.get(b.gearId);
      if (!g) continue;
      // Other scheduled shoots on the same day that have this item.
      const clash = [];
      for (const o of await ctx.db.query("gearBookings").withIndex("by_gear", (q) => q.eq("gearId", g._id)).collect()) {
        if (o.shootId === s._id) continue;
        const os = await ctx.db.get(o.shootId);
        if (!os || os.status !== "scheduled" || os.date !== s.date) continue;
        const p = await ctx.db.get(os.projectId);
        clash.push({ shootId: os._id, project: p?.name ?? "another project", call: os.call });
      }
      items.push({ bookingId: b._id, gearId: g._id, name: g.name, kind: g.kind, status: g.status, clash });
    }
    const available = (await ctx.db.query("gear").collect()).filter((g) => g.status !== "retired" && !have.has(String(g._id))).map((g) => ({ _id: g._id, name: g.name, kind: g.kind, status: g.status })).sort((a, b) => a.name.localeCompare(b.name));
    return { date: s.date, items: items.sort((a, b) => a.name.localeCompare(b.name)), available, total: (await ctx.db.query("gear").collect()).filter((g) => g.status !== "retired").length };
  },
});

export const addToShoot = mutation({
  args: { shootId: v.id("shoots"), gearId: v.id("gear") },
  handler: async (ctx, { shootId, gearId }) => {
    await requireMe(ctx);
    const s = await ownedShoot(ctx, shootId);
    const g = await owned(ctx, gearId);
    if (s.status !== "scheduled") throw new ConvexError("That shoot is cancelled.");
    if (g.status === "retired") throw new ConvexError("That gear is retired.");
    const dup = (await ctx.db.query("gearBookings").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).collect()).find((b) => b.gearId === g._id);
    if (dup) return dup._id;
    return await ctx.db.insert("gearBookings", { gearId: g._id, shootId: s._id, createdAt: Date.now() });
  },
});

export const removeFromShoot = mutation({
  args: { shootId: v.id("shoots"), gearId: v.id("gear") },
  handler: async (ctx, { shootId, gearId }) => {
    await requireMe(ctx);
    const s = await ownedShoot(ctx, shootId);
    const g = await owned(ctx, gearId);
    for (const b of await ctx.db.query("gearBookings").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).collect()) if (b.gearId === g._id) await ctx.db.delete(b._id);
  },
});
