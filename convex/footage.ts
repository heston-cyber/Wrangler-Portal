// Phase 5 (Nov 3): raw footage after delivery (frames S5 · Phase 5: the client's offer 742:2695 / Kept 742:2954 /
// No thanks 742:3216, the owner's Delivery card 743:2532, Settings › Payments › Footage storage 743:3134, emails 34
// and 36). Decisions: D33 a yearly invoice the owner sends; D98 kept 30 days after the final files open, until and
// unless the client pays to store it or sends a hard drive (recorded by the owner only); D140 next year's invoice is
// drafted 30 days before the paid year ends; D142 no offer for projects delivered before this was built.
//
//   - When a project's final files first open (the owner's Unlock or a paid final invoice), the portal records the
//     offer with its keep day and tells the project's people (an Inbox item and email 34).
//   - Keep it (client) drafts a year's invoice for the owner to check and send. Paid, the footage is kept for a year
//     from the keep day (or the end of the last paid year). Nothing is charged until the owner sends the invoice.
//   - On the keep day (from 9 AM Central), if nobody kept it, the owner gets email 36 and a Dashboard alert. The same
//     when a paid year ends without the renewal paid.
//   - THE PORTAL NEVER DELETES FILES. Nothing here calls Dropbox or Bunny; it only keeps dates and reminds the owner.
import { focusBusiness, internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe, requireSignedIn } from "./lib/access";
import { businessContact, businessInScope, defaultBusiness } from "./lib/business";
import { businessOf, postToInbox } from "./lib/inbox";
import { label } from "./lib/bookingRows";
import { todayCentral } from "./lib/bookings";
import { mailBrandOf } from "./lib/mail";
import { footageOfferMail, ownerFootageEndedMail, ownerFootageMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { SITE } from "./lib/site";
import { myProjects, portalPeople } from "./projects";

type Ctx = QueryCtx | MutationCtx;
export type FootageSettings = { on: boolean; priceCents: number; keepDays: number };
export const KEEP_DAYS = [7, 14, 30, 60, 90];
const DEFAULT_SETTINGS: FootageSettings = { on: true, priceCents: 10_000, keepDays: 30 }; // Wrangler: $100/year, 30 days (D98)
const OFF: FootageSettings = { on: false, priceCents: 10_000, keepDays: 30 };             // other businesses set their own
const RENEW_DAYS = 30;                                                                     // D140
const MIN_DUE_DAYS = 7;

/** "2026-11-19" + n days. */
export function addDays(ymd: string, n: number) {
  const t = new Date(`${ymd}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
/** A year on from a day (Feb 29 becomes Feb 28). */
export function addYear(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y + 1, m - 1, d, 12));
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0);
  return t.toISOString().slice(0, 10);
}
const longDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function settingsFor(ctx: Ctx, biz: Id<"businesses"> | null): Promise<FootageSettings> {
  const b = biz ? await ctx.db.get(biz) : null;
  if (b?.footage) return b.footage;
  const def = await defaultBusiness(ctx);
  return !b || (def && def._id === b._id) ? DEFAULT_SETTINGS : OFF;
}

function hist(r: Doc<"footageStorage">, text: string, at = Date.now()) {
  return [...r.history, { at, text }].slice(-40);
}

// ---------- Settings › Payments › Footage storage (D98) ----------

export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    return { ...(await settingsFor(ctx, businessInScope(ctx))), keepDayChoices: KEEP_DAYS };
  },
});

export const saveSettings = mutation({
  args: { on: v.boolean(), priceCents: v.number(), keepDays: v.number() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const biz = businessInScope(ctx);
    if (!biz) throw new ConvexError("Not allowed.");
    const priceCents = Math.round(a.priceCents);
    if (!Number.isFinite(priceCents) || priceCents < 100 || priceCents > 1_000_000) throw new ConvexError("Set a yearly price between $1 and $10,000.");
    if (!KEEP_DAYS.includes(a.keepDays)) throw new ConvexError("Pick how long to keep raw footage after delivery.");
    await ctx.db.patch(biz, { footage: { on: a.on, priceCents, keepDays: a.keepDays }, updatedAt: Date.now() });
    return null;
  },
});

// ---------- the offer, when the final files first open ----------

/**
 * Called by projects.openDelivery. `firstTime` is false when the files were open before (an "Unlock again", or a project
 * delivered before Phase 5 whose links expired), so those never get an offer (D142). One offer per project, ever.
 */
export async function offerOnDelivery(ctx: MutationCtx, p: Doc<"projects">, firstTime: boolean) {
  if (!firstTime) return null;
  if (await ctx.db.query("footageStorage").withIndex("by_project", (q) => q.eq("projectId", p._id)).first()) return null;
  const biz = await businessOf(ctx, p);
  const s = await settingsFor(ctx, biz);
  if (!s.on || !biz) return null;
  const now = Date.now();
  const keepUntil = addDays(todayCentral(now), s.keepDays);
  const id = await ctx.db.insert("footageStorage", {
    businessId: biz, projectId: p._id, ...(p.clientId ? { clientId: p.clientId } : {}), priceCents: s.priceCents, offeredAt: now, keepUntil,
    status: "offered", history: [{ at: now, text: `Offered at delivery: kept until ${longDay(keepUntil)}, ${usd(s.priceCents)}/year` }], createdAt: now, updatedAt: now,
  });
  const people = await portalPeople(ctx, p);
  for (const person of people) {
    await postToInbox(ctx, {
      businessId: biz, clientId: p.clientId, email: person.email, kind: "final_files", title: "Keep your raw footage?",
      text: `Kept until ${longDay(keepUntil)}. Keep it for ${usd(s.priceCents).replace(/\.00$/, "")}/year?`, link: `/projects/${p._id}`, linkLabel: "Choose",
      source: { module: "projects", id: p._id }, key: `footage:${id}`,
    });
  }
  if (people.length) await ctx.scheduler.runAfter(0, internal.footage.mailOffer, { storageId: id, emails: people.map((x) => x.email) });
  return id;
}

// ---------- the client ----------

async function clientRow(ctx: Ctx, projectId: string) {
  const me = await requireSignedIn(ctx);
  if (me.kind !== "client") return null;
  const id = ctx.db.normalizeId("projects", projectId);
  const row = id ? (await myProjects(ctx as QueryCtx, me.email)).get(id) : undefined;
  if (!row) return null;
  const r = await ctx.db.query("footageStorage").withIndex("by_project", (q) => q.eq("projectId", row.project._id)).first();
  return r ? { me, r, p: row.project } : null;
}

/** The Raw footage card on the client's project page (null: nothing to show). */
export const forClientProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const c = await clientRow(ctx, projectId);
    if (!c) return null;
    const { r } = c;
    const today = todayCentral();
    const open = (r.status === "offered" || r.status === "declined") && today < r.keepUntil;
    if (!open && r.status !== "kept" && r.status !== "paid") return null;
    const inv = r.invoiceId ? await ctx.db.get(r.invoiceId) : null;
    const b = c.p.businessId ? await ctx.db.get(c.p.businessId) : null;
    return {
      status: r.status, priceCents: r.priceCents, keepUntil: r.keepUntil, paidUntil: r.paidUntil ?? null,
      // Kept: the year it will cover once paid (from the keep day).
      keptUntil: r.status === "kept" ? addYear(r.keepUntil > today ? r.keepUntil : today) : r.paidUntil ?? null,
      invoiceCents: inv?.totalCents ?? r.priceCents, invoiceSent: !!inv && inv.status !== "draft", by: r.answeredBy?.name ?? null,
      business: b?.name ?? (await businessContact(ctx, c.p.businessId ?? null)).name,
    };
  },
});

/** Keep it: drafts a year's invoice for the owner to check and send (D33). Nothing is charged here. */
export const keep = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const pid = ctx.db.normalizeId("projects", projectId);
    const raw = pid ? await ctx.db.get(pid) : null;
    if (raw) focusBusiness(ctx, raw.businessId); // a client of two businesses acts for this project's
    const c = await clientRow(ctx, projectId);
    if (!c) throw new ConvexError("This isn't here any more.");
    const { r, p, me } = c;
    if (r.status === "kept" || r.status === "paid") return { already: true };
    if ((r.status !== "offered" && r.status !== "declined") || todayCentral() >= r.keepUntil) throw new ConvexError("The keep date has passed. Reply to the email and we'll see what we can do.");
    const now = Date.now();
    const name = (me.name ?? "").trim() || me.email;
    const client = p.clientId ? await ctx.db.get(p.clientId) : null;
    const until = addYear(r.keepUntil);
    const invoiceId = await draftYear(ctx, r, p, { name, email: me.email, company: client?.name }, until, r.keepUntil);
    await ctx.db.patch(r._id, { status: "kept", answeredBy: { email: me.email, name, at: now }, invoiceId, updatedAt: now, history: hist(r, `Kept by ${name}: invoice drafted`, now) });
    await ctx.scheduler.runAfter(0, internal.footage.mailOwner, { storageId: r._id, what: "kept", invoiceId });
    return { already: false };
  },
});

/** No thanks: they can still press Keep it until the keep day. */
export const decline = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const pid = ctx.db.normalizeId("projects", projectId);
    const raw = pid ? await ctx.db.get(pid) : null;
    if (raw) focusBusiness(ctx, raw.businessId);
    const c = await clientRow(ctx, projectId);
    if (!c) throw new ConvexError("This isn't here any more.");
    if (c.r.status !== "offered") return null;
    const now = Date.now();
    const name = (c.me.name ?? "").trim() || c.me.email;
    await ctx.db.patch(c.r._id, { status: "declined", answeredBy: { email: c.me.email, name, at: now }, updatedAt: now, history: hist(c.r, `No thanks from ${name}`, now) });
    return null;
  },
});

/** A year's invoice draft (first year or renewal), for the owner to check and send from Payments. */
async function draftYear(ctx: MutationCtx, r: Doc<"footageStorage">, p: Doc<"projects">, billTo: { name: string; email: string; company?: string }, until: string, dueBy: string) {
  const now = Date.now();
  const soonest = addDays(todayCentral(now), MIN_DUE_DAYS);
  const lines = [{ id: "storage", description: `Raw footage storage, one year (until ${longDay(until)}) · ${label(p)}`.slice(0, 300), qty: 1, unitCents: r.priceCents }];
  return await ctx.db.insert("invoices", {
    ...(r.businessId ? { businessId: r.businessId } : {}), projectId: p._id, ...(p.clientId ? { clientId: p.clientId } : {}), storageId: r._id,
    kind: "other", title: `Raw footage storage · ${label(p)}`.slice(0, 120),
    billTo: { name: billTo.name, email: billTo.email.toLowerCase(), ...(billTo.company ? { company: billTo.company } : {}) },
    lines, dueDate: dueBy > soonest ? dueBy : soonest, status: "draft",
    totalCents: r.priceCents, amountPaidCents: 0, amountRemainingCents: r.priceCents,
    history: [{ kind: "created", at: now, detail: `raw footage storage until ${longDay(until)}` }], createdAt: now, updatedAt: now,
  });
}

// ---------- the owner ----------

async function ownedRow(ctx: Ctx, projectId: string) {
  const id = ctx.db.normalizeId("projects", projectId);
  const p = id ? await ctx.db.get(id) : null;
  if (!p) throw new ConvexError("This project doesn't exist any more.");
  const r = await ctx.db.query("footageStorage").withIndex("by_project", (q) => q.eq("projectId", p._id)).first();
  return { p, r };
}

/** The Raw footage storage card on the project's Delivery tab. */
export const forProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("projects", projectId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) return null;
    const r = await ctx.db.query("footageStorage").withIndex("by_project", (q) => q.eq("projectId", p._id)).first();
    const s = await settingsFor(ctx, await businessOf(ctx, p));
    const client = p.clientId ? await ctx.db.get(p.clientId) : null;
    if (!r) return { storage: null, settings: s, client: client?.name ?? null, delivered: !!p.deliveryUnlockedAt };
    const inv = r.invoiceId ? await ctx.db.get(r.invoiceId) : null;
    return {
      settings: s, client: client?.name ?? null, delivered: true,
      storage: {
        _id: r._id, status: r.status, priceCents: r.priceCents, offeredAt: r.offeredAt, keepUntil: r.keepUntil, paidUntil: r.paidUntil ?? null,
        by: r.answeredBy ? { name: r.answeredBy.name, at: r.answeredBy.at } : null, endedAt: r.endedAt ?? null, doneAt: r.doneAt ?? null,
        invoice: inv ? { _id: inv._id, status: inv.status, number: inv.number ?? inv.stripe?.number ?? null, totalCents: inv.totalCents } : null,
        renewing: !!r.renewalFor && r.renewalFor === r.paidUntil,
        keptUntil: r.status === "kept" ? addYear(r.keepUntil > todayCentral() ? r.keepUntil : todayCentral()) : null,
        history: r.history.slice(-8).reverse(),
      },
    };
  },
});

/** D98: the client is sending a hard drive and the owner copied the footage to it. Stops the keep-day reminder. */
export const recordDrive = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const me = await requireMe(ctx);
    const { r } = await ownedRow(ctx, projectId);
    if (!r) throw new ConvexError("There's no raw footage offer on this project.");
    if (r.status === "drive") return null;
    if (r.status === "kept" || r.status === "paid") throw new ConvexError(r.status === "kept" ? "They pressed Keep it, so there's a storage invoice. Void or delete it first." : "They're paying to store it. Stop storing first.");
    const now = Date.now();
    await ctx.db.patch(r._id, { status: "drive", updatedAt: now, history: hist(r, `Copied to their drive (recorded by ${me.name})`, now) });
    return null;
  },
});

/** Stop storing a paid year's footage (no renewal is drafted; an unsent renewal draft is left for the owner to delete). */
export const stop = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const me = await requireMe(ctx);
    const { r } = await ownedRow(ctx, projectId);
    if (!r) throw new ConvexError("There's no raw footage offer on this project.");
    if (r.status === "stopped") return null;
    if (r.status === "kept") throw new ConvexError("There's an unpaid storage invoice. Void or delete it first.");
    const now = Date.now();
    await ctx.db.patch(r._id, { status: "stopped", updatedAt: now, history: hist(r, `Storing stopped by ${me.name}`, now) });
    return null;
  },
});

/** After the reminder: the owner deleted or moved the footage. Clears the Dashboard alert. */
export const markDone = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const me = await requireMe(ctx);
    const { r } = await ownedRow(ctx, projectId);
    if (!r) throw new ConvexError("There's no raw footage offer on this project.");
    if (r.status !== "ended" && r.status !== "drive" && r.status !== "stopped") throw new ConvexError("It's still being kept.");
    const now = Date.now();
    await ctx.db.patch(r._id, { doneAt: now, updatedAt: now, history: hist(r, `Deleted or moved (marked by ${me.name})`, now) });
    return null;
  },
});

/** Dashboard alerts (home.needs): a storage invoice draft to send, and footage past its keep day. */
export async function footageNeeds(ctx: QueryCtx) {
  const out: Array<{ kind: "footage"; at: number; what: "kept" | "renewal" | "ended"; projectId: Id<"projects">; project: string; client: string | null }> = [];
  for (const status of ["kept", "paid", "ended"] as const) {
    for (const r of await ctx.db.query("footageStorage").withIndex("by_status", (q) => q.eq("status", status)).collect()) {
      let what: "kept" | "renewal" | "ended" | null = null;
      if (status === "ended") what = r.doneAt ? null : "ended";
      else {
        const inv = r.invoiceId ? await ctx.db.get(r.invoiceId) : null;
        if (inv?.status === "draft") what = status === "kept" ? "kept" : r.renewalFor === r.paidUntil ? "renewal" : null;
      }
      if (!what) continue;
      const p = await ctx.db.get(r.projectId);
      if (!p) continue;
      out.push({ kind: "footage", at: r.updatedAt, what, projectId: p._id, project: label(p), client: p.clientId ? (await ctx.db.get(p.clientId))?.name ?? null : null });
    }
  }
  return out;
}

// ---------- the invoice's side (called from invoices.applyStripeInvoice and deleteDraft) ----------

/** A storage invoice paid: a year kept, from the keep day (first year) or the end of the last paid year (renewal). */
export async function storagePaid(ctx: MutationCtx, i: Doc<"invoices">) {
  const r = i.storageId ? await ctx.db.get(i.storageId) : null;
  if (!r || r.invoiceId !== i._id) return;
  const today = todayCentral();
  const from = r.status === "paid" && r.paidUntil ? r.paidUntil : r.keepUntil > today ? r.keepUntil : today;
  const paidUntil = addYear(from);
  const now = Date.now();
  await ctx.db.patch(r._id, { status: "paid", paidUntil, endedAt: undefined, doneAt: undefined, updatedAt: now, history: hist(r, `Paid: kept until ${longDay(paidUntil)}`, now) });
}

/** A storage invoice voided or its draft deleted: back to the offer (a renewal: the paid year still runs to its end). */
export async function storageDropped(ctx: MutationCtx, i: Doc<"invoices">, how: "voided" | "deleted") {
  const r = i.storageId ? await ctx.db.get(i.storageId) : null;
  if (!r || r.invoiceId !== i._id) return;
  const now = Date.now();
  if (r.status === "kept") await ctx.db.patch(r._id, { status: "declined", invoiceId: undefined, updatedAt: now, history: hist(r, `Storage invoice ${how}: back to not kept`, now) });
  else if (r.status === "paid") await ctx.db.patch(r._id, { invoiceId: undefined, updatedAt: now, history: hist(r, `Renewal invoice ${how}`, now) });
}

// ---------- the hourly job: keep days and renewals ----------

export const due = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayCentral();
    const ended: Id<"footageStorage">[] = [], renew: Id<"footageStorage">[] = [], lapsed: Id<"footageStorage">[] = [];
    for (const s of ["offered", "declined"] as const) {
      for (const r of await ctx.db.query("footageStorage").withIndex("by_status", (q) => q.eq("status", s)).collect()) if (r.keepUntil <= today) ended.push(r._id);
    }
    for (const r of await ctx.db.query("footageStorage").withIndex("by_status", (q) => q.eq("status", "paid")).collect()) {
      if (!r.paidUntil) continue;
      if (r.paidUntil <= today) lapsed.push(r._id);
      else if (addDays(r.paidUntil, -RENEW_DAYS) <= today && r.renewalFor !== r.paidUntil) renew.push(r._id);
    }
    return { ended, renew, lapsed };
  },
});

/** The keep day came (or a paid year ended unrenewed): mark it, once, and tell the owner. */
export const endOne = internalMutation({
  args: { storageId: v.id("footageStorage") },
  handler: async (ctx, { storageId }) => {
    const r = await ctx.db.get(storageId);
    if (!r || r.endedAt) return null;
    const today = todayCentral();
    const lapsed = r.status === "paid";
    if (lapsed ? !(r.paidUntil && r.paidUntil <= today) : !((r.status === "offered" || r.status === "declined") && r.keepUntil <= today)) return null;
    const now = Date.now();
    await ctx.db.patch(r._id, { status: "ended", endedAt: now, updatedAt: now, history: hist(r, lapsed ? "The paid year ended without renewal: owner reminded" : "Not kept: owner reminded on the keep day", now) });
    return { lapsed, day: lapsed ? r.paidUntil! : r.keepUntil };
  },
});

/** D140: 30 days before the paid year ends, next year's invoice is drafted for the owner to send. Once per year. */
export const renewOne = internalMutation({
  args: { storageId: v.id("footageStorage") },
  handler: async (ctx, { storageId }) => {
    const r = await ctx.db.get(storageId);
    if (!r || r.status !== "paid" || !r.paidUntil || r.renewalFor === r.paidUntil) return null;
    const p = await ctx.db.get(r.projectId);
    if (!p) return null;
    const who = r.answeredBy ?? (await portalPeople(ctx, p)).map((x) => ({ email: x.email, name: x.email }))[0];
    if (!who) return null;
    const client = p.clientId ? await ctx.db.get(p.clientId) : null;
    const until = addYear(r.paidUntil);
    const invoiceId = await draftYear(ctx, r, p, { name: who.name, email: who.email, company: client?.name }, until, r.paidUntil);
    const now = Date.now();
    await ctx.db.patch(r._id, { renewalFor: r.paidUntil, invoiceId, updatedAt: now, history: hist(r, `Renewal drafted (next year until ${longDay(until)})`, now) });
    return invoiceId;
  },
});

export const runDue = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ended: number; renewed: number }> => {
    const hour = Number(new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }));
    if (hour < 9) return { ended: 0, renewed: 0 };
    const d: { ended: Id<"footageStorage">[]; renew: Id<"footageStorage">[]; lapsed: Id<"footageStorage">[] } = await ctx.runQuery(internal.footage.due, {});
    let ended = 0, renewed = 0;
    for (const id of [...d.ended, ...d.lapsed]) {
      const r: { lapsed: boolean; day: string } | null = await ctx.runMutation(internal.footage.endOne, { storageId: id });
      if (r) { ended++; await ctx.runAction(internal.footage.mailEnded, { storageId: id, day: r.day, lapsed: r.lapsed }); }
    }
    for (const id of d.renew) {
      const invoiceId: Id<"invoices"> | null = await ctx.runMutation(internal.footage.renewOne, { storageId: id });
      if (invoiceId) { renewed++; await ctx.runAction(internal.footage.mailOwner, { storageId: id, what: "renewal", invoiceId }); }
    }
    return { ended, renewed };
  },
});

// ---------- emails ----------

export const mailData = internalQuery({
  args: { storageId: v.id("footageStorage") },
  handler: async (ctx, { storageId }) => {
    const r = await ctx.db.get(storageId);
    if (!r) return null;
    const p = await ctx.db.get(r.projectId);
    if (!p) return null;
    const biz = await businessOf(ctx, p);
    const client = p.clientId ? await ctx.db.get(p.clientId) : null;
    return { r, project: label(p), projectId: p._id, client: client?.name ?? "The client", biz, brand: await mailBrandOf(ctx, biz), owner: (await businessContact(ctx, biz)).ownerEmail };
  },
});

/** Email 34 to each of the project's people. */
export const mailOffer = internalAction({
  args: { storageId: v.id("footageStorage"), emails: v.array(v.string()) },
  handler: async (ctx, { storageId, emails }) => {
    const d = await ctx.runQuery(internal.footage.mailData, { storageId });
    if (!d || d.r.status !== "offered") return 0;
    let sent = 0;
    for (const email of emails) {
      const m = footageOfferMail(d.brand, { name: await ctx.runQuery(internal.shoots.nameOf, { email }), project: d.project, priceCents: d.r.priceCents, keepUntil: d.r.keepUntil, link: `${SITE()}/projects/${d.projectId}` });
      try {
        if ((await deliverOnce(ctx, `footage-offer:${storageId}:${email.toLowerCase()}`, "footage_offer", email, m, d.brand.replyTo, d.biz)) === "sent") sent++;
        await ctx.runMutation(internal.emails.markInboxEmailed, { key: `footage:${storageId}`, email });
      } catch (e) { console.error("footage email", String((e as Error).message).slice(0, 120)); }
    }
    return sent;
  },
});

/** To the owner: Keep it was pressed, or a renewal was drafted. */
export const mailOwner = internalAction({
  args: { storageId: v.id("footageStorage"), what: v.union(v.literal("kept"), v.literal("renewal")), invoiceId: v.id("invoices") },
  handler: async (ctx, { storageId, what, invoiceId }) => {
    const d = await ctx.runQuery(internal.footage.mailData, { storageId });
    if (!d?.owner) return;
    const until = what === "kept" ? addYear(d.r.keepUntil) : d.r.paidUntil ? addYear(d.r.paidUntil) : d.r.keepUntil;
    await deliverOnce(ctx, `footage-${what}:${storageId}:${invoiceId}`, what === "kept" ? "footage_kept" : "footage_renewal", d.owner, ownerFootageMail(d.brand, {
      what, who: d.r.answeredBy?.name ?? d.client, project: d.project, priceCents: d.r.priceCents, until: what === "kept" ? until : d.r.paidUntil ?? until, link: `${SITE()}/projects/${d.projectId}?tab=delivery`,
    }), d.brand.replyTo, d.biz);
  },
});

/** Email 36 to the owner on the keep day. */
export const mailEnded = internalAction({
  args: { storageId: v.id("footageStorage"), day: v.string(), lapsed: v.boolean() },
  handler: async (ctx, { storageId, day, lapsed }) => {
    const d = await ctx.runQuery(internal.footage.mailData, { storageId });
    if (!d?.owner) return;
    await deliverOnce(ctx, `footage-ended:${storageId}:${day}`, "footage_ended", d.owner, ownerFootageEndedMail(d.brand, {
      client: d.client, project: d.project, day, lapsed, link: `${SITE()}/projects/${d.projectId}?tab=delivery`,
    }), d.brand.replyTo, d.biz);
  },
});
