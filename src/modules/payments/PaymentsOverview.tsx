// Payments › Overview (approved Oct 30: 281:8360 invoices only, 281:9192 empty, 281:9643 disconnected, 282:8525 phone).
// Clicking Payments opens it. Four numbers that link to the matching invoices, what needs the owner, paid totals and
// recent activity. Subscriptions (281:7481) join with Phase 2b.
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { ButtonLink, Card, Divider, EmptyState, ListRow, PageHeader, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon, type IconName } from "../../ui/Icon";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { dateShort, money } from "./common";

const ICON: Record<string, IconName> = { paid: "check-circle", viewed: "eye", sent: "send", processing: "clock", failed: "alert", refunded: "arrow-left" };
const when = (t: number) => { const d = Math.floor((Date.now() - t) / 86_400_000); return d === 0 && new Date(t).getDate() === new Date().getDate() ? "today" : dateShort(t); };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Stat({ label, cents, sub, to, link }: { label: string; cents: number; sub: string; to: string; link: string }) {
  return (
    <div className="pov-stat">
      <span className="lbl">{label}</span>
      <b>{money(cents)}</b>
      <span className="sub">{sub}</span>
      <a {...linkProps(to)} className="go">{link}<Icon name="arrow-right" size={14} /></a>
    </div>
  );
}

/** Phase 2b: the Recurring card (active subscriptions, monthly recurring, past due, the next charges). */
export function Recurring({ withPastDue = false }: { withPastDue?: boolean }) {
  const subs = useQuery(api.subscriptions.list, {});
  if (!subs || subs.rows.length === 0) return null;
  const late = withPastDue ? subs.rows.filter((r) => r.status === "past_due") : [];
  const next = subs.rows.filter((r) => r.nextCharge && ["active", "trialing", "scheduled"].includes(r.status)).sort((a, b) => a.nextCharge! - b.nextCharge!).slice(0, 4);
  return (
    <Card label="Recurring" head={<SectionHead label="Recurring" action={<ButtonLink size="sm" variant="ghost" to="/payments/subscriptions">Subscriptions</ButtonLink>} />}>
      <dl className="pov-paid">
        <dt className="big">Monthly recurring</dt><dd className="big">{money(subs.numbers.monthlyCents)}</dd>
        <dt>Active subscriptions</dt><dd>{subs.numbers.active}</dd>
        <dt>Past due</dt><dd>{subs.numbers.pastDue}</dd>
      </dl>
      {late.map((r) => <div key={r._id} className="wp-rowwrap"><Divider />
        <ListRow className="ilead" lead={{ icon: "alert" }} title={[r.client, r.plan].filter(Boolean).join(" · ")} meta={`${money(r.amountCents)} · payment failed${r.lastFailure ? ` ${dateShort(r.lastFailure.at)}` : ""}`}
          chip={<StatusChip tone="danger">Past due</StatusChip>} action={<ButtonLink size="sm" to={`/payments/subscriptions/${r._id}`} iconEnd={false}>Open</ButtonLink>} />
      </div>)}
      {next.map((r, i) => <div key={r._id} className="wp-rowwrap">{(i > 0 || late.length > 0) && <Divider />}
        <ListRow className="ilead" lead={{ icon: "activity" }} to={`/payments/subscriptions/${r._id}`} title={[r.client, r.plan].filter(Boolean).join(" · ")} meta={`${money(r.amountCents)} · ${dateShort(r.nextCharge!)}`} />
      </div>)}
    </Card>
  );
}

export default function PaymentsOverview() {
  const o = useQuery(api.invoices.overview, { tzOffsetMin: new Date().getTimezoneOffset() });
  const off = o?.stripe === "disconnected";
  return (
    <>
      <TopBar><span className="secondary">Payments</span><Sep /><span className="here">Overview</span></TopBar>
      <div className="wp-page pov">
        <PageHeader eyebrow="Payments" title="Payments." sub="Money in, at a glance."
          actions={o && !off ? <ButtonLink variant="primary" icon="plus" to="/payments/invoices/new">New invoice</ButtonLink> : undefined} />
        {off && (
          <div className="wp-notice warn">
            <Icon name="alert" size={20} />
            <span className="txt"><b>Stripe is disconnected.</b><br />Clients can't pay in the portal until you connect again. Your history is still here.</span>
            <ButtonLink variant="primary" to="/settings/payments" iconEnd={false}>Go to Settings › Payments</ButtonLink>
          </div>
        )}
        {o === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card>
          : o === null ? null
          : o.invoices === 0 ? <EmptyState icon="invoice" title="No invoices yet." body="Stripe is connected. Send your first invoice and this page fills in." actions={off ? undefined : <ButtonLink variant="primary" to="/payments/invoices/new" iconEnd={false}>New invoice</ButtonLink>} />
          : <>
            <div className="pov-stats">
              <Stat label="Due" cents={o.due.cents} sub={plural(o.due.n, "invoice", "invoices")} to="/payments/invoices?show=due" link="View due" />
              <Stat label="Overdue" cents={o.overdue.cents} sub={plural(o.overdue.n, "invoice", "invoices")} to="/payments/invoices?show=due" link="View overdue" />
              <Stat label="On its way" cents={o.onItsWay.cents} sub={plural(o.onItsWay.n, "bank payment clearing", "bank payments clearing")} to="/payments/invoices?show=processing" link="View" />
              <Stat label="Paid this month" cents={o.paid.month} sub={`${money(o.paid.year)} this year`} to="/payments/invoices?show=paid" link="View paid" />
            </div>
            <div className="pov-cols">
              <div className="col">
                <Card label="Needs you" head={<SectionHead label="Needs you" count={o.needs.length || undefined} />}>
                  {o.needs.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "check-circle" }} title="Nothing needs you right now." />
                    : o.needs.map((n, i) => (
                      <div key={n._id} className="wp-rowwrap">{i > 0 && <Divider />}
                        <ListRow className="ilead inv-row" lead={{ icon: n.kind === "draft" ? "invoice" : "alert" }} title={[n.title, n.client].filter(Boolean).join(" · ")}
                          meta={`${n.detail} · ${n.kind === "draft" ? `drafted ${dateShort(n.at)}` : dateShort(n.at)} · ${money(n.cents)}`}
                          chip={<StatusChip tone={n.kind === "draft" ? "neutral" : "accent"}>{n.kind === "draft" ? "Draft" : "Payment failed"}</StatusChip>}
                          action={<ButtonLink size="sm" to={`/payments/invoices/${n._id}`} iconEnd={false}>{n.kind === "draft" ? "Review and send" : "Open"}</ButtonLink>} />
                      </div>
                    ))}
                </Card>
                <Card label="Recent activity" head={<SectionHead label="Recent activity" action={<ButtonLink size="sm" variant="ghost" to="/payments/invoices">See all</ButtonLink>} />}>
                  {o.activity.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "activity" }} title="Nothing yet. Sent invoices and payments show up here." />
                    : o.activity.map((a, i) => (
                      <div key={`${a.invoiceId}-${a.at}-${a.kind}`} className="wp-rowwrap">{i > 0 && <Divider />}
                        <ListRow className="ilead" to={`/payments/invoices/${a.invoiceId}`} lead={{ icon: ICON[a.kind] ?? "info" }} title={a.title} meta={[a.meta, when(a.at)].filter(Boolean).join(" · ")} />
                      </div>
                    ))}
                </Card>
              </div>
              <div className="col">
                <Card label="Paid" head={<SectionHead label="Paid" />}>
                  <dl className="pov-paid">
                    <dt className="big">This month</dt><dd className="big">{money(o.paid.month)}</dd>
                    <dt>This year</dt><dd>{money(o.paid.year)}</dd>
                    <dt>Last month</dt><dd>{money(o.paid.lastMonth)}</dd>
                  </dl>
                  <p className="secondary pov-note">In US dollars, from Stripe. Refunds are taken off.</p>
                </Card>
                <Recurring />
              </div>
            </div>
          </>}
      </div>
    </>
  );
}
