// 5n Delivery (D195, D196; Design Log "Handoff ready: Delivery" rounds 1 and 2): a long-term home for a project's final
// files, separate from Review. One delivery per project: a Video folder and Photo albums, each video and album tagged
// with a shoot day if wanted. Files are the project's own: originals from its Dropbox folder (D195) or its finished cuts;
// nothing is copied or deleted (when a delivery ends, files leave Delivery; Dropbox keeps them). The owner arranges and
// publishes by hand; the client sees only what's published, with an optional note in their Inbox. A term (Settings ›
// Payments › Delivery, changeable per delivery) sets Kept until; reminders go to the client's Inbox 30 and 7 days before
// the end; a renewal is offered like the raw-footage offer (the client's answer is recorded and the owner sends the
// invoice: nothing is charged automatically). The client can share a view-only link (one token per link, off any time).
import { action } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query, focusBusiness } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAll, requireSignedIn } from "./lib/access";
import { businessInScope } from "./lib/business";
import { label } from "./lib/bookingRows";
import { todayCentral } from "./lib/bookings";
import { randomToken } from "./lib/hash";
import { postToInbox } from "./lib/inbox";
import { businessOf } from "./lib/inbox";
import { myProjects, portalPeople } from "./projects";
import { resolveDownload } from "./library";
import { audit } from "./lib/audit";
import { defaultBusiness } from "./lib/business";

type Ctx = QueryCtx | MutationCtx;
export type DeliverySettings = { termYears: number; priceCents: number; offerRenewal: boolean; reminders: boolean };
// Wrangler's starting term and price are samples (the frames' "2 years" and "$0,000") for Heston to set in Settings.
export const DEFAULT_DELIVERY: DeliverySettings = { termYears: 2, priceCents: 15000, offerRenewal: true, reminders: true };
// Delivery review M5: other businesses start with no renewal offer and no automatic reminders until their owner turns them on.
const OFF: DeliverySettings = { termYears: 2, priceCents: 15000, offerRenewal: false, reminders: false };
const VIDEO = /\.(mp4|mov|m4v|webm)$/i, PHOTO = /\.(jpe?g|png|webp|heic|heif|gif|tiff?)$/i;
export const mediaOf = (name: string): "video" | "photo" | "file" => (VIDEO.test(name) ? "video" : PHOTO.test(name) ? "photo" : "file");
const tidy = (s: string | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const addYears = (day: string, n: number) => { const [y, m, d] = day.split("-").map(Number); const t = new Date(Date.UTC(y + n, m - 1, d, 12)); if (t.getUTCMonth() !== m - 1) t.setUTCDate(0); return t.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

async function settingsOf(ctx: Ctx, biz: Id<"businesses"> | null | undefined): Promise<DeliverySettings> {
  const b = biz ? await ctx.db.get(biz) : null;
  const saved = (b as { delivery?: Partial<DeliverySettings> } | null)?.delivery;
  const def = await defaultBusiness(ctx);
  const base = !b || (def && def._id === b._id) ? DEFAULT_DELIVERY : OFF;
  return { ...base, ...(saved ?? {}), reminders: saved?.reminders ?? (saved ? true : base.reminders) };
}

// ---------- Settings › Payments › Delivery ----------

export const settings = query({ args: {}, handler: async (ctx) => { await requireAll(ctx, "payments"); return await settingsOf(ctx, businessInScope(ctx)); } });
export const saveSettings = mutation({
  args: { termYears: v.number(), priceCents: v.number(), offerRenewal: v.boolean(), reminders: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "payments");
    const biz = businessInScope(ctx);
    if (!biz) throw new ConvexError("Not allowed.");
    if (!Number.isInteger(a.termYears) || a.termYears < 1 || a.termYears > 10) throw new ConvexError("Pick a term of 1 to 10 years.");
    const priceCents = Math.round(a.priceCents);
    if (!Number.isFinite(priceCents) || priceCents < 0 || priceCents > 1_000_000) throw new ConvexError("Set a yearly price up to $10,000.");
    await ctx.db.patch(biz, { delivery: { termYears: a.termYears, priceCents, offerRenewal: a.offerRenewal, reminders: a.reminders ?? true }, updatedAt: Date.now() });
    return null;
  },
});

// ---------- the owner's side ----------

async function projectOf(ctx: Ctx, projectId: string) {
  const id = ctx.db.normalizeId("projects", projectId);
  const p = id ? await ctx.db.get(id) : null;
  if (!p) throw new ConvexError("That project isn't here any more.");
  return p;
}
async function deliveryOf(ctx: Ctx, deliveryId: string) {
  const id = ctx.db.normalizeId("deliveries", deliveryId);
  const d = id ? await ctx.db.get(id) : null;
  if (!d) throw new ConvexError("That delivery isn't here any more.");
  return d;
}
const touch = (ctx: MutationCtx, d: Doc<"deliveries">) => ctx.db.patch(d._id, { changed: d.state === "published" ? true : d.changed, updatedAt: Date.now() });

/** Every delivery, with what the list shows (group by client, project or shoot; drafts; ending soon). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "projects");
    const today = todayCentral();
    const out = [];
    for (const d of await ctx.db.query("deliveries").collect()) {
      const p = await ctx.db.get(d.projectId);
      if (!p) continue;
      const c = p.clientId ? await ctx.db.get(p.clientId) : null;
      const items = await ctx.db.query("deliveryItems").withIndex("by_delivery", (q) => q.eq("deliveryId", d._id)).collect();
      const assets = await ctx.db.query("deliveryAssets").withIndex("by_delivery", (q) => q.eq("deliveryId", d._id)).collect();
      const shoots: Record<string, { date: string; n: number }> = {};
      for (const it of items) if (it.shootId) { const s = await ctx.db.get(it.shootId); if (s) shoots[s._id] = { date: s.date, n: (shoots[s._id]?.n ?? 0) + 1 }; }
      for (const x of assets) if (x.shootId) { const s = await ctx.db.get(x.shootId); if (s) shoots[s._id] = { date: s.date, n: (shoots[s._id]?.n ?? 0) + 1 }; }
      out.push({
        _id: d._id, projectId: p._id, project: label(p), client: c ? { _id: c._id, name: c.name } : null, state: d.state, changed: d.changed, keptUntil: d.keptUntil ?? null,
        endingSoon: !!d.keptUntil && d.state === "published" && daysBetween(today, d.keptUntil) <= 30, renewal: d.renewal ?? null,
        videos: assets.filter((x) => mediaOf(x.name) === "video").length, albums: items.filter((i) => i.kind === "album").length, photos: assets.filter((x) => mediaOf(x.name) === "photo").length,
        untagged: items.some((i) => i.kind === "album" && !i.shootId) || assets.some((x) => mediaOf(x.name) === "video" && !x.shootId), shoots: Object.entries(shoots).map(([id, s]) => ({ id, ...s })), updatedAt: d.updatedAt,
      });
    }
    return { today, deliveries: out.sort((a, b) => b.updatedAt - a.updatedAt) };
  },
});

/** One project's delivery (null: none yet), with its Video folder, albums, files, the project's shoot days and the term. */
export const get = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    await requireAll(ctx, "projects");
    const pid = ctx.db.normalizeId("projects", projectId);
    const p = pid ? await ctx.db.get(pid) : null;
    if (!p) return null;
    const c = p.clientId ? await ctx.db.get(p.clientId) : null;
    const shoots = (await ctx.db.query("shoots").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).filter((s) => s.status === "scheduled").map((s) => ({ _id: s._id, date: s.date, location: s.location }));
    const d = await ctx.db.query("deliveries").withIndex("by_project", (q) => q.eq("projectId", p._id)).first();
    const s = await settingsOf(ctx, p.businessId);
    const base = { project: { _id: p._id, label: label(p), client: c ? { _id: c._id, name: c.name } : null, dropbox: !!p.dropboxFolder }, shoots, settings: s };
    if (!d) return { ...base, delivery: null };
    const items = (await ctx.db.query("deliveryItems").withIndex("by_delivery", (q) => q.eq("deliveryId", d._id)).collect()).sort((a, b) => a.order - b.order);
    const assets = (await ctx.db.query("deliveryAssets").withIndex("by_delivery", (q) => q.eq("deliveryId", d._id)).collect()).sort((a, b) => a.order - b.order);
    const row = (x: Doc<"deliveryAssets">) => ({ _id: x._id, itemId: x.itemId, name: x.name, size: x.size ?? null, media: mediaOf(x.name), source: x.source, shootId: x.shootId ?? null, published: x.published, createdAt: x.createdAt });
    return {
      ...base,
      delivery: {
        _id: d._id, state: d.state, changed: d.changed, publishedAt: d.publishedAt ?? null, keptUntil: d.keptUntil ?? null, termYears: d.termYears ?? s.termYears, priceCents: d.priceCents ?? s.priceCents, renewal: d.renewal ?? null, endedAt: d.endedAt ?? null,
        items: items.map((i) => ({ _id: i._id, kind: i.kind, title: i.title, shootId: i.shootId ?? null, coverId: i.coverId ?? null, published: i.published, assets: assets.filter((x) => x.itemId === i._id).map(row) })),
        people: (await portalPeople(ctx, p)).map((x) => x.email),
      },
    };
  },
});

export const ensure = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const p = await projectOf(ctx, a.projectId);
    const have = await ctx.db.query("deliveries").withIndex("by_project", (q) => q.eq("projectId", p._id)).first();
    if (have) return have._id;
    const now = Date.now();
    const id = await ctx.db.insert("deliveries", { projectId: p._id, state: "draft", changed: false, createdAt: now, updatedAt: now });
    await ctx.db.insert("deliveryItems", { deliveryId: id, kind: "videos", title: "Video", order: 0, published: false, createdAt: now });
    return id;
  },
});

export const addAlbum = mutation({
  args: { deliveryId: v.string(), title: v.string(), shootId: v.optional(v.id("shoots")) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const d = await deliveryOf(ctx, a.deliveryId);
    await shootOnProject(ctx, d, a.shootId);
    const items = await ctx.db.query("deliveryItems").withIndex("by_delivery", (q) => q.eq("deliveryId", d._id)).collect();
    if (items.length >= 60) throw new ConvexError("Up to 60 albums in a delivery.");
    const id = await ctx.db.insert("deliveryItems", { deliveryId: d._id, kind: "album", title: tidy(a.title, 80) || "Photos", ...(a.shootId ? { shootId: a.shootId } : {}), order: Math.max(0, ...items.map((i) => i.order)) + 1, published: false, createdAt: Date.now() });
    await touch(ctx, d);
    return id;
  },
});
async function shootOnProject(ctx: Ctx, d: Doc<"deliveries">, shootId: Id<"shoots"> | null | undefined) {
  if (!shootId) return;
  const s = await ctx.db.get(shootId);
  if (!s || s.projectId !== d.projectId) throw new ConvexError("That shoot day isn't on this project.");
}

export const editItem = mutation({
  args: { itemId: v.id("deliveryItems"), title: v.optional(v.string()), shootId: v.optional(v.union(v.id("shoots"), v.null())), coverId: v.optional(v.id("deliveryAssets")) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const it = await ctx.db.get(a.itemId);
    if (!it) throw new ConvexError("That album isn't here any more.");
    const d = await deliveryOf(ctx, it.deliveryId);
    if (a.shootId) await shootOnProject(ctx, d, a.shootId);
    if (a.coverId) { const x = await ctx.db.get(a.coverId); if (!x || x.itemId !== it._id || mediaOf(x.name) !== "photo" || (it.published && !x.published)) throw new ConvexError(it.published ? "Pick a published photo in this album (publish the new ones first)." : "Pick a photo in this album."); }
    await ctx.db.patch(it._id, { ...(a.title !== undefined && it.kind === "album" ? { title: tidy(a.title, 80) || it.title } : {}), ...(a.shootId !== undefined ? { shootId: a.shootId ?? undefined } : {}), ...(a.coverId ? { coverId: a.coverId } : {}) });
    await touch(ctx, d);
    return null;
  },
});

export const removeItem = mutation({
  args: { itemId: v.id("deliveryItems") },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const it = await ctx.db.get(a.itemId);
    if (!it || it.kind !== "album") throw new ConvexError("Only an album can be removed.");
    const d = await deliveryOf(ctx, it.deliveryId);
    for (const x of await ctx.db.query("deliveryAssets").withIndex("by_item", (q) => q.eq("itemId", it._id)).collect()) await ctx.db.delete(x._id);
    await ctx.db.delete(it._id);
    await touch(ctx, d);
    return null;
  },
});

/** Add files: from the project's Dropbox folder (listed by projects.dropboxFiles) or its finished cuts. Videos go in the
 *  Video folder, photos in the album picked; uploads go in at the end. */
export const addFiles = mutation({
  args: {
    itemId: v.id("deliveryItems"),
    files: v.array(v.union(v.object({ kind: v.literal("dropbox"), path: v.string(), name: v.string(), size: v.optional(v.number()) }), v.object({ kind: v.literal("version"), versionId: v.id("versions") }))),
  },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const it = await ctx.db.get(a.itemId);
    if (!it) throw new ConvexError("That album isn't here any more.");
    const d = await deliveryOf(ctx, it.deliveryId);
    const p = (await ctx.db.get(d.projectId))!;
    const have = await ctx.db.query("deliveryAssets").withIndex("by_delivery", (q) => q.eq("deliveryId", d._id)).collect();
    if (have.length + a.files.length > 2000) throw new ConvexError("Up to 2,000 files in a delivery.");
    let order = Math.max(0, ...have.filter((x) => x.itemId === it._id).map((x) => x.order)) + 1, added = 0;
    for (const f of a.files) {
      let row: { name: string; size?: number; source: "dropbox" | "version"; dropboxPath?: string; versionId?: Id<"versions"> };
      if (f.kind === "dropbox") {
        const path = f.path.trim().toLowerCase();
        // Only the project's own Dropbox folder (the same rule as Final files).
        if (!p.dropboxFolder || !path.startsWith(`${p.dropboxFolder.toLowerCase().replace(/\/$/, "")}/`) || path.includes("..")) throw new ConvexError("That file isn't in this project's Dropbox folder.");
        // Review L7: the kind comes from the file itself (its path), not the name sent.
        const base = path.split("/").pop()!;
        const named = tidy(f.name, 200);
        row = { name: named && named.split(".").pop()?.toLowerCase() === base.split(".").pop() ? named : base, ...(f.size ? { size: f.size } : {}), source: "dropbox", dropboxPath: path };
      } else {
        const ver = await ctx.db.get(f.versionId);
        const vid = ver ? await ctx.db.get(ver.videoId) : null;
        if (!ver || !vid || vid.projectId !== p._id) throw new ConvexError("That cut isn't in this project.");
        const ext = (/\.([a-z0-9]{2,5})$/i.exec(String((ver as { fileName?: string }).fileName ?? "")) ?? [, "mp4"])[1]!.toLowerCase(); // review L9
        row = { name: `${vid.title} v${ver.number}.${VIDEO.test(`x.${ext}`) ? ext : "mp4"}`.slice(0, 200), ...(ver.fileSize ? { size: ver.fileSize } : {}), source: "version", versionId: ver._id };
      }
      const media = mediaOf(row.name);
      if (it.kind === "videos" ? media !== "video" : media !== "photo") throw new ConvexError(it.kind === "videos" ? `${row.name} isn't a video: add it to an album or Final files.` : `${row.name} isn't a photo.`);
      if (have.some((x) => (x.dropboxPath && x.dropboxPath === row.dropboxPath && x.itemId === it._id) || (x.versionId && x.versionId === row.versionId))) continue;
      await ctx.db.insert("deliveryAssets", { deliveryId: d._id, itemId: it._id, ...row, order: order++, published: false, createdAt: Date.now() });
      added++;
    }
    await touch(ctx, d);
    return { added };
  },
});

export const editAsset = mutation({
  args: { assetId: v.id("deliveryAssets"), shootId: v.optional(v.union(v.id("shoots"), v.null())), before: v.optional(v.union(v.id("deliveryAssets"), v.null())) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const x = await ctx.db.get(a.assetId);
    if (!x) throw new ConvexError("That file isn't here any more.");
    const d = await deliveryOf(ctx, x.deliveryId);
    if (a.shootId !== undefined) { await shootOnProject(ctx, d, a.shootId); await ctx.db.patch(x._id, { shootId: a.shootId ?? undefined }); }
    if (a.before !== undefined) {
      // Drag to arrange: put it before another file in the same folder (or at the end).
      const sib = (await ctx.db.query("deliveryAssets").withIndex("by_item", (q) => q.eq("itemId", x.itemId)).collect()).filter((y) => y._id !== x._id).sort((p, q) => p.order - q.order);
      const at = a.before ? sib.findIndex((y) => y._id === a.before) : sib.length;
      if (at < 0) throw new ConvexError("That file isn't in this folder.");
      sib.splice(at, 0, x);
      for (let i = 0; i < sib.length; i++) if (sib[i].order !== i + 1) await ctx.db.patch(sib[i]._id, { order: i + 1 });
    }
    await touch(ctx, d);
    return null;
  },
});

export const removeAsset = mutation({
  args: { assetId: v.id("deliveryAssets") },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const x = await ctx.db.get(a.assetId);
    if (!x) return null;
    const d = await deliveryOf(ctx, x.deliveryId);
    const it = await ctx.db.get(x.itemId);
    if (it?.coverId === x._id) await ctx.db.patch(it._id, { coverId: undefined });
    await ctx.db.delete(x._id); // the file itself stays where it is (Dropbox, or the cut)
    await touch(ctx, d);
    return null;
  },
});

/** Publish (changes): what's here becomes what the client sees. The first publish starts the term. `tell`: a note in
 *  the client's Inbox ("New files are ready in your Delivery"); off by default for a change. */
export const publish = mutation({
  args: { deliveryId: v.string(), tell: v.boolean() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const d = await deliveryOf(ctx, a.deliveryId);
    if (d.state === "ended") throw new ConvexError("This delivery ended. Renew it first.");
    const p = (await ctx.db.get(d.projectId))!;
    const assets = await ctx.db.query("deliveryAssets").withIndex("by_delivery", (q) => q.eq("deliveryId", d._id)).collect();
    if (!assets.length) throw new ConvexError("Add a video or some photos first.");
    const fresh = assets.filter((x) => !x.published).length;
    for (const x of assets) if (!x.published) await ctx.db.patch(x._id, { published: true });
    for (const it of await ctx.db.query("deliveryItems").withIndex("by_delivery", (q) => q.eq("deliveryId", d._id)).collect()) if (!it.published) await ctx.db.patch(it._id, { published: true });
    const now = Date.now(), first = d.state === "draft";
    const s = await settingsOf(ctx, p.businessId);
    await ctx.db.patch(d._id, { state: "published", changed: false, publishedAt: now, ...(first && !d.keptUntil ? { keptUntil: addYears(todayCentral(now), d.termYears ?? s.termYears) } : {}), updatedAt: now });
    let told = 0;
    const biz = await businessOf(ctx, p);
    if (a.tell && biz) for (const person of await portalPeople(ctx, p)) {
      if (await postToInbox(ctx, { businessId: biz, clientId: p.clientId, email: person.email, kind: "final_files", title: first ? "Your files are ready in Delivery" : "New files are ready in your Delivery", text: `${label(p)}${fresh ? ` · ${fresh} new` : ""}`, link: `/delivery?project=${p._id}`, linkLabel: "Open Delivery", source: { module: "projects", id: d._id }, key: `delivery:${d._id}:${now}` })) told++;
    }
    await audit(ctx, { kind: "sent", where: "Post › Delivery", link: `/delivery/${p._id}`, text: `Published ${label(p)}'s delivery${fresh ? ` (${fresh} new file${fresh === 1 ? "" : "s"})` : ""}${told ? `, told ${told}` : ""}` });
    return { told, fresh };
  },
});

/** Kept until (Change the date, or the term and price for this delivery). */
export const setTerm = mutation({
  args: { deliveryId: v.string(), keptUntil: v.optional(v.string()), priceCents: v.optional(v.number()), termYears: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const d = await deliveryOf(ctx, a.deliveryId);
    if (a.keptUntil && (!/^\d{4}-\d{2}-\d{2}$/.test(a.keptUntil) || new Date(`${a.keptUntil}T12:00:00Z`).toISOString().slice(0, 10) !== a.keptUntil)) throw new ConvexError("Pick a day.");
    // Review M2: how long it's kept, and the price, are money: Payments (a shorter date is anyone's with Projects).
    if (a.priceCents !== undefined || a.termYears !== undefined || (a.keptUntil && a.keptUntil > (d.keptUntil ?? ""))) await requireAll(ctx, "payments");
    if (a.priceCents !== undefined && (!Number.isFinite(a.priceCents) || a.priceCents < 0 || a.priceCents > 1_000_000)) throw new ConvexError("Set a yearly price up to $10,000.");
    if (a.termYears !== undefined && (!Number.isInteger(a.termYears) || a.termYears < 1 || a.termYears > 10)) throw new ConvexError("Pick a term of 1 to 10 years.");
    await ctx.db.patch(d._id, { ...(a.keptUntil ? { keptUntil: a.keptUntil, reminded: [], renewal: undefined, ...(d.state === "ended" && a.keptUntil > todayCentral() ? { state: "published" as const, endedAt: undefined } : {}) } : {}), ...(a.priceCents !== undefined ? { priceCents: Math.round(a.priceCents) } : {}), ...(a.termYears !== undefined ? { termYears: a.termYears } : {}), updatedAt: Date.now() });
    return null;
  },
});

/** Renewal (ending soon): offer it (the client sees Keep it / No thanks), keep it another year free, or let it end. */
export const renewal = mutation({
  args: { deliveryId: v.string(), choice: v.union(v.literal("offer"), v.literal("free"), v.literal("end")) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    if (a.choice !== "end") await requireAll(ctx, "payments"); // review M2: offering a price or a free year needs Payments
    const d = await deliveryOf(ctx, a.deliveryId);
    if (!d.keptUntil) throw new ConvexError("Publish it first.");
    const now = Date.now();
    if (a.choice === "free") await ctx.db.patch(d._id, { keptUntil: addYears(d.keptUntil > todayCentral() ? d.keptUntil : todayCentral(), 1), renewal: { status: "free", at: now }, reminded: [], ...(d.state === "ended" ? { state: "published" as const, endedAt: undefined } : {}), updatedAt: now });
    else if (a.choice === "offer") await ctx.db.patch(d._id, { renewal: { status: "offered", at: now }, updatedAt: now });
    else await ctx.db.patch(d._id, { renewal: { status: "ending", at: now }, updatedAt: now });
    return null;
  },
});

/** The owner pressed "Renewed" after the client's invoice was sent or paid: another year. */
export const renewed = mutation({
  args: { deliveryId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "payments");
    const d = await deliveryOf(ctx, a.deliveryId);
    if (!d.keptUntil) throw new ConvexError("Publish it first.");
    const now = Date.now();
    await ctx.db.patch(d._id, { keptUntil: addYears(d.keptUntil > todayCentral() ? d.keptUntil : todayCentral(), 1), renewal: { status: "renewed", at: now }, reminded: [], ...(d.state === "ended" ? { state: "published" as const, endedAt: undefined } : {}), updatedAt: now });
    return null;
  },
});

/** Review L3: shown to the client only while published and not past its day (the daily job may not have run yet). */
const live = (d: Doc<"deliveries">) => d.state === "published" && (!d.keptUntil || d.keptUntil >= todayCentral());

// ---------- links to a file (play, download): the owner, a client who can see it, or a shared link ----------

export const assetFor = internalQuery({
  args: { assetId: v.id("deliveryAssets"), token: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const x = await ctx.db.get(a.assetId);
    const d = x ? await ctx.db.get(x.deliveryId) : null;
    if (!x || !d) throw new ConvexError("That file isn't available.");
    const p = await ctx.db.get(d.projectId);
    if (!p) throw new ConvexError("That file isn't available.");
    if (a.token) {
      const l = await linkByToken(ctx, a.token);
      if (!l || l.d._id !== d._id || !x.published || (l.link.itemId && l.link.itemId !== x.itemId)) throw new ConvexError("That file isn't available.");
      focusBusiness(ctx, d.businessId);
      return { x, businessId: d.businessId ?? null, download: l.link.downloads };
    }
    let owner = true;
    try { await requireAll(ctx, "projects"); } catch { owner = false; }
    if (!owner) {
      const me = await requireSignedIn(ctx);
      if (me.kind !== "client" || !x.published || !live(d) || !(await myProjects(ctx, me.email)).has(p._id)) throw new ConvexError("That file isn't available.");
    }
    return { x, businessId: p.businessId ?? null, download: true };
  },
});

/** A short-lived address for one file (Dropbox's temporary link, or the cut's own file). */
export const assetUrl = action({
  args: { assetId: v.id("deliveryAssets"), token: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ url: string; name: string; download: boolean }> => {
    const f: { x: Doc<"deliveryAssets">; businessId: Id<"businesses"> | null; download: boolean } = await ctx.runQuery(internal.delivery.assetFor, a);
    if (f.x.source === "dropbox") {
      const url: string = await ctx.runAction(internal.dropbox.temporaryLink, { path: f.x.dropboxPath!, ...(f.businessId ? { asBusiness: f.businessId } : {}) });
      return { url, name: f.x.name, download: f.download };
    }
    const r = await resolveDownload(ctx, f.x.versionId!, f.x.name, Math.floor((Date.now() + 4 * 3_600_000) / 1000));
    return { url: r.url, name: r.name, download: f.download };
  },
});

// ---------- the client's side ----------

async function shownTo(ctx: Ctx, d: Doc<"deliveries">, onlyItem?: Id<"deliveryItems"> | null) {
  const items = (await ctx.db.query("deliveryItems").withIndex("by_delivery", (q) => q.eq("deliveryId", d._id)).collect()).filter((i) => i.published && (!onlyItem || i._id === onlyItem)).sort((a, b) => a.order - b.order);
  const assets = (await ctx.db.query("deliveryAssets").withIndex("by_delivery", (q) => q.eq("deliveryId", d._id)).collect()).filter((x) => x.published).sort((a, b) => a.order - b.order);
  return items.map((i) => {
    const xs = assets.filter((x) => x.itemId === i._id);
    return { _id: i._id, kind: i.kind, title: i.title, coverId: i.coverId ?? xs.find((x) => mediaOf(x.name) === "photo")?._id ?? null, assets: xs.map((x) => ({ _id: x._id, name: x.name, size: x.size ?? null, media: mediaOf(x.name) })) };
  }).filter((i) => i.assets.length);
}

export const forClient = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return [];
    const mine = await myProjects(ctx, me.email);
    const out = [];
    for (const [, r] of mine) {
      const d = await ctx.db.query("deliveries").withIndex("by_project", (q) => q.eq("projectId", r.project._id)).first();
      if (!d || !live(d)) continue;
      const biz = d.businessId ? await ctx.db.get(d.businessId) : null;
      const s = await settingsOf(ctx, d.businessId);
      const today = todayCentral();
      const left = d.keptUntil ? daysBetween(today, d.keptUntil) : null;
      const links = (await ctx.db.query("deliveryLinks").withIndex("by_delivery", (q) => q.eq("deliveryId", d._id)).collect()).filter((l) => l.by === me.email.toLowerCase());
      out.push({
        _id: d._id, project: label(r.project), projectId: r.project._id, business: biz?.name ?? null, keptUntil: d.keptUntil ?? null, items: await shownTo(ctx, d),
        offer: offerShown(d, s, today) ? { priceCents: d.priceCents ?? s.priceCents, until: d.keptUntil! } : null,
        answered: d.renewal?.status === "kept" || d.renewal?.status === "declined" ? d.renewal.status : null,
        links: links.map((l) => ({ _id: l._id, token: l.token, itemId: l.itemId ?? null, downloads: l.downloads, on: l.on })),
      });
    }
    return out;
  },
});

/** The renewal question shows 30 days before the end: offered by the owner, or on in Settings with nothing decided. */
function offerShown(d: Doc<"deliveries">, s: DeliverySettings, today: string) {
  const left = d.keptUntil ? daysBetween(today, d.keptUntil) : null;
  return left !== null && left >= 0 && left <= 30 && (d.renewal?.status === "offered" || (s.offerRenewal && !d.renewal));
}
async function clientDelivery(ctx: Ctx, deliveryId: Id<"deliveries">) {
  const me = await requireSignedIn(ctx);
  const d = await ctx.db.get(deliveryId);
  if (me.kind !== "client" || !d || !live(d) || !(await myProjects(ctx, me.email)).has(d.projectId)) throw new ConvexError("That delivery isn't available.");
  focusBusiness(ctx, d.businessId); // review L4: a client of two businesses
  return { me, d };
}

/** 30 days before the end: Keep it (another year; an invoice follows from the owner) or No thanks. */
export const clientAnswer = mutation({
  args: { deliveryId: v.id("deliveries"), keep: v.boolean() },
  handler: async (ctx, a) => {
    const { me, d } = await clientDelivery(ctx, a.deliveryId);
    const p = (await ctx.db.get(d.projectId))!;
    // Review M3: only while the question is showing (never over the owner's free year, renewal or Let it end).
    if (!offerShown(d, await settingsOf(ctx, d.businessId), todayCentral())) throw new ConvexError("There's nothing to answer right now.");
    await ctx.db.patch(d._id, { renewal: { status: a.keep ? "kept" : "declined", at: Date.now(), by: me.name?.trim() || me.email }, updatedAt: Date.now() });
    // Review M4: the owner hears at once (bell, with a phone alert where Payments alerts are on).
    if (d.businessId) await ctx.scheduler.runAfter(0, internal.bell.post, { businessId: d.businessId, kind: "payments", title: `${me.name?.trim() || me.email} ${a.keep ? "wants to keep" : "doesn't need"} ${label(p)}'s Delivery another year${a.keep ? ": send the invoice" : ""}`, key: `delivery-renewal:${d._id}:${d.keptUntil}`, link: `/delivery/${p._id}?renew=1`, projectId: p._id });
    await audit(ctx, { kind: "settings", where: "Post › Delivery", link: `/delivery/${p._id}`, text: `${me.name?.trim() || me.email} chose ${a.keep ? "Keep it" : "No thanks"} for ${label(p)}'s delivery`, businessId: d.businessId });
    return null;
  },
});

/** Share a link: everything, or one video folder or album; downloads on or off; one token per link. */
export const makeLink = mutation({
  args: { deliveryId: v.id("deliveries"), itemId: v.optional(v.id("deliveryItems")), downloads: v.boolean() },
  handler: async (ctx, a) => {
    const { me, d } = await clientDelivery(ctx, a.deliveryId);
    if (a.itemId) { const it = await ctx.db.get(a.itemId); if (!it || it.deliveryId !== d._id || !it.published) throw new ConvexError("That album isn't in this delivery."); }
    const mine = (await ctx.db.query("deliveryLinks").withIndex("by_delivery", (q) => q.eq("deliveryId", d._id)).collect()).filter((l) => l.by === me.email.toLowerCase() && l.on);
    if (mine.length >= 30) throw new ConvexError("Turn an old link off first.");
    const token = randomToken(24);
    await ctx.db.insert("deliveryLinks", { deliveryId: d._id, ...(a.itemId ? { itemId: a.itemId } : {}), token, downloads: a.downloads, on: true, by: me.email.toLowerCase(), createdAt: Date.now() });
    return { token };
  },
});
export const setLink = mutation({
  args: { linkId: v.id("deliveryLinks"), on: v.optional(v.boolean()), downloads: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const me = await requireSignedIn(ctx);
    const l = await ctx.db.get(a.linkId);
    if (!l || l.by !== me.email.toLowerCase()) throw new ConvexError("That link isn't yours.");
    // Delivery review H1: only while they can still open the project (a link turned off by a move stays off).
    if (a.on) await clientDelivery(ctx, l.deliveryId);
    await ctx.db.patch(l._id, { ...(a.on !== undefined ? { on: a.on } : {}), ...(a.downloads !== undefined ? { downloads: a.downloads } : {}) });
    return null;
  },
});

async function linkByToken(ctx: Ctx, token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const link = await ctx.db.query("deliveryLinks").withIndex("by_token", (q) => q.eq("token", token)).first();
  if (!link?.on) return null;
  const d = await ctx.db.get(link.deliveryId);
  if (!d || !live(d)) return null;
  // Review H1: the link works only while its maker can still open the project.
  if (!(await myProjects(ctx as QueryCtx, link.by)).has(d.projectId)) return null;
  return { link, d };
}

/** The shared-link page (no account): what was shared, and Download all if allowed. */
export const shared = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const l = await linkByToken(ctx, token);
    if (!l) return null;
    focusBusiness(ctx, l.d.businessId);
    const p = await ctx.db.get(l.d.projectId);
    const c = p?.clientId ? await ctx.db.get(p.clientId) : null;
    const biz = l.d.businessId ? await ctx.db.get(l.d.businessId) : null;
    return { by: c?.name ?? null, business: biz?.name ?? null, keptUntil: l.d.keptUntil ?? null, downloads: l.link.downloads, items: await shownTo(ctx, l.d, l.link.itemId ?? null) };
  },
});

// ---------- the daily job: reminders 30 and 7 days before; ended deliveries leave Delivery ----------

export const runDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = todayCentral();
    let n = 0;
    for (const d of await ctx.db.query("deliveries").collect()) {
      if (d.state !== "published" || !d.keptUntil) continue;
      const p = await ctx.db.get(d.projectId);
      if (!p) continue;
      const left = daysBetween(today, d.keptUntil);
      if (left < 0) {
        // Review M4: a client who chose Keep it isn't cut off while the owner hasn't answered; the owner is told instead.
        if (d.renewal?.status === "kept") { if (d.businessId && !(d.reminded ?? []).includes(0)) { await ctx.scheduler.runAfter(0, internal.bell.post, { businessId: d.businessId, kind: "payments", title: `${label(p)}'s Delivery reached its day; the client chose Keep it: send the invoice or let it end`, key: `delivery-ended-kept:${d._id}:${d.keptUntil}`, link: `/delivery/${p._id}?renew=1`, projectId: p._id }); await ctx.db.patch(d._id, { reminded: [...(d.reminded ?? []), 0] }); } continue; }
        await ctx.db.patch(d._id, { state: "ended", endedAt: Date.now() }); n++; continue; // files leave Delivery; nothing is deleted
      }
      const s = await settingsOf(ctx, d.businessId);
      if (!s.reminders) continue; // review M5: the owner's switch
      // Review M1: the nearest threshold (7 before 30); the ones above it count as sent too.
      const due = [7, 30].find((x) => left <= x);
      if (!due || (d.reminded ?? []).includes(due) || d.renewal?.status === "free" || d.renewal?.status === "renewed" || d.renewal?.status === "kept") continue;
      const offering = offerShown(d, s, today);
      const biz = await businessOf(ctx, p);
      if (biz) for (const person of await portalPeople(ctx, p))
        await postToInbox(ctx, { businessId: biz, clientId: p.clientId, email: person.email, kind: "final_files", title: due === 7 ? "Your Delivery files leave in 7 days" : "Your Delivery files: 30 days left", text: `${label(p)} · kept until ${longDay(d.keptUntil)}. Download anything you want to keep${offering && d.renewal?.status !== "declined" ? ", or keep it all for another year" : ""}.`, link: `/delivery?project=${p._id}`, linkLabel: "Open Delivery", source: { module: "projects", id: d._id }, key: `delivery:${d._id}:remind:${due}:${d.keptUntil}` });
      await ctx.db.patch(d._id, { reminded: [...(d.reminded ?? []), ...[30, 7].filter((x) => x >= due)] });
      n++;
    }
    return n;
  },
});
export type { Doc };
