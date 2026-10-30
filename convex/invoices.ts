// Phase 2 Part B, step 2 (D45, D46): invoices, owner side. A draft lives only in the portal. Send is the owner's
// confirm (D46: nothing sends without it): the portal then makes the invoice in the business's own Stripe account
// (its connected account), gives it the business's next number (D52) and finalizes it. Stripe holds the money from
// then on; the Connect webhook keeps this copy in step. The client's page, the Pay form and the emails come next.
import { action } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { businessInScope } from "./lib/business";
import { invoicePrefix } from "./lib/invoiceNumber";
import { stripeCall, StripeError, type StripeResult } from "./lib/stripeApi";
import { openDelivery } from "./projects";

const DAY = 86_400_000;
const MIN_CENTS = 50; // Stripe's smallest card charge in USD
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const label = (p: { name: string; jobNumber?: string }) => (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name);

function ownBusiness(ctx: unknown): Id<"businesses"> {
  const id = businessInScope(ctx);
  if (!id) throw new ConvexError("Not allowed.");
  return id;
}

/** Subtotal, discount, tax and total, in cents. Tax applies after the discount. */
export function totals(i: { lines: Array<{ qty: number; unitCents: number }>; discountCents?: number; taxPercent?: number }) {
  const subtotal = i.lines.reduce((s, l) => s + Math.round(l.qty * l.unitCents), 0);
  const discount = Math.min(Math.max(0, i.discountCents ?? 0), subtotal);
  const tax = Math.round(((subtotal - discount) * Math.max(0, i.taxPercent ?? 0)) / 100);
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

/** What the lists and chips show: Draft, Due, Overdue, Partly paid, Processing, Payment failed, Paid, Void… */
export function displayStatus(i: Doc<"invoices">, now = Date.now()) {
  if (i.status === "draft") return "draft" as const;
  if (i.status === "sending") return "sending" as const;
  if (i.status === "paid") return "paid" as const;
  if (i.status === "void") return "void" as const;
  if (i.status === "uncollectible") return "uncollectible" as const;
  if (i.processing) return "processing" as const;
  if (i.lastFailure && (!i.paidAt || i.lastFailure.at > i.paidAt)) return "failed" as const;
  if (i.amountPaidCents > 0) return "partly_paid" as const;
  return new Date(`${i.dueDate}T23:59:59`).getTime() < now ? ("overdue" as const) : ("due" as const);
}

async function rowOf(ctx: QueryCtx, i: Doc<"invoices">) {
  const client = i.clientId ? await ctx.db.get(i.clientId) : null;
  const project = i.projectId ? await ctx.db.get(i.projectId) : null;
  return {
    _id: i._id, kind: i.kind, title: i.title, number: i.number ?? i.stripe?.number ?? null, status: displayStatus(i),
    client: client ? { _id: client._id, name: client.name } : null, project: project ? { _id: project._id, label: label(project) } : null,
    billTo: i.billTo, dueDate: i.dueDate, totalCents: i.totalCents, amountPaidCents: i.amountPaidCents, amountRemainingCents: i.amountRemainingCents,
    sentAt: i.sentAt ?? null, viewedAt: i.viewedAt ?? null, paidAt: i.paidAt ?? null, createdAt: i.createdAt, updatedAt: i.updatedAt,
    lastFailure: i.lastFailure ?? null, sendError: i.sendError ?? null,
  };
}

// ---------- reading ----------

/** Payments › Invoices: every invoice in the business, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const rows = await ctx.db.query("invoices").withIndex("by_updated").order("desc").take(500);
    return Promise.all(rows.map((i) => rowOf(ctx, i)));
  },
});

/** A project's Invoices tab. */
export const forProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("projects", projectId);
    if (!id) return [];
    const rows = await ctx.db.query("invoices").withIndex("by_project", (q) => q.eq("projectId", id)).collect();
    return Promise.all(rows.sort((a, b) => a.createdAt - b.createdAt).map((i) => rowOf(ctx, i)));
  },
});

/** One invoice, with everything its page and the live preview need. */
export const get = query({
  args: { invoiceId: v.string() },
  handler: async (ctx, { invoiceId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("invoices", invoiceId);
    const i = id ? await ctx.db.get(id) : null;
    if (!i) return null;
    const biz = await ctx.db.get(ownBusiness(ctx));
    return {
      ...(await rowOf(ctx, i)),
      lines: i.lines, discountCents: i.discountCents ?? 0, taxPercent: i.taxPercent ?? 0, memo: i.memo ?? "", totals: totals(i),
      clientId: i.clientId ?? null, projectId: i.projectId ?? null, history: i.history, refundedCents: i.refundedCents ?? 0, disputed: i.disputed ?? null,
      stripe: i.stripe ? { invoiceId: i.stripe.invoiceId, hostedUrl: i.stripe.hostedUrl ?? null, pdfUrl: i.stripe.pdfUrl ?? null, livemode: i.stripe.livemode } : null,
      business: biz ? { name: biz.name, legalName: biz.legalName ?? null, prefix: invoicePrefix(biz.name), logoUrl: biz.logoFileId ? await ctx.storage.getUrl(biz.logoFileId) : null } : null,
    };
  },
});

/** The New invoice form: clients with their people and projects, and whether Stripe is ready. */
export const options = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const biz = await ctx.db.get(ownBusiness(ctx));
    const clients = await ctx.db.query("clients").collect();
    const projects = await ctx.db.query("projects").collect();
    const out = [];
    for (const c of clients.sort((a, b) => a.name.localeCompare(b.name))) {
      const people = (await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", c._id)).collect()).filter((p) => !p.removedAt);
      out.push({
        _id: c._id, name: c.name,
        people: people.map((p) => ({ name: p.name ?? p.email, email: p.email, role: p.role })),
        projects: projects.filter((p) => p.clientId === c._id).sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)).map((p) => ({ _id: p._id, label: label(p) })),
      });
    }
    return {
      clients: out,
      business: biz ? { name: biz.name, legalName: biz.legalName ?? null, prefix: invoicePrefix(biz.name), logoUrl: biz.logoFileId ? await ctx.storage.getUrl(biz.logoFileId) : null } : null,
      nextNumber: biz ? `${invoicePrefix(biz.name)}-${String(((await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", "invoiceSeq")).first())?.value ?? 0) + 1).padStart(4, "0")}` : null,
      stripeReady: biz?.stripe?.status === "connected",
    };
  },
});

// ---------- drafts ----------

const lineArg = v.object({ id: v.string(), description: v.string(), qty: v.number(), unitCents: v.number() });
const draftArgs = {
  clientId: v.optional(v.string()), projectId: v.optional(v.string()),
  kind: v.union(v.literal("deposit"), v.literal("final"), v.literal("other")), title: v.string(),
  billTo: v.object({ name: v.string(), email: v.string(), company: v.optional(v.string()) }),
  lines: v.array(lineArg), discountCents: v.optional(v.number()), taxPercent: v.optional(v.number()),
  dueDate: v.string(), memo: v.optional(v.string()),
};

function cleanDraft(a: { title: string; billTo: { name: string; email: string; company?: string }; lines: Array<{ id: string; description: string; qty: number; unitCents: number }>; discountCents?: number; taxPercent?: number; dueDate: string; memo?: string }) {
  const lines = a.lines.slice(0, 50).map((l) => ({
    id: l.id.slice(0, 40) || Math.random().toString(36).slice(2, 10),
    description: l.description.trim().slice(0, 300),
    qty: Math.max(0, Math.min(10_000, Math.round(l.qty * 100) / 100)),
    unitCents: Math.max(0, Math.min(100_000_000, Math.round(l.unitCents))),
  }));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.dueDate)) throw new ConvexError("Pick a due date.");
  return {
    title: a.title.trim().slice(0, 120) || "Invoice",
    billTo: { name: a.billTo.name.trim().slice(0, 120), email: a.billTo.email.trim().toLowerCase().slice(0, 200), ...(a.billTo.company ? { company: a.billTo.company.trim().slice(0, 120) } : {}) },
    lines,
    discountCents: a.discountCents ? Math.max(0, Math.round(a.discountCents)) : undefined,
    taxPercent: a.taxPercent ? Math.max(0, Math.min(30, Math.round(a.taxPercent * 1000) / 1000)) : undefined,
    dueDate: a.dueDate,
    memo: a.memo?.trim().slice(0, 1000) || undefined,
  };
}

/** Save draft: makes or updates a draft. Only drafts change; once sent, Stripe holds it. */
export const saveDraft = mutation({
  args: { invoiceId: v.optional(v.string()), ...draftArgs },
  handler: async (ctx, a) => {
    const me = await requireMe(ctx);
    const clientId = a.clientId ? ctx.db.normalizeId("clients", a.clientId) : null;
    const projectId = a.projectId ? ctx.db.normalizeId("projects", a.projectId) : null;
    if (a.clientId && !(clientId && (await ctx.db.get(clientId)))) throw new ConvexError("That client isn't here.");
    if (a.projectId && !(projectId && (await ctx.db.get(projectId)))) throw new ConvexError("That project isn't here.");
    const d = cleanDraft(a);
    const t = totals(d);
    const now = Date.now();
    const fields = { ...d, kind: a.kind, clientId: clientId ?? undefined, projectId: projectId ?? undefined, totalCents: t.total, amountRemainingCents: t.total, updatedAt: now };
    if (a.invoiceId) {
      const id = ctx.db.normalizeId("invoices", a.invoiceId);
      const i = id ? await ctx.db.get(id) : null;
      if (!i) throw new ConvexError("That invoice isn't here.");
      if (i.status !== "draft") throw new ConvexError("Only drafts can change. This one has been sent.");
      await ctx.db.patch(i._id, { ...fields, sendError: undefined });
      return i._id;
    }
    return await ctx.db.insert("invoices", {
      ...fields, status: "draft", amountPaidCents: 0, createdAt: now, createdBy: me.name ?? me.email,
      history: [{ kind: "created", at: now, by: me.name ?? me.email }],
    });
  },
});

export const deleteDraft = mutation({
  args: { invoiceId: v.string() },
  handler: async (ctx, { invoiceId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("invoices", invoiceId);
    const i = id ? await ctx.db.get(id) : null;
    if (!i) return null;
    if (i.status !== "draft") throw new ConvexError("Only a draft can be deleted. Void a sent invoice instead.");
    await ctx.db.delete(i._id);
    return null;
  },
});

// ---------- sending (D46: the owner's confirm) ----------

/** Checks a draft can go out, marks it as sending (so a double press can't send twice) and gives it its number. */
export const claimForSend = internalMutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const me = await requireMe(ctx);
    const i = await ctx.db.get(invoiceId);
    if (!i) throw new ConvexError("That invoice isn't here.");
    if (i.status !== "draft") throw new ConvexError(i.status === "sending" ? "It's already being sent." : "This invoice has already been sent.");
    const biz = await ctx.db.get(ownBusiness(ctx));
    if (!biz?.stripe || biz.stripe.status !== "connected") throw new ConvexError("Connect Stripe first (Settings › Payments).");
    if (!i.lines.length || i.lines.some((l) => !l.description)) throw new ConvexError("Every line needs a description.");
    if (!EMAIL.test(i.billTo.email)) throw new ConvexError("The bill-to email doesn't look right.");
    const t = totals(i);
    if (t.total < MIN_CENTS) throw new ConvexError("The total must be at least $0.50.");
    if (new Date(`${i.dueDate}T23:59:59`).getTime() < Date.now()) throw new ConvexError("The due date has passed. Pick a later one.");
    // D52: the business's next number, kept if a send fails and is tried again.
    let number = i.number;
    if (!number) {
      const key = "invoiceSeq";
      const row = await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", key)).first();
      const next = (row?.value ?? 0) + 1;
      if (row) await ctx.db.patch(row._id, { value: next }); else await ctx.db.insert("counters", { key, value: next });
      number = `${invoicePrefix(biz.name)}-${String(next).padStart(4, "0")}`;
    }
    await ctx.db.patch(i._id, { status: "sending", number, totalCents: t.total, amountRemainingCents: t.total, sendError: undefined, updatedAt: Date.now() });
    const earlier = (await ctx.db.query("invoices").collect()).find((x) => x.stripe?.accountId === biz.stripe!.accountId && x.billTo.email === i.billTo.email && x.stripe?.customerId);
    return { invoice: { ...i, number }, totals: t, accountId: biz.stripe.accountId, customerId: earlier?.stripe?.customerId ?? null, by: me.name ?? me.email, business: biz.name };
  },
});

export const recordSent = internalMutation({
  args: { invoiceId: v.id("invoices"), stripe: v.any(), by: v.string() },
  handler: async (ctx, { invoiceId, stripe, by }) => {
    const i = await ctx.db.get(invoiceId);
    if (!i) return;
    const s = stripe as { accountId: string; customerId: string; invoice: StripeResult };
    const now = Date.now();
    await ctx.db.patch(invoiceId, {
      status: s.invoice.status === "paid" ? "paid" : "open",
      stripe: { accountId: s.accountId, invoiceId: s.invoice.id, customerId: s.customerId, number: s.invoice.number ?? i.number, hostedUrl: s.invoice.hosted_invoice_url ?? undefined, pdfUrl: s.invoice.invoice_pdf ?? undefined, livemode: !!s.invoice.livemode },
      totalCents: Number(s.invoice.total ?? i.totalCents), amountPaidCents: Number(s.invoice.amount_paid ?? 0), amountRemainingCents: Number(s.invoice.amount_remaining ?? s.invoice.total ?? i.totalCents),
      sentAt: now, updatedAt: now,
      history: [...i.history, { kind: "sent", at: now, by, detail: i.billTo.email }],
    });
  },
});

export const recordSendFailed = internalMutation({
  args: { invoiceId: v.id("invoices"), message: v.string() },
  handler: async (ctx, { invoiceId, message }) => {
    const i = await ctx.db.get(invoiceId);
    if (i?.status === "sending") await ctx.db.patch(invoiceId, { status: "draft", sendError: message.slice(0, 300), updatedAt: Date.now() });
  },
});

/** Send (after the owner confirms in the dialog): makes the invoice in the business's Stripe account and finalizes it.
 *  Stripe's own emails stay off: the portal sends its own (next step). */
export const send = action({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }): Promise<{ number: string }> => {
    const c = await ctx.runMutation(internal.invoices.claimForSend, { invoiceId });
    const i = c.invoice as Doc<"invoices"> & { number: string };
    const account = c.accountId as string;
    const meta = { portal_invoice: invoiceId, portal_business: i.businessId ?? "" };
    try {
      const customerId = (c.customerId as string | null) ?? (await stripeCall("POST", "customers", {
        account, idem: `wp-cust-${invoiceId}`,
        form: { name: i.billTo.company ? `${i.billTo.name} (${i.billTo.company})` : i.billTo.name, email: i.billTo.email, metadata: meta },
      })).id as string;
      const due = Math.floor(new Date(`${i.dueDate}T18:00:00Z`).getTime() / 1000);
      let taxRate: string | null = null;
      if (i.taxPercent) taxRate = (await stripeCall("POST", "tax_rates", { account, idem: `wp-tax-${invoiceId}`, form: { display_name: "Tax", percentage: i.taxPercent, inclusive: false } })).id as string;
      const inv = await stripeCall("POST", "invoices", {
        account, idem: `wp-inv-${invoiceId}`,
        form: {
          customer: customerId, collection_method: "send_invoice", due_date: due, auto_advance: false, pending_invoice_items_behavior: "exclude",
          ...(i.memo ? { description: i.memo } : {}), metadata: { ...meta, portal_kind: i.kind, portal_title: i.title },
          ...(taxRate ? { default_tax_rates: [taxRate] } : {}),
        },
      });
      // One invoice item per line (the amount carries the quantity; the portal's own page shows qty and unit price).
      for (const [n, l] of i.lines.entries()) {
        const amount = Math.round(l.qty * l.unitCents);
        const desc = l.qty === 1 ? l.description : `${l.description} (${l.qty} × $${(l.unitCents / 100).toFixed(2)})`;
        await stripeCall("POST", "invoiceitems", { account, idem: `wp-item-${invoiceId}-${n}`, form: { customer: customerId, invoice: inv.id, amount, currency: "usd", description: desc } });
      }
      if (i.discountCents) await stripeCall("POST", "invoiceitems", { account, idem: `wp-disc-${invoiceId}`, form: { customer: customerId, invoice: inv.id, amount: -Math.min(i.discountCents, c.totals.subtotal), currency: "usd", description: "Discount" } });
      await stripeCall("POST", `invoices/${inv.id}`, { account, form: { number: i.number } });
      const check = await stripeCall("GET", `invoices/${inv.id}`, { account });
      if (Number(check.total) !== c.totals.total) throw new StripeError(`Stripe's total (${check.total}) doesn't match the portal's (${c.totals.total}). Nothing was sent; the Stripe draft was left for you to check.`, 0, "mismatch");
      const done = await stripeCall("POST", `invoices/${inv.id}/finalize`, { account, form: { auto_advance: false } });
      await ctx.runMutation(internal.invoices.recordSent, { invoiceId, by: c.by, stripe: { accountId: account, customerId, invoice: done } });
      return { number: i.number };
    } catch (e) {
      const message = e instanceof StripeError ? e.message : "Couldn't reach Stripe. Nothing was sent; try again.";
      await ctx.runMutation(internal.invoices.recordSendFailed, { invoiceId, message });
      throw new ConvexError(message);
    }
  },
});

// ---------- voiding ----------

export const voidTarget = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    await requireMe(ctx);
    const i = await ctx.db.get(invoiceId);
    if (!i) throw new ConvexError("That invoice isn't here.");
    if (i.status !== "open") throw new ConvexError(i.status === "draft" ? "A draft isn't sent; delete it instead." : "Only an unpaid invoice can be voided.");
    if (i.amountPaidCents > 0) throw new ConvexError("Part of this invoice is paid, so it can't be voided. Refund in Stripe first.");
    return { accountId: i.stripe!.accountId, stripeId: i.stripe!.invoiceId };
  },
});

/** Void (after the owner confirms): the client can't pay it any more. Can't be undone. */
export const voidInvoice = action({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }): Promise<null> => {
    const t = await ctx.runQuery(internal.invoices.voidTarget, { invoiceId });
    try {
      const inv = await stripeCall("POST", `invoices/${t.stripeId}/void`, { account: t.accountId });
      await ctx.runMutation(internal.invoices.applyStripeInvoice, { accountId: t.accountId, invoice: inv });
    } catch (e) {
      throw new ConvexError(e instanceof StripeError ? e.message : "Couldn't reach Stripe. Try again.");
    }
    return null;
  },
});

// ---------- the webhook's side ----------

async function byStripe(ctx: QueryCtx | MutationCtx, accountId: string, stripeId: string) {
  const i = await ctx.db.query("invoices").withIndex("by_stripe", (q) => q.eq("stripe.invoiceId", stripeId)).first();
  return i && i.stripe?.accountId === accountId ? i : null;
}

/** An invoice.* event (or the void call): copies Stripe's status and amounts onto the portal's invoice, notes what
 *  changed in its history, and opens the final files when a final invoice is paid in full. */
export const applyStripeInvoice = internalMutation({
  args: { accountId: v.string(), invoice: v.any(), eventType: v.optional(v.string()) },
  handler: async (ctx, { accountId, invoice, eventType }) => {
    const s = invoice as StripeResult;
    const i = await byStripe(ctx, accountId, String(s.id));
    if (!i) return null;
    const now = Date.now();
    const status = (["open", "paid", "void", "uncollectible"].includes(s.status) ? s.status : i.status) as Doc<"invoices">["status"];
    const paid = Number(s.amount_paid ?? i.amountPaidCents);
    const history = [...i.history];
    if (status === "paid" && i.status !== "paid") history.push({ kind: "paid", at: now, detail: "Paid in full" });
    else if (status === "open" && paid > i.amountPaidCents) history.push({ kind: "part_paid", at: now, detail: `$${((paid - i.amountPaidCents) / 100).toFixed(2)} paid` });
    if (status === "void" && i.status !== "void") history.push({ kind: "voided", at: now });
    if (status === "uncollectible" && i.status !== "uncollectible") history.push({ kind: "uncollectible", at: now });
    if (eventType === "invoice.payment_failed") history.push({ kind: "failed", at: now, detail: "A payment attempt failed" });
    await ctx.db.patch(i._id, {
      status,
      totalCents: Number(s.total ?? i.totalCents), amountPaidCents: paid, amountRemainingCents: Number(s.amount_remaining ?? i.amountRemainingCents),
      ...(status === "paid" || paid > i.amountPaidCents ? { processing: false } : {}),
      ...(eventType === "invoice.payment_failed" ? { lastFailure: { at: now, message: "A payment attempt failed" }, processing: false } : {}),
      ...(status === "paid" && !i.paidAt ? { paidAt: now } : {}),
      ...(status === "void" && !i.voidedAt ? { voidedAt: now } : {}),
      stripe: { ...i.stripe!, number: s.number ?? i.stripe!.number, hostedUrl: s.hosted_invoice_url ?? i.stripe!.hostedUrl, pdfUrl: s.invoice_pdf ?? i.stripe!.pdfUrl },
      history: history.slice(-60), updatedAt: now,
    });
    // A final invoice paid in full opens the project's final files (the Part A lock, now automatic).
    if (status === "paid" && i.status !== "paid" && i.kind === "final" && i.projectId) {
      const p = await ctx.db.get(i.projectId);
      if (p && !p.deliveryUnlockedAt) {
        const told = await openDelivery(ctx, p);
        await ctx.db.patch(i._id, { history: [...history, { kind: told === null ? "delivery_waiting" : "delivery_opened", at: now, detail: told === null ? "No final files added yet; unlock them on the project's Delivery tab when they are" : "Final files opened for the client" }].slice(-60) });
      }
    }
    return i._id;
  },
});

/** Invoice deleted in Stripe (a draft someone removed there): the portal's copy goes back to being a draft. */
export const stripeInvoiceDeleted = internalMutation({
  args: { accountId: v.string(), stripeId: v.string() },
  handler: async (ctx, { accountId, stripeId }) => {
    const i = await byStripe(ctx, accountId, stripeId);
    if (i && i.status === "sending") await ctx.db.patch(i._id, { status: "draft", stripe: undefined, sendError: "The draft was deleted in Stripe. Send again to make a new one.", updatedAt: Date.now() });
  },
});

/** For Settings › Payments: unpaid invoices that a disconnect would hide the Pay button on. */
export async function openCount(ctx: QueryCtx) {
  return (await ctx.db.query("invoices").collect()).filter((i) => i.status === "open").length;
}

export const dayMs = DAY;
