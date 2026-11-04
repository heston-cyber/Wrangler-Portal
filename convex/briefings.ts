// Phase 3c step 3 (Nov 2) · briefings, the owner's side (D97): Vendors › Briefings, a briefing in the builder (its own
// kind, no signature boxes), Shoot brief and Edit brief to start from.
//
// D147 "Briefings sent freely" (Heston, Nov 3; frames S5 · Phase 3c 863:15661 … 863:17954, list 870:17016; built
// Nov 4): a briefing no longer needs a booked vendor. The project is optional. Send to takes vendors from the list
// (booked or not), "everyone booked on the project", and any typed email. Saving sends nothing. Share has three ways:
//   - Send: each person gets email 58 with their own link (/b/<token>), so their opens and "I've read it" are named;
//   - Copy link: one link for anyone who has it; opens are counted, not named;
//   - Download PDF: a file, no link.
// The PDF is frozen the first time it's shared (as before, made in the browser); the reader page shows that PDF.
// Q91: turning the link off stops every link, emailed ones too, and it can be turned back on; links don't expire.
// Q95 (Nov 4): READ once everyone it was emailed to has pressed "I've read it" ("1 of 2 read" until then); a briefing
// only shared by copied link stays SENT. Vendors picked from the list also see it in their vendor portal (as before).
// Owner only, except the three link functions at the bottom (a token is the key) and the PDF route.
import { action, httpAction } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query, focusBusiness } from "./lib/functions";
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
import { briefingLinkMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { SITE } from "./lib/site";
import { randomToken } from "./lib/hash";
import { bump } from "./lib/rate";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_TO = 25;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const EMAIL = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']{2,}$/;
const fresh = (f: { _creationTime: number }) => Date.now() - f._creationTime < 30 * 60_000;
const by = (me: { name?: string | null; email: string }) => me.name ?? me.email;
const starterArg = v.union(v.literal("shoot"), v.literal("edit"));
const toArg = v.object({ vendorId: v.optional(v.id("vendors")), email: v.string(), name: v.optional(v.string()) });
type To = { vendorId?: Id<"vendors">; email: string; name?: string };
const linkOf = (token: string) => `${SITE()}/b/${token}`;

async function ownerBiz(ctx: QueryCtx | MutationCtx) {
  const me = await requireMe(ctx);
  const id = businessInScope(ctx);
  const b = id ? await ctx.db.get(id) : null;
  if (!b) throw new ConvexError("Not allowed.");
  return { b, me };
}
const docOf = (b: Doc<"wsBuilds">): BuildDoc => ({ title: b.title, page: pageOf(b.blocks), fields: b.fields as Fields, signers: (b.signers as ExtraSigner[]) ?? [], style: b.style as Style });
const open = (k: Doc<"vendorBookings">) => k.status === "offered" || k.status === "accepted";
const forWho = (vendor: string, k: Doc<"vendorBookings">) => ({ vendor: `${vendor}, ${k.role}`, dates: dateRange(k.start, k.end) });
const kindName = (x: Doc<"briefings">) => (x.starter ? STARTERS[x.starter].name : "Brief");
const fieldOf = (b: Doc<"wsBuilds"> | null, key: string) => ((b?.fields as Fields | undefined)?.custom ?? []).find((c) => c.key === key)?.value?.trim() || null;

async function bookingOn(ctx: QueryCtx, bookingId: Id<"vendorBookings">) {
  const k = await ctx.db.get(bookingId);
  if (!k) throw new ConvexError("That booking isn't here.");
  if (!open(k)) throw new ConvexError(k.status === "declined" ? "They declined that booking, so they can't get a briefing for it." : "That booking was cancelled.");
  const vendor = await ctx.db.get(k.vendorId);
  const p = await ctx.db.get(k.projectId);
  if (!vendor || !p) throw new ConvexError("That booking isn't here.");
  return { k, vendor, p };
}

/** Vendors with an offered or accepted booking on the project. */
async function bookedOn(ctx: QueryCtx, projectId: Id<"projects"> | undefined) {
  if (!projectId) return new Set<string>();
  return new Set((await ctx.db.query("vendorBookings").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect()).filter(open).map((k) => String(k.vendorId)));
}

const recipientsOf = (ctx: QueryCtx, briefingId: Id<"briefings">) => ctx.db.query("briefingRecipients").withIndex("by_briefing", (q) => q.eq("briefingId", briefingId)).collect();

/** Everyone who got it by email, as the list and the owner's page show them. A briefing sent before D147 had one vendor. */
async function peopleOf(ctx: QueryCtx, x: Doc<"briefings">) {
  const booked = await bookedOn(ctx, x.projectId);
  const rs = await recipientsOf(ctx, x._id);
  const people = rs.sort((a, b) => a.sentAt - b.sentAt).map((r) => ({
    _id: r._id as string, name: r.name ?? null, email: r.email, label: r.name || r.email, vendor: !!r.vendorId, booked: !!r.vendorId && booked.has(String(r.vendorId)),
    sentAt: r.sentAt, openedAt: r.openedAt ?? null, opens: r.opens, readAt: r.readAt ?? null,
  }));
  if (!people.length && x.status === "sent" && x.sentTo) // sent to one booked vendor before D147: read in their portal
    people.push({ _id: `legacy:${x._id}`, name: x.sentTo.name, email: x.sentTo.email, label: x.sentTo.name, vendor: true, booked: true, sentAt: x.sentAt ?? 0, openedAt: x.readAt ?? null, opens: x.readAt ? 1 : 0, readAt: x.readAt ?? null });
  return people;
}

/** Draft · Sent · Read. Q95: Read once everyone it was emailed to has read it; a copied link alone stays Sent. */
function stateOf(x: Doc<"briefings">, people: Array<{ readAt: number | null }>): "draft" | "sent" | "read" {
  if (x.status === "draft") return "draft";
  return people.length > 0 && people.every((p) => p.readAt) ? "read" : "sent";
}

async function rowOf(ctx: QueryCtx, x: Doc<"briefings">) {
  const build = await ctx.db.get(x.buildId);
  const p = x.projectId ? await ctx.db.get(x.projectId) : null;
  const people = await peopleOf(ctx, x);
  return {
    _id: x._id, buildId: x.buildId, title: build?.title ?? "Briefing", kindName: kindName(x), project: p ? label(p) : null, projectId: x.projectId ?? null,
    state: stateOf(x, people), sentAt: x.sentAt ?? null, updatedAt: x.updatedAt,
    people: people.map((r) => ({ label: r.label, vendor: r.vendor, booked: r.booked, openedAt: r.openedAt, readAt: r.readAt })),
    link: { copied: !!x.linkToken, opens: x.linkOpens ?? 0, reads: x.linkReads ?? 0, off: !!x.linkOff },
    readAt: people.length && people.every((r) => r.readAt) ? Math.max(...people.map((r) => r.readAt ?? 0)) : null,
    // the old single-vendor fields some pages still show (Crew card, booking page)
    vendor: people[0]?.label ?? null, vendorId: x.sentTo?.vendorId ?? null,
  };
}

/** Send to, checked: vendors must be on this business's list (their own email is used), others need a real address. */
async function cleanTo(ctx: QueryCtx, list: To[]) {
  const out: Array<{ vendorId?: Id<"vendors">; email: string; name?: string }> = [];
  const seen = new Set<string>();
  for (const t of list) {
    let email = t.email.trim().toLowerCase(), name = (t.name ?? "").trim().replace(/\s+/g, " ").slice(0, 80) || undefined;
    let vendorId: Id<"vendors"> | undefined;
    if (t.vendorId) {
      const vd = await ctx.db.get(t.vendorId); // another business's vendor reads as null (the business guard)
      if (!vd || vd.archivedAt) throw new ConvexError("That vendor isn't on your list.");
      vendorId = vd._id; email = vd.email.trim().toLowerCase(); name = vd.name;
    }
    if (!EMAIL.test(email) || email.length > 200) throw new ConvexError(`“${t.email.slice(0, 60)}” isn't an email address.`);
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ ...(vendorId ? { vendorId } : {}), email, ...(name ? { name } : {}) });
  }
  if (out.length > MAX_TO) throw new ConvexError(`Up to ${MAX_TO} people at a time.`);
  return out;
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

/** A vendor's briefings (their page): sent through a booking before D147, or emailed to them since. */
export const forVendor = query({
  args: { vendorId: v.string() },
  handler: async (ctx, { vendorId }) => {
    await ownerBiz(ctx);
    const id = ctx.db.normalizeId("vendors", vendorId);
    if (!id) return null;
    const xs = new Map<string, Doc<"briefings">>();
    for (const k of await ctx.db.query("vendorBookings").withIndex("by_vendor", (q) => q.eq("vendorId", id)).collect())
      for (const x of await ctx.db.query("briefings").withIndex("by_booking", (q) => q.eq("bookingId", k._id)).collect()) xs.set(x._id, x);
    for (const r of await ctx.db.query("briefingRecipients").withIndex("by_vendor", (q) => q.eq("vendorId", id)).collect()) {
      const x = await ctx.db.get(r.briefingId);
      if (x) xs.set(x._id, x);
    }
    const out = [];
    for (const x of xs.values()) out.push(await rowOf(ctx, x));
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** One briefing, for the builder and the owner's briefing page: where it stands, who has it, who it can go to. */
export const get = query({
  args: { briefingId: v.string() },
  handler: async (ctx, { briefingId }) => {
    await ownerBiz(ctx);
    const id = ctx.db.normalizeId("briefings", briefingId);
    const x = id ? await ctx.db.get(id) : null;
    if (!x) return null;
    const p = x.projectId ? await ctx.db.get(x.projectId) : null;
    const booked = await bookedOn(ctx, x.projectId);
    const vendors = (await ctx.db.query("vendors").collect()).filter((vd) => !vd.archivedAt)
      .map((vd) => ({ _id: vd._id, name: vd.name, email: vd.email, booked: booked.has(String(vd._id)) }))
      .sort((a, b) => Number(b.booked) - Number(a.booked) || a.name.localeCompare(b.name));
    const projects = (await ctx.db.query("projects").collect()).filter((pr) => !(pr as { archivedAt?: number }).archivedAt)
      .sort((a, b) => b._creationTime - a._creationTime).slice(0, 200).map((pr) => ({ _id: pr._id, label: label(pr) }));
    const byId = new Map(vendors.map((vd) => [String(vd._id), vd]));
    const build = await ctx.db.get(x.buildId);
    return {
      dates: fieldOf(build, "dates"),
      ...(await rowOf(ctx, x)), starter: x.starter ?? null, kindName: x.starter ? STARTERS[x.starter].name : "Briefing",
      project: p ? { _id: p._id, label: label(p) } : null,
      sendTo: (x.sendTo ?? []).map((t) => ({ ...t, label: t.vendorId ? byId.get(String(t.vendorId))?.name ?? t.name ?? t.email : t.name || t.email, booked: !!t.vendorId && booked.has(String(t.vendorId)) })),
      vendors, projects, who: await peopleOf(ctx, x),
      link: { copied: !!x.linkToken, url: x.linkToken ? linkOf(x.linkToken) : null, off: !!x.linkOff, opens: x.linkOpens ?? 0, reads: x.linkReads ?? 0 },
      pdfUrl: x.pdfId ? await ctx.storage.getUrl(x.pdfId) : null, history: x.history,
    };
  },
});

// ---------- writes ----------

/** A new briefing: from a booking (its vendor goes in Send to), or for a project, or for nothing yet (D147). */
export const create = mutation({
  args: { bookingId: v.optional(v.id("vendorBookings")), projectId: v.optional(v.id("projects")), starter: v.optional(starterArg), templateId: v.optional(v.id("wsTemplates")) },
  handler: async (ctx, a) => {
    const { me } = await ownerBiz(ctx);
    const bk = a.bookingId ? await bookingOn(ctx, a.bookingId) : null;
    const p = bk ? bk.p : a.projectId ? await ctx.db.get(a.projectId) : null;
    if (a.projectId && !p) throw new ConvexError("That project isn't here.");
    const t = a.templateId ? await ctx.db.get(a.templateId) : null;
    if (a.templateId && (!t || t.kind !== "briefing")) throw new ConvexError("That briefing template isn't here.");
    const starter: Starter | undefined = t ? undefined : a.starter ?? (bk ? starterFor(bk.k.role) : "shoot");
    const page: Page = t ? pageOf(t.blocks) : briefingStarterPage(starter!, !!p);
    const who = bk ? forWho(bk.vendor.name, bk.k) : { vendor: "your crew", dates: "" };
    const fields = briefingFields((t?.fields as Partial<Fields> | undefined)?.custom, { project: p ? label(p) : "", ...who });
    const name = t ? t.name : STARTERS[starter!].name;
    const buildId = await insertBuild(ctx, { title: p ? `${name} · ${label(p)}` : name, page, fields, ...(t ? { style: t.style as Style, templateId: t._id } : {}) });
    await ctx.db.patch(buildId, { kind: "briefing" });
    const now = Date.now();
    return ctx.db.insert("briefings", {
      buildId, ...(p ? { projectId: p._id } : {}), ...(bk ? { bookingId: bk.k._id, sendTo: [{ vendorId: bk.vendor._id, email: bk.vendor.email.toLowerCase(), name: bk.vendor.name }] } : {}),
      ...(starter ? { starter } : {}), status: "draft",
      history: [{ kind: "created", at: now, by: by(me), detail: t ? `from the template "${t.name}"` : STARTERS[starter!].name }], createdAt: now, updatedAt: now,
    });
  },
});

/** The builder's Briefing panel (863:15661): Project (optional) and Send to. Saving sends nothing. */
export const setDetails = mutation({
  args: { briefingId: v.id("briefings"), projectId: v.union(v.id("projects"), v.null()), sendTo: v.array(toArg) },
  handler: async (ctx, a) => {
    await ownerBiz(ctx);
    const x = await ctx.db.get(a.briefingId);
    if (!x) throw new ConvexError("That briefing isn't here.");
    if (x.status !== "draft") throw new ConvexError("It's been shared. Use Share again to send it to someone else.");
    const p = a.projectId ? await ctx.db.get(a.projectId) : null;
    if (a.projectId && !p) throw new ConvexError("That project isn't here.");
    const sendTo = await cleanTo(ctx, a.sendTo);
    await ctx.db.patch(x._id, { projectId: p?._id, sendTo, updatedAt: Date.now() });
    return null;
  },
});

export const deleteDraft = mutation({
  args: { briefingId: v.id("briefings") },
  handler: async (ctx, { briefingId }) => {
    await ownerBiz(ctx);
    const x = await ctx.db.get(briefingId);
    if (!x) return null;
    if (x.status !== "draft") throw new ConvexError("A shared briefing stays, so you can see what they read.");
    await ctx.db.delete(x.buildId);
    await ctx.db.delete(x._id);
    return null;
  },
});

/** A new draft from a shared briefing, to change it or send a new version. Its Send to comes along; links don't. */
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
    const people = await recipientsOf(ctx, x._id);
    const sendTo = people.length ? people.map((r) => ({ ...(r.vendorId ? { vendorId: r.vendorId } : {}), email: r.email, ...(r.name ? { name: r.name } : {}) })) : x.sendTo ?? (x.sentTo ? [{ vendorId: x.sentTo.vendorId, email: x.sentTo.email.toLowerCase(), name: x.sentTo.name }] : []);
    return ctx.db.insert("briefings", {
      buildId, ...(x.projectId ? { projectId: x.projectId } : {}), ...(k && open(k) ? { bookingId: k._id } : {}), ...(x.starter ? { starter: x.starter } : {}), status: "draft",
      sendTo: sendTo.slice(0, MAX_TO), history: [{ kind: "created", at: now, by: by(me), detail: "a copy of a shared briefing" }], createdAt: now, updatedAt: now,
    });
  },
});

/** Turn the link off (every link, emailed ones too) or back on (Q91 a, b). */
export const setLinkOff = mutation({
  args: { briefingId: v.id("briefings"), off: v.boolean() },
  handler: async (ctx, a) => {
    const { me } = await ownerBiz(ctx);
    const x = await ctx.db.get(a.briefingId);
    if (!x) throw new ConvexError("That briefing isn't here.");
    if (x.status !== "sent") throw new ConvexError("It hasn't been shared yet.");
    if (!!x.linkOff === a.off) return null;
    const now = Date.now();
    await ctx.db.patch(x._id, { linkOff: a.off, updatedAt: now, history: [...x.history, { kind: a.off ? "link_off" : "link_on", at: now, by: by(me) }].slice(-60) });
    return null;
  },
});

// ---------- Share (863:16118): Send (email 58), Copy link ----------

/** Freezes the PDF the first time, adds each person (their own link; someone already on it keeps theirs), and makes the copied link when asked. */
export const shareStart = internalMutation({
  args: { briefingId: v.id("briefings"), storageId: v.optional(v.id("_storage")), to: v.array(toArg), copyLink: v.boolean() },
  handler: async (ctx, a): Promise<{ error?: string; at?: number; sends?: Array<{ recipientId: Id<"briefingRecipients">; email: string; name: string | null; token: string }>; link?: string }> => {
    const { me } = await ownerBiz(ctx);
    const x = await ctx.db.get(a.briefingId);
    const build = x ? await ctx.db.get(x.buildId) : null;
    if (!x || !build) throw new ConvexError("That briefing isn't here.");
    const to = await cleanTo(ctx, a.to);
    if (!to.length && !a.copyLink) return { error: "Add who it goes to (Send to)." };
    if (x.linkOff) return { error: "The link is turned off. Turn it back on first, so the new links work." };
    const now = Date.now();
    // As proposals (review fix): a file that isn't a fresh PDF upload is never touched; one this caller just uploaded
    // for this briefing is theirs, so a refusal deletes it (returned, not thrown, so the delete isn't rolled back).
    const refuse = async (error: string) => { if (a.storageId) await ctx.storage.delete(a.storageId).catch(() => null); return { error }; };
    let patch: Partial<Doc<"briefings">> = { updatedAt: now };
    const hist = [...x.history];
    if (x.status === "draft") {
      if (!a.storageId) return { error: "The PDF didn't upload. Try again." };
      const file = await ctx.db.system.get(a.storageId);
      if (!file || !fresh(file) || (file.contentType && file.contentType !== "application/pdf") || file.size > MAX_PDF_BYTES) return { error: "The PDF didn't upload. Try again." };
      const problems = briefingProblems(docOf(build));
      if (problems.length) return refuse(problems[0]);
      patch = { ...patch, status: "sent", pdfId: a.storageId, sentAt: now };
      await ctx.db.patch(build._id, { renderedAt: now });
    } else if (a.storageId) await ctx.storage.delete(a.storageId).catch(() => null); // already frozen: the extra upload isn't needed
    const sends: Array<{ recipientId: Id<"briefingRecipients">; email: string; name: string | null; token: string }> = [];
    const have = await recipientsOf(ctx, x._id);
    if (have.length + to.filter((t) => !have.some((r) => r.email === t.email)).length > 200) return refuse("That's a lot of people for one briefing. Make a copy for the rest.");
    for (const t of to) {
      const old = have.find((r) => r.email === t.email);
      if (old) { await ctx.db.patch(old._id, { sentAt: now }); sends.push({ recipientId: old._id, email: old.email, name: old.name ?? null, token: old.token }); continue; }
      const token = randomToken(18);
      const recipientId = await ctx.db.insert("briefingRecipients", { briefingId: x._id, email: t.email, ...(t.name ? { name: t.name } : {}), ...(t.vendorId ? { vendorId: t.vendorId } : {}), token, sentAt: now, opens: 0 });
      sends.push({ recipientId, email: t.email, name: t.name ?? null, token });
    }
    if (sends.length) hist.push({ kind: "sent", at: now, by: by(me), detail: sends.map((s) => s.email).join(", ").slice(0, 400) });
    let link: string | undefined;
    if (a.copyLink) {
      const token = x.linkToken ?? randomToken(18);
      if (!x.linkToken) { patch = { ...patch, linkToken: token }; hist.push({ kind: "link_copied", at: now, by: by(me) }); }
      link = linkOf(token);
    }
    await ctx.db.patch(x._id, { ...patch, sendTo: undefined, history: hist.slice(-60) });
    return { at: now, sends, ...(link ? { link } : {}) };
  },
});

export const shareMail = internalQuery({
  args: { briefingId: v.id("briefings") },
  handler: async (ctx, { briefingId }) => {
    const x = await ctx.db.get(briefingId);
    const build = x ? await ctx.db.get(x.buildId) : null;
    if (!x || !build) return null;
    const p = x.projectId ? await ctx.db.get(x.projectId) : null;
    return { kind: kindName(x), title: build.title, project: p ? label(p) : null, dates: fieldOf(build, "dates"), headings: briefingHeadings(pageOf(build.blocks)), brand: await mailBrandOf(ctx, x.businessId ?? null), businessId: x.businessId ?? null };
  },
});

export const note = internalMutation({
  args: { briefingId: v.id("briefings"), kind: v.string(), detail: v.optional(v.string()) },
  handler: async (ctx, { briefingId, kind, detail }) => {
    const x = await ctx.db.get(briefingId);
    if (x) await ctx.db.patch(briefingId, { history: [...x.history, { kind, at: Date.now(), ...(detail ? { detail: detail.slice(0, 400) } : {}) }].slice(-60) });
  },
});

/** Share: Send (email 58 to each person, their own link) and/or Copy link. Nothing goes out until this is called. */
export const share = action({
  args: { briefingId: v.id("briefings"), storageId: v.optional(v.id("_storage")), to: v.array(toArg), note: v.optional(v.string()), copyLink: v.optional(v.boolean()) },
  handler: async (ctx, a): Promise<{ sent: number; held: number; off: number; failed: string[]; link: string | null }> => {
    const s = await ctx.runMutation(internal.briefings.shareStart, { briefingId: a.briefingId, storageId: a.storageId, to: a.to, copyLink: !!a.copyLink });
    if (s.error !== undefined || !s.at) throw new ConvexError(s.error ?? "That didn't share. Try again.");
    const out = { sent: 0, held: 0, off: 0, failed: [] as string[], link: s.link ?? null };
    if (!s.sends?.length) return out;
    const d = await ctx.runQuery(internal.briefings.shareMail, { briefingId: a.briefingId });
    if (!d) throw new ConvexError("That didn't send. Try again.");
    const words = (a.note ?? "").trim().replace(/\s+\n/g, "\n").slice(0, 1000) || null;
    for (const r of s.sends) {
      try {
        const res = await deliverOnce(ctx, `briefing-58:${r.recipientId}:${s.at}`, "briefing", r.email, briefingLinkMail(d.brand, {
          name: r.name, kind: d.kind, project: d.project, title: d.title, dates: d.dates, headings: d.headings, note: words, link: linkOf(r.token),
        }), d.brand.replyTo, d.businessId);
        if (res === "held") out.held++; else if (res === "off") out.off++; else out.sent++;
      } catch { out.failed.push(r.email); }
    }
    if (out.held) await ctx.runMutation(internal.briefings.note, { briefingId: a.briefingId, kind: "email_held", detail: `${out.held} held` });
    if (out.failed.length) await ctx.runMutation(internal.briefings.note, { briefingId: a.briefingId, kind: "email_failed", detail: out.failed.join(", ") });
    return out;
  },
});

// ---------- the no-login page (/b/<token>, 863:17436): a token is the key ----------

type Found = { x: Doc<"briefings">; r: Doc<"briefingRecipients"> | null };
/** An emailed person's own link, or the copied link. Only a shared briefing; Draft never answers. */
async function byToken(ctx: QueryCtx | MutationCtx, token: string): Promise<Found | null> {
  if (!TOKEN.test(token)) return null;
  const r = await ctx.db.query("briefingRecipients").withIndex("by_token", (q) => q.eq("token", token)).first();
  if (r) {
    const x = await ctx.db.get(r.briefingId);
    return x && x.status === "sent" ? { x, r } : null;
  }
  const x = await ctx.db.query("briefings").withIndex("by_link_token", (q) => q.eq("linkToken", token)).first();
  return x && x.status === "sent" ? { x, r: null } : null;
}
const isOwnerCall = (ctx: object) => !!(ctx as { scope?: { isOwner: boolean } | null }).scope?.isOwner;

export const page = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const f = await byToken(ctx, token);
    if (!f) return null;
    focusBusiness(ctx, f.x.businessId);
    const b = f.x.businessId ? await ctx.db.get(f.x.businessId) : null;
    const build = await ctx.db.get(f.x.buildId);
    const p = f.x.projectId ? await ctx.db.get(f.x.projectId) : null;
    const business = b ? {
      name: b.name, owner: b.ownerName?.trim() || null, email: b.replyTo ?? null, accent: b.accent ?? null, background: b.background ?? null,
      logoUrl: b.logoFileId ? await ctx.storage.getUrl(b.logoFileId) : null,
    } : { name: "", owner: null, email: null, accent: null, background: null, logoUrl: null };
    if (f.x.linkOff) return { withdrawn: true as const, business, title: build?.title ?? "Briefing" };
    return {
      withdrawn: false as const, business, title: build?.title ?? "Briefing", kind: kindName(f.x), project: p ? label(p) : null,
      dates: fieldOf(build, "dates"), sentAt: f.x.sentAt ?? null, named: !!f.r, name: f.r?.name ?? null, readAt: f.r?.readAt ?? null,
    };
  },
});

/** The page opened: counted for its person (named) or for the copied link (not named). The owner looking isn't counted. */
export const opened = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const f = await byToken(ctx, token);
    if (!f || f.x.linkOff || isOwnerCall(ctx)) return null;
    focusBusiness(ctx, f.x.businessId);
    try { await bump(ctx, "briefingLink", token); } catch { return null; } // a page reloaded all hour stops counting
    const now = Date.now();
    if (f.r) {
      await ctx.db.patch(f.r._id, { opens: f.r.opens + 1, ...(f.r.openedAt ? {} : { openedAt: now }) });
      if (!f.r.openedAt) await ctx.db.patch(f.x._id, { history: [...f.x.history, { kind: "opened", at: now, by: f.r.name || f.r.email }].slice(-60) });
    } else await ctx.db.patch(f.x._id, { linkOpens: (f.x.linkOpens ?? 0) + 1 });
    return null;
  },
});

/** "I've read it": named on a person's own link (and the owner is emailed), counted on a copied link. */
export const markRead = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const f = await byToken(ctx, token);
    if (!f) throw new ConvexError("This briefing isn't here.");
    if (f.x.linkOff) throw new ConvexError("This briefing was withdrawn.");
    if (isOwnerCall(ctx)) return null; // the owner checking the page isn't the person reading it
    focusBusiness(ctx, f.x.businessId);
    await bump(ctx, "briefingLink", token);
    const now = Date.now();
    if (f.r) {
      if (f.r.readAt) return null;
      await ctx.db.patch(f.r._id, { readAt: now, ...(f.r.openedAt ? {} : { openedAt: now }) });
      await ctx.db.patch(f.x._id, { updatedAt: now, history: [...f.x.history, { kind: "read", at: now, by: f.r.name || f.r.email }].slice(-60) });
      await ctx.scheduler.runAfter(0, internal.vendorPortal.mailOwner, { what: "recipient-read", id: f.r._id });
    } else await ctx.db.patch(f.x._id, { linkReads: (f.x.linkReads ?? 0) + 1, history: [...f.x.history, { kind: "read", at: now, by: "someone with the link" }].slice(-60) });
    return null;
  },
});

/** The frozen PDF for a token, or null (no such link, a draft, or the link turned off). */
export const pdfFor = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const f = await byToken(ctx, token);
    if (!f || f.x.linkOff || !f.x.pdfId) return null;
    const build = await ctx.db.get(f.x.buildId);
    return { pdfId: f.x.pdfId, name: `${(build?.title ?? "Briefing").replace(/[^\w .·-]+/g, "").trim().slice(0, 80) || "Briefing"}.pdf` };
  },
});

/** GET /b-pdf/<token>: the PDF the page shows and downloads. Turning the link off stops it (no lasting file URL). */
export const pdfRoute = httpAction(async (ctx, req) => {
  const token = decodeURIComponent(new URL(req.url).pathname.replace(/^\/b-pdf\//, "")).replace(/\.pdf$/, "");
  const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const d = await ctx.runQuery(internal.briefings.pdfFor, { token });
  const blob = d ? await ctx.storage.get(d.pdfId) : null;
  if (!d || !blob) return new Response("This briefing isn't here.", { status: 404, headers: { ...cors, "Content-Type": "text/plain" } });
  const download = new URL(req.url).searchParams.has("download");
  return new Response(blob, { status: 200, headers: { ...cors, "Content-Type": "application/pdf", "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${d.name.replace(/"/g, "")}"` } });
});
