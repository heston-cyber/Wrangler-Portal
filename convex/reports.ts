// Phase 5e step 5 (Nov 6): Payments › Reports (Design Log › Phase 5e › Reports: 828:23224 chart view, 828:24131 table
// view, 828:25041 empty, 828:25566 loading, 828:26159 long list, 828:27139 Bookkeeper, 829:23397 phone; the Export for
// accountant dialog 826:25852; Dashboard › Reports widgets 829:24616). Everything is worked out from records the portal
// already keeps: invoices and the payments Stripe reported on them (refunds taken off, subscription charges included),
// vendor invoices, the job ledger and the pipeline. Who: the owner, and a team member with the Reports switch (the
// Bookkeeper by default). Profit by project is what a job is worth, so it also needs "See what a project is worth".
//
// Heston's decisions (read-back approved Nov 6, 07:57):
//   1. Revenue is money received, on the day it was paid, less refunds; the CSV also has what was invoiced.
//   2. Profit by project is the job ledger's (the project's Ledger tab); the Profit tile is revenue less vendor
//      invoices paid in the range.
//   3. Outstanding is as of today, whatever the range.
//   4. A job is a lead that reached Signed or later; quiet leads and leads closed before Signed are left out.
//   5. Jobs finished: deals that reached Delivered (or Paid) in the range; average job: what they billed / how many.
//   6. Several reports download as one .zip (the page builds the files from this query's rows).
//   7. Days and months follow the viewer's time zone (the portal has no business time zone yet).
import { mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireAll, seesValue } from "./lib/access";
import { businessInScope } from "./lib/business";
import { audit } from "./lib/audit";
import { displayStatus } from "./invoices";
import { STAGES, ledgerCalc, ratesOf } from "./crm";

type Stage = (typeof STAGES)[number];
const STAGE_NAME: Record<Stage, string> = { lead: "Lead", quoted: "Quoted", contract_sent: "Contract sent", signed: "Signed", in_production: "In production", delivered: "Delivered", paid: "Paid" };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 2000;

export const REPORTS = ["revenue", "profit", "outstanding", "vendors", "funnel"] as const;
export type ReportKey = (typeof REPORTS)[number];
export const REPORT_NAMES: Record<ReportKey, { label: string; sub: string }> = {
  revenue: { label: "Revenue by month", sub: "Invoiced and paid" },
  profit: { label: "Profit by project", sub: "Revenue, vendor costs and profit" },
  outstanding: { label: "Outstanding invoices", sub: "By how late they are" },
  vendors: { label: "Vendor costs", sub: "Paid to each vendor" },
  funnel: { label: "Lead to job", sub: "From the pipeline" },
};

/** "YYYY-MM-DD" for a moment, in a time zone (an unknown zone reads as Central, Wrangler's). */
export function dayIn(ms: number, tz: string): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); }
  catch { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); }
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
function monthsOf(from: string, to: string) {
  const out: string[] = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ey = +to.slice(0, 4), em = +to.slice(5, 7);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

/** Money received on an invoice: each payment on the day it was paid, less what was refunded from it; an invoice paid
 *  before the portal kept payments counts its amount paid on the day it was paid (as Payments › Overview does). */
function receipts(i: Doc<"invoices">) {
  const paid = (i.payments ?? []).filter((p) => p.status === "paid");
  if (paid.length) return paid.map((p) => ({ at: p.at, cents: p.cents - (p.refundedCents ?? 0) }));
  return i.amountPaidCents > 0 ? [{ at: i.paidAt ?? i.updatedAt, cents: i.amountPaidCents - (i.refundedCents ?? 0) }] : [];
}

/** The furthest stage a deal reached, and when it first reached each one. */
function reached(d: Doc<"deals">) {
  const idx = (s: string) => STAGES.indexOf(s as Stage);
  const firstAt: Partial<Record<Stage, number>> = {};
  const mark = (i: number, at: number) => { for (let k = 0; k <= i; k++) { const s = STAGES[k]; if (firstAt[s] === undefined || firstAt[s]! > at) firstAt[s] = at; } };
  mark(0, d.createdAt);
  for (const h of d.history) {
    let i = idx(h.kind);
    if (i < 0 && h.kind === "moved" && h.detail) { const to = h.detail.split("→").pop()?.trim(); i = STAGES.findIndex((s) => STAGE_NAME[s] === to); }
    if (h.kind === "created" && d.source === "estimate") i = Math.max(i, idx("quoted"));
    if (i >= 0) mark(i, h.at);
  }
  const now = idx(d.stage);
  for (let k = 0; k <= now; k++) if (firstAt[STAGES[k]] === undefined) firstAt[STAGES[k]] = d.updatedAt;
  const furthest = Math.max(now, ...Object.keys(firstAt).map(idx));
  return { furthest, firstAt };
}

async function build(ctx: QueryCtx, a: { from: string; to: string; tz: string }, withValue: boolean) {
  if (!DAY.test(a.from) || !DAY.test(a.to) || a.from > a.to) throw new ConvexError("Pick a start and an end date.");
  if (daysBetween(a.from, a.to) > 366 * 6) throw new ConvexError("Pick a range of six years or less.");
  const tz = a.tz.slice(0, 64);
  const now = Date.now();
  const today = dayIn(now, tz);
  const inRange = (day: string) => day >= a.from && day <= a.to;
  const bizId = businessInScope(ctx);
  const biz = bizId ? await ctx.db.get(bizId) : null;

  const invoices = await ctx.db.query("invoices").withIndex("by_updated").order("desc").take(MAX_ROWS);
  const clientName = new Map<string, string | null>();
  const nameOf = async (clientId?: Doc<"invoices">["clientId"], fallback?: string | null) => {
    if (!clientId) return fallback ?? null;
    if (!clientName.has(clientId)) clientName.set(clientId, (await ctx.db.get(clientId))?.name ?? null);
    return clientName.get(clientId) ?? fallback ?? null;
  };
  const projects = new Map<string, Doc<"projects"> | null>();
  const projectOf = async (id?: Doc<"invoices">["projectId"]) => {
    if (!id) return null;
    if (!projects.has(id)) projects.set(id, await ctx.db.get(id));
    return projects.get(id) ?? null;
  };
  const label = (p: Doc<"projects">) => (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name);

  // ---------- revenue: received (and invoiced) by month ----------
  const months = monthsOf(a.from, a.to).map((m) => ({ month: m, paidCents: 0, invoicedCents: 0 }));
  const monthRow = new Map(months.map((m) => [m.month, m]));
  const payments: Array<{ day: string; invoice: string; client: string | null; project: string | null; cents: number }> = [];
  const touched = new Set<string>(); // projects with money in the range
  let revenue = 0;
  for (const i of invoices) {
    if (i.status === "draft" || i.status === "sending") continue;
    const client = await nameOf(i.clientId, i.billTo.company ?? i.billTo.name ?? null);
    const p = await projectOf(i.projectId);
    for (const r of receipts(i)) {
      const day = dayIn(r.at, tz);
      if (!inRange(day) || !r.cents) continue;
      revenue += r.cents;
      const m = monthRow.get(day.slice(0, 7));
      if (m) m.paidCents += r.cents;
      payments.push({ day, invoice: i.number ?? i.stripe?.number ?? i.title, client, project: p ? label(p) : null, cents: r.cents });
      if (p) touched.add(p._id);
    }
    if (i.status !== "void" && i.sentAt) {
      const day = dayIn(i.sentAt, tz);
      const m = inRange(day) ? monthRow.get(day.slice(0, 7)) : undefined;
      if (m) m.invoicedCents += i.totalCents;
    }
  }

  // ---------- vendor costs: vendor invoices paid in the range ----------
  const vendorRows = new Map<string, { vendor: string; cents: number; invoices: number }>();
  const vendorPaid: Array<{ day: string; vendor: string; number: string; project: string | null; cents: number }> = [];
  let vendorCents = 0;
  for (const vi of (await ctx.db.query("vendorInvoices").collect()).filter((x) => x.status === "paid")) {
    const day = vi.paidOn && DAY.test(vi.paidOn) ? vi.paidOn : vi.paidAt ? dayIn(vi.paidAt, tz) : null;
    if (!day || !inRange(day)) continue;
    const cents = vi.paidCents ?? vi.totalCents;
    const vendor = (await ctx.db.get(vi.vendorId))?.name ?? "A vendor";
    const row = vendorRows.get(vi.vendorId) ?? { vendor, cents: 0, invoices: 0 };
    row.cents += cents; row.invoices++;
    vendorRows.set(vi.vendorId, row);
    vendorCents += cents;
    const p = await projectOf(vi.projectId);
    vendorPaid.push({ day, vendor, number: vi.number, project: p ? label(p) : null, cents });
    if (p) touched.add(p._id);
  }

  // ---------- outstanding, as of today ----------
  const buckets = [
    { key: "not_due", label: "Not due yet", cents: 0, count: 0 },
    { key: "late_30", label: "1 to 30 days late", cents: 0, count: 0 },
    { key: "late_60", label: "31 to 60 days late", cents: 0, count: 0 },
    { key: "late_more", label: "Over 60 days late", cents: 0, count: 0 },
  ];
  const owed: Array<{ _id: string; title: string; number: string | null; client: string | null; due: string; daysLate: number; cents: number; bucket: string }> = [];
  for (const i of invoices) {
    const st = displayStatus(i, now);
    if (!["due", "overdue", "partly_paid", "failed"].includes(st) || i.amountRemainingCents <= 0) continue;
    const late = daysBetween(i.dueDate, today);
    const b = late <= 0 ? buckets[0] : late <= 30 ? buckets[1] : late <= 60 ? buckets[2] : buckets[3];
    b.cents += i.amountRemainingCents; b.count++;
    owed.push({ _id: i._id, title: i.title, number: i.number ?? i.stripe?.number ?? null, client: await nameOf(i.clientId, i.billTo.company ?? i.billTo.name ?? null), due: i.dueDate, daysLate: Math.max(0, late), cents: i.amountRemainingCents, bucket: b.label });
  }
  owed.sort((x, y) => y.daysLate - x.daysLate || y.cents - x.cents);

  // ---------- the pipeline: lead to job, and jobs finished ----------
  const deals = await ctx.db.query("deals").collect();
  const funnel = STAGES.map((s) => ({ stage: s, label: STAGE_NAME[s], count: 0 }));
  let leads = 0;
  const finished: Array<{ title: string; client: string | null; day: string; cents: number }> = [];
  for (const d of deals) {
    const r = reached(d);
    if (!d.quiet && !(d.closedAt && r.furthest < STAGES.indexOf("signed")) && inRange(dayIn(d.createdAt, tz))) {
      leads++;
      for (let k = 0; k <= r.furthest; k++) funnel[k].count++;
    }
    const doneAt = r.firstAt.delivered ?? r.firstAt.paid;
    if (doneAt !== undefined && r.furthest >= STAGES.indexOf("delivered") && inRange(dayIn(doneAt, tz))) {
      let cents = d.valueCents ?? 0;
      if (d.projectId) {
        const billed = invoices.filter((i) => i.projectId === d.projectId && !["draft", "sending", "void"].includes(i.status));
        if (billed.length) cents = billed.reduce((t, i) => t + i.totalCents - (i.refundedCents ?? 0), 0);
      }
      finished.push({ title: d.title, client: await nameOf(d.clientId, null), day: dayIn(doneAt, tz), cents });
    }
  }
  const jobs = funnel[STAGES.indexOf("signed")].count;

  // ---------- profit by project: the job ledger (needs "See what a project is worth") ----------
  let byProject: Array<{ _id: string; project: string; client: string | null; priceCents: number; billed: boolean; costCents: number; profitCents: number; estimateProfitCents: number | null }> | null = null;
  if (withValue && biz) {
    const rates = await ratesOf(ctx, biz);
    for (const e of await ctx.db.query("ledgerEntries").collect()) if (!e.draft && inRange(e.date)) touched.add(e.projectId);
    byProject = [];
    for (const id of touched) {
      const p = await projectOf(id as Doc<"invoices">["projectId"]);
      if (!p) continue;
      const L = await ledgerCalc(ctx, p, rates);
      byProject.push({ _id: p._id, project: label(p), client: await nameOf(p.clientId, null), priceCents: L.actual.priceCents, billed: L.actual.billed,
        costCents: L.actual.expenseCents, profitCents: L.actual.netCents, estimateProfitCents: L.estimate?.netCents ?? null });
    }
    byProject.sort((x, y) => y.profitCents - x.profitCents);
  }

  return {
    from: a.from, to: a.to, today,
    tiles: {
      revenueCents: revenue,
      profitCents: revenue - vendorCents,
      outstandingCents: buckets.reduce((t, b) => t + b.cents, 0), outstandingCount: owed.length,
      leadToJob: leads ? Math.round((jobs / leads) * 100) : null, jobs, leads,
    },
    months,
    summary: { revenueCents: revenue, vendorCents, profitCents: revenue - vendorCents, jobsFinished: finished.length,
      averageJobCents: finished.length ? Math.round(finished.reduce((t, f) => t + f.cents, 0) / finished.length) : null },
    byProject,
    outstanding: { buckets, invoices: owed.slice(0, 200) },
    vendors: [...vendorRows.values()].sort((x, y) => y.cents - x.cents),
    funnel: { stages: funnel, leads, leadToPaid: leads ? Math.round((funnel[STAGES.length - 1].count / leads) * 100) : null },
    detail: { payments: payments.sort((x, y) => x.day.localeCompare(y.day)), vendorPaid: vendorPaid.sort((x, y) => x.day.localeCompare(y.day)),
      // 5e review M5: a finished job's own amount is a job amount; without the switch only the totals above remain.
      finished: withValue ? finished : finished.map((f) => ({ ...f, cents: null })) },
    empty: revenue === 0 && vendorCents === 0 && owed.length === 0 && leads === 0 && !months.some((m) => m.invoicedCents),
  };
}

const rangeArgs = { from: v.string(), to: v.string(), tz: v.string() };

/** Payments › Reports: everything on the page, for one range. */
export const page = query({
  args: rangeArgs,
  handler: async (ctx, a) => {
    const me = await requireAll(ctx, "reports");
    return build(ctx, a, seesValue(me));
  },
});

/** The Dashboard's Reports widgets: revenue this year by month, and what is outstanding (owner and Reports switch only;
 *  the Dashboards only ask when the viewer has Reports). */
export const widgets = query({
  args: { tz: v.string() },
  handler: async (ctx, { tz }) => {
    await requireAll(ctx, "reports");
    const today = dayIn(Date.now(), tz);
    const r = await build(ctx, { from: `${today.slice(0, 4)}-01-01`, to: today, tz }, false);
    return { from: r.from, to: r.to, revenueCents: r.tiles.revenueCents, months: r.months.map((m) => ({ month: m.month, cents: m.paidCents })), outstanding: r.outstanding.buckets, outstandingCents: r.tiles.outstandingCents, outstandingCount: r.tiles.outstandingCount };
  },
});

/** Export for accountant: the page builds the CSVs from `page`'s rows; this records the export in Settings › Activity. */
export const logExport = mutation({
  args: { from: v.string(), to: v.string(), reports: v.array(v.string()) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "reports");
    if (!DAY.test(a.from) || !DAY.test(a.to)) throw new ConvexError("Pick a start and an end date.");
    const names = a.reports.filter((k): k is ReportKey => (REPORTS as readonly string[]).includes(k)).map((k) => REPORT_NAMES[k].label);
    if (!names.length) throw new ConvexError("Pick at least one report.");
    await audit(ctx, { kind: "export", text: `Exported ${names.join(", ")} for ${a.from} to ${a.to}`, where: "Payments › Reports", link: "/payments/reports" });
    return null;
  },
});
