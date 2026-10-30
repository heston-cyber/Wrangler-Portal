// Phase 2 Part B (D45): Settings › Payments. A business connects its own Stripe account to the portal's platform
// account (Stripe Connect, direct charges, Stripe collects its fees from the business and covers losses, the business
// keeps its full Stripe Dashboard). The portal keeps a mirror of the account's state, refreshed from Stripe on return
// from onboarding, on "Check again" and by the Connect webhook (account.updated).
import { action, httpAction } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireMe } from "./lib/access";
import { businessInScope } from "./lib/business";
import { SITE, siteHost } from "./lib/site";
import { invoicePrefix } from "./lib/invoiceNumber";
import { openCount } from "./invoices";
import { REMINDER_DEFAULTS } from "./invoiceReminders";
import { accountState, keyMode, platformKey, stripeCall, stripeSignatureOk, StripeError, type StripeResult } from "./lib/stripeApi";

function ownBusiness(ctx: unknown): Id<"businesses"> {
  const id = businessInScope(ctx);
  if (!id) throw new ConvexError("Not allowed.");
  return id;
}

/** Settings › Payments: the connection as the owner sees it. */
export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const b = await ctx.db.get(ownBusiness(ctx));
    if (!b) return null;
    const s = b.stripe;
    return {
      business: b.name,
      invoicePrefix: invoicePrefix(b.name), // D52
      // The portal's own Stripe account is set up (its key is in Convex), and in which mode.
      platform: { ready: !!platformKey(), mode: keyMode(platformKey()) },
      stripe: s ? {
        status: s.status, displayName: s.displayName ?? null, chargesEnabled: s.chargesEnabled, payoutsEnabled: s.payoutsEnabled,
        bankLast4: s.bankLast4 ?? null, livemode: s.livemode, due: s.due ?? [], disabledReason: s.disabledReason ?? null, verifying: !!s.verifying, connectedAt: s.connectedAt ?? null, disconnectedAt: s.disconnectedAt ?? null, checkedAt: s.checkedAt,
        methods: s.methods ?? null,
        // Apple Pay, Google Pay and Link on this site: null until tried.
        wallets: s.domain && s.domain.name === siteHost() ? { ok: s.domain.ok, site: s.domain.name, error: s.domain.error ?? null } : null,
      } : null,
      reminders: b.reminders ?? REMINDER_DEFAULTS, // D51: off until the owner turns them on
      openInvoices: await openCount(ctx),
    };
  },
});

// ---------- connecting ----------

export const accountOf = internalQuery({
  args: {},
  handler: async (ctx) => {
    const b = await ctx.db.get(ownBusiness(ctx));
    return b ? { businessId: b._id, name: b.name, accountId: b.stripe?.accountId ?? null, status: b.stripe?.status ?? null } : null;
  },
});

export const ownerEmail = internalQuery({
  args: {},
  handler: async (ctx) => (await requireMe(ctx)).email,
});

/** "Connect Stripe" / "Finish on Stripe" / "Connect Stripe again": makes the business's connected account the first
 *  time, then sends the owner to Stripe's own onboarding pages, which return to Settings › Payments. */
export const connect = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const email: string = await ctx.runQuery(internal.payments.ownerEmail, {});
    const me = await ctx.runQuery(internal.payments.accountOf, {});
    if (!me) throw new ConvexError("Not allowed.");
    let accountId = me.accountId;
    if (me.status === "disconnected") await ctx.runMutation(internal.payments.reconnect, { businessId: me.businessId });
    try {
      if (!accountId) {
        const a = await stripeCall("POST", "accounts", {
          form: {
            email,
            business_profile: { name: me.name },
            controller: { fees: { payer: "account" }, losses: { payments: "stripe" }, requirement_collection: "stripe", stripe_dashboard: { type: "full" } },
            metadata: { portal_business: me.businessId },
          },
          idem: `wp-acct-${me.businessId}`,
        });
        accountId = a.id as string;
        await ctx.runMutation(internal.payments.saveAccount, { businessId: me.businessId, account: a, started: true });
      }
      const back = `${SITE()}/settings/payments`;
      const link = await stripeCall("POST", "account_links", { form: { account: accountId, refresh_url: `${back}?stripe=retry`, return_url: `${back}?stripe=back`, type: "account_onboarding" } });
      return { url: link.url as string };
    } catch (e) {
      throw new ConvexError(e instanceof StripeError ? e.message : "Couldn't reach Stripe. Try again in a minute.");
    }
  },
});

/** "Check again" (and the return from Stripe): reads the account from Stripe and updates the mirror. */
export const refresh = action({
  args: {},
  handler: async (ctx): Promise<{ status: string } | null> => {
    await ctx.runQuery(internal.payments.ownerEmail, {});
    const me = await ctx.runQuery(internal.payments.accountOf, {});
    if (!me?.accountId) return null;
    try {
      const a = await stripeCall("GET", `accounts/${me.accountId}?expand[]=external_accounts`);
      return { status: await ctx.runMutation(internal.payments.saveAccount, { businessId: me.businessId, account: a }) };
    } catch (e) {
      throw new ConvexError(e instanceof StripeError ? e.message : "Couldn't reach Stripe. Try again in a minute.");
    }
  },
});

/** Re-reads a business's account from Stripe (from the webhook, so no one is signed in). */
export const refreshFor = internalAction({
  args: { businessId: v.id("businesses"), accountId: v.string() },
  handler: async (ctx, { businessId, accountId }) => {
    const a = await stripeCall("GET", `accounts/${accountId}?expand[]=external_accounts`);
    await ctx.runMutation(internal.payments.saveAccount, { businessId, account: a });
  },
});

/** Writes Stripe's account state onto the business. A business that disconnected stays disconnected until it
 *  connects again (connect() passes started). Returns the status. */
export const saveAccount = internalMutation({
  args: { businessId: v.id("businesses"), account: v.any(), started: v.optional(v.boolean()) },
  handler: async (ctx, { businessId, account, started }) => {
    const b = await ctx.db.get(businessId);
    if (!b) return "missing";
    const a = account as StripeResult;
    if (b.stripe && b.stripe.accountId !== a.id) return b.stripe.status; // not this business's account
    const st = accountState(a);
    const now = Date.now();
    const wasOff = b.stripe?.status === "disconnected";
    const status = wasOff && !started ? "disconnected" : st.status;
    await ctx.db.patch(businessId, {
      stripe: {
        accountId: a.id as string, status,
        chargesEnabled: st.chargesEnabled, payoutsEnabled: st.payoutsEnabled, detailsSubmitted: st.detailsSubmitted,
        ...((st.displayName ?? b.stripe?.displayName) ? { displayName: st.displayName ?? b.stripe?.displayName } : {}),
        ...((st.bankLast4 ?? b.stripe?.bankLast4) ? { bankLast4: st.bankLast4 ?? b.stripe?.bankLast4 } : {}), livemode: st.livemode,
        due: st.due, ...(st.disabledReason ? { disabledReason: st.disabledReason } : {}), verifying: st.verifying,
        // account.updated events may leave capabilities out; keep what was known then.
        methods: (account as StripeResult).capabilities ? st.methods : b.stripe?.methods ?? st.methods,
        ...(b.stripe?.domain && b.stripe.accountId === a.id ? { domain: b.stripe.domain } : {}),
        startedAt: b.stripe?.startedAt ?? now,
        ...(status === "connected" ? { connectedAt: b.stripe?.status === "connected" ? b.stripe.connectedAt ?? now : now } : b.stripe?.connectedAt ? { connectedAt: b.stripe.connectedAt } : {}),
        ...(status === "disconnected" && b.stripe?.disconnectedAt ? { disconnectedAt: b.stripe.disconnectedAt } : {}),
        checkedAt: now,
      },
      updatedAt: now,
    });
    const d = b.stripe?.accountId === a.id ? b.stripe?.domain : undefined;
    if (status === "connected" && !(d?.ok && d.name === siteHost())) await ctx.scheduler.runAfter(0, internal.payments.ensureDomain, { businessId, accountId: a.id as string });
    return status;
  },
});

// ---------- Apple Pay, Google Pay and Link on the portal's Pay page ----------

/** Registers the portal's address on the business's connected account (direct charges: the account that takes the
 *  payment registers the domain; Stripe handles Apple's merchant validation). Safe to repeat; never throws. */
export const ensureDomain = internalAction({
  args: { businessId: v.id("businesses"), accountId: v.string() },
  handler: async (ctx, { businessId, accountId }) => {
    const name = siteHost();
    try {
      const list = await stripeCall("GET", "payment_method_domains", { account: accountId, form: { domain_name: name, limit: 1 } });
      let d = (list.data as StripeResult[] | undefined)?.[0];
      if (!d) d = await stripeCall("POST", "payment_method_domains", { account: accountId, idem: `wp-pmd-${accountId}-${name}`, form: { domain_name: name, enabled: true } });
      else if (!d.enabled) d = await stripeCall("POST", `payment_method_domains/${d.id}`, { account: accountId, form: { enabled: true } });
      const applePay = d.apple_pay?.status ? String(d.apple_pay.status) : undefined;
      const err = d.apple_pay?.status_details?.error_message ? String(d.apple_pay.status_details.error_message) : undefined;
      await ctx.runMutation(internal.payments.noteDomain, { businessId, accountId, domain: { name, at: Date.now(), ok: !!d.enabled, ...(applePay ? { applePay } : {}), ...(err ? { error: err } : {}) } });
    } catch (e) {
      const error = e instanceof StripeError ? e.message : "Couldn't reach Stripe.";
      await ctx.runMutation(internal.payments.noteDomain, { businessId, accountId, domain: { name, at: Date.now(), ok: false, error } });
    }
  },
});

export const noteDomain = internalMutation({
  args: { businessId: v.id("businesses"), accountId: v.string(), domain: v.object({ name: v.string(), at: v.number(), ok: v.boolean(), applePay: v.optional(v.string()), error: v.optional(v.string()) }) },
  handler: async (ctx, { businessId, accountId, domain }) => {
    const b = await ctx.db.get(businessId);
    if (!b?.stripe || b.stripe.accountId !== accountId) return;
    await ctx.db.patch(businessId, { stripe: { ...b.stripe, domain } });
  },
});

/** "Connect Stripe again" from a disconnected business: reconnecting reuses its account (connect() checks it). */
export const reconnect = internalMutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, { businessId }) => {
    const b = await ctx.db.get(businessId);
    if (b?.stripe?.status === "disconnected") await ctx.db.patch(businessId, { stripe: { ...b.stripe, status: "pending", disconnectedAt: undefined } });
  },
});

/** Disconnect: the portal stops taking payments for this business. Nothing changes in its Stripe account; invoices and
 *  payment history stay. Connecting again picks the same account up. */
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const b = await ctx.db.get(ownBusiness(ctx));
    if (!b?.stripe) return null;
    await ctx.db.patch(b._id, { stripe: { ...b.stripe, status: "disconnected", disconnectedAt: Date.now() }, updatedAt: Date.now() });
    return null;
  },
});

/** Stripe says the business removed the portal's access (account.application.deauthorized): shown as disconnected. */
export const markRemoved = internalMutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, { businessId }) => {
    const b = await ctx.db.get(businessId);
    if (b?.stripe && b.stripe.status !== "disconnected") await ctx.db.patch(businessId, { stripe: { ...b.stripe, status: "disconnected", chargesEnabled: false, disconnectedAt: Date.now() }, updatedAt: Date.now() });
  },
});

// ---------- the Connect webhook ----------

export const seenEvent = internalQuery({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => !!(await ctx.db.query("stripeEvents").withIndex("by_event", (q) => q.eq("eventId", eventId)).first()),
});

export const recordEvent = internalMutation({
  args: { eventId: v.string(), type: v.string(), account: v.optional(v.string()), livemode: v.boolean() },
  handler: async (ctx, a) => {
    if (await ctx.db.query("stripeEvents").withIndex("by_event", (q) => q.eq("eventId", a.eventId)).first()) return false;
    await ctx.db.insert("stripeEvents", { ...a, receivedAt: Date.now() });
    return true;
  },
});

export const businessOfAccount = internalQuery({
  args: { accountId: v.string() },
  handler: async (ctx, { accountId }) => (await ctx.db.query("businesses").withIndex("by_stripe_account", (q) => q.eq("stripe.accountId", accountId)).first())?._id ?? null,
});

/** POST /stripe/connect: Stripe's events from connected accounts. The signature is checked against
 *  STRIPE_CONNECT_WEBHOOK_SECRET; each event is handled once. */
export const connectWebhook = httpAction(async (ctx, req) => {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  const body = await req.text();
  if (!secret || !(await stripeSignatureOk(body, req.headers.get("stripe-signature"), secret))) return new Response("bad signature", { status: 400 });
  let ev: StripeResult;
  try { ev = JSON.parse(body); } catch { return new Response("bad body", { status: 400 }); }
  // Review fix (Oct 30): the event is recorded as handled only once it has been handled, so if anything below fails
  // (a 500), Stripe's retry does the work instead of being told "already handled". Every step below is safe to repeat.
  if (await ctx.runQuery(internal.payments.seenEvent, { eventId: String(ev.id) })) return new Response("already handled", { status: 200 });
  if (ev.type === "account.updated" && ev.account) {
    const businessId = await ctx.runQuery(internal.payments.businessOfAccount, { accountId: ev.account });
    if (businessId) await ctx.runMutation(internal.payments.saveAccount, { businessId, account: ev.data?.object ?? {} });
  }
  // Invoices: Stripe's status and amounts onto the portal's copy.
  const INVOICE_EVENTS = ["invoice.finalized", "invoice.updated", "invoice.paid", "invoice.payment_failed", "invoice.voided", "invoice.marked_uncollectible", "invoice.payment_succeeded", "invoice.overdue"];
  if (INVOICE_EVENTS.includes(ev.type) && ev.account && ev.data?.object) {
    const mine = await ctx.runMutation(internal.invoices.applyStripeInvoice, { accountId: ev.account, invoice: ev.data.object, eventType: ev.type });
    // Then read the invoice and its payments back from Stripe itself (method, processing, the reason), so an old or
    // out-of-order payload never has the last word.
    if (mine) {
      await ctx.scheduler.runAfter(0, internal.invoicePay.sync, { accountId: ev.account, stripeId: String(ev.data.object.id) });
    }
  }
  // Step 4c: refunds and disputes, onto the invoice they belong to.
  if ((ev.type === "charge.refunded" || ev.type === "charge.dispute.created" || ev.type === "charge.dispute.closed") && ev.account && ev.data?.object) {
    await ctx.runMutation(internal.invoicePay.applyChargeEvent, { accountId: ev.account, type: ev.type, object: ev.data.object });
  }
  if (ev.type === "invoice.deleted" && ev.account && ev.data?.object?.id) {
    await ctx.runMutation(internal.invoices.stripeInvoiceDeleted, { accountId: ev.account, stripeId: String(ev.data.object.id) });
  }
  // A new or changed payout bank: read the account again so Settings shows the right last four digits.
  if ((ev.type === "account.external_account.created" || ev.type === "account.external_account.updated") && ev.account) {
    const businessId = await ctx.runQuery(internal.payments.businessOfAccount, { accountId: ev.account });
    if (businessId) await ctx.scheduler.runAfter(0, internal.payments.refreshFor, { businessId, accountId: ev.account });
  }
  // The business removed the portal from inside its own Stripe dashboard: the portal can't act for it any more.
  if (ev.type === "account.application.deauthorized" && ev.account) {
    const businessId = await ctx.runQuery(internal.payments.businessOfAccount, { accountId: ev.account });
    if (businessId) await ctx.runMutation(internal.payments.markRemoved, { businessId });
  }
  await ctx.runMutation(internal.payments.recordEvent, { eventId: String(ev.id), type: String(ev.type), account: ev.account ?? undefined, livemode: !!ev.livemode });
  return new Response("ok", { status: 200 });
});
