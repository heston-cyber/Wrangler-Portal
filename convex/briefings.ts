// Phase 3c step 3 (Nov 2) · briefings, the owner's side (D97): Vendors › Briefings (S5 · Phase 3c 730:4522), a briefing
// in the builder (731:3904; its own kind, no signature boxes), Shoot brief and Edit brief to start from, and Send to a
// vendor booked on the project (email 25, 735:5165). The PDF is frozen when it's sent; the vendor reads it in their
// portal and presses "I've read it" (step 4). Owner only.
import { action } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { businessInScope } from "./lib/business";
import { insertBuild } from "./builder";
import { pageOf, type BuildDoc, type ExtraSigner, type Fields, type Page, type Style } from "./lib/wsBuilder";
import { STARTERS, briefingFields, briefingHeadings, briefingProblems, briefingStarterPage, starterFor, starterSummary, type Starter } from "./lib/wsBriefing";
import { dateRange } from "./lib/bookings";
import { label } from "./lib/bookingRows";
import { mailBrandOf } from "./lib/mail";
import { briefingMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { SITE } from "./lib/site";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const fresh = (f: { _creationTime: number }) => Date.now() - f._creationTime < 30 * 60_000;
const by = (me: { name?: string | null; email: string }) => me.name ?? me.email;
const starterArg = v.union(v.literal("shoot"), v.literal("edit"));

async function ownerBiz(ctx: QueryCtx | MutationCtx) {
  const me = await requireMe(ctx);
  const id = businessInScope(ctx);
  const b = id ? await ctx.db.get(id) : null;
  if (!b) throw new ConvexError("Not allowed.");
  return { b, me };
}
const docOf = (b: Doc<"wsBuilds">): BuildDoc => ({ title: b.title, page: pageOf(b.blocks), fields: b.fields as Fields, signers: (b.signers as ExtraSigner[]) ?? [], style: b.style as Style });
/** Draft · Sent · Read (731:3904's top row). */
const stateOf = (x: Doc<"briefings">): "draft" | "sent" | "read" => (x.readAt ? "read" : x.status);
const open = (k: Doc<"vendorBookings">) => k.status === "offered" || k.status === "accepted";
const forWho = (vendor: string, k: Doc<"vendorBookings">) => ({ vendor: `${vendor}, ${k.role}`, dates: dateRange(k.start, k.end) });

async function bookingOn(ctx: QueryCtx, bookingId: Id<"vendorBookings">) {
  const k = await ctx.db.get(bookingId);
  if (!k) throw new ConvexError("That booking isn't here.");
  if (!open(k)) throw new ConvexError(k.status === "declined" ? "They declined that booking, so they can't get a briefing for it." : "That booking was cancelled.");
  const vendor = await ctx.db.get(k.vendorId);
  const p = await ctx.db.get(k.projectId);
  if (!vendor || !p) throw new ConvexError("That booking isn't here.");
  return { k, vendor, p };
}

async function rowOf(ctx: QueryCtx, x: Doc<"briefings">) {
  const build = await ctx.db.get(x.buildId);
  const p = await ctx.db.get(x.projectId);
  const k = x.bookingId ? await ctx.db.get(x.bookingId) : null;
  const vendor = x.sentTo?.name ?? (k ? (await ctx.db.get(k.vendorId))?.name : null) ?? null;
  return {
    _id: x._id, buildId: x.buildId, title: build?.title ?? "Briefing", project: p ? label(p) : "A project", projectId: x.projectId,
    vendor, vendorId: x.sentTo?.vendorId ?? k?.vendorId ?? null, role: k?.role ?? null, state: stateOf(x), sentAt: x.sentAt ?? null, readAt: x.readAt ?? null, updatedAt: x.updatedAt,
  };
}

// ---------- reads ----------

/** Shoot brief and Edit brief, plus the briefing templates you've saved. */
export const templates = query({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const saved = (await ctx.db.query("wsTemplates").withIndex("by_updated").order("desc").collect()).filter((t) => t.kind === "briefing")
      .map((t) => ({ _id: t._id, name: t.name, description: t.description ?? "" }));
    return { starters: (["shoot", "edit"] as Starter[]).map((s) => ({ key: s, name: STARTERS[s].name, summary: starterSummary(s) })), saved };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await ownerBiz(ctx);
    const rows = (await ctx.db.query("briefings").collect()).sort((a, b) => b.updatedAt - a.updatedAt);
    const out = [];
    for (const x of rows) out.push(await rowOf(ctx, x));
    return out;
  },
});

export const forVendor = query({
  args: { vendorId: v.string() },
  handler: async (ctx, { vendorId }) => {
    await ownerBiz(ctx);
    const id = ctx.db.normalizeId("vendors", vendorId);
    if (!id) return null;
    const out = [];
    for (const k of await ctx.db.query("vendorBookings").withIndex("by_vendor", (q) => q.eq("vendorId", id)).collect())
      for (const x of await ctx.db.query("briefings").withIndex("by_booking", (q) => q.eq("bookingId", k._id)).collect()) out.push(await rowOf(ctx, x));
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** One briefing, for the builder: where it stands, and who on the project it can go to. */
export const get = query({
  args: { briefingId: v.string() },
  handler: async (ctx, { briefingId }) => {
    await ownerBiz(ctx);
    const id = ctx.db.normalizeId("briefings", briefingId);
    const x = id ? await ctx.db.get(id) : null;
    if (!x) return null;
    const p = await ctx.db.get(x.projectId);
    const recipients = [];
    for (const k of (await ctx.db.query("vendorBookings").withIndex("by_project", (q) => q.eq("projectId", x.projectId)).collect()).filter(open)) {
      const vendor = await ctx.db.get(k.vendorId);
      if (vendor) recipients.push({ _id: k._id, name: vendor.name, role: k.role, state: k.status, ...forWho(vendor.name, k) });
    }
    return {
      ...(await rowOf(ctx, x)), bookingId: x.bookingId ?? null, starter: x.starter ?? null, kindName: x.starter ? STARTERS[x.starter].name : "Briefing",
      project: p ? { _id: p._id, label: label(p) } : null, recipients, sentTo: x.sentTo ?? null,
      pdfUrl: x.pdfId ? await ctx.storage.getUrl(x.pdfId) : null, history: x.history,
    };
  },
});

// ---------- writes ----------

/** A new briefing for a booking, from Shoot brief / Edit brief (picked by the role when not given) or a saved template. */
export const create = mutation({
  args: { bookingId: v.id("vendorBookings"), starter: v.optional(starterArg), templateId: v.optional(v.id("wsTemplates")) },
  handler: async (ctx, a) => {
    const { me } = await ownerBiz(ctx);
    const { k, vendor, p } = await bookingOn(ctx, a.bookingId);
    const t = a.templateId ? await ctx.db.get(a.templateId) : null;
    if (a.templateId && (!t || t.kind !== "briefing")) throw new ConvexError("That briefing template isn't here.");
    const starter = t ? undefined : a.starter ?? starterFor(k.role);
    const page: Page = t ? pageOf(t.blocks) : briefingStarterPage(starter!);
    const fields = briefingFields((t?.fields as Partial<Fields> | undefined)?.custom, { project: label(p), ...forWho(vendor.name, k) });
    const buildId = await insertBuild(ctx, {
      title: `${t ? t.name : STARTERS[starter!].name} · ${label(p)}`, page, fields,
      ...(t ? { style: t.style as Style, templateId: t._id } : {}),
    });
    await ctx.db.patch(buildId, { kind: "briefing" });
    const now = Date.now();
    return ctx.db.insert("briefings", {
      buildId, projectId: k.projectId, bookingId: k._id, ...(starter ? { starter } : {}), status: "draft",
      history: [{ kind: "created", at: now, by: by(me), detail: t ? `from the template "${t.name}"` : STARTERS[starter!].name }], createdAt: now, updatedAt: now,
    });
  },
});

/** Send to (731:3904): another vendor booked on the same project. The builder updates {vendor} and {dates} itself. */
export const setBooking = mutation({
  args: { briefingId: v.id("briefings"), bookingId: v.id("vendorBookings") },
  handler: async (ctx, a) => {
    await ownerBiz(ctx);
    const x = await ctx.db.get(a.briefingId);
    if (!x) throw new ConvexError("That briefing isn't here.");
    if (x.status !== "draft") throw new ConvexError("It's been sent. Make a copy to send it to someone else.");
    const { k } = await bookingOn(ctx, a.bookingId);
    if (k.projectId !== x.projectId) throw new ConvexError("Only vendors booked on this project can get it.");
    await ctx.db.patch(x._id, { bookingId: k._id, updatedAt: Date.now() });
    return null;
  },
});

export const deleteDraft = mutation({
  args: { briefingId: v.id("briefings") },
  handler: async (ctx, { briefingId }) => {
    await ownerBiz(ctx);
    const x = await ctx.db.get(briefingId);
    if (!x) return null;
    if (x.status !== "draft") throw new ConvexError("A sent briefing stays, so you can see what they read.");
    await ctx.db.delete(x.buildId);
    await ctx.db.delete(x._id);
    return null;
  },
});

/** A new draft from a sent briefing, to change it or send it to someone else. */
export const copy = mutation({
  args: { briefingId: v.id("briefings") },
  handler: async (ctx, { briefingId }) => {
    const { me } = await ownerBiz(ctx);
    const x = await ctx.db.get(briefingId);
    const src = x ? await ctx.db.get(x.buildId) : null;
    if (!x || !src) throw new ConvexError("That briefing isn't here.");
    const now = Date.now();
    const buildId = await ctx.db.insert("wsBuilds", { title: src.title, blocks: src.blocks, fields: src.fields, signers: [], style: src.style, kind: "briefing", ...(src.templateId ? { templateId: src.templateId } : {}), createdAt: now, updatedAt: now });
    const k = x.bookingId ? await ctx.db.get(x.bookingId) : null;
    return ctx.db.insert("briefings", {
      buildId, projectId: x.projectId, ...(k && open(k) ? { bookingId: k._id } : {}), ...(x.starter ? { starter: x.starter } : {}), status: "draft",
      history: [{ kind: "created", at: now, by: by(me), detail: "a copy of a sent briefing" }], createdAt: now, updatedAt: now,
    });
  },
});

// ---------- send (email 25) ----------

export const markSent = internalMutation({
  args: { briefingId: v.id("briefings"), storageId: v.optional(v.id("_storage")), resend: v.boolean() },
  handler: async (ctx, a): Promise<{ error?: string; key?: string }> => {
    const { me } = await ownerBiz(ctx);
    const x = await ctx.db.get(a.briefingId);
    const build = x ? await ctx.db.get(x.buildId) : null;
    if (!x || !build) throw new ConvexError("That briefing isn't here.");
    const now = Date.now();
    if (a.resend) {
      if (x.status !== "sent" || !x.sentTo) throw new ConvexError("Only a sent briefing can be sent again.");
      await ctx.db.patch(x._id, { updatedAt: now, history: [...x.history, { kind: "resent", at: now, by: by(me), detail: x.sentTo.email }].slice(-60) });
      return { key: `briefing-sent:${x._id}:${now}` };
    }
    // As proposals (review fix): a file that isn't a fresh PDF upload is never touched; one this caller just uploaded
    // for this briefing is theirs, so a refusal deletes it (returned, not thrown, so the delete isn't rolled back).
    if (!a.storageId) return { error: "The PDF didn't upload. Try again." };
    const file = await ctx.db.system.get(a.storageId);
    if (!file || !fresh(file) || (file.contentType && file.contentType !== "application/pdf") || file.size > MAX_PDF_BYTES) return { error: "The PDF didn't upload. Try again." };
    const refuse = async (error: string) => { await ctx.storage.delete(a.storageId!).catch(() => null); return { error }; };
    if (x.status !== "draft") return refuse("This briefing has already been sent.");
    if (!x.bookingId) return refuse("Pick who it's for (Send to).");
    const k = await ctx.db.get(x.bookingId);
    if (!k || !open(k)) return refuse("That booking was declined or cancelled. Pick someone else (Send to).");
    const vendor = await ctx.db.get(k.vendorId);
    if (!vendor || vendor.archivedAt) return refuse("That vendor is no longer on your list.");
    const problems = briefingProblems(docOf(build));
    if (problems.length) return refuse(problems[0]);
    await ctx.db.patch(x._id, {
      status: "sent", pdfId: a.storageId, sentAt: now, sentTo: { vendorId: vendor._id, name: vendor.name, email: vendor.email }, updatedAt: now,
      history: [...x.history, { kind: "sent", at: now, by: by(me), detail: vendor.email }].slice(-60),
    });
    await ctx.db.patch(build._id, { renderedAt: now });
    return { key: `briefing-sent:${x._id}:first` };
  },
});

export const mailData = internalQuery({
  args: { briefingId: v.id("briefings") },
  handler: async (ctx, { briefingId }) => {
    const x = await ctx.db.get(briefingId);
    const build = x ? await ctx.db.get(x.buildId) : null;
    const k = x?.bookingId ? await ctx.db.get(x.bookingId) : null;
    const p = x ? await ctx.db.get(x.projectId) : null;
    if (!x?.sentTo || !build || !k || !p) return null;
    return {
      to: x.sentTo, title: build.title, kind: x.starter ? STARTERS[x.starter].name : "brief", project: label(p), role: k.role, start: k.start, end: k.end,
      headings: briefingHeadings(pageOf(build.blocks)), brand: await mailBrandOf(ctx, x.businessId ?? null), link: `${SITE()}/vendor/briefings/${x._id}`,
    };
  },
});

export const note = internalMutation({
  args: { briefingId: v.id("briefings"), kind: v.string(), detail: v.optional(v.string()) },
  handler: async (ctx, { briefingId, kind, detail }) => {
    const x = await ctx.db.get(briefingId);
    if (x) await ctx.db.patch(briefingId, { history: [...x.history, { kind, at: Date.now(), ...(detail ? { detail } : {}) }].slice(-60) });
  },
});

export const send = action({
  args: { briefingId: v.id("briefings"), storageId: v.optional(v.id("_storage")), resend: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ held: boolean }> => {
    const m = await ctx.runMutation(internal.briefings.markSent, { briefingId: a.briefingId, storageId: a.storageId, resend: !!a.resend });
    if (m.error !== undefined || !m.key) throw new ConvexError(m.error ?? "That didn't send. Try again.");
    const d = await ctx.runQuery(internal.briefings.mailData, { briefingId: a.briefingId });
    if (!d) throw new ConvexError("That didn't send. Try again.");
    const r = await deliverOnce(ctx, m.key, "briefing", d.to.email, briefingMail(d.brand, {
      name: d.to.name, kind: d.kind, project: d.project, title: d.title, role: d.role, start: d.start, end: d.end, headings: d.headings, link: d.link,
    }), d.brand.replyTo);
    if (r === "held") await ctx.runMutation(internal.briefings.note, { briefingId: a.briefingId, kind: "email_held", detail: d.to.email });
    return { held: r === "held" };
  },
});
