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
import { footageOfferMail, ownerFootageAlertMail, ownerFootageEndedMail, ownerFootageMail } from "./lib/mails";
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

/** Was this project delivered before (a "Final files ready" Inbox item, or its pipeline card at Delivered or Paid)? */
export async function deliveredBefore(ctx: MutationCtx, projectId: Id<"projects">) {
  const item = await ctx.db.query("inboxItems").withIndex("by_key", (q) => q.gte("key", `final:${projectId}:`).lt("key", `final:${projectId};`)).first();
  if (item) return true;
  const deals = await ctx.db.query("deals").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect();
  return deals.some((d) => d.stage === "delivered" || d.stage === "paid");
}

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
      // Kept: the year starts on the day it's paid (the payment date is the renewal date), so there is no end date yet.
      keptUntil: null as string | null,
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
    const invoiceId = await draftYear(ctx, r, p, { name, email: me.email, company: client?.name }, null, r.keepUntil);
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
async function draftYear(ctx: MutationCtx, r: Doc<"footageStorage">, p: Doc<"projects">, billTo: { name: string; email: string; company?: string }, until: string | null, dueBy: string) {
  const now = Date.now();
  const soonest = addDays(todayCentral(now), MIN_DUE_DAYS);
  const lines = [{ id: "storage", description: `Raw footage storage, one year${until ? ` (until ${longDay(until)})` : " from the date paid"} · ${label(p)}`.slice(0, 300), qty: 1, unitCents: r.priceCents }];
  return await ctx.db.insert("invoices", {
    ...(r.businessId ? { businessId: r.businessId } : {}), projectId: p._id, ...(p.clientId ? { clientId: p.clientId } : {}), storageId: r._id,
    kind: "other", title: `Raw footage storage · ${label(p)}`.slice(0, 120),
    billTo: { name: billTo.name, email: billTo.email.toLowerCase(), ...(billTo.company ? { company: billTo.company } : {}) },
    lines, dueDate: dueBy > soonest ? dueBy : soonest, status: "draft",
    totalCents: r.priceCents, amountPaidCents: 0, amountRemainingCents: r.priceCents,
    history: [{ kind: "created", at: now, detail: until ? `raw footage storage until ${longDay(until)}` : "raw footage storage, one year from the date paid" }], createdAt: now, updatedAt: now,
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
        latePaid: r.latePaid ? { at: r.latePaid.at, was: r.latePaid.was } : null, unpaidAt: r.unpaidAt ?? null,
        lateChoice: await lateChoiceView(ctx as QueryCtx, r),
        keptUntil: null as string | null, // the year starts the day it's paid
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

/** Stop storing a paid year's footage: no renewal is drafted. Only while it's being paid for (review L8). */
export const stop = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const me = await requireMe(ctx);
    const { r } = await ownedRow(ctx, projectId);
    if (!r) throw new ConvexError("There's no raw footage offer on this project.");
    if (r.status === "stopped") return null;
    if (r.status === "kept") throw new ConvexError("There's an unpaid storage invoice. Void or delete it first.");
    if (r.status !== "paid") throw new ConvexError("It isn't being stored for them, so there's nothing to stop.");
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

/** Stripe dispute outcomes that leave the payment with the business (review L5). */
const SETTLED_FOR_US = ["won", "warning_closed"];

/** The day a late storage invoice was paid (Central), from the invoice's own paid time when Stripe gave one. */
async function latePaidAt(ctx: Ctx, late: NonNullable<Doc<"footageStorage">["latePaid"]>) {
  const inv = await ctx.db.get(late.invoiceId);
  return inv?.paidAt ?? late.at;
}

/** Review H1: a storage invoice paid after it ended or was stopped. The owner keeps it for another year... Q93 (Nov 4):
 *  the year runs from the day they paid, not from the button press, so the payment date stays the yearly renewal date
 *  (renewals then run on from paidUntil, as storagePaid does). No new invoice: the paid one covers the year. */
export const reinstate = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const me = await requireMe(ctx);
    const { r } = await ownedRow(ctx, projectId);
    if (!r?.latePaid) throw new ConvexError("There's no late payment to act on.");
    if (r.doneAt) throw new ConvexError("You marked the footage as deleted or moved, so it can't be kept. Refund the payment in Stripe instead.");
    // Review L5: a payment already refunded or disputed in Stripe (the charge webhooks record both on the invoice) leaves
    // nothing to keep it for. A dispute the business won (or an inquiry closed without a chargeback) keeps the money.
    const inv = await ctx.db.get(r.latePaid.invoiceId);
    if ((inv?.refundedCents ?? 0) > 0) throw new ConvexError("This invoice was refunded in Stripe, so there's nothing to keep it for.");
    if (inv?.disputed && !SETTLED_FOR_US.includes(inv.disputed.status)) throw new ConvexError("This invoice's payment was disputed in Stripe, so there's nothing to keep it for.");
    const now = Date.now();
    const paidAt = await latePaidAt(ctx, r.latePaid);
    const paidUntil = addYear(todayCentral(paidAt));
    await ctx.db.patch(r._id, {
      status: "paid", paidUntil, renewalFor: undefined, invoiceId: r.latePaid.invoiceId, latePaid: undefined, endedAt: undefined, unpaidAt: undefined,
      lateChoice: { kind: "kept", invoiceId: r.latePaid.invoiceId, paidAt, at: now, by: me.name ?? "the owner", until: paidUntil },
      updatedAt: now, history: hist(r, `Kept again by ${me.name} after the late payment: until ${longDay(paidUntil)} (a year from the day it was paid)`, now),
    });
    return { paidUntil };
  },
});
/** ...or will refund it in Stripe (Q94): marked to refund. The status stays as it was; the box shows "Marked to refund"
 *  with a link to the invoice in Stripe until Stripe reports a refund of the whole amount paid on it. The portal never
 *  refunds anything itself. Review L6: `close` (the box's "It's refunded") closes that box by hand, for a refund Stripe
 *  never reports (paid from the customer's credit balance: no charge to refund). Same owner-only guards. */
export const dismissLatePaid = mutation({
  args: { projectId: v.string(), close: v.optional(v.boolean()) },
  handler: async (ctx, { projectId, close }) => {
    const me = await requireMe(ctx);
    const { r } = await ownedRow(ctx, projectId);
    if (close) {
      const c = r?.lateChoice;
      if (!r || c?.kind !== "refund") throw new ConvexError("There's no refund box to close.");
      if (c.closedAt) return null;
      const now = Date.now();
      await ctx.db.patch(r._id, { lateChoice: { ...c, closedAt: now, closedBy: me.name ?? "the owner" }, updatedAt: now, history: hist(r, `Refund box closed by ${me.name} (refunded outside the portal's view)`, now) });
      return null;
    }
    if (!r?.latePaid) return null;
    const now = Date.now();
    const paidAt = await latePaidAt(ctx, r.latePaid);
    await ctx.db.patch(r._id, {
      latePaid: undefined,
      lateChoice: { kind: "refund", invoiceId: r.latePaid.invoiceId, paidAt, at: now, by: me.name ?? "the owner", was: r.latePaid.was, wasUntil: r.paidUntil ?? r.keepUntil },
      updatedAt: now, history: hist(r, `Marked to refund in Stripe by ${me.name} (not kept)`, now),
    });
    return null;
  },
});

/** The owner's card's banner after a late payment's choice (870:19197 Kept, 870:19547 Marked to refund), or null once it's
 *  over: a kept year that has since moved on (renewed or ended), or a refund Stripe has reported. */
async function lateChoiceView(ctx: QueryCtx, r: Doc<"footageStorage">) {
  const c = r.lateChoice;
  if (!c) return null;
  const inv = await ctx.db.get(c.invoiceId);
  // Only that invoice, on this storage row (another business's invoice id is invisible here anyway).
  if (!inv || inv.storageId !== r._id) return null;
  if (c.kind === "kept") return r.status === "paid" && r.paidUntil === c.until ? { kind: "kept" as const, until: c.until!, paidAt: c.paidAt, at: c.at } : null;
  if (c.closedAt) return null; // review L6: closed by hand
  // Review L4: closed only once Stripe reports the whole amount paid on that invoice refunded; a part refund keeps it open.
  const refundedCents = inv.refundedCents ?? 0;
  if (refundedCents > 0 && refundedCents >= inv.amountPaidCents) return null;
  // Q94: the invoice in the business's own Stripe account (test-mode dashboard in test mode), as Payments' invoice page links it.
  const stripeUrl = inv.stripe ? `https://dashboard.stripe.com/${inv.stripe.livemode ? "" : "test/"}invoices/${inv.stripe.invoiceId}` : null;
  return {
    kind: "refund" as const, paidAt: c.paidAt, at: c.at, wasUntil: c.wasUntil ?? null, invoice: { _id: inv._id, number: inv.number ?? inv.stripe?.number ?? null }, stripeUrl,
    partly: refundedCents > 0 ? { refundedCents, paidCents: inv.amountPaidCents } : null,
  };
}

type What = "kept" | "renewal" | "ended" | "unpaid" | "paidLate";
/** Dashboard alerts (home.needs): a storage invoice to send, footage past its keep day, Keep it never paid, a late payment. */
export async function footageNeeds(ctx: QueryCtx) {
  const out: Array<{ kind: "footage"; at: number; what: What; projectId: Id<"projects">; project: string; client: string | null }> = [];
  for (const status of ["kept", "paid", "ended", "stopped", "drive"] as const) {
    for (const r of await ctx.db.query("footageStorage").withIndex("by_status", (q) => q.eq("status", status)).collect()) {
      let what: What | null = null;
      if (r.latePaid) what = "paidLate";
      else if (status === "ended") what = r.doneAt ? null : "ended";
      else if (status === "kept" || status === "paid") {
        const inv = r.invoiceId ? await ctx.db.get(r.invoiceId) : null;
        if (inv?.status === "draft") what = status === "kept" ? "kept" : r.renewalFor === r.paidUntil ? "renewal" : null;
        else if (status === "kept" && r.unpaidAt && inv && inv.status !== "paid") what = "unpaid";
      }
      if (!what) continue;
      const p = await ctx.db.get(r.projectId);
      if (!p) continue;
      out.push({ kind: "footage", at: r.updatedAt, what, projectId: p._id, project: label(p), client: p.clientId ? (await ctx.db.get(p.clientId))?.name ?? null : null });
    }
  }
  return out;
}

// ---------- the invoice's side (called from invoices.applyStripeInvoice, recordSent and deleteDraft) ----------

/**
 * A storage invoice paid: a year kept, from the day it is paid (first year: the payment date becomes the renewal date,
 * Heston's answer to review question 1) or from the end of the last paid year (renewal, so the anniversary never drifts).
 * Review H1: only for the invoice the year is waiting on. Paid after the footage ended, was stopped or marked deleted,
 * nothing changes by itself: the owner is told (email and Dashboard) and decides (keep it again, or refund it).
 */
export async function storagePaid(ctx: MutationCtx, i: Doc<"invoices">) {
  const r = i.storageId ? await ctx.db.get(i.storageId) : null;
  if (!r || r.invoiceId !== i._id) return;
  const now = Date.now();
  const renewing = r.status === "paid" && !!r.paidUntil && r.renewalFor === r.paidUntil;
  if ((r.status === "kept" || renewing) && !r.doneAt) {
    const today = todayCentral(now);
    const from = renewing ? r.paidUntil! : today;
    const paidUntil = addYear(from);
    await ctx.db.patch(r._id, { status: "paid", paidUntil, endedAt: undefined, unpaidAt: undefined, updatedAt: now, history: hist(r, `Paid: kept until ${longDay(paidUntil)}`, now) });
    return;
  }
  if (r.latePaid?.invoiceId === i._id) return;
  await ctx.db.patch(r._id, { latePaid: { invoiceId: i._id, at: now, was: r.doneAt ? "deleted" : r.status }, updatedAt: now, history: hist(r, `Paid after it ${r.doneAt ? "was deleted or moved" : r.status === "stopped" ? "was stopped" : "ended"}: owner told`, now) });
  await ctx.scheduler.runAfter(0, internal.footage.mailLatePaid, { storageId: r._id, invoiceId: i._id });
}

/** A storage invoice voided or its draft deleted: back to an open offer (review L7); a renewal: the paid year still runs. */
export async function storageDropped(ctx: MutationCtx, i: Doc<"invoices">, how: "voided" | "deleted") {
  const r = i.storageId ? await ctx.db.get(i.storageId) : null;
  if (!r || r.invoiceId !== i._id) return;
  const now = Date.now();
  if (r.status === "kept") await ctx.db.patch(r._id, { status: "offered", invoiceId: undefined, answeredBy: undefined, unpaidAt: undefined, updatedAt: now, history: hist(r, `Storage invoice ${how}: back to an open offer`, now) });
  else await ctx.db.patch(r._id, { invoiceId: undefined, updatedAt: now, history: hist(r, `${r.status === "paid" ? "Renewal" : "Storage"} invoice ${how}`, now) });
}

// ---------- the hourly job: keep days, unpaid Keep it, renewals ----------

type Due = { id: Id<"footageStorage">; biz: Id<"businesses"> | null };
export const due = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayCentral();
    const ended: Due[] = [], renew: Due[] = [], unpaid: Due[] = [];
    const item = (r: Doc<"footageStorage">) => ({ id: r._id, biz: r.businessId ?? null });
    for (const s of ["offered", "declined"] as const) {
      for (const r of await ctx.db.query("footageStorage").withIndex("by_status", (q) => q.eq("status", s)).collect()) if (r.keepUntil <= today) ended.push(item(r));
    }
    for (const r of await ctx.db.query("footageStorage").withIndex("by_status", (q) => q.eq("status", "paid")).collect()) {
      if (!r.paidUntil) continue;
      if (r.paidUntil <= today) ended.push(item(r));
      else if (addDays(r.paidUntil, -RENEW_DAYS) <= today && r.renewalFor !== r.paidUntil) renew.push(item(r));
    }
    // Review M3: Keep it pressed, the invoice sent, the keep day and its due date gone by, still not paid.
    for (const r of await ctx.db.query("footageStorage").withIndex("by_status", (q) => q.eq("status", "kept")).collect()) {
      if (r.unpaidAt || r.keepUntil > today || !r.invoiceId) continue;
      const inv = await ctx.db.get(r.invoiceId);
      if (inv && (inv.status === "open" || inv.status === "uncollectible") && inv.dueDate < today) unpaid.push(item(r));
    }
    return { ended, renew, unpaid };
  },
});

/** The keep day came (or a paid year ended unrenewed): mark it, once, and tell the owner (email 36, in the same write). */
export const endOne = internalMutation({
  args: { storageId: v.id("footageStorage") },
  handler: async (ctx, { storageId }) => {
    const r = await ctx.db.get(storageId);
    if (!r || r.endedAt) return false;
    const today = todayCentral();
    const lapsed = r.status === "paid";
    if (lapsed ? !(r.paidUntil && r.paidUntil <= today) : !((r.status === "offered" || r.status === "declined") && r.keepUntil <= today)) return false;
    const now = Date.now();
    const day = lapsed ? r.paidUntil! : r.keepUntil;
    await ctx.db.patch(r._id, { status: "ended", endedAt: now, updatedAt: now, history: hist(r, lapsed ? "The paid year ended without renewal: owner reminded" : "Not kept: owner reminded on the keep day", now) });
    await ctx.scheduler.runAfter(0, internal.footage.mailEnded, { storageId, day, lapsed });
    return true;
  },
});

/** Review M3: Keep it never paid. Told once; it stays "kept" until the invoice is paid or voided. */
export const unpaidOne = internalMutation({
  args: { storageId: v.id("footageStorage") },
  handler: async (ctx, { storageId }) => {
    const r = await ctx.db.get(storageId);
    if (!r || r.status !== "kept" || r.unpaidAt || !r.invoiceId) return false;
    const now = Date.now();
    await ctx.db.patch(r._id, { unpaidAt: now, updatedAt: now, history: hist(r, "Keep it was pressed but the invoice isn't paid: owner told", now) });
    await ctx.scheduler.runAfter(0, internal.footage.mailUnpaid, { storageId });
    return true;
  },
});

/** D140: 30 days before the paid year ends, next year's invoice is drafted for the owner to send. Once per year. */
export const renewOne = internalMutation({
  args: { storageId: v.id("footageStorage") },
  handler: async (ctx, { storageId }) => {
    const r = await ctx.db.get(storageId);
    if (!r || r.status !== "paid" || !r.paidUntil || r.renewalFor === r.paidUntil) return false;
    const p = await ctx.db.get(r.projectId);
    if (!p) return false;
    // Storage turned off in Settings › Payments for this business: renewals are cancelled (the paid year still runs out).
    if (!(await settingsFor(ctx, await businessOf(ctx, p))).on) return false;
    const who = r.answeredBy ?? (await portalPeople(ctx, p)).map((x) => ({ email: x.email, name: x.email }))[0];
    if (!who) return false;
    const client = p.clientId ? await ctx.db.get(p.clientId) : null;
    const until = addYear(r.paidUntil);
    const invoiceId = await draftYear(ctx, r, p, { name: who.name, email: who.email, company: client?.name }, until, r.paidUntil);
    const now = Date.now();
    await ctx.db.patch(r._id, { renewalFor: r.paidUntil, invoiceId, updatedAt: now, history: hist(r, `Renewal drafted (next year until ${longDay(until)})`, now) });
    await ctx.scheduler.runAfter(0, internal.footage.mailOwner, { storageId, what: "renewal", invoiceId });
    return true;
  },
});

/** Each row acts for its own business (review L12); one row failing doesn't stop the rest (L1). */
export const runDue = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ended: number; renewed: number; unpaid: number }> => {
    const hour = Number(new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }));
    if (hour < 9) return { ended: 0, renewed: 0, unpaid: 0 };
    const d: { ended: Due[]; renew: Due[]; unpaid: Due[] } = await ctx.runQuery(internal.footage.due, {});
    const as = (x: Due) => ({ storageId: x.id, ...(x.biz ? { asBusiness: x.biz } : {}) });
    let ended = 0, renewed = 0, unpaid = 0;
    for (const x of d.ended) try { if (await ctx.runMutation(internal.footage.endOne, as(x))) ended++; } catch (e) { console.error("footage end", String((e as Error).message).slice(0, 120)); }
    for (const x of d.unpaid) try { if (await ctx.runMutation(internal.footage.unpaidOne, as(x))) unpaid++; } catch (e) { console.error("footage unpaid", String((e as Error).message).slice(0, 120)); }
    for (const x of d.renew) try { if (await ctx.runMutation(internal.footage.renewOne, as(x))) renewed++; } catch (e) { console.error("footage renew", String((e as Error).message).slice(0, 120)); }
    return { ended, renewed, unpaid };
  },
});

// ---------- emails ----------

/**
 * Where the owner's emails go. Review L9: a business other than Wrangler with no owner login gets none (rather than
 * falling back to Wrangler's own address, which would carry another business's client details).
 */
export async function ownerEmailFor(ctx: QueryCtx, biz: Id<"businesses"> | null) {
  const c = await businessContact(ctx, biz);
  if (c.isDefault) return c.ownerEmail;
  const owners = biz ? (await ctx.db.query("memberships").withIndex("by_business_email", (q) => q.eq("businessId", biz)).collect()).filter((m) => !m.revokedAt && m.role === "owner") : [];
  return owners.length ? c.ownerEmail : null;
}

export const mailData = internalQuery({
  args: { storageId: v.id("footageStorage") },
  handler: async (ctx, { storageId }) => {
    const r = await ctx.db.get(storageId);
    if (!r) return null;
    const p = await ctx.db.get(r.projectId);
    if (!p) return null;
    const biz = await businessOf(ctx, p);
    const client = p.clientId ? await ctx.db.get(p.clientId) : null;
    const inv = r.invoiceId ? await ctx.db.get(r.invoiceId) : null;
    return { r, project: label(p), projectId: p._id, client: client?.name ?? "The client", biz, brand: await mailBrandOf(ctx, biz), owner: await ownerEmailFor(ctx, biz), invoice: inv ? { number: inv.number ?? inv.stripe?.number ?? null, dueDate: inv.dueDate } : null };
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
        const r = await deliverOnce(ctx, `footage-offer:${storageId}:${email.toLowerCase()}`, "footage_offer", email, m, d.brand.replyTo, d.biz);
        if (r === "sent") sent++;
        if (r === "sent" || r === "held") await ctx.runMutation(internal.emails.markInboxEmailed, { key: `footage:${storageId}`, email }); // review L6
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
    await deliverOnce(ctx, `footage-${what}:${storageId}:${invoiceId}`, what === "kept" ? "footage_kept" : "footage_renewal", d.owner, ownerFootageMail(d.brand, {
      what, who: d.r.answeredBy?.name ?? d.client, project: d.project, priceCents: d.r.priceCents, until: what === "kept" ? null : d.r.paidUntil ? addYear(d.r.paidUntil) : d.r.keepUntil, link: `${SITE()}/projects/${d.projectId}?tab=delivery`,
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

/** Review M3 and H1: Keep it never paid, or a storage invoice paid after it ended. Always sent (like email 36). */
export const mailUnpaid = internalAction({
  args: { storageId: v.id("footageStorage") },
  handler: async (ctx, { storageId }) => {
    const d = await ctx.runQuery(internal.footage.mailData, { storageId });
    if (!d?.owner) return;
    await deliverOnce(ctx, `footage-unpaid:${storageId}`, "footage_ended", d.owner, ownerFootageAlertMail(d.brand, {
      what: "unpaid", client: d.client, project: d.project, number: d.invoice?.number ?? null, link: `${SITE()}/projects/${d.projectId}?tab=delivery`,
    }), d.brand.replyTo, d.biz);
  },
});
export const mailLatePaid = internalAction({
  args: { storageId: v.id("footageStorage"), invoiceId: v.id("invoices") },
  handler: async (ctx, { storageId, invoiceId }) => {
    const d = await ctx.runQuery(internal.footage.mailData, { storageId });
    if (!d?.owner) return;
    await deliverOnce(ctx, `footage-paid-late:${storageId}:${invoiceId}`, "footage_ended", d.owner, ownerFootageAlertMail(d.brand, {
      what: "paidLate", client: d.client, project: d.project, number: null, link: `${SITE()}/projects/${d.projectId}?tab=delivery`,
    }), d.brand.replyTo, d.biz);
  },
});
