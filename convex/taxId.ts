// Nov 21 (Heston: "EIN should go on invoices as well, like it would in Stripe"; approved 11:00, invoices and receipts
// only). The business's EIN lives in Stripe as the connected account's own tax ID, so Stripe's invoices print it, and a
// copy is kept on each invoice when it's made (as Stripe does), and printed on the portal's invoice page, receipt and
// PDF. Only the owner sets it (Settings › Payments). It's printed on invoices, so whoever can open an invoice sees it
// there (a team member with Payments, and the client); the connector sees only "(on file)" (siteGuard's scrub).
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
    const was = b.taxId?.value ?? null;
    await ctx.db.patch(id, { taxId: taxId ? { ...taxId, updatedAt: Date.now() } : undefined });
    // The audit line never carries the number itself (and isn't written when only Stripe's copy changed).
    if (was !== (taxId?.value ?? null)) await audit(ctx, { kind: "settings", text: taxId ? (imported ? "brought in the business's EIN from Stripe" : was ? "changed the business's EIN" : "set the business's EIN") : "removed the business's EIN", where: "Settings › Payments", link: "/settings/payments", businessId: id });
  },
});

/** Review (Nov 21) #8: a fixed message for tax ID calls, never Stripe's own text (it may quote the number). */
const failed = (e: unknown): never => {
  if (e instanceof ConvexError) throw e;
  throw new ConvexError(e instanceof StripeError && e.status && e.status < 500 ? "Stripe didn't accept that EIN. Check the number and try again." : "Couldn't reach Stripe. Nothing changed; try again in a minute.");
};

/** The business's own us_ein tax IDs on a Stripe account (owner self only; never a customer's). */
async function stripeEins(account: string): Promise<Array<{ id: string; value: string }>> {
  const list = await stripeCall("GET", "tax_ids", { account, form: { limit: 100, owner: { type: "self" } } });
  return ((list.data ?? []) as Array<{ id: string; type: string; value: string; owner?: { type?: string } }>)
    .filter((x) => x.type === "us_ein" && (x.owner?.type ?? "self") === "self").map((x) => ({ id: x.id, value: cleanEin(x.value) ?? x.value }));
}

/** Set (or, with "", remove) the EIN. Review (Nov 21) #1, #3, #7: the new tax ID is made (or found already there) and
 *  saved before the old one is removed, so Stripe and the portal never point at a tax ID that's gone; the old one is
 *  removed from the account it was saved on, whatever the connection's state now. Without Stripe connected, it's kept
 *  here and Settings offers to add it to Stripe later. */
export const set = action({
  args: { ein: v.string() },
  handler: async (ctx, { ein }): Promise<{ value: string | null; inStripe: boolean }> => {
    const t = await ctx.runQuery(internal.taxId.target, {});
    const value = ein.trim() ? cleanEin(ein) : null;
    if (ein.trim() && !value) throw new ConvexError("An EIN is nine digits, like 12-3456789.");
    const old = t.taxId?.stripeId && t.taxId.accountId ? { id: t.taxId.stripeId, account: t.taxId.accountId } : null;
    try {
      let made: { id: string; account: string } | null = null;
      if (value && t.accountId) {
        // One already on the account with this number is used, not doubled (two saves at once, or set in Stripe).
        const there = (await stripeEins(t.accountId)).find((x) => x.value === value);
        const id = there?.id ?? (await stripeCall("POST", "tax_ids", { account: t.accountId, form: { type: "us_ein", value } })).id;
        if (typeof id !== "string") throw new StripeError("unclear", 200, "unclear");
        made = { id, account: t.accountId };
      }
      await ctx.runMutation(internal.taxId.save, { taxId: value ? { type: "us_ein", value, ...(made ? { stripeId: made.id, accountId: made.account } : {}) } : null });
      // Then the old one goes (unless it's the same tax ID). If that fails, the new one is already in use; say so.
      if (old && !(made && made.id === old.id && made.account === old.account)) {
        await stripeCall("DELETE", `tax_ids/${old.id}`, { account: old.account }).catch((e) => {
          if (e instanceof StripeError && e.status === 404) return;
          throw new ConvexError(value ? "Saved. The old EIN couldn't be removed from Stripe just now: save again in a minute to tidy it." : "Removed here, but Stripe still has it. Save again in a minute to remove it there too.");
        });
      }
      return { value, inStripe: !!made };
    } catch (e) {
      return failed(e);
    }
  },
});

/** Review (Nov 21) #4: Settings asks before using the EIN already on the Stripe account. peek: what's there; use: take it. */
export const fromStripe = action({
  args: { use: v.boolean() },
  handler: async (ctx, { use }): Promise<{ value: string } | null> => {
    const t = await ctx.runQuery(internal.taxId.target, {});
    if (t.taxId || !t.accountId) return null;
    try {
      const ein = (await stripeEins(t.accountId))[0];
      const value = ein ? cleanEin(ein.value) : null;
      if (!ein || !value) return null;
      if (use) await ctx.runMutation(internal.taxId.save, { taxId: { type: "us_ein", value, stripeId: ein.id, accountId: t.accountId }, imported: true });
      return { value };
    } catch (e) {
      return failed(e);
    }
  },
});

/** Review (Nov 21) #1: a send found the saved Stripe tax ID gone: forget it, so Settings shows it isn't in Stripe. */
export const forgetStripeId = internalMutation({
  args: { businessId: v.id("businesses"), stripeId: v.string() },
  handler: async (ctx, { businessId, stripeId }) => {
    const b = await ctx.db.get(businessId);
    if (b?.taxId?.stripeId === stripeId) await ctx.db.patch(businessId, { taxId: { type: "us_ein", value: b.taxId.value, updatedAt: Date.now() } });
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
