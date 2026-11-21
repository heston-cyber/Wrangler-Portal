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
    const leftover = !!b?.taxIdToRemove?.length; // an old tax ID Stripe still has (re-review A)
    if (!b?.taxId) return leftover ? { value: null, inStripe: false, leftover } : null;
    return { value: b.taxId.value as string | null, inStripe: !!b.taxId.stripeId && b.taxId.accountId === b.stripe?.accountId, ...(leftover ? { leftover } : {}) };
  },
});

export const target = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const b = await ctx.db.get(ownBusiness(ctx));
    if (!b) throw new ConvexError("Not allowed.");
    return { businessId: b._id, accountId: b.stripe?.status === "connected" ? b.stripe.accountId : null, taxId: b.taxId ?? null, toRemove: b.taxIdToRemove ?? [], connectedTo: b.stripe?.accountId ?? null };
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
  throw new ConvexError("Stripe didn't answer as expected. Nothing changed; try again in a minute."); // re-review F: only a refused number says so
};

/** Re-review A: old Stripe tax IDs still to remove (Stripe wouldn't delete them yet); kept until they're gone. */
export const keepToRemove = internalMutation({
  args: { toRemove: v.array(v.object({ id: v.string(), account: v.string() })) },
  handler: async (ctx, { toRemove }) => {
    await requireOwner(ctx);
    await ctx.db.patch(ownBusiness(ctx), { taxIdToRemove: toRemove.length ? toRemove : undefined });
  },
});

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
    // Re-review B: the same number again with Stripe not connected changes nothing (Stripe's copy stays as it is).
    if (value && value === t.taxId?.value && !t.accountId && !t.toRemove.length) return { value, inStripe: !!old && old.account === t.connectedTo };
    try {
      let made: { id: string; account: string } | null = null;
      if (value && t.accountId) {
        // One already on the account with this number is used, not doubled (two saves at once, or set in Stripe).
        const there = (await stripeEins(t.accountId)).find((x) => x.value === value);
        let id = there?.id;
        if (!id) {
          try { id = (await stripeCall("POST", "tax_ids", { account: t.accountId, form: { type: "us_ein", value } })).id as string; }
          catch (e) { if (e instanceof StripeError && e.status === 400) throw new ConvexError("Stripe didn't accept that EIN. Check the number and try again."); throw e; }
        }
        if (typeof id !== "string") throw new StripeError("unclear", 200, "unclear");
        made = { id, account: t.accountId };
      }
      await ctx.runMutation(internal.taxId.save, { taxId: value ? { type: "us_ein", value, ...(made ? { stripeId: made.id, accountId: made.account } : {}) } : null });
      // Then the old one goes (unless it's the one in use), with any Stripe wouldn't delete before. What still won't go is
      // kept and tried again on the next save (re-review A); Settings says so and offers to try now.
      const gone: Array<{ id: string; account: string }> = [...t.toRemove];
      if (old && !(made && made.id === old.id && made.account === old.account)) gone.push(old);
      const left: typeof gone = [];
      for (const g of gone) {
        if (made && g.id === made.id && g.account === made.account) continue;
        // Nov 21: subscriptions whose invoices carry it move to the new one (or to none) first; one that can't be moved
        // keeps it, so its next invoice never points at a tax ID that's gone. Tried again on the next save.
        const next = made && made.account === g.account ? made.id : null;
        let moved = true;
        for (const sub of await ctx.runQuery(internal.subscriptions.usingTaxId, { accountId: g.account, taxId: g.id })) {
          const ok = await stripeCall("POST", `subscriptions/${sub.subscriptionId}`, { account: g.account, form: { invoice_settings: { account_tax_ids: next ? [next] : "" } } }).then(() => true, () => false);
          if (ok) await ctx.runMutation(internal.subscriptions.setAccountTaxId, { subscriptionId: sub._id, taxId: next });
          else moved = false;
        }
        if (!moved) { left.push(g); continue; }
        await stripeCall("DELETE", `tax_ids/${g.id}`, { account: g.account }).catch((e) => { if (!(e instanceof StripeError && e.status === 404)) left.push(g); });
      }
      if (left.length || t.toRemove.length) await ctx.runMutation(internal.taxId.keepToRemove, { toRemove: left });
      if (left.length) throw new ConvexError(value ? "Saved. Stripe still has the old EIN for now; it's removed the next time you save, or with Remove it below." : "Removed here. Stripe still has it for now; it's removed the next time you save, or with Remove it below.");
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
  args: { businessId: v.id("businesses"), stripeId: v.string(), what: v.optional(v.literal("subscription")) },
  handler: async (ctx, { businessId, stripeId, what }) => {
    const b = await ctx.db.get(businessId);
    if (b?.taxId?.stripeId !== stripeId) return;
    await ctx.db.patch(businessId, { taxId: { type: "us_ein", value: b.taxId.value, updatedAt: Date.now() } });
    // Re-review E: say so (never the number). Settings then offers Add it to Stripe.
    await audit(ctx, { kind: "settings", text: `found the business's EIN no longer in Stripe: ${what === "subscription" ? "a subscription started" : "Stripe's copy of this invoice went"} without it (Add it to Stripe in Settings › Payments)`, where: "Settings › Payments", link: "/settings/payments", businessId });
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
