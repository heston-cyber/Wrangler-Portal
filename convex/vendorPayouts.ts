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
import { requireMe, requireAll } from "./lib/access";
import { businessContact, businessInScope, defaultBusiness } from "./lib/business";
import { PayoutsError, financialAccount, payoutsCall, payoutsKey, payoutsMode, recipientState } from "./lib/payoutsApi";
import { todayCentral } from "./lib/bookings";
import { label } from "./lib/bookingRows";
import { mailBrandOf } from "./lib/mail";
import { ownerPayoutMail, vendorInvoicePaidMail, vendorPayoutReturnedMail, vendorPayoutSetupMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { SITE } from "./lib/site";
import { asVendor } from "./vendorPortal";

type Ctx = QueryCtx | MutationCtx;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Stripe: /, "");

/** Pay in portal works for this business: the default business, with a key set. */
async function enabledFor(ctx: Ctx, biz: Id<"businesses"> | null | undefined) {
  const def = (await defaultBusiness(ctx))?._id ?? null;
  return !!payoutsKey() && !!biz && biz === def;
}
async function ownerBiz(ctx: Ctx) {
  const me = await requireAll(ctx, "vendorPayments");
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
      payout: x.payout ? { status: x.payout.status, expectedArrival: x.payout.expectedArrival ?? null, receiptUrl: x.payout.receiptUrl ?? null, reason: x.payout.reason ?? null, startedAt: x.payout.startedAt, stale: x.payout.status === "unknown" && Date.now() - x.payout.startedAt > 23 * 3_600_000 } : null,
    };
  },
});

// ---------- pay ----------
// Each Pay press is one attempt with its own Stripe idempotency key. The exact request is saved on the invoice
// before it's sent, so when Stripe's answer is lost (a timeout, a 5xx) the portal sends the identical request again
// with the same key: Stripe then returns the original payment, or makes it once. Only a payment known to have
// failed, been returned or canceled, or a request Stripe plainly refused, opens a new attempt.
//   starting   → claimed; the request may not be saved yet
//   unknown    → sent, but Stripe's answer was lost (re-sent with the same key until it answers)
//   processing → Stripe has it · posted → paid · failed / returned / canceled → back to approved
//   refused    → nothing was sent, or Stripe refused it outright (nothing left the balance)
const OPEN = ["starting", "unknown", "processing"];
const REPLAY_FOR = 23 * 3_600_000;      // re-send with the same key only well inside Stripe's idempotency window
const STARTING_GRACE = 2 * 60_000;      // a Pay still running
const NEVER_SENT = 10 * 60_000;         // claimed, no request saved: the Pay action died before sending anything
const RETURN_WINDOW = 30 * 86_400_000;  // an ACH payout can come back days after it posted

const cerr = (e: unknown) => (e instanceof ConvexError ? e : new ConvexError(e instanceof PayoutsError ? msg(e) : "Stripe didn't answer. Try again in a minute."));
/** Stripe plainly refused (nothing was made), as opposed to an answer we didn't get. */
const definite = (e: unknown) => e instanceof ConvexError || (e instanceof PayoutsError && (e.status === 0 || (e.status >= 400 && e.status < 500 && ![408, 409, 429].includes(e.status))));
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

type Req = { key: string; cents: number; recipient: string; payoutMethod: string; financialAccount: string; last4?: string; description: string };
type Ran = { state: string; expectedArrival: string | null };
type RunCtx = { runMutation: (f: any, a: any) => Promise<any> };

/** Pay the invoice total to the vendor's bank. `last4` is the bank the owner saw in the dialog. */
export const pay = action({
  args: { invoiceId: v.id("vendorInvoices"), last4: v.optional(v.string()) },
  handler: async (ctx, { invoiceId, last4 }): Promise<Ran> => {
    const c = await ctx.runMutation(internal.vendorPayouts.claim, { invoiceId });
    let req: Req;
    try {
      // The vendor's bank as Stripe has it now (they may have changed it since the page loaded).
      const st = await recipientState(c.recipientId);
      if (!st.ready || !st.payoutMethodId) {
        await ctx.runMutation(internal.vendorPayouts.saveRecipient, { vendorId: c.vendorId, ready: false, needsInfo: st.needsInfo, payoutMethodId: st.payoutMethodId ?? undefined, last4: st.last4 ?? undefined, bankName: st.bankName ?? undefined });
        throw new ConvexError(`${c.first}'s direct deposit isn't ready at Stripe. Ask them to finish it in their portal's Settings.`);
      }
      if (last4 !== undefined && st.last4 !== last4) {
        await ctx.runMutation(internal.vendorPayouts.saveRecipient, { vendorId: c.vendorId, ready: true, payoutMethodId: st.payoutMethodId, last4: st.last4 ?? undefined, bankName: st.bankName ?? undefined });
        throw new ConvexError(`${c.first}'s bank changed to ${st.bankName ? `${st.bankName} ` : ""}••••${st.last4 ?? "?"}. Check it, then press Pay again.`);
      }
      const fa = await financialAccount();
      if (!fa) throw new ConvexError("There's no Stripe balance to pay from. Turn on Global Payouts in Stripe.");
      if (fa.availableCents < c.cents) throw new ConvexError(`Your Stripe balance has ${usd(fa.availableCents)}; this needs ${usd(c.cents)}. Add funds in Stripe first.`);
      req = { key: c.key, cents: c.cents, recipient: c.recipientId, payoutMethod: st.payoutMethodId, financialAccount: fa.id, description: `Invoice ${c.number}`.slice(0, 100), ...(st.last4 ? { last4: st.last4 } : {}) };
      await ctx.runMutation(internal.vendorPayouts.saveRequest, { invoiceId, attempt: c.attempt, request: req });
    } catch (e) {
      // Nothing was sent to Stripe yet.
      await ctx.runMutation(internal.vendorPayouts.refuse, { invoiceId, attempt: c.attempt, reason: msg(e) });
      throw cerr(e);
    }
    const r = await send(ctx, invoiceId, c.attempt, req);
    if (r.state === "refused") throw new ConvexError((await ctx.runQuery(internal.vendorPayouts.reasonOf, { invoiceId })) ?? "Stripe refused it.");
    return r;
  },
});

/** Send (or re-send, with the same key) one attempt's saved request, and record what Stripe says. */
async function send(ctx: RunCtx, invoiceId: Id<"vendorInvoices">, attempt: number, req: Req): Promise<Ran> {
  let obp;
  try {
    obp = await payoutsCall("POST", "money_management/outbound_payments", {
      idem: req.key,
      body: {
        from: { financial_account: req.financialAccount, currency: "usd" },
        to: { recipient: req.recipient, payout_method: req.payoutMethod, currency: "usd" },
        amount: { value: req.cents, currency: "usd" },
        description: req.description,
        metadata: { portal_vendor_invoice: String(invoiceId), portal_attempt: String(attempt) },
      },
    });
  } catch (e) {
    if (definite(e)) { await ctx.runMutation(internal.vendorPayouts.refuse, { invoiceId, attempt, reason: msg(e) }); return { state: "refused", expectedArrival: null }; }
    await ctx.runMutation(internal.vendorPayouts.markUnknown, { invoiceId, attempt });
    return { state: "unknown", expectedArrival: null };
  }
  const id = String(obp?.id ?? "");
  if (!/^obp_/.test(id)) { await ctx.runMutation(internal.vendorPayouts.markUnknown, { invoiceId, attempt }); return { state: "unknown", expectedArrival: null }; }
  const expected = obp.expected_arrival_date ? String(obp.expected_arrival_date).slice(0, 10) : null;
  await ctx.runMutation(internal.vendorPayouts.started, { invoiceId, attempt, id, expectedArrival: expected ?? undefined, receiptUrl: obp.receipt_url ?? undefined });
  const state = String(obp.status ?? "processing");
  if (state !== "processing") return { state: await apply(ctx, invoiceId, attempt, obp), expectedArrival: expected };
  return { state, expectedArrival: expected };
}

/** Record a payment object Stripe returned (from Pay, a re-send, or a check). */
async function apply(ctx: RunCtx, invoiceId: Id<"vendorInvoices">, attempt: number, obp: Record<string, any>): Promise<string> {
  const status = String(obp.status ?? "processing");
  const reason = obp.status_details?.[status]?.reason ?? null;
  const postedAt = obp.status_transitions?.posted_at ? Date.parse(obp.status_transitions.posted_at) : Date.now();
  return await ctx.runMutation(internal.vendorPayouts.record, { invoiceId, attempt, id: String(obp.id), status, reason: reason ? String(reason).replace(/_/g, " ") : undefined, postedOn: todayCentral(Number.isFinite(postedAt) ? postedAt : Date.now()), receiptUrl: obp.receipt_url ?? undefined });
}

export const claim = internalMutation({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }) => {
    const { me, biz } = await ownerBiz(ctx);
    if (!(await enabledFor(ctx, biz))) throw new ConvexError("Paying vendors in the portal isn't connected for this business.");
    const x = await ctx.db.get(invoiceId);
    if (!x || x.status === "draft") throw new ConvexError("That invoice isn't here.");
    if (x.status !== "approved") throw new ConvexError(x.status === "paid" ? "It's already paid." : "Approve it first.");
    if (x.payout && (OPEN.includes(x.payout.status) || x.payout.status === "posted")) throw new ConvexError("It's already being paid.");
    const vendor = await ctx.db.get(x.vendorId);
    if (!vendor || !vendor.payout || vendor.payout.mode !== payoutsMode()) throw new ConvexError(`${(vendor?.name ?? "The vendor").split(" ")[0]} hasn't set up direct deposit yet.`);
    const attempt = (x.payout?.attempt ?? 0) + 1;
    const now = Date.now();
    const key = `wp-vinv-${invoiceId}-${attempt}`;
    await ctx.db.patch(invoiceId, { payout: { status: "starting", attempt, mode: payoutsMode() ?? "test", startedAt: now, by: me.name ?? me.email }, updatedAt: now });
    return { vendorId: vendor._id, recipientId: vendor.payout.recipientId, cents: x.totalCents, number: x.number, attempt, key, first: vendor.name.split(" ")[0] };
  },
});
const isAttempt = (x: Doc<"vendorInvoices"> | null, attempt: number) => !!x?.payout && x.payout.attempt === attempt;
const reqV = v.object({ key: v.string(), cents: v.number(), recipient: v.string(), payoutMethod: v.string(), financialAccount: v.string(), last4: v.optional(v.string()), description: v.string() });
export const saveRequest = internalMutation({
  args: { invoiceId: v.id("vendorInvoices"), attempt: v.number(), request: reqV },
  handler: async (ctx, { invoiceId, attempt, request }) => {
    const x = await ctx.db.get(invoiceId);
    if (!isAttempt(x, attempt) || x!.payout!.status !== "starting") throw new ConvexError("This payment changed while it was starting. Reload the page.");
    await ctx.db.patch(invoiceId, { payout: { ...x!.payout!, request }, updatedAt: Date.now() });
  },
});
export const refuse = internalMutation({
  args: { invoiceId: v.id("vendorInvoices"), attempt: v.number(), reason: v.string() },
  handler: async (ctx, { invoiceId, attempt, reason }) => {
    const x = await ctx.db.get(invoiceId);
    if (!isAttempt(x, attempt) || !["starting", "unknown"].includes(x!.payout!.status)) return;
    const now = Date.now();
    await ctx.db.patch(invoiceId, { payout: { ...x!.payout!, status: "refused", reason: reason.slice(0, 300), checkedAt: now },
      ...(x!.payout!.request ? { history: [...(x!.history ?? []), { at: now, text: `Stripe refused the payment: ${reason.slice(0, 200)}. Nothing left your Stripe balance.` }] } : {}), updatedAt: now });
  },
});
export const markUnknown = internalMutation({
  args: { invoiceId: v.id("vendorInvoices"), attempt: v.number() },
  handler: async (ctx, { invoiceId, attempt }) => {
    const x = await ctx.db.get(invoiceId);
    if (!isAttempt(x, attempt) || !["starting", "unknown"].includes(x!.payout!.status)) return;
    const now = Date.now();
    const first = x!.payout!.status === "starting";
    await ctx.db.patch(invoiceId, { payout: { ...x!.payout!, status: "unknown", checkedAt: now },
      ...(first ? { history: [...(x!.history ?? []), { at: now, text: "Sent to Stripe, but Stripe's answer didn't arrive. The portal is asking again." }] } : {}), updatedAt: now });
  },
});
export const reasonOf = internalQuery({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }) => (await ctx.db.get(invoiceId))?.payout?.reason ?? null,
});
export const started = internalMutation({
  args: { invoiceId: v.id("vendorInvoices"), attempt: v.number(), id: v.string(), expectedArrival: v.optional(v.string()), receiptUrl: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const x = await ctx.db.get(a.invoiceId);
    if (!isAttempt(x, a.attempt)) return;
    const p = x!.payout!;
    if (!["starting", "unknown"].includes(p.status)) return; // already recorded (a re-send answered first)
    const now = Date.now();
    const l4 = p.request?.last4;
    await ctx.db.patch(a.invoiceId, {
      payout: { ...p, id: a.id, status: "processing", ...(a.expectedArrival ? { expectedArrival: a.expectedArrival } : {}), ...(a.receiptUrl ? { receiptUrl: a.receiptUrl } : {}), checkedAt: now },
      history: [...(x!.history ?? []), { at: now, text: `Paying through Stripe (ACH${l4 ? ` to ••••${l4}` : ""})${a.expectedArrival ? ` · expected ${shortDay(a.expectedArrival)}` : ""}` }], updatedAt: now,
    });
  },
});

// ---------- following the payout ----------

/** Ask Stripe where one payout stands (re-sending a request whose answer was lost), and record it. */
export const check = internalAction({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }): Promise<string> => {
    const d = await ctx.runQuery(internal.vendorPayouts.payoutOf, { invoiceId });
    if (!d) return "none";
    const age = Date.now() - d.startedAt;
    if (d.status === "starting" || d.status === "unknown") {
      if (!d.request) {
        if (age < NEVER_SENT) return "same";
        await ctx.runMutation(internal.vendorPayouts.refuse, { invoiceId, attempt: d.attempt, reason: "It didn't start: nothing was sent to Stripe. Press Pay again." });
        return "refused";
      }
      if (d.status === "starting" && age < STARTING_GRACE) return "same";
      if (age > REPLAY_FOR) return "unknown";
      try { return (await send(ctx, invoiceId, d.attempt, d.request)).state; } catch { return "unreachable"; }
    }
    let obp;
    try { obp = await payoutsCall("GET", `money_management/outbound_payments/${d.id}`); } catch { return "unreachable"; }
    if (String(obp.id) !== d.id) return "unreachable";
    return await apply(ctx, invoiceId, d.attempt, obp);
  },
});
export const payoutOf = internalQuery({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }) => {
    const x = await ctx.db.get(invoiceId);
    if (!x?.payout || !following(x)) return null;
    const p = x.payout;
    return { id: p.id ?? null, attempt: p.attempt, status: p.status, startedAt: p.startedAt, request: p.request ?? null };
  },
});
export const record = internalMutation({
  args: { invoiceId: v.id("vendorInvoices"), attempt: v.number(), id: v.string(), status: v.string(), reason: v.optional(v.string()), postedOn: v.string(), receiptUrl: v.optional(v.string()) },
  handler: async (ctx, a): Promise<string> => {
    const x = await ctx.db.get(a.invoiceId);
    // Only the attempt and payment it was asked about (a slow check can't overwrite a newer attempt).
    if (!isAttempt(x, a.attempt) || x!.payout!.id !== a.id) return "stale";
    const p = x!.payout!;
    const now = Date.now();
    const payout = { ...p, status: a.status, checkedAt: now, ...(a.receiptUrl ? { receiptUrl: a.receiptUrl } : {}), ...(a.reason ? { reason: a.reason } : {}) };
    const mail = async (what: "posted" | "failed" | "returned") => {
      await ctx.scheduler.runAfter(0, internal.vendorPayouts.mailOwner, { invoiceId: a.invoiceId, what });
      if (what === "posted") await ctx.scheduler.runAfter(0, internal.vendorPayouts.mailVendorPaid, { invoiceId: a.invoiceId });
      if (what === "returned") await ctx.scheduler.runAfter(0, internal.vendorPayouts.mailVendorReturned, { invoiceId: a.invoiceId });
    };
    if (a.status === "posted") {
      if (x!.status === "approved") {
        await ctx.db.patch(a.invoiceId, {
          status: "paid", paidAt: now, paidOn: a.postedOn, paidCents: p.request?.cents ?? x!.totalCents, paidMethod: "Direct deposit (Stripe)", paidRef: `Stripe ${a.id.slice(0, 16)}…`, payout,
          history: [...(x!.history ?? []), { at: now, text: "Paid through Stripe · it left your Stripe balance" }], updatedAt: now,
        });
        await mail("posted");
        return "paid";
      }
      await ctx.db.patch(a.invoiceId, { payout, updatedAt: now });
      return "same";
    }
    if (a.status === "failed" || a.status === "returned" || a.status === "canceled") {
      if (p.status === a.status) { await ctx.db.patch(a.invoiceId, { payout, updatedAt: now }); return "same"; }
      // A returned payout can come after posted: the invoice goes back to approved so it can be paid again.
      const wasPaid = x!.status === "paid" && x!.paidMethod === "Direct deposit (Stripe)";
      const back = wasPaid ? { status: "approved" as const, paidAt: undefined, paidOn: undefined, paidCents: undefined, paidMethod: undefined, paidRef: undefined } : {};
      const said = a.status === "returned" ? "came back" : a.status === "canceled" ? "was canceled" : "failed";
      await ctx.db.patch(a.invoiceId, { ...back, payout, history: [...(x!.history ?? []), { at: now, text: `The Stripe payment ${said}${a.reason ? `: ${a.reason}` : ""}. The money is back in your Stripe balance.` }], updatedAt: now });
      await mail(wasPaid ? "returned" : "failed");
      return "failed";
    }
    await ctx.db.patch(a.invoiceId, { payout, updatedAt: now });
    return "same";
  },
});

/** Every 15 minutes: the payouts still on their way (and answers that got lost). */
export const poll = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    if (!payoutsKey()) return 0;
    const ids: Array<Id<"vendorInvoices">> = await ctx.runQuery(internal.vendorPayouts.inFlight, {});
    for (const id of ids) { try { await ctx.runAction(internal.vendorPayouts.check, { invoiceId: id }); } catch { /* the next round tries again */ } }
    return ids.length;
  },
});
export const inFlight = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = [...await ctx.db.query("vendorInvoices").withIndex("by_status", (q) => q.eq("status", "approved")).collect(), ...await ctx.db.query("vendorInvoices").withIndex("by_status", (q) => q.eq("status", "paid")).collect()];
    return rows.filter(following).map((x) => x._id);
  },
});
/** Still worth asking Stripe about: on its way (or its answer lost), or posted recently (it can still come back).
 *  Only payouts made with the key in use now (a test payout isn't asked about with a live key). */
function following(x: Doc<"vendorInvoices">) {
  const p = x.payout;
  if (!p || p.mode !== payoutsMode()) return false;
  if (p.status === "starting" || p.status === "unknown") return x.status === "approved";
  if (p.status === "processing") return x.status === "approved" && !!p.id;
  if (p.status === "posted") return x.status === "paid" && !!p.id && Date.now() - (x.paidAt ?? 0) < RETURN_WINDOW;
  return false;
}
/** "Check with Stripe now" on the invoice page. */
export const checkNow = action({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }): Promise<string> => {
    await ctx.runQuery(internal.vendorPayouts.ownerCheck, {});
    return await ctx.runAction(internal.vendorPayouts.check, { invoiceId });
  },
});
/** After a day with no answer from Stripe the portal stops re-sending. The owner checks Stripe's dashboard and says
 *  nothing went out, which lets them pay again (or mark it paid another way). */
export const nothingWentOut = mutation({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }) => {
    await ownerBiz(ctx);
    const x = await ctx.db.get(invoiceId);
    const p = x?.payout;
    if (!x || !p || p.status !== "unknown" || Date.now() - p.startedAt < REPLAY_FOR) throw new ConvexError("Only for a payment Stripe hasn't answered about for a day.");
    const now = Date.now();
    await ctx.db.patch(invoiceId, { payout: { ...p, status: "refused", reason: "You checked Stripe: nothing went out.", checkedAt: now }, history: [...(x.history ?? []), { at: now, text: "You checked Stripe: that payment didn't go out." }], updatedAt: now });
    return null;
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
  args: { businessId: v.id("businesses"), as: v.optional(v.union(v.literal("individual"), v.literal("company"))) },
  handler: async (ctx, { businessId, as }): Promise<{ url: string }> => {
    const v0 = await ctx.runQuery(internal.vendorPayouts.vendorFor, { businessId });
    if (!v0.on) throw new ConvexError(`Direct deposit isn't available from ${v0.business} yet.`);
    try {
      let recipientId = v0.recipientId;
      if (!recipientId) {
        const acct = await payoutsCall("POST", "core/accounts", {
          idem: `wp-vendor-${v0.vendorId}-${payoutsMode()}`,
          body: {
            contact_email: v0.email, display_name: v0.name.slice(0, 100),
            identity: { country: "us", entity_type: as ?? "individual" },
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
    } catch (e) { throw cerr(e); }
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
  args: { invoiceId: v.id("vendorInvoices"), what: v.union(v.literal("posted"), v.literal("failed"), v.literal("returned")) },
  handler: async (ctx, { invoiceId, what }) => {
    const d = await ctx.runQuery(internal.vendorPayouts.mailInfo, { invoiceId });
    if (!d?.x || !d.owner) return;
    await deliverOnce(ctx, `vendor-payout-${what}:${invoiceId}:${d.x.payout?.attempt ?? 0}`, what === "posted" ? "vendor_payout_posted" : "vendor_payout_failed", d.owner, ownerPayoutMail(d.brand, {
      what, vendor: d.vendor.name, number: d.x.number, project: d.project, cents: d.x.totalCents, reason: d.x.payout?.reason ?? null, link: `${SITE()}/vendors/payments/${invoiceId}`,
    }), d.brand.replyTo, d.biz);
  },
});
export const mailVendorReturned = internalAction({
  args: { invoiceId: v.id("vendorInvoices") },
  handler: async (ctx, { invoiceId }) => {
    const d = await ctx.runQuery(internal.vendorPayouts.mailInfo, { invoiceId });
    if (!d?.x || d.vendor.archived) return;
    await deliverOnce(ctx, `vendor-payout-returned-to-vendor:${invoiceId}:${d.x.payout?.attempt ?? 0}`, "vendor_payout_returned", d.vendor.email, vendorPayoutReturnedMail(d.brand, {
      name: d.vendor.name, number: d.x.number, project: d.projectName, cents: d.x.totalCents, reason: d.x.payout?.reason ?? null, link: `${SITE()}/settings`,
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
