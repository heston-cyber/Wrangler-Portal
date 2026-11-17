// 5l (D187–D191; Design Log "Handoff ready: Creative planning" rounds 1 and 3): Creative planning's Overview, creative
// docs (builder pages of kind "creative", never signed) and brand kits as creative work. Each can be made on its own and
// attached later (D204: homes.move). A doc or kit is shared by a view-only link (D191): a doc's link shows the PDF made
// at Share (Update the link makes a new one; team notes stay out), a kit's link shows the kit as it is now. Owner and
// team with Projects.
import { fileLink } from "./lib/fileLinks";
import { focusBusiness, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAll } from "./lib/access";
import { claimUpload, deleteFile } from "./lib/fileOwners";
import { businessInScope } from "./lib/business";
import { randomToken } from "./lib/hash";
import { label } from "./lib/bookingRows";
import { insertBuild } from "./builder";
import { CREATIVE_NAME, creativePage, dropNotes, type CreativeKind } from "./lib/creativeTemplates";
import { STARTERS, briefingFields, briefingStarterPage } from "./lib/wsBriefing";
import { line, pageOf, type Fields, type PNode, type Style } from "./lib/wsBuilder";
import { EMPTY_KIT, type Kit } from "./brandKit";

type Ctx = QueryCtx | MutationCtx;
const kindArg = v.union(v.literal("treatment"), v.literal("script"), v.literal("interview"), v.literal("brief"), v.literal("blank"));
const homeArg = v.optional(v.union(v.null(), v.object({ type: v.union(v.literal("client"), v.literal("project"), v.literal("shoot"), v.literal("lead")), id: v.string() })));
type HomeIn = { type: "client" | "project" | "shoot" | "lead"; id: string } | null | undefined;
type Homed = { clientId?: Id<"clients">; projectId?: Id<"projects">; shootId?: Id<"shoots">; dealId?: Id<"deals"> };
const tidy = (s: string | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** The home fields for a new thing (one of them, or none); refuses a home that isn't this business's. */
async function homeFields(ctx: MutationCtx, h: HomeIn, allow: Array<"client" | "project" | "shoot" | "lead">): Promise<Homed> {
  if (!h) return {};
  if (!allow.includes(h.type)) throw new ConvexError("It can't go there.");
  const table = { client: "clients", project: "projects", shoot: "shoots", lead: "deals" }[h.type] as "clients";
  const id = ctx.db.normalizeId(table, h.id);
  if (!id || !(await ctx.db.get(id))) throw new ConvexError("That home isn't here any more.");
  if (h.type === "client") await requireAll(ctx, "clients");
  if (h.type === "lead") await requireAll(ctx, "clients");
  if (h.type === "shoot") await requireAll(ctx, "shoots"); // review L2
  return { [{ client: "clientId", project: "projectId", shoot: "shootId", lead: "dealId" }[h.type]]: id } as Homed;
}

/** "Harbor Coffee · Launch" for the home chip (null: Not attached). */
export async function homeChip(ctx: Ctx, r: Homed): Promise<{ type: string; id: string; name: string } | null> {
  if (r.shootId) { const s = await ctx.db.get(r.shootId); if (s) { const p = s.projectId ? await ctx.db.get(s.projectId) : null; return { type: "shoot", id: s._id, name: `${p ? label(p) : "Shoot"} · ${s.date}` }; } }
  if (r.projectId) { const p = await ctx.db.get(r.projectId); if (p) return { type: "project", id: p._id, name: label(p) }; }
  if (r.dealId) { const d = await ctx.db.get(r.dealId); if (d) return { type: "lead", id: d._id, name: d.title }; }
  if (r.clientId) { const c = await ctx.db.get(r.clientId); if (c) return { type: "client", id: c._id, name: c.name }; }
  return null;
}

// ---------- Overview ----------

export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "projects");
    const recent: Array<{ kind: "doc" | "canvas" | "kit" | "place"; id: string; name: string; sub: string; home: Awaited<ReturnType<typeof homeChip>>; at: number; to: string }> = [];
    for (const d of await ctx.db.query("creativeDocs").collect()) {
      const b = await ctx.db.get(d.buildId);
      recent.push({ kind: "doc", id: d._id, name: b?.title ?? "Creative doc", sub: CREATIVE_NAME[d.kind], home: await homeChip(ctx, d), at: Math.max(d.updatedAt, b?.updatedAt ?? 0), to: `/creative/docs/${d._id}` });
    }
    for (const c of await ctx.db.query("canvases").collect()) recent.push({ kind: "canvas", id: c._id, name: c.name, sub: c.kind === "mood" ? "Mood board" : "Canvas", home: await homeChip(ctx, c), at: c.updatedAt, to: `/creative/canvas/${c._id}` });
    for (const k of await ctx.db.query("brandKits").collect()) recent.push({ kind: "kit", id: k._id, name: k.name, sub: "Brand kit", home: await homeChip(ctx, k), at: k.updatedAt, to: `/creative/kits/${k._id}` });
    let shoots = true;
    try { await requireAll(ctx, "shoots"); } catch { shoots = false; } // review L3: places are Shoots'
    for (const p of shoots ? await ctx.db.query("places").collect() : []) recent.push({ kind: "place", id: p._id, name: p.name, sub: "Place", home: await homeChip(ctx, p), at: p.updatedAt, to: `/creative/locations/${p._id}` });
    recent.sort((a, b) => b.at - a.at);
    const homes = new Map<string, { name: string; type: string; id: string; n: number }>();
    for (const r of recent) if (r.home) { const k = `${r.home.type}:${r.home.id}`; const h = homes.get(k) ?? { ...r.home, n: 0 }; h.n++; homes.set(k, h); }
    return { recent: recent.slice(0, 12), counts: { docs: recent.filter((r) => r.kind === "doc").length, canvases: recent.filter((r) => r.kind === "canvas").length, kits: recent.filter((r) => r.kind === "kit").length, places: recent.filter((r) => r.kind === "place").length, loose: recent.filter((r) => !r.home && r.kind !== "place").length }, homes: [...homes.values()].sort((a, b) => b.n - a.n).slice(0, 8) };
  },
});

// ---------- creative docs ----------

async function docOf(ctx: Ctx, docId: string) {
  const id = ctx.db.normalizeId("creativeDocs", docId);
  const d = id ? await ctx.db.get(id) : null;
  if (!d) throw new ConvexError("That creative doc isn't here any more.");
  return d;
}

export const docs = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "projects");
    const out = [];
    for (const d of await ctx.db.query("creativeDocs").collect()) {
      const b = await ctx.db.get(d.buildId);
      out.push({ _id: d._id, buildId: d.buildId, kind: d.kind, kindName: CREATIVE_NAME[d.kind], title: b?.title ?? "Creative doc", home: await homeChip(ctx, d), shared: !!d.share?.on, at: Math.max(d.updatedAt, b?.updatedAt ?? 0) });
    }
    return out.sort((a, b) => b.at - a.at);
  },
});

export const newDoc = mutation({
  args: { kind: kindArg, title: v.optional(v.string()), home: homeArg },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const home = await homeFields(ctx, a.home, ["client", "project", "shoot", "lead"]);
    const title = tidy(a.title, 120) || CREATIVE_NAME[a.kind as CreativeKind];
    const p = home.projectId ? await ctx.db.get(home.projectId) : null;
    const buildId = await insertBuild(ctx, { title, page: creativePage(a.kind as CreativeKind, title), fields: { project: p ? label(p) : "", custom: [] } });
    await ctx.db.patch(buildId, { kind: "creative" });
    const now = Date.now();
    const docId = await ctx.db.insert("creativeDocs", { buildId, kind: a.kind, ...home, createdAt: now, updatedAt: now });
    return { docId, buildId };
  },
});

/** The builder's creative mode: the doc's home chip and its link. */
export const doc = query({
  args: { docId: v.string() },
  handler: async (ctx, { docId }) => {
    await requireAll(ctx, "projects");
    const id = ctx.db.normalizeId("creativeDocs", docId);
    const d = id ? await ctx.db.get(id) : null;
    if (!d) return null;
    return { _id: d._id, buildId: d.buildId, kind: d.kind, kindName: CREATIVE_NAME[d.kind], home: await homeChip(ctx, d), share: d.share ? { token: d.share.token, on: d.share.on, at: d.share.at } : null };
  },
});

/** Share link (D191): the PDF made on the page now becomes what the link shows (Update the link does it again). */
export const share = mutation({
  args: { docId: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, a) => {
    const me = await requireAll(ctx, "projects");
    const d = await docOf(ctx, a.docId);
    const meta = await ctx.db.system.get(a.storageId);
    if (!meta || (meta.contentType && meta.contentType !== "application/pdf")) throw new ConvexError("The PDF didn't upload. Try again.");
    if (!(await claimUpload(ctx, a.storageId, businessInScope(ctx), "creative-share", me.userId)).fresh) throw new ConvexError("Upload the PDF again.");
    if (d.share) await deleteFile(ctx, d.share.fileId, businessInScope(ctx));
    const token = d.share?.token ?? randomToken(18);
    await ctx.db.patch(d._id, { share: { token, fileId: a.storageId, on: true, at: Date.now() }, updatedAt: Date.now() });
    return { token };
  },
});

export const shareOn = mutation({
  args: { docId: v.string(), on: v.boolean() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const d = await docOf(ctx, a.docId);
    if (!d.share) throw new ConvexError("Share it first.");
    await ctx.db.patch(d._id, { share: { ...d.share, on: a.on } });
    return null;
  },
});

export const removeDoc = mutation({
  args: { docId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const d = await docOf(ctx, a.docId);
    if (d.share) await deleteFile(ctx, d.share.fileId, businessInScope(ctx));
    await ctx.db.delete(d.buildId);
    await ctx.db.delete(d._id);
    return null;
  },
});

/** The view-only page of a shared creative doc (no account): its title and the PDF, while the link is on. */
export const sharedDoc = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
    const d = await ctx.db.query("creativeDocs").withIndex("by_share", (q) => q.eq("share.token", token)).first();
    if (!d?.share?.on) return null;
    focusBusiness(ctx, d.businessId);
    const b = await ctx.db.get(d.buildId);
    const biz = d.businessId ? await ctx.db.get(d.businessId) : null;
    return { title: b?.title ?? "Creative doc", kind: CREATIVE_NAME[d.kind], from: biz?.name ?? null, pdf: await fileLink(d.share.fileId, `${b?.title ?? "Creative doc"}.pdf`), at: d.share.at }; // Phase 6 M1
  },
});

/** Start a briefing from this (D189): a Shoot brief or an Edit brief with the doc below its sections (team notes left
 *  out), on the doc's project when it has one. "The script itself doesn't change." Needs Production too. */
export const startBriefing = mutation({
  args: { docId: v.string(), starter: v.union(v.literal("shoot"), v.literal("edit")) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects"); await requireAll(ctx, "production");
    const d = await docOf(ctx, a.docId);
    const b = await ctx.db.get(d.buildId);
    if (!b) throw new ConvexError("That creative doc isn't here any more.");
    const s = d.shootId ? await ctx.db.get(d.shootId) : null;
    const pid = d.projectId ?? s?.projectId;
    const p = pid ? await ctx.db.get(pid) : null;
    const start = briefingStarterPage(a.starter, !!p);
    const body = dropNotes(pageOf(b.blocks)).content.filter((n, i) => !(i === 0 && (n.attrs as { size?: string } | undefined)?.size === "title"));
    const page = { type: "doc" as const, content: [...start.content, line(`${CREATIVE_NAME[d.kind]}: ${b.title}`, { size: "heading" }), ...(body as PNode[])] };
    const fields = briefingFields(undefined, { project: p ? label(p) : "", vendor: "your crew", dates: s?.date ?? "" });
    const name = STARTERS[a.starter].name;
    const buildId = await insertBuild(ctx, { title: p ? `${name} · ${label(p)}` : `${name} · ${b.title}`, page, fields: fields as Fields, style: b.style as Style });
    await ctx.db.patch(buildId, { kind: "briefing" });
    const now = Date.now();
    const me = await requireAll(ctx, "production");
    return await ctx.db.insert("briefings", {
      buildId, ...(p ? { projectId: p._id } : {}), starter: a.starter, status: "draft",
      history: [{ kind: "created", at: now, by: me.name?.trim() || me.email, detail: `from the ${CREATIVE_NAME[d.kind].toLowerCase()} "${b.title}"` }], createdAt: now, updatedAt: now,
    });
  },
});

// ---------- brand kits as creative work (round 3) ----------

async function kitOf(ctx: Ctx, kitId: string) {
  const id = ctx.db.normalizeId("brandKits", kitId);
  const k = id ? await ctx.db.get(id) : null;
  if (!k) throw new ConvexError("That brand kit isn't here any more.");
  return k;
}
const kitData = (k: { brandKit?: unknown }): Kit => ({ ...EMPTY_KIT, ...((k.brandKit as Partial<Kit> | undefined) ?? {}) });

export const kits = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "projects");
    const out = [];
    for (const k of await ctx.db.query("brandKits").collect()) {
      const d = kitData(k);
      out.push({ _id: k._id, name: k.name, home: await homeChip(ctx, k), colors: d.colors.map((c) => c.hex), logo: d.logoFileId ? await ctx.storage.getUrl(d.logoFileId) : null, files: d.files.length, fonts: [d.fonts.heading, d.fonts.body].filter(Boolean).length, shared: !!k.share?.on, at: k.updatedAt });
    }
    // A company's own kit (Settings › Clients, filled by the proposal questionnaire) is listed too, to copy from.
    const companies = [];
    for (const c of await ctx.db.query("clients").collect()) if (c.brandKit) companies.push({ _id: c._id, name: `${c.name} brand`, colors: kitData(c).colors.map((x) => x.hex) });
    return { kits: out.sort((a, b) => b.at - a.at), companies };
  },
});

export const newKit = mutation({
  args: { name: v.string(), fromKitId: v.optional(v.string()), fromClientId: v.optional(v.id("clients")), home: homeArg },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const name = tidy(a.name, 80);
    if (!name) throw new ConvexError("Name the kit.");
    const home = await homeFields(ctx, a.home, ["client", "project", "lead"]);
    let brandKit: Kit = EMPTY_KIT, copiedFrom: { name: string; at: number } | undefined;
    // A copy (drawn as a copy, Q: copy or linked): files are shared by reference only while both exist, so the copy
    // takes the colours, fonts, links and tone words; files and the logo are not copied.
    if (a.fromKitId) { const k = await kitOf(ctx, a.fromKitId); brandKit = { ...kitData(k), files: [], logoFileId: undefined }; copiedFrom = { name: k.name, at: Date.now() }; }
    else if (a.fromClientId) { const c = await ctx.db.get(a.fromClientId); if (!c) throw new ConvexError("That company isn't here."); brandKit = { ...kitData(c), files: [], logoFileId: undefined }; copiedFrom = { name: `${c.name} brand`, at: Date.now() }; }
    const now = Date.now();
    return await ctx.db.insert("brandKits", { name, brandKit, ...home, ...(copiedFrom ? { copiedFrom } : {}), createdAt: now, updatedAt: now });
  },
});

export const kit = query({
  args: { kitId: v.string() },
  handler: async (ctx, { kitId }) => {
    await requireAll(ctx, "projects");
    const id = ctx.db.normalizeId("brandKits", kitId);
    const k = id ? await ctx.db.get(id) : null;
    if (!k) return null;
    return { _id: k._id, name: k.name, home: await homeChip(ctx, k), copiedFrom: k.copiedFrom ?? null, share: k.share ?? null };
  },
});

export const renameKit = mutation({
  args: { kitId: v.string(), name: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const k = await kitOf(ctx, a.kitId);
    const name = tidy(a.name, 80);
    if (!name) throw new ConvexError("Name the kit.");
    await ctx.db.patch(k._id, { name, updatedAt: Date.now() });
    return null;
  },
});

export const shareKit = mutation({
  args: { kitId: v.string(), on: v.boolean() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const k = await kitOf(ctx, a.kitId);
    await ctx.db.patch(k._id, { share: { token: k.share?.token ?? randomToken(18), on: a.on }, updatedAt: Date.now() });
    return null;
  },
});

export const removeKit = mutation({
  args: { kitId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const k = await kitOf(ctx, a.kitId);
    const d = kitData(k);
    for (const f of d.files) await deleteFile(ctx, f.fileId, businessInScope(ctx));
    if (d.logoFileId) await deleteFile(ctx, d.logoFileId, businessInScope(ctx));
    await ctx.db.delete(k._id);
    return null;
  },
});

/** A shared kit's view-only page (no account): the kit as it is now, while the link is on. */
export const sharedKit = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
    const k = await ctx.db.query("brandKits").withIndex("by_share", (q) => q.eq("share.token", token)).first();
    if (!k?.share?.on) return null;
    focusBusiness(ctx, k.businessId);
    const d = kitData(k);
    const biz = k.businessId ? await ctx.db.get(k.businessId) : null;
    return {
      name: k.name, from: biz?.name ?? null, logo: await fileLink(d.logoFileId, "logo"), colors: d.colors, fonts: d.fonts, links: d.links, tone: d.tone, // Phase 6 M1
      files: await Promise.all(d.files.map(async (f) => ({ name: f.name, size: f.size, url: await fileLink(f.fileId, f.name) }))),
    };
  },
});
export type { Doc };
