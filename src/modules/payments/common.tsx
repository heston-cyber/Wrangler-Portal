// Phase 2 Part B: pieces shared by the invoice list, the New invoice form and the invoice page (S5 · Phase 2).
import { useEffect, useState } from "react";
import { StatusChip } from "../../ui/wp";
import { BrandImg } from "../../ui/BrandImg";

export type InvoiceStatus = "draft" | "sending" | "due" | "overdue" | "partly_paid" | "processing" | "failed" | "paid" | "void" | "uncollectible";
export type Line = { id: string; description: string; qty: number; unitCents: number };

export const money = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dateLong = (iso: string) => { const d = new Date(`${iso}T12:00:00`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
export const dateShort = (t: number | string) => (typeof t === "string" ? new Date(`${t}T12:00:00`) : new Date(t)).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const isoIn = (days: number) => { const d = new Date(Date.now() + days * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const newId = () => Math.random().toString(36).slice(2, 10);

export function totals(i: { lines: Array<{ qty: number; unitCents: number }>; discountCents?: number; taxPercent?: number }) {
  const subtotal = i.lines.reduce((s, l) => s + Math.round(l.qty * l.unitCents), 0);
  const discount = Math.min(Math.max(0, i.discountCents ?? 0), subtotal);
  // Stripe works tax out on each line (the discount is its own negative line) and rounds each, so the portal does too.
  const pct = Math.max(0, i.taxPercent ?? 0) / 100;
  const tax = pct ? i.lines.reduce((t, l) => t + Math.round(Math.round(l.qty * l.unitCents) * pct), 0) - (discount ? Math.round(discount * pct) : 0) : 0;
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

const CHIP: Record<InvoiceStatus, { tone: "accent" | "success" | "warning" | "neutral" | "danger"; text: string }> = {
  draft: { tone: "neutral", text: "Draft" }, sending: { tone: "neutral", text: "Sending" }, due: { tone: "warning", text: "Due" },
  overdue: { tone: "accent", text: "Overdue" }, partly_paid: { tone: "accent", text: "Partly paid" }, processing: { tone: "accent", text: "Processing" },
  failed: { tone: "accent", text: "Payment failed" }, paid: { tone: "success", text: "Paid" }, void: { tone: "neutral", text: "Void" }, uncollectible: { tone: "neutral", text: "Uncollectible" },
};
export const InvoiceChip = ({ status }: { status: InvoiceStatus }) => <StatusChip tone={CHIP[status].tone}>{CHIP[status].text}</StatusChip>;

/** The invoice as the client sees it: on the New invoice preview, the owner's invoice page, the client's page. */
export function InvoicePaper({ business, number, issued, due, billTo, project, lines, discountCents, taxPercent, amountPaidCents = 0, memo, payments }: {
  business: { name: string; legalName: string | null; logoUrl?: string | null; email?: string | null; address?: string | null; privacyUrl?: string | null }; number: string; issued: string; due: string;
  billTo: { name: string; email: string; company?: string }; project?: string | null; lines: Line[]; discountCents?: number; taxPercent?: number;
  amountPaidCents?: number; memo?: string; payments?: Array<{ at: string; method: string; cents: number }>;
}) {
  const t = totals({ lines, discountCents, taxPercent });
  const legal = business.legalName ? `a DBA of ${business.legalName.replace(/^.*?,?\s*a DBA of\s*/i, "")}` : null;
  return (
    <article className="inv-paper">
      <header className="inv-top">
        <div className="who"><span className="logo">{business.logoUrl ? <img src={business.logoUrl} alt="" /> : <BrandImg name="wordmark" alt="" />}</span><span><b>{business.name}</b>{legal && <small>{legal}</small>}</span></div>
        <div className="num"><span>Invoice</span><b>{number}</b></div>
      </header>
      <dl className="inv-meta">
        <div className="bill"><dt>Bill to</dt><dd>{billTo.name || "—"}{billTo.company && <><br />{billTo.company}</>}{billTo.email && <><br />{billTo.email}</>}</dd></div>
        <div><dt>Issued</dt><dd>{issued}</dd></div>
        <div><dt>Due</dt><dd>{due}</dd></div>
        {project && <div className="proj"><dt>Project</dt><dd>{project}</dd></div>}
      </dl>
      <table className="inv-lines">
        <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
        <tbody>{lines.length ? lines.map((l) => <tr key={l.id}><td>{l.description || <span className="secondary">Line item</span>}</td><td>{l.qty}</td><td>{money(l.unitCents)}</td><td>{money(Math.round(l.qty * l.unitCents))}</td></tr>) : <tr><td colSpan={4} className="secondary">No line items yet.</td></tr>}</tbody>
      </table>
      <dl className="inv-sums">
        <dt>Subtotal</dt><dd>{money(t.subtotal)}</dd>
        <dt>Discount</dt><dd>{t.discount ? `−${money(t.discount)}` : "—"}</dd>
        <dt>Tax</dt><dd>{t.tax ? `${money(t.tax)} (${taxPercent}%)` : "—"}</dd>
        <dt className="tot">Total</dt><dd className="tot">{money(t.total)}</dd>
        <dt>Amount paid</dt><dd>{amountPaidCents ? `−${money(amountPaidCents)}` : money(0)}</dd>
        <dt className="rem">Amount remaining</dt><dd className="rem">{money(Math.max(0, t.total - amountPaidCents))}</dd>
      </dl>
      {payments && payments.length > 0 && (
        <div className="inv-pays"><span className="lbl">Payments</span>{payments.map((p, i) => <div key={i}><span>{p.at}</span><span>{p.method}</span><b>{money(p.cents)}</b></div>)}</div>
      )}
      <footer className="inv-foot">
        {memo && <p className="memo">{memo}</p>}
        <p className="legal">{[`${business.name}${business.legalName ? `, ${legal}` : ""}`, business.email, business.address].filter(Boolean).join(" · ")}{business.privacyUrl && <> · <a href={business.privacyUrl} target="_blank" rel="noopener noreferrer">Privacy policy</a></>}</p>
      </footer>
    </article>
  );
}

const centsOf = (s: string) => { const n = Number(s.replace(/[$,\s]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const dollarsOf = (c: number) => (c ? (c / 100).toFixed(2) : "");
/** A dollar amount field that holds cents. */
export function MoneyInput({ value, onChange, label, placeholder = "0.00" }: { value: number; onChange: (c: number) => void; label: string; placeholder?: string }) {
  const [text, setText] = useState(dollarsOf(value));
  useEffect(() => { if (centsOf(text) !== value) setText(dollarsOf(value)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [value]);
  return <span className="inv-money"><span>$</span><input className="input" inputMode="decimal" aria-label={label} value={text} placeholder={placeholder} onChange={(e) => { setText(e.target.value); onChange(centsOf(e.target.value)); }} onBlur={() => setText(dollarsOf(value))} /></span>;
}
