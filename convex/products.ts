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

/** Review L5: a product made with the other key mode (test vs live) isn't offered or billed. */
const sameMode = (p: Doc<"products">, b: Doc<"businesses"> | null) => !!b?.stripe && p.stripe.accountId === b.stripe.accountId && p.stripe.livemode === b.stripe.livemode;

/** Review L1: only a plain per-unit, one-time, US-dollar price bills as unit × quantity. */
export const plainPrice = (price: StripeResult | null | undefined) =>
  !!price && typeof price === "object" && price.type === "one_time" && price.currency === "usd" && typeof price.unit_amount === "number"
  && (price.billing_scheme ?? "per_unit") === "per_unit" && !price.transform_quantity && !price.tiers_mode;

const view = (p: Doc<"products">) => ({ _id: p._id, name: p.name, description: p.description ?? null, amountCents: p.amountCents, archived: !!p.archivedAt });

// ---------- lists ----------

/** Payments › Products: active and archived, by name. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "payments");
    const b = await ctx.db.get(businessInScope(ctx)!);
    const mine = (await ctx.db.query("products").collect()).filter((p) => !b?.stripe || sameMode(p, b));
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
    const rows = (await ctx.db.query("products").collect()).filter((p) => !p.archivedAt && sameMode(p, b));
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
    // Review L3: a Bring in that ran in between may already have this product: that row is updated, not doubled.
    const there = await ctx.db.query("products").withIndex("by_account_product", (q) => q.eq("stripe.accountId", a.stripe.accountId).eq("stripe.productId", a.stripe.productId)).first();
    if (there) { await ctx.db.patch(there._id, { ...a, description: a.description, archivedAt: undefined, updatedAt: now }); return there._id; }
    return await ctx.db.insert("products", { ...a, createdAt: now, updatedAt: now });
  },
});

/** New product / Save product: makes or updates the product and its one-time price in the business's Stripe. A new
 *  price replaces the old one (Stripe prices can't change); the old one is retired. */
export const save = action({
  args: { productId: v.optional(v.id("products")), name: v.string(), description: v.optional(v.string()), amountCents: v.number(), nonce: v.optional(v.string()) },
  handler: async (ctx, a): Promise<Id<"products">> => {
    const { name, description } = check(a);
    // Review L3: the editor sends one nonce per open form, so pressing Save again after a lost reply makes nothing twice.
    const nonce = a.nonce && /^[A-Za-z0-9-]{8,64}$/.test(a.nonce) ? a.nonce : null;
    // Keyed on what's sent too: Stripe refuses a key reused with different details (a name fixed before trying again).
    let sig = 2166136261;
    for (const ch of `${name}|${description ?? ""}|${a.amountCents}`) sig = Math.imul(sig ^ ch.charCodeAt(0), 16777619) >>> 0;
    const idem = (what: string) => (nonce ? `wp-prod-${nonce}-${what}-${sig.toString(36)}` : undefined);
    const t = await ctx.runQuery(internal.products.saveTarget, { productId: a.productId });
    const account = t.accountId;
    const product = t.product as Doc<"products"> | null;
    try {
      let productId = product?.stripe.productId;
      if (!productId) {
        productId = (await stripeCall("POST", "products", { account, idem: idem("product"), form: { name, ...(description ? { description } : {}), metadata: { portal_business: t.businessId, portal_kind: "item" } } })).id as string;
      } else {
        await stripeCall("POST", `products/${productId}`, { account, form: { name, description: description ?? "" } });
      }
      let priceId = product?.stripe.priceId;
      if (!product || product.amountCents !== a.amountCents) {
        const price = await stripeCall("POST", "prices", { account, idem: idem(`price-${productId}`), form: { product: productId, currency: "usd", unit_amount: a.amountCents, metadata: { portal_business: t.businessId } } });
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
  args: { accountId: v.string(), livemode: v.boolean(), complete: v.boolean(), items: v.array(v.object({ productId: v.string(), priceId: v.string(), name: v.string(), description: v.optional(v.string()), amountCents: v.number(), active: v.boolean() })) },
  handler: async (ctx, { accountId, livemode, complete, items }) => {
    await requireAll(ctx, "payments");
    const now = Date.now();
    let added = 0;
    for (const it of items) {
      // Review L4: by account and product, so a product id reused on another Stripe account is its own row.
      const row = await ctx.db.query("products").withIndex("by_account_product", (q) => q.eq("stripe.accountId", accountId).eq("stripe.productId", it.productId)).first();
      const fields = { name: it.name, description: it.description, amountCents: it.amountCents, stripe: { accountId, productId: it.productId, priceId: it.priceId, livemode }, archivedAt: it.active ? undefined : row?.archivedAt ?? now, updatedAt: now };
      if (row) await ctx.db.patch(row._id, fields);
      else { await ctx.db.insert("products", { ...fields, createdAt: now }); added++; }
    }
    // Review L2: after a full read, one on this account that no longer has a plain one-time price is taken off the picker.
    let retired = 0;
    if (complete) {
      const kept = new Set(items.map((x) => x.productId));
      for (const p of await ctx.db.query("products").collect()) {
        if (p.stripe.accountId === accountId && !kept.has(p.stripe.productId) && !p.archivedAt) { await ctx.db.patch(p._id, { archivedAt: now, updatedAt: now }); retired++; }
      }
    }
    return { added, retired };
  },
});

/** "Bring in from Stripe": every one-time product on the connected account (its default price in US dollars). Plans and
 *  products without a one-time price are left out. */
export const sync = action({
  args: {},
  handler: async (ctx): Promise<{ added: number; seen: number; retired: number; truncated: boolean }> => {
    const t = await ctx.runQuery(internal.products.saveTarget, {});
    const items: Array<{ productId: string; priceId: string; name: string; description?: string; amountCents: number; active: boolean }> = [];
    let truncated = true; // review L6: said so when there were more than 1,000
    try {
      let after: string | null = null;
      for (let page = 0; page < 10; page++) {
        const r: StripeResult = await stripeCall("GET", "products", { account: t.accountId, form: { limit: 100, expand: ["data.default_price"], ...(after ? { starting_after: after } : {}) } });
        const data = (r.data ?? []) as StripeResult[];
        for (const p of data) {
          const price = p.default_price as StripeResult | null;
          if (!plainPrice(price)) continue;
          const name = String(p.name ?? "").trim().slice(0, 120) || "Product"; // review I1: trimmed, as lines are
          items.push({ productId: String(p.id), priceId: String(price!.id), name, ...(p.description ? { description: String(p.description).trim().slice(0, 500) } : {}), amountCents: price!.unit_amount as number, active: !!p.active && !!price!.active });
        }
        if (!r.has_more || !data.length) { truncated = false; break; }
        after = String(data[data.length - 1].id);
      }
    } catch (e) {
      throw new ConvexError(e instanceof StripeError ? e.message : "Couldn't reach Stripe. Try again in a minute.");
    }
    const r = await ctx.runMutation(internal.products.upsertFromStripe, { accountId: t.accountId, livemode: t.livemode, complete: !truncated, items });
    return { added: r.added, retired: r.retired, seen: items.length, truncated };
  },
});

/** For a send: the library lines the portal still counts as good to bill as Stripe's price (the product is this
 *  business's, on this Stripe account and key mode, unarchived, at the same price as when picked). Anything else is
 *  billed as a plain line. The send then asks Stripe too (stillBillable). */
export const billable = internalQuery({
  args: { accountId: v.string(), livemode: v.boolean(), lines: v.array(v.object({ priceId: v.string(), unitCents: v.number() })) },
  handler: async (ctx, { accountId, livemode, lines }) => {
    const ok: string[] = [];
    for (const l of lines) {
      const rows = await ctx.db.query("products").withIndex("by_price", (q) => q.eq("stripe.priceId", l.priceId)).collect();
      // Review L3: every copy must agree (an archived copy means it's archived).
      if (rows.length && rows.every((p) => !p.archivedAt && p.stripe.accountId === accountId && p.stripe.livemode === livemode && p.amountCents === l.unitCents)) ok.push(l.priceId);
    }
    return [...new Set(ok)];
  },
});

/** Review L2: what Stripe says now. A price turned off, a product archived, or a price that wouldn't bill unit ×
 *  quantity at the line's amount is billed as a plain line instead. Unclear answers count as no. */
export async function stillBillable(account: string, lines: Array<{ priceId: string; unitCents: number }>): Promise<string[]> {
  const ok: string[] = [];
  for (const l of lines) {
    if (ok.includes(l.priceId)) continue;
    const price = await stripeCall("GET", `prices/${l.priceId}`, { account, form: { expand: ["product"] } }).catch(() => null);
    const product = price?.product as StripeResult | string | undefined;
    if (price && price.active === true && plainPrice(price) && price.unit_amount === l.unitCents && typeof product === "object" && product.active === true) ok.push(l.priceId);
  }
  return ok;
}
