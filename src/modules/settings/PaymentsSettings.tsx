// Phase 2 Part B, step 1 (Oct 29): Settings › Payments, from S5 · Phase 2 (Not connected 223:4317, Stripe needs more
// info 223:4719, Connected 256:7029, Disconnected 223:5503, Disconnect dialog 237:2). The business connects its own
// Stripe account to the portal; Stripe's own pages do the setup and send the owner back here.
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, SkeletonRows, StatusChip, Toggle, Segmented } from "../../ui/wp";
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

const methodsText = (m: string[] | null) => {
  const list = m ?? ["card"];
  return ["Card, Apple Pay, Google Pay", ...(list.includes("us_bank_account") ? ["US bank account"] : []), ...(list.includes("link") ? ["Link"] : [])].join(", ");
};
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** D51 (frames 256:7029 off, 256:7306 on): automatic reminders, off by default. */
/** Phase 2b (D64): when Stripe's last retry of a subscription payment fails. A client's Settings tab can override it. */
function SubFail({ show }: { show: (m: string) => void }) {
  const rules = useQuery(api.subscriptions.failRules, {});
  const save = useMutation(api.subscriptions.setFailRule);
  if (!rules) return null;
  const set = (rule: "past_due" | "cancel") => void save({ rule }).then(() => show("Saved."), (e) => show(err(e)));
  return (
    <div className="panel pay-card">
      <span className="wp-eyebrow">Subscriptions</span>
      {/* D64 row as approved (702:1451): the question, the line under it, then the two choices. */}
      <div className="d64"><b>When a subscription payment fails for good</b><span className="secondary">After Stripe's last retry. A client's Settings tab can change this for that client.</span></div>
      <Segmented<"past_due" | "cancel"> label="When a subscription payment fails for good" value={rules.business as "past_due" | "cancel"} onChange={set}
        items={[{ key: "past_due", label: "Keep it past due" }, { key: "cancel", label: "Cancel the subscription" }]} />
      <p className="secondary pay-note">In your Stripe account, set Billing › Revenue recovery to leave the subscription as it is, so the portal applies this.</p>
    </div>
  );
}

/** Pay in portal (Nov 2): paying vendors from the business's own Stripe balance (Global Payouts). Wrangler only. */
function VendorPayouts() {
  const st = useQuery(api.vendorPayouts.status, {});
  const balanceOf = useAction(api.vendorPayouts.balance);
  const [bal, setBal] = useState<number | string | null>(null);
  useEffect(() => { if (!st?.on) return; let live = true; balanceOf({}).then((r) => live && setBal(r && "availableCents" in r ? r.availableCents : r ? r.error : "Couldn't check"), (e) => live && setBal(err(e))); return () => { live = false; }; }, [st?.on, balanceOf]);
  if (!st?.isDefault) return null;
  const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <div className="panel pay-card">
      <span className="wp-eyebrow">Vendor payouts {st.mode === "test" && <span className="wp-tag pay-test">Test mode</span>}</span>
      {st.on ? <>
        <dl className="pay-rows">
          <dt>Status</dt><dd><StatusChip tone="success">Connected</StatusChip></dd>
          <dt>Stripe balance</dt><dd>{bal === null ? "Checking…" : typeof bal === "number" ? usd(bal) : bal}</dd>
          <dt>How</dt><dd>Direct deposit by standard ACH, usually 1 to 3 business days</dd>
        </dl>
        <p className="secondary pay-note">Pay an approved vendor invoice from its page (Vendors › Payments). Vendors set up direct deposit in their portal's Settings, on Stripe's form. Add funds to your balance in your Stripe dashboard.</p>
      </> : <>
        <dl className="pay-rows"><dt>Status</dt><dd><StatusChip tone="neutral">Not connected</StatusChip></dd></dl>
        <p className="secondary pay-note">Pay approved vendor invoices from your Stripe balance, straight to their bank. It needs Global Payouts turned on in your Stripe account and a restricted key from it added to the portal. Until then, pay your usual way and press Mark paid.</p>
      </>}
    </div>
  );
}

function Reminders({ r, show }: { r: { on: boolean; beforeDays: number; afterDays: number; everyDays: number; stopAfter: number }; show: (m: string) => void }) {
  const save = useMutation(api.invoiceReminders.setReminders);
  const set = (patch: Partial<typeof r>) => void save({ ...r, ...patch }).then(
    () => show(patch.on === true ? "Automatic reminders are on." : patch.on === false ? "Automatic reminders are off." : "Saved."), (e) => show(err(e)));
  const pick = (label: string, value: number, opts: number[], fmt: (n: number) => string, key: keyof typeof r, hint?: string) => (
    <label className="wp-field"><span className="wp-field-label">{label}</span>
      <select className="input" value={value} onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<typeof r>)}>{opts.map((n) => <option key={n} value={n}>{fmt(n)}</option>)}</select>
      {hint && <span className="wp-field-hint">{hint}</span>}
    </label>
  );
  return (
    <div className="panel pay-card">
      <span className="wp-eyebrow">Automatic reminders</span>
      <div className="pay-switch">
        <span><b>Send reminders automatically</b><small>Off by default. You can always send one by hand from an invoice.</small></span>
        <Toggle label="Send reminders automatically" checked={r.on} onChange={(on) => set({ on })} />
      </div>
      {r.on && <>
        <div className="pay-grid">
          {pick("Before the due date", r.beforeDays, [0, 1, 2, 3, 5, 7, 14], (n) => (n ? days(n) : "None"), "beforeDays", "0 = no reminder before")}
          {pick("On or after the due date", r.afterDays, [0, 1, 2, 3, 7], (n) => (n ? `${days(n)} after` : "On the due date"), "afterDays")}
          {pick("While overdue, every", r.everyDays, [3, 5, 7, 14, 30], days, "everyDays")}
          {pick("Stop after", r.stopAfter, [1, 2, 3, 4, 5, 6], (n) => `${n} overdue reminder${n === 1 ? "" : "s"}`, "stopAfter", "Or when the invoice is paid or voided")}
        </div>
        <p className="secondary pay-note">Reminders use the “Reminder · before due” and “Reminder · overdue” emails. Each invoice shows its next reminder date. None go while a bank payment is clearing.</p>
      </>}
    </div>
  );
}

/** Phase 5 (743:3134, D98): Footage storage. The price per year, how long raw footage is kept after delivery, and
 *  whether clients are offered "Keep it" on their delivery page. Billed as a yearly invoice the owner sends (D33). */
function FootageStorage({ show }: { show: (m: string) => void }) {
  const s = useQuery(api.footage.settings, {});
  const save = useMutation(api.footage.saveSettings);
  const [price, setPrice] = useState<string | null>(null);
  if (!s) return null;
  const dollars = (c: number) => (c / 100).toFixed(2);
  const put = (patch: Partial<{ on: boolean; priceCents: number; keepDays: number }>, msg = "Saved.") =>
    void save({ on: s.on, priceCents: s.priceCents, keepDays: s.keepDays, ...patch }).then(() => show(msg), (e) => show(err(e)));
  const savePrice = () => {
    if (price === null) return;
    const n = Math.round(Number(price.replace(/[$,]/g, "").trim()) * 100);
    setPrice(null);
    if (!Number.isFinite(n) || n === s.priceCents) return;
    put({ priceCents: n });
  };
  const shown = `$${Number(dollars(s.priceCents)).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return (
    <div className="panel pay-card">
      <span className="wp-eyebrow">Footage storage</span>
      <div className="pay-grid ft-grid">
        <label className="wp-field"><span className="wp-field-label">Price per year</span>
          <input className="input" inputMode="decimal" value={price ?? `$${dollars(s.priceCents)}`} onFocus={() => setPrice(dollars(s.priceCents))}
            onChange={(e) => setPrice(e.target.value)} onBlur={savePrice} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} aria-label="Price per year" />
        </label>
        <label className="wp-field"><span className="wp-field-label">Keep raw footage after delivery</span>
          <select className="input" value={s.keepDays} onChange={(e) => put({ keepDays: Number(e.target.value) })}>{s.keepDayChoices.map((n) => <option key={n} value={n}>{days(n)}</option>)}</select>
        </label>
      </div>
      <div className="pay-switch ft-switch">
        <span><b>Offer storage at delivery</b><small>Clients see “Keep it for {shown}/year?” on their delivery page.</small></span>
        <Toggle label="Offer storage at delivery" checked={s.on} onChange={(on) => put({ on }, on ? "Clients are offered storage at delivery." : "Storage isn't offered at delivery.")} />
      </div>
      <p className="secondary pay-note">Billed as a yearly invoice you check and send. Kept until the date unless they keep it, or you copy it to their own drive. The portal never deletes files: on the keep date you get a reminder.</p>
    </div>
  );
}

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

  if (s === undefined) return <><SetHead title="Payments." /><div className="panel"><SkeletonRows n={3} /></div></>;
  if (s === null) return null;
  const st = s.stripe;
  const test = s.platform.mode === "test";
  const testTag = test ? <span className="wp-tag pay-test">Test mode</span> : null;

  if (!s.platform.ready) {
    return (
      <>
        <SetHead title="Take payments in the portal." sub="Connect your Stripe account so clients can pay invoices right on the invoice page." />
        <div className="wp-notice"><Icon name="info" size={20} /><span className="txt"><b>Payments aren't switched on for the portal yet.</b> The portal's own Stripe account is still being set up.</span></div>
      </>
    );
  }

  if (!st) {
    return (
      <>
        <SetHead title="Take payments in the portal." sub="Connect your Stripe account so clients can pay invoices right on the invoice page." />
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
        <dt>Status</dt><dd>{st.status === "connected" ? <StatusChip tone="success">Connected</StatusChip> : st.status === "disconnected" ? <StatusChip tone="neutral">Disconnected</StatusChip> : st.due.length === 0 && st.verifying ? <StatusChip tone="warning">Checking</StatusChip> : <StatusChip tone="warning">Needs info</StatusChip>}</dd>
        {st.status === "connected" && <>
          <dt>Payouts</dt><dd>{st.payoutsEnabled ? `On${st.bankLast4 ? ` · to bank •••• ${st.bankLast4}` : ""}` : "Paused by Stripe"}</dd>
          {st.connectedAt && <><dt>Connected</dt><dd>{day(st.connectedAt)}</dd></>}
          <dt>Invoice numbers</dt><dd>{s.invoicePrefix}-0001 · one running count</dd>
        </>}
        {(st.status === "needs_info" || st.status === "pending") && <>
          <dt>Payouts</dt><dd>{st.due.length === 0 && st.verifying ? "Paused until Stripe has checked your details" : "Paused until setup is finished"}</dd>
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
      <SetHead title="Payments." sub="Your Stripe connection and how clients pay you." />
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
            <dt>Methods</dt><dd>{methodsText(st.methods)}</dd>
            {st.wallets && <><dt>Wallets</dt><dd>{st.wallets.ok ? `Apple Pay, Google Pay and Link set up for ${st.wallets.site}` : `Not set up for ${st.wallets.site} yet${st.wallets.error ? ` (${st.wallets.error})` : ""}. Card and bank payments still work.`}</dd></>}
          </dl>
          <p className="secondary pay-note">Apple Pay and Google Pay show only on devices that support them. Turn methods on or off in your Stripe dashboard.</p>
          <dl className="pay-rows"><dt>Emails</dt><dd>Invoices, reminders and receipts send from the portal</dd></dl>
        </div>
      )}
      {st.status === "connected" && <Reminders r={s.reminders} show={show} />}
      {st.status === "connected" && <SubFail show={show} />}
      <FootageStorage show={show} />
      <VendorPayouts />
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
