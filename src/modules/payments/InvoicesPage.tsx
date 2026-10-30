// Phase 2 Part B, step 2: Payments › Invoices (frame 226:5220): every invoice in groups (Needs attention, Drafts, Due,
// On its way, Paid, Closed), filter pills, New invoice. Also the rows a project's Invoices tab shows (231:6304).
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { Button, ButtonLink, Card, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { TopBar, Sep } from "../../shell/Shell";
import { InvoiceChip, dateShort, money, type InvoiceStatus } from "./common";
import { useToast } from "../../ui/kit";
import { navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import type { Id } from "../../../convex/_generated/dataModel";

export type Row = FunctionReturnType<typeof api.invoices.list>[number];
type Filter = "all" | "drafts" | "due" | "processing" | "failed" | "paid";

function detail(r: Row, withClient: boolean) {
  const bits: string[] = [];
  if (withClient && r.client) bits.push(r.client.name);
  if (withClient && r.project) bits.push(r.project.label);
  if (!withClient && r.number) bits.push(r.number);
  switch (r.status as InvoiceStatus) {
    case "draft": bits.push(`drafted ${dateShort(r.createdAt)}`); break;
    case "sending": bits.push("sending…"); break;
    case "failed": bits.push(`payment failed ${r.lastFailure ? dateShort(r.lastFailure.at) : ""}`.trim()); break;
    case "processing": bits.push("bank payment on its way · clears in a few business days"); break;
    case "overdue": bits.push(`was due ${dateShort(r.dueDate)}`); if (r.viewedAt) bits.push(`viewed ${dateShort(r.viewedAt)}`); break;
    case "partly_paid": bits.push(`due ${dateShort(r.dueDate)} · ${money(r.amountPaidCents)} of ${money(r.totalCents)} paid`); break;
    case "due": bits.push(`due ${dateShort(r.dueDate)}`); bits.push(r.viewedAt ? `viewed ${dateShort(r.viewedAt)}` : "not viewed yet"); break;
    case "paid": bits.push(`paid ${r.paidAt ? dateShort(r.paidAt) : ""}`.trim()); break;
    case "void": bits.push("void"); break;
    case "uncollectible": bits.push("marked uncollectible"); break;
  }
  return bits.join(" · ");
}

export function InvoiceRow({ r, withClient = true }: { r: Row; withClient?: boolean }) {
  const s = r.status as InvoiceStatus;
  const action = s === "draft"
    ? <ButtonLink size="sm" to={`/payments/invoices/${r._id}`}>Review and send</ButtonLink>
    : <Icon name="chevron-right" size={16} className="go" />;
  return (
    <ListRow className="ilead inv-row" to={s === "draft" ? undefined : `/payments/invoices/${r._id}`} lead={{ icon: "invoice" }}
      title={r.title} meta={detail(r, withClient)}
      trailing={<span className="inv-amt">{money(r.totalCents)}</span>} chip={<InvoiceChip status={s} />} action={action} />
  );
}

function Group({ label, rows, max }: { label: string; rows: Row[]; max?: number }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = max && !all ? rows.slice(0, max) : rows;
  return (
    <Card label={label} head={<SectionHead label={label} count={rows.length} />}>
      {shown.map((r, i) => <div key={r._id} className="wp-rowwrap">{i > 0 && <Divider />}<InvoiceRow r={r} /></div>)}
      {max && rows.length > max && <button type="button" className="inv-more" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${rows.length}`}<Icon name={all ? "arrow-up" : "chevron-down"} size={14} /></button>}
    </Card>
  );
}

export default function InvoicesPage() {
  const rows = useQuery(api.invoices.list, {});
  const pay = useQuery(api.payments.settings, {});
  // Opened from the Overview's numbers: ?show=due|processing|paid|drafts|failed.
  const [filter, setFilter] = useState<Filter>(() => { const q = new URLSearchParams(location.search).get("show"); return (["all", "drafts", "due", "processing", "failed", "paid"].includes(q ?? "") ? q : "all") as Filter; });
  const by = (ss: InvoiceStatus[]) => (rows ?? []).filter((r) => ss.includes(r.status as InvoiceStatus));
  const groups = {
    failed: by(["failed"]), drafts: by(["draft", "sending"]), due: by(["overdue", "partly_paid", "due"]),
    processing: by(["processing"]), paid: by(["paid"]), closed: by(["void", "uncollectible"]),
  };
  const count = (k: keyof typeof groups) => groups[k].length;
  const notConnected = pay && pay.stripe?.status !== "connected";
  return (
    <>
      <TopBar><span className="secondary">Payments</span><Sep /><span className="here">Invoices</span></TopBar>
      <div className="wp-page inv-list">
        <PageHeader eyebrow="Payments" title="Invoices." sub="Every invoice the portal has sent. Drafts wait for your OK."
          actions={<ButtonLink variant="primary" icon="plus" to="/payments/invoices/new">New invoice</ButtonLink>} />
        {notConnected && <div className="wp-notice"><Icon name="info" size={20} /><span className="txt"><b>Stripe isn't connected.</b> You can write drafts; sending needs Stripe (Settings › Payments).</span><ButtonLink size="sm" to="/settings/payments">Settings › Payments</ButtonLink></div>}
        {rows === undefined ? <Card label="Invoices"><SkeletonRows n={4} /></Card>
          : rows.length === 0 ? <EmptyState icon="invoice" title="No invoices yet." body="Write one with New invoice. Nothing sends until you press Send and confirm." actions={<ButtonLink variant="primary" icon="plus" to="/payments/invoices/new">New invoice</ButtonLink>} />
          : <>
            <PillTabs label="Show" value={filter} onChange={setFilter} items={[
              { key: "all", label: "All", count: rows.length }, { key: "drafts", label: "Drafts", count: count("drafts") }, { key: "due", label: "Due", count: count("due") },
              { key: "processing", label: "Processing", count: count("processing") }, { key: "failed", label: "Failed", count: count("failed") }, { key: "paid", label: "Paid", count: count("paid") },
            ]} />
            {(filter === "all" || filter === "failed") && <Group label="Needs attention" rows={groups.failed} />}
            {(filter === "all" || filter === "drafts") && <Group label="Drafts" rows={groups.drafts} />}
            {(filter === "all" || filter === "due") && <Group label="Due" rows={groups.due} />}
            {(filter === "all" || filter === "processing") && <Group label="On its way" rows={groups.processing} />}
            {(filter === "all" || filter === "paid") && <Group label="Paid" rows={groups.paid} max={filter === "all" ? 3 : undefined} />}
            {filter === "all" && <Group label="Closed" rows={groups.closed} max={3} />}
          </>}
      </div>
    </>
  );
}

/** The project page's Invoices tab. */
export function ProjectInvoices({ projectId, clientId }: { projectId: string; clientId?: string | null }) {
  const rows = useQuery(api.invoices.forProject, { projectId });
  const newLink = `/payments/invoices/new?project=${projectId}${clientId ? `&client=${clientId}` : ""}`;
  return (
    <>
      <Card label="Invoices" head={<SectionHead label="Invoices" count={rows?.length || undefined} action={<ButtonLink size="sm" variant="ghost" icon="plus" to={newLink}>New invoice</ButtonLink>} />}>
        {rows === undefined ? <SkeletonRows n={2} />
          : rows.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "invoice" }} title="No invoices on this project yet." />
          : rows.map((r, i) => <div key={r._id} className="wp-rowwrap">{i > 0 && <Divider />}<InvoiceRow r={r} withClient={false} /></div>)}
      </Card>
      <FinalFromContracts projectId={projectId} />
      <p className="secondary inv-note">Drafts never send themselves. "Review and send" asks for your OK first.</p>
    </>
  );
}

/** The plan's final invoice: for each signed contract of this client with a balance after the deposit, a button that
 *  drafts it (the total less the deposit). Nothing is drafted or sent on its own. */
function FinalFromContracts({ projectId }: { projectId: string }) {
  const opts = useQuery(api.invoices.finalOptions, { projectId });
  const draft = useMutation(api.invoices.draftFinal);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, show] = useToast();
  if (!opts || opts.length === 0) return null;
  const go = async (documentId: string) => {
    setBusy(documentId);
    try {
      const id = await draft({ projectId: projectId as Id<"projects">, documentId: documentId as Id<"wsDocuments"> });
      navigate(`/payments/invoices/${id}`);
    } catch (e) { show(errText(e)); setBusy(null); }
  };
  return (
    <Card label="Final invoice" head={<SectionHead label="Final invoice from a signed contract" />}>
      {opts.map((o, i) => (
        <div key={o.documentId} className="wp-rowwrap">
          {i > 0 && <Divider />}
          <ListRow lead={{ icon: "invoice" }} title={`${o.label} · ${o.title}`}
            meta={`${money(o.totalCents)} total, less the ${money(o.depositCents)} deposit · balance ${money(o.balanceCents)}`}
            action={o.invoiceId
              ? <ButtonLink size="sm" variant="ghost" to={`/payments/invoices/${o.invoiceId}`}>Open final invoice</ButtonLink>
              : <Button size="sm" loading={busy === o.documentId} disabled={!!busy} onClick={() => go(o.documentId)}>Draft final invoice</Button>} />
        </div>
      ))}
      {toast}
    </Card>
  );
}
