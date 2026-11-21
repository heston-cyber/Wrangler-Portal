// Nov 21 (Heston: "EIN should go on invoices as well, like it would in Stripe"; approved 11:00, invoices and receipts
// only). The business's EIN lives in Stripe as the connected account's own tax ID, so Stripe's invoices print it, and a
// copy on the business prints it on the portal's invoice page, receipt and PDF. Only the owner reads or changes it here;
// the connector never does (it isn't a site action, and Settings › Payments' read leaves it out).
import { action } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireOwner } from "./lib/access";
import { businessInScope } from "./lib/business";
import { audit } from "./lib/audit";
import { stripeCall, StripeError } from "./lib/stripeApi";

function ownBusiness(ctx: unknown): Id<"businesses"> {
  const id = businessInScope(ctx);
  if (!id) throw new ConvexError("Not allowed.");
  return id;
}

/** "12-3456789" from what was typed (spaces, a missing dash), or null when it isn't nine digits. */
export function cleanEin(raw: string): string | null {
  const d = raw.replace(/[\s-]/g, "");
  return /^\d{9}$/.test(d) ? `${d.slice(0, 2)}-${d.slice(2)}` : null;
}

/** Settings › Payments: the business's EIN (owner only). */
export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const b = await ctx.db.get(ownBusiness(ctx));
    if (!b?.taxId) return null;
    return { value: b.taxId.value, inStripe: !!b.taxId.stripeId && b.taxId.accountId === b.stripe?.accountId };
  },
});

export const target = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const b = await ctx.db.get(ownBusiness(ctx));
    if (!b) throw new ConvexError("Not allowed.");
    return { businessId: b._id, accountId: b.stripe?.status === "connected" ? b.stripe.accountId : null, taxId: b.taxId ?? null };
  },
});

export const save = internalMutation({
  args: { taxId: v.union(v.null(), v.object({ type: v.literal("us_ein"), value: v.string(), stripeId: v.optional(v.string()), accountId: v.optional(v.string()) })), imported: v.optional(v.boolean()) },
  handler: async (ctx, { taxId, imported }) => {
    await requireOwner(ctx);
    const id = ownBusiness(ctx);
    const b = await ctx.db.get(id);
    if (!b) throw new ConvexError("Not allowed.");
    await ctx.db.patch(id, { taxId: taxId ? { ...taxId, updatedAt: Date.now() } : undefined });
    // The audit line never carries the number itself.
    await audit(ctx, { kind: "settings", text: taxId ? (imported ? "brought in the business's EIN from Stripe" : "set the business's EIN") : "removed the business's EIN", where: "Settings › Payments", link: "/settings/payments", businessId: id });
  },
});

/** Set (or, with "", remove) the EIN. With Stripe connected it's saved there first: the old tax ID is removed and the
 *  new one added on the connected account, then kept here. Without Stripe it's kept here and added to Stripe on the
 *  next save after connecting. */
export const set = action({
  args: { ein: v.string() },
  handler: async (ctx, { ein }): Promise<{ value: string | null; inStripe: boolean }> => {
    const t = await ctx.runQuery(internal.taxId.target, {});
    const value = ein.trim() ? cleanEin(ein) : null;
    if (ein.trim() && !value) throw new ConvexError("An EIN is nine digits, like 12-3456789.");
    try {
      if (t.accountId && t.taxId?.stripeId && t.taxId.accountId === t.accountId && t.taxId.value !== value) {
        await stripeCall("DELETE", `tax_ids/${t.taxId.stripeId}`, { account: t.accountId }).catch((e) => { if (!(e instanceof StripeError && e.status === 404)) throw e; });
      }
      if (!value) { await ctx.runMutation(internal.taxId.save, { taxId: null }); return { value: null, inStripe: false }; }
      if (t.accountId && !(t.taxId?.value === value && t.taxId.stripeId && t.taxId.accountId === t.accountId)) {
        const made = await stripeCall("POST", "tax_ids", { account: t.accountId, form: { type: "us_ein", value } });
        if (typeof made.id !== "string") throw new StripeError("Stripe didn't say which tax ID it made.", 200, "unclear");
        await ctx.runMutation(internal.taxId.save, { taxId: { type: "us_ein", value, stripeId: made.id, accountId: t.accountId } });
        return { value, inStripe: true };
      }
      if (t.taxId?.value === value && t.taxId.stripeId && t.taxId.accountId === t.accountId) return { value, inStripe: true };
      await ctx.runMutation(internal.taxId.save, { taxId: { type: "us_ein", value } });
      return { value, inStripe: false };
    } catch (e) {
      if (e instanceof ConvexError) throw e;
      throw new ConvexError(e instanceof StripeError ? `Stripe: ${e.message.replace(/^Stripe:\s*/, "")}` : "Couldn't reach Stripe. Try again in a minute.");
    }
  },
});

/** When the portal has no EIN yet: bring in the one already on the Stripe account (Heston may have set it in Stripe). */
export const load = action({
  args: {},
  handler: async (ctx): Promise<{ value: string | null; inStripe: boolean } | null> => {
    const t = await ctx.runQuery(internal.taxId.target, {});
    if (t.taxId || !t.accountId) return null;
    const list = await stripeCall("GET", "tax_ids", { account: t.accountId, form: { limit: 10 } }).catch(() => null);
    const ein = ((list?.data ?? []) as Array<{ id: string; type: string; value: string }>).find((x) => x.type === "us_ein");
    const value = ein ? cleanEin(ein.value) : null;
    if (!ein || !value) return null;
    await ctx.runMutation(internal.taxId.save, { taxId: { type: "us_ein", value, stripeId: ein.id, accountId: t.accountId }, imported: true });
    return { value, inStripe: true };
  },
});

/** For a send: the Stripe tax ID to put on the invoice (only one saved on this same connected account). */
export const forInvoice = internalQuery({
  args: { businessId: v.id("businesses"), accountId: v.string() },
  handler: async (ctx, { businessId, accountId }) => {
    const b = await ctx.db.get(businessId);
    return b?.taxId?.stripeId && b.taxId.accountId === accountId ? b.taxId.stripeId : null;
  },
});
