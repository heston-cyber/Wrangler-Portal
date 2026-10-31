// Phase 2b (Oct 30): Payments › Plans (frame 250:1955) and New plan / editing a plan (250:2545). A plan is a price
// the owner reuses when starting subscriptions; it lives as a product and price in the business's own Stripe.
import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { Button, ButtonLink, Card, Divider, EmptyState, ListRow, PageHeader, Segmented, SectionHead, SkeletonRows, StatusChip, TextArea, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { MoneyInput, money } from "./common";

type Interval = "day" | "week" | "month" | "year";
type Every = "month" | "year" | "custom";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const everyWords = (interval: Interval, count: number) => (count === 1 ? `every ${interval}` : `every ${count} ${interval}s`);

function usage(p: { active: number; trialing: number; other: number; ended: number }) {
  const bits: string[] = [];
  if (p.active) bits.push(`${plural(p.active, "active subscription")}`);
  if (p.trialing) bits.push(`${plural(p.trialing, "subscription")} (trialing)`);
  if (p.other) bits.push(`${plural(p.other, "starting subscription")}`);
  if (!bits.length) bits.push(p.ended ? `${plural(p.ended, "ended subscription")}` : "no subscriptions");
  return bits.join(", ");
}

export default function PlansPage() {
  const plans = useQuery(api.plans.list, {});
  const pay = useQuery(api.payments.settings, {});
  const active = (plans ?? []).filter((p) => !p.archived);
  const archived = (plans ?? []).filter((p) => p.archived);
  const notConnected = pay && pay.stripe?.status !== "connected";
  const row = (p: NonNullable<typeof plans>[number]) => (
    <ListRow key={p._id} className="ilead" lead={{ icon: "activity" }} to={`/payments/plans/${p._id}`} chevron title={p.name}
      meta={`${p.price} · ${usage(p)}`} chip={<StatusChip tone={p.archived ? "neutral" : "success"}>{p.archived ? "Archived" : "Active"}</StatusChip>} />
  );
  return (
    <>
      <TopBar><span className="secondary">Payments</span><Sep /><span className="here">Plans</span></TopBar>
      <div className="wp-page inv-list">
        <PageHeader eyebrow="Payments" title="Plans." sub="The price list you reuse when you start a subscription."
          actions={<ButtonLink variant="primary" to="/payments/plans/new">New plan</ButtonLink>} />
        {notConnected && <div className="wp-notice"><Icon name="info" size={20} /><span className="txt"><b>Stripe isn't connected.</b> Plans live in your Stripe account, so they need Stripe (Settings › Payments).</span><ButtonLink size="sm" to="/settings/payments">Settings › Payments</ButtonLink></div>}
        {plans === undefined ? <Card label="Plans"><SkeletonRows n={3} /></Card>
          : plans.length === 0 ? <EmptyState icon="activity" title="No plans yet." body="A plan is a price you reuse, like a monthly retainer. Make one, then start a subscription for a client."
            actions={<ButtonLink variant="primary" to="/payments/plans/new">New plan</ButtonLink>} />
          : <>
            {active.length > 0 && <Card label="Plans" head={<SectionHead label="Plans" count={active.length} />}>{active.map((p, i) => <div key={p._id} className="wp-rowwrap">{i > 0 && <Divider />}{row(p)}</div>)}</Card>}
            {archived.length > 0 && <Card label="Archived" head={<SectionHead label="Archived" count={archived.length} />}>{archived.map((p, i) => <div key={p._id} className="wp-rowwrap">{i > 0 && <Divider />}{row(p)}</div>)}</Card>}
          </>}
      </div>
    </>
  );
}

/** New plan, or an existing plan (edit, archive). */
export function PlanEditor({ planId }: { planId?: string }) {
  const existing = useQuery(api.plans.get, planId ? { planId } : "skip");
  const save = useAction(api.plans.save);
  const archive = useAction(api.plans.setArchived);
  const [toast, show] = useToast();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState(0);
  const [every, setEvery] = useState<Every>("month");
  const [count, setCount] = useState(3);
  const [unit, setUnit] = useState<Interval>("month");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<null | "save" | "archive">(null);
  const [loaded, setLoaded] = useState(!planId);
  useEffect(() => {
    if (!existing || loaded) return;
    setName(existing.name); setAmount(existing.amountCents); setDescription(existing.description ?? "");
    if (existing.intervalCount === 1 && (existing.interval === "month" || existing.interval === "year")) setEvery(existing.interval);
    else { setEvery("custom"); setCount(existing.intervalCount); setUnit(existing.interval); }
    setLoaded(true);
  }, [existing, loaded]);
  if (planId && existing === null) return <div className="wp-page"><EmptyState icon="activity" title="That plan isn't here." actions={<ButtonLink to="/payments/plans">All plans</ButtonLink>} /></div>;
  if (planId && (!existing || !loaded)) return <div className="wp-page"><Card label="Plan"><SkeletonRows n={4} /></Card></div>;
  const interval: Interval = every === "custom" ? unit : every;
  const intervalCount = every === "custom" ? Math.max(1, Math.floor(count) || 1) : 1;
  const doSave = async () => {
    setBusy("save");
    try {
      const id = await save({ planId: planId as Id<"plans"> | undefined, name, description: description || undefined, amountCents: amount, interval, intervalCount });
      show(planId ? "Plan saved." : "Plan made.");
      navigate(planId ? `/payments/plans/${id}` : "/payments/plans");
    } catch (e) { show(errText(e)); }
    setBusy(null);
  };
  const doArchive = async (archived: boolean) => {
    setBusy("archive");
    try { await archive({ planId: planId as Id<"plans">, archived }); show(archived ? "Plan archived. Subscriptions on it keep going." : "Plan brought back."); }
    catch (e) { show(errText(e)); }
    setBusy(null);
  };
  const title = planId ? existing?.name ?? "Plan" : "New plan";
  return (
    <>
      <TopBar right={<>
        <a className="btn ghost" {...linkProps("/payments/plans")}>Cancel</a>
        <Button variant="primary" onClick={() => void doSave()} loading={busy === "save"} disabled={!name.trim() || amount < 50}>Save plan</Button>
      </>}>
        <span className="secondary">Payments</span><Sep /><a {...linkProps("/payments/plans")}>Plans</a><Sep /><span className="here">{title}</span>
      </TopBar>
      <div className="wp-page inv-edit">
        <header className="wp-pagehead"><div className="txt"><span className="wp-eyebrow">{planId ? (existing?.archived ? "Archived plan" : "Plan") : "New plan"}</span>
          <h1 className="wp-h2">{planId ? `${existing?.name}.` : "New plan."}</h1>
          <p className="wp-body">A plan is a price you can reuse. Starting a subscription is a separate step.</p></div></header>
        <div className="inv-cols">
          <div className="col">
            <Card label="Plan" head={<SectionHead label="Plan" />}>
              <div className="inv-form">
                <TextField label="Name" value={name} maxLength={120} placeholder="Monthly content retainer" onChange={(e) => setName(e.target.value)} />
                <label className="wp-field"><span className="wp-field-label">Price</span><MoneyInput label="Price" value={amount} onChange={setAmount} /><span className="wp-field-hint">US dollars</span></label>
                <div className="wp-field"><span className="wp-field-label">Bills every</span>
                  <Segmented label="Bills every" value={every} onChange={setEvery} items={[{ key: "month", label: "Month" }, { key: "year", label: "Year" }, { key: "custom", label: "Custom" }]} />
                </div>
                {every === "custom" && <div className="row2 plan-custom">
                  <TextField label="Every" inputMode="numeric" value={String(count)} onChange={(e) => setCount(Number(e.target.value.replace(/\D/g, "")) || 0)} />
                  <label className="wp-field"><span className="wp-field-label">Unit</span>
                    <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as Interval)}>
                      <option value="week">Weeks</option><option value="month">Months</option><option value="year">Years</option>
                    </select></label>
                </div>}
                <TextArea label="Description" value={description} rows={4} maxLength={500} placeholder="What the client gets each period" onChange={(e) => setDescription(e.target.value)} hint="Shows on the client's subscription page and invoices." />
              </div>
            </Card>
            {planId && existing && <Card label="Archive" head={<SectionHead label={existing.archived ? "Archived" : "Archive"} />}>
              <div className="inv-form">
                <p className="secondary">{existing.archived ? "This plan can't start new subscriptions. Subscriptions already on it keep going." : `Archiving stops new subscriptions on this plan. ${existing.used ? `The ${plural(existing.used, "subscription")} on it keep going.` : "Nothing uses it right now."}`}</p>
                <div><Button onClick={() => void doArchive(!existing.archived)} loading={busy === "archive"}>{existing.archived ? "Bring it back" : "Archive plan"}</Button></div>
              </div>
            </Card>}
          </div>
          <div className="col right">
            <Card label="What clients see" head={<SectionHead label="What clients see" />}>
              <div className="plan-preview">
                <span className="name">{name.trim() || "Plan name"}</span>
                <span className="price">{money(amount)}</span>
                <span className="every">{everyWords(interval, intervalCount)}</span>
                <span className="desc">{description.trim() || "What the client gets each period"}</span>
              </div>
            </Card>
            <Card label="Good to know" head={<SectionHead label="Good to know" />}>
              <p className="plan-note">Changing a plan's price later doesn't change subscriptions that already use it. Change those one by one from the subscription.</p>
            </Card>
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}
