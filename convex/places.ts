// 5k (D192; Design Log "Handoff ready: Location scouting"): Creative planning › Locations. A bank of places with photos,
// access (parking and load-in, power, permits, contacts), notes, tags and where they are (the map and the sun times,
// worked out on the page from the point). A place can be attached to a client or project (D204), and used for shoots:
// "Use for a shoot" makes it the shoot's place (and so its call sheet's Location block). Owner and team with Shoots.
// The address goes to the US Census geocoder for the point (as the call sheet's weather does), or the phone gives it
// ("Use where I am").
import { internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAll } from "./lib/access";
import { claimUpload, deleteFile } from "./lib/fileOwners";
import { businessInScope } from "./lib/business";
import { geocode } from "./lib/weather";
import { label } from "./lib/bookingRows";

type Ctx = QueryCtx | MutationCtx;
const tidy = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);
const line = (s: string | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const MAX_PHOTOS = 24;
const fields = {
  name: v.string(), address: v.string(), lat: v.optional(v.number()), lng: v.optional(v.number()),
  parking: v.optional(v.string()), power: v.optional(v.string()), permits: v.optional(v.string()), contacts: v.optional(v.string()), notes: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
};
type In = { name: string; address: string; lat?: number; lng?: number; parking?: string; power?: string; permits?: string; contacts?: string; notes?: string; tags?: string[] };

function cleanIn(a: In) {
  const name = line(a.name, 120);
  if (!name) throw new ConvexError("Name the place.");
  const ok = (n: number | undefined, lim: number) => n !== undefined && Number.isFinite(n) && Math.abs(n) <= lim;
  const point = ok(a.lat, 90) && ok(a.lng, 180) ? { lat: a.lat!, lng: a.lng! } : null;
  return {
    name, address: line(a.address, 240), point,
    parking: tidy(a.parking, 1000) || undefined, power: tidy(a.power, 1000) || undefined, permits: tidy(a.permits, 1000) || undefined,
    contacts: tidy(a.contacts, 1000) || undefined, notes: tidy(a.notes, 4000) || undefined,
    tags: [...new Set((a.tags ?? []).map((t) => line(t, 30).toLowerCase()).filter(Boolean))].slice(0, 12),
  };
}
async function placeOf(ctx: Ctx, placeId: string) {
  const id = ctx.db.normalizeId("places", placeId);
  const p = id ? await ctx.db.get(id) : null;
  if (!p) throw new ConvexError("That place isn't here any more.");
  return p;
}
async function homeLabel(ctx: Ctx, p: Doc<"places">) {
  if (p.projectId) { const x = await ctx.db.get(p.projectId); return x ? { type: "project" as const, id: x._id, name: label(x) } : null; }
  if (p.clientId) { const x = await ctx.db.get(p.clientId); return x ? { type: "client" as const, id: x._id, name: x.name } : null; }
  return null;
}

// ---------- Locations (Archive · Map · By shoot) ----------

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "shoots");
    const links = await ctx.db.query("placeLinks").collect();
    const shoots = new Map<string, Doc<"shoots"> | null>();
    const out = [];
    for (const p of (await ctx.db.query("places").collect()).sort((a, b) => b.updatedAt - a.updatedAt)) {
      const mine = links.filter((l) => l.placeId === p._id);
      const on = [];
      for (const l of mine) {
        if (!shoots.has(l.shootId)) shoots.set(l.shootId, await ctx.db.get(l.shootId));
        const s = shoots.get(l.shootId);
        if (!s || s.status !== "scheduled") continue;
        const pr = s.projectId ? await ctx.db.get(s.projectId) : null;
        on.push({ shootId: s._id, date: s.date, label: pr ? label(pr) : "Shoot on its own" });
      }
      out.push({
        _id: p._id, name: p.name, address: p.address, lat: p.lat ?? null, lng: p.lng ?? null, tags: p.tags,
        photo: p.photos[0] ? await ctx.storage.getUrl(p.photos[0].fileId) : null, photos: p.photos.length, home: await homeLabel(ctx, p),
        shoots: on.sort((a, b) => a.date.localeCompare(b.date)), updatedAt: p.updatedAt,
      });
    }
    return out;
  },
});

export const get = query({
  args: { placeId: v.string() },
  handler: async (ctx, { placeId }) => {
    await requireAll(ctx, "shoots");
    const id = ctx.db.normalizeId("places", placeId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) return null;
    const shoots = [];
    for (const l of await ctx.db.query("placeLinks").withIndex("by_place", (q) => q.eq("placeId", p._id)).collect()) {
      const s = await ctx.db.get(l.shootId);
      if (!s || s.status !== "scheduled") continue;
      const pr = s.projectId ? await ctx.db.get(s.projectId) : null;
      shoots.push({ shootId: s._id, date: s.date, call: s.call, label: pr ? label(pr) : "Shoot on its own" });
    }
    const photos = [];
    for (const ph of p.photos) photos.push({ fileId: ph.fileId, name: ph.name, url: await ctx.storage.getUrl(ph.fileId) });
    return {
      _id: p._id, name: p.name, address: p.address, lat: p.lat ?? null, lng: p.lng ?? null, parking: p.parking ?? null, power: p.power ?? null, permits: p.permits ?? null,
      contacts: p.contacts ?? null, notes: p.notes ?? null, tags: p.tags, photos, home: await homeLabel(ctx, p), shoots: shoots.sort((a, b) => a.date.localeCompare(b.date)),
    };
  },
});

export const create = mutation({
  args: fields,
  handler: async (ctx, a) => {
    await requireAll(ctx, "shoots");
    const c = cleanIn(a);
    const now = Date.now();
    const id = await ctx.db.insert("places", {
      name: c.name, address: c.address, ...(c.point ? { lat: c.point.lat, lng: c.point.lng } : {}),
      ...(c.parking ? { parking: c.parking } : {}), ...(c.power ? { power: c.power } : {}), ...(c.permits ? { permits: c.permits } : {}),
      ...(c.contacts ? { contacts: c.contacts } : {}), ...(c.notes ? { notes: c.notes } : {}), tags: c.tags, photos: [], createdAt: now, updatedAt: now,
    });
    if (!c.point && c.address) await ctx.scheduler.runAfter(0, internal.places.locate, { placeId: id });
    return id;
  },
});

export const update = mutation({
  args: { placeId: v.string(), ...fields },
  handler: async (ctx, { placeId, ...a }) => {
    await requireAll(ctx, "shoots");
    const p = await placeOf(ctx, placeId);
    const c = cleanIn(a);
    const moved = c.address !== p.address;
    await ctx.db.patch(p._id, {
      name: c.name, address: c.address, lat: c.point?.lat ?? (moved ? undefined : p.lat), lng: c.point?.lng ?? (moved ? undefined : p.lng),
      parking: c.parking, power: c.power, permits: c.permits, contacts: c.contacts, notes: c.notes, tags: c.tags, updatedAt: Date.now(),
    });
    if (!c.point && moved && c.address) await ctx.scheduler.runAfter(0, internal.places.locate, { placeId: p._id });
    return null;
  },
});

export const remove = mutation({
  args: { placeId: v.string() },
  handler: async (ctx, { placeId }) => {
    await requireAll(ctx, "shoots");
    const p = await placeOf(ctx, placeId);
    for (const l of await ctx.db.query("placeLinks").withIndex("by_place", (q) => q.eq("placeId", p._id)).collect()) await ctx.db.delete(l._id);
    for (const ph of p.photos) await deleteFile(ctx, ph.fileId, businessInScope(ctx));
    await ctx.db.delete(p._id);
    return null;
  },
});

// ---------- photos ----------

export const uploadUrl = mutation({ args: {}, handler: async (ctx) => { await requireAll(ctx, "shoots"); return ctx.storage.generateUploadUrl(); } });

export const addPhoto = mutation({
  args: { placeId: v.string(), storageId: v.id("_storage"), name: v.string() },
  handler: async (ctx, a) => {
    const me = await requireAll(ctx, "shoots");
    const p = await placeOf(ctx, a.placeId);
    if (p.photos.length >= MAX_PHOTOS) throw new ConvexError(`A place holds up to ${MAX_PHOTOS} photos.`);
    const meta = await ctx.db.system.get(a.storageId);
    if (!meta) throw new ConvexError("The upload didn't arrive. Try again.");
    if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(meta.contentType ?? "")) throw new ConvexError("That isn't a photo.");
    if ((meta.size ?? 0) > 25 * 1024 * 1024) throw new ConvexError("Photos can be up to 25 MB.");
    const claim = await claimUpload(ctx, a.storageId, businessInScope(ctx), "place-photo", me.userId);
    if (!claim.fresh) throw new ConvexError("Upload the photo again.");
    await ctx.db.patch(p._id, { photos: [...p.photos, { fileId: a.storageId, name: line(a.name, 120) || "Photo" }], updatedAt: Date.now() });
    return null;
  },
});

export const removePhoto = mutation({
  args: { placeId: v.string(), fileId: v.id("_storage") },
  handler: async (ctx, a) => {
    await requireAll(ctx, "shoots");
    const p = await placeOf(ctx, a.placeId);
    if (!p.photos.some((x) => x.fileId === a.fileId)) return null;
    await ctx.db.patch(p._id, { photos: p.photos.filter((x) => x.fileId !== a.fileId), updatedAt: Date.now() });
    await deleteFile(ctx, a.fileId, businessInScope(ctx));
    return null;
  },
});

/** Make a photo the first (the card's cover). */
export const coverPhoto = mutation({
  args: { placeId: v.string(), fileId: v.id("_storage") },
  handler: async (ctx, a) => {
    await requireAll(ctx, "shoots");
    const p = await placeOf(ctx, a.placeId);
    const ph = p.photos.find((x) => x.fileId === a.fileId);
    if (!ph) return null;
    await ctx.db.patch(p._id, { photos: [ph, ...p.photos.filter((x) => x.fileId !== a.fileId)], updatedAt: Date.now() });
    return null;
  },
});

// ---------- shoots ----------

export const forShoot = query({
  args: { shootId: v.string() },
  handler: async (ctx, { shootId }) => {
    await requireAll(ctx, "shoots");
    const id = ctx.db.normalizeId("shoots", shootId);
    const s = id ? await ctx.db.get(id) : null;
    if (!s) return null;
    const out = [];
    for (const l of await ctx.db.query("placeLinks").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).collect()) {
      const p = await ctx.db.get(l.placeId);
      if (p) out.push({ _id: p._id, name: p.name, address: p.address, lat: p.lat ?? null, lng: p.lng ?? null, photo: p.photos[0] ? await ctx.storage.getUrl(p.photos[0].fileId) : null, main: p.address === s.location || p.name === s.location });
    }
    return { places: out, location: s.location, date: s.date };
  },
});

/** Link a place to a shoot (its Locations tab); `asPlace` also makes it the shoot's place (and so its call sheet's). */
export const useForShoot = mutation({
  args: { placeId: v.string(), shootId: v.id("shoots"), asPlace: v.boolean() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "shoots");
    const p = await placeOf(ctx, a.placeId);
    const s = await ctx.db.get(a.shootId);
    if (!s || s.status !== "scheduled") throw new ConvexError("That shoot isn't here any more.");
    if (!(await ctx.db.query("placeLinks").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).collect()).some((l) => l.placeId === p._id))
      await ctx.db.insert("placeLinks", { placeId: p._id, shootId: s._id, createdAt: Date.now() });
    // The shoot's place is the address (the call sheet's Location block and the calendar read it). Nobody is emailed:
    // changing what the client was told stays the owner's Edit shoot.
    if (a.asPlace) await ctx.db.patch(s._id, { location: (p.address || p.name).slice(0, 200), updatedAt: Date.now() });
    return null;
  },
});

export const unlink = mutation({
  args: { placeId: v.string(), shootId: v.id("shoots") },
  handler: async (ctx, a) => {
    await requireAll(ctx, "shoots");
    const id = ctx.db.normalizeId("places", a.placeId);
    for (const l of await ctx.db.query("placeLinks").withIndex("by_shoot", (q) => q.eq("shootId", a.shootId)).collect()) if (l.placeId === id) await ctx.db.delete(l._id);
    return null;
  },
});

// ---------- the point, from the address ----------

export const locateInput = internalQuery({ args: { placeId: v.id("places") }, handler: async (ctx, { placeId }) => (await ctx.db.get(placeId))?.address ?? null });
export const locateStore = internalMutation({
  args: { placeId: v.id("places"), address: v.string(), lat: v.number(), lng: v.number() },
  handler: async (ctx, a) => { const p = await ctx.db.get(a.placeId); if (p && p.address === a.address && p.lat === undefined) await ctx.db.patch(p._id, { lat: a.lat, lng: a.lng }); },
});
export const locate = internalAction({
  args: { placeId: v.id("places") },
  handler: async (ctx, { placeId }) => {
    const address: string | null = await ctx.runQuery(internal.places.locateInput, { placeId });
    if (!address) return;
    const g = await geocode(address);
    if (g.kind === "found") await ctx.runMutation(internal.places.locateStore, { placeId, address, lat: g.geo.lat, lng: g.geo.lon });
  },
});
export type { Id };
