// Phase 5e step 5 (Nov 6): Payments › Reports. R1 revenue by month (refunds, subscription charges, the viewer's time
// zone), R2 profit and vendor costs, R3 outstanding by how late, R4 lead to job and jobs finished, R6 who can see it,
// R7 exports in Activity. (R5, the CSV files, is in reportsCsv.test.ts.)
import { beforeAll, describe, expect, test } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
});
const TZ = "America/Chicago";
const RANGE = { from: "2026-01-01", to: "2026-03-31", tz: TZ };
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
type W = Awaited<ReturnType<typeof world>>;

async function invoice(w: W, x: { title: string; status: "open" | "paid" | "void" | "draft"; total: number; paid?: number; due?: string; sentAt?: number; kind?: "final" | "subscription" | "other";
  payments?: Array<{ at: number; cents: number; refundedCents?: number }>; project?: boolean; refunded?: number }) {
  return w.t.run(async (ctx) => ctx.db.insert("invoices", {
    businessId: w.A, clientId: w.harbor, ...(x.project ? { projectId: w.p } : {}), kind: x.kind ?? "other", title: x.title,
    lines: [{ id: "l1", description: x.title, qty: 1, unitCents: x.total }], dueDate: x.due ?? "2026-02-01", status: x.status,
    billTo: { name: "Maya Brooks", email: "maya@harbor.example", company: "Harbor Coffee" },
    totalCents: x.total, amountPaidCents: x.paid ?? 0, amountRemainingCents: x.total - (x.paid ?? 0),
    ...(x.payments ? { payments: x.payments.map((p, i) => ({ id: `py_${x.title}_${i}`, at: p.at, method: "Visa •••• 4242", cents: p.cents, status: "paid" as const, ...(p.refundedCents ? { refundedCents: p.refundedCents } : {}) })) } : {}),
    ...(x.refunded ? { refundedCents: x.refunded } : {}),
    ...(x.sentAt ? { sentAt: x.sentAt } : {}), history: [], createdAt: 0, updatedAt: Date.now(),
  } as never));
}

async function team(w: W, email: string, role: "producer" | "bookkeeper", perms?: Record<string, boolean>) {
  const { SUGGESTED } = await import("../convex/lib/perms");
  const sub = await w.t.run(async (ctx) => {
    const u = await ctx.db.insert("users", { email, name: email.split("@")[0], role: "team", emailVerificationTime: 0 });
    await ctx.db.insert("memberships", { businessId: w.A, email, userId: u, role: "team", teamRole: role, perms: { ...SUGGESTED[role], ...(perms ?? {}) }, createdAt: 0 });
    return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
  });
  return w.t.withIdentity({ subject: sub });
}

async function seed(w: W) {
  // Jan 31, 11:30 PM in Chicago is Feb 1 in UTC: it's January's money.
  await invoice(w, { title: "Final", status: "paid", total: 100000, paid: 100000, project: true, kind: "final", sentAt: Date.UTC(2026, 0, 10, 18), refunded: 20000,
    payments: [{ at: Date.UTC(2026, 1, 1, 5, 30), cents: 100000, refundedCents: 20000 }] });
  await invoice(w, { title: "Retainer", status: "paid", total: 50000, paid: 50000, kind: "subscription", sentAt: Date.UTC(2026, 1, 15, 18), payments: [{ at: Date.UTC(2026, 1, 15, 18), cents: 50000 }] });
  await invoice(w, { title: "April", status: "paid", total: 7000, paid: 7000, sentAt: Date.UTC(2026, 3, 2, 18), payments: [{ at: Date.UTC(2026, 3, 2, 18), cents: 7000 }] });
  await invoice(w, { title: "Voided", status: "void", total: 99999, sentAt: Date.UTC(2026, 0, 5, 18) });
  await invoice(w, { title: "Draft", status: "draft", total: 88888 });
  await invoice(w, { title: "Not due", status: "open", total: 1000, due: day(10) });
  await invoice(w, { title: "Ten late", status: "open", total: 2000, due: day(-10) });
  await invoice(w, { title: "Part paid, 45 late", status: "open", total: 5000, paid: 1000, due: day(-45) });
  await invoice(w, { title: "Ninety late", status: "open", total: 4000, due: day(-90) });
  await w.t.run(async (ctx) => {
    const vendor = await ctx.db.insert("vendors", { businessId: w.A, name: "Jordan Ellis", email: "jordan@x.example", roles: ["Shooter"], rates: [], createdAt: 0, updatedAt: 0 } as never);
    const booking = await ctx.db.insert("vendorBookings", { businessId: w.A, vendorId: vendor, projectId: w.p, role: "Shooter", start: "2026-02-10", end: "2026-02-10", rate: { cents: 30000, unit: "day" }, status: "accepted", offeredAt: 0, createdAt: 0, updatedAt: 0 } as never);
    const base = { businessId: w.A, vendorId: vendor, bookingId: booking, projectId: w.p, mode: "lines" as const, hours: [], lines: [{ description: "Day", cents: 30000 }], rate: { cents: 30000, unit: "day" as const }, totalCents: 30000, createdAt: 0, updatedAt: 0 };
    await ctx.db.insert("vendorInvoices", { ...base, number: "INV-1", status: "paid", paidOn: "2026-02-20", paidCents: 30000 } as never);
    await ctx.db.insert("vendorInvoices", { ...base, number: "INV-2", status: "approved" } as never);   // not paid: not a cost yet
    await ctx.db.insert("vendorInvoices", { ...base, number: "INV-3", status: "paid", paidOn: "2026-05-01" } as never); // after the range
    const at = (m: number, d: number) => Date.UTC(2026, m, d, 18);
    const deal = (x: Record<string, unknown>) => ctx.db.insert("deals", { businessId: w.A, title: "Deal", stage: "lead", source: "hand", history: [], createdAt: at(0, 5), updatedAt: at(0, 5), ...x } as never);
    await deal({ title: "Stays a lead" });
    await deal({ title: "Signed", stage: "signed", history: [{ kind: "moved", at: at(1, 1), detail: "Lead → Quoted" }, { kind: "moved", at: at(1, 9), detail: "Quoted → Signed" }] });
    await deal({ title: "Delivered", stage: "delivered", projectId: w.p, history: [{ kind: "signed", at: at(1, 2) }, { kind: "delivered", at: at(2, 5) }] });
    await deal({ title: "Quiet", quiet: true, source: "accepted" });
    await deal({ title: "Not a lead", closedAt: at(0, 6) });
    await deal({ title: "Last year", createdAt: Date.UTC(2025, 11, 1), updatedAt: Date.UTC(2025, 11, 1) });
  });
}

describe("Phase 5e · Reports", () => {
  test("R1 revenue is money received on the day it was paid, less refunds, with subscription charges, by the viewer's months", async () => {
    const w = await world();
    await seed(w);
    const r = await w.heston.query(api.reports.page, RANGE);
    expect(r.months.map((m: { month: string }) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(r.months.map((m: { paidCents: number }) => m.paidCents)).toEqual([80000, 50000, 0]);
    expect(r.months.map((m: { invoicedCents: number }) => m.invoicedCents)).toEqual([100000, 50000, 0]); // the void one isn't invoiced
    expect(r.tiles.revenueCents).toBe(130000);
    // The same payment in UTC is February's.
    const utc = await w.heston.query(api.reports.page, { ...RANGE, tz: "UTC" });
    expect(utc.months.map((m: { paidCents: number }) => m.paidCents)).toEqual([0, 130000, 0]);
    await expect(w.heston.query(api.reports.page, { ...RANGE, from: "2026-04-01" })).rejects.toThrow(/start and an end/);
  });

  test("R2 profit is revenue less vendor invoices paid in the range; vendor costs by vendor; profit by project from the ledger", async () => {
    const w = await world();
    await seed(w);
    const r = await w.heston.query(api.reports.page, RANGE);
    expect(r.summary).toMatchObject({ revenueCents: 130000, vendorCents: 30000, profitCents: 100000 });
    expect(r.tiles.profitCents).toBe(100000);
    expect(r.vendors).toEqual([{ vendor: "Jordan Ellis", cents: 30000, invoices: 1 }]);
    expect(r.byProject).toHaveLength(1);
    expect(r.byProject[0]).toMatchObject({ _id: w.p, billed: expect.any(Boolean) });
    expect(typeof r.byProject[0].profitCents).toBe("number");
  });

  test("R3 outstanding is as of today, by how late, whatever the range", async () => {
    const w = await world();
    await seed(w);
    const r = await w.heston.query(api.reports.page, RANGE);
    expect(r.outstanding.buckets.map((b: { count: number; cents: number }) => [b.count, b.cents])).toEqual([[1, 1000], [1, 2000], [1, 4000], [1, 4000]]);
    expect(r.tiles).toMatchObject({ outstandingCents: 11000, outstandingCount: 4 });
    expect(r.outstanding.invoices[0]).toMatchObject({ title: "Ninety late", daysLate: 90 });
  });

  test("R4 lead to job: leads made in the range (not quiet, not closed before Signed); jobs finished and the average job", async () => {
    const w = await world();
    await seed(w);
    const r = await w.heston.query(api.reports.page, RANGE);
    expect(r.funnel.leads).toBe(3);
    expect(r.funnel.stages.map((s: { count: number }) => s.count)).toEqual([3, 2, 2, 2, 1, 1, 0]);
    expect(r.tiles).toMatchObject({ leads: 3, jobs: 2, leadToJob: 67 });
    expect(r.funnel.leadToPaid).toBe(0);
    expect(r.summary.jobsFinished).toBe(1);
    expect(r.summary.averageJobCents).toBe(80000); // the delivered job's project billed $1,000 less a $200 refund
    expect(r.empty).toBe(false);
  });

  test("R6 the owner and the Reports switch; profit by project needs 'what a project is worth'; nobody else; another business sees its own", async () => {
    const w = await world();
    await seed(w);
    const bookkeeper = await team(w, "books@x.example", "bookkeeper");
    expect((await bookkeeper.query(api.reports.page, RANGE)).tiles.revenueCents).toBe(130000);
    const noValue = await team(w, "books2@x.example", "bookkeeper", { value: false });
    const r = await noValue.query(api.reports.page, RANGE);
    expect(r.byProject).toBeNull();
    expect(r.tiles.revenueCents).toBe(130000);
    const producer = await team(w, "prod@x.example", "producer");
    await expect(producer.query(api.reports.page, RANGE)).rejects.toThrow();
    await expect(producer.query(api.reports.widgets, { tz: TZ })).rejects.toThrow();
    expect((await bookkeeper.query(api.reports.widgets, { tz: TZ })).outstandingCount).toBe(4);
    await expect(w.maya.query(api.reports.page, RANGE)).rejects.toThrow();
    await expect(w.t.query(api.reports.page, RANGE)).rejects.toThrow();
    const boss = await w.boss.query(api.reports.page, RANGE);
    expect(boss.tiles).toMatchObject({ revenueCents: 0, outstandingCount: 0, leads: 0 });
    expect(boss.empty).toBe(true);
  });

  test("R7 an export lands in Settings › Activity, with what and which range", async () => {
    const w = await world();
    await w.heston.mutation(api.reports.logExport, { from: "2026-01-01", to: "2026-03-31", reports: ["revenue", "vendors", "nonsense"] });
    await expect(w.heston.mutation(api.reports.logExport, { from: "2026-01-01", to: "2026-03-31", reports: [] })).rejects.toThrow(/at least one/);
    await expect(w.maya.mutation(api.reports.logExport, { from: "2026-01-01", to: "2026-03-31", reports: ["revenue"] })).rejects.toThrow();
    const rows = await w.t.run(async (ctx) => ctx.db.query("auditLog").collect());
    expect(rows.filter((r) => r.kind === "export").map((r) => r.text)).toEqual(["Exported Revenue by month, Vendor costs for 2026-01-01 to 2026-03-31"]);
    void (null as unknown as Id<"invoices">);
  });
});
