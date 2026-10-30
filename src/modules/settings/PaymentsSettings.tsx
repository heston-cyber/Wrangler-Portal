// Phase 2 Part B, step 1 (Oct 29): Settings › Payments, from S5 · Phase 2 (Not connected 223:4317, Stripe needs more
// info 223:4719, Connected 256:7029, Disconnected 223:5503, Disconnect dialog 237:2). The business connects its own
// Stripe account to the portal; Stripe's own pages do the setup and send the owner back here.
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/kit";
import { useLocation } from "../../lib/router";
import { SetHead } from "./Frame";

const err = (e: unknown) => String((e as Error).message ?? e).replace(/^.*ConvexError: /, "").split("\n")[0];
// Stripe's field names for what it still needs, in words.
const FIELD: Record<string, string> = {
  "business_profile.url": "business website", "business_profile.mcc": "business category", "business_profile.product_description": "what the business sells",
  "business_profile.support_phone": "support phone number", "business_type": "business type", "external_account": "payout bank account",
  "tos_acceptance.date": "accepting Stripe's terms", "tos_acceptance.ip": "accepting Stripe's terms",
  "company.tax_id": "company tax ID (EIN)", "company.name": "company name", "company.address.line1": "company address", "company.phone": "company phone",
  "representative.verification.document": "ID document", "individual.verification.document": "ID document",
  "individual.id_number": "full SSN", "individual.ssn_last_4": "last 4 of SSN", "individual.dob.day": "date of birth", "individual.address.line1": "home address",
  "owners_provided": "confirming the owners", "directors_provided": "confirming the directors", "executives_provided": "confirming the executives",
};
const words = (f: string) => FIELD[f] ?? f.replace(/^(individual|representative|company|business_profile)\./, (m) => ({ "individual.": "your ", "representative.": "representative's ", "company.": "company ", "business_profile.": "business " } as Record<string, string>)[m] ?? "").replace(/[._]/g, " ");
const dueText = (due: string[]) => [...new Set(due.map(words))].slice(0, 6).join(", ");

const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function PaymentsSettings({ show }: { show: (m: string) => void }) {
  const s = useQuery(api.payments.settings, {});
  const connect = useAction(api.payments.connect);
  const refresh = useAction(api.payments.refresh);
  const disconnect = useMutation(api.payments.disconnect);
  const [busy, setBusy] = useState<null | "connect" | "check">(null);
  const [asking, setAsking] = useState(false);
  const { search } = useLocation();
  const back = new URLSearchParams(search).get("stripe");
  const checked = useRef(false);

  const go = async () => {
    setBusy("connect");
    try { window.location.href = (await connect({})).url; }
    catch (e) { show(err(e)); setBusy(null); }
  };
  const check = async (quiet = false) => {
    setBusy("check");
    try { const r = await refresh({}); if (!quiet && r) show(r.status === "connected" ? "Stripe is connected." : "Stripe still needs a few details."); }
    catch (e) { if (!quiet) show(err(e)); }
    setBusy(null);
  };
  // Back from Stripe's pages (?stripe=back, or ?stripe=retry when a link expired): read the account straight away.
  useEffect(() => {
    if (!back || checked.current || !s?.stripe) return;
    checked.current = true;
    if (back === "retry") void go(); else void check(true);
    history.replaceState(null, "", "/settings/payments");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back, s?.stripe]);

  if (s === undefined) return <><SetHead eyebrow="Payments" title="Payments." /><div className="panel"><SkeletonRows n={3} /></div></>;
  if (s === null) return null;
  const st = s.stripe;
  const test = s.platform.mode === "test";
  const testTag = test ? <span className="wp-tag pay-test">Test mode</span> : null;

  if (!s.platform.ready) {
    return (
      <>
        <SetHead eyebrow="Payments" title="Take payments in the portal." sub="Connect your Stripe account so clients can pay invoices right on the invoice page." />
        <div className="wp-notice"><Icon name="info" size={20} /><span className="txt"><b>Payments aren't switched on for the portal yet.</b> The portal's own Stripe account is still being set up.</span></div>
      </>
    );
  }

  if (!st) {
    return (
      <>
        <SetHead eyebrow="Payments" title="Take payments in the portal." sub="Connect your Stripe account so clients can pay invoices right on the invoice page." />
        <div className="panel pay-card">
          <span className="wp-eyebrow">What you get {testTag}</span>
          <ul className="pay-gets">
            <li><Icon name="invoice" size={18} />Send invoices that clients pay on the invoice page, by card or bank account.</li>
            <li><Icon name="mail" size={18} />The portal sends each invoice, its reminders and the receipt, in your brand.</li>
            <li><Icon name="lock" size={18} />Payments go straight to your own Stripe account and pay out to your bank.</li>
            <li><Icon name="more" size={18} />A Payments section turns on in the sidebar, for you and your clients.</li>
          </ul>
          <div className="pay-foot">
            <p className="secondary">You'll finish on Stripe's own pages, then come back here.</p>
            <Button variant="primary" onClick={() => void go()} loading={busy === "connect"}>Connect Stripe</Button>
          </div>
        </div>
      </>
    );
  }

  const name = st.displayName ?? s.business;
  const account = (
    <div className="panel pay-card">
      <span className="wp-eyebrow">Stripe account {testTag}</span>
      <dl className="pay-rows">
        <dt>Account</dt><dd>{name}</dd>
        <dt>Status</dt><dd>{st.status === "connected" ? <StatusChip tone="success">Connected</StatusChip> : st.status === "disconnected" ? <StatusChip tone="neutral">Disconnected</StatusChip> : <StatusChip tone="warning">Needs info</StatusChip>}</dd>
        {st.status === "connected" && <>
          <dt>Payouts</dt><dd>{st.payoutsEnabled ? `On${st.bankLast4 ? ` · to bank •••• ${st.bankLast4}` : ""}` : "Paused by Stripe"}</dd>
          {st.connectedAt && <><dt>Connected</dt><dd>{day(st.connectedAt)}</dd></>}
          <dt>Invoice numbers</dt><dd>{s.invoicePrefix}-0001 · one running count</dd>
        </>}
        {(st.status === "needs_info" || st.status === "pending") && <>
          <dt>Payouts</dt><dd>Paused until setup is finished</dd>
          <dt>Payments</dt><dd>Off</dd>
        </>}
        {st.status === "disconnected" && <>
          {st.disconnectedAt && <><dt>Disconnected</dt><dd>{day(st.disconnectedAt)}</dd></>}
          <dt>Open invoices</dt><dd>{s.openInvoices ? `${s.openInvoices}, their Pay button is hidden until you reconnect` : "None"}</dd>
        </>}
      </dl>
      {st.status === "connected" && (
        <div className="pay-actions">
          <a className="btn" href={`https://dashboard.stripe.com/${test ? "test/" : ""}dashboard`} target="_blank" rel="noopener noreferrer">Open Stripe dashboard<Icon name="external" size={16} className="end" /></a>
          <Button variant="ghost" onClick={() => setAsking(true)}>Disconnect</Button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <SetHead eyebrow="Payments" title="Payments." sub="Your Stripe connection and how clients pay you." />
      {(st.status === "needs_info" || st.status === "pending") && (
        <div className="wp-notice warn pay-banner">
          <Icon name="alert" size={20} />
          <span className="txt">{st.due.length === 0 && st.verifying
            ? <><b>Stripe is checking your details.</b><br />Clients can't pay until it's done. It usually takes a few minutes; Check again in a bit.</>
            : <><b>Stripe needs a few more details.</b><br />Clients can't pay until you finish setting up on Stripe.{st.due.length > 0 && <> Stripe is asking for: <b className="pay-due">{dueText(st.due)}</b>.</>}</>}</span>
          <Button variant="ghost" iconEnd="chevron-right" onClick={() => void check()} loading={busy === "check"}>Check again</Button>
          <Button variant="primary" onClick={() => void go()} loading={busy === "connect"}>Finish on Stripe</Button>
        </div>
      )}
      {st.status === "disconnected" && (
        <div className="wp-notice pay-banner">
          <Icon name="info" size={20} />
          <span className="txt"><b>Stripe is disconnected.</b><br />Clients can't pay in the portal right now. Your invoices and payment history are kept.</span>
          <Button variant="primary" onClick={() => void go()} loading={busy === "connect"}>Connect Stripe again</Button>
        </div>
      )}
      {account}
      {st.status === "connected" && (
        <div className="panel pay-card">
          <span className="wp-eyebrow">How clients pay</span>
          <dl className="pay-rows">
            <dt>Methods</dt><dd>Card, Apple Pay, Google Pay, US bank account, Link</dd>
          </dl>
          <p className="secondary pay-note">Apple Pay and Google Pay show only on devices that support them. Turn methods on or off in your Stripe dashboard.</p>
          <dl className="pay-rows"><dt>Emails</dt><dd>Invoices, reminders and receipts send from the portal</dd></dl>
        </div>
      )}
      {asking && (
        <Modal onClose={() => setAsking(false)} label="Disconnect Stripe" width={560}>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="dhead">
              <div style={{ display: "grid", gap: 6 }}>
                <span className="eyebrow">Settings · Payments</span>
                <h2 className="headline">Disconnect Stripe?</h2>
                <p className="secondary" style={{ margin: 0 }}>Clients won't be able to pay in the portal until you connect again. Your invoices and payment history stay here, and nothing changes in your Stripe account.</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setAsking(false)} aria-label="Close"><Icon name="close" size={18} /></button>
            </div>
            <dl className="pay-rows boxed">
              <dt>Account</dt><dd>{name}</dd>
              <dt>Open invoices</dt><dd>{s.openInvoices}</dd>
              <dt>Their Pay form</dt><dd>Hidden until you reconnect</dd>
            </dl>
            <div className="dfoot">
              <Button variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
              <Button variant="primary" onClick={async () => { try { await disconnect({}); setAsking(false); show("Stripe is disconnected."); } catch (e) { show(err(e)); } }}>Disconnect</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
