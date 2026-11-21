// Nov 21 (Heston: "access to the Stripe product library so I can save, edit, and use pre-made inventory items";
// approved 11:00). Payments › Products: one-time products, each with one active price, in the business's own connected
// Stripe account. Products already made in Stripe's dashboard are brought in. Picked into an invoice or quote as a
// line; unchanged, the invoice bills Stripe's price (so Stripe's product reports count it). Plans (recurring prices)
// stay on Payments › Plans. Built like plans.ts.
import { action } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAll } from "./lib/access";
import { businessInScope } from "./lib/business";
import { stripeCall, StripeError, type StripeResult } from "./lib/stripeApi";

function check(a: { name: string; amountCents: number; description?: string }) {
  const name = a.name.trim();
  if (!name) throw new ConvexError("Give the product a name.");
  if (name.length > 120) throw new ConvexError("That name is too long (120 characters at most).");
  if (!Number.isInteger(a.amountCents) || a.amountCents < 0) throw new ConvexError("The price can't be below $0.");
  if (a.amountCents > 99_999_999) throw new ConvexError("That price is too high for one line.");
  if ((a.description ?? "").length > 500) throw new ConvexError("Keep the description under 500 characters.");
  return { name, description: (a.description ?? "").trim() || undefined };
}

const view = (p: Doc<"products">) => ({ _id: p._id, name: p.name, description: p.description ?? null, amountCents: p.amountCents, archived: !!p.archivedAt });

// ---------- lists ----------

/** Payments › Products: active and archived, by name. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "payments");
    const b = await ctx.db.get(businessInScope(ctx)!);
    const mine = (await ctx.db.query("products").collect()).filter((p) => !b?.stripe || p.stripe.accountId === b.stripe.accountId);
    return mine.sort((a, b) => a.name.localeCompare(b.name)).map(view);
  },
});

/** The library picker on an invoice or quote: the active ones, with what a line needs. */
export const picker = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "payments");
    const b = await ctx.db.get(businessInScope(ctx)!);
    if (b?.stripe?.status !== "connected") return [];
    const rows = (await ctx.db.query("products").collect()).filter((p) => !p.archivedAt && p.stripe.accountId === b.stripe!.accountId);
    return rows.sort((a, c) => a.name.localeCompare(c.name)).map((p) => ({ ...view(p), priceId: p.stripe.priceId }));
  },
});

export const get = query({
  args: { productId: v.string() },
  handler: async (ctx, { productId }) => {
    await requireAll(ctx, "payments");
    const id = ctx.db.normalizeId("products", productId);
    const p = id ? await ctx.db.get(id) : null;
    return p ? view(p) : null;
  },
});

// ---------- save, archive ----------

export const saveTarget = internalQuery({
  args: { productId: v.optional(v.id("products")) },
  handler: async (ctx, { productId }) => {
    await requireAll(ctx, "payments");
    const bizId = businessInScope(ctx);
    const b = bizId ? await ctx.db.get(bizId) : null;
    if (!b) throw new ConvexError("Not allowed.");
    if (b.stripe?.status !== "connected") throw new ConvexError("Connect Stripe first (Settings › Payments). Products live in your Stripe account.");
    const product = productId ? await ctx.db.get(productId) : null;
    if (productId && !product) throw new ConvexError("That product isn't here.");
    if (product && product.stripe.accountId !== b.stripe.accountId) throw new ConvexError("This product belongs to a Stripe account that's no longer connected.");
    return { businessId: b._id, accountId: b.stripe.accountId, livemode: b.stripe.livemode, product };
  },
});

export const store = internalMutation({
  args: {
    productId: v.optional(v.id("products")), name: v.string(), description: v.optional(v.string()), amountCents: v.number(),
    stripe: v.object({ accountId: v.string(), productId: v.string(), priceId: v.string(), livemode: v.boolean() }),
  },
  handler: async (ctx, { productId, ...a }) => {
    await requireAll(ctx, "payments");
    const now = Date.now();
    if (productId) {
      if (!(await ctx.db.get(productId))) throw new ConvexError("That product isn't here.");
      await ctx.db.patch(productId, { ...a, description: a.description, updatedAt: now });
      return productId;
    }
    return await ctx.db.insert("products", { ...a, createdAt: now, updatedAt: now });
  },
});

/** New product / Save product: makes or updates the product and its one-time price in the business's Stripe. A new
 *  price replaces the old one (Stripe prices can't change); the old one is retired. */
export const save = action({
  args: { productId: v.optional(v.id("products")), name: v.string(), description: v.optional(v.string()), amountCents: v.number() },
  handler: async (ctx, a): Promise<Id<"products">> => {
    const { name, description } = check(a);
    const t = await ctx.runQuery(internal.products.saveTarget, { productId: a.productId });
    const account = t.accountId;
    const product = t.product as Doc<"products"> | null;
    try {
      let productId = product?.stripe.productId;
      if (!productId) {
        productId = (await stripeCall("POST", "products", { account, form: { name, ...(description ? { description } : {}), metadata: { portal_business: t.businessId, portal_kind: "item" } } })).id as string;
      } else {
        await stripeCall("POST", `products/${productId}`, { account, form: { name, description: description ?? "" } });
      }
      let priceId = product?.stripe.priceId;
      if (!product || product.amountCents !== a.amountCents) {
        const price = await stripeCall("POST", "prices", { account, form: { product: productId, currency: "usd", unit_amount: a.amountCents, metadata: { portal_business: t.businessId } } });
        if (typeof price.id !== "string") throw new StripeError("Stripe didn't say which price it made.", 200, "unclear");
        await stripeCall("POST", `products/${productId}`, { account, form: { default_price: price.id } });
        // Lines already on drafts keep the old price's amount; at send they're billed as plain lines (see invoices.ts).
        if (priceId) await stripeCall("POST", `prices/${priceId}`, { account, form: { active: false } }).catch(() => null);
        priceId = price.id;
      }
      return await ctx.runMutation(internal.products.store, { productId: product?._id, name, description, amountCents: a.amountCents, stripe: { accountId: account, productId, priceId: priceId!, livemode: t.livemode } });
    } catch (e) {
      if (e instanceof ConvexError) throw e;
      throw new ConvexError(e instanceof StripeError ? e.message : "Couldn't reach Stripe. Try again in a minute.");
    }
  },
});

export const markArchived = internalMutation({
  args: { productId: v.id("products"), archived: v.boolean() },
  handler: async (ctx, { productId, archived }) => {
    await requireAll(ctx, "payments");
    await ctx.db.patch(productId, archived ? { archivedAt: Date.now(), updatedAt: Date.now() } : { archivedAt: undefined, updatedAt: Date.now() });
  },
});

/** Archive (off the picker; invoices already made keep it) or bring back. */
export const setArchived = action({
  args: { productId: v.id("products"), archived: v.boolean() },
  handler: async (ctx, { productId, archived }): Promise<null> => {
    const t = await ctx.runQuery(internal.products.saveTarget, { productId });
    const p = t.product as Doc<"products">;
    try {
      await stripeCall("POST", `products/${p.stripe.productId}`, { account: t.accountId, form: { active: !archived } });
      if (!archived) await stripeCall("POST", `prices/${p.stripe.priceId}`, { account: t.accountId, form: { active: true } }).catch(() => null);
    } catch (e) {
      throw new ConvexError(e instanceof StripeError ? e.message : "Couldn't reach Stripe. Try again in a minute.");
    }
    await ctx.runMutation(internal.products.markArchived, { productId, archived });
    return null;
  },
});

// ---------- bring in what's in Stripe ----------

export const upsertFromStripe = internalMutation({
  args: { accountId: v.string(), livemode: v.boolean(), items: v.array(v.object({ productId: v.string(), priceId: v.string(), name: v.string(), description: v.optional(v.string()), amountCents: v.number(), active: v.boolean() })) },
  handler: async (ctx, { accountId, livemode, items }) => {
    await requireAll(ctx, "payments");
    const now = Date.now();
    let added = 0;
    for (const it of items) {
      const row = await ctx.db.query("products").withIndex("by_product", (q) => q.eq("stripe.productId", it.productId)).first();
      const fields = { name: it.name, description: it.description, amountCents: it.amountCents, stripe: { accountId, productId: it.productId, priceId: it.priceId, livemode }, archivedAt: it.active ? undefined : row?.archivedAt ?? now, updatedAt: now };
      if (row) { if (row.stripe.accountId === accountId) await ctx.db.patch(row._id, fields); }
      else { await ctx.db.insert("products", { ...fields, createdAt: now }); added++; }
    }
    return added;
  },
});

/** "Bring in from Stripe": every one-time product on the connected account (its default price in US dollars). Plans and
 *  products without a one-time price are left out. */
export const sync = action({
  args: {},
  handler: async (ctx): Promise<{ added: number; seen: number }> => {
    const t = await ctx.runQuery(internal.products.saveTarget, {});
    const items: Array<{ productId: string; priceId: string; name: string; description?: string; amountCents: number; active: boolean }> = [];
    try {
      let after: string | null = null;
      for (let page = 0; page < 10; page++) {
        const r: StripeResult = await stripeCall("GET", "products", { account: t.accountId, form: { limit: 100, expand: ["data.default_price"], ...(after ? { starting_after: after } : {}) } });
        const data = (r.data ?? []) as StripeResult[];
        for (const p of data) {
          const price = p.default_price as StripeResult | null;
          if (!price || typeof price !== "object" || price.type !== "one_time" || price.currency !== "usd" || typeof price.unit_amount !== "number") continue;
          items.push({ productId: String(p.id), priceId: String(price.id), name: String(p.name ?? "Product").slice(0, 120), ...(p.description ? { description: String(p.description).slice(0, 500) } : {}), amountCents: price.unit_amount, active: !!p.active && !!price.active });
        }
        if (!r.has_more || !data.length) break;
        after = String(data[data.length - 1].id);
      }
    } catch (e) {
      throw new ConvexError(e instanceof StripeError ? e.message : "Couldn't reach Stripe. Try again in a minute.");
    }
    const added = await ctx.runMutation(internal.products.upsertFromStripe, { accountId: t.accountId, livemode: t.livemode, items });
    return { added, seen: items.length };
  },
});

/** For a send: the library lines still good to bill as Stripe's price (the product is this business's, on this Stripe
 *  account, unarchived, at the same price as when picked). Anything else is billed as a plain line. */
export const billable = internalQuery({
  args: { accountId: v.string(), priceIds: v.array(v.string()) },
  handler: async (ctx, { accountId, priceIds }) => {
    const ok: string[] = [];
    for (const id of priceIds) {
      const p = (await ctx.db.query("products").collect()).find((x) => x.stripe.priceId === id);
      if (p && !p.archivedAt && p.stripe.accountId === accountId) ok.push(id);
    }
    return ok;
  },
});
