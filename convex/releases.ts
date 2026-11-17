// 5i (D193, D203; Design Log "Handoff ready: Releases on set and the Shoot page"): releases signed in person on set.
// A release is a Sign document made from a release template (Contracts › Templates). On the Shoot page's Releases tab
// the owner picks a template and who signs, the page renders the PDF (as the builder does), the server turns it into a
// document and approves it, and Hand over starts the signing on this phone: no link is emailed, the owner's in-person
// check replaces the email code, and every signing step after that is Sign's own (rule 9). The signed copy is emailed
// to the signer when it's done (Sign's usual finish).
import { action } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAll, requireOwner } from "./lib/access";
import { insertBuild, profile, toSigningCore } from "./builder";
import { approveForRelease, sendInPersonCore } from "./sign";
import { claimIn } from "./fileOwners";
import { label } from "./lib/bookingRows";
import { docLabel } from "./lib/wsLayout";
import { emptyFields, pageOf, type Fields, type Style } from "./lib/wsBuilder";
import { RELEASE_KINDS, kindOfTemplate, releaseTemplate, type ReleaseKind } from "./lib/releaseTemplates";
import { defaultStyle } from "./builder";
import { lockForRelease } from "./handBack";
import { lockOf } from "./lib/sessionLock";

type Ctx = QueryCtx | MutationCtx;
// Releases need both switches: Shoots (the shoot day) and Docs (a release is a contract). requireAll with a list
// passes on any one of them, so each is asked for.
async function both(ctx: Ctx) { await requireAll(ctx, "docs"); return await requireAll(ctx, "shoots"); }
const kindArg = v.union(v.literal("talent"), v.literal("location"), v.literal("minor"));
const KIND_NAME: Record<ReleaseKind, string> = { talent: "Talent", location: "Location", minor: "Minor" };
const tidy = (s: string | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

async function stateOf(ctx: Ctx, r: Doc<"releases">) {
  const doc = r.documentId ? await ctx.db.get(r.documentId) : null;
  const st = !doc ? "draft" : doc.status === "completed" ? "signed" : doc.status === "voided" ? "cancelled" : doc.status === "sent" ? "signing" : doc.status === "approved" ? "ready" : "draft";
  return { doc, state: st as "draft" | "ready" | "signing" | "signed" | "cancelled" };
}
async function ownedShoot(ctx: Ctx, shootId: string) {
  const id = ctx.db.normalizeId("shoots", shootId);
  const s = id ? await ctx.db.get(id) : null;
  if (!s) throw new ConvexError("That shoot isn't here any more.");
  return s;
}

/** The starter release templates, made once per business (Contracts › Templates shows them with a Release chip). */
async function ensureTemplates(ctx: MutationCtx) {
  const have = (await ctx.db.query("wsTemplates").collect()).filter((t) => t.kind === "release");
  if (have.length) return have;
  const style = (await defaultStyle(ctx)) as Style;
  const now = Date.now();
  for (const k of RELEASE_KINDS) {
    const t = releaseTemplate(k);
    const custom = [{ key: "location", label: "Location", value: "" }, ...(k === "minor" ? [{ key: "minor.name", label: "Minor's name", value: "" }] : [])];
    await ctx.db.insert("wsTemplates", { name: t.name, description: t.description, kind: "release", releaseKind: k, blocks: t.page, fields: { project: "", custom }, style, createdAt: now, updatedAt: now });
  }
  return (await ctx.db.query("wsTemplates").collect()).filter((t) => t.kind === "release");
}

// ---------- the Shoot page's Releases tab ----------

export const forShoot = query({
  args: { shootId: v.string() },
  handler: async (ctx, { shootId }) => {
    await both(ctx);
    const id = ctx.db.normalizeId("shoots", shootId);
    const s = id ? await ctx.db.get(id) : null;
    if (!s) return null;
    const rows = await ctx.db.query("releases").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).collect();
    const out = [];
    for (const r of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      const { doc, state } = await stateOf(ctx, r);
      out.push({ _id: r._id, kind: r.kind, kindName: KIND_NAME[r.kind], name: r.name, minorName: r.minorName ?? null, email: r.email, shotIds: r.shotIds, state, documentId: doc?._id ?? null, label: doc ? docLabel(doc.number) : null, signedAt: doc?.completedAt ?? null });
    }
    // Shots on this day's list marked "Release needed" and not covered by a signed release.
    const list = await ctx.db.query("shotLists").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).first();
    const signedShots = new Set(out.filter((r) => r.state === "signed").flatMap((r) => r.shotIds.map(String)));
    const shots = list ? await ctx.db.query("shots").withIndex("by_list", (q) => q.eq("listId", list._id)).collect() : [];
    const missing = shots.filter((x) => x.releaseNeeded && !signedShots.has(x._id)).map((x) => ({ _id: x._id, number: x.number, text: x.text }));
    const templates = (await ctx.db.query("wsTemplates").collect()).filter((t) => t.kind === "release").map((t) => ({ _id: t._id, name: t.name, description: t.description ?? "", kind: kindOfTemplate(t) }));
    return { releases: out, missing, shots: shots.map((x) => ({ _id: x._id, number: x.number, text: x.text, releaseNeeded: x.releaseNeeded ?? null, released: signedShots.has(x._id) })), templates, place: s.location };
  },
});

/** Makes sure the starter release templates exist (the New release sheet asks once). */
export const templates = mutation({
  args: {},
  handler: async (ctx) => {
    await both(ctx);
    return (await ensureTemplates(ctx)).map((t) => ({ _id: t._id, name: t.name, description: t.description ?? "", kind: kindOfTemplate(t) }));
  },
});

/** New release: a draft document from the template, filled in for this shoot and signer. The page renders it next. */
export const create = mutation({
  args: { shootId: v.string(), templateId: v.id("wsTemplates"), name: v.string(), email: v.string(), phone: v.optional(v.string()), minorName: v.optional(v.string()), shotIds: v.array(v.id("shots")) },
  handler: async (ctx, a) => {
    await both(ctx);
    const s = await ownedShoot(ctx, a.shootId);
    if (s.status !== "scheduled") throw new ConvexError("That shoot was cancelled.");
    const t = await ctx.db.get(a.templateId);
    if (!t || t.kind !== "release") throw new ConvexError("Pick a release template.");
    const kind = kindOfTemplate(t);
    const name = tidy(a.name, 120), email = tidy(a.email, 200).toLowerCase(), minorName = tidy(a.minorName, 120);
    if (!name) throw new ConvexError(kind === "minor" ? "Enter the parent or guardian's name." : "Enter who's signing.");
    if (!isEmail(email)) throw new ConvexError("Enter an email for their signed copy.");
    if (kind === "minor" && !minorName) throw new ConvexError("Enter the minor's name.");
    // Shots must be on this shoot day's list.
    const list = await ctx.db.query("shotLists").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).first();
    for (const id of a.shotIds) { const x = await ctx.db.get(id); if (!x || !list || x.listId !== list._id) throw new ConvexError("One of those shots isn't on this shoot's list."); }
    const p = s.projectId ? await ctx.db.get(s.projectId) : null;
    const business = await profile(ctx);
    const tf = (t.fields as Partial<Fields> | undefined) ?? {};
    const custom = (tf.custom ?? []).map((c) => (c.key === "location" ? { ...c, value: s.location } : c.key === "minor.name" ? { ...c, value: minorName } : c));
    const fields: Fields = { ...emptyFields(business), business, client: { name, company: "", email, phone: tidy(a.phone, 40), address: "" }, project: p ? label(p) : `Shoot on ${s.date}`, date: s.date, custom };
    const title = `${t.name}: ${kind === "minor" ? minorName : name}`;
    const buildId = await insertBuild(ctx, { title, page: pageOf(t.blocks), fields, style: t.style as Style, templateId: t._id });
    const now = Date.now();
    const releaseId = await ctx.db.insert("releases", { shootId: s._id, ...(s.projectId ? { projectId: s.projectId } : {}), kind, name, email, ...(kind === "minor" ? { minorName } : {}), shotIds: a.shotIds, buildId, createdAt: now, updatedAt: now });
    return { releaseId, buildId };
  },
});

export const releaseFor = internalQuery({
  args: { releaseId: v.id("releases") },
  handler: async (ctx, { releaseId }) => { const r = await ctx.db.get(releaseId); return r ? { ...r, state: (await stateOf(ctx, r)).state } : null; },
});
export const linkDocument = internalMutation({
  args: { releaseId: v.id("releases"), documentId: v.id("wsDocuments") },
  handler: async (ctx, { releaseId, documentId }) => {
    const doc = await ctx.db.get(documentId);
    const r = await ctx.db.get(releaseId);
    if (!doc || !r) throw new ConvexError("That document isn't here.");
    const ver = await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", documentId).eq("number", doc.currentVersion)).unique();
    if (!ver) throw new ConvexError("That document has no version.");
    // The release's document is linked first, so Sign's in-person check can find the release it belongs to.
    await ctx.db.patch(releaseId, { documentId, updatedAt: Date.now() });
    if (doc.status === "draft") await approveForRelease(ctx, ver._id);
    return null;
  },
});

/** The page rendered the release's PDF and uploaded it: make its document and approve it (ready to hand over). */
export const prepare = action({
  args: { releaseId: v.id("releases"), storageId: v.id("_storage") },
  handler: async (ctx, { releaseId, storageId }): Promise<{ documentId: Id<"wsDocuments"> }> => {
    // 541ac10 review H1: approving and handing over stay the owner's, as Approve and Send do everywhere in Sign.
    await ctx.runQuery(internal.users.assertAllowed, { ids: [releaseId] });
    const r = await ctx.runQuery(internal.releases.releaseFor, { releaseId });
    if (!r) throw new ConvexError("That release isn't here any more.");
    // Review L7: a release made once is handed over or cancelled; a cancelled or signed one isn't made again.
    if (r.state !== "draft") throw new ConvexError(r.state === "cancelled" ? "This release was cancelled. Make a new one." : "This release is already made.");
    const claim = await claimIn(ctx, storageId, "contract-pdf");
    if (!claim.fresh) throw new ConvexError("Upload the PDF again.");
    const made = await toSigningCore(ctx, r.buildId, storageId, undefined, claim);
    await ctx.runMutation(internal.releases.linkDocument, { releaseId, documentId: made.documentId });
    return { documentId: made.documentId };
  },
});

/** "I'm {name} · Start": the signing starts on this phone. Returns the signing link's token and a session for it. */
export const handOver = mutation({
  args: { releaseId: v.id("releases"), device: v.string(), checked: v.literal(true) },
  handler: async (ctx, a) => {
    const me = await requireOwner(ctx); // review H1: the owner's, like Send
    const r = await ctx.db.get(a.releaseId);
    if (!r) throw new ConvexError("That release isn't here any more.");
    const { doc, state } = await stateOf(ctx, r);
    if (state === "signed") throw new ConvexError("It's already signed.");
    if (!doc || state !== "ready") throw new ConvexError(state === "signing" ? "It's already out for signing. Cancel it from Contracts to start again." : "It isn't ready to sign yet.");
    const ver = await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", doc._id).eq("number", doc.currentVersion)).unique();
    const s = r.shootId ? await ctx.db.get(r.shootId) : null;
    if (!s || s.status !== "scheduled") throw new ConvexError("That shoot was cancelled.");
    const device = tidy(a.device, 40) || "a phone";
    const owner = (me.name ?? "").trim().split(" ")[0] || "The owner";
    const out = await sendInPersonCore(ctx, ver!._id, { device: `${owner}'s ${device}`, place: s?.location ?? null, by: me.name?.trim() || me.email });
    // Q2 (Nov 17): this sign-in locks until the owner hands it back (PIN or passkey); with no PIN set, nothing happens.
    await lockForRelease(ctx, me.userId, r._id);
    await ctx.db.patch(r._id, { updatedAt: Date.now() });
    return { ...out, signer: r.name };
  },
});

/** The hand-back screen and the signing wrapper read where a release stands. */
export const get = query({
  args: { releaseId: v.string() },
  handler: async (ctx, { releaseId }) => {
    // Q2: a handed-over phone still shows its own release (Signed, Hand back), nothing else.
    const lock = await lockOf(ctx);
    if (!lock || String(lock.releaseId) !== releaseId) await both(ctx);
    const id = ctx.db.normalizeId("releases", releaseId);
    const r = id ? await ctx.db.get(id) : null;
    if (!r) return null;
    const { doc, state } = await stateOf(ctx, r);
    return { _id: r._id, kind: r.kind, name: r.name, email: r.email, minorName: r.minorName ?? null, state, shootId: r.shootId ?? null, buildId: r.buildId, documentId: doc?._id ?? null, label: doc ? docLabel(doc.number) : null };
  },
});

/** Hold on a shot: "Release needed", or "Doesn't need a release" (null clears the mark). */
export const markShot = mutation({
  args: { shotId: v.id("shots"), needed: v.union(v.boolean(), v.null()) },
  handler: async (ctx, { shotId, needed }) => {
    await requireAll(ctx, "shoots");
    const x = await ctx.db.get(shotId);
    if (!x) throw new ConvexError("That shot isn't here any more.");
    await ctx.db.patch(shotId, { releaseNeeded: needed ?? undefined });
    return null;
  },
});

/** A draft release that never went to signing can be thrown away (its builder draft goes with it). */
export const remove = mutation({
  args: { releaseId: v.id("releases") },
  handler: async (ctx, { releaseId }) => {
    await both(ctx);
    const r = await ctx.db.get(releaseId);
    if (!r) return null;
    if (r.documentId) throw new ConvexError("It has a document: cancel it from Contracts instead.");
    const b = await ctx.db.get(r.buildId);
    if (b && !b.documentId) await ctx.db.delete(b._id);
    await ctx.db.delete(releaseId);
    return null;
  },
});
export type { Id };
