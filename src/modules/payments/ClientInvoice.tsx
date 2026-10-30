// Phase 2 Part B, step 3: the client's invoice page, /i/<token> (frames 216:2622 Due, 216:3114 Overdue, 216:3598 Partly
// paid, 216:4092 Payment processing, 216:4489 Payment failed, 216:4984 Paid, 216:5387 Void; phones 218:3629–4306).
// The invoice on the left; on the right "Pay this invoice" with Stripe's Payment Element (card, Apple Pay and Google
// Pay where the device has them, US bank account), or the receipt, the processing note, or the void note.
// Card details go from the browser straight to Stripe, on the business's own Stripe account; the portal never sees them.
import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { loadStripe, type Appearance, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { api } from "../../../convex/_generated/api";
import type { ClientInvoice as Inv } from "../../../convex/invoicePay";
import { Button, Card, EmptyState, SkeletonRows } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { InvoiceChip, InvoicePaper, dateLong, dateShort, money, type InvoiceStatus } from "./common";
import lightClient from "../../assets/portal/light-elbow.jpg";
import { downloadPdf, pdfData } from "./pdfDownload";

const pdfOf = (inv: Inv, kind: "invoice" | "receipt") => pdfData(kind, {
  business: inv.business, number: inv.number, sentAt: inv.sentAt, dueDate: inv.dueDate, billTo: inv.billTo, project: inv.project, lines: inv.lines,
  discountCents: inv.discountCents, taxPercent: inv.taxPercent, totalCents: inv.totalCents, amountPaidCents: inv.amountPaidCents, memo: inv.memo,
  paidAt: inv.paidAt, payments: inv.payments, payUrl: `${location.origin}/i/${inv.token}`,
});
function PdfButton({ inv, kind, className, children }: { inv: Inv; kind: "invoice" | "receipt"; className: string; children: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  return <button type="button" className={className} disabled={busy} onClick={async () => { setBusy(true); try { await downloadPdf(pdfOf(inv, kind)); } finally { setBusy(false); } }}>{children}{busy && <span className="wp-spin" aria-hidden />}</button>;
}

const errText = (e: unknown) => {
  const d = (e as { data?: unknown })?.data;
  if (typeof d === "string") return d;
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^.*Uncaught ConvexError:\s*/s, "").replace(/\s+at .*$/s, "").slice(0, 200) || "Something went wrong. Try again.";
};

// Stripe.js loads once per connected account (each business's own Stripe account).
const stripes = new Map<string, Promise<Stripe | null>>();
const stripeFor = (pk: string, account: string) => {
  const k = `${pk}|${account}`;
  if (!stripes.has(k)) stripes.set(k, loadStripe(pk, { stripeAccount: account }));
  return stripes.get(k)!;
};

function appearance(): Appearance {
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim() || "#ff0000";
  return {
    theme: "night",
    variables: {
      colorPrimary: accent, colorBackground: "#0f0d10", colorText: "#f4f1e9", colorTextSecondary: "#c6c3bc", colorTextPlaceholder: "#8d8a86",
      colorDanger: "#ff5a4f", borderRadius: "12px", fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
      fontSizeBase: "15px", spacingUnit: "4px",
    },
    rules: {
      ".Input": { border: "1px solid #2a2829", boxShadow: "none", padding: "13px 14px" },
      ".Input:focus": { border: `1px solid ${accent}`, boxShadow: "none" },
      ".Tab": { border: "1px solid #2a2829", backgroundColor: "#0f0d10", boxShadow: "none" },
      ".Tab--selected": { border: `1px solid ${accent}`, boxShadow: "none" },
      ".Label": { color: "#c6c3bc", fontSize: "13px" },
    },
  };
}

/** The page itself; `inShell` when a signed-in client opens it inside their portal. */
export default function ClientInvoice({ token, inShell }: { token: string; inShell: boolean }) {
  const inv = useQuery(api.invoicePay.page, { token });
  const viewed = useMutation(api.invoicePay.markViewed);
  const refresh = useAction(api.invoicePay.refresh);
  const once = useRef(false);
  useEffect(() => {
    if (!inv || once.current) return;
    once.current = true;
    void viewed({ token }).catch(() => undefined);
    // Back from a bank or 3D Secure page: read the payment from Stripe, then tidy the address.
    const q = new URLSearchParams(location.search);
    if (q.get("payment_intent")) { void refresh({ token }).catch(() => undefined); history.replaceState(null, "", location.pathname); }
  }, [inv, token, viewed, refresh]);

  const bar = (here?: string) => inShell
    ? <TopBar><span className="secondary">Payments</span><Sep /><a {...linkProps("/payments/invoices")}>Invoices</a>{here && <><Sep /><span className="here">{here}</span></>}</TopBar>
    : null;
  if (inv === undefined) return <Frame inShell={inShell} bar={bar()}><Card label="Loading"><SkeletonRows n={5} /></Card></Frame>;
  if (inv === null) return (
    <Frame inShell={inShell} bar={bar()}>
      <EmptyState icon="invoice" title="This invoice link doesn't work." body="It may have been mistyped. Open the link in the email again, or reply to that email." />
    </Frame>
  );
  const s = inv.status as InvoiceStatus;
  const sub = [inv.project, s === "paid" && inv.paidAt ? `paid ${dateShort(inv.paidAt)}` : s === "void" && inv.voidedAt ? `cancelled ${dateShort(inv.voidedAt)}` : s === "void" ? "cancelled" : `due ${dateShort(inv.dueDate)}`].filter(Boolean).join(" · ");
  return (
    <Frame inShell={inShell} bar={bar(inv.title)} brand={inShell ? null : inv.business}>
      <header className="wp-pagehead inv-head">
        <div className="txt"><span className="wp-eyebrow">Invoice {inv.number}</span><h1 className="wp-h2">{inv.title}.</h1><p className="wp-body">{sub}</p></div>
        <InvoiceChip status={s} />
      </header>
      {inv.testMode && <p className="inv-test"><Icon name="info" size={14} />Stripe test mode: no real money moves. Use Stripe's test cards (4242 4242 4242 4242).</p>}
      <div className="inv-cols inv-client">
        <div className="col">
          <InvoicePaper business={inv.business} number={inv.number} issued={dateLong(new Date(inv.sentAt).toISOString().slice(0, 10))} due={dateLong(inv.dueDate)}
            billTo={inv.billTo} project={inv.project} lines={inv.lines} discountCents={inv.discountCents} taxPercent={inv.taxPercent} amountPaidCents={inv.amountPaidCents} memo={inv.memo}
            payments={inv.payments.map((p) => ({ at: dateLong(new Date(p.at).toISOString().slice(0, 10)), method: p.status === "processing" ? `${p.method} · processing` : p.method, cents: p.cents }))} />
        </div>
        <div className="col right">
          <PayCard inv={inv} token={token} />
          {inv.status !== "paid" && <PdfButton inv={inv} kind="invoice" className="inv-pdf">Download PDF<Icon name="download" size={14} /></PdfButton>}
        </div>
      </div>
    </Frame>
  );
}

function Frame({ inShell, bar, brand, children }: { inShell: boolean; bar: React.ReactNode; brand?: Inv["business"] | null; children: React.ReactNode }) {
  if (inShell) return <>{bar}<div className="wp-page inv-detail">{children}</div></>;
  return (
    <div className="inv-public">
      <div className="wp-light client" aria-hidden><i style={{ backgroundImage: `url(${lightClient})` }} /></div>
      <header className="inv-public-top">
        {brand?.logoUrl ? <img src={brand.logoUrl} alt={brand.name} /> : <span className="name">{brand?.name ?? ""}</span>}
      </header>
      <main className="wp-page inv-detail">{children}</main>
    </div>
  );
}

function PayCard({ inv, token }: { inv: Inv; token: string }) {
  const s = inv.status as InvoiceStatus;
  const processing = inv.payments.find((p) => p.status === "processing");
  const lastPaid = [...inv.payments].reverse().find((p) => p.status === "paid");
  if (s === "paid") return (
    <section className="inv-pay" aria-label="Receipt">
      <span className="wp-eyebrow">Receipt</span>
      <div className="amt"><span className="lbl">Paid in full</span><b>{money(inv.totalCents)}</b><small>{[inv.paidAt ? `Paid ${dateLong(new Date(inv.paidAt).toISOString().slice(0, 10))}` : null, lastPaid?.method].filter(Boolean).join(" · ")}</small></div>
      <Banner tone="success" icon="check-circle" title="Thank you. Your payment went through." text={`A receipt was emailed to ${inv.billTo.email}.`} />
      <div className="inv-pay-pdfs">
        <PdfButton inv={inv} kind="receipt" className="btn">Download receipt</PdfButton>
        <PdfButton inv={inv} kind="invoice" className="btn ghost">Download PDF</PdfButton>
      </div>
      <p className="inv-legal">Receipt from {inv.business.legalName && inv.business.legalName !== inv.business.name ? `${inv.business.name}, a DBA of ${inv.business.legalName.replace(/^.*?a DBA of\s*/i, "")}` : inv.business.name}{inv.business.email ? ` · ${inv.business.email}` : ""}</p>
    </section>
  );
  if (s === "void" || s === "uncollectible") return (
    <section className="inv-pay" aria-label="This invoice">
      <span className="wp-eyebrow">This invoice</span>
      <Banner tone="neutral" icon="info" title={s === "void" ? `This invoice was cancelled${inv.voidedAt ? ` on ${dateShort(inv.voidedAt)}` : ""}.` : "This invoice is closed."} text="There's nothing to pay. If you have a question, reply to the email it came with." />
    </section>
  );
  if (s === "processing" || processing) return (
    <section className="inv-pay" aria-label="Pay this invoice">
      <span className="wp-eyebrow">Pay this invoice</span>
      <div className="amt"><span className="lbl">Payment processing</span><b>{money(processing?.cents ?? inv.amountRemainingCents)}</b><small>{processing ? `From ${processing.method} · started ${dateShort(processing.at)}` : "Started"}</small></div>
      <Banner tone="neutral" icon="clock" title="Your bank payment is on its way." text="Bank payments take a few business days to clear. Nothing else to do." />
    </section>
  );
  const partly = inv.amountPaidCents > 0;
  return (
    <section className="inv-pay" aria-label="Pay this invoice">
      <span className="wp-eyebrow">Pay this invoice</span>
      <div className="amt">
        <span className="lbl">{partly ? "Amount remaining" : "Amount due"}</span><b>{money(inv.amountRemainingCents)}</b>
        <small>{partly ? `${money(inv.amountPaidCents)} of ${money(inv.totalCents)} paid · due ${dateLong(inv.dueDate)}` : s === "overdue" ? `Was due ${dateLong(inv.dueDate)}` : `Due ${dateLong(inv.dueDate)}`}</small>
        {partly && <span className="bar"><i style={{ width: `${Math.min(100, Math.round((inv.amountPaidCents / Math.max(1, inv.totalCents)) * 100))}%` }} /></span>}
      </div>
      {inv.canPay ? <PayForm inv={inv} token={token} /> : <p className="secondary" style={{ margin: 0 }}>This invoice can't be paid here right now. Reply to the email it came with.</p>}
      {inv.hostedUrl && <a className="inv-alt" href={inv.hostedUrl} target="_blank" rel="noopener noreferrer">Pay on Stripe instead<Icon name="external" size={14} /></a>}
      <p className="inv-secure"><Icon name="lock" size={14} />Payments are processed securely by Stripe.</p>
    </section>
  );
}

function Banner({ tone, icon, title, text }: { tone: "success" | "danger" | "neutral"; icon: "check-circle" | "alert" | "info" | "clock"; title: string; text?: string }) {
  return <div className={`inv-banner ${tone}`} role={tone === "danger" ? "alert" : undefined}><Icon name={icon} size={20} /><span><b>{title}</b>{text && <small>{text}</small>}</span></div>;
}

/** Pay: loads the Payment Element for this invoice's payment, then confirms it with Stripe. */
function PayForm({ inv, token }: { inv: Inv; token: string }) {
  const start = useAction(api.invoicePay.start);
  const [setup, setSetup] = useState<{ clientSecret: string; accountId: string; publishableKey: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    start({ token }).then((r) => live && setSetup(r)).catch((e) => live && setErr(errText(e)));
    return () => { live = false; };
  }, [start, token, inv.amountRemainingCents]);
  const stripe = useMemo(() => (setup ? stripeFor(setup.publishableKey, setup.accountId) : null), [setup]);
  if (err) return <Banner tone="neutral" icon="info" title={err} />;
  if (!setup || !stripe) return <div className="inv-pay-loading" aria-label="Loading the payment form"><SkeletonRows n={3} /></div>;
  return (
    <Elements stripe={stripe} options={{ clientSecret: setup.clientSecret, appearance: appearance(), loader: "auto" }}>
      <ConfirmForm inv={inv} token={token} />
    </Elements>
  );
}

function ConfirmForm({ inv, token }: { inv: Inv; token: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const refresh = useAction(api.invoicePay.refresh);
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState<string | null>(inv.lastFailure);
  const [ready, setReady] = useState(false);
  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true); setDeclined(null);
    const r = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${location.origin}${location.pathname}` }, redirect: "if_required" });
    if (r.error) {
      setDeclined(r.error.type === "card_error" || r.error.type === "validation_error" ? r.error.message ?? "Your card was declined." : "The payment didn't go through.");
      if (r.error.type !== "validation_error") void refresh({ token }).catch(() => undefined);
    } else {
      await refresh({ token }).catch(() => undefined); // paid or processing: the page updates from the backend
    }
    setBusy(false);
  };
  return (
    <form className="inv-pay-form" onSubmit={(e) => { e.preventDefault(); void pay(); }}>
      {declined && <Banner tone="danger" icon="alert" title={declined.endsWith(".") ? declined : `${declined}.`} text="Nothing was charged. Try again, or use a different card or your bank account." />}
      <PaymentElement options={{ layout: "tabs" }} onReady={() => setReady(true)} />
      <Button variant="primary" type="submit" loading={busy} disabled={!ready || !stripe} className="inv-pay-btn">{declined ? "Try again" : `Pay ${money(inv.amountRemainingCents)}`}</Button>
    </form>
  );
}
