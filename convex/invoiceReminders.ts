// Phase 2 Part B, step 4: reminders and the after-payment emails.
//   - Reminders (D51): "Send reminder" on an invoice always works. Automatic reminders are a business setting, off
//     until the owner turns them on (turning them on is their OK for those emails, rule 3): one before the due date,
//     then while overdue every n days, up to a limit; never while a bank payment is clearing, and never once it's
//     paid or void. Email 09 before the due date, 10 once it's overdue.
//   - Receipt (11) and Inbox "Payment received" when Stripe reports a payment; "Payment failed" (12) when an attempt
//     fails and isn't followed by a payment within 15 minutes (so someone who retries on the page and pays isn't told).
import { internalAction, internalMutation, internalQuery, mutation } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { businessInScope } from "./lib/business";
import { businessOf, postToInbox } from "./lib/inbox";
import { mailBrandOf } from "./lib/mail";
import { paymentFailedMail, receiptMail, reminderMail } from "./lib/mails";
import { sendEmail } from "./lib/email";
import { payLink } from "./invoicePay";
import { keyMode, platformKey } from "./lib/stripeApi";

const DAY = 86_400_000;
export type ReminderSettings = NonNullable<Doc<"businesses">["reminders"]>;
export const REMINDER_DEFAULTS: ReminderSettings = { on: false, beforeDays: 3, afterDays: 1, everyDays: 7, stopAfter: 3 };
const label = (p: { name: string; jobNumber?: string }) => (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name);

/** The due date's moment for reminders: 15:00 UTC (morning in the US) on that day. */
const dueAt = (iso: string) => Date.parse(`${iso}T15:00:00Z`);
/** Past the end of the due date (US time): the invoice is overdue. */
export const isOverdue = (iso: string, now = Date.now()) => now > Date.parse(`${iso}T23:59:59-06:00`);

/** When the next automatic reminder goes, and which one; null when none will. */
export function nextReminder(i: Pick<Doc<"invoices">, "status" | "processing" | "amountRemainingCents" | "dueDate" | "sentAt" | "reminders">, s: ReminderSettings | null | undefined, now = Date.now()): { at: number; kind: "before" | "overdue" } | null {
  if (!s?.on) return null;
  if (i.status !== "open" || i.processing || i.amountRemainingCents <= 0) return null;
  const due = dueAt(i.dueDate);
  const log = i.reminders ?? [];
  if (s.beforeDays > 0 && !log.some((r) => r.kind === "before") && !isOverdue(i.dueDate, now)) {
    const at = due - s.beforeDays * DAY;
    // Not when the invoice itself went out within a day of it (they've just been sent it).
    if (at > (i.sentAt ?? 0) + DAY) return { at, kind: "before" };
  }
  const autoOverdue = log.filter((r) => r.kind === "overdue" && r.auto).length;
  if (autoOverdue >= s.stopAfter) return null;
  const planned = due + (s.afterDays + autoOverdue * s.everyDays) * DAY;
  // Overdue reminders (by hand or automatic) stay the set gap apart, and any reminder sent by hand pushes the next
  // automatic one at least a day out.
  const lastOverdue = Math.max(0, ...log.filter((r) => r.kind === "overdue").map((r) => r.at));
  const lastByHand = Math.max(0, ...log.filter((r) => !r.auto).map((r) => r.at));
  const floor = Math.max(lastOverdue ? lastOverdue + Math.max(1, s.everyDays) * DAY : 0, lastByHand ? lastByHand + DAY : 0, Date.parse(`${i.dueDate}T23:59:59-06:00`) + 1);
  return { at: Math.max(planned, floor), kind: "overdue" };
}

function ownBusiness(ctx: unknown): Id<"businesses"> {
  const id = businessInScope(ctx);
  if (!id) throw new ConvexError("Not allowed.");
  return id;
}
const isOwner = (ctx: unknown) => !!(ctx as { scope?: { isOwner: boolean } }).scope?.isOwner;

// ---------- the setting ----------

const clampInt = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)));

export const setReminders = mutation({
  args: { on: v.boolean(), beforeDays: v.number(), afterDays: v.number(), everyDays: v.number(), stopAfter: v.number() },
  handler: async (ctx, a) => {
    if (!isOwner(ctx)) throw new ConvexError("Not allowed.");
    const id = ownBusiness(ctx);
    await ctx.db.patch(id, { reminders: { on: a.on, beforeDays: clampInt(a.beforeDays, 0, 30), afterDays: clampInt(a.afterDays, 0, 30), everyDays: clampInt(a.everyDays, 1, 60), stopAfter: clampInt(a.stopAfter, 1, 12) }, updatedAt: Date.now() });
    return null;
  },
});

// ---------- sending one ----------

async function logReminder(ctx: MutationCtx, i: Doc<"invoices">, kind: "before" | "overdue", auto: boolean, detail: string, by?: string) {
  const now = Date.now();
  const reminders = [...(i.reminders ?? []), { at: now, kind, auto }];
  await ctx.db.patch(i._id, { reminders: reminders.slice(-30), history: [...i.history, { kind: "reminder", at: now, ...(by ? { by } : {}), detail }].slice(-60), updatedAt: now });
  await ctx.scheduler.runAfter(0, internal.invoiceReminders.sendReminderEmail, { invoiceId: i._id, kind, key: `reminder:${i._id}:${now}` });
}

/** "Send reminder" on the owner's invoice page (always available while it's unpaid). */
export const sendReminder = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    if (!isOwner(ctx)) throw new ConvexError("Not allowed.");
    const i = await ctx.db.get(invoiceId);
    if (!i || i.status === "draft" || i.status === "sending") throw new ConvexError("Send the invoice first.");
    if (i.status !== "open" || i.amountRemainingCents <= 0) throw new ConvexError("There's nothing left to pay on this invoice.");
    if (i.processing) throw new ConvexError("A bank payment is on its way, so there's nothing to remind them about.");
    const biz = i.businessId ? await ctx.db.get(i.businessId) : null;
    if (biz?.stripe?.status !== "connected") throw new ConvexError("Stripe isn't connected, so they couldn't pay it. Connect Stripe first (Settings › Payments).");
    if (!i.payToken) throw new ConvexError("This invoice has no link yet. Open \"Client's invoice page\" once, then try again.");
    const last = Math.max(0, ...(i.reminders ?? []).map((r) => r.at));
    if (Date.now() - last < 10 * 60_000) throw new ConvexError("A reminder went out a few minutes ago.");
    const userId = await getAuthUserId(ctx);
    const me = userId ? await ctx.db.get(userId) : null;
    const kind = isOverdue(i.dueDate) ? "overdue" : "before";
    const daysLeft = Math.ceil((dueAt(i.dueDate) - Date.now()) / DAY);
    await logReminder(ctx, i, kind, false, kind === "overdue" ? "overdue · sent by hand" : `${daysLeft <= 0 ? "due today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} before due`} · sent by hand`, (me?.name as string | undefined) ?? undefined);
    return { name: i.billTo.name || i.billTo.email };
  },
});

/** Every hour: automatic reminders that are due, for the businesses that turned them on. */
export const runDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let sent = 0;
    const live = keyMode(platformKey()) === "live";
    const on = (await ctx.db.query("businesses").collect()).filter((b) => b.reminders?.on && b.stripe?.status === "connected"); // they couldn't pay otherwise
    if (!on.length) return { sent };
    const open = (await ctx.db.query("invoices").collect()).filter((i) => i.status === "open" && i.payToken);
    for (const b of on) {
      if (!b.reminders) continue;
      for (const i of open) {
        if ((i.businessId ?? null) !== b._id) continue;
        if (!!i.stripe?.livemode !== live) continue; // a test-mode invoice never gets reminders once the portal is live (or the reverse)
        const next = nextReminder(i, b.reminders, now);
        if (!next || next.at > now) continue;
        const detail = next.kind === "before" ? `${b.reminders.beforeDays} day${b.reminders.beforeDays === 1 ? "" : "s"} before due · automatic` : "overdue · automatic";
        await logReminder(ctx, i, next.kind, true, detail);
        sent++;
      }
    }
    return { sent };
  },
});

// ---------- the emails ----------

export const mailData = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const i = await ctx.db.get(invoiceId);
    if (!i || !i.payToken) return null;
    const project = i.projectId ? await ctx.db.get(i.projectId) : null;
    return {
      invoice: { status: i.status, processing: !!i.processing, lastFailureKey: i.lastFailure?.key ?? null, payments: i.payments ?? [], livemode: i.stripe?.livemode ?? false },
      to: i.billTo.email, name: i.billTo.name, number: i.number ?? "", title: i.title, project: project ? label(project) : null,
      amountCents: i.amountRemainingCents, totalCents: i.totalCents, dueDate: i.dueDate, link: payLink(i.payToken),
      brand: await mailBrandOf(ctx, i.businessId ?? null),
    };
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deliverOnce(ctx: { runMutation: (ref: any, args: any) => Promise<any> }, key: string, kind: string, to: string, m: { from: string; subject: string; text: string; html: string }, replyTo: string) {
  if (!(await ctx.runMutation(internal.invoicePay.claimEmail, { key, to }))) return "already";
  try {
    const id = await sendEmail({ from: m.from, to, subject: m.subject, text: m.text, html: m.html, tag: kind, replyTo });
    await ctx.runMutation(internal.emails.sent, { key, resendId: id || "sent" });
    return id === "held" ? "held" : "sent";
  } catch (e) {
    await ctx.runMutation(internal.emails.unclaim, { key });
    throw e;
  }
}

/** Emails 09 (before the due date) and 10 (overdue). */
export const sendReminderEmail = internalAction({
  args: { invoiceId: v.id("invoices"), kind: v.union(v.literal("before"), v.literal("overdue")), key: v.string() },
  handler: async (ctx, { invoiceId, kind, key }): Promise<string> => {
    const d = await ctx.runQuery(internal.invoiceReminders.mailData, { invoiceId });
    if (!d || d.invoice.status !== "open" || d.invoice.processing) return "skipped";
    const r = await deliverOnce(ctx, key, "invoice-reminder", d.to, reminderMail(d.brand, { ...d, kind }), d.brand.replyTo);
    if (r === "held") await ctx.runMutation(internal.invoicePay.noteEmailed, { invoiceId, to: d.to, held: true });
    return r;
  },
});

/** Email 11, the receipt, for one payment. */
export const sendReceipt = internalAction({
  args: { invoiceId: v.id("invoices"), paymentId: v.string() },
  handler: async (ctx, { invoiceId, paymentId }): Promise<string> => {
    const d = await ctx.runQuery(internal.invoiceReminders.mailData, { invoiceId });
    const p = d?.invoice.payments.find((x) => x.id === paymentId && x.status === "paid");
    if (!d || !p) return "skipped";
    const r = await deliverOnce(ctx, `receipt:${invoiceId}:${paymentId}`, "receipt", d.to, receiptMail(d.brand, { ...d, paidCents: p.cents, paidAt: p.at, method: p.method }), d.brand.replyTo);
    if (r === "held") await ctx.runMutation(internal.invoicePay.noteEmailed, { invoiceId, to: d.to, held: true });
    return r;
  },
});

/** Email 12, 15 minutes after a failed attempt, unless they've since paid or a bank payment is clearing. */
export const sendFailed = internalAction({
  args: { invoiceId: v.id("invoices"), failureKey: v.string(), failureAt: v.number(), message: v.string() },
  handler: async (ctx, { invoiceId, failureKey, failureAt, message }): Promise<string> => {
    const d = await ctx.runQuery(internal.invoiceReminders.mailData, { invoiceId });
    if (!d || d.invoice.status !== "open" || d.invoice.processing) return "skipped";
    if (d.invoice.lastFailureKey !== failureKey) return "skipped"; // a later attempt replaced it
    if (d.invoice.payments.some((p) => p.status !== "failed" && p.at > failureAt - 60_000)) return "skipped";
    const r = await deliverOnce(ctx, `failed:${invoiceId}:${failureKey}`, "payment-failed", d.to, paymentFailedMail(d.brand, { ...d, message }), d.brand.replyTo);
    if (r === "held") await ctx.runMutation(internal.invoicePay.noteEmailed, { invoiceId, to: d.to, held: true });
    return r;
  },
});

/** Called when the portal learns of new payments (invoicePay.applyPayments): receipt and Inbox for each new one,
 *  and the failed-payment email for a new failure. */
export async function afterPayments(ctx: MutationCtx, before: Doc<"invoices">, payments: NonNullable<Doc<"invoices">["payments"]>, newFailure: { at: number; message: string; key: string } | null) {
  const wasPaid = new Set((before.payments ?? []).filter((p) => p.status === "paid").map((p) => p.id));
  const biz = await businessOf(ctx, before);
  for (const p of payments.filter((x) => x.status === "paid" && !wasPaid.has(x.id))) {
    await ctx.scheduler.runAfter(0, internal.invoiceReminders.sendReceipt, { invoiceId: before._id, paymentId: p.id });
    if (biz && before.payToken) await postToInbox(ctx, {
      businessId: biz, clientId: before.clientId, email: before.billTo.email, kind: "payment",
      title: `Payment received · $${(p.cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      text: `${before.title}${before.number ? ` · ${before.number}` : ""}`, link: `/i/${before.payToken}`, linkLabel: "View receipt",
      source: { module: "payments", id: before._id }, key: `payment:${before._id}:${p.id}`,
    });
  }
  if (newFailure) await ctx.scheduler.runAfter(15 * 60_000, internal.invoiceReminders.sendFailed, { invoiceId: before._id, failureKey: newFailure.key, failureAt: newFailure.at, message: newFailure.message });
}
