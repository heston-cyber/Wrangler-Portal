// Nov 21 (Heston): a line picked from the product library carries what it was picked as. Saved only when the product
// is this business's (the row-level rules hide anyone else's); at send, unchanged lines bill Stripe's price.
import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export const itemV = v.optional(v.object({ productId: v.string(), priceId: v.string(), unitCents: v.number(), description: v.string() }));
export type LibItem = { productId: Id<"products">; priceId: string; unitCents: number; description: string };

/** The item as saved, or nothing when it isn't one of this business's products at that price. */
export async function keepItem(ctx: MutationCtx, item: { productId: string; priceId: string; unitCents: number; description: string } | undefined): Promise<LibItem | undefined> {
  if (!item) return undefined;
  const id = ctx.db.normalizeId("products", item.productId);
  const p = id ? await ctx.db.get(id) : null;
  if (!p || p.stripe.priceId !== item.priceId) return undefined;
  return { productId: p._id, priceId: p.stripe.priceId, unitCents: p.amountCents, description: p.name.slice(0, 300) };
}

/** A library line still as it was picked (same words, same unit price, a whole quantity) bills Stripe's price. */
export const unchanged = (l: { description: string; qty: number; unitCents: number; item?: LibItem }) =>
  !!l.item && l.item.unitCents === l.unitCents && l.item.description === l.description && Number.isInteger(l.qty) && l.qty >= 1;
