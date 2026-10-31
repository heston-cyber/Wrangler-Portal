// Phase 2b (Oct 30): the client's subscription page (/sub/<token>, frames 248:2663 active, 248:3136 past due, card
// updated · paid / still failing) and their Payments › Subscriptions list (248:2). The link from email 13 works with or
// without an account. "Add payment method" / "Update payment method" is the Payment Element in setup mode; saving it
// starts the subscription (the first time) or retries what's owed straight away (build answer 12).
import { useEffect, useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { api } from "../../../convex/_generated/api";
import { Button, Card, Divider, EmptyState, ListRow, PageHeader, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { Banner, Frame, appearance, errText, stripeFor } from "./ClientInvoice";
import { dateShort, money } from "./common";
import { SubChip, type SubStatus } from "./SubscriptionsPage";

type Sub = NonNullable<ReturnType<typeof useQuery<typeof api.subscriptions.page>>>;
const dayLong = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const month = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", year: "numeric" });

export default function ClientSubscription({ token, inShell }: { token: string; inShell: boolean }) {
  const s = useQuery(api.subscriptions.page, { token });
  const [result, setResult] = useState<{ ok: boolean; message: string | null } | null>(null);
  const [updating, setUpdating] = useState(false);
  const bar = (here?: string) => inShell ? <TopBar><span className="secondary">Payments</span><Sep /><a {...linkProps("/payments/subscriptions")}>Subscriptions</a>{here && <><Sep /><span className="here">{here}</span></>}</TopBar> : null;
  if (s === undefined) return <Frame inShell={inShell} bar={bar()}><Card label="Loading"><SkeletonRows n={5} /></Card></Frame>;
  if (s === null) return <Frame inShell={inShell} bar={bar()}><EmptyState icon="activity" title="This subscription link doesn't work." body="It may have been mistyped. Open the link in the email again, or reply to that email." /></Frame>;
  const st = s.status as SubStatus;
  const first = s.billTo.name.split(/\s+/)[0];
  const done = (r: { ok: boolean; message: string | null }) => { setResult(r); setUpdating(false); };
  return (
    <Frame inShell={inShell} bar={bar(s.plan)} brand={inShell ? null : s.business}>
      <header className="wp-pagehead inv-head">
        <div className="txt"><span className="wp-eyebrow">Subscription</span><h1 className="wp-h2">{s.plan}.</h1>
          <p className="wp-body">{[s.business.name, st === "waiting" ? `starts ${dateShort(s.startDate)}` : `started ${dateShort(s.startDate)}`].join(" · ")}</p></div>
        <SubChip status={st} />
      </header>
      {s.testMode && <p className="inv-test"><Icon name="info" size={14} />Stripe test mode: no real money moves. Use Stripe's test cards (4242 4242 4242 4242).</p>}
      {result && (result.ok
        ? <Banner tone="success" icon="check-circle" title={st === "waiting" ? "You're all set." : "Payment method updated."} text={st === "past_due" ? "We're retrying the payment now." : "It's used for every charge from now on."} />
        : <Banner tone="danger" icon="alert" title={result.message ?? "The payment didn't go through."} text="Your new payment method was saved, but the charge didn't go through. Try another card or your bank account." />)}
      {!result && st === "past_due" && <Banner tone="danger" icon="alert" title={`Your ${s.lastFailure ? dayLong(s.lastFailure.at) : "last"} payment didn't go through.`} text={`${s.lastFailure?.message ?? ""} Update your card so your plan keeps going.`.trim()} />}
      <div className="inv-cols inv-client">
        <div className="col">
          <Card label="Plan" head={<SectionHead label="Plan" />}>
            <div className="plan-preview">
              <span className="price">{money(s.amountCents)}</span>
              <span className="every">{s.every.replace(/^\/ /, "every ")}</span>
            </div>
            <dl className="pay-rows sub-sum">
              {s.nextCharge && <><dt>{st === "trialing" ? "Trial ends" : st === "scheduled" || st === "waiting" ? "First charge" : "Next charge"}</dt><dd>{dayLong(s.nextCharge)}</dd></>}
              {s.currentPeriodStart && s.currentPeriodEnd && !["waiting", "scheduled", "canceled"].includes(st) && <><dt>This period</dt><dd>{dateShort(s.currentPeriodStart)} – {dayLong(s.currentPeriodEnd)}</dd></>}
              {s.endsAt && <><dt>Ends</dt><dd>{dayLong(s.endsAt)}</dd></>}
              {s.canceledAt && st === "canceled" && <><dt>Ended</dt><dd>{dayLong(s.canceledAt)}</dd></>}
              <dt>{st === "waiting" ? "Starts" : "Started"}</dt><dd>{dateShort(s.startDate)}</dd>
            </dl>
            {s.description && <p className="plan-note">{s.description}</p>}
          </Card>
          {s.invoices.length > 0 && <Card label="Past invoices" head={<SectionHead label="Past invoices" count={s.invoices.length} />}>
            {s.invoices.map((i, n) => <div key={i.token} className="wp-rowwrap">{n > 0 && <Divider />}
              <ListRow className="ilead" lead={{ icon: "invoice" }} to={`/i/${i.token}`} chevron title={month(i.createdAt)} meta={[i.number, dateShort(i.paidAt ?? i.createdAt)].filter(Boolean).join(" · ")}
                trailing={money(i.totalCents)} chip={<StatusChip tone={i.status === "paid" ? "success" : i.status === "open" ? "warning" : "neutral"}>{i.status === "paid" ? "Paid" : i.status === "open" ? "Due" : "Closed"}</StatusChip>} />
            </div>)}
          </Card>}
        </div>
        <div className="col right">
          {st === "waiting" ? (
            <section className="inv-pay" aria-label="Add a payment method">
              <span className="wp-eyebrow">Add a payment method</span>
              <p className="secondary" style={{ margin: 0 }}>Hi {first}. Add a card or bank account to start {s.plan}. {s.nextCharge ? `Nothing is charged until ${dayLong(s.nextCharge)}.` : `The first ${money(s.amountCents)} is charged when you save it.`}</p>
              {s.canSetup ? <SetupForm token={token} label={s.nextCharge ? "Save payment method" : `Save and pay ${money(s.amountCents)}`} onDone={done} /> : <p className="secondary" style={{ margin: 0 }}>This can't be set up here right now. Reply to the email from {s.business.name}.</p>}
              <p className="inv-secure"><Icon name="lock" size={14} />Saved securely by Stripe. {s.business.name} never sees your card number.</p>
            </section>
          ) : (
            <section className="inv-pay" aria-label="Payment method">
              <span className="wp-eyebrow">Payment method</span>
              <div className="sub-method"><Icon name="lock" size={18} /><span>{s.method ?? "None saved"}</span></div>
              {s.canSetup && st !== "canceled" && <Button onClick={() => setUpdating(true)}>Update payment method</Button>}
            </section>
          )}
          <section className="inv-pay" aria-label="Changes">
            <span className="wp-eyebrow">Changes</span>
            <p className="secondary" style={{ margin: 0 }}>To change or cancel this plan, contact {s.business.name}.</p>
            {s.business.email && <a className="sub-mail" href={`mailto:${s.business.email}`}>Email {s.business.email}</a>}
          </section>
        </div>
      </div>
      {updating && (
        <Modal onClose={() => setUpdating(false)} label="Update payment method" width={520}>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="dhead">
              <div style={{ display: "grid", gap: 6 }}><h2 className="headline">Update payment method</h2>
                <p className="secondary" style={{ margin: 0 }}>This card or bank account is used for {s.plan} from the next charge.{st === "past_due" ? " Saving it tries the missed payment again straight away." : ""}</p></div>
              <button type="button" className="icon-btn" onClick={() => setUpdating(false)} aria-label="Close"><Icon name="close" size={18} /></button>
            </div>
            <SetupForm token={token} label={st === "past_due" ? "Save and retry payment" : "Save payment method"} onDone={done} />
          </div>
        </Modal>
      )}
    </Frame>
  );
}

function SetupForm({ token, label, onDone }: { token: string; label: string; onDone: (r: { ok: boolean; message: string | null }) => void }) {
  const start = useAction(api.subscriptions.setupStart);
  const [setup, setSetup] = useState<{ clientSecret: string; accountId: string; publishableKey: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    start({ token }).then((r) => live && setSetup(r)).catch((e) => live && setErr(errText(e)));
    return () => { live = false; };
  }, [start, token]);
  const stripe = useMemo(() => (setup ? stripeFor(setup.publishableKey, setup.accountId) : null), [setup]);
  if (err) return <Banner tone="neutral" icon="info" title={err} />;
  if (!setup || !stripe) return <div className="inv-pay-loading" aria-label="Loading the form"><SkeletonRows n={3} /></div>;
  return (
    <Elements stripe={stripe} options={{ clientSecret: setup.clientSecret, appearance: appearance(), loader: "auto" }}>
      <ConfirmSetup token={token} label={label} onDone={onDone} />
    </Elements>
  );
}

function ConfirmSetup({ token, label, onDone }: { token: string; label: string; onDone: (r: { ok: boolean; message: string | null }) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const finish = useAction(api.subscriptions.setupDone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const save = async () => {
    if (!stripe || !elements) return;
    setBusy(true); setError(null);
    const r = await stripe.confirmSetup({ elements, confirmParams: { return_url: `${location.origin}${location.pathname}` }, redirect: "if_required" });
    if (r.error || !r.setupIntent) { setError(r.error?.message ?? "That didn't save. Try again."); setBusy(false); return; }
    try { onDone(await finish({ token, setupIntentId: r.setupIntent.id })); }
    catch (e) { setError(errText(e)); }
    setBusy(false);
  };
  return (
    <form className="inv-pay-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {error && <Banner tone="danger" icon="alert" title={error} />}
      <PaymentElement options={{ layout: "tabs" }} onReady={() => setReady(true)} />
      <Button variant="primary" type="submit" loading={busy} disabled={!ready || !stripe} className="inv-pay-btn">{label}</Button>
    </form>
  );
}

/** Payments › Subscriptions for a signed-in client. */
export function ClientSubscriptions() {
  const rows = useQuery(api.subscriptions.mine, {});
  return (
    <>
      <TopBar><span className="secondary">Payments</span><Sep /><span className="here">Subscriptions</span></TopBar>
      <div className="wp-page inv-list">
        <PageHeader eyebrow="Payments" title="Subscriptions." sub={rows?.[0] ? `Plans you pay for on a schedule. To change or cancel a plan, contact ${rows[0].business}${rows[0].businessEmail ? ` at ${rows[0].businessEmail}` : ""}.` : "Plans you pay for on a schedule."} />
        {rows === undefined ? <Card label="Subscriptions"><SkeletonRows n={3} /></Card>
          : rows.length === 0 ? <EmptyState icon="activity" title="No subscriptions." body="When a business starts a plan for you, it shows here." />
          : <Card label="Subscriptions" head={<SectionHead label="Subscriptions" count={rows.length} />}>
            {rows.map((r, i) => <div key={r.token} className="wp-rowwrap">{i > 0 && <Divider />}
              <ListRow className="ilead" lead={{ icon: "activity" }} to={`/sub/${r.token}`} chevron title={r.plan}
                meta={[r.price, r.status === "trialing" && r.trialEnd ? `trial ends ${dateShort(r.trialEnd)}` : r.endsAt ? `ends ${dateShort(r.endsAt)}` : r.nextCharge ? `next charge ${dateShort(r.nextCharge)}` : r.status === "waiting" ? "add a payment method" : null, r.method].filter(Boolean).join(" · ")}
                chip={<SubChip status={r.status as SubStatus} />} />
            </div>)}
          </Card>}
      </div>
    </>
  );
}
