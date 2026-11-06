// Phase 5e step 5 (Nov 6): the Dashboard's Reports widgets (829:24616): Revenue this year (paid by month) and
// Outstanding (not due yet, late). Shown to the owner and to a team member with Reports (the Bookkeeper).
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { ButtonLink, Card, ListRow, SectionHead, SkeletonRows } from "../../ui/wp";

export const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago"; } catch { return "America/Chicago"; } })();
const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const usd = (c: number, cents = false) => `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })}`;
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (d: string) => `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
export const rangeText = (from: string, to: string) => (from.slice(0, 4) === to.slice(0, 4) ? `${md(from)} – ${md(to)}, ${to.slice(0, 4)}` : `${md(from)}, ${from.slice(0, 4)} – ${md(to)}, ${to.slice(0, 4)}`);
export const monthLabel = (m: string, short: boolean) => (short ? MONTHS[+m.slice(5, 7) - 1] : `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`);

/** Columns for money by month, with a tooltip on hover or focus. */
export function MonthBars({ months, short }: { months: Array<{ month: string; cents: number; extra?: string }>; short?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...months.map((m) => m.cents));
  const few = months.length <= 12;
  const every = few ? 1 : Math.ceil(months.length / 12);
  return (
    <div className="rp-cols" role="img" aria-label="Paid by month" onMouseLeave={() => setHover(null)}>
      {months.map((m, i) => (
        <div key={m.month} className={`rp-col${hover === i ? " on" : ""}`} tabIndex={0} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
          aria-label={`${monthLabel(m.month, false)}: ${usd(m.cents, true)}`}>
          <span className="bar" style={{ height: `${m.cents > 0 ? Math.max(3, (m.cents / max) * 100) : 0}%` }} />
          <span className="lbl">{i % every === 0 ? (short ? monthLabel(m.month, true).slice(0, 1) : few ? monthLabel(m.month, true) : monthLabel(m.month, false)) : ""}</span>
          {hover === i && <span className="tip" role="tooltip"><b>{usd(m.cents, true)}</b>{monthLabel(m.month, false)}{m.extra ? ` · ${m.extra}` : ""}</span>}
        </div>
      ))}
    </div>
  );
}


const thisYearText = (from: string, to: string) => rangeText(from, to);

export function RevenueYearCard() {
  const w = useQuery(api.reports.widgets, { tz: TZ });
  return (
    <Card key="revenue_year" className="rp-widget" label="Revenue this year" head={<SectionHead label="Revenue this year" action={<ButtonLink size="sm" variant="ghost" to="/payments/reports" iconEnd={false}>Reports</ButtonLink>} />}>
      {w === undefined ? <SkeletonRows n={3} /> : (
        <div className="rp-body">
          <div className="rp-big"><b>{usd(w.revenueCents)}</b><span className="wp-small secondary">{thisYearText(w.from, w.to)}</span></div>
          <MonthBars short months={w.months} />
        </div>
      )}
    </Card>
  );
}

export function OutstandingCard() {
  const w = useQuery(api.reports.widgets, { tz: TZ });
  const late = w ? w.outstanding.slice(1).reduce((t, b) => ({ cents: t.cents + b.cents, count: t.count + b.count }), { cents: 0, count: 0 }) : null;
  return (
    <Card key="outstanding" label="Outstanding" head={<SectionHead label="Outstanding" count={w?.outstandingCount || undefined} action={<ButtonLink size="sm" variant="ghost" to="/payments/reports" iconEnd={false}>Reports</ButtonLink>} />}>
      {w === undefined || !late ? <SkeletonRows n={2} /> : (
        <>
          <ListRow lead={{ icon: "invoice" }} title="Not due yet" meta={`${w.outstanding[0].count} ${w.outstanding[0].count === 1 ? "invoice" : "invoices"}`} trailing={usd(w.outstanding[0].cents, true)} to="/payments/invoices?show=due" chevron />
          <ListRow lead={{ icon: "invoice" }} title="Late" meta={`${late.count} ${late.count === 1 ? "invoice" : "invoices"}`} trailing={usd(late.cents, true)} to="/payments/invoices?show=due" chevron />
        </>
      )}
    </Card>
  );
}
