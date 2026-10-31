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
import { subscriptionStartedMail } from "./lib/mails";
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
  if (st === "waiting") return s.firstInvoice === "now" || startMoment(s.startDate) <= now ? null : startMoment(s.startDate);
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
    try {
      const si = await stripeCall("GET", `setup_intents/${setupIntentId}`, { account, form: { expand: ["payment_method"] } });
      if (si.customer !== t.customerId || si.metadata?.portal_subscription !== s._id) throw new ConvexError("That payment method isn't for this subscription.");
      if (si.status !== "succeeded" || !si.payment_method) throw new ConvexError(si.last_setup_error?.message ? String(si.last_setup_error.message) : "The payment method wasn't saved. Try again.");
      const pm = si.payment_method as StripeResult;
      const method = methodLabel(pm);
      await stripeCall("POST", `customers/${t.customerId}`, { account, form: { invoice_settings: { default_payment_method: pm.id } } });
      await ctx.runMutation(internal.subscriptions.note, { subscriptionId: s._id, kind: "method", detail: method });
      if (!s.stripe?.subscriptionId) {
        const sub = await stripeCall("POST", "subscriptions", { account, idem: `wp-sub-${s._id}-${setupIntentId}`, form: subscriptionForm(s, pm.id as string, t.productId) });
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
      cancelAtPeriodEnd: !!o.cancel_at_period_end, canceledAt: o.canceled_at ? Number(o.canceled_at) * 1000 : s.canceledAt, pause,
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
    await ctx.runMutation(internal.subscriptions.applyStripe, { accountId, object: o, method: pm });
    return null;
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
    const t = await ctx.runQuery(internal.subscriptions.mirrorTarget, { accountId, subscriptionId: String(subId), stripeId });
    if (!t) return null;
    if (!t.have) await ctx.runMutation(internal.subscriptions.insertMirror, { subscriptionId: t.subscriptionId, invoice: o });
    await ctx.runMutation(internal.invoices.applyStripeInvoice, { accountId, invoice: o });
    await ctx.scheduler.runAfter(0, internal.invoicePay.sync, { accountId, stripeId });
    await ctx.scheduler.runAfter(0, internal.subscriptions.sync, { accountId, subscriptionId: String(subId) });
    return null;
  },
});

export type { Id, Doc };
