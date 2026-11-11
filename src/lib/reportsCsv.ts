// Phase 5e step 5 (Nov 6): Export for accountant. One CSV per report, from the Reports page's own rows (reports.page).
// Amounts are plain dollars with two decimals (no "$", no thousands commas) so a spreadsheet reads them as numbers.
// Any text cell that a spreadsheet would run as a formula (starting with = + - @, a tab or a return) gets a leading
// apostrophe, so a client's or vendor's name can't do anything when the file is opened.
import { strToU8, zipSync } from "fflate";

export type Cell = string | number | null | undefined;
const FORMULA = /^[=+\-@\t\r]/;

export function cell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = FORMULA.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csv = (rows: Cell[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
export const dollars = (cents: number) => Math.round(cents) / 100;

type Page = {
  from: string; to: string; today: string;
  months: Array<{ month: string; paidCents: number; invoicedCents: number }>;
  byProject: Array<{ project: string; client: string | null; priceCents: number; billed: boolean; costCents: number; profitCents: number; estimateProfitCents: number | null }> | null;
  outstanding: { invoices: Array<{ title: string; number: string | null; client: string | null; due: string; daysLate: number; cents: number; bucket: string }> };
  vendors: Array<{ vendor: string; cents: number; invoices: number }> | null;
  funnel: { stages: Array<{ label: string; count: number }>; leads: number };
  detail: { vendorPaid: Array<{ day: string; vendor: string; number: string; project: string | null; cents: number }> | null };
};

export const REPORT_FILES = {
  revenue: (p: Page): Cell[][] => [["Month", "Invoiced (USD)", "Paid (USD)"], ...p.months.map((m) => [m.month, dollars(m.invoicedCents), dollars(m.paidCents)])],
  profit: (p: Page): Cell[][] => [["Project", "Client", "Revenue (USD)", "Billed in full", "Costs (USD)", "Profit (USD)", "Estimated profit (USD)"],
    ...(p.byProject ?? []).map((x) => [x.project, x.client, dollars(x.priceCents), x.billed ? "Yes" : "No, the estimate", dollars(x.costCents), dollars(x.profitCents), x.estimateProfitCents === null ? null : dollars(x.estimateProfitCents)])],
  outstanding: (p: Page): Cell[][] => [[`Outstanding as of ${p.today}`], ["Invoice", "Number", "Client", "Due", "Days late", "How late", "Owed (USD)"],
    ...p.outstanding.invoices.map((x) => [x.title, x.number, x.client, x.due, x.daysLate, x.bucket, dollars(x.cents)])],
  vendors: (p: Page): Cell[][] => [["Vendor", "Invoices paid", "Paid (USD)"], ...(p.vendors ?? []).map((x) => [x.vendor, x.invoices, dollars(x.cents)]),
    [], ["Paid on", "Vendor", "Their invoice", "Project", "Paid (USD)"], ...(p.detail.vendorPaid ?? []).map((x) => [x.day, x.vendor, x.number, x.project, dollars(x.cents)])],
  funnel: (p: Page): Cell[][] => [["Stage", "Leads that reached it", "Share of leads"], ...p.funnel.stages.map((s) => [s.label, s.count, p.funnel.leads ? `${Math.round((s.count / p.funnel.leads) * 100)}%` : null])],
} as const;
export type FileKey = keyof typeof REPORT_FILES;
export const FILE_NAME: Record<FileKey, string> = { revenue: "revenue-by-month", profit: "profit-by-project", outstanding: "outstanding-invoices", vendors: "vendor-costs", funnel: "lead-to-job" };

/** One CSV, or a zip of several, named for the range. */
export function exportFiles(p: Page, keys: FileKey[], business: string): { name: string; type: string; bytes: Uint8Array } {
  const slug = business.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "reports";
  const range = `${p.from}-to-${p.to}`;
  if (keys.length === 1) return { name: `${slug}-${FILE_NAME[keys[0]]}-${range}.csv`, type: "text/csv", bytes: strToU8(csv(REPORT_FILES[keys[0]](p))) };
  const files: Record<string, Uint8Array> = {};
  for (const k of keys) files[`${FILE_NAME[k]}-${range}.csv`] = strToU8(csv(REPORT_FILES[k](p)));
  return { name: `${slug}-reports-${range}.zip`, type: "application/zip", bytes: zipSync(files, { level: 6 }) };
}
