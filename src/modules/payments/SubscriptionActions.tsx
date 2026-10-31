// Phase 2b: the subscription page's actions, each with its confirm (dialogs 253:3522 change plan, 253:3583 pause,
// 253:3630 resume, 253:3671 cancel). Stripe works out the proration; the portal shows it before the owner confirms.
import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { Button, Checkbox, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/kit";
import { errText } from "../docs/pages/common";
import { dateShort, isoIn, money } from "./common";

type S = NonNullable<ReturnType<typeof useQuery<typeof api.subscriptions.get>>>;
type Ask = null | "change" | "pause" | "resume" | "cancel";

function Dialog({ eyebrow, title, body, onClose, children, confirm, busy, onConfirm, keep = "Cancel" }: {
  eyebrow?: string; title: string; body?: React.ReactNode; onClose: () => void; children?: React.ReactNode; confirm: string; busy: boolean; onConfirm: () => void; keep?: string;
}) {
  return (
    <Modal onClose={onClose} label={title} width={560}>
      <div style={{ display: "grid", gap: 20 }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 className="headline">{title}</h2>{body && <p className="secondary" style={{ margin: 0 }}>{body}</p>}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        {children}
        <div className="dfoot"><Button variant="ghost" onClick={onClose}>{keep}</Button><Button variant="primary" loading={busy} onClick={onConfirm}>{confirm}</Button></div>
      </div>
    </Modal>
  );
}

export function SubscriptionActions({ s, show }: { s: S; show: (m: string) => void }) {
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await f(); show(done); setAsk(null); } catch (e) { show(errText(e)); }
    setBusy(false);
  };
  const st = s.status;
  const id = s._id as Id<"subscriptions">;
  const resume = useAction(api.subscriptions.resume);
  const cancel = useAction(api.subscriptions.cancel);
  const pause = useAction(api.subscriptions.pause);
  const [when, setWhen] = useState<"period_end" | "now">("period_end");
  const [resumeOn, setResumeOn] = useState<string>("");
  const first = s.person.split(/\s+/)[0];
  if (st === "canceled") return null;
  return (
    <>
      {st === "ending" && <Button onClick={() => setAsk("resume")}>Keep it</Button>}
      {st === "paused" && <Button onClick={() => setAsk("resume")}>Resume…</Button>}
      {s.inStripe && !["paused", "ending"].includes(st) && <><Button onClick={() => setAsk("change")}>Change plan…</Button><Button onClick={() => setAsk("pause")}>Pause…</Button></>}
      {st !== "ending" && <Button onClick={() => setAsk("cancel")}>Cancel subscription…</Button>}
      {ask === "change" && <ChangePlan s={s} onClose={() => setAsk(null)} show={show} />}
      {ask === "pause" && (
        <Dialog eyebrow={s.plan} title={`Pause ${s.client ?? first}'s subscription?`} onClose={() => setAsk(null)} busy={busy} confirm="Pause subscription"
          body={`Charges stop while it's paused. Invoices Stripe makes in that time are voided, so ${first} never sees a bill for a paused period.`}
          onConfirm={() => void run(() => pause({ subscriptionId: id, resumeOn: resumeOn || undefined }), "Subscription paused.")}>
          <Checkbox checked={!resumeOn} onChange={() => setResumeOn("")} label="Until I resume it" />
          <Checkbox checked={!!resumeOn} onChange={() => setResumeOn(resumeOn || isoIn(30))} label="Resume on a date" />
          {resumeOn && <TextField label="Resume on" type="date" min={isoIn(1)} value={resumeOn} onChange={(e) => setResumeOn(e.target.value)} style={{ maxWidth: 220 }} />}
        </Dialog>
      )}
      {ask === "resume" && (
        <Dialog eyebrow={s.plan} title={st === "ending" ? "Keep this subscription going?" : "Resume this subscription?"} onClose={() => setAsk(null)} busy={busy} confirm={st === "ending" ? "Keep it" : "Resume subscription"}
          body={st === "ending" ? `It won't end${s.endsAt ? ` on ${dateShort(s.endsAt)}` : ""}; Stripe keeps charging ${s.price}.` : `Stripe starts charging ${s.price} again from the next period.`}
          onConfirm={() => void run(() => resume({ subscriptionId: id }), st === "ending" ? "It'll keep going." : "Subscription resumed.")} keep="Not now" />
      )}
      {ask === "cancel" && (
        <Dialog eyebrow={s.plan} title={`Cancel ${s.client ?? first}'s subscription?`} onClose={() => setAsk(null)} busy={busy} confirm="Cancel subscription" keep="Keep it"
          body={s.inStripe ? `${first} is emailed that it's ending. Past invoices and receipts stay.` : `${first} hasn't added a payment method yet, so nothing has been charged.`}
          onConfirm={() => void run(() => cancel({ subscriptionId: id, when: s.inStripe ? when : "now" }), "Subscription cancelled.")}>
          {s.inStripe && <>
            <Checkbox checked={when === "period_end"} onChange={() => setWhen("period_end")} label={`At the end of this period${s.currentPeriodEnd ? ` (${dateShort(s.currentPeriodEnd)})` : ""}`} hint="No more charges after that." />
            <Checkbox checked={when === "now"} onChange={() => setWhen("now")} label="Now" hint="Ends today. Nothing is refunded automatically; refund in Stripe if you need to." />
          </>}
        </Dialog>
      )}
    </>
  );
}

function ChangePlan({ s, onClose, show }: { s: S; onClose: () => void; show: (m: string) => void }) {
  const plans = useQuery(api.plans.list, {});
  const preview = useAction(api.subscriptions.changePreview);
  const change = useAction(api.subscriptions.changePlan);
  const [planId, setPlanId] = useState("");
  const [p, setP] = useState<{ amountCents: number; at: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const options = (plans ?? []).filter((x) => !x.archived && x.name !== s.plan);
  useEffect(() => {
    if (!planId) { setP(null); return; }
    let live = true;
    preview({ subscriptionId: s._id as Id<"subscriptions">, planId: planId as Id<"plans"> }).then((r) => live && setP(r)).catch((e) => live && show(errText(e)));
    return () => { live = false; };
  }, [planId, preview, s._id, show]);
  const go = async () => {
    setBusy(true);
    try { await change({ subscriptionId: s._id as Id<"subscriptions">, planId: planId as Id<"plans"> }); show("Plan changed."); onClose(); }
    catch (e) { show(errText(e)); }
    setBusy(false);
  };
  return (
    <Dialog eyebrow={s.plan} title="Change plan" onClose={onClose} busy={busy} confirm="Change plan" onConfirm={() => planId && void go()}
      body="Stripe works out the difference for the rest of this period and adds it to the next invoice.">
      <label className="wp-field"><span className="wp-field-label">New plan</span>
        <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>
          <option value="">Choose a plan…</option>
          {options.map((x) => <option key={x._id} value={x._id}>{x.name} · {x.price}</option>)}
        </select></label>
      {planId && <dl className="pay-rows boxed">
        <dt>Now</dt><dd>{s.price}</dd>
        <dt>New</dt><dd>{options.find((x) => x._id === planId)?.price}</dd>
        <dt>Next invoice{p?.at ? ` (${dateShort(p.at)})` : ""}</dt><dd>{p ? money(p.amountCents) : "Working it out…"}</dd>
      </dl>}
    </Dialog>
  );
}
