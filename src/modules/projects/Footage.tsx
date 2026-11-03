// Phase 5 (Nov 3): raw footage storage (S5 · Phase 5). The owner's "Raw footage storage" card on the project's Delivery
// tab (743:2532) and the client's Raw footage card on their project's Overview (Offer 742:2695, Kept 742:2954, No thanks
// 742:3216). D98: kept 30 days unless they keep it, or the owner copies it to the client's own drive ("Copied to their
// drive" has no frame: built in the card's look). The portal never deletes files.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, ButtonLink, Card, SectionHead, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { useConfirm } from "../../ui/kit";
import { errText } from "../docs/pages/common";

const longDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const atDay = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const perYear = (c: number) => `${usd(c).replace(/\.00$/, "")}/year`;
const minusDays = (ymd: string, n: number) => { const t = new Date(`${ymd}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10); };

function Row({ title, body, chip }: { title: React.ReactNode; body: React.ReactNode; chip?: React.ReactNode }) {
  return <div className="ft-row"><div className="txt"><b>{title}</b><span className="secondary">{body}</span></div>{chip && <span className="chip">{chip}</span>}</div>;
}

// ---------- the owner ----------

export function FootageCard({ projectId, show }: { projectId: string; show: (m: string) => void }) {
  const d = useQuery(api.footage.forProject, { projectId });
  const drive = useMutation(api.footage.recordDrive);
  const stop = useMutation(api.footage.stop);
  const done = useMutation(api.footage.markDone);
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  if (!d) return null;
  const client = d.client ?? "The client";
  const run = async (f: () => Promise<unknown>, msg: string) => { setBusy(true); try { await f(); show(msg); } catch (e) { show(errText(e)); } setBusy(false); };
  const head = <SectionHead label="Raw footage storage" />;

  if (!d.storage) {
    return (
      <Card className="ft-card" label="Raw footage storage" head={head}>
        <div className="ft-rows">
          {d.delivered
            ? <Row title="No storage offer on this project" body="It was delivered before storage offers began, so nothing was offered. The portal never deletes files." />
            : d.settings.on
              ? <Row title="Offered at delivery" body={`When the final files first open, ${client} is offered: kept ${d.settings.keepDays} days, then ${perYear(d.settings.priceCents)} to keep it (Settings › Payments).`} />
              : <Row title="Not offered" body="Storage isn't offered at delivery. Turn it on in Settings › Payments › Footage storage." />}
        </div>
      </Card>
    );
  }
  const s = d.storage;
  const who = s.by?.name ?? client;
  const markDrive = async () => {
    if (!(await confirm({ title: `Copied to ${client}'s drive?`, body: "This stops the keep-date reminder. The portal still won't delete anything: remove your copy when you're ready.", yes: "Copied to their drive", danger: false }))) return;
    await run(() => drive({ projectId }), "Recorded: copied to their drive.");
  };
  const markDone = () => void run(() => done({ projectId }), "Marked as deleted or moved.");
  const invoiceLink = s.invoice ? <ButtonLink size="sm" to={`/payments/invoices/${s.invoice._id}`}>{s.invoice.status === "draft" ? "Check and send" : "Open invoice"}</ButtonLink> : null;

  let rows: React.ReactNode;
  let actions: React.ReactNode = null;
  if (s.status === "offered" || s.status === "declined") {
    rows = <>
      {s.status === "offered"
        ? <Row title={`Offered to ${client} at delivery`} body={`Kept until ${shortDay(s.keepUntil)} · ${perYear(s.priceCents)} · from Settings › Payments`} chip={<StatusChip tone="accent">Offered</StatusChip>} />
        : <Row title={`${who} said no thanks`} body={`${s.by ? atDay(s.by.at) : ""} · They can still press Keep it until ${shortDay(s.keepUntil)}.`} chip={<StatusChip tone="neutral">No thanks</StatusChip>} />}
      <Row title={`If ${client} keeps it`} body={`A ${usd(s.priceCents)} yearly invoice draft appears in Payments for you to check and send.`} />
      <Row title={`If not, on ${shortDay(s.keepUntil)}`} body="You get a reminder to delete or offload it. The portal never deletes files." chip={<StatusChip tone="warning">Reminder</StatusChip>} />
    </>;
    actions = <Button size="sm" disabled={busy} onClick={() => void markDrive()}>Copied to their drive</Button>;
  } else if (s.status === "kept") {
    rows = <>
      <Row title={`${who} is keeping it`} body={`${s.by ? `Pressed Keep it ${atDay(s.by.at)}. ` : ""}A year, until ${longDay(s.keptUntil!)}, once it's paid.`} chip={<StatusChip tone="success">Kept</StatusChip>} />
      <Row title={s.invoice ? `Invoice ${s.invoice.number ?? "draft"} · ${usd(s.invoice.totalCents)}` : "Invoice"} body={s.invoice?.status === "draft" ? "A draft waiting for you in Payments. Nothing is charged until you send it." : s.invoice?.status === "paid" ? "Paid." : "Sent. Kept for the year once it's paid."} chip={s.invoice?.status === "draft" ? <StatusChip tone="warning">To send</StatusChip> : undefined} />
    </>;
    actions = invoiceLink;
  } else if (s.status === "paid") {
    rows = <>
      <Row title={`Kept until ${longDay(s.paidUntil!)}`} body={`${perYear(s.priceCents)}, paid.`} chip={<StatusChip tone="success">Paid</StatusChip>} />
      <Row title="Next year" body={s.renewing ? `Next year's invoice is drafted${s.invoice?.status === "draft" ? ": check and send it" : ""}.` : `Next year's invoice is drafted on ${shortDay(minusDays(s.paidUntil!, 30))}, for you to send.`} chip={s.renewing && s.invoice?.status === "draft" ? <StatusChip tone="warning">To send</StatusChip> : undefined} />
    </>;
    actions = <>{s.renewing && invoiceLink}<Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
      if (!(await confirm({ title: "Stop storing their raw footage?", body: "No more yearly invoices are drafted. The portal won't delete anything: you'll do that yourself.", yes: "Stop storing", danger: true }))) return;
      await run(() => stop({ projectId }), "Storing stopped.");
    }}>Stop storing</Button></>;
  } else {
    const title = s.status === "drive" ? `Copied to ${client}'s drive` : s.status === "stopped" ? "Storing stopped" : `Not kept · reminder sent ${s.endedAt ? atDay(s.endedAt) : ""}`;
    rows = <>
      <Row title={title} body={s.doneAt ? `Deleted or moved (marked ${atDay(s.doneAt)}).` : "Delete it or move it to cold storage when you're ready. The portal never deletes files."}
        chip={s.doneAt ? <StatusChip tone="neutral">Done</StatusChip> : s.status === "ended" ? <StatusChip tone="warning">Reminder</StatusChip> : <StatusChip tone="neutral">{s.status === "drive" ? "On their drive" : "Stopped"}</StatusChip>} />
    </>;
    actions = <>{s.status === "ended" && !s.doneAt && <Button size="sm" disabled={busy} onClick={() => void markDrive()}>Copied to their drive</Button>}{!s.doneAt && <Button size="sm" variant="primary" disabled={busy} onClick={markDone}>Deleted or moved</Button>}</>;
  }
  return (
    <Card className="ft-card" label="Raw footage storage" head={head}>
      <div className="ft-rows">{rows}</div>
      {actions && <div className="ft-acts">{actions}</div>}
      {confirmDialog}
    </Card>
  );
}

// ---------- the client ----------

export function ClientFootage({ projectId, show }: { projectId: string; show: (m: string) => void }) {
  const d = useQuery(api.footage.forClientProject, { projectId });
  const keep = useMutation(api.footage.keep);
  const decline = useMutation(api.footage.decline);
  const [busy, setBusy] = useState(false);
  if (!d) return null;
  const go = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); } catch (e) { show(errText(e)); } setBusy(false); };
  const price = perYear(d.priceCents);
  return (
    <Card className="cpj-footage" label="Raw footage" head={<SectionHead label="Raw footage" />}>
      <div className="cpj-ftbody">
      {d.status === "offered" && <div className="cpj-ft">
        <b className="q">Raw footage kept until {shortDay(d.keepUntil)}. Keep it for {price}?</b>
        <p className="secondary">We keep every clip from the shoot, safe and backed up, so you can ask for new cuts later. You'd get a yearly invoice; stop any time.</p>
        <div className="acts">
          <Button variant="primary" disabled={busy} onClick={() => void go(() => keep({ projectId }))}>Keep it</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void go(() => decline({ projectId }))}>No thanks</Button>
        </div>
      </div>}
      {d.status === "declined" && <div className="cpj-ftbox no">
        <Icon name="alert" size={20} />
        <span className="txt"><b>Raw footage won't be kept</b><span className="secondary">{d.business} keeps it until {shortDay(d.keepUntil)}, then lets it go. Changed your mind before then? Press Keep it.</span></span>
        <Button size="sm" disabled={busy} onClick={() => void go(() => keep({ projectId }))}>Keep it</Button>
      </div>}
      {(d.status === "kept" || d.status === "paid") && <div className="cpj-ftbox yes">
        <Icon name="check-circle" size={20} />
        <span className="txt"><b>{d.status === "paid" ? `Kept until ${longDay(d.paidUntil!)}` : `Kept for a year · until ${longDay(d.keptUntil!)}`}</b>
          <span className="secondary">{d.status === "paid" ? `${price}. Ask for new cuts any time.` : `The invoice for ${usd(d.invoiceCents)} is on its way.${d.by ? ` Thanks, ${d.by.split(/\s+/)[0]}.` : ""}`}</span></span>
      </div>}
      </div>
    </Card>
  );
}
