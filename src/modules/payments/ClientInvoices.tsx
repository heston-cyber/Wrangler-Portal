// Phase 2 Part B, step 3: the client's Payments › Invoices (frames 222:3950 desktop, 222:4433 phone).
// "Everything you've been billed for, and what's left to pay." Pills All / To pay / Paid; groups To pay, On its way,
// Paid (and Closed for a cancelled one). Every row opens the invoice page; rows still to pay have Pay.
import { useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { ButtonLink, Card, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Sep, TopBar } from "../../shell/Shell";
import { InvoiceChip, dateShort, money, type InvoiceStatus } from "./common";

type Row = FunctionReturnType<typeof api.invoicePay.mine>[number];
type Filter = "all" | "topay" | "paid";
const TO_PAY: InvoiceStatus[] = ["due", "overdue", "partly_paid", "failed"];

function meta(r: Row) {
  const bits = [r.number];
  const s = r.status as InvoiceStatus;
  if (s === "processing") bits.push(`bank payment started ${r.processingSince ? dateShort(r.processingSince) : ""}`.trim(), "clears in a few business days");
  else {
    if (r.project) bits.push(r.project);
    if (s === "partly_paid") bits.push(`${money(r.amountPaidCents)} of ${money(r.totalCents)} paid`);
    if (s === "paid") bits.push(`paid ${r.paidAt ? dateShort(r.paidAt) : ""}`.trim());
    else if (s === "void") bits.push(`cancelled ${r.voidedAt ? dateShort(r.voidedAt) : ""}`.trim());
    else if (s === "overdue") bits.push(`was due ${dateShort(r.dueDate)}`);
    else if (s === "failed") bits.push(`payment didn't go through · due ${dateShort(r.dueDate)}`);
    else bits.push(`due ${dateShort(r.dueDate)}`);
  }
  return bits.filter(Boolean).join(" · ");
}

function InvoiceRow({ r }: { r: Row }) {
  const s = r.status as InvoiceStatus;
  const to = `/i/${r.token}`;
  return (
    <ListRow className="ilead inv-row" to={TO_PAY.includes(s) ? undefined : to} lead={{ icon: "invoice" }} title={r.title} meta={meta(r)}
      trailing={<span className="inv-amt">{money(TO_PAY.includes(s) ? r.amountRemainingCents : r.totalCents)}</span>} chip={<InvoiceChip status={s} />}
      action={TO_PAY.includes(s) ? <ButtonLink size="sm" to={to} iconEnd={false}>Pay</ButtonLink> : <Icon name="chevron-right" size={16} className="go" />} />
  );
}

function Group({ label, rows }: { label: string; rows: Row[] }) {
  if (!rows.length) return null;
  return <Card label={label} head={<SectionHead label={label} count={rows.length} />}>{rows.map((r, i) => <div key={r.token} className="wp-rowwrap">{i > 0 && <Divider />}<InvoiceRow r={r} /></div>)}</Card>;
}

export default function ClientInvoices() {
  const rows = useQuery(api.invoicePay.mine, {});
  const [filter, setFilter] = useState<Filter>("all");
  const by = (ss: InvoiceStatus[]) => (rows ?? []).filter((r) => ss.includes(r.status as InvoiceStatus));
  const topay = by(TO_PAY), onway = by(["processing"]), paid = by(["paid"]), closed = by(["void", "uncollectible"]);
  return (
    <>
      <TopBar><span className="secondary">Payments</span><Sep /><span className="here">Invoices</span></TopBar>
      <div className="wp-page inv-list">
        <PageHeader eyebrow="Payments" title="Invoices." sub="Everything you've been billed for, and what's left to pay." />
        {rows === undefined ? <Card label="Invoices"><SkeletonRows n={3} /></Card>
          : rows.length === 0 ? <EmptyState icon="invoice" title="No invoices." />
          : <>
            <PillTabs label="Show" value={filter} onChange={setFilter} items={[{ key: "all", label: "All", count: rows.length }, { key: "topay", label: "To pay", count: topay.length }, { key: "paid", label: "Paid", count: paid.length }]} />
            {filter !== "paid" && <Group label="To pay" rows={topay} />}
            {filter === "all" && <Group label="On its way" rows={onway} />}
            {filter !== "topay" && <Group label="Paid" rows={paid} />}
            {filter === "all" && <Group label="Closed" rows={closed} />}
          </>}
      </div>
    </>
  );
}
