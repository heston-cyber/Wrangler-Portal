// Phase 2b (Oct 30): subscriptions on each business's own connected Stripe account (direct charges).
//
// How a subscription starts (Design: "Nothing is charged until {client} adds a payment method"):
//   1. The owner starts it (Payments › Subscriptions › Start). The portal makes (or reuses) the Stripe customer and
//      keeps a row waiting on the client; email 13 and, if chosen, an Inbox item link to /sub/<token>.
//   2. On that page the client saves a card or bank account (the Payment Element with a SetupIntent).
//   3. Then the portal makes the Stripe subscription with that method as the default: charged now, or nothing until the
//      start date (or the trial's end). "Now, then each period from the start date" with a later start date charges the
//      first period now (a one-off line) and the plan from the start date's next period on.
// Stripe makes an invoice each period and charges it; the portal mirrors each one into Payments › Invoices (kind
// "subscription"), so receipts (email 11, D66) and the invoice page work as for any invoice. The subscription's own
// state is read back from Stripe after each of its events (never trusting an old payload).
import { action } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, query, focusBusiness } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireMe } from "./lib/access";
import { businessInScope } from "./lib/business";
import { randomToken } from "./lib/hash";
import { SITE } from "./lib/site";
import { stripeCall, StripeError, type StripeResult } from "./lib/stripeApi";
import { businessOf, clientOfEmail, hasAccess, postToInbox } from "./lib/inbox";
import { mailBrandOf } from "./lib/mail";
import { ownerSubscriptionFailedMail, subscriptionCancelledMail, subscriptionFailedMail, subscriptionStartedMail, upcomingChargeMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { mutation } from "./lib/functions";
import { keyMode, platformKey } from "./lib/stripeApi";
import { sendEmail } from "./lib/email";
import { everyLabel, monthlyCents, priceLabel, usd, type Interval } from "./plans";
import { methodLabel } from "./invoicePay";
import { invoicePrefix } from "./lib/invoiceNumber";

const DAY = 86_400_000;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
export const subLink = (token: string) => `${SITE()}/sub/${token}`;
const label = (p: { name: string; jobNumber?: string }) => (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name);

/** 9 am US Central on a yyyy-mm-dd (the start of the business day the owner picked). */
export const startMoment = (iso: string) => Date.parse(`${iso}T09:00:00-06:00`);
export function addInterval(ms: number, interval: Interval, count: number) {
  const d = new Date(ms);
  if (interval === "day") return ms + count * DAY;
  if (interval === "week") return ms + count * 7 * DAY;
  const months = interval === "year" ? 12 * count : count;
  const day = d.getUTCDate();
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes()));
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out.getTime();
}
const dateWords = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
const todayIso = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

export type ShowStatus = "waiting" | "scheduled" | "trialing" | "active" | "past_due" | "paused" | "ending" | "canceled";

/** What the screens call it: the portal's waiting state, "Starts {date}" before a later start, "Ending" once cancelled
 *  at the period's end, and Stripe's own otherwise (unpaid counts as past due; an expired first payment as ended). */
export function showStatus(s: Doc<"subscriptions">, now = Date.now()): ShowStatus {
  if (s.status === "starting" || s.status === "incomplete" && !s.stripe?.subscriptionId) return "waiting";
  if (s.status === "incomplete") return "past_due";
  if (s.status === "canceled" || s.status === "incomplete_expired") return "canceled";
  if (s.pause || s.status === "paused") return "paused";
  if (s.cancelAtPeriodEnd) return "ending";
  if (s.status === "trialing") return !s.trialDays && startMoment(s.startDate) > now ? "scheduled" : s.trialDays ? "trialing" : "active";
  if (s.status === "past_due" || s.status === "unpaid") return "past_due";
  return "active";
}

/** The next charge: the trial's or period's end while it's going; none once it's ending, paused or over. */
export function nextCharge(s: Doc<"subscriptions">, now = Date.now()): number | null {
  const st = showStatus(s, now);
  if (st === "canceled" || st === "ending" || st === "paused") return null;
  if (st === "waiting") {
    const starts = Math.max(startMoment(s.startDate), now);
    if (s.trialDays) return starts + s.trialDays * DAY; // review fix: the trial's end, not the start date
    return s.firstInvoice === "now" || startMoment(s.startDate) <= now ? null : startMoment(s.startDate);
  }
  if (st === "past_due") return s.lastFailure?.nextTry ?? null; // when Stripe tries again (none after the last try)
  if (s.trialEnd && s.trialEnd > now) return s.trialEnd;
  return s.currentPeriodEnd ?? null;
}

// ---------- owner: start ----------

export const startTarget = internalQuery({
  args: { clientId: v.id("clients"), planId: v.id("plans"), projectId: v.optional(v.id("projects")), email: v.string() },
  handler: async (ctx, { clientId, planId, projectId, email }) => {
    const me = await requireMe(ctx);
    const bizId = businessInScope(ctx);
    const b = bizId ? await ctx.db.get(bizId) : null;
    if (!b) throw new ConvexError("Not allowed.");
    if (b.stripe?.status !== "connected") throw new ConvexError("Connect Stripe first (Settings › Payments).");
    const plan = await ctx.db.get(planId);
    if (!plan) throw new ConvexError("That plan isn't here.");
    if (plan.archivedAt) throw new ConvexError("That plan is archived. Bring it back first, or pick another.");
    if (plan.stripe.accountId !== b.stripe.accountId) throw new ConvexError("That plan belongs to a Stripe account that's no longer connected.");
    const client = await ctx.db.get(clientId);
    if (!client) throw new ConvexError("That client isn't here.");
    if (projectId) {
      const p = await ctx.db.get(projectId);
      if (!p || p.clientId !== clientId) throw new ConvexError("That project isn't this client's.");
    }
    // Reuse the Stripe customer this person already has on this account (from an invoice or another subscription).
    const lower = email.trim().toLowerCase();
    const fromInv = (await ctx.db.query("invoices").withIndex("by_bill_email", (q) => q.eq("billTo.email", lower)).collect()).find((i) => i.stripe?.accountId === b.stripe!.accountId)?.stripe?.customerId;
    const fromSub = (await ctx.db.query("subscriptions").withIndex("by_bill_email", (q) => q.eq("billTo.email", lower)).collect()).find((s) => s.stripe?.accountId === b.stripe!.accountId)?.stripe?.customerId;
    return { businessId: b._id, accountId: b.stripe.accountId, livemode: b.stripe.livemode, plan, client: { _id: client._id, name: client.name }, customerId: fromInv ?? fromSub ?? null, by: me.name ?? me.email };
  },
});

export const create = internalMutation({
  args: {
    businessId: v.id("businesses"), clientId: v.id("clients"), projectId: v.optional(v.id("projects")), planId: v.id("plans"),
    billTo: v.object({ name: v.string(), email: v.string() }), startDate: v.string(), trialDays: v.optional(v.number()), firstInvoice: v.union(v.literal("now"), v.literal("start")),
    accountId: v.string(), customerId: v.string(), livemode: v.boolean(), postInbox: v.boolean(), by: v.string(),
  },
  handler: async (ctx, a) => {
    const plan = (await ctx.db.get(a.planId))!;
    const now = Date.now();
    const id = await ctx.db.insert("subscriptions", {
      businessId: a.businessId, clientId: a.clientId, ...(a.projectId ? { projectId: a.projectId } : {}), planId: a.planId, priceId: plan.stripe.priceId,
      planName: plan.name, ...(plan.description ? { planDescription: plan.description } : {}), amountCents: plan.amountCents, interval: plan.interval, intervalCount: plan.intervalCount,
      billTo: a.billTo, status: "incomplete", startDate: a.startDate, ...(a.trialDays ? { trialDays: a.trialDays } : {}), firstInvoice: a.firstInvoice,
      payToken: randomToken(18), stripe: { accountId: a.accountId, customerId: a.customerId, livemode: a.livemode },
      history: [{ kind: "created", at: now, by: a.by, detail: `${plan.name} for ${a.billTo.name}` }], createdBy: a.by, createdAt: now, updatedAt: now,
    });
    const s = (await ctx.db.get(id))!;
    if (a.postInbox) {
      await postToInbox(ctx, {
        businessId: a.businessId, clientId: a.clientId, email: a.billTo.email, kind: "subscription", key: `subscription:${id}`,
        title: `New subscription · ${plan.name}`, text: `${priceLabel(plan.amountCents, plan.interval, plan.intervalCount)} · add a payment method to start`,
        link: `/sub/${s.payToken}`, linkLabel: "Add payment method", source: { module: "payments", id },
      });
    }
    await ctx.scheduler.runAfter(0, internal.subscriptions.sendStartedEmail, { subscriptionId: id });
    return id;
  },
});

/** Start a subscription (the owner's confirm). Nothing is charged until the client adds a payment method. */
export const start = action({
  args: {
    clientId: v.id("clients"), planId: v.id("plans"), projectId: v.optional(v.id("projects")),
    billTo: v.object({ name: v.string(), email: v.string() }), startDate: v.string(), trialDays: v.optional(v.number()),
    firstInvoice: v.union(v.literal("now"), v.literal("start")), postInbox: v.boolean(),
  },
  handler: async (ctx, a): Promise<Id<"subscriptions">> => {
    const name = a.billTo.name.trim(), email = a.billTo.email.trim().toLowerCase();
    const t = await ctx.runQuery(internal.subscriptions.startTarget, { clientId: a.clientId, planId: a.planId, projectId: a.projectId, email }); // owner only, first
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ConvexError("Who it's for needs a name and an email.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.startDate) || Number.isNaN(startMoment(a.startDate))) throw new ConvexError("Pick a start date.");
    if (a.startDate < todayIso()) throw new ConvexError("The start date can't be in the past.");
    if (startMoment(a.startDate) > Date.now() + 365 * DAY) throw new ConvexError("Start within a year.");
    const trialDays = a.trialDays ? Math.floor(a.trialDays) : 0;
    if (trialDays < 0 || trialDays > 730) throw new ConvexError("A trial can be up to 730 days.");
    const firstInvoice = trialDays ? "start" : a.firstInvoice; // a free trial always charges at its end
    // Review fix: Stripe allows the first charge at most 730 days out.
    const starts = Math.max(startMoment(a.startDate), Date.now());
    const firstAt = trialDays ? starts + trialDays * DAY : firstInvoice === "now" && starts > Date.now() + 10 * 60_000 ? addInterval(starts, t.plan.interval, t.plan.intervalCount) : starts;
    if (firstAt > Date.now() + 729 * DAY) throw new ConvexError("Stripe can't wait that long for the first charge (2 years at most). Pick an earlier start or a shorter trial.");
    let customerId = t.customerId;
    try {
      if (!customerId) {
        customerId = (await stripeCall("POST", "customers", {
          account: t.accountId, idem: `wp-subcust-${t.businessId}-${email}-${Date.now() >> 16}`,
          form: { name: `${name} (${t.client.name})`, email, metadata: { portal_business: t.businessId, portal_client: a.clientId } },
        })).id as string;
      }
    } catch (e) {
      throw new ConvexError(e instanceof StripeError ? e.message : "Couldn't reach Stripe. Try again in a minute.");
    }
    return await ctx.runMutation(internal.subscriptions.create, {
      businessId: t.businessId, clientId: a.clientId, projectId: a.projectId, planId: a.planId, billTo: { name, email }, startDate: a.startDate,
      trialDays: trialDays || undefined, firstInvoice, accountId: t.accountId, customerId: customerId!, livemode: t.livemode, postInbox: a.postInbox, by: t.by,
    });
  },
});

// ---------- email 13 ----------

export const startedEmailData = internalQuery({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, { subscriptionId }) => {
    const s = await ctx.db.get(subscriptionId);
    if (!s || showStatus(s) !== "waiting") return null;
    const starts = startMoment(s.startDate);
    const first = s.trialDays ? Math.max(starts, Date.now()) + s.trialDays * DAY : s.firstInvoice === "now" ? null : starts;
    return {
      to: s.billTo.email, name: s.billTo.name, plan: s.planName, price: usd(s.amountCents), every: everyLabel(s.interval, s.intervalCount),
      starts: dateWords(Math.max(starts, Date.now())), firstCharge: first && first > Date.now() + 3600_000 ? dateWords(first) : "When you add it",
      description: s.planDescription ?? null, link: subLink(s.payToken), brand: await mailBrandOf(ctx, s.businessId ?? null),
    };
  },
});

export const sendStartedEmail = internalAction({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, { subscriptionId }): Promise<null> => {
    const d = await ctx.runQuery(internal.subscriptions.startedEmailData, { subscriptionId });
    if (!d) return null;
    const key = `sub-started:${subscriptionId}`;
    if (!(await ctx.runMutation(internal.invoicePay.claimEmail, { key, to: d.to }))) return null;
    const m = subscriptionStartedMail(d.brand, d);
    try {
      const id = await sendEmail({ from: m.from, to: d.to, subject: m.subject, text: m.text, html: m.html, tag: "subscription", replyTo: d.brand.replyTo });
      await ctx.runMutation(internal.emails.sent, { key, resendId: id || "sent" });
      if (id !== "held") await ctx.runMutation(internal.emails.markInboxEmailed, { key: `subscription:${subscriptionId}`, email: d.to });
      await ctx.runMutation(internal.subscriptions.note, { subscriptionId, kind: id === "held" ? "email_held" : "emailed", detail: d.to });
    } catch (e) {
      await ctx.runMutation(internal.emails.unclaim, { key });
      throw e;
    }
    return null;
  },
});

export const note = internalMutation({
  args: { subscriptionId: v.id("subscriptions"), kind: v.string(), detail: v.optional(v.string()) },
  handler: async (ctx, { subscriptionId, kind, detail }) => {
    const s = await ctx.db.get(subscriptionId);
    if (s) await ctx.db.patch(subscriptionId, { history: [...s.history, { kind, at: Date.now(), ...(detail ? { detail } : {}) }].slice(-80), updatedAt: Date.now() });
  },
});

// ---------- owner: lists and detail ----------

function ownerRow(s: Doc<"subscriptions">, client: string | null, now = Date.now()) {
  return {
    _id: s._id, plan: s.planName, client, person: s.billTo.name, price: priceLabel(s.amountCents, s.interval, s.intervalCount),
    amountCents: s.amountCents, monthlyCents: monthlyCents(s.amountCents, s.interval, s.intervalCount),
    status: showStatus(s, now), nextCharge: nextCharge(s, now), trialEnd: s.trialEnd ?? null, method: s.method ?? null,
    startDate: s.startDate, endsAt: s.cancelAtPeriodEnd ? s.currentPeriodEnd ?? null : null, canceledAt: s.canceledAt ?? null,
    lastFailure: s.lastFailure ?? null, createdAt: s.createdAt,
  };
}

/** Payments › Subscriptions, with its numbers. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const subs = await ctx.db.query("subscriptions").collect();
    const names = new Map<string, string>();
    for (const s of subs) if (s.clientId && !names.has(s.clientId)) names.set(s.clientId, (await ctx.db.get(s.clientId))?.name ?? "");
    const rows = subs.sort((a, b) => b.createdAt - a.createdAt).map((s) => ownerRow(s, s.clientId ? names.get(s.clientId) ?? null : null));
    const live = rows.filter((r) => ["active", "past_due", "ending"].includes(r.status));
    return {
      rows,
      numbers: {
        active: rows.filter((r) => ["active", "trialing", "ending", "past_due"].includes(r.status)).length,
        monthlyCents: live.reduce((t, r) => t + r.monthlyCents, 0),
        pastDue: rows.filter((r) => r.status === "past_due").length,
      },
    };
  },
});

export const get = query({
  args: { subscriptionId: v.string() },
  handler: async (ctx, { subscriptionId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("subscriptions", subscriptionId);
    const s = id ? await ctx.db.get(id) : null;
    if (!s) return null;
    const client = s.clientId ? await ctx.db.get(s.clientId) : null;
    const project = s.projectId ? await ctx.db.get(s.projectId) : null;
    const invoices = (await ctx.db.query("invoices").withIndex("by_client", (q) => q.eq("clientId", s.clientId)).collect()).filter((i) => i.subscriptionId === s._id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((i) => ({ _id: i._id, number: i.number ?? i.stripe?.number ?? "", status: i.status, totalCents: i.totalCents, amountPaidCents: i.amountPaidCents, createdAt: i.createdAt, paidAt: i.paidAt ?? null, failed: !!i.lastFailure && i.status === "open" }));
    return {
      ...ownerRow(s, client?.name ?? null), clientId: s.clientId ?? null, project: project ? { _id: project._id, label: label(project) } : null,
      billTo: s.billTo, description: s.planDescription ?? null, interval: s.interval, intervalCount: s.intervalCount, firstInvoice: s.firstInvoice, trialDays: s.trialDays ?? null,
      currentPeriodStart: s.currentPeriodStart ?? null, currentPeriodEnd: s.currentPeriodEnd ?? null, pause: s.pause ?? null,
      history: s.history, invoices, link: subLink(s.payToken), stripeUrl: s.stripe?.subscriptionId ? `https://dashboard.stripe.com/${s.stripe.livemode ? "" : "test/"}subscriptions/${s.stripe.subscriptionId}` : null,
      inStripe: !!s.stripe?.subscriptionId,
    };
  },
});

// ---------- the client's page: /sub/<token> ----------

async function byToken(ctx: QueryCtx | MutationCtx, token: string) {
  if (!TOKEN.test(token)) return null;
  return await ctx.db.query("subscriptions").withIndex("by_pay_token", (q) => q.eq("payToken", token)).first();
}

async function clientView(ctx: QueryCtx, s: Doc<"subscriptions">) {
  const biz = s.businessId ? await ctx.db.get(s.businessId) : null;
  const connected = biz?.stripe?.status === "connected" && biz.stripe.accountId === s.stripe?.accountId;
  const status = showStatus(s);
  const invoices = (await ctx.db.query("invoices").withIndex("by_bill_email", (q) => q.eq("billTo.email", s.billTo.email)).collect())
    .filter((i) => i.subscriptionId === s._id && i.payToken && i.status !== "draft").sort((a, b) => b.createdAt - a.createdAt)
    .map((i) => ({ token: i.payToken!, number: i.number ?? i.stripe?.number ?? "", status: i.status, totalCents: i.totalCents, createdAt: i.createdAt, paidAt: i.paidAt ?? null }));
  return {
    token: s.payToken, plan: s.planName, description: s.planDescription ?? null, amountCents: s.amountCents, price: priceLabel(s.amountCents, s.interval, s.intervalCount),
    every: everyLabel(s.interval, s.intervalCount), status, startDate: s.startDate, nextCharge: nextCharge(s), trialEnd: s.trialEnd ?? null,
    currentPeriodStart: s.currentPeriodStart ?? null, currentPeriodEnd: s.currentPeriodEnd ?? null, endsAt: s.cancelAtPeriodEnd ? s.currentPeriodEnd ?? null : null,
    canceledAt: s.canceledAt ?? null, method: s.method ?? null, lastFailure: status === "past_due" ? s.lastFailure ?? null : null, invoices,
    // A card can be saved while the business is still connected and the plan hasn't ended.
    canSetup: !!connected && status !== "canceled",
    testMode: s.stripe ? !s.stripe.livemode : false, billTo: s.billTo,
    business: biz ? {
      name: biz.name, legalName: biz.legalName ?? null, prefix: invoicePrefix(biz.name), email: biz.replyTo ?? null, address: biz.address ?? null, privacyUrl: biz.privacyUrl ?? null,
      logoUrl: biz.logoFileId ? await ctx.storage.getUrl(biz.logoFileId) : null,
    } : { name: "", legalName: null, prefix: "", email: null, address: null, privacyUrl: null, logoUrl: null },
  };
}
export type ClientSubscription = Awaited<ReturnType<typeof clientView>>;

/** /sub/<token>: anyone with the link (from email 13), signed in or not. */
export const page = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await byToken(ctx, token);
    if (!s) return null;
    focusBusiness(ctx, s.businessId);
    return await clientView(ctx, s);
  },
});

async function signedInEmail(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  const u = userId ? await ctx.db.get(userId) : null;
  return u?.email ? String(u.email).toLowerCase() : null;
}

/** Payments › Subscriptions for a signed-in client: theirs, or their client's. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const email = await signedInEmail(ctx);
    if (!email) return [];
    const seen = new Map<string, Doc<"subscriptions">>();
    for (const s of await ctx.db.query("subscriptions").withIndex("by_bill_email", (q) => q.eq("billTo.email", email)).collect()) seen.set(s._id, s);
    for (const cp of await ctx.db.query("clientPeople").withIndex("by_email", (q) => q.eq("email", email)).collect()) {
      if (cp.removedAt) continue;
      for (const s of await ctx.db.query("subscriptions").withIndex("by_client", (q) => q.eq("clientId", cp.clientId)).collect()) seen.set(s._id, s);
    }
    const out = [];
    for (const s of [...seen.values()].sort((a, b) => b.createdAt - a.createdAt)) {
      const biz = await businessOf(ctx, s);
      if (!biz || !(await hasAccess(ctx, biz, email))) continue;
      if (s.billTo.email !== email && (!s.clientId || (await clientOfEmail(ctx, biz, email)) !== s.clientId)) continue;
      const b = await ctx.db.get(biz);
      out.push({ token: s.payToken, plan: s.planName, price: priceLabel(s.amountCents, s.interval, s.intervalCount), status: showStatus(s), nextCharge: nextCharge(s), trialEnd: s.trialEnd ?? null, method: s.method ?? null, endsAt: s.cancelAtPeriodEnd ? s.currentPeriodEnd ?? null : null, business: b?.name ?? "", businessEmail: b?.replyTo ?? null });
    }
    return out;
  },
});

// ---------- saving a payment method (and starting, or retrying) ----------

export const payTarget = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const s = await byToken(ctx, token);
    if (!s || !s.stripe) return null;
    const biz = s.businessId ? await ctx.db.get(s.businessId) : null;
    return {
      subscription: s, businessId: s.businessId ?? null, accountId: s.stripe.accountId, customerId: s.stripe.customerId,
      connected: biz?.stripe?.status === "connected" && biz.stripe.accountId === s.stripe.accountId, methods: biz?.stripe?.methods ?? ["card"],
      productId: (await ctx.db.get(s.planId))?.stripe.productId ?? null,
      planArchived: !!(await ctx.db.get(s.planId))?.archivedAt,
    };
  },
});

/** The Payment Element in setup mode: a SetupIntent for this subscription's customer on the business's account. */
export const setupStart = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ clientSecret: string; accountId: string; publishableKey: string }> => {
    const t = await ctx.runQuery(internal.subscriptions.payTarget, { token });
    if (!t) throw new ConvexError("This subscription isn't here.");
    if (!t.connected) throw new ConvexError(`This can't be set up here right now. Reply to the email from the business.`);
    if (showStatus(t.subscription) === "canceled") throw new ConvexError("This subscription has ended.");
    if (!t.subscription.stripe?.subscriptionId && t.planArchived) throw new ConvexError("This plan isn't offered any more. Reply to the email from the business.");
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY ?? "";
    if (!/^pk_(test|live)_/.test(publishableKey)) throw new ConvexError("Saving a payment method in the portal isn't switched on yet.");
    if (t.businessId) await ctx.runAction(internal.payments.ensureDomain, { businessId: t.businessId, accountId: t.accountId }).catch(() => null);
    try {
      const si = await stripeCall("POST", "setup_intents", {
        account: t.accountId,
        form: { customer: t.customerId, usage: "off_session", payment_method_types: t.methods, metadata: { portal_subscription: t.subscription._id } },
      });
      return { clientSecret: si.client_secret as string, accountId: t.accountId, publishableKey };
    } catch (e) {
      throw new ConvexError(e instanceof StripeError ? e.message : "Couldn't reach Stripe. Try again.");
    }
  },
});

/** After the client saves a method: make it the default, then start the subscription in Stripe (the first time), or
 *  put it on the subscription and retry the open invoice straight away when a payment is owed (build answer 12). */
export const setupDone = action({
  args: { token: v.string(), setupIntentId: v.string() },
  handler: async (ctx, { token, setupIntentId }): Promise<{ ok: boolean; message: string | null }> => {
    const t = await ctx.runQuery(internal.subscriptions.payTarget, { token });
    if (!t) throw new ConvexError("This subscription isn't here.");
    if (!/^seti_[A-Za-z0-9]+$/.test(setupIntentId)) throw new ConvexError("That didn't come back from Stripe.");
    const s = t.subscription;
    const account = t.accountId;
    // Review fixes: never start or charge a subscription that was cancelled, or for a business no longer connected.
    if (showStatus(s) === "canceled") throw new ConvexError("This subscription has ended. Nothing was charged.");
    if (!t.connected) throw new ConvexError("This can't be set up here right now. Reply to the email from the business.");
    if (!s.stripe?.subscriptionId && t.planArchived) throw new ConvexError("This plan isn't offered any more. Reply to the email from the business.");
    try {
      const si = await stripeCall("GET", `setup_intents/${setupIntentId}`, { account, form: { expand: ["payment_method"] } });
      if (si.customer !== t.customerId || si.metadata?.portal_subscription !== s._id) throw new ConvexError("That payment method isn't for this subscription.");
      if (si.status !== "succeeded" || !si.payment_method) throw new ConvexError(si.last_setup_error?.message ? String(si.last_setup_error.message) : "The payment method wasn't saved. Try again.");
      const pm = si.payment_method as StripeResult;
      const method = methodLabel(pm);
      await stripeCall("POST", `customers/${t.customerId}`, { account, form: { invoice_settings: { default_payment_method: pm.id } } });
      await ctx.runMutation(internal.subscriptions.note, { subscriptionId: s._id, kind: "method", detail: method });
      if (!s.stripe?.subscriptionId) {
        // Review fix: claim the row first, so two saves at once can't make two subscriptions in Stripe.
        const claim = await ctx.runMutation(internal.subscriptions.claimStart, { subscriptionId: s._id });
        if (claim !== "ok") throw new ConvexError(claim === "busy" ? "It's being set up already. Refresh in a moment." : "This subscription has ended. Nothing was charged.");
        let sub: StripeResult;
        try { sub = await stripeCall("POST", "subscriptions", { account, idem: `wp-sub-${s._id}`, form: subscriptionForm(s, pm.id as string, t.productId) }); }
        catch (e) { await ctx.runMutation(internal.subscriptions.releaseStart, { subscriptionId: s._id }); throw e; }
        await ctx.runMutation(internal.subscriptions.applyStripe, { accountId: account, object: sub, method });
        const st = String(sub.status);
        if (st === "incomplete") return { ok: false, message: await failureOf(account, sub) };
        return { ok: true, message: null };
      }
      await stripeCall("POST", `subscriptions/${s.stripe.subscriptionId}`, { account, form: { default_payment_method: pm.id } });
      const owed = (await stripeCall("GET", "invoices", { account, form: { subscription: s.stripe.subscriptionId, status: "open", limit: 3 } })).data as StripeResult[] | undefined;
      let message: string | null = null;
      for (const inv of owed ?? []) {
        try { await stripeCall("POST", `invoices/${inv.id}/pay`, { account, form: { payment_method: pm.id, off_session: true } }); }
        catch (e) { message = e instanceof StripeError ? e.message.replace(/^Stripe: /, "") : "The payment didn't go through."; }
        await ctx.scheduler.runAfter(0, internal.subscriptions.importInvoice, { accountId: account, stripeId: String(inv.id) });
      }
      const fresh = await stripeCall("GET", `subscriptions/${s.stripe.subscriptionId}`, { account });
      await ctx.runMutation(internal.subscriptions.applyStripe, { accountId: account, object: fresh, method });
      return { ok: !message, message };
    } catch (e) {
      if (e instanceof ConvexError) throw e;
      throw new ConvexError(e instanceof StripeError ? e.message.replace(/^Stripe: /, "") : "Couldn't reach Stripe. Try again.");
    }
  },
});

export const claimStart = internalMutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, { subscriptionId }) => {
    const s = await ctx.db.get(subscriptionId);
    if (!s || s.stripe?.subscriptionId) return "busy";
    if (s.status === "canceled" || s.status === "incomplete_expired") return "ended";
    if (s.status === "starting" && s.claimAt && Date.now() - s.claimAt < 2 * 60_000) return "busy";
    await ctx.db.patch(subscriptionId, { status: "starting", claimAt: Date.now() });
    return "ok";
  },
});
export const releaseStart = internalMutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, { subscriptionId }) => {
    const s = await ctx.db.get(subscriptionId);
    if (s && s.status === "starting" && !s.stripe?.subscriptionId) await ctx.db.patch(subscriptionId, { status: "incomplete", claimAt: undefined });
  },
});

/** What Stripe needs to make the subscription, from the owner's choices (see the top of this file). */
export function subscriptionForm(s: Doc<"subscriptions">, paymentMethod: string, productId: string | null, now = Date.now()): Record<string, unknown> {
  const starts = Math.max(startMoment(s.startDate), now);
  const later = starts > now + 10 * 60_000;
  const sec = (ms: number) => Math.floor(ms / 1000);
  const timing: Record<string, unknown> = {};
  if (s.trialDays) timing.trial_end = sec(starts + s.trialDays * DAY);
  else if (later && s.firstInvoice === "start") timing.trial_end = sec(starts);
  else if (later && s.firstInvoice === "now") {
    // The first period (from the start date) is paid now; the plan bills again one period after the start date.
    timing.trial_end = sec(addInterval(starts, s.interval, s.intervalCount));
    if (!productId) throw new ConvexError("This plan is missing in Stripe.");
    timing.add_invoice_items = [{ price_data: { currency: "usd", product: productId, unit_amount: s.amountCents } }];
  }
  return {
    customer: s.stripe!.customerId, items: [{ price: s.priceId }], default_payment_method: paymentMethod, collection_method: "charge_automatically",
    payment_behavior: "allow_incomplete", off_session: true, ...timing,
    metadata: { portal_subscription: s._id, portal_business: s.businessId ?? "" }, description: s.planName,
  };
}

async function failureOf(account: string, sub: StripeResult) {
  const invId = typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id;
  if (!invId) return "The first payment didn't go through.";
  try {
    const pays = await stripeCall("GET", "invoice_payments", { account, form: { invoice: invId, limit: 3, expand: ["data.payment.payment_intent"] } });
    const pi = (pays.data as StripeResult[] | undefined)?.[0]?.payment?.payment_intent as StripeResult | undefined;
    return String(pi?.last_payment_error?.message ?? "The first payment didn't go through.");
  } catch { return "The first payment didn't go through."; }
}

// ---------- Stripe's state, read back ----------

const STATUSES = ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"] as const;

/** Writes a Stripe subscription (read from Stripe itself) onto the portal's copy, with a history line for each change. */
export const applyStripe = internalMutation({
  args: { accountId: v.string(), object: v.any(), method: v.optional(v.string()) },
  handler: async (ctx, { accountId, object, method }) => {
    const o = object as StripeResult;
    const byId = o.id ? await ctx.db.query("subscriptions").withIndex("by_stripe_sub", (q) => q.eq("stripe.subscriptionId", String(o.id))).first() : null;
    const metaId = typeof o.metadata?.portal_subscription === "string" ? ctx.db.normalizeId("subscriptions", o.metadata.portal_subscription) : null;
    const s = byId ?? (metaId ? await ctx.db.get(metaId) : null);
    if (!s || s.stripe?.accountId !== accountId || (s.stripe.subscriptionId && s.stripe.subscriptionId !== o.id)) return null;
    const now = Date.now();
    const status = (STATUSES as readonly string[]).includes(o.status) ? (o.status as Doc<"subscriptions">["status"]) : s.status;
    const item = (o.items?.data as StripeResult[] | undefined)?.[0];
    const ps = Number(item?.current_period_start ?? o.current_period_start ?? 0) * 1000 || undefined;
    const pe = Number(item?.current_period_end ?? o.current_period_end ?? 0) * 1000 || undefined;
    const pause = o.pause_collection ? { at: s.pause?.at ?? now, ...(o.pause_collection.resumes_at ? { resumesAt: Number(o.pause_collection.resumes_at) * 1000 } : {}) } : undefined;
    const before = showStatus(s, now);
    const next: Doc<"subscriptions"> = {
      ...s, status, currentPeriodStart: ps, currentPeriodEnd: pe, trialEnd: o.trial_end ? Number(o.trial_end) * 1000 : undefined,
      cancelAtPeriodEnd: !!o.cancel_at_period_end, pause,
      // Review fix: when it actually ended (a cancel at the period's end isn't an end yet).
      canceledAt: status === "canceled" ? Number(o.ended_at ?? o.canceled_at ?? 0) * 1000 || s.canceledAt || now : undefined,
    };
    const after = showStatus(next, now);
    const history = [...s.history];
    if (!s.stripe.subscriptionId) history.push({ kind: "started", at: now, detail: method ? `${method} added` : "Payment method added" });
    if (before !== after && s.stripe.subscriptionId) history.push({ kind: after, at: now });
    if (after === "active" && s.lastFailure) next.lastFailure = undefined;
    await ctx.db.patch(s._id, {
      status, currentPeriodStart: ps, currentPeriodEnd: pe, trialEnd: next.trialEnd, cancelAtPeriodEnd: next.cancelAtPeriodEnd, canceledAt: next.canceledAt, pause,
      ...(after === "active" ? { lastFailure: undefined } : {}),
      ...(method ? { method } : {}),
      stripe: { ...s.stripe, subscriptionId: String(o.id) }, history: history.slice(-80), syncedAt: now, updatedAt: now,
    });
    return s._id;
  },
});

/** After any subscription event: read it from Stripe and apply it (an old or out-of-order payload never wins). */
export const sync = internalAction({
  args: { accountId: v.string(), subscriptionId: v.string() },
  handler: async (ctx, { accountId, subscriptionId }): Promise<null> => {
    const o = await stripeCall("GET", `subscriptions/${subscriptionId}`, { account: accountId, form: { expand: ["default_payment_method"] } });
    const pm = typeof o.default_payment_method === "object" && o.default_payment_method ? methodLabel(o.default_payment_method) : undefined;
    const linked = await ctx.runMutation(internal.subscriptions.applyStripe, { accountId, object: o, method: pm });
    // Review fix: a second Stripe subscription for a row already linked to another one would charge with no record
    // in the portal. Cancel it in Stripe and note it.
    if (!linked && typeof o.metadata?.portal_subscription === "string" && o.status !== "canceled") {
      const orphan = await ctx.runQuery(internal.subscriptions.isOrphan, { accountId, rowId: o.metadata.portal_subscription, subscriptionId });
      if (orphan) {
        await stripeCall("DELETE", `subscriptions/${subscriptionId}`, { account: accountId, form: { prorate: false } }).catch(() => null);
        await ctx.runMutation(internal.subscriptions.note, { subscriptionId: orphan, kind: "duplicate_cancelled", detail: subscriptionId });
      }
    }
    return null;
  },
});

export const isOrphan = internalQuery({
  args: { accountId: v.string(), rowId: v.string(), subscriptionId: v.string() },
  handler: async (ctx, { accountId, rowId, subscriptionId }) => {
    const id = ctx.db.normalizeId("subscriptions", rowId);
    const s = id ? await ctx.db.get(id) : null;
    return s && s.stripe?.accountId === accountId && s.stripe.subscriptionId && s.stripe.subscriptionId !== subscriptionId ? s._id : null;
  },
});

// ---------- each period's invoice, into Payments › Invoices ----------

export const mirrorTarget = internalQuery({
  args: { accountId: v.string(), subscriptionId: v.string(), stripeId: v.string() },
  handler: async (ctx, { accountId, subscriptionId, stripeId }) => {
    const s = await ctx.db.query("subscriptions").withIndex("by_stripe_sub", (q) => q.eq("stripe.subscriptionId", subscriptionId)).first();
    if (!s || s.stripe?.accountId !== accountId) return null;
    const have = await ctx.db.query("invoices").withIndex("by_stripe", (q) => q.eq("stripe.invoiceId", stripeId)).first();
    return { subscriptionId: s._id, have: !!have };
  },
});

export const insertMirror = internalMutation({
  args: { subscriptionId: v.id("subscriptions"), invoice: v.any() },
  handler: async (ctx, { subscriptionId, invoice }) => {
    const s = await ctx.db.get(subscriptionId);
    const o = invoice as StripeResult;
    if (!s || !s.stripe) return null;
    const have = await ctx.db.query("invoices").withIndex("by_stripe", (q) => q.eq("stripe.invoiceId", String(o.id))).first();
    if (have) return have._id;
    const now = Date.now();
    const lines = ((o.lines?.data as StripeResult[] | undefined) ?? []).map((l, n) => {
      const qty = Number(l.quantity ?? 1) || 1;
      return { id: `l${n}`, description: String(l.description ?? s.planName).slice(0, 300), qty, unitCents: Math.round(Number(l.amount ?? 0) / qty) };
    });
    const created = Number(o.created ?? now / 1000) * 1000;
    const due = new Date((o.due_date ? Number(o.due_date) * 1000 : created) - 6 * 3600_000).toISOString().slice(0, 10);
    return await ctx.db.insert("invoices", {
      businessId: s.businessId, clientId: s.clientId, ...(s.projectId ? { projectId: s.projectId } : {}), kind: "subscription", subscriptionId: s._id,
      title: s.planName, ...(o.number ? { number: String(o.number) } : {}), billTo: s.billTo, lines: lines.length ? lines : [{ id: "l0", description: s.planName, qty: 1, unitCents: Number(o.total ?? 0) }],
      dueDate: due, status: "open", totalCents: Number(o.total ?? 0), amountPaidCents: 0, amountRemainingCents: Number(o.amount_remaining ?? o.total ?? 0),
      payToken: randomToken(18), stripe: { accountId: s.stripe.accountId, invoiceId: String(o.id), customerId: s.stripe.customerId, number: o.number ?? undefined, hostedUrl: o.hosted_invoice_url ?? undefined, pdfUrl: o.invoice_pdf ?? undefined, livemode: s.stripe.livemode },
      history: [{ kind: "created", at: now, detail: `Charged automatically for ${s.planName}` }], sentAt: created, createdAt: created, updatedAt: now,
    });
  },
});

/** A subscription invoice Stripe finalized (or paid, or failed): mirror it once, then apply its state and payments. */
export const importInvoice = internalAction({
  args: { accountId: v.string(), stripeId: v.string() },
  handler: async (ctx, { accountId, stripeId }): Promise<null> => {
    const o = await stripeCall("GET", `invoices/${stripeId}`, { account: accountId });
    const subId = o.parent?.subscription_details?.subscription ?? o.subscription;
    if (!subId || o.status === "draft" || Number(o.total ?? 0) === 0) return null; // $0 invoices (trials, a later start) aren't shown
    if (o.status === "void" && !Number(o.amount_paid ?? 0)) { // review fix: a paused period's voided bill never reaches the client
      await ctx.runMutation(internal.invoices.applyStripeInvoice, { accountId, invoice: o });
      return null;
    }
    const t = await ctx.runQuery(internal.subscriptions.mirrorTarget, { accountId, subscriptionId: String(subId), stripeId });
    if (!t) return null;
    if (!t.have) await ctx.runMutation(internal.subscriptions.insertMirror, { subscriptionId: t.subscriptionId, invoice: o });
    await ctx.runMutation(internal.invoices.applyStripeInvoice, { accountId, invoice: o });
    await ctx.scheduler.runAfter(0, internal.invoicePay.sync, { accountId, stripeId });
    await ctx.scheduler.runAfter(0, internal.subscriptions.sync, { accountId, subscriptionId: String(subId) });
    return null;
  },
});


// ---------- the owner's changes (step 4): change plan, pause, resume, cancel ----------

export const changeTarget = internalQuery({
  args: { subscriptionId: v.id("subscriptions"), planId: v.optional(v.id("plans")) },
  handler: async (ctx, { subscriptionId, planId }) => {
    const me = await requireMe(ctx);
    const s = await ctx.db.get(subscriptionId);
    if (!s || !s.stripe) throw new ConvexError("That subscription isn't here.");
    const b = s.businessId ? await ctx.db.get(s.businessId) : null;
    if (b?.stripe?.status !== "connected" || b.stripe.accountId !== s.stripe.accountId) throw new ConvexError("Connect Stripe first (Settings › Payments).");
    const plan = planId ? await ctx.db.get(planId) : null;
    if (planId && (!plan || plan.archivedAt || plan.stripe.accountId !== s.stripe.accountId)) throw new ConvexError("Pick an active plan.");
    return { s, plan, by: me.name ?? me.email };
  },
});

async function itemOf(account: string, subId: string) {
  const sub = await stripeCall("GET", `subscriptions/${subId}`, { account });
  const item = (sub.items?.data as StripeResult[] | undefined)?.[0];
  if (!item) throw new ConvexError("Stripe didn't return this subscription's plan.");
  return { sub, itemId: String(item.id) };
}
const stripeMsg = (e: unknown) => new ConvexError(e instanceof StripeError ? e.message.replace(/^Stripe: /, "") : "Couldn't reach Stripe. Try again in a minute.");

/** Change plan…: Stripe's proration, shown as "Next invoice ({date})" before the owner confirms. */
export const changePreview = action({
  args: { subscriptionId: v.id("subscriptions"), planId: v.id("plans") },
  handler: async (ctx, { subscriptionId, planId }): Promise<{ amountCents: number; at: number | null }> => {
    const t = await ctx.runQuery(internal.subscriptions.changeTarget, { subscriptionId, planId });
    const s = t.s;
    if (!s.stripe?.subscriptionId) return { amountCents: t.plan!.amountCents, at: null };
    try {
      const { itemId } = await itemOf(s.stripe.accountId, s.stripe.subscriptionId);
      const inv = await stripeCall("POST", "invoices/create_preview", {
        account: s.stripe.accountId,
        form: { customer: s.stripe.customerId, subscription: s.stripe.subscriptionId, subscription_details: { items: [{ id: itemId, price: t.plan!.stripe.priceId }], proration_behavior: "create_prorations" } },
      });
      const at = inv.next_payment_attempt ?? inv.period_end ?? null;
      return { amountCents: Number(inv.amount_due ?? inv.total ?? 0), at: at ? Number(at) * 1000 : null };
    } catch (e) { throw stripeMsg(e); }
  },
});

export const noteChange = internalMutation({
  args: { subscriptionId: v.id("subscriptions"), kind: v.string(), by: v.string(), detail: v.optional(v.string()), plan: v.optional(v.id("plans")), canceledNow: v.optional(v.boolean()) },
  handler: async (ctx, { subscriptionId, kind, by, detail, plan, canceledNow }) => {
    const s = await ctx.db.get(subscriptionId);
    if (!s) return;
    const now = Date.now();
    const p = plan ? await ctx.db.get(plan) : null;
    await ctx.db.patch(subscriptionId, {
      ...(p ? { planId: p._id, priceId: p.stripe.priceId, planName: p.name, planDescription: p.description, amountCents: p.amountCents, interval: p.interval, intervalCount: p.intervalCount } : {}),
      ...(canceledNow ? { status: "canceled" as const, canceledAt: now } : {}),
      history: [...s.history, { kind, at: now, by, ...(detail ? { detail } : {}) }].slice(-80), updatedAt: now,
    });
  },
});

export const changePlan = action({
  args: { subscriptionId: v.id("subscriptions"), planId: v.id("plans") },
  handler: async (ctx, { subscriptionId, planId }): Promise<null> => {
    const t = await ctx.runQuery(internal.subscriptions.changeTarget, { subscriptionId, planId });
    const s = t.s, plan = t.plan!;
    if (s.stripe?.subscriptionId) {
      try {
        const { itemId } = await itemOf(s.stripe.accountId, s.stripe.subscriptionId);
        await stripeCall("POST", `subscriptions/${s.stripe.subscriptionId}`, { account: s.stripe.accountId, form: { items: [{ id: itemId, price: plan.stripe.priceId }], proration_behavior: "create_prorations", description: plan.name } });
      } catch (e) { throw stripeMsg(e); }
    }
    await ctx.runMutation(internal.subscriptions.noteChange, { subscriptionId, kind: "plan_changed", by: t.by, detail: `${s.planName} → ${plan.name}`, plan: plan._id });
    if (s.stripe?.subscriptionId) await ctx.runAction(internal.subscriptions.sync, { accountId: s.stripe.accountId, subscriptionId: s.stripe.subscriptionId });
    return null;
  },
});

/** Pause…: invoices made while paused are voided (build answer 15), so the client never sees a bill for a paused period. */
export const pause = action({
  args: { subscriptionId: v.id("subscriptions"), resumeOn: v.optional(v.string()) },
  handler: async (ctx, { subscriptionId, resumeOn }): Promise<null> => {
    const t = await ctx.runQuery(internal.subscriptions.changeTarget, { subscriptionId });
    const s = t.s;
    if (!s.stripe?.subscriptionId) throw new ConvexError("It hasn't started yet: nothing to pause.");
    const resumes = resumeOn ? startMoment(resumeOn) : null;
    if (resumes !== null && (Number.isNaN(resumes) || resumes < Date.now())) throw new ConvexError("Pick a resume date in the future.");
    try {
      await stripeCall("POST", `subscriptions/${s.stripe.subscriptionId}`, { account: s.stripe.accountId, form: { pause_collection: { behavior: "void", ...(resumes ? { resumes_at: Math.floor(resumes / 1000) } : {}) } } });
    } catch (e) { throw stripeMsg(e); }
    await ctx.runMutation(internal.subscriptions.noteChange, { subscriptionId, kind: "paused", by: t.by, detail: resumeOn ? `until ${dateWords(resumes!)}` : undefined });
    await ctx.runAction(internal.subscriptions.sync, { accountId: s.stripe.accountId, subscriptionId: s.stripe.subscriptionId });
    return null;
  },
});

/** Resume…: lifts a pause, or takes back a cancel at the period's end ("Keep it"). */
export const resume = action({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, { subscriptionId }): Promise<null> => {
    const t = await ctx.runQuery(internal.subscriptions.changeTarget, { subscriptionId });
    const s = t.s;
    if (!s.stripe?.subscriptionId) throw new ConvexError("It hasn't started yet.");
    try {
      await stripeCall("POST", `subscriptions/${s.stripe.subscriptionId}`, { account: s.stripe.accountId, form: s.pause ? { pause_collection: "" } : { cancel_at_period_end: false } });
    } catch (e) { throw stripeMsg(e); }
    await ctx.runMutation(internal.subscriptions.noteChange, { subscriptionId, kind: "resumed", by: t.by, detail: s.pause ? undefined : "won't end after all" });
    await ctx.runAction(internal.subscriptions.sync, { accountId: s.stripe.accountId, subscriptionId: s.stripe.subscriptionId });
    return null;
  },
});

/** Cancel subscription…: at the end of the period (no more charges), or now. Email 16 tells the client. */
export const cancel = action({
  args: { subscriptionId: v.id("subscriptions"), when: v.union(v.literal("period_end"), v.literal("now")) },
  handler: async (ctx, { subscriptionId, when }): Promise<null> => {
    const t = await ctx.runQuery(internal.subscriptions.changeTarget, { subscriptionId });
    const s = t.s;
    const now = when === "now" || !s.stripe?.subscriptionId;
    try {
      if (s.stripe?.subscriptionId) {
        if (now) await stripeCall("DELETE", `subscriptions/${s.stripe.subscriptionId}`, { account: s.stripe.accountId });
        else await stripeCall("POST", `subscriptions/${s.stripe.subscriptionId}`, { account: s.stripe.accountId, form: { cancel_at_period_end: true } });
      }
    } catch (e) { throw stripeMsg(e); }
    await ctx.runMutation(internal.subscriptions.noteChange, { subscriptionId, kind: now ? "canceled" : "ending", by: t.by, canceledNow: now });
    if (s.stripe?.subscriptionId) await ctx.runAction(internal.subscriptions.sync, { accountId: s.stripe.accountId, subscriptionId: s.stripe.subscriptionId });
    if (s.stripe?.subscriptionId || s.history.some((h) => h.kind === "emailed")) await ctx.scheduler.runAfter(0, internal.subscriptions.sendCancelled, { subscriptionId });
    return null;
  },
});

export const cancelledData = internalQuery({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, { subscriptionId }) => {
    const s = await ctx.db.get(subscriptionId);
    if (!s) return null;
    const st = showStatus(s);
    if (st !== "canceled" && st !== "ending") return null;
    return { to: s.billTo.email, name: s.billTo.name, plan: s.planName, ended: st === "canceled", ends: s.currentPeriodEnd ? dateWords(s.currentPeriodEnd) : "", link: subLink(s.payToken), brand: await mailBrandOf(ctx, s.businessId ?? null) };
  },
});

export const sendCancelled = internalAction({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, { subscriptionId }): Promise<string> => {
    const d = await ctx.runQuery(internal.subscriptions.cancelledData, { subscriptionId });
    if (!d) return "skipped";
    const r = await deliverOnce(ctx, `sub-cancelled:${subscriptionId}`, "subscription-cancelled", d.to, subscriptionCancelledMail(d.brand, d), d.brand.replyTo);
    if (r !== "already") await ctx.runMutation(internal.subscriptions.note, { subscriptionId, kind: r === "held" ? "email_held" : "emailed", detail: "cancellation" });
    return r;
  },
});

// ---------- D64: what happens when the last retry fails ----------

/** Settings › Payments: the business's choice. */
export const setFailRule = mutation({
  args: { rule: v.union(v.literal("past_due"), v.literal("cancel")) },
  handler: async (ctx, { rule }) => {
    await requireMe(ctx);
    const id = businessInScope(ctx);
    if (!id) throw new ConvexError("Not allowed.");
    await ctx.db.patch(id, { subFailRule: rule });
    return null;
  },
});

/** A client's Settings tab: use the business's choice, or override it for this client. */
export const setClientFailRule = mutation({
  args: { clientId: v.id("clients"), rule: v.union(v.literal("business"), v.literal("past_due"), v.literal("cancel")) },
  handler: async (ctx, { clientId, rule }) => {
    await requireMe(ctx);
    const c = await ctx.db.get(clientId);
    if (!c) throw new ConvexError("That client isn't here.");
    await ctx.db.patch(clientId, { subFailRule: rule === "business" ? undefined : rule });
    return null;
  },
});

export const failRules = query({
  args: { clientId: v.optional(v.id("clients")) },
  handler: async (ctx, { clientId }) => {
    await requireMe(ctx);
    const id = businessInScope(ctx);
    const b = id ? await ctx.db.get(id) : null;
    const c = clientId ? await ctx.db.get(clientId) : null;
    return { business: b?.subFailRule ?? "past_due", client: c?.subFailRule ?? "business" };
  },
});

// ---------- a failed charge: emails 15 and 17, the Inbox, and D64 ----------

export const failedData = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const i = await ctx.db.get(invoiceId);
    if (!i || i.kind !== "subscription" || !i.subscriptionId || !i.stripe) return null;
    const s = await ctx.db.get(i.subscriptionId);
    if (!s) return null;
    const b = s.businessId ? await ctx.db.get(s.businessId) : null;
    const client = s.clientId ? await ctx.db.get(s.clientId) : null;
    const owner = s.businessId ? (await ctx.db.query("memberships").collect()).filter((m) => m.businessId === s.businessId && m.role === "owner" && !m.revokedAt).sort((a, c) => a.createdAt - c.createdAt)[0]?.email ?? null : null;
    return {
      invoice: { status: i.status, processing: !!i.processing, lastFailureKey: i.lastFailure?.key ?? null, amountCents: i.amountRemainingCents, stripeId: i.stripe.invoiceId, accountId: i.stripe.accountId, paidSince: (i.payments ?? []).filter((p) => p.status !== "failed").map((p) => p.at) },
      sub: s, client: client?.name ?? s.billTo.name, owner, rule: client?.subFailRule ?? b?.subFailRule ?? "past_due",
      brand: await mailBrandOf(ctx, s.businessId ?? null),
    };
  },
});

export const markFailed = internalMutation({
  args: { subscriptionId: v.id("subscriptions"), at: v.number(), message: v.string(), invoice: v.string(), final: v.boolean(), nextTry: v.optional(v.number()) },
  handler: async (ctx, { subscriptionId, at, message, invoice, final, nextTry }) => {
    const s = await ctx.db.get(subscriptionId);
    if (!s) return;
    await ctx.db.patch(subscriptionId, { lastFailure: { at, message, invoice, ...(nextTry ? { nextTry } : {}) }, history: [...s.history, { kind: "past_due", at: Date.now(), detail: final ? `${message} (last try)` : message }].slice(-80), updatedAt: Date.now() });
    if (s.businessId) await postToInbox(ctx, {
      businessId: s.businessId, clientId: s.clientId, email: s.billTo.email, kind: "subscription", key: `subfailed:${subscriptionId}:${invoice}:${at}`,
      title: `Payment failed · ${s.planName}`, text: "Update your card so your plan keeps going.", link: `/sub/${s.payToken}`, linkLabel: "Update your card", source: { module: "payments", id: subscriptionId },
    });
  },
});

export const onFailed = internalAction({
  args: { invoiceId: v.id("invoices"), failureKey: v.string(), failureAt: v.number(), message: v.string(), attempt: v.optional(v.number()) },
  handler: async (ctx, { invoiceId, failureKey, failureAt, message, attempt = 0 }): Promise<string> => {
    const d = await ctx.runQuery(internal.subscriptions.failedData, { invoiceId });
    if (!d || d.invoice.status !== "open" || d.invoice.processing) return "skipped";
    if (d.invoice.lastFailureKey !== failureKey) return "skipped"; // a later attempt replaced it
    if (d.invoice.paidSince.some((at) => at > failureAt - 60_000)) return "skipped";
    let inv: StripeResult;
    try { inv = await stripeCall("GET", `invoices/${d.invoice.stripeId}`, { account: d.invoice.accountId }); }
    catch {
      // Review fix: Stripe not answering is never "the last try". Try again in 10 minutes (at most 6 times).
      if (attempt < 6) await ctx.scheduler.runAfter(10 * 60_000, internal.subscriptions.onFailed, { invoiceId, failureKey, failureAt, message, attempt: attempt + 1 });
      return "retry";
    }
    const s = d.sub;
    // Review fix: the very first charge (made when the client saved their card) isn't retried by Stripe, and the client
    // saw the reason on the page; no "last try", no emails, and D64 doesn't apply.
    if (inv.billing_reason === "subscription_create" || s.status === "incomplete" || s.status === "starting") return "first-charge";
    const next: number | null = inv.next_payment_attempt ? Number(inv.next_payment_attempt) * 1000 : null;
    await ctx.runMutation(internal.subscriptions.markFailed, { subscriptionId: s._id, at: failureAt, message, invoice: d.invoice.stripeId, final: next === null, nextTry: next ?? undefined });
    const link = subLink(s.payToken);
    await deliverOnce(ctx, `subfailed:${invoiceId}:${failureKey}`, "subscription-failed", s.billTo.email,
      subscriptionFailedMail(d.brand, { name: s.billTo.name, plan: s.planName, amountCents: d.invoice.amountCents, reason: message, nextTry: next ? dateWords(next) : null, link }), d.brand.replyTo);
    if (d.owner) await deliverOnce(ctx, `subfailed-owner:${invoiceId}:${failureKey}`, "subscription-failed-owner", d.owner,
      ownerSubscriptionFailedMail(d.brand, { client: d.client, plan: s.planName, amountCents: d.invoice.amountCents, reason: message, nextTry: next ? dateWords(next) : null, link: `${SITE()}/payments/subscriptions/${s._id}` }), d.brand.replyTo);
    // D64: after Stripe's last try, the owner's choice for this client (or the business's): keep it past due, or cancel.
    if (next === null && d.rule === "cancel" && s.stripe?.subscriptionId) {
      try { await stripeCall("DELETE", `subscriptions/${s.stripe.subscriptionId}`, { account: s.stripe.accountId }); } catch { return "sent"; }
      await ctx.runMutation(internal.subscriptions.noteChange, { subscriptionId: s._id, kind: "canceled", by: "Portal", detail: "after the last retry failed (your setting)", canceledNow: true });
      await ctx.scheduler.runAfter(0, internal.subscriptions.sendCancelled, { subscriptionId: s._id });
    }
    return "sent";
  },
});

// ---------- email 14 (D62): 7 days before each charge ----------

export const upcomingDue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const live = keyMode(platformKey()) === "live";
    const out = [];
    for (const s of await ctx.db.query("subscriptions").collect()) {
      if (!!s.stripe?.livemode !== live || !s.stripe?.subscriptionId) continue;
      const st = showStatus(s, now);
      if (!["active", "trialing", "scheduled"].includes(st)) continue;
      const at = nextCharge(s, now);
      if (!at || at - now > 7 * DAY || at - now <= 6 * DAY) continue;
      // Short periods (a week or less) would get the email right after the last charge; skip those.
      if ((s.interval === "day") || (s.interval === "week" && s.intervalCount < 3)) continue;
      out.push({ id: s._id, at });
    }
    return out;
  },
});

export const upcomingData = internalQuery({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, { subscriptionId }) => {
    const s = await ctx.db.get(subscriptionId);
    if (!s) return null;
    return { to: s.billTo.email, name: s.billTo.name, plan: s.planName, amountCents: s.amountCents, method: s.method ?? null, link: subLink(s.payToken), brand: await mailBrandOf(ctx, s.businessId ?? null) };
  },
});

export const runUpcoming = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    let sent = 0;
    for (const u of await ctx.runQuery(internal.subscriptions.upcomingDue, {})) {
      const d = await ctx.runQuery(internal.subscriptions.upcomingData, { subscriptionId: u.id });
      if (!d) continue;
      const r = await deliverOnce(ctx, `sub-upcoming:${u.id}:${Math.round(u.at / 60_000)}`, "subscription-upcoming", d.to, upcomingChargeMail(d.brand, { ...d, on: dateWords(u.at) }), d.brand.replyTo);
      if (r !== "already") { sent++; await ctx.runMutation(internal.subscriptions.note, { subscriptionId: u.id, kind: r === "held" ? "email_held" : "upcoming_emailed", detail: dateWords(u.at) }); }
    }
    return sent;
  },
});

export type { Id, Doc };
