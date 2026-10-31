// Phase 2b (Oct 30): Payments › Plans. A plan is a reusable price for subscriptions: a product with one active
// price in the business's own connected Stripe account. The portal keeps a copy for its screens. Editing a plan's
// name or description updates the product; a new price or interval makes a new Stripe price (Stripe prices can't
// change), and subscriptions already on the old price keep it until the owner changes them one by one.
import { action } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMe } from "./lib/access";
import { businessInScope } from "./lib/business";
import { stripeCall, StripeError } from "./lib/stripeApi";

export type Interval = "day" | "week" | "month" | "year";
const intervalV = v.union(v.literal("day"), v.literal("week"), v.literal("month"), v.literal("year"));

/** Stripe allows at most 3 years between charges. */
const MAX: Record<Interval, number> = { day: 1095, week: 156, month: 36, year: 3 };

export const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "/ month", "/ year", "every 3 months", "every 2 weeks". */
export function everyLabel(interval: Interval, count: number) {
  if (count === 1) return `/ ${interval}`;
  return `every ${count} ${interval}s`;
}
/** "$500.00 / month" · "$1,500.00 every 3 months". */
export function priceLabel(amountCents: number, interval: Interval, count: number) {
  return `${usd(amountCents)} ${everyLabel(interval, count)}`;
}
/** "every month", "every 3 months" (the preview's line). */
export const everyWords = (interval: Interval, count: number) => (count === 1 ? `every ${interval}` : `every ${count} ${interval}s`);

/** Roughly what a plan brings in per month (for "Monthly recurring"). */
export function monthlyCents(amountCents: number, interval: Interval, count: number) {
  const months = interval === "year" ? 12 * count : interval === "month" ? count : interval === "week" ? (7 * count) / 30.4375 : count / 30.4375;
  return Math.round(amountCents / months);
}

function check(a: { name: string; amountCents: number; interval: Interval; intervalCount: number; description?: string }) {
  const name = a.name.trim();
  if (!name) throw new ConvexError("Give the plan a name.");
  if (name.length > 120) throw new ConvexError("That name is too long (120 characters at most).");
  if (!Number.isInteger(a.amountCents) || a.amountCents < 50) throw new ConvexError("The price must be at least $0.50.");
  if (a.amountCents > 99_999_999) throw new ConvexError("That price is too high for one charge.");
  if (!Number.isInteger(a.intervalCount) || a.intervalCount < 1 || a.intervalCount > MAX[a.interval]) throw new ConvexError("Stripe allows at most 3 years between charges.");
  if ((a.description ?? "").length > 500) throw new ConvexError("Keep the description under 500 characters.");
  return { name, description: (a.description ?? "").trim() || undefined };
}

// ---------- owner: list ----------

/** Payments › Plans: active and archived, with how many subscriptions use each. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const plans = await ctx.db.query("plans").collect();
    const subs = await ctx.db.query("subscriptions").collect();
    return plans.sort((a, b) => b.createdAt - a.createdAt).map((p) => {
      const mine = subs.filter((s) => s.planId === p._id);
      const live = mine.filter((s) => !["canceled", "incomplete_expired"].includes(s.status));
      return {
        _id: p._id, name: p.name, description: p.description ?? null, amountCents: p.amountCents, interval: p.interval, intervalCount: p.intervalCount,
        archived: !!p.archivedAt, price: priceLabel(p.amountCents, p.interval, p.intervalCount),
        active: live.filter((s) => s.status === "active" || s.status === "past_due").length,
        trialing: live.filter((s) => s.status === "trialing").length,
        other: live.filter((s) => !["active", "past_due", "trialing"].includes(s.status)).length,
        ended: mine.length - live.length,
      };
    });
  },
});

export const get = query({
  args: { planId: v.string() },
  handler: async (ctx, { planId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("plans", planId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) return null;
    const used = (await ctx.db.query("subscriptions").collect()).filter((s) => s.planId === p._id && !["canceled", "incomplete_expired"].includes(s.status)).length;
    return { _id: p._id, name: p.name, description: p.description ?? null, amountCents: p.amountCents, interval: p.interval, intervalCount: p.intervalCount, archived: !!p.archivedAt, used };
  },
});

// ---------- owner: save, archive ----------

/** What a save needs: the business's connected account, and the plan as it stands. */
export const saveTarget = internalQuery({
  args: { planId: v.optional(v.id("plans")) },
  handler: async (ctx, { planId }) => {
    await requireMe(ctx);
    const bizId = businessInScope(ctx);
    const b = bizId ? await ctx.db.get(bizId) : null;
    if (!b) throw new ConvexError("Not allowed.");
    if (b.stripe?.status !== "connected") throw new ConvexError("Connect Stripe first (Settings › Payments). Plans live in your Stripe account.");
    const plan = planId ? await ctx.db.get(planId) : null;
    if (planId && !plan) throw new ConvexError("That plan isn't here.");
    if (plan && plan.stripe.accountId !== b.stripe.accountId) throw new ConvexError("This plan belongs to a Stripe account that's no longer connected.");
    return { businessId: b._id, accountId: b.stripe.accountId, livemode: b.stripe.livemode, plan };
  },
});

export const store = internalMutation({
  args: {
    planId: v.optional(v.id("plans")), name: v.string(), description: v.optional(v.string()), amountCents: v.number(), interval: intervalV, intervalCount: v.number(),
    stripe: v.object({ accountId: v.string(), productId: v.string(), priceId: v.string(), livemode: v.boolean() }),
  },
  handler: async (ctx, { planId, ...a }) => {
    const now = Date.now();
    if (planId) {
      const p = await ctx.db.get(planId);
      if (!p) throw new ConvexError("That plan isn't here.");
      await ctx.db.patch(planId, { ...a, description: a.description, updatedAt: now });
      return planId;
    }
    return await ctx.db.insert("plans", { ...a, createdAt: now, updatedAt: now });
  },
});

/** New plan / Save plan: makes or updates the product and its price in the business's Stripe. */
export const save = action({
  args: { planId: v.optional(v.id("plans")), name: v.string(), description: v.optional(v.string()), amountCents: v.number(), interval: intervalV, intervalCount: v.number() },
  handler: async (ctx, a): Promise<Id<"plans">> => {
    const { name, description } = check(a);
    const t = await ctx.runQuery(internal.plans.saveTarget, { planId: a.planId });
    const account = t.accountId;
    const plan = t.plan as Doc<"plans"> | null;
    try {
      let productId = plan?.stripe.productId;
      if (!productId) {
        productId = (await stripeCall("POST", "products", { account, form: { name, ...(description ? { description } : {}), metadata: { portal_business: t.businessId } } })).id as string;
      } else {
        await stripeCall("POST", `products/${productId}`, { account, form: { name, description: description ?? "" } });
      }
      let priceId = plan?.stripe.priceId;
      const priceChanged = !plan || plan.amountCents !== a.amountCents || plan.interval !== a.interval || plan.intervalCount !== a.intervalCount;
      if (priceChanged) {
        const price = await stripeCall("POST", "prices", {
          account, form: { product: productId, currency: "usd", unit_amount: a.amountCents, recurring: { interval: a.interval, interval_count: a.intervalCount }, metadata: { portal_business: t.businessId } },
        });
        await stripeCall("POST", `products/${productId}`, { account, form: { default_price: price.id } });
        // The old price stays usable by subscriptions already on it; it just can't start new ones.
        if (priceId) await stripeCall("POST", `prices/${priceId}`, { account, form: { active: false } }).catch(() => null);
        priceId = price.id as string;
      }
      return await ctx.runMutation(internal.plans.store, {
        planId: plan?._id, name, description, amountCents: a.amountCents, interval: a.interval, intervalCount: a.intervalCount,
        stripe: { accountId: account, productId, priceId: priceId!, livemode: t.livemode },
      });
    } catch (e) {
      if (e instanceof ConvexError) throw e;
      throw new ConvexError(e instanceof StripeError ? e.message : "Couldn't reach Stripe. Try again in a minute.");
    }
  },
});

export const markArchived = internalMutation({
  args: { planId: v.id("plans"), archived: v.boolean() },
  handler: async (ctx, { planId, archived }) => {
    await ctx.db.patch(planId, archived ? { archivedAt: Date.now(), updatedAt: Date.now() } : { archivedAt: undefined, updatedAt: Date.now() });
  },
});

/** Archive (no new subscriptions; existing ones keep going) or bring back. */
export const setArchived = action({
  args: { planId: v.id("plans"), archived: v.boolean() },
  handler: async (ctx, { planId, archived }): Promise<null> => {
    const t = await ctx.runQuery(internal.plans.saveTarget, { planId });
    const p = t.plan as Doc<"plans">;
    try {
      await stripeCall("POST", `products/${p.stripe.productId}`, { account: t.accountId, form: { active: !archived } });
      if (!archived) await stripeCall("POST", `prices/${p.stripe.priceId}`, { account: t.accountId, form: { active: true } }).catch(() => null);
    } catch (e) {
      throw new ConvexError(e instanceof StripeError ? e.message : "Couldn't reach Stripe. Try again in a minute.");
    }
    await ctx.runMutation(internal.plans.markArchived, { planId, archived });
    return null;
  },
});
