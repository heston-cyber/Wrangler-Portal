// Phase 2b (Oct 30): Payments › Subscriptions (frame 250:3092), Start a subscription (252:2598, confirm 253:3474) and
// the subscription page (252:3187 active, 252:3825 past due, 252:4475 paused). Nothing reaches Stripe or the client
// before the owner's confirm; nothing is charged until the client adds a payment method.
import { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { Button, ButtonLink, Card, Checkbox, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows, StatusChip, TextField, type Tone } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { dateShort, isoIn, money } from "./common";
import { SubscriptionActions } from "./SubscriptionActions";

export type SubStatus = "waiting" | "scheduled" | "trialing" | "active" | "past_due" | "paused" | "ending" | "canceled";
export const SUB_CHIP: Record<SubStatus, { tone: Tone; text: string }> = {
  waiting: { tone: "neutral", text: "Waiting" }, scheduled: { tone: "neutral", text: "Starts later" }, trialing: { tone: "accent", text: "Trialing" },
  active: { tone: "success", text: "Active" }, past_due: { tone: "danger", text: "Past due" }, paused: { tone: "neutral", text: "Paused" },
  ending: { tone: "warning", text: "Ending" }, canceled: { tone: "neutral", text: "Cancelled" },
};
export const SubChip = ({ status }: { status: SubStatus }) => <StatusChip tone={SUB_CHIP[status].tone}>{SUB_CHIP[status].text}</StatusChip>;
const dayLong = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.subscriptions.list>>>["rows"][number];
type Filter = "all" | "active" | "trialing" | "past_due" | "paused" | "ended";

function rowMeta(r: Row) {
  const bits = [r.price];
  switch (r.status) {
    case "waiting": bits.push("waiting on a payment method"); break;
    case "scheduled": bits.push(`starts ${dateShort(r.startDate)}`); break;
    case "trialing": if (r.trialEnd) bits.push(`trial ends ${dateShort(r.trialEnd)}`); break;
    case "past_due": bits.push(r.lastFailure ? `payment failed ${dateShort(r.lastFailure.at)}` : "payment failed"); if (r.nextCharge) bits.push(`next try ${dateShort(r.nextCharge)}`); break;
    case "paused": bits.push("paused"); break;
    case "ending": if (r.endsAt) bits.push(`ends ${dateShort(r.endsAt)} (cancelled at period end)`); break;
    case "canceled": return r.canceledAt ? `Cancelled ${dayLong(r.canceledAt)}` : "Cancelled";
    default: if (r.nextCharge) bits.push(`next charge ${dateShort(r.nextCharge)}`); if (r.method) bits.push(r.method);
  }
  return bits.join(" · ");
}

function SubRow({ r }: { r: Row }) {
  const title = [r.client, r.plan].filter(Boolean).join(" · ");
  return r.status === "past_due"
    ? <ListRow className="ilead" lead={{ icon: "activity" }} title={title} meta={rowMeta(r)} chip={<SubChip status={r.status} />} action={<ButtonLink size="sm" to={`/payments/subscriptions/${r._id}`}>Open</ButtonLink>} />
    : <ListRow className="ilead" lead={{ icon: "activity" }} to={`/payments/subscriptions/${r._id}`} chevron title={title} meta={rowMeta(r)} chip={<SubChip status={r.status as SubStatus} />} />;
}

function Group({ label, rows }: { label: string; rows: Row[] }) {
  if (!rows.length) return null;
  return <Card label={label} head={<SectionHead label={label} count={rows.length} />}>{rows.map((r, i) => <div key={r._id} className="wp-rowwrap">{i > 0 && <Divider />}<SubRow r={r} /></div>)}</Card>;
}

export default function SubscriptionsPage() {
  const data = useQuery(api.subscriptions.list, {});
  const pay = useQuery(api.payments.settings, {});
  const [filter, setFilter] = useState<Filter>("all");
  const rows = data?.rows ?? [];
  const by = (ss: SubStatus[]) => rows.filter((r) => ss.includes(r.status as SubStatus));
  const g = { attention: by(["past_due"]), active: by(["active", "ending"]), trialing: by(["trialing"]), starting: by(["waiting", "scheduled"]), paused: by(["paused"]), ended: by(["canceled"]) };
  const trialing = g.trialing.length;
  const pastDueCents = g.attention.reduce((t, r) => t + r.amountCents, 0);
  const notConnected = pay && pay.stripe?.status !== "connected";
  const show = (f: Filter) => filter === "all" || filter === f;
  return (
    <>
      <TopBar><span className="secondary">Payments</span><Sep /><span className="here">Subscriptions</span></TopBar>
      <div className="wp-page inv-list">
        <PageHeader eyebrow="Payments" title="Subscriptions." sub="Every client on a plan, and what comes in each month."
          actions={<ButtonLink variant="primary" to="/payments/subscriptions/new">Start a subscription</ButtonLink>} />
        {notConnected && <div className="wp-notice"><Icon name="info" size={20} /><span className="txt"><b>Stripe isn't connected.</b> Subscriptions run in your Stripe account (Settings › Payments).</span><ButtonLink size="sm" to="/settings/payments">Settings › Payments</ButtonLink></div>}
        {data === undefined ? <Card label="Subscriptions"><SkeletonRows n={4} /></Card>
          : rows.length === 0 ? <EmptyState icon="activity" title="No subscriptions yet." body="Make a plan, then start a subscription for a client. Nothing is charged until they add a payment method."
            actions={<><ButtonLink variant="primary" to="/payments/subscriptions/new">Start a subscription</ButtonLink><ButtonLink to="/payments/plans">Plans</ButtonLink></>} />
          : <>
            <div className="pov-stats sub-stats">
              <div className="pov-stat"><span className="lbl">Active subscriptions</span><b>{data.numbers.active - trialing}</b><span className="sub">{trialing ? `plus ${trialing} trialing` : " "}</span></div>
              <div className="pov-stat"><span className="lbl">Monthly recurring</span><b>{money(data.numbers.monthlyCents)}</b><span className="sub">yearly and custom plans counted per month</span></div>
              <div className="pov-stat"><span className="lbl">Past due</span><b>{data.numbers.pastDue}</b><span className="sub">{pastDueCents ? `${money(pastDueCents)} waiting` : " "}</span></div>
            </div>
            <PillTabs label="Show" value={filter} onChange={setFilter} items={[
              { key: "all", label: "All", count: rows.length }, { key: "active", label: "Active", count: g.active.length + g.starting.length }, { key: "trialing", label: "Trialing", count: trialing },
              { key: "past_due", label: "Past due", count: g.attention.length }, { key: "paused", label: "Paused", count: g.paused.length }, { key: "ended", label: "Ended", count: g.ended.length },
            ]} />
            {show("past_due") && <Group label="Needs attention" rows={g.attention} />}
            {show("active") && <Group label="Starting" rows={g.starting} />}
            {show("active") && <Group label="Active" rows={g.active} />}
            {show("trialing") && <Group label="Trialing" rows={g.trialing} />}
            {show("paused") && <Group label="Paused" rows={g.paused} />}
            {show("ended") && <Group label="Ended" rows={g.ended} />}
          </>}
      </div>
    </>
  );
}

// ---------- Start a subscription ----------

const everyText = (interval: string, count: number) => (count === 1 ? `every ${interval}` : `every ${count} ${interval}s`);

export function StartSubscription({ clientId: initClient }: { clientId?: string | null }) {
  const opts = useQuery(api.invoices.options, {});
  const plans = useQuery(api.plans.list, {});
  const start = useAction(api.subscriptions.start);
  const [toast, show] = useToast();
  const [clientId, setClientId] = useState(initClient ?? "");
  const [person, setPerson] = useState("");
  const [planId, setPlanId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [startDate, setStartDate] = useState(isoIn(0));
  const [trial, setTrial] = useState(false);
  const [trialDays, setTrialDays] = useState(14);
  const [first, setFirst] = useState<"start" | "now">("start");
  const [postInbox, setPostInbox] = useState(true);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const client = opts?.clients.find((c) => c._id === clientId);
  const people = client?.people ?? [];
  const who = people.find((p) => p.email === person) ?? people.find((p) => p.role === "signer") ?? people[0];
  const plan = (plans ?? []).find((p) => p._id === planId);
  const active = (plans ?? []).filter((p) => !p.archived);
  const today = isoIn(0);
  const later = startDate > today;
  const firstCharge = trial ? `${dateShort(Date.parse(`${startDate}T12:00:00`) + trialDays * 86_400_000)} (after the trial)` : first === "now" || !later ? "When they add a payment method" : dateShort(startDate);
  const ready = !!client && !!who && !!plan && !!startDate && startDate >= today && (!trial || (trialDays >= 1 && trialDays <= 730));
  const go = async () => {
    if (!client || !who || !plan) return;
    setBusy(true);
    try {
      const id = await start({ clientId: client._id as Id<"clients">, planId: plan._id as Id<"plans">, projectId: (projectId || undefined) as Id<"projects"> | undefined,
        billTo: { name: who.name, email: who.email }, startDate, trialDays: trial ? trialDays : undefined, firstInvoice: trial ? "start" : first, postInbox });
      navigate(`/payments/subscriptions/${id}`);
    } catch (e) { show(errText(e)); setBusy(false); setAsking(false); }
  };
  if (opts === undefined || plans === undefined) return <div className="wp-page"><Card label="Start a subscription"><SkeletonRows n={5} /></Card></div>;
  return (
    <>
      <TopBar right={<>
        <a className="btn ghost" {...linkProps("/payments/subscriptions")}>Cancel</a>
        <Button variant="primary" onClick={() => setAsking(true)} disabled={!ready || !opts.stripeReady}>Review and start…</Button>
      </>}>
        <span className="secondary">Payments</span><Sep /><a {...linkProps("/payments/subscriptions")}>Subscriptions</a><Sep /><span className="here">Start a subscription</span>
      </TopBar>
      <div className="wp-page inv-edit">
        <header className="wp-pagehead"><div className="txt"><span className="wp-eyebrow">Start a subscription</span><h1 className="wp-h2">Start a subscription.</h1><p className="wp-body">Nothing is charged or sent until you confirm.</p></div></header>
        {!opts.stripeReady && <div className="wp-notice"><Icon name="info" size={20} /><span className="txt"><b>Stripe isn't connected.</b> Subscriptions need Stripe (Settings › Payments).</span></div>}
        {active.length === 0 && <div className="wp-notice"><Icon name="info" size={20} /><span className="txt"><b>No plans yet.</b> Make one first.</span><ButtonLink size="sm" to="/payments/plans/new">New plan</ButtonLink></div>}
        <div className="inv-cols">
          <div className="col">
            <Card label="Who and what" head={<SectionHead label="Who and what" />}>
              <div className="inv-form">
                <div className="row2">
                  <label className="wp-field"><span className="wp-field-label">Client</span>
                    <select className="input" value={clientId} onChange={(e) => { setClientId(e.target.value); setPerson(""); setProjectId(""); }}>
                      <option value="">Choose a client…</option>
                      {opts.clients.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </select></label>
                  <label className="wp-field"><span className="wp-field-label">Plan</span>
                    <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                      <option value="">Choose a plan…</option>
                      {active.map((p) => <option key={p._id} value={p._id}>{p.name} · {p.price}</option>)}
                    </select></label>
                </div>
                {client && <label className="wp-field"><span className="wp-field-label">Who pays</span>
                  <select className="input" value={who?.email ?? ""} onChange={(e) => setPerson(e.target.value)} disabled={!people.length}>
                    {people.length ? people.map((p) => <option key={p.email} value={p.email}>{p.name}{p.role === "signer" ? " · signs documents" : ""}</option>) : <option value="">Add a person to this client first</option>}
                  </select>
                  <span className="wp-field-hint">They get the email to add a payment method.</span></label>}
                <div className="row2">
                  <TextField label="Start date" type="date" value={startDate} min={today} onChange={(e) => setStartDate(e.target.value)} />
                  <label className="wp-field"><span className="wp-field-label">Project (optional)</span>
                    <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!client}>
                      <option value="">No project</option>
                      {client?.projects.map((p) => <option key={p._id} value={p._id}>{p.label}</option>)}
                    </select></label>
                </div>
              </div>
            </Card>
            <Card label="Trial and first invoice" head={<SectionHead label="Trial and first invoice" />}>
              <div className="inv-form">
                <Checkbox checked={trial} onChange={setTrial} label="Start with a free trial" hint="Days before the first charge. The client sees “Trial ends {date}”." />
                {trial && <TextField label="Trial days" inputMode="numeric" value={String(trialDays)} onChange={(e) => setTrialDays(Number(e.target.value.replace(/\D/g, "")) || 0)} style={{ maxWidth: 160 }} />}
                {!trial && <div className="wp-field"><span className="wp-field-label">First invoice</span>
                  <div className="sub-choice">
                    <Checkbox checked={first === "start"} onChange={() => setFirst("start")} label={later ? `On the start date (${dateShort(startDate)})` : "On the start date (today)"} />
                    <Checkbox checked={first === "now"} onChange={() => setFirst("now")} label="Now, then each period from the start date" />
                  </div></div>}
                <Divider />
                <p className="secondary sub-note">First payment: the portal emails {who?.name?.split(/\s+/)[0] || "them"} a link to add a card or bank account{trial ? "" : " and pay the first invoice"}. After that, Stripe charges the saved method each period.</p>
              </div>
            </Card>
          </div>
          <div className="col right">
            <Card label="Summary" head={<SectionHead label="Summary" />}>
              <dl className="pay-rows sub-sum">
                <dt>Client</dt><dd>{client ? [client.name, who?.name].filter(Boolean).join(" · ") : "—"}</dd>
                <dt>Plan</dt><dd>{plan?.name ?? "—"}</dd>
                <dt className="big">Price</dt><dd className="big">{plan?.price ?? "—"}</dd>
                <dt>Starts</dt><dd>{dateShort(startDate)}{startDate === today ? " (today)" : ""}</dd>
                {trial && <><dt>Trial</dt><dd>{trialDays} days</dd></>}
                <dt>First invoice</dt><dd>{firstCharge}</dd>
                <dt>Then</dt><dd>{plan ? everyText(plan.interval, plan.intervalCount).replace(/^every/, "Every") : "—"}</dd>
              </dl>
            </Card>
          </div>
        </div>
      </div>
      {asking && plan && client && who && (
        <Modal onClose={() => setAsking(false)} label="Start subscription" width={560}>
          <div style={{ display: "grid", gap: 20 }}>
            <div className="dhead">
              <div style={{ display: "grid", gap: 6 }}>
                <span className="eyebrow">{plan.name}</span>
                <h2 className="headline">Start this subscription for {client.name}?</h2>
                <p className="secondary" style={{ margin: 0 }}>The portal emails {who.name.split(/\s+/)[0]} a link to add a payment method{trial ? "" : " and pay the first invoice"}. Stripe charges it {everyText(plan.interval, plan.intervalCount)} after that.</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setAsking(false)} aria-label="Close"><Icon name="close" size={18} /></button>
            </div>
            <dl className="pay-rows boxed">
              <dt>Plan</dt><dd>{plan.name}</dd>
              <dt className="big">Price</dt><dd className="big">{plan.price}</dd>
              <dt>Starts</dt><dd>{dateShort(startDate)}</dd>
              <dt>First invoice</dt><dd>{firstCharge}</dd>
              <dt>Trial</dt><dd>{trial ? `${trialDays} days` : "None"}</dd>
            </dl>
            <Checkbox checked={postInbox} onChange={setPostInbox} label="Post “New subscription” to their Inbox" />
            <p className="secondary" style={{ margin: 0 }}>Nothing is charged until {who.name.split(/\s+/)[0]} adds a payment method.</p>
            <div className="dfoot"><Button variant="ghost" onClick={() => setAsking(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void go()}>Start subscription</Button></div>
          </div>
        </Modal>
      )}
      {toast}
    </>
  );
}

// ---------- the subscription page ----------

export function SubscriptionDetail({ subscriptionId }: { subscriptionId: string }) {
  const s = useQuery(api.subscriptions.get, { subscriptionId });
  const [toast, show] = useToast();
  const period = useMemo(() => (s?.currentPeriodStart && s.currentPeriodEnd ? `${dateShort(s.currentPeriodStart)} – ${dateShort(s.currentPeriodEnd)}` : null), [s]);
  if (s === undefined) return <div className="wp-page"><Card label="Subscription"><SkeletonRows n={5} /></Card></div>;
  if (s === null) return <div className="wp-page"><EmptyState icon="activity" title="That subscription isn't here." actions={<ButtonLink to="/payments/subscriptions">All subscriptions</ButtonLink>} /></div>;
  const st = s.status as SubStatus;
  const copy = async () => { try { await navigator.clipboard.writeText(s.link); show("Link copied."); } catch { show(s.link); } };
  return (
    <>
      <TopBar right={<SubscriptionActions s={s} show={show} />}>
        <span className="secondary">Payments</span><Sep /><a {...linkProps("/payments/subscriptions")}>Subscriptions</a><Sep /><span className="here">{s.client ?? s.person}</span>
      </TopBar>
      <div className="wp-page inv-detail">
        <header className="wp-pagehead inv-head">
          <div className="txt"><span className="wp-eyebrow">{s.client ?? s.person}</span><h1 className="wp-h2">{s.plan}.</h1>
            <p className="wp-body">{[s.person, s.project?.label, `started ${dateShort(s.startDate)}`].filter(Boolean).join(" · ")}</p></div>
          <SubChip status={st} />
        </header>
        {st === "past_due" && <div className="wp-notice sub-danger"><Icon name="alert" size={20} /><span className="txt"><b>The last payment didn't go through.</b> {s.lastFailure?.message ?? ""} {s.nextCharge ? `Stripe tries again ${dateShort(s.nextCharge)}.` : ""} {s.person.split(/\s+/)[0]} was emailed a link to update their payment method.</span></div>}
        {st === "waiting" && <div className="wp-notice"><Icon name="clock" size={20} /><span className="txt"><b>Waiting on {s.person.split(/\s+/)[0]} to add a payment method.</b> Nothing is charged until they do.</span><Button size="sm" onClick={() => void copy()}>Copy their link</Button></div>}
        <div className="inv-cols">
          <div className="col">
            <Card label="Plan" head={<SectionHead label="Plan" />}>
              <dl className="pay-rows sub-sum">
                <dt className="big">Price</dt><dd className="big">{s.price}</dd>
                {s.nextCharge && <><dt>Next charge</dt><dd>{dayLong(s.nextCharge)}</dd></>}
                {s.trialEnd && st === "trialing" && <><dt>Trial ends</dt><dd>{dayLong(s.trialEnd)}</dd></>}
                {period && st !== "waiting" && <><dt>This period</dt><dd>{period}</dd></>}
                {s.endsAt && <><dt>Ends</dt><dd>{dayLong(s.endsAt)}</dd></>}
                {s.pause && <><dt>Paused</dt><dd>{s.pause.resumesAt ? `until ${dayLong(s.pause.resumesAt)}` : "until you resume it"}</dd></>}
                <dt>Payment method</dt><dd>{s.method ?? "Not added yet"}</dd>
                <dt>Who pays</dt><dd>{s.billTo.name} · {s.billTo.email}</dd>
              </dl>
              {s.description && <p className="plan-note">{s.description}</p>}
            </Card>
            <Card label="Invoices" head={<SectionHead label="Invoices" count={s.invoices.length || undefined} />}>
              {s.invoices.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "invoice" }} title="No charges yet." meta="Each period's invoice shows here, charged automatically." />
                : s.invoices.map((i, n) => <div key={i._id} className="wp-rowwrap">{n > 0 && <Divider />}
                  <ListRow className="ilead" lead={{ icon: "invoice" }} to={`/payments/invoices/${i._id}`} chevron title={new Date(i.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                    meta={[i.number, i.paidAt ? `paid ${dateShort(i.paidAt)}` : dateShort(i.createdAt)].filter(Boolean).join(" · ")} trailing={money(i.totalCents)}
                    chip={<StatusChip tone={i.status === "paid" ? "success" : i.failed ? "danger" : i.status === "open" ? "warning" : "neutral"}>{i.status === "paid" ? "Paid" : i.failed ? "Failed" : i.status === "open" ? "Due" : i.status === "void" ? "Void" : "Closed"}</StatusChip>} />
                </div>)}
            </Card>
          </div>
          <div className="col right">
            <Card label="History" head={<SectionHead label="History" />}>
              <ol className="inv-hist">
                {s.history.map((h, n) => <li key={n}><Icon name={h.kind === "past_due" ? "alert" : h.kind === "canceled" || h.kind === "ending" ? "close" : h.kind === "paused" ? "pause" : h.kind.startsWith("email") ? "mail" : "check-circle"} size={16} /><span><b>{histText(h.kind, h.detail)}</b><small>{dateShort(h.at)}{h.by ? ` · ${h.by}` : ""}</small></span></li>)}
              </ol>
            </Card>
            <Card label="Links" head={<SectionHead label="Links" />}>
              <div className="inv-form">
                <Button onClick={() => void copy()} icon="external">Copy the client's page link</Button>
                {s.stripeUrl && <a className="btn ghost" href={s.stripeUrl} target="_blank" rel="noopener noreferrer">Open in Stripe<Icon name="external" size={14} /></a>}
              </div>
            </Card>
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}

function histText(kind: string, detail?: string) {
  const T: Record<string, string> = {
    created: "Started", emailed: "Emailed the link to add a payment method", email_held: "Email held (preview)", method: "Payment method saved", started: "Started in Stripe",
    active: "Active", past_due: "Payment failed", trialing: "Trial started", scheduled: "Starts later", paused: "Paused", ending: "Cancelled at the end of the period", canceled: "Cancelled",
    resumed: "Resumed", plan_changed: "Plan changed", upcoming_emailed: "Upcoming charge email sent", failed_emailed: "Payment failed email sent",
  };
  return [T[kind] ?? kind, detail].filter(Boolean).join(" · ");
}
