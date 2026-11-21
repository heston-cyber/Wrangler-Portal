// Phase 2 Part B, step 2: New invoice (frame 226:6016) and editing a draft. Who it's for, line items, discount and
// tax, due date and memo, with a live preview of what the client will see. "Send…" opens the confirm (230:7556);
// nothing reaches Stripe or the client before that confirm (D46).
import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { Button, Card, Segmented, SectionHead, SkeletonRows, TextArea, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { NewClient } from "../review/Projects";
import { InvoicePaper, MoneyInput, dateLong, isoIn, money, newId, totals, type Line } from "./common";

type Kind = "deposit" | "final" | "other";
type Draft = {
  clientId: string; projectId: string; person: string; kind: Kind; title: string;
  billTo: { name: string; email: string; company?: string };
  lines: Line[]; discountCents?: number; taxPercent?: number; dueDate: string; memo: string;
};
const TITLE: Record<Kind, string> = { deposit: "Deposit", final: "Final invoice", other: "" };


export default function InvoiceEditor({ invoiceId, clientId: initClient, projectId: initProject }: { invoiceId?: string; clientId?: string | null; projectId?: string | null }) {
  const opts = useQuery(api.invoices.options, {});
  const existing = useQuery(api.invoices.get, invoiceId ? { invoiceId } : "skip");
  const save = useMutation(api.invoices.saveDraft);
  const remove = useMutation(api.invoices.deleteDraft);
  const send = useAction(api.invoices.send);
  const createQuiet = useAction(api.invoices.create); // Nov 21: Create without emailing
  const finishSend = useAction(api.invoices.finishSend); // Nov 21 (review P-b): a send that stopped partway
  const [toast, show] = useToast();
  const [d, setD] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<null | "save" | "send" | "finish">(null);
  const [asking, setAsking] = useState<false | "send" | "create">(false);

  // Start from the draft being edited, or a fresh one (client and project from the address).
  useEffect(() => {
    if (d || !opts || (invoiceId && existing === undefined)) return;
    if (invoiceId && existing) {
      if (existing.status !== "draft" && existing.status !== "sending") { navigate(`/payments/invoices/${invoiceId}`); return; }
      setD({ clientId: existing.clientId ?? "", projectId: existing.projectId ?? "", person: existing.billTo.email, kind: (existing.kind === "subscription" ? "other" : existing.kind), title: existing.title, billTo: existing.billTo, lines: existing.lines, discountCents: existing.discountCents || undefined, taxPercent: existing.taxPercent || undefined, dueDate: existing.dueDate, memo: existing.memo });
      return;
    }
    const client = opts.clients.find((c) => c._id === initClient) ?? opts.clients.find((c) => c.projects.some((p) => p._id === initProject)) ?? null;
    const person = client?.people.find((p) => p.role === "signer") ?? client?.people[0];
    const project = client?.projects.find((p) => p._id === initProject) ?? client?.projects[0];
    setD({
      clientId: client?._id ?? "", projectId: project?._id ?? "", person: person?.email ?? "", kind: "final", title: TITLE.final,
      billTo: { name: person?.name ?? "", email: person?.email ?? "", ...(client ? { company: client.name } : {}) },
      lines: [{ id: newId(), description: project ? `Final payment · ${project.label}` : "", qty: 1, unitCents: 0 }],
      dueDate: isoIn(14), memo: "",
    });
  }, [opts, existing, invoiceId, initClient, initProject, d]);

  const client = useMemo(() => opts?.clients.find((c) => c._id === d?.clientId) ?? null, [opts, d?.clientId]);
  // "New client…" in the picker: make it, then pick it as soon as it shows up in the list
  const [makingClient, setMakingClient] = useState(false);
  const [madeClient, setMadeClient] = useState<string | null>(null);
  useEffect(() => {
    const c = madeClient ? opts?.clients.find((x) => x.name === madeClient) : null;
    if (c && d) { pickClient(c._id); setMadeClient(null); }
  });
  // Review P-b: a send that stopped partway re-checks every 15 seconds whether Finish sending is ready.
  const midSend = existing?.status === "sending";
  const [, tick] = useState(0);
  useEffect(() => { if (!midSend) return; const h = setInterval(() => tick((n) => n + 1), 15_000); return () => clearInterval(h); }, [midSend]);
  if (!opts || !d) return <><TopBar><a {...linkProps("/payments/invoices")}>Invoices</a></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (invoiceId && existing === null) return <><TopBar><a {...linkProps("/payments/invoices")}>Invoices</a></TopBar><div className="wp-page"><p>This invoice isn't here.</p></div></>;

  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const setLine = (id: string, p: Partial<Line>) => set({ lines: d.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) });
  const pickClient = (id: string) => {
    const c = opts.clients.find((x) => x._id === id);
    const person = c?.people.find((p) => p.role === "signer") ?? c?.people[0];
    set({ clientId: id, projectId: c?.projects[0]?._id ?? "", person: person?.email ?? "", billTo: { name: person?.name ?? "", email: person?.email ?? "", ...(c ? { company: c.name } : {}) } });
  };
  const pickPerson = (email: string) => {
    const p = client?.people.find((x) => x.email === email);
    set({ person: email, billTo: { name: p?.name ?? "", email, ...(client ? { company: client.name } : {}) } });
  };
  const project = client?.projects.find((p) => p._id === d.projectId) ?? null;
  const t = totals(d);
  const number = existing?.number ?? opts.nextNumber ?? "—";
  const payload = () => ({
    ...(invoiceId ? { invoiceId } : {}), clientId: d.clientId || undefined, projectId: d.projectId || undefined, kind: d.kind,
    title: d.title.trim() || (d.kind === "other" ? d.lines[0]?.description || "Invoice" : TITLE[d.kind]), billTo: d.billTo,
    lines: d.lines.filter((l) => l.description.trim() || l.unitCents), discountCents: d.discountCents || undefined, taxPercent: d.taxPercent || undefined, dueDate: d.dueDate, memo: d.memo || undefined,
  });
  const doSave = async (quiet = false) => {
    setBusy("save");
    try { const id = await save(payload()); if (!quiet) show("Draft saved."); if (!invoiceId) navigate(`/payments/invoices/${id}`); setBusy(null); return id as string; }
    catch (e) { show(errText(e)); setBusy(null); return null; }
  };
  const doSend = async () => {
    setBusy("send");
    try {
      const id = await save(payload());
      if (asking === "create") {
        const r = await createQuiet({ invoiceId: id as Id<"invoices"> });
        let copied = false;
        try { if (r.link) { await navigator.clipboard.writeText(r.link); copied = true; } } catch { /* it's on the invoice page too */ }
        show(copied ? `${r.number} made. Its pay link is copied; nothing was emailed.` : `${r.number} made. Nothing was emailed; copy its link from the invoice page.`);
      } else {
        const r = await send({ invoiceId: id as Id<"invoices"> });
        show(`${r.number} sent.`);
      }
      navigate(`/payments/invoices/${id}`);
    } catch (e) { show(errText(e)); setBusy(null); setAsking(false); }
  };
  const canSend = opts.stripeReady && d.billTo.email && t.total >= 50;
  // A send that stopped partway: it stays "sending" until Finish sending picks up what Stripe holds (after 15 minutes).
  const canFinish = midSend && Date.now() - (existing?.updatedAt ?? Date.now()) > 15 * 60_000;
  const doFinish = async () => {
    setBusy("finish");
    try {
      const r = await finishSend({ invoiceId: invoiceId as Id<"invoices"> });
      show(r.emailed ? `${r.number} sent.` : `${r.number} made. Nothing was emailed; copy its link from the invoice page.`);
      navigate(`/payments/invoices/${invoiceId}`);
    } catch (e) { show(errText(e)); setBusy(null); }
  };

  return (
    <>
      <TopBar right={midSend ? <Button variant="primary" onClick={() => void doFinish()} loading={busy === "finish"} disabled={!canFinish} title={canFinish ? "Checks Stripe first, then finishes it (no second invoice)" : "Available 15 minutes after the send stopped"}>Finish sending</Button> : <>
        <Button onClick={() => void doSave()} loading={busy === "save"}>Save draft</Button>
        <Button onClick={() => setAsking("create")} disabled={!canSend} title={!opts.stripeReady ? "Connect Stripe first (Settings › Payments)" : t.total < 50 ? "The total must be at least $0.50" : "Make it in Stripe with its pay link, without emailing anyone"}>Create without emailing…</Button>
        <Button variant="primary" onClick={() => setAsking("send")} disabled={!canSend} title={!opts.stripeReady ? "Connect Stripe first (Settings › Payments)" : t.total < 50 ? "The total must be at least $0.50" : undefined}>Send…</Button>
      </>}>
        <span className="secondary">Payments</span><Sep /><a {...linkProps("/payments/invoices")}>Invoices</a><Sep /><span className="here">{invoiceId ? number : "New invoice"}</span>
      </TopBar>
      <div className="wp-page inv-edit">
        <header className="wp-pagehead"><div className="txt"><span className="wp-eyebrow">{invoiceId ? `Draft ${number}` : "New invoice"}</span><h1 className="wp-h2">{invoiceId ? (d.title || "Invoice") : "New invoice."}</h1><p className="wp-body">Nothing sends until you press Send and confirm. Create without emailing makes it payable from a link you copy, without emailing the invoice.</p></div></header>
        {midSend
          ? <div className="wp-notice glass"><Icon name="alert" size={20} /><span className="txt"><b>This invoice is partway through {existing?.pendingMode === "quiet" ? "being made" : "sending"}.</b> {existing?.sendError ?? "It may already be in Stripe."} {canFinish ? "Press Finish sending: the portal checks Stripe first and won't make a second one." : "Finish sending is ready 15 minutes after it stopped."}</span></div>
          : existing?.sendError && <div className="wp-notice glass"><Icon name="alert" size={20} /><span className="txt"><b>The last send didn't go through.</b> {existing.sendError}</span></div>}
        {!opts.stripeReady && <div className="wp-notice glass"><Icon name="info" size={20} /><span className="txt"><b>Stripe isn't connected.</b> You can save drafts; sending needs Stripe.</span></div>}
        <div className="inv-cols">
          <div className="col">
            <Card label="Who it's for" head={<SectionHead label="Who it's for" />}>
              <div className="inv-form">
                <div className="row2">
                  <label className="wp-field"><span className="wp-field-label">Client</span>
                    <select className="input" value={d.clientId} onChange={(e) => e.target.value === "__new" ? setMakingClient(true) : pickClient(e.target.value)}>
                      <option value="">Choose a client…</option>
                      {opts.clients.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                      <option value="__new">+ New client…</option>
                    </select></label>
                  <label className="wp-field"><span className="wp-field-label">Project</span>
                    <select className="input" value={d.projectId} onChange={(e) => set({ projectId: e.target.value })} disabled={!client}>
                      <option value="">No project</option>
                      {client?.projects.map((p) => <option key={p._id} value={p._id}>{p.label}</option>)}
                    </select></label>
                </div>
                <div className="row2">
                  <label className="wp-field"><span className="wp-field-label">Bill to</span>
                    <select className="input" value={client?.people.some((p) => p.email === d.person) ? d.person : "__other"} onChange={(e) => e.target.value === "__other" ? set({ person: "__other" }) : pickPerson(e.target.value)} disabled={!client}>
                      {client?.people.map((p) => <option key={p.email} value={p.email}>{p.name}{p.role === "signer" ? " · signs documents" : ""}</option>)}
                      <option value="__other">Someone else…</option>
                    </select></label>
                  {(!client?.people.some((p) => p.email === d.person)) && <TextField label="Their email" type="email" value={d.billTo.email} onChange={(e) => set({ billTo: { ...d.billTo, email: e.target.value } })} />}
                </div>
                {(!client?.people.some((p) => p.email === d.person)) && <TextField label="Their name" value={d.billTo.name} onChange={(e) => set({ billTo: { ...d.billTo, name: e.target.value } })} />}
                <div className="wp-field"><span className="wp-field-label">Type</span>
                  <Segmented label="Type" value={d.kind} onChange={(k) => set({ kind: k, title: d.title === TITLE[d.kind] || !d.title ? TITLE[k] : d.title })} items={[{ key: "deposit", label: "Deposit" }, { key: "final", label: "Final" }, { key: "other", label: "Other" }]} />
                </div>
                <TextField label="Title" value={d.title} placeholder={d.kind === "other" ? "Extra shoot day" : TITLE[d.kind]} onChange={(e) => set({ title: e.target.value })} hint="Shown on the lists and the client's Payments page." />
              </div>
            </Card>

            <Card label="Line items" head={<SectionHead label="Line items" count={d.lines.length} />}>
              <div className="inv-lines-edit">
                {d.lines.map((l) => (
                  <div key={l.id} className="inv-line">
                    <div className="top">
                      <input className="input" value={l.description} placeholder="Description" aria-label="Description" onChange={(e) => setLine(l.id, { description: e.target.value })} />
                      <button type="button" className="icon-btn bare" aria-label="Remove line" onClick={() => set({ lines: d.lines.filter((x) => x.id !== l.id) })} disabled={d.lines.length === 1}><Icon name="close" size={16} /></button>
                    </div>
                    <div className="nums">
                      <label><span className="label">Qty</span><input className="input" inputMode="decimal" value={String(l.qty)} aria-label="Quantity" onChange={(e) => setLine(l.id, { qty: Math.max(0, Number(e.target.value) || 0) })} /></label>
                      <label><span className="label">Unit price</span><MoneyInput label="Unit price" value={l.unitCents} onChange={(c) => setLine(l.id, { unitCents: c })} /></label>
                      <span className="amt"><span className="label">Amount</span><b>{money(Math.round(l.qty * l.unitCents))}</b></span>
                    </div>
                  </div>
                ))}
                <button type="button" className="linkbtn inv-add" onClick={() => set({ lines: [...d.lines, { id: newId(), description: "", qty: 1, unitCents: 0 }] })}><Icon name="plus" size={14} />Add line item</button>
              </div>
              <dl className="inv-edit-sums">
                <dt>Subtotal</dt><dd>{money(t.subtotal)}</dd>
                <dt>Discount</dt><dd>{d.discountCents !== undefined ? <span className="inline"><MoneyInput label="Discount" value={d.discountCents} onChange={(c) => set({ discountCents: c })} /><button type="button" className="icon-btn bare" aria-label="Remove discount" onClick={() => set({ discountCents: undefined })}><Icon name="close" size={14} /></button></span> : <button type="button" className="linkbtn" onClick={() => set({ discountCents: 0 })}><Icon name="plus" size={14} />Add</button>}</dd>
                <dt>Tax</dt><dd>{d.taxPercent !== undefined ? <span className="inline"><input className="input sm" inputMode="decimal" aria-label="Tax percent" value={d.taxPercent || ""} placeholder="0" onChange={(e) => set({ taxPercent: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 70 }} /><span>%</span><button type="button" className="icon-btn bare" aria-label="Remove tax" onClick={() => set({ taxPercent: undefined })}><Icon name="close" size={14} /></button></span> : <button type="button" className="linkbtn" onClick={() => set({ taxPercent: 0 })}><Icon name="plus" size={14} />Add</button>}</dd>
                <dt className="tot">Total</dt><dd className="tot">{money(t.total)}</dd>
              </dl>
            </Card>

            <Card label="Due date and memo" head={<SectionHead label="Due date and memo" />}>
              <div className="inv-form">
                <TextField label="Due date" type="date" value={d.dueDate} min={isoIn(0)} onChange={(e) => set({ dueDate: e.target.value })} style={{ maxWidth: 260 }} />
                <TextArea label="Memo" value={d.memo} rows={3} maxLength={1000} placeholder={d.billTo.name ? `Thank you, ${d.billTo.name.split(/\s+/)[0]}.` : "Thank you."} onChange={(e) => set({ memo: e.target.value })} hint="Shows on the invoice, the PDF and the email." />
              </div>
            </Card>
            {invoiceId && <Button variant="ghost" className="inv-delete" onClick={async () => { await remove({ invoiceId }); show("Draft deleted."); navigate("/payments/invoices"); }}>Delete draft</Button>}
          </div>
          <div className="col right">
            <span className="wp-eyebrow inv-preview-lbl"><Icon name="eye" size={14} />What {d.billTo.name ? d.billTo.name.split(/\s+/)[0] : "they"} will see</span>
            <InvoicePaper business={opts.business ?? { name: "", legalName: null }} number={number} issued={dateLong(isoIn(0))} due={dateLong(d.dueDate)} billTo={d.billTo} project={project?.label} lines={d.lines} discountCents={d.discountCents} taxPercent={d.taxPercent} memo={d.memo} />
            <p className="secondary inv-note">Updates as you type. It's the same as the invoice page and the PDF.</p>
          </div>
        </div>
      </div>
      {asking && (
        <Modal onClose={() => setAsking(false)} label={asking === "create" ? "Create invoice without emailing" : "Send invoice"} width={600}>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="dhead">
              <div style={{ display: "grid", gap: 6 }}>
                <span className="eyebrow">{d.title || "Invoice"}</span>
                <h2 className="headline">{asking === "create" ? "Create" : "Send"} {d.kind === "final" ? "the final invoice" : d.kind === "deposit" ? "the deposit invoice" : "this invoice"} {asking === "create" ? "for" : "to"} {d.billTo.name || d.billTo.email}{asking === "create" ? " without emailing" : ""}?</h2>
                <p className="secondary" style={{ margin: 0 }}>The portal makes it in your Stripe account as {number} for {money(t.total)}, due {dateLong(d.dueDate)}. Once {asking === "create" ? "made" : "sent"}, it can't be edited, only voided.</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setAsking(false)} aria-label="Close"><Icon name="close" size={18} /></button>
            </div>
            <dl className="pay-rows boxed">
              <dt>Bill to</dt><dd>{d.billTo.email}</dd>
              {t.discount > 0 && <><dt>Discount</dt><dd>−{money(t.discount)}</dd></>}
              {t.tax > 0 && <><dt>Tax ({d.taxPercent}%)</dt><dd>{money(t.tax)}</dd></>}
              <dt><b>Due now</b></dt><dd><b>{money(t.total)}</b></dd>
              <dt>Due date</dt><dd>{dateLong(d.dueDate)}</dd>
            </dl>
            <p className="secondary" style={{ margin: 0, fontSize: "var(--fs-text-small)" }}>{asking === "create"
              ? <>Nothing is sent now: no invoice email, not on their portal, no reminders. Its pay link is copied for you to send however you like, and Email it on the invoice page sends it later. If someone pays from the link, or a payment fails, the receipt or failed-payment email goes to {d.billTo.email}.{d.kind === "final" ? " If it's paid on the spot (a credit balance in Stripe), it counts as paid, so their final files open." : ""}</>
              : <>The portal emails it to {d.billTo.email} from {opts.business?.name ?? "your business"}, with a “View and pay” button.</>}</p>
            <div className="dfoot">
              <Button variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => void doSend()} loading={busy === "send"}>{asking === "create" ? "Create invoice" : "Send invoice"}</Button>
            </div>
          </div>
        </Modal>
      )}
      {toast}
      {makingClient && <NewClient onClose={() => setMakingClient(false)} onDone={(name) => { setMakingClient(false); setMadeClient(name); }} />}
    </>
  );
}
