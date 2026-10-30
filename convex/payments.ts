// Phase 2 Part B (D45): Settings › Payments. A business connects its own Stripe account to the portal's platform
// account (Stripe Connect, direct charges, Stripe collects its fees from the business and covers losses, the business
// keeps its full Stripe Dashboard). The portal keeps a mirror of the account's state, refreshed from Stripe on return
// from onboarding, on "Check again" and by the Connect webhook (account.updated).
import { action, httpAction } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireMe } from "./lib/access";
import { businessInScope } from "./lib/business";
import { SITE } from "./lib/site";
import { invoicePrefix } from "./lib/invoiceNumber";
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
        bankLast4: s.bankLast4 ?? null, livemode: s.livemode, connectedAt: s.connectedAt ?? null, disconnectedAt: s.disconnectedAt ?? null, checkedAt: s.checkedAt,
      } : null,
      openInvoices: 0, // Part B step 2 counts them
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
        startedAt: b.stripe?.startedAt ?? now,
        ...(status === "connected" ? { connectedAt: b.stripe?.status === "connected" ? b.stripe.connectedAt ?? now : now } : b.stripe?.connectedAt ? { connectedAt: b.stripe.connectedAt } : {}),
        ...(status === "disconnected" && b.stripe?.disconnectedAt ? { disconnectedAt: b.stripe.disconnectedAt } : {}),
        checkedAt: now,
      },
      updatedAt: now,
    });
    return status;
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

// ---------- the Connect webhook ----------

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
  const fresh = await ctx.runMutation(internal.payments.recordEvent, { eventId: String(ev.id), type: String(ev.type), account: ev.account ?? undefined, livemode: !!ev.livemode });
  if (!fresh) return new Response("already handled", { status: 200 });
  if (ev.type === "account.updated" && ev.account) {
    const businessId = await ctx.runQuery(internal.payments.businessOfAccount, { accountId: ev.account });
    if (businessId) await ctx.runMutation(internal.payments.saveAccount, { businessId, account: ev.data?.object ?? {} });
  }
  return new Response("ok", { status: 200 });
});
