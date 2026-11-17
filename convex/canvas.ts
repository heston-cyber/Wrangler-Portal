// 5l round 2 (D183–D185; Design Log "Handoff ready: Creative planning, round 2"): Canvas and mood boards. A board is a
// list of items (notes, boxes, text, pen strokes, photos, PDFs, files, links, tables, frames) saved as you go (D184:
// each save carries the revision it started from, so an older save can't overwrite a newer one; no live cursors).
// Only the business sees a board until it's shared (D183): with a person (Can view / Can edit, their own link, which
// the owner copies; nothing is emailed) or by one view-only link. Uploads: 25 MB a file (D90's limit), programs and
// web pages refused. A mood board is a canvas that starts from the Mood board layout. Owner and team with Projects.
import { fileLink } from "./lib/fileLinks";
import { mutation, query, focusBusiness } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAll } from "./lib/access";
import { claimUpload, deleteFile } from "./lib/fileOwners";
import { businessInScope } from "./lib/business";
import { randomToken } from "./lib/hash";
import { homeChip } from "./creative";
import { CANVAS_LIMITS, cleanItems, moodBoard, refusedFile, type CanvasItem } from "./lib/canvas";
import { placeOf, peopleAt } from "./lib/placed";

type Ctx = QueryCtx | MutationCtx;
const homeArg = v.optional(v.union(v.null(), v.object({ type: v.union(v.literal("client"), v.literal("project"), v.literal("shoot"), v.literal("lead")), id: v.string() })));
const tidy = (s: string | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

async function boardOf(ctx: Ctx, canvasId: string) {
  const id = ctx.db.normalizeId("canvases", canvasId);
  const c = id ? await ctx.db.get(id) : null;
  if (!c) throw new ConvexError("That board isn't here any more.");
  return c;
}
const itemsOf = (c: Doc<"canvases">) => (Array.isArray(c.items) ? (c.items as CanvasItem[]) : []);
async function urls(ctx: Ctx, c: Doc<"canvases">, onlyUsed = false) {
  const out: Record<string, string | null> = {};
  // Review L5: a shared link gets only the files on the board now.
  const used = new Set(itemsOf(c).map((x) => x.fileId).filter(Boolean) as string[]);
  for (const f of c.files) if (!onlyUsed || used.has(f)) out[f] = await fileLink(f, "file"); // Phase 6 M1: a 10-20 minute link
  return out;
}
/** A small picture of the board for its card: the items' boxes, with photo addresses (at most 30). */
async function preview(ctx: Ctx, c: Doc<"canvases">) {
  const it = itemsOf(c).slice(0, 60);
  const shown = [];
  for (const x of it.slice(0, 30)) shown.push({ type: x.type, x: x.x, y: x.y, w: x.w, h: x.h, color: x.color ?? null, fill: x.fill ?? null, pts: x.type === "arrow" || x.type === "line" ? (x.points ?? []).slice(0, 4) : null, src: x.type === "image" && x.fileId ? await fileLink(x.fileId, "image") : null });
  return shown;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "projects");
    const out = [];
    for (const c of await ctx.db.query("canvases").collect()) {
      const people = await ctx.db.query("canvasPeople").withIndex("by_canvas", (q) => q.eq("canvasId", c._id)).collect();
      out.push({ _id: c._id, name: c.name, kind: c.kind, home: await homeChip(ctx, c), at: c.updatedAt, editedBy: c.editedBy ?? null, shared: people.length + (c.link?.on ? 1 : 0), people: people.length, link: !!c.link?.on, preview: await preview(ctx, c) });
    }
    return out.sort((a, b) => b.at - a.at);
  },
});

export const create = mutation({
  args: { name: v.string(), kind: v.union(v.literal("canvas"), v.literal("mood")), home: homeArg },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const name = tidy(a.name, 80) || (a.kind === "mood" ? "Mood board" : "Untitled canvas");
    const fields: Record<string, Id<"clients"> | Id<"projects"> | Id<"shoots"> | Id<"deals">> = {};
    if (a.home) {
      const table = { client: "clients", project: "projects", shoot: "shoots", lead: "deals" }[a.home.type] as "clients";
      const id = ctx.db.normalizeId(table, a.home.id);
      if (!id || !(await ctx.db.get(id))) throw new ConvexError("That home isn't here any more.");
      if (a.home.type === "client" || a.home.type === "lead") await requireAll(ctx, "clients");
      if (a.home.type === "shoot") await requireAll(ctx, "shoots");
      fields[{ client: "clientId", project: "projectId", shoot: "shootId", lead: "dealId" }[a.home.type]] = id;
    }
    const now = Date.now();
    return await ctx.db.insert("canvases", { name, kind: a.kind, items: a.kind === "mood" ? moodBoard() : [], rev: 0, ...fields, files: [], createdAt: now, updatedAt: now });
  },
});

/** The board, for the owner and team. */
export const get = query({
  args: { canvasId: v.string() },
  handler: async (ctx, { canvasId }) => {
    await requireAll(ctx, "projects");
    const id = ctx.db.normalizeId("canvases", canvasId);
    const c = id ? await ctx.db.get(id) : null;
    if (!c) return null;
    const people = await ctx.db.query("canvasPeople").withIndex("by_canvas", (q) => q.eq("canvasId", c._id)).collect();
    return {
      _id: c._id, name: c.name, kind: c.kind, items: itemsOf(c), rev: c.rev, files: await urls(ctx, c), home: await homeChip(ctx, c), editedBy: c.editedBy ?? null, at: c.updatedAt,
      people: people.map((p) => ({ _id: p._id, email: p.email, name: p.name ?? null, role: p.role, token: p.token, openedAt: p.openedAt ?? null })),
      link: c.link ?? null, limits: CANVAS_LIMITS,
    };
  },
});

/** Live save (D184): refused when someone saved since this copy was read; the newer board comes back to merge onto. */
async function saveItems(ctx: MutationCtx, c: Doc<"canvases">, items: unknown, rev: number, by: string) {
  if (rev !== c.rev) return { ok: false as const, rev: c.rev, items: itemsOf(c) };
  const clean = cleanItems(items, new Set(c.files.map(String)));
  await ctx.db.patch(c._id, { items: clean, rev: c.rev + 1, editedBy: by, updatedAt: Date.now() });
  return { ok: true as const, rev: c.rev + 1 };
}

export const save = mutation({
  args: { canvasId: v.string(), items: v.any(), rev: v.number() },
  handler: async (ctx, a) => {
    const me = await requireAll(ctx, "projects");
    return await saveItems(ctx, await boardOf(ctx, a.canvasId), a.items, a.rev, me.name?.trim() || me.email);
  },
});

export const rename = mutation({
  args: { canvasId: v.string(), name: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const c = await boardOf(ctx, a.canvasId);
    const name = tidy(a.name, 80);
    if (!name) throw new ConvexError("Name the board.");
    await ctx.db.patch(c._id, { name, updatedAt: Date.now() });
    return null;
  },
});

export const duplicate = mutation({
  args: { canvasId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const c = await boardOf(ctx, a.canvasId);
    const now = Date.now();
    // Photos and files are the original board's: the copy keeps everything else (its uploads would be shared otherwise).
    const items = itemsOf(c).filter((x) => !x.fileId);
    return await ctx.db.insert("canvases", { name: `${c.name} (copy)`, kind: c.kind, items, rev: 0, ...(c.clientId ? { clientId: c.clientId } : {}), ...(c.projectId ? { projectId: c.projectId } : {}), ...(c.shootId ? { shootId: c.shootId } : {}), ...(c.dealId ? { dealId: c.dealId } : {}), files: [], createdAt: now, updatedAt: now });
  },
});

export const remove = mutation({
  args: { canvasId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const c = await boardOf(ctx, a.canvasId);
    for (const f of c.files) await deleteFile(ctx, f, businessInScope(ctx));
    for (const p of await ctx.db.query("canvasPeople").withIndex("by_canvas", (q) => q.eq("canvasId", c._id)).collect()) await ctx.db.delete(p._id);
    await ctx.db.delete(c._id);
    return null;
  },
});

// ---------- uploads (Import, Image or file) ----------

export const uploadUrl = mutation({
  args: { canvasId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const c = await boardOf(ctx, a.canvasId);
    if (c.files.length >= CANVAS_LIMITS.files) throw new ConvexError(`A board holds up to ${CANVAS_LIMITS.files} files. Remove some first.`);
    return await ctx.storage.generateUploadUrl();
  },
});

/** After the browser uploads: the size and kind are checked (a refused file is deleted, and why is returned). */
export const addFile = mutation({
  args: { canvasId: v.string(), storageId: v.id("_storage"), name: v.string() },
  handler: async (ctx, a) => {
    const me = await requireAll(ctx, "projects");
    const c = await boardOf(ctx, a.canvasId);
    const meta = await ctx.db.system.get(a.storageId);
    if (!meta) return { error: "The file didn't upload. Try again." };
    if (!(await claimUpload(ctx, a.storageId, businessInScope(ctx), "canvas", me.userId)).fresh) return { error: "The file didn't upload. Try again." };
    const why = refusedFile(a.name, meta.contentType ?? "", meta.size);
    if (why) { await deleteFile(ctx, a.storageId, businessInScope(ctx)); return { error: why }; }
    if (c.files.length >= CANVAS_LIMITS.files) { await deleteFile(ctx, a.storageId, businessInScope(ctx)); return { error: `A board holds up to ${CANVAS_LIMITS.files} files.` }; }
    await ctx.db.patch(c._id, { files: [...c.files, a.storageId], updatedAt: Date.now() });
    return { error: null, fileId: a.storageId, url: await ctx.storage.getUrl(a.storageId), type: meta.contentType ?? "", size: meta.size };
  },
});

/** A file no item uses any more is deleted (the board calls this after an item holding it is deleted and saved). */
export const dropUnused = mutation({
  args: { canvasId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const c = await boardOf(ctx, a.canvasId);
    const used = new Set(itemsOf(c).map((x) => x.fileId).filter(Boolean) as string[]);
    const gone = c.files.filter((f) => !used.has(f));
    for (const f of gone) await deleteFile(ctx, f, businessInScope(ctx));
    if (gone.length) await ctx.db.patch(c._id, { files: c.files.filter((f) => used.has(f)) });
    return gone.length;
  },
});

// ---------- sharing (D183, 1075-35498) ----------

/** "Add someone from this project": the client's people and the crew booked on it. */
export const shareChoices = query({
  args: { canvasId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const c = await boardOf(ctx, a.canvasId);
    const s = c.shootId ? await ctx.db.get(c.shootId) : null;
    const pid = c.projectId ?? s?.projectId;
    const out: Array<{ email: string; name: string | null; who: "client" | "crew" }> = [];
    const w = await placeOf(ctx, { projectId: pid, clientId: c.clientId });
    if (w) for (const p of await peopleAt(ctx, w)) out.push({ email: p.email, name: null, who: "client" });
    if (pid) for (const k of await ctx.db.query("vendorBookings").withIndex("by_project", (q) => q.eq("projectId", pid)).collect()) {
      if (k.status !== "accepted" && k.status !== "offered") continue;
      const vd = await ctx.db.get(k.vendorId);
      if (vd?.email && !out.some((x) => x.email.toLowerCase() === vd.email.toLowerCase())) out.push({ email: vd.email, name: vd.name, who: "crew" });
    }
    return out;
  },
});

export const addPerson = mutation({
  args: { canvasId: v.string(), email: v.string(), name: v.optional(v.string()), role: v.union(v.literal("view"), v.literal("edit")) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const c = await boardOf(ctx, a.canvasId);
    const email = tidy(a.email, 200).toLowerCase();
    if (!isEmail(email)) throw new ConvexError("Enter their email.");
    const have = await ctx.db.query("canvasPeople").withIndex("by_canvas", (q) => q.eq("canvasId", c._id)).collect();
    const same = have.find((p) => p.email === email);
    if (same) { await ctx.db.patch(same._id, { role: a.role }); return { token: same.token }; }
    if (have.length >= 50) throw new ConvexError("A board can be shared with up to 50 people.");
    const token = randomToken(24);
    await ctx.db.insert("canvasPeople", { canvasId: c._id, email, ...(tidy(a.name, 80) ? { name: tidy(a.name, 80) } : {}), role: a.role, token, createdAt: Date.now() });
    return { token };
  },
});

export const setRole = mutation({
  args: { personId: v.id("canvasPeople"), role: v.union(v.literal("view"), v.literal("edit")) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const p = await ctx.db.get(a.personId);
    if (!p) throw new ConvexError("They don't have access any more.");
    await ctx.db.patch(p._id, { role: a.role });
    return null;
  },
});

export const removePerson = mutation({
  args: { personId: v.id("canvasPeople") },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const p = await ctx.db.get(a.personId);
    if (p) await ctx.db.delete(p._id);
    return null;
  },
});

export const setLink = mutation({
  args: { canvasId: v.string(), on: v.boolean() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const c = await boardOf(ctx, a.canvasId);
    const link = { token: c.link?.token ?? randomToken(24), on: a.on };
    await ctx.db.patch(c._id, { link });
    return link;
  },
});

/** Stop sharing: everyone's links and the view-only link stop working. */
export const stopSharing = mutation({
  args: { canvasId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const c = await boardOf(ctx, a.canvasId);
    for (const p of await ctx.db.query("canvasPeople").withIndex("by_canvas", (q) => q.eq("canvasId", c._id)).collect()) await ctx.db.delete(p._id);
    if (c.link) await ctx.db.patch(c._id, { link: { ...c.link, on: false } });
    return null;
  },
});

// ---------- the shared board (/cv/<token>), no account ----------

async function byToken(ctx: Ctx, token: string): Promise<{ c: Doc<"canvases">; role: "view" | "edit"; person: Doc<"canvasPeople"> | null } | null> {
  if (!TOKEN.test(token)) return null;
  const person = await ctx.db.query("canvasPeople").withIndex("by_token", (q) => q.eq("token", token)).first();
  if (person) { const c = await ctx.db.get(person.canvasId); return c ? { c, role: person.role, person } : null; }
  const c = await ctx.db.query("canvases").withIndex("by_link", (q) => q.eq("link.token", token)).first();
  return c?.link?.on ? { c, role: "view", person: null } : null;
}

export const shared = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const f = await byToken(ctx, token);
    if (!f) return null;
    focusBusiness(ctx, f.c.businessId);
    const biz = f.c.businessId ? await ctx.db.get(f.c.businessId) : null;
    return { name: f.c.name, kind: f.c.kind, from: biz?.name ?? null, role: f.role, items: itemsOf(f.c), rev: f.c.rev, files: await urls(ctx, f.c, true), at: f.c.updatedAt };
  },
});

/** Someone with Can edit saves on their link (they can't upload; photos and files stay the business's). */
export const sharedSave = mutation({
  args: { token: v.string(), items: v.any(), rev: v.number() },
  handler: async (ctx, a) => {
    const f = await byToken(ctx, a.token);
    if (!f || f.role !== "edit") throw new ConvexError("This link can't change the board.");
    focusBusiness(ctx, f.c.businessId);
    return await saveItems(ctx, f.c, a.items, a.rev, f.person?.name ?? f.person?.email ?? "Someone");
  },
});

export const opened = mutation({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const f = await byToken(ctx, a.token);
    if (!f?.person) return null;
    focusBusiness(ctx, f.c.businessId);
    if (!f.person.openedAt || Date.now() - f.person.openedAt > 3_600_000) await ctx.db.patch(f.person._id, { openedAt: Date.now() });
    return null;
  },
});
