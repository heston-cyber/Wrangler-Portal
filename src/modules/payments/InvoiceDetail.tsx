// Phase 2 Part B, step 2: one invoice (frames 230:5785 Due, 230:6964 Paid, Void dialog 230:7611). A draft opens in
// the editor instead. Actions: Download PDF and Open in Stripe (Stripe's for now; the portal's own PDF and Send
// reminder come with the emails), Void. History: what happened, newest last.
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { Button, Card, SectionHead, SkeletonRows } from "../../ui/wp";
import { Icon, type IconName } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { errText } from "../docs/pages/common";
import InvoiceEditor from "./InvoiceEditor";
import { downloadPdf, pdfData } from "./pdfDownload";
import { InvoiceChip, InvoicePaper, dateLong, dateShort, money, type InvoiceStatus } from "./common";

const when = (t: number) => `${new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
const HIST: Record<string, { icon: IconName; text: (d?: string) => string }> = {
  created: { icon: "document", text: (d) => d ? `Made ${d}` : "Created" },
  sent: { icon: "send", text: (d) => `Sent${d ? ` to ${d}` : ""}` },
  emailed: { icon: "mail", text: (d) => `Emailed${d ? ` to ${d}` : ""}` },
  email_held: { icon: "mail", text: (d) => `Email held by the preview${d ? ` (${d} isn't on its list)` : ""}` },
  processing: { icon: "clock", text: (d) => `Bank payment started${d ? ` · ${d}` : ""}` },
  viewed: { icon: "eye", text: (d) => `Viewed${d ? ` by ${d}` : ""}` },
  reminder: { icon: "bell", text: (d) => `Reminder sent${d ? ` · ${d}` : ""}` },
  part_paid: { icon: "check-circle", text: (d) => `Partly paid${d ? ` · ${d}` : ""}` },
  paid: { icon: "check-circle", text: () => "Paid in full" },
  failed: { icon: "alert", text: (d) => `Payment failed${d && d !== "A payment attempt failed" ? ` · ${d}` : ""}` },
  voided: { icon: "close", text: () => "Voided" },
  uncollectible: { icon: "close", text: () => "Marked uncollectible" },
  refunded: { icon: "arrow-left", text: (d) => d ?? "Refunded" },
  disputed: { icon: "alert", text: (d) => `Disputed${d ? ` · ${d}` : ""}` },
  dispute_closed: { icon: "info", text: (d) => d ?? "Dispute closed" },
  delivery_opened: { icon: "download", text: () => "Final files opened for the client" },
  delivery_waiting: { icon: "lock", text: () => "No final files added yet" },
  flagged: { icon: "alert", text: (d) => d ?? "Needs a look in Stripe" }, // review 3 #2
  renumbered: { icon: "info", text: (d) => d ?? "Given a new number" },
};

export default function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const i = useQuery(api.invoices.get, { invoiceId });
  const voidIt = useAction(api.invoices.voidInvoice);
  const clientLink = useMutation(api.invoicePay.ownerLink);
  const remind = useMutation(api.invoiceReminders.sendReminder);
  const emailIt = useMutation(api.invoices.emailIt); // Nov 21: one made without emailing
  const [emailing, setEmailing] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<null | "invoice" | "receipt">(null);
  const pdf = async (kind: "invoice" | "receipt") => {
    if (!i) return;
    setPdfBusy(kind);
    try {
      await downloadPdf(pdfData(kind, {
        business: i.business, number: i.number, sentAt: i.issuedAt ?? i.sentAt, createdAt: i.createdAt, dueDate: i.dueDate, billTo: i.billTo, project: i.project?.label ?? null,
        lines: i.lines, discountCents: i.discountCents, taxPercent: i.taxPercent, totalCents: i.totalCents, amountPaidCents: i.amountPaidCents, memo: i.memo,
        paidAt: i.paidAt, payments: i.payments, payUrl: i.payToken ? `${location.origin}/i/${i.payToken}` : null,
      }));
    } catch (e) { show(errText(e)); }
    setPdfBusy(null);
  };
  const sendReminder = async () => {
    setReminding(true);
    try { const r = await remind({ invoiceId: invoiceId as Id<"invoices"> }); show(`Reminder sent to ${r.name}.`); }
    catch (e) { show(errText(e)); }
    setReminding(false);
  };
  const copyPayLink = async () => {
    if (!i?.payToken) return;
    try { await navigator.clipboard.writeText(`${location.origin}/i/${i.payToken}`); show("Pay link copied."); }
    catch { show(`Couldn't copy. The link is ${location.origin}/i/${i.payToken}`); }
  };
  const sendNow = async () => {
    setEmailing(true);
    try { const r = await emailIt({ invoiceId: invoiceId as Id<"invoices"> }); show(`Emailed to ${r.to}.`); setEmailingAsk(false); }
    catch (e) { show(errText(e)); }
    setEmailing(false);
  };
  const [emailingAsk, setEmailingAsk] = useState(false);
  const openClientPage = async () => {
    const w = window.open("", "_blank"); // opened now, while the click still counts, so it isn't blocked
    try { const url = await clientLink({ invoiceId: invoiceId as Id<"invoices"> }); if (w) w.location.href = url; else window.location.href = url; }
    catch (e) { w?.close(); show(errText(e)); }
  };
  const [toast, show] = useToast();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (i === undefined) return <><TopBar><a {...linkProps("/payments/invoices")}>Invoices</a></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (i === null) return <><TopBar><a {...linkProps("/payments/invoices")}>Invoices</a></TopBar><div className="wp-page"><p className="secondary">This invoice isn't here.</p></div></>;
  if (i.status === "draft" || i.status === "sending") return <InvoiceEditor invoiceId={invoiceId} />;
  const s = i.status as InvoiceStatus;
  const number = i.number ?? "—";
  const first = i.billTo.name.split(/\s+/)[0] || "They";
  const sub = [i.client?.name, i.project?.label, s === "paid" && i.paidAt ? `paid ${dateShort(i.paidAt)}` : s === "void" ? "void" : `due ${dateShort(i.dueDate)}`].filter(Boolean).join(" · ");
  const stripeLink = i.stripe ? `https://dashboard.stripe.com/${i.stripe.livemode ? "" : "test/"}invoices/${i.stripe.invoiceId}` : null;
  const canVoid = s === "due" || s === "overdue" || s === "failed";
  const quiet = i.notEmailed && s !== "paid" && s !== "void" && s !== "uncollectible"; // made without emailing, still to pay
  return (
    <>
      <TopBar><span className="secondary">Payments</span><Sep /><a {...linkProps("/payments/invoices")}>Invoices</a><Sep /><span className="here">{number}</span></TopBar>
      <div className="wp-page inv-detail">
        <header className="wp-pagehead inv-head">
          <div className="txt"><span className="wp-eyebrow">Invoice {number}</span><h1 className="wp-h2">{i.title}.</h1><p className="wp-body">{sub}</p></div>
          <InvoiceChip status={s} />
        </header>
        {i.sendError && <div className="wp-notice glass"><Icon name="alert" size={20} /><span className="txt"><b>Check this one in Stripe.</b> {i.sendError}</span></div>}
        {quiet && <div className="wp-notice glass"><Icon name="info" size={20} /><span className="txt"><b>Not emailed yet.</b> {first} can pay it from its link, but it isn't on their portal and no reminders go out until you press Email it.</span></div>}
        <div className="inv-cols">
          <div className="col">
            <InvoicePaper business={i.business ?? { name: "", legalName: null }} number={number} issued={dateLong(new Date(i.issuedAt ?? i.sentAt ?? i.createdAt).toISOString().slice(0, 10))} due={dateLong(i.dueDate)}
              billTo={i.billTo} project={i.project?.label} lines={i.lines} discountCents={i.discountCents} taxPercent={i.taxPercent} amountPaidCents={i.amountPaidCents} memo={i.memo} />
          </div>
          <div className="col right">
            <Card label="Actions" head={<SectionHead label="Actions" />}>
              <div className="inv-actions">
                {quiet && <Button variant="primary" icon="mail" onClick={() => setEmailingAsk(true)}>Email it</Button>}
                {i.notEmailed && i.payToken && s !== "void" && <Button variant={quiet ? "secondary" : "ghost"} icon="clipboard" onClick={() => void copyPayLink()}>Copy pay link</Button>}
                {i.reminders.canSend && <Button onClick={() => void sendReminder()} loading={reminding}>Send reminder</Button>}
                <Button variant={i.reminders.canSend ? "ghost" : "secondary"} icon="download" loading={pdfBusy === "invoice"} onClick={() => void pdf("invoice")}>Download PDF</Button>
                {i.status === "paid" && <Button variant="ghost" icon="download" loading={pdfBusy === "receipt"} onClick={() => void pdf("receipt")}>Download receipt</Button>}
                <Button variant="ghost" iconEnd="external" onClick={() => void openClientPage()}>Client's invoice page</Button>
                {stripeLink && <a className="btn ghost" href={stripeLink} target="_blank" rel="noopener noreferrer">Open in Stripe<Icon name="external" size={14} className="end" /></a>}
                {canVoid && <Button variant="ghost" onClick={() => setAsking(true)}>Void invoice</Button>}
              </div>
              {i.reminders.canSend && <p className="inv-remline">{[
                i.reminders.last ? `Last reminder: ${when(i.reminders.last)}` : null,
                i.reminders.auto ? (i.reminders.next ? `next: ${dateShort(i.reminders.next)} (automatic)` : "no more automatic reminders") : "Automatic reminders are off",
              ].filter(Boolean).join(" · ")}</p>}
              {(i.refundedCents > 0 || i.disputed) && <p className="inv-flag">{i.refundedCents > 0 && <>Refunded {money(i.refundedCents)}. </>}{i.disputed && <>Disputed ({i.disputed.status}). Respond in Stripe.</>}</p>}
            </Card>
            <Card label="History" head={<SectionHead label="History" />}>
              <ol className="inv-hist">
                {i.history.map((h, n) => { const k = HIST[h.kind] ?? { icon: "info" as IconName, text: () => h.kind }; return (
                  <li key={n}><Icon name={k.icon} size={16} /><span><b>{k.text(h.detail)}</b><small>{when(h.at)}{h.by ? ` · ${h.by}` : ""}</small></span></li>
                ); })}
                {(s === "due" || s === "overdue" || s === "partly_paid") && <li className="wait"><Icon name="clock" size={16} /><span><b>Waiting for payment</b><small>Due {dateLong(i.dueDate)}</small></span></li>}
              </ol>
            </Card>
          </div>
        </div>
      </div>
      {asking && (
        <Modal onClose={() => setAsking(false)} label="Void invoice" width={560}>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="dhead">
              <div style={{ display: "grid", gap: 6 }}>
                <span className="eyebrow">Invoice {number}</span>
                <h2 className="headline">Void this invoice?</h2>
                <p className="secondary" style={{ margin: 0 }}>{first} won't be able to pay it. The invoice page and the PDF will show "Void". This can't be undone.</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setAsking(false)} aria-label="Close"><Icon name="close" size={18} /></button>
            </div>
            <dl className="pay-rows boxed"><dt>Total</dt><dd>{money(i.totalCents)}</dd><dt>Amount paid</dt><dd>{money(i.amountPaidCents)}</dd><dt><b>Status after</b></dt><dd><b>Void</b></dd></dl>
            <div className="dfoot">
              <Button variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await voidIt({ invoiceId: invoiceId as Id<"invoices"> }); setAsking(false); show("Invoice voided."); } catch (e) { show(errText(e)); } setBusy(false); }}>Void invoice</Button>
            </div>
          </div>
        </Modal>
      )}
      {emailingAsk && (
        <Modal onClose={() => setEmailingAsk(false)} label="Email invoice" width={560}>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="dhead">
              <div style={{ display: "grid", gap: 6 }}>
                <span className="eyebrow">Invoice {number}</span>
                <h2 className="headline">Email it to {i.billTo.name || i.billTo.email}?</h2>
                <p className="secondary" style={{ margin: 0 }}>The portal emails it to {i.billTo.email} from {i.business?.name ?? "your business"}, with a “View and pay” button (the same link you copied). It goes on their portal, and the automatic reminders start.</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setEmailingAsk(false)} aria-label="Close"><Icon name="close" size={18} /></button>
            </div>
            {s === "overdue" && <p className="inv-flag" style={{ margin: 0 }}>Its due date ({dateLong(i.dueDate)}) has passed. The email shows that date, so they'll see it's already due. The automatic overdue reminders start {i.reminders.auto ? "a day or more after it goes" : "only if you turn them on"}.</p>}
            <dl className="pay-rows boxed"><dt>Bill to</dt><dd>{i.billTo.email}</dd><dt><b>Due now</b></dt><dd><b>{money(i.amountRemainingCents)}</b></dd><dt>Due date</dt><dd>{dateLong(i.dueDate)}</dd></dl>
            <div className="dfoot">
              <Button variant="ghost" onClick={() => setEmailingAsk(false)}>Cancel</Button>
              <Button variant="primary" loading={emailing} onClick={() => void sendNow()}>Email invoice</Button>
            </div>
          </div>
        </Modal>
      )}
      {toast}
    </>
  );
}
