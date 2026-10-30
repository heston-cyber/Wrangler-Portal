// Phase 2 Part B, step 3 (D45): the client's side of an invoice.
//   - The invoice page: /i/<token>. The token is the invoice email's "View and pay" link, so it opens with or without
//     a portal account (like a share link); a signed-in client also finds it under Payments › Invoices.
//   - Pay: Stripe's Payment Element on that page confirms the invoice's own payment (its confirmation_secret), on the
//     business's connected account. Card details go from the browser to Stripe; the portal never sees them.
//   - After a payment (and on every invoice event from the Connect webhook) the portal reads the invoice's payments
//     back from Stripe: paid, processing (a bank payment clearing) or failed, each with "Visa •••• 4242".
//   - Send (the owner's confirm) emails the invoice (email 08) and posts "Invoice to pay" to the person's Inbox.
import { action } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, mutation, query, focusBusiness } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { displayStatus, totals } from "./invoices";
import { invoicePrefix } from "./lib/invoiceNumber";
import { randomToken } from "./lib/hash";
import { SITE } from "./lib/site";
import { stripeCall, StripeError, type StripeResult } from "./lib/stripeApi";
import { businessOf, clientOfEmail, hasAccess, postToInbox } from "./lib/inbox";
import { mailBrandOf } from "./lib/mail";
import { invoiceMail } from "./lib/mails";
import { sendEmail } from "./lib/email";
import { afterPayments } from "./invoiceReminders";

const label = (p: { name: string; jobNumber?: string }) => (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name);
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
export const payLink = (token: string) => `${SITE()}/i/${token}`;

async function byToken(ctx: QueryCtx | MutationCtx, token: string) {
  if (!TOKEN.test(token)) return null;
  const i = await ctx.db.query("invoices").withIndex("by_pay_token", (q) => q.eq("payToken", token)).first();
  // Drafts never reach a client, and an invoice still being made in Stripe isn't theirs yet.
  return i && i.status !== "draft" && i.status !== "sending" ? i : null;
}

async function signedInEmail(ctx: QueryCtx | MutationCtx): Promise<{ email: string; name: string | null } | null> {
  const userId = await getAuthUserId(ctx);
  const u = userId ? await ctx.db.get(userId) : null;
  return u?.email ? { email: String(u.email).toLowerCase(), name: (u.name as string | undefined) ?? null } : null;
}

/** Is this signed-in person one the invoice is for: the person billed, or one of the client's people with portal access? */
async function isTheirs(ctx: QueryCtx | MutationCtx, i: Doc<"invoices">, email: string) {
  const biz = await businessOf(ctx, i);
  if (!biz || !(await hasAccess(ctx, biz, email))) return false;
  if (i.billTo.email.toLowerCase() === email) return true;
  return !!i.clientId && (await clientOfEmail(ctx, biz, email)) === i.clientId;
}

/** The invoice as the client sees it (no internal notes, no owner history). */
async function clientView(ctx: QueryCtx, i: Doc<"invoices">) {
  const biz = i.businessId ? await ctx.db.get(i.businessId) : null;
  const project = i.projectId ? await ctx.db.get(i.projectId) : null;
  const connected = biz?.stripe?.status === "connected" && biz.stripe.accountId === i.stripe?.accountId;
  const status = displayStatus(i);
  const t = totals(i);
  return {
    token: i.payToken!, kind: i.kind, title: i.title, number: i.number ?? i.stripe?.number ?? "", status,
    billTo: i.billTo, project: project ? label(project) : null, lines: i.lines, discountCents: i.discountCents ?? 0, taxPercent: i.taxPercent ?? 0,
    memo: i.memo ?? "", dueDate: i.dueDate, sentAt: i.sentAt ?? i.createdAt, paidAt: i.paidAt ?? null, voidedAt: i.voidedAt ?? null,
    subtotalCents: t.subtotal, totalCents: i.totalCents, amountPaidCents: i.amountPaidCents, amountRemainingCents: i.amountRemainingCents,
    payments: (i.payments ?? []).filter((p) => p.status !== "failed"),
    lastFailure: status === "failed" ? i.lastFailure?.message ?? null : null,
    // Pay shows only while Stripe can take it: the invoice is open, nothing is clearing, and the business is still connected.
    canPay: i.status === "open" && !i.processing && i.amountRemainingCents > 0 && !!connected,
    hostedUrl: i.status === "open" && connected ? i.stripe?.hostedUrl ?? null : null,
    pdfUrl: i.stripe?.pdfUrl ?? null,
    testMode: i.stripe ? !i.stripe.livemode : false,
    business: biz ? {
      name: biz.name, legalName: biz.legalName ?? null, prefix: invoicePrefix(biz.name), email: biz.replyTo ?? null, address: biz.address ?? null, privacyUrl: biz.privacyUrl ?? null,
      logoUrl: biz.logoFileId ? await ctx.storage.getUrl(biz.logoFileId) : null,
      logoLightUrl: biz.logoLightFileId ? await ctx.storage.getUrl(biz.logoLightFileId) : null, // for the PDFs
    } : { name: "", legalName: null, prefix: "", email: null, address: null, privacyUrl: null, logoUrl: null, logoLightUrl: null },
  };
}
export type ClientInvoice = Awaited<ReturnType<typeof clientView>>;

// ---------- the client's pages ----------

/** /i/<token>: the invoice page. Anyone with the link (it's the one in their email), signed in or not. */
export const page = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const i = await byToken(ctx, token);
    if (!i) return null;
    focusBusiness(ctx, i.businessId);
    return await clientView(ctx, i);
  },
});

/** Payments › Invoices for a signed-in client: the invoices billed to them, or to the client they're one of. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await signedInEmail(ctx);
    if (!me) return [];
    // Billed to them, or to a client they're one of (looked up by index, so no other client's invoice is read).
    const seen = new Map<string, Doc<"invoices">>();
    for (const i of await ctx.db.query("invoices").withIndex("by_bill_email", (q) => q.eq("billTo.email", me.email)).collect()) seen.set(i._id, i);
    for (const cp of await ctx.db.query("clientPeople").withIndex("by_email", (q) => q.eq("email", me.email)).collect()) {
      if (cp.removedAt) continue;
      for (const i of await ctx.db.query("invoices").withIndex("by_client", (q) => q.eq("clientId", cp.clientId)).collect()) seen.set(i._id, i);
    }
    const out = [];
    for (const i of [...seen.values()].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (i.status === "draft" || i.status === "sending" || !i.payToken) continue;
      if (!(await isTheirs(ctx, i, me.email))) continue;
      const project = i.projectId ? await ctx.db.get(i.projectId) : null;
      out.push({
        token: i.payToken, title: i.title, number: i.number ?? "", status: displayStatus(i), project: project ? label(project) : null,
        totalCents: i.totalCents, amountPaidCents: i.amountPaidCents, amountRemainingCents: i.amountRemainingCents, dueDate: i.dueDate,
        paidAt: i.paidAt ?? null, voidedAt: i.voidedAt ?? null, processingSince: (i.payments ?? []).find((p) => p.status === "processing")?.at ?? null,
      });
    }
    return out;
  },
});

/** "Viewed {date}" in the owner's history: the first time someone other than the owner opens the invoice page. */
export const markViewed = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const i = await byToken(ctx, token);
    if (!i || i.viewedAt) return null;
    const scope = (ctx as unknown as { scope?: { isOwner: boolean } }).scope;
    if (scope?.isOwner) return null; // the owner checking the client's page isn't the client viewing it
    focusBusiness(ctx, i.businessId);
    const me = await signedInEmail(ctx);
    const now = Date.now();
    await ctx.db.patch(i._id, { viewedAt: now, history: [...i.history, { kind: "viewed", at: now, detail: me?.name ?? i.billTo.name }].slice(-60) });
    return null;
  },
});

// ---------- paying ----------

export const payTarget = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const i = await byToken(ctx, token);
    if (!i || !i.stripe) return null;
    const biz = i.businessId ? await ctx.db.get(i.businessId) : null;
    return {
      invoiceId: i._id, accountId: i.stripe.accountId, stripeId: i.stripe.invoiceId, businessId: i.businessId ?? null,
      open: i.status === "open" && !i.processing && i.amountRemainingCents > 0,
      connected: biz?.stripe?.status === "connected" && biz.stripe.accountId === i.stripe.accountId,
    };
  },
});

/** Pay: what the Payment Element needs (the invoice payment's client secret, the business's connected account, the
 *  platform's publishable key). Nothing is charged here; the browser confirms the payment with Stripe directly. */
export const start = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ clientSecret: string; accountId: string; publishableKey: string; amountCents: number }> => {
    const t = await ctx.runQuery(internal.invoicePay.payTarget, { token });
    if (!t) throw new ConvexError("This invoice isn't here.");
    if (!t.connected) throw new ConvexError("This invoice can't be paid here right now. Use the link in your email, or reply to it.");
    if (!t.open) throw new ConvexError("There's nothing to pay on this invoice.");
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY ?? "";
    if (!/^pk_(test|live)_/.test(publishableKey)) throw new ConvexError("Paying in the portal isn't switched on yet. Use \"Pay on Stripe instead\".");
    try {
      const inv = await stripeCall("GET", `invoices/${t.stripeId}`, { account: t.accountId, form: { expand: ["confirmation_secret"] } });
      if (inv.status !== "open") throw new ConvexError("There's nothing to pay on this invoice.");
      const secret = inv.confirmation_secret?.client_secret as string | undefined;
      if (!secret) throw new ConvexError("Stripe didn't give a payment for this invoice. Use \"Pay on Stripe instead\".");
      return { clientSecret: secret, accountId: t.accountId, publishableKey, amountCents: Number(inv.amount_remaining ?? 0) };
    } catch (e) {
      if (e instanceof ConvexError) throw e;
      throw new ConvexError(e instanceof StripeError ? e.message : "Couldn't reach Stripe. Try again.");
    }
  },
});

/** After the Payment Element returns (or the bank redirect comes back): read the invoice and its payments from Stripe. */
export const refresh = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<null> => {
    const t = await ctx.runQuery(internal.invoicePay.payTarget, { token });
    if (!t) return null;
    await ctx.runAction(internal.invoicePay.sync, { accountId: t.accountId, stripeId: t.stripeId });
    return null;
  },
});

const BRAND: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", diners: "Diners", jcb: "JCB", unionpay: "UnionPay" };
/** "Visa •••• 4242", "Bank •••• 6789", "Link": how a payment shows on the invoice and receipt. */
export function methodLabel(pm: StripeResult | null | undefined): string {
  if (!pm || typeof pm !== "object") return "Payment";
  if (pm.type === "card" && pm.card) return `${BRAND[pm.card.brand] ?? "Card"} •••• ${pm.card.last4}`;
  if (pm.type === "us_bank_account" && pm.us_bank_account) return `Bank •••• ${pm.us_bank_account.last4}`;
  if (pm.type === "link") return "Link";
  return pm.type ? String(pm.type).replace(/_/g, " ").replace(/^./, (c: string) => c.toUpperCase()) : "Payment";
}

/** One invoice's payments, as the portal keeps them: paid, processing or failed (an attempt that wasn't charged). */
export function paymentsFrom(list: StripeResult[]): { payments: NonNullable<Doc<"invoices">["payments"]>; failure: { at: number; message: string } | null; processing: boolean } {
  const payments: NonNullable<Doc<"invoices">["payments"]> = [];
  let failure: { at: number; message: string } | null = null;
  for (const ip of list) {
    const pi = ip.payment?.payment_intent;
    if (!pi || typeof pi !== "object") continue;
    const at = Number(ip.status_transitions?.paid_at ?? pi.created ?? ip.created ?? 0) * 1000;
    const method = methodLabel(pi.payment_method ?? pi.last_payment_error?.payment_method);
    if (ip.status === "paid" || pi.status === "succeeded") payments.push({ id: String(pi.id), at, method, cents: Number(ip.amount_paid ?? pi.amount_received ?? pi.amount ?? 0), status: "paid" });
    else if (pi.status === "processing") payments.push({ id: String(pi.id), at, method, cents: Number(pi.amount ?? ip.amount_requested ?? 0), status: "processing" });
    else if (pi.last_payment_error) {
      const when = Number(pi.last_payment_error.payment_method?.created ?? pi.created ?? 0) * 1000;
      payments.push({ id: String(pi.id), at: when, method, cents: Number(pi.amount ?? 0), status: "failed" });
      if (!failure || when > failure.at) failure = { at: when, message: String(pi.last_payment_error.message ?? "The payment didn't go through.").slice(0, 200) };
    }
  }
  payments.sort((a, b) => a.at - b.at);
  return { payments, failure, processing: payments.some((p) => p.status === "processing") };
}

/** Reads one invoice and its payments from Stripe and copies them onto the portal's invoice. Run after a payment and
 *  on every invoice event from the webhook. */
export const sync = internalAction({
  args: { accountId: v.string(), stripeId: v.string() },
  handler: async (ctx, { accountId, stripeId }): Promise<null> => {
    const inv = await stripeCall("GET", `invoices/${stripeId}`, { account: accountId });
    const list = await stripeCall("GET", "invoice_payments", { account: accountId, form: { invoice: stripeId, limit: 20, expand: ["data.payment.payment_intent.payment_method"] } });
    await ctx.runMutation(internal.invoices.applyStripeInvoice, { accountId, invoice: inv });
    await ctx.runMutation(internal.invoicePay.applyPayments, { accountId, stripeId, ...paymentsFrom((list.data ?? []) as StripeResult[]) });
    return null;
  },
});

/** Refunds and disputes (charge.refunded, charge.dispute.*): matched to the invoice by the payment they belong to.
 *  The portal only records them; refunds are made, and disputes answered, in Stripe. */
export const applyChargeEvent = internalMutation({
  args: { accountId: v.string(), type: v.string(), object: v.any() },
  handler: async (ctx, { accountId, type, object }) => {
    const o = object as StripeResult;
    const pi = String(o.payment_intent ?? "");
    if (!pi) return null;
    // Small tables per business; the payment intent id is only on the invoice's own payments list.
    const i = (await ctx.db.query("invoices").collect()).find((x) => x.stripe?.accountId === accountId && (x.payments ?? []).some((p) => p.id === pi));
    if (!i) return null;
    const now = Date.now();
    const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (type === "charge.refunded" || type === "charge.refund.updated") {
      const refunded = Number(o.amount_refunded ?? 0);
      const payments = (i.payments ?? []).map((p) => (p.id === pi ? { ...p, refundedCents: refunded } : p));
      const total = payments.reduce((s, p) => s + (p.refundedCents ?? 0), 0);
      if (total === (i.refundedCents ?? 0)) return null;
      await ctx.db.patch(i._id, { payments, refundedCents: total, history: [...i.history, { kind: "refunded", at: now, detail: `${money(total - (i.refundedCents ?? 0))} refunded in Stripe` }].slice(-60), updatedAt: now });
      return null;
    }
    if (type.startsWith("charge.dispute.")) {
      const status = String(o.status ?? "needs_response");
      const closed = type === "charge.dispute.closed";
      await ctx.db.patch(i._id, {
        disputed: { at: now, status, cents: Number(o.amount ?? 0), ...(o.reason ? { reason: String(o.reason) } : {}) },
        history: [...i.history, { kind: closed ? "dispute_closed" : "disputed", at: now, detail: closed ? (status === "won" ? "Dispute won" : status === "lost" ? "Dispute lost" : `Dispute ${status}`) : `${money(Number(o.amount ?? 0))} disputed${o.reason ? ` (${String(o.reason).replace(/_/g, " ")})` : ""}. Respond in Stripe.` }].slice(-60),
        updatedAt: now,
      });
    }
    return null;
  },
});

export const applyPayments = internalMutation({
  args: { accountId: v.string(), stripeId: v.string(), payments: v.any(), failure: v.any(), processing: v.boolean() },
  handler: async (ctx, a) => {
    const i = await ctx.db.query("invoices").withIndex("by_stripe", (q) => q.eq("stripe.invoiceId", a.stripeId)).first();
    if (!i || i.stripe?.accountId !== a.accountId) return null;
    const payments = a.payments as NonNullable<Doc<"invoices">["payments"]>;
    const failure = a.failure as { at: number; message: string } | null;
    const now = Date.now();
    const history = [...i.history];
    // A failed attempt: Stripe's reason replaces the webhook's general one (same attempt, within ten minutes), and the
    // owner's history notes it once.
    const TEN = 10 * 60_000;
    const newFail = !!failure && i.status === "open" && (!i.lastFailure || failure.at >= i.lastFailure.at - TEN);
    if (newFail && !history.some((h) => h.kind === "failed" && Math.abs(h.at - failure!.at) < TEN)) history.push({ kind: "failed", at: failure!.at || now, detail: failure!.message });
    const startedProcessing = a.processing && !i.processing && i.status === "open";
    if (startedProcessing) history.push({ kind: "processing", at: now, detail: payments.find((p) => p.status === "processing")?.method });
    await ctx.db.patch(i._id, {
      payments, processing: i.status === "paid" ? false : a.processing,
      ...(newFail ? { lastFailure: failure! } : {}),
      history: history.slice(-60), updatedAt: now,
    });
    // Step 4: a receipt and "Payment received" for each new payment; the failed-payment email for a new failure.
    const isNewFailure = newFail && (!i.lastFailure || Math.abs(failure!.at - i.lastFailure.at) >= 10 * 60_000 || i.lastFailure.message === "A payment attempt failed");
    await afterPayments(ctx, i, payments, isNewFailure ? failure : null);
    return null;
  },
});

// ---------- the owner's side ----------

/** The owner's "Client's page" link: the invoice page as the client sees it (made now for an invoice sent before step 3). */
export const ownerLink = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const scope = (ctx as unknown as { scope?: { isOwner: boolean } }).scope;
    if (!scope?.isOwner) throw new ConvexError("Not allowed.");
    const i = await ctx.db.get(invoiceId);
    if (!i || i.status === "draft" || i.status === "sending") throw new ConvexError("Send the invoice first.");
    const token = i.payToken ?? randomToken(18);
    if (!i.payToken) await ctx.db.patch(i._id, { payToken: token });
    return payLink(token);
  },
});

// ---------- the invoice email (08) and the Inbox item ----------

/** Called when Send succeeds: gives the invoice its link, posts "Invoice to pay" to the person's Inbox, and schedules
 *  the email. One of each per invoice, however often it runs. */
export async function announceSent(ctx: MutationCtx, i: Doc<"invoices">): Promise<string> {
  const token = i.payToken ?? randomToken(18);
  if (!i.payToken) await ctx.db.patch(i._id, { payToken: token });
  const biz = await businessOf(ctx, i);
  if (biz) {
    const amount = `$${(i.amountRemainingCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    await postToInbox(ctx, {
      businessId: biz, clientId: i.clientId, email: i.billTo.email, kind: "invoice", title: `Invoice ${i.number ?? ""} · ${amount}`.replace("  ", " "),
      text: `${i.title} · due ${new Date(`${i.dueDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      link: `/i/${token}`, linkLabel: "Pay", source: { module: "payments", id: i._id }, key: `invoice:${i._id}`,
    });
  }
  await ctx.scheduler.runAfter(0, internal.invoicePay.sendInvoiceEmail, { invoiceId: i._id });
  return token;
}

export const invoiceEmailData = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const i = await ctx.db.get(invoiceId);
    if (!i || i.status !== "open" || !i.payToken) return null;
    const project = i.projectId ? await ctx.db.get(i.projectId) : null;
    return {
      to: i.billTo.email, name: i.billTo.name, number: i.number ?? "", title: i.title, project: project ? label(project) : null,
      amountCents: i.amountRemainingCents, dueDate: i.dueDate, memo: i.memo ?? null, link: payLink(i.payToken),
      brand: await mailBrandOf(ctx, i.businessId ?? null),
    };
  },
});

export const claimEmail = internalMutation({
  args: { key: v.string(), to: v.string() },
  handler: async (ctx, { key, to }) => {
    if (await ctx.db.query("emailLog").withIndex("by_key", (q) => q.eq("key", key)).unique()) return false;
    await ctx.db.insert("emailLog", { key, kind: "invoice", to, at: Date.now() });
    return true;
  },
});

/** Email 08 · Invoice sent: "Here's invoice {number} …" with "View and pay". It isn't an optional email, so there's no
 *  unsubscribe line (as with signing emails). */
export const sendInvoiceEmail = internalAction({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }): Promise<{ sent: boolean }> => {
    const d = await ctx.runQuery(internal.invoicePay.invoiceEmailData, { invoiceId });
    if (!d) return { sent: false };
    const key = `invoice-sent:${invoiceId}`;
    if (!(await ctx.runMutation(internal.invoicePay.claimEmail, { key, to: d.to }))) return { sent: false };
    const m = invoiceMail(d.brand, d);
    try {
      const id = await sendEmail({ from: m.from, to: d.to, subject: m.subject, text: m.text, html: m.html, tag: "invoice", replyTo: d.brand.replyTo });
      await ctx.runMutation(internal.emails.sent, { key, resendId: id || "sent" });
      const held = id === "held"; // the preview only emails the addresses it's allowed to
      if (!held) await ctx.runMutation(internal.emails.markInboxEmailed, { key: `invoice:${invoiceId}`, email: d.to });
      await ctx.runMutation(internal.invoicePay.noteEmailed, { invoiceId, to: d.to, held });
      return { sent: true };
    } catch (e) {
      await ctx.runMutation(internal.emails.unclaim, { key });
      throw e;
    }
  },
});

export const noteEmailed = internalMutation({
  args: { invoiceId: v.id("invoices"), to: v.string(), held: v.optional(v.boolean()) },
  handler: async (ctx, { invoiceId, to, held }) => {
    const i = await ctx.db.get(invoiceId);
    if (i) await ctx.db.patch(invoiceId, { history: [...i.history, { kind: held ? "email_held" : "emailed", at: Date.now(), detail: to }].slice(-60) });
    return null;
  },
});

export type { Id };
