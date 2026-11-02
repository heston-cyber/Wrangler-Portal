// Pay in portal (Heston, Nov 2: "I just need to be able to pay my vendors. Build the pay in portal."). The owner pays
// an approved vendor invoice from their Stripe balance to the vendor's bank (Stripe Global Payouts, standard ACH).
//   - The vendor sets up direct deposit once, on Stripe's own form (an Account Link from their portal's Settings).
//   - Pay creates a Stripe OutboundPayment for the invoice total (locked, like Mark paid). The invoice shows Paying.
//   - Every 15 minutes (or "Check now") the portal asks Stripe: posted → paid (email 28 to the vendor, an email to the
//     owner); failed / returned / canceled → back to approved with the reason (an email to the owner).
// Only for the default business (Wrangler), whose own Stripe account's key is STRIPE_PAYOUTS_KEY. No webhooks.
import { internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { businessContact, businessInScope, defaultBusiness } from "./lib/business";
import { PayoutsError, financialAccount, payoutsCall, payoutsKey, payoutsMode, recipientState } from "./lib/payoutsApi";
import { todayCentral } from "./lib/bookings";
import { label } from "./lib/bookingRows";
import { mailBrandOf } from "./lib/mail";
import { ownerPayoutMail, vendorInvoicePaidMail, vendorPayoutSetupMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { SITE } from "./lib/site";
import { asVendor } from "./vendorPortal";

type Ctx = QueryCtx | MutationCtx;
const err = (e: unknown) => (e instanceof PayoutsError || e instanceof ConvexError ? e : new ConvexError("Stripe didn't answer. Try again in a minute."));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Stripe: /, "");

/** Pay in portal works for this business: the default business, with a key set. */
async function enabledFor(ctx: Ctx, biz: Id<"businesses"> | null | undefined) {
  const def = (await defaultBusiness(ctx))?._id ?? null;
  return !!payoutsKey() && !!biz && biz === def;
}
async function ownerBiz(ctx: Ctx) {
  const me = await requireMe(ctx);
  const biz = businessInScope(ctx);
  if (!biz) throw new ConvexError("Not allowed.");
  return { me, biz };
}
const vendorView = (x: Doc<"vendors">) => {
  const p = x.payout && x.payout.mode === payoutsMode() ? x.payout : null;
  return p ? { state: p.ready ? "ready" : "started", last4: p.last4 ?? null, bankName: p.bankName ?? null } as const : { state: "none", last4: null, bankName: null } as const;
};

// ---------- the owner's view ----------

/** Settings › Payments' Vendor payouts card, and whether Pay shows on invoices. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const { biz } = await ownerBiz(ctx);
    return { on: await enabledFor(ctx, biz), mode: payoutsMode(), keySet: !!payoutsKey(), isDefault: biz === ((await defaultBusiness(ctx))?._id ?? null) };
  },
});

/** The Stripe balance available to pay vendors (asked live). */
export const balance = action({
  args: {},
  handler: async (ctx): Promise<{ availableCents: number } | { error: string }> => {
    const s = await ctx.runQuery(internal.vendorPayouts.ownerCheck, {});
    if (!s.on) return { error: "off" };
    try { const fa = await financialAccount(); return fa ? { availableCents: fa.availableCents } : { error: "Turn on Global Payouts in Stripe first: there's no Stripe balance to pay from." }; }
    catch (e) { return { error: msg(e) }; }
  },
});
export const ownerCheck = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { biz, me } = await ownerBiz(ctx);
    return { on: await enabledFor(ctx, biz), biz, by: me.name ?? me.email };
  },
});

/** What the invoice page needs: can it be paid in the portal, and where it would go. */
export const forInvoice = query({
  args: { invoiceId: v.string() },
  handler: async (ctx, { invoiceId }) => {
    const { biz } = await ownerBiz(ctx);
    const id = ctx.db.normalizeId("vendorInvoices", invoiceId);
    const x = id ? await ctx.db.get(id) : null;
    if (!x) return null;
    const vendor = await ctx.db.get(x.vendorId);
    return {
      on: await enabledFor(ctx, biz), mode: payoutsMode(),
      vendor: vendor ? vendorView(vendor) : { state: "none" as const, last4: null, bankName: null },
      payout: x.payout ? { status: x.payout.status, expectedArrival: x.payout.expectedArrival ?? null, receiptUrl: x.payout.receiptUrl ?? null, reason: x.payout.reason ?? null, startedAt: x.payout.startedAt } : null,
    };
  },
});

// ---------- pay ----------

/** Pay the invoice total to the vendor's bank. Claims the invoice first, so a double press pays once. */
export const pay = action({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }): Promise<{ expectedArrival: string | null }> => {
    const c = await ctx.runMutation(internal.vendorPayouts.claim, { invoiceId });
    try {
      // The vendor's bank as Stripe has it now (they may have changed it since).
      const st = await recipientState(c.recipientId);
      if (!st.ready || !st.payoutMethodId) {
        await ctx.runMutation(internal.vendorPayouts.saveRecipient, { vendorId: c.vendorId, ready: false, needsInfo: st.needsInfo, payoutMethodId: st.payoutMethodId ?? undefined, last4: st.last4 ?? undefined, bankName: st.bankName ?? undefined });
        throw new ConvexError(`${c.first}'s direct deposit isn't ready at Stripe yet. Ask them to finish it in their portal's Settings.`);
      }
      const fa = await financialAccount();
      if (!fa) throw new ConvexError("There's no Stripe balance to pay from. Turn on Global Payouts in Stripe.");
      if (fa.availableCents < c.cents) throw new ConvexError(`Your Stripe balance has ${usd(fa.availableCents)}; this needs ${usd(c.cents)}. Add funds in Stripe first.`);
      const obp = await payoutsCall("POST", "money_management/outbound_payments", {
        idem: `wp-vinv-${invoiceId}-${c.attempt}`,
        body: {
          from: { financial_account: fa.id, currency: "usd" },
          to: { recipient: c.recipientId, payout_method: st.payoutMethodId, currency: "usd" },
          amount: { value: c.cents, currency: "usd" },
          description: `Invoice ${c.number}`.slice(0, 100),
          metadata: { portal_vendor_invoice: String(invoiceId) },
        },
      });
      const expected = obp.expected_arrival_date ? String(obp.expected_arrival_date).slice(0, 10) : null;
      await ctx.runMutation(internal.vendorPayouts.started, { invoiceId, id: String(obp.id), status: String(obp.status ?? "processing"), expectedArrival: expected ?? undefined, receiptUrl: obp.receipt_url ?? undefined, last4: st.last4 ?? undefined });
      if (obp.status && obp.status !== "processing") await ctx.runAction(internal.vendorPayouts.check, { invoiceId });
      return { expectedArrival: expected };
    } catch (e) {
      await ctx.runMutation(internal.vendorPayouts.unclaim, { invoiceId, reason: msg(e) });
      throw err(e);
    }
  },
});
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const claim = internalMutation({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }) => {
    const { me, biz } = await ownerBiz(ctx);
    if (!(await enabledFor(ctx, biz))) throw new ConvexError("Paying vendors in the portal isn't connected for this business.");
    const x = await ctx.db.get(invoiceId);
    if (!x || x.status === "draft") throw new ConvexError("That invoice isn't here.");
    if (x.status !== "approved") throw new ConvexError(x.status === "paid" ? "It's already paid." : "Approve it first.");
    if (x.payout && (x.payout.status === "starting" || x.payout.status === "processing")) throw new ConvexError("It's already being paid.");
    const vendor = await ctx.db.get(x.vendorId);
    if (!vendor || !vendor.payout || vendor.payout.mode !== payoutsMode()) throw new ConvexError(`${(vendor?.name ?? "The vendor").split(" ")[0]} hasn't set up direct deposit yet.`);
    const attempt = (x.payout?.attempt ?? 0) + 1;
    const now = Date.now();
    await ctx.db.patch(invoiceId, { payout: { status: "starting", attempt, mode: payoutsMode() ?? "test", startedAt: now, by: me.name ?? me.email }, updatedAt: now });
    return { vendorId: vendor._id, recipientId: vendor.payout.recipientId, cents: x.totalCents, number: x.number, attempt, first: vendor.name.split(" ")[0] };
  },
});
export const unclaim = internalMutation({
  args: { invoiceId: v.id("vendorInvoices"), reason: v.string() },
  handler: async (ctx, { invoiceId, reason }) => {
    const x = await ctx.db.get(invoiceId);
    if (!x?.payout || x.payout.status !== "starting") return;
    await ctx.db.patch(invoiceId, { payout: { ...x.payout, status: "failed", reason: reason.slice(0, 300) }, updatedAt: Date.now() });
  },
});
export const started = internalMutation({
  args: { invoiceId: v.id("vendorInvoices"), id: v.string(), status: v.string(), expectedArrival: v.optional(v.string()), receiptUrl: v.optional(v.string()), last4: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const x = await ctx.db.get(a.invoiceId);
    if (!x?.payout) return;
    const now = Date.now();
    await ctx.db.patch(a.invoiceId, {
      payout: { ...x.payout, id: a.id, status: a.status, ...(a.expectedArrival ? { expectedArrival: a.expectedArrival } : {}), ...(a.receiptUrl ? { receiptUrl: a.receiptUrl } : {}), checkedAt: now },
      history: [...(x.history ?? []), { at: now, text: `Paying through Stripe (ACH${a.last4 ? ` to ••••${a.last4}` : ""})${a.expectedArrival ? ` · expected ${shortDay(a.expectedArrival)}` : ""}` }], updatedAt: now,
    });
  },
});
const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

// ---------- following the payout ----------

/** Ask Stripe where one payout stands, and record it. */
export const check = internalAction({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }): Promise<string> => {
    const d = await ctx.runQuery(internal.vendorPayouts.payoutOf, { invoiceId });
    if (!d?.id) return "none";
    let obp;
    try { obp = await payoutsCall("GET", `money_management/outbound_payments/${d.id}`); } catch { return "unreachable"; }
    const status = String(obp.status ?? "processing");
    const reason = obp.status_details?.[status]?.reason ?? null;
    const postedAt = obp.status_transitions?.posted_at ? Date.parse(obp.status_transitions.posted_at) : Date.now();
    const r = await ctx.runMutation(internal.vendorPayouts.record, { invoiceId, status, reason: reason ? String(reason).replace(/_/g, " ") : undefined, postedOn: todayCentral(postedAt), receiptUrl: obp.receipt_url ?? undefined });
    if (r === "paid") { await ctx.runAction(internal.vendorPayouts.mailVendorPaid, { invoiceId }); await ctx.runAction(internal.vendorPayouts.mailOwner, { invoiceId, what: "posted" }); }
    if (r === "failed") await ctx.runAction(internal.vendorPayouts.mailOwner, { invoiceId, what: "failed" });
    return r;
  },
});
export const payoutOf = internalQuery({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }) => {
    const x = await ctx.db.get(invoiceId);
    return x?.payout?.id && following(x) ? { id: x.payout.id } : null;
  },
});
export const record = internalMutation({
  args: { invoiceId: v.id("vendorInvoices"), status: v.string(), reason: v.optional(v.string()), postedOn: v.string(), receiptUrl: v.optional(v.string()) },
  handler: async (ctx, a): Promise<"paid" | "failed" | "same"> => {
    const x = await ctx.db.get(a.invoiceId);
    if (!x?.payout) return "same";
    const now = Date.now();
    const payout = { ...x.payout, status: a.status, checkedAt: now, ...(a.receiptUrl ? { receiptUrl: a.receiptUrl } : {}), ...(a.reason ? { reason: a.reason } : {}) };
    if (a.status === "posted" && x.status === "approved") {
      await ctx.db.patch(a.invoiceId, {
        status: "paid", paidAt: now, paidOn: a.postedOn, paidCents: x.totalCents, paidMethod: "Direct deposit (Stripe)", paidRef: x.payout.id ? `Stripe ${x.payout.id.slice(0, 16)}…` : undefined, payout,
        history: [...(x.history ?? []), { at: now, text: "Paid through Stripe · it left your Stripe balance" }], updatedAt: now,
      });
      return "paid";
    }
    if ((a.status === "failed" || a.status === "returned" || a.status === "canceled") && x.payout.status !== a.status) {
      // A returned payout can come after posted: the invoice goes back to approved so it can be paid again.
      const back = x.status === "paid" && a.status === "returned"
        ? { status: "approved" as const, paidAt: undefined, paidOn: undefined, paidCents: undefined, paidMethod: undefined, paidRef: undefined } : {};
      await ctx.db.patch(a.invoiceId, { ...back, payout, history: [...(x.history ?? []), { at: now, text: `Stripe payout ${a.status}${a.reason ? `: ${a.reason}` : ""}. The money is back in your Stripe balance.` }], updatedAt: now });
      return "failed";
    }
    await ctx.db.patch(a.invoiceId, { payout, updatedAt: now });
    return "same";
  },
});

/** Every 15 minutes: the payouts still on their way. */
export const poll = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    if (!payoutsKey()) return 0;
    const ids: Array<Id<"vendorInvoices">> = await ctx.runQuery(internal.vendorPayouts.inFlight, {});
    for (const id of ids) await ctx.runAction(internal.vendorPayouts.check, { invoiceId: id });
    return ids.length;
  },
});
export const inFlight = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = [...await ctx.db.query("vendorInvoices").withIndex("by_status", (q) => q.eq("status", "approved")).collect(), ...await ctx.db.query("vendorInvoices").withIndex("by_status", (q) => q.eq("status", "paid")).collect()];
    return rows.filter((x) => x.payout?.id && following(x)).map((x) => x._id);
  },
});
/** Still worth asking Stripe about: on its way, or posted in the last 10 days (an ACH payout can still be returned). */
const RETURN_WINDOW = 10 * 86_400_000;
function following(x: Doc<"vendorInvoices">) {
  const p = x.payout;
  if (!p?.id) return false;
  if (p.status === "processing") return x.status === "approved";
  if (p.status === "posted") return x.status === "paid" && Date.now() - (x.paidAt ?? 0) < RETURN_WINDOW;
  return false;
}
/** "Check now" on the invoice page. */
export const checkNow = action({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }): Promise<string> => {
    await ctx.runQuery(internal.vendorPayouts.ownerCheck, {});
    return await ctx.runAction(internal.vendorPayouts.check, { invoiceId });
  },
});

// ---------- the vendor's direct deposit ----------

/** Their direct-deposit state, for their portal's Settings. */
export const mine = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, { businessId }) => {
    const { biz, vendor } = await asVendor(ctx, businessId);
    return { on: await enabledFor(ctx, biz), ...vendorView(vendor) };
  },
});

/** Stripe's own form for their bank details (made the first time, or to update them). Opens straight away. */
export const setupLink = action({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, { businessId }): Promise<{ url: string }> => {
    const v0 = await ctx.runQuery(internal.vendorPayouts.vendorFor, { businessId });
    if (!v0.on) throw new ConvexError(`Direct deposit isn't available from ${v0.business} yet.`);
    try {
      let recipientId = v0.recipientId;
      if (!recipientId) {
        const acct = await payoutsCall("POST", "core/accounts", {
          idem: `wp-vendor-${v0.vendorId}-${payoutsMode()}`,
          body: {
            contact_email: v0.email, display_name: v0.name.slice(0, 100),
            identity: { country: "us", entity_type: v0.businessName ? "company" : "individual" },
            configuration: { recipient: { capabilities: { bank_accounts: { ach: { requested: true } } } } },
            metadata: { portal_vendor: String(v0.vendorId) },
          },
        });
        recipientId = String(acct.id);
        await ctx.runMutation(internal.vendorPayouts.saveRecipient, { vendorId: v0.vendorId, recipientId, ready: false });
      }
      const back = `${SITE()}/settings?payouts=${businessId}`;
      const link = await payoutsCall("POST", "core/account_links", {
        body: { account: recipientId, use_case: { type: v0.ready ? "account_update" : "account_onboarding", [v0.ready ? "account_update" : "account_onboarding"]: { configurations: ["recipient"], return_url: back, refresh_url: back } } },
      });
      return { url: String(link.url) };
    } catch (e) { throw err(e); }
  },
});
export const vendorFor = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, { businessId }) => {
    const { biz, vendor } = await asVendor(ctx, businessId);
    const b = await ctx.db.get(biz);
    const p = vendor.payout && vendor.payout.mode === payoutsMode() ? vendor.payout : null;
    return { on: await enabledFor(ctx, biz), business: b?.name ?? "This business", vendorId: vendor._id, name: vendor.name, email: vendor.email, businessName: vendor.businessName ?? null, recipientId: p?.recipientId ?? null, ready: !!p?.ready };
  },
});
/** Back from Stripe's form (or opening Settings): ask Stripe whether direct deposit is ready. */
export const refreshMine = action({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, { businessId }): Promise<{ state: string }> => {
    const v0 = await ctx.runQuery(internal.vendorPayouts.vendorFor, { businessId });
    if (!v0.on || !v0.recipientId) return { state: "none" };
    try {
      const st = await recipientState(v0.recipientId);
      await ctx.runMutation(internal.vendorPayouts.saveRecipient, { vendorId: v0.vendorId, ready: st.ready, needsInfo: st.needsInfo, payoutMethodId: st.payoutMethodId ?? undefined, last4: st.last4 ?? undefined, bankName: st.bankName ?? undefined });
      return { state: st.ready ? "ready" : "started" };
    } catch { return { state: "unknown" }; }
  },
});
export const saveRecipient = internalMutation({
  args: { vendorId: v.id("vendors"), recipientId: v.optional(v.string()), ready: v.boolean(), needsInfo: v.optional(v.boolean()), payoutMethodId: v.optional(v.string()), last4: v.optional(v.string()), bankName: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const x = await ctx.db.get(a.vendorId);
    if (!x) return;
    const recipientId = a.recipientId ?? (x.payout?.mode === payoutsMode() ? x.payout?.recipientId : undefined);
    if (!recipientId) return;
    await ctx.db.patch(a.vendorId, { payout: { recipientId, mode: payoutsMode() ?? "test", ready: a.ready, ...(a.needsInfo !== undefined ? { needsInfo: a.needsInfo } : {}),
      ...(a.payoutMethodId ? { payoutMethodId: a.payoutMethodId } : {}), ...(a.last4 ? { last4: a.last4 } : {}), ...(a.bankName ? { bankName: a.bankName.slice(0, 60) } : {}), checkedAt: Date.now() }, updatedAt: Date.now() });
  },
});

/** The owner asks a vendor to set up direct deposit (an email with a link to their portal's Settings). */
export const askSetup = mutation({
  args: { vendorId: v.id("vendors") },
  handler: async (ctx, { vendorId }) => {
    const { biz } = await ownerBiz(ctx);
    if (!(await enabledFor(ctx, biz))) throw new ConvexError("Paying vendors in the portal isn't connected for this business.");
    const x = await ctx.db.get(vendorId);
    if (!x || x.archivedAt) throw new ConvexError("That vendor isn't on your list.");
    if (!x.invitedAt) throw new ConvexError(`Invite ${x.name.split(" ")[0]} to the portal first (their vendor page › Invite to the portal).`);
    await ctx.scheduler.runAfter(0, internal.vendorPayouts.mailSetup, { vendorId, at: Date.now() });
    return null;
  },
});

// ---------- emails ----------

export const mailInfo = internalQuery({
  args: { invoiceId: v.optional(v.id("vendorInvoices")), vendorId: v.optional(v.id("vendors")) },
  handler: async (ctx, a) => {
    const x = a.invoiceId ? await ctx.db.get(a.invoiceId) : null;
    const vendor = await ctx.db.get(a.vendorId ?? x!.vendorId);
    if (!vendor) return null;
    const p = x ? await ctx.db.get(x.projectId) : null;
    const biz = vendor.businessId ?? null;
    return { x, vendor: { name: vendor.name, email: vendor.email, archived: !!vendor.archivedAt }, project: p ? label(p) : "a project", projectName: p?.name ?? "a project",
      owner: (await businessContact(ctx, biz)).ownerEmail, brand: await mailBrandOf(ctx, biz), biz };
  },
});
export const mailVendorPaid = internalAction({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }) => {
    const d = await ctx.runQuery(internal.vendorPayouts.mailInfo, { invoiceId });
    if (!d?.x || d.x.status !== "paid" || d.vendor.archived || !d.x.paidOn) return;
    await deliverOnce(ctx, `vendor-invoice-paid:${invoiceId}:stripe${d.x.payout?.attempt ?? 0}`, "vendor_invoice_paid", d.vendor.email, vendorInvoicePaidMail(d.brand, {
      name: d.vendor.name, number: d.x.number, project: d.projectName, paidCents: d.x.totalCents, paidOn: d.x.paidOn, method: "Direct deposit", link: `${SITE()}/vendor/invoices/${invoiceId}`,
    }), d.brand.replyTo, d.biz);
  },
});
export const mailOwner = internalAction({
  args: { invoiceId: v.id("vendorInvoices"), what: v.union(v.literal("posted"), v.literal("failed")) },
  handler: async (ctx, { invoiceId, what }) => {
    const d = await ctx.runQuery(internal.vendorPayouts.mailInfo, { invoiceId });
    if (!d?.x || !d.owner) return;
    await deliverOnce(ctx, `vendor-payout-${what}:${invoiceId}:${d.x.payout?.attempt ?? 0}`, `vendor_payout_${what}`, d.owner, ownerPayoutMail(d.brand, {
      what, vendor: d.vendor.name, number: d.x.number, project: d.project, cents: d.x.totalCents, reason: d.x.payout?.reason ?? null, link: `${SITE()}/vendors/payments/${invoiceId}`,
    }), d.brand.replyTo, d.biz);
  },
});
export const mailSetup = internalAction({
  args: { vendorId: v.id("vendors"), at: v.number() },
  handler: async (ctx, { vendorId, at }) => {
    const d = await ctx.runQuery(internal.vendorPayouts.mailInfo, { vendorId });
    if (!d || d.vendor.archived) return;
    await deliverOnce(ctx, `vendor-payout-setup:${vendorId}:${Math.round(at / 60_000)}`, "vendor_payout_setup", d.vendor.email, vendorPayoutSetupMail(d.brand, {
      name: d.vendor.name, link: `${SITE()}/settings`,
    }), d.brand.replyTo, d.biz);
  },
});
