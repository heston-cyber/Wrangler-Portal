// Phase 7 step 3 (D107, D111, D112, D114; Heston, Nov 18: "Approved"): a new client's onboarding, frames 747:10–748:384
// and email 39 (753:2144). After the sign-in: About you, Your company (billing and their brand kit), Preferences (which
// emails, and asking to add people from their company), and a short tour of their portal. Every step can be finished
// later; the Getting started card on their Home shows what's left. Clients who were here before Phase 7 (their invite has
// no end date) see only the tour (D114). People a client asks to add wait for the owner (D112): nothing reaches them until
// the owner approves, which adds them to the company and sends their invite.
import { shownName } from "./lib/names";
import { v, ConvexError } from "convex/values";
import { focusBusiness, internalAction, internalQuery, mutation, query } from "./lib/functions";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAll, viewerOf } from "./lib/access";
import { businessContact } from "./lib/business";
import { claimUpload } from "./lib/fileOwners";
import { ensureInvite } from "./clients";
import { mailBrandOf } from "./lib/mail";
import { clientAddRequestMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { SITE } from "./lib/site";
import { bump, inviteCap } from "./lib/rate";
import { audit } from "./lib/audit";
import { EMPTY_KIT, type Kit } from "./brandKit";
import { ownerNames } from "./auth";

const EMAIL = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']{2,}$/;
const plain = (s: string | undefined, max: number) => (s ?? "").replace(/[\u0000-\u001f\u007f<>{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const HEX = /^#[0-9a-fA-F]{6}$/;
const STEPS = ["about", "company", "prefs", "tour"] as const;

/** The signed-in client's person row (and company) in the business they're looking at. */
async function mine(ctx: QueryCtx | MutationCtx) {
  const v = await viewerOf(ctx);
  if (v.kind !== "client") return null;
  const rows = (await ctx.db.query("clientPeople").withIndex("by_email", (q) => q.eq("email", v.email.toLowerCase())).collect()).filter((p) => !p.removedAt);
  for (const p of rows) {
    const c = await ctx.db.get(p.clientId);
    // Phase 7 reviews (L5): act for that company's business, so a client of two businesses can save (and ask) here too.
    if (c && (!v.businessId || (c.businessId ?? null) === v.businessId)) { focusBusiness(ctx, c.businessId ?? null); return { v, p, c }; }
  }
  return null;
}
async function mustMine(ctx: QueryCtx | MutationCtx) {
  const m = await mine(ctx);
  if (!m) throw new ConvexError("Not allowed.");
  return m;
}

/** Here before Phase 7: their invite (in this business) has no end date (D114: they see only the tour). */
async function wasHere(ctx: QueryCtx | MutationCtx, email: string) {
  const inv = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()).filter((i) => !i.revokedAt);
  return inv.length > 0 && inv.every((i) => i.expiresAt === undefined);
}

export const state = query({
  args: {},
  handler: async (ctx) => {
    const m = await mine(ctx);
    if (!m) return null;
    const { v, p, c } = m;
    const o = p.onboard ?? { step: 0 };
    const kit = (c.brandKit as Kit | undefined) ?? EMPTY_KIT;
    const b = c.businessId ? await ctx.db.get(c.businessId) : null;
    const asked = (await ctx.db.query("colleagueRequests").withIndex("by_client", (q) => q.eq("clientId", c._id)).collect()).filter((r) => r.by === v.email.toLowerCase());
    return {
      business: b?.name ?? "", company: shownName(c.name), first: (v.name || "").split(" ")[0] || null, existing: await wasHere(ctx, v.email.toLowerCase()),
      step: o.step, done: { about: !!o.about, company: !!o.company, prefs: !!o.prefs, tour: !!o.tour }, tourSkipped: !!o.tourSkipped,
      about: { name: v.name ?? "", title: p.title ?? "", phone: p.phone ?? "" },
      billing: { name: c.billing?.name ?? "", email: c.billing?.email ?? "", address: c.billing?.address ?? "" },
      brand: { colors: kit.colors.map((x) => x.hex).slice(0, 6), logoUrl: kit.logoFileId ? await ctx.storage.getUrl(kit.logoFileId) : null },
      asked: asked.sort((a, x) => x.at - a.at).map((r) => ({ _id: r._id, email: r.email, name: r.name ?? null, status: r.status })),
    };
  },
});

async function mark(ctx: MutationCtx, p: Doc<"clientPeople">, key: (typeof STEPS)[number] | null, at: number, extra: { tourSkipped?: boolean } = {}) {
  const o = { ...(p.onboard ?? { step: 0 }), step: Math.max(0, Math.min(STEPS.length, Math.round(at))), ...extra };
  if (key) o[key] = o[key] ?? Date.now();
  await ctx.db.patch(p._id, { onboard: o });
}

/** Continue (a step is done) or Finish later / Back (where they are). */
export const step = mutation({
  args: { done: v.optional(v.union(v.literal("about"), v.literal("company"), v.literal("prefs"))), at: v.number() },
  handler: async (ctx, a) => {
    const { p } = await mustMine(ctx);
    await mark(ctx, p, a.done ?? null, a.at);
    return null;
  },
});

/** The tour finished, or skipped (it can be taken again any time). */
export const tour = mutation({
  args: { skipped: v.boolean() },
  handler: async (ctx, { skipped }) => {
    const { p } = await mustMine(ctx);
    await mark(ctx, p, skipped ? null : "tour", STEPS.length, { tourSkipped: skipped });
    return null;
  },
});

/** 747:333 About you: their name (their own login), title and phone (for shoot-day questions). */
export const about = mutation({
  args: { name: v.string(), title: v.optional(v.string()), phone: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { v, p } = await mustMine(ctx);
    const name = plain(a.name, 60);
    if (name.length < 2) throw new ConvexError("Type your name.");
    // Reviews (Phase 7, M3): the same guard as users.setName: nobody else may take the owner's name.
    if (ownerNames().has(name.toLowerCase())) throw new ConvexError("That name is taken.");
    const phone = plain(a.phone, 30);
    if (phone && !/^[0-9+().\-\s]{7,30}$/.test(phone)) throw new ConvexError("That doesn't look like a phone number.");
    await ctx.db.patch(v.userId, { name });
    await ctx.db.patch(p._id, { name, title: plain(a.title, 60) || undefined, phone: phone || undefined });
    await mark(ctx, (await ctx.db.get(p._id))!, "about", 1);
    return null;
  },
});

/** 747:489 Your company: billing contact, email and address, and their brand colours (their company's kit). */
export const company = mutation({
  args: { billingName: v.optional(v.string()), billingEmail: v.optional(v.string()), address: v.optional(v.string()), colors: v.optional(v.array(v.string())) },
  handler: async (ctx, a) => {
    const { p, c } = await mustMine(ctx);
    const email = plain(a.billingEmail, 254).toLowerCase();
    if (email && !EMAIL.test(email)) throw new ConvexError("Type a billing email, or leave it empty.");
    const billing = { ...(plain(a.billingName, 80) ? { name: plain(a.billingName, 80) } : {}), ...(email ? { email } : {}), ...(plain(a.address, 200) ? { address: plain(a.address, 200) } : {}) };
    const patch: Partial<Doc<"clients">> = { billing };
    if (a.colors) {
      const colors = a.colors.map((x) => x.trim().toUpperCase()).filter((x) => HEX.test(x)).slice(0, 6);
      const kit = (c.brandKit as Kit | undefined) ?? EMPTY_KIT;
      patch.brandKit = { ...kit, colors: colors.map((hex) => kit.colors.find((k) => k.hex.toUpperCase() === hex) ?? { hex }) };
    }
    await ctx.db.patch(c._id, patch);
    await mark(ctx, p, "company", 2);
    return null;
  },
});

/** Their logo for the company's kit (PNG, JPG or WebP, up to 5 MB). Phase 7 reviews: no SVG from outside parties (as
 *  canvases), and the upload limit is counted per person (L7). */
export const logoUploadUrl = mutation({ args: {}, handler: async (ctx) => { const { v } = await mustMine(ctx); await bump(ctx, "msgUpload", `onboard-logo:${v.userId}`); return ctx.storage.generateUploadUrl(); } });
export const setLogo = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const { c, v } = await mustMine(ctx);
    const f = await ctx.db.system.get(storageId);
    if (!f || Date.now() - f._creationTime > 30 * 60_000 || !/^image\/(png|jpeg|webp)$/.test(f.contentType ?? "") || f.size > 5 * 1024 * 1024) throw new ConvexError("Use a PNG, JPG or WebP under 5 MB.");
    if (!(await claimUpload(ctx, storageId, c.businessId ?? null, "client-logo", v.userId)).fresh) throw new ConvexError("That upload didn't work. Try again.");
    const kit = (c.brandKit as Kit | undefined) ?? EMPTY_KIT;
    await ctx.db.patch(c._id, { brandKit: { ...kit, logoFileId: storageId } });
    return null;
  },
});

/** 747:681: ask to add someone from their company. The owner decides (D112); nothing goes to that person until then. */
export const askColleague = mutation({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { v, c } = await mustMine(ctx);
    const email = a.email.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 254) throw new ConvexError("Type their email.");
    await bump(ctx, "teamInvite", `colleague:${c._id}`); // at most 30 an hour per company
    const people = await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", c._id)).collect();
    if (people.some((x) => x.email === email && !x.removedAt)) throw new ConvexError("They already have access.");
    const reqs = await ctx.db.query("colleagueRequests").withIndex("by_client", (q) => q.eq("clientId", c._id)).collect();
    if (reqs.some((r) => r.email === email && r.status === "pending")) throw new ConvexError("You've already asked for them.");
    const now = Date.now();
    const id = await ctx.db.insert("colleagueRequests", { clientId: c._id, email, ...(plain(a.name, 60) ? { name: plain(a.name, 60) } : {}), by: v.email.toLowerCase(), ...(v.name ? { byName: v.name } : {}), at: now, status: "pending" });
    await ctx.scheduler.runAfter(0, internal.clientOnboard.mailOwner, { requestId: id });
    return { requestId: id };
  },
});

export const mailData = internalQuery({
  args: { requestId: v.id("colleagueRequests") },
  handler: async (ctx, { requestId }) => {
    const r = await ctx.db.get(requestId);
    const c = r ? await ctx.db.get(r.clientId) : null;
    if (!r || !c || r.status !== "pending") return null;
    const bc = await businessContact(ctx, c.businessId ?? null);
    return { r, company: c.name, clientId: c._id, owner: bc.ownerEmail, brand: await mailBrandOf(ctx, c.businessId ?? null), businessId: c.businessId ?? null };
  },
});

/** Email 39 to the owner. */
export const mailOwner = internalAction({
  args: { requestId: v.id("colleagueRequests") },
  handler: async (ctx, { requestId }) => {
    const d = await ctx.runQuery(internal.clientOnboard.mailData, { requestId });
    if (!d) return;
    await deliverOnce(ctx, `client-add-request:${requestId}`, "client_add_request", d.owner, clientAddRequestMail(d.brand, {
      by: d.r.byName || d.r.by, name: d.r.name ?? null, email: d.r.email, company: d.company, link: `${SITE()}/clients/${d.clientId}`,
    }), d.brand.replyTo, d.businessId);
  },
});

// ---------- the owner's side: on the company's page ----------

/** People this company's clients asked to add, waiting for a decision. */
export const requests = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    await requireAll(ctx, "clients");
    if (!(await ctx.db.get(clientId))) return [];
    return (await ctx.db.query("colleagueRequests").withIndex("by_client", (q) => q.eq("clientId", clientId)).collect())
      .filter((r) => r.status === "pending").sort((a, b) => a.at - b.at)
      .map((r) => ({ _id: r._id, email: r.email, name: r.name ?? null, by: r.byName ?? r.by, at: r.at }));
  },
});

/** Approve: they join the company as a contact and get their portal invite. Decline: marked, no email. */
export const decide = mutation({
  args: { requestId: v.string(), approve: v.boolean() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "clients");
    const id = ctx.db.normalizeId("colleagueRequests", a.requestId);
    const r = id ? await ctx.db.get(id) : null;
    if (!r) throw new ConvexError("That request isn't here.");
    if (r.status !== "pending") return null;
    const c = await ctx.db.get(r.clientId);
    if (!c) throw new ConvexError("That company isn't here.");
    const now = Date.now();
    if (!a.approve) { await ctx.db.patch(r._id, { status: "declined", decidedAt: now }); return null; }
    const inv = await ensureInvite(ctx, r.email, r.name);
    const people = await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", c._id)).collect();
    const same = people.find((x) => x.email === inv.email);
    if (same) { if (same.removedAt) await ctx.db.patch(same._id, { removedAt: undefined }); }
    else await ctx.db.insert("clientPeople", { clientId: c._id, email: inv.email, role: "contact", createdAt: now, ...(r.name ? { name: r.name } : {}) });
    await ctx.db.patch(r._id, { status: "approved", decidedAt: now });
    await audit(ctx, { kind: "sent", text: `approved ${r.name ?? r.email} for ${c.name} (asked by ${r.byName ?? r.by}) and sent their portal invite`, where: "Clients", link: `/clients/${c._id}` });
    await inviteCap(ctx, r.businessId ?? "default", inv.email); // Phase 7 reviews (M4)
    await ctx.scheduler.runAfter(0, internal.emails.portalInvite, { email: inv.email, sendKey: `colleague-${r._id}` });
    return null;
  },
});
