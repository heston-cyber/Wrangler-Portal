// Phase 5e step 5 (Nov 6): Payments › Reports (Design Log › Phase 5e › Reports: chart view 828:23224, table view
// 828:24131, empty 828:25041, loading 828:25566, long list 828:26159, Bookkeeper 828:27139, phone 829:23397), the
// Export for accountant dialog (826:25852, making the file 826:25954), and the Dashboard's Reports widgets (829:24616).
// One accent hue for every chart (each shows one series, so no legend: the title names it); every chart has its table.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, Card, Checkbox, DialogHeader, EmptyState, ListRow, PageHeader, SectionHead, SkeletonRows } from "../../ui/wp";
import { Modal } from "../../ui/kit";
import { linkProps } from "../../lib/router";
import { TopBar, Sep } from "../../shell/Shell";
import { errText } from "../docs/pages/common";
import { exportFiles, type FileKey } from "../../lib/reportsCsv";
import { usePerms } from "../../lib/teamAccess";
import { MonthBars, TZ, iso, monthLabel, rangeText, usd } from "./ReportsWidgets";

type Preset = "month" | "3months" | "year" | "lastyear" | "custom";
const PRESETS: Array<{ key: Preset; label: string; phone?: string }> = [
  { key: "month", label: "This month" }, { key: "3months", label: "Last 3 months", phone: "3 months" }, { key: "year", label: "This year" }, { key: "lastyear", label: "Last year" }, { key: "custom", label: "Custom" },
];
function presetRange(p: Exclude<Preset, "custom">): { from: string; to: string } {
  const t = new Date();
  if (p === "month") return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) };
  if (p === "3months") return { from: iso(new Date(t.getFullYear(), t.getMonth() - 2, 1)), to: iso(t) };
  if (p === "lastyear") return { from: `${t.getFullYear() - 1}-01-01`, to: `${t.getFullYear() - 1}-12-31` };
  return { from: `${t.getFullYear()}-01-01`, to: iso(t) };
}

/** Chart / Table, as drawn. */
function View({ table, set }: { table: boolean; set: (t: boolean) => void }) {
  return (
    <div className="qz-chips rp-view" role="group" aria-label="Show as">
      <button type="button" className={`qz-chip${!table ? " on" : ""}`} aria-pressed={!table} onClick={() => set(false)}>Chart</button>
      <button type="button" className={`qz-chip${table ? " on" : ""}`} aria-pressed={table} onClick={() => set(true)}>Table</button>
    </div>
  );
}

/** Rows with a bar for each: profit by project, vendor costs, lead to job. */
function Bars({ rows, value }: { rows: Array<{ key: string; label: string; n: number; tip?: string }>; value: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.n)));
  return (
    <div className="rp-bars">
      {rows.map((r) => (
        <div key={r.key} className={`rp-bar${r.n < 0 ? " neg" : ""}`} title={r.tip}>
          <span className="name">{r.label}</span>
          <span className="track"><i style={{ width: `${r.n === 0 ? 0 : Math.max(2, (Math.abs(r.n) / max) * 100)}%` }} /></span>
          <b>{value(r.n)}</b>
        </div>
      ))}
    </div>
  );
}

function Table({ head, rows, num }: { head: string[]; rows: Array<Array<React.ReactNode>>; num?: number[] }) {
  return (
    <div className="rp-table">
      <table className="wp-table">
        <thead><tr>{head.map((h, i) => <th key={i} className={num?.includes(i) ? "num" : undefined}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={num?.includes(j) ? "num" : undefined}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const { perms, team } = usePerms();
  const [preset, setPreset] = useState<Preset>("year");
  const [custom, setCustom] = useState(() => presetRange("year"));
  const [editing, setEditing] = useState(false);
  const range = preset === "custom" ? custom : presetRange(preset);
  const ok = !!range.from && !!range.to && range.from <= range.to;
  const r = useQuery(api.reports.page, ok ? { ...range, tz: TZ } : "skip");
  const brand = useQuery(api.business.brand);
  const [views, setViews] = useState({ revenue: false, profit: false, vendors: false });
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const yearSoFar = preset === "year";
  const seesValue = !team || perms.value;

  const rangeBtn = <Button variant="secondary" onClick={() => { setPreset("custom"); setEditing((e) => !e); }} aria-expanded={editing}>{ok ? rangeText(range.from, range.to) : "Pick a range"}</Button>;
  return (
    <>
      <TopBar><a {...linkProps("/payments")}>Payments</a><Sep /><span className="here">Reports</span></TopBar>
      <div className="wp-page rp-page">
        <PageHeader title="Reports" sub="Revenue, profit and what is outstanding."
          actions={<>{rangeBtn}<Button variant="primary" disabled={!r || r.empty} onClick={() => setExporting(true)}>Export for accountant</Button></>} />
        <div className="qz-chips act-pills rp-presets" role="group" aria-label="Range">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" className={`qz-chip${preset === p.key ? " on" : ""}`} aria-pressed={preset === p.key}
              onClick={() => { if (p.key === "custom") { setCustom(range); setEditing(true); } else setEditing(false); setPreset(p.key); }}>
              <span className="full">{p.label}</span>{p.phone && <span className="short">{p.phone}</span>}
            </button>
          ))}
        </div>
        {preset === "custom" && editing && (
          <div className="rp-custom">
            <label className="wp-field"><span className="wp-field-label">From</span><input className="input" type="date" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
            <label className="wp-field"><span className="wp-field-label">To</span><input className="input" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
            <span className="wp-small secondary">Reports and exports use this range.</span>
          </div>
        )}
        {msg && <p className="wp-small secondary" role="status">{msg}</p>}

        {!ok ? <EmptyState icon="calendar" title="Pick a start and an end date." body="The start has to come before the end." />
          : r === undefined ? <Loading />
          : r.empty ? <EmptyState icon="activity" title="Nothing to report yet" body="Reports fill in as invoices are sent and paid." actions={<Button variant="secondary" onClick={() => { setPreset("lastyear"); setEditing(false); }}>Pick another range</Button>} />
          : (
            <>
              <div className="pov-stats ov-tiles rp-tiles">
                <Stat label="Revenue" n={usd(r.tiles.revenueCents)} sub={rangeText(r.from, r.to).replace(/, \d{4}$/, "")} />
                <Stat label="Profit" n={usd(r.tiles.profitCents)} sub="After vendor costs" />
                <Stat label="Outstanding" n={usd(r.tiles.outstandingCents)} sub={`${r.tiles.outstandingCount} ${r.tiles.outstandingCount === 1 ? "invoice" : "invoices"}`} />
                <Stat label="Lead-to-job rate" n={r.tiles.leadToJob === null ? "–" : `${r.tiles.leadToJob}%`} sub={`${r.tiles.jobs} of ${r.tiles.leads} ${r.tiles.leads === 1 ? "lead" : "leads"}`} />
              </div>
              <div className="rp-grid">
                <div className="rp-main">
                  <Card className="rp-o-revenue" label="Revenue by month" head={<SectionHead label="Revenue by month" />}>
                    <div className="rp-body">
                      <View table={views.revenue} set={(t) => setViews((v) => ({ ...v, revenue: t }))} />
                      {views.revenue
                        ? <Table head={["Month", "Invoiced", "Paid"]} num={[1, 2]} rows={r.months.map((m) => [monthLabel(m.month, false), usd(m.invoicedCents, true), usd(m.paidCents, true)])} />
                        : <MonthBars months={r.months.map((m) => ({ month: m.month, cents: m.paidCents, extra: `${usd(m.invoicedCents, true)} invoiced` }))} />}
                      <p className="wp-small secondary">Money received, on the day it was paid, less refunds.</p>
                    </div>
                  </Card>
                  {seesValue && r.byProject && (
                    <Card className="rp-o-profit" label="Profit by project" head={<SectionHead label="Profit by project" count={r.byProject.length} />}>
                      <div className="rp-body">
                        <View table={views.profit} set={(t) => setViews((v) => ({ ...v, profit: t }))} />
                        {!r.byProject.length ? <p className="wp-small secondary">No project had money or logged work in this range.</p>
                          : views.profit
                            ? <Table head={["Project", "Revenue", "Costs", "Profit"]} num={[1, 2, 3]} rows={r.byProject.map((p) => [<a key="l" {...linkProps(`/projects/${p._id}`)}>{p.client ? `${p.project} · ${p.client}` : p.project}</a>, usd(p.priceCents, true), usd(p.costCents, true), usd(p.profitCents, true)])} />
                            : <Bars value={(n) => usd(n)} rows={r.byProject.map((p) => ({ key: p._id, label: p.client ? `${p.project} · ${p.client}` : p.project, n: p.profitCents, tip: `${usd(p.priceCents, true)} ${p.billed ? "billed" : "estimated"} · ${usd(p.costCents, true)} costs` }))} />}
                        <p className="wp-small secondary">The whole job, from each project's Ledger.</p>
                      </div>
                    </Card>
                  )}
                  <Card className="rp-o-vendors" label="Vendor costs" head={<SectionHead label="Vendor costs" />}>
                    <div className="rp-body">
                      <View table={views.vendors} set={(t) => setViews((v) => ({ ...v, vendors: t }))} />
                      {!r.vendors.length ? <p className="wp-small secondary">No vendor invoices were paid in this range.</p>
                        : views.vendors
                          ? <Table head={["Vendor", "Invoices", "Paid"]} num={[1, 2]} rows={r.vendors.map((x) => [x.vendor, x.invoices, usd(x.cents, true)])} />
                          : <Bars value={(n) => usd(n)} rows={r.vendors.map((x) => ({ key: x.vendor, label: x.vendor, n: x.cents }))} />}
                    </div>
                  </Card>
                </div>
                <div className="rp-side">
                  <Card className="rp-o-sum" label={yearSoFar ? "The year so far" : "This range"} head={<SectionHead label={yearSoFar ? "The year so far" : "This range"} />}>
                    <dl className="rp-sum">
                      <dt className="strong">Revenue</dt><dd className="strong">{usd(r.summary.revenueCents)}</dd>
                      <dt>Vendor costs</dt><dd>{usd(r.summary.vendorCents)}</dd>
                      <dt className="strong">Profit</dt><dd className="strong">{usd(r.summary.profitCents)}</dd>
                      <dt>Jobs finished</dt><dd>{r.summary.jobsFinished}</dd>
                      <dt>Average job</dt><dd>{r.summary.averageJobCents === null ? "–" : usd(r.summary.averageJobCents)}</dd>
                    </dl>
                  </Card>
                  <Card className="rp-o-outstanding" label="Outstanding invoices" head={<SectionHead label="Outstanding invoices" count={r.tiles.outstandingCount} />}>
                    {r.outstanding.buckets.map((b) => (
                      <ListRow key={b.key} lead={{ icon: "invoice" }} title={b.label} meta={`${b.count} ${b.count === 1 ? "invoice" : "invoices"}`} trailing={usd(b.cents)}
                        to="/payments/invoices?show=due" chevron />
                    ))}
                  </Card>
                  <Card className="rp-o-funnel" label="Lead to job" head={<SectionHead label="Lead to job" />}>
                    <div className="rp-body">
                      <Bars value={(n) => String(n)} rows={r.funnel.stages.map((s) => ({ key: s.label, label: s.label, n: s.count }))} />
                      <p className="rp-foot">Lead to Paid: {r.funnel.leadToPaid === null ? "–" : `${r.funnel.leadToPaid}%`}</p>
                    </div>
                  </Card>
                </div>
              </div>
              <div className="rp-phone-export"><Button variant="primary" onClick={() => setExporting(true)}>Export for accountant</Button></div>
            </>
          )}
      </div>
      {exporting && r && <ExportDialog data={r} canProfit={seesValue && !!r.byProject} business={brand?.[0]?.name ?? "reports"} onClose={() => setExporting(false)} done={(m) => { setExporting(false); setMsg(m); }} />}
    </>
  );
}

function Stat({ label, n, sub }: { label: string; n: React.ReactNode; sub: string }) {
  return <div className="pov-stat prod-tile rp-stat"><span className="lbl">{label}</span><b>{n}</b><span className="sub">{sub}</span></div>;
}

function Loading() {
  return (
    <>
      <div className="pov-stats ov-tiles rp-tiles" aria-hidden>{[0, 1, 2, 3].map((i) => <div key={i} className="pov-stat prod-tile"><SkeletonRows n={1} /></div>)}</div>
      <Card label="Loading reports"><SkeletonRows n={4} label="Loading reports" /></Card>
    </>
  );
}

type PageData = NonNullable<ReturnType<typeof useQuery<typeof api.reports.page>>>;
const FILES: Array<{ key: FileKey; label: string; sub: string }> = [
  { key: "revenue", label: "Revenue by month", sub: "Invoiced and paid" },
  { key: "profit", label: "Profit by project", sub: "Revenue, vendor costs and profit" },
  { key: "outstanding", label: "Outstanding invoices", sub: "By how late they are" },
  { key: "vendors", label: "Vendor costs", sub: "Paid to each vendor" },
  { key: "funnel", label: "Lead to job", sub: "From the pipeline" },
];

function ExportDialog({ data, canProfit, business, onClose, done }: { data: PageData; canProfit: boolean; business: string; onClose: () => void; done: (m: string) => void }) {
  const files = useMemo(() => FILES.filter((f) => f.key !== "profit" || canProfit), [canProfit]);
  const [pick, setPick] = useState<Set<FileKey>>(() => new Set(files.filter((f) => f.key !== "funnel").map((f) => f.key)));
  const [making, setMaking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const log = useMutation(api.reports.logExport);
  const go = async () => {
    setMaking(true); setErr(null);
    try {
      const keys = files.map((f) => f.key).filter((k) => pick.has(k));
      const out = exportFiles(data as never, keys, business);
      await log({ from: data.from, to: data.to, reports: keys });
      const url = URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: out.type }));
      const a = document.createElement("a");
      a.href = url; a.download = out.name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      done(`Downloaded ${out.name}.`);
    } catch (e) { setErr(errText(e)); setMaking(false); }
  };
  return (
    <Modal onClose={making ? () => {} : onClose} label="Export for your accountant" width={700}>
      <div className="crm-dialog team-dialog rp-export">
        {making ? (
          <>
            <DialogHeader eyebrow="Reports" title="Making your export" body="This can take a moment for a long range." />
            <SkeletonRows n={2} label="Making your export" />
            <div className="dfoot"><span /><button className="btn ghost" type="button" onClick={onClose}>Cancel</button></div>
          </>
        ) : (
          <>
            <DialogHeader eyebrow="Reports" title="Export for your accountant" body={`A CSV for each report you pick, for ${rangeText(data.from, data.to)}.`} onClose={onClose} />
            <div className="rp-picks">
              {files.map((f) => <Checkbox key={f.key} checked={pick.has(f.key)} label={f.label} hint={f.sub} onChange={(on) => setPick((s) => { const n = new Set(s); if (on) n.add(f.key); else n.delete(f.key); return n; })} />)}
            </div>
            <label className="wp-field"><span className="wp-field-label">Range</span><input className="input" readOnly value={rangeText(data.from, data.to)} /></label>
            {err && <p className="wp-small" role="alert" style={{ color: "var(--text-danger, #ff6b6b)" }}>{err}</p>}
            <div className="dfoot"><button className="btn ghost" type="button" onClick={onClose}>Cancel</button><Button variant="primary" disabled={!pick.size} onClick={() => void go()}>{pick.size > 1 ? "Download CSVs" : "Download CSV"}</Button></div>
          </>
        )}
      </div>
    </Modal>
  );
}
