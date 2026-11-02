// Phase 3c step 5 · vendor payments, the owner's side: Vendors › Payments (S5 · Phase 3c 730:5246) with To approve ·
// Approved · Paid · 1099 (730:5780, Export CSV), a vendor invoice (731:2198 To approve, 731:2769 Approved, 731:3341
// Paid) and Mark paid (732:3190). Nothing here moves money (D92): the owner pays outside the portal and records it.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, Button, ButtonLink, Card, DialogHeader, Divider, EmptyState, ListRow, PageHeader, SectionHead, SkeletonRows, StatusChip, Tabs, type Tone } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate, useLocation } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { MoneyInput, dateShort, money } from "../payments/common";
import { PAY_METHODS, dateRange, shortRange, todayCentral } from "../../../convex/lib/bookings";
import { rateText } from "./Bookings";

type Tab = "approve" | "approved" | "paid" | "1099";
const TABS: Tab[] = ["approve", "approved", "paid", "1099"];
const dayShort = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const when = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? "today" : dateShort(t));
const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;
const CHIP: Record<string, [Tone, string]> = { sent: ["warning", "To approve"], approved: ["danger", "Approved"], paid: ["success", "Paid"], declined: ["neutral", "Declined"] };
export const VendorInvoiceChip = ({ status }: { status: string }) => <StatusChip tone={CHIP[status]?.[0] ?? "neutral"}>{CHIP[status]?.[1] ?? status}</StatusChip>;
const D92 = "For now, pay them your usual way (ACH, Zelle, check) and press Mark paid. A Stripe test decides whether paying in the portal comes later.";

export default function PaymentsPage() {
  const { search } = useLocation();
  const t = new URLSearchParams(search).get("tab");
  const tab: Tab = TABS.includes(t as Tab) ? (t as Tab) : "approve";
  const r = useQuery(api.vendorPayments.list, {});
  const setTab = (k: Tab) => navigate(k === "approve" ? "/vendors/payments" : `/vendors/payments?tab=${k}`);
  return (
    <>
      <TopBar><a {...linkProps("/vendors")}>Vendors</a><Sep /><span className="here">Payments</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow="Vendors" title="Vendor payments." sub="Invoices and hours your vendors send. Approve them into the Ledger, then mark them paid. You pay outside the portal for now." />
        <Tabs label="Payments" value={tab} onChange={setTab} items={[
          { key: "approve", label: "To approve", count: r?.toApprove.length ?? "" }, { key: "approved", label: "Approved", count: r?.approved.length ?? "" },
          { key: "paid", label: "Paid", count: r?.paid.length ?? "" }, { key: "1099", label: "1099" },
        ]} />
        {tab === "1099" ? <Totals1099 /> : r === undefined ? <Card label="Loading"><SkeletonRows n={3} /></Card> : (() => {
          const rows = tab === "approve" ? r.toApprove : tab === "approved" ? r.approved : r.paid;
          const empty = tab === "approve" ? ["Nothing to approve.", "When a vendor sends an invoice from their portal, it waits here."] : tab === "approved" ? ["Nothing waiting to be paid.", "Approved invoices wait here until you mark them paid."] : ["Nothing paid yet.", "Invoices you mark paid land here, and count toward each vendor's 1099 total."];
          return rows.length === 0 ? <EmptyState icon="invoice" title={empty[0]} body={empty[1]} /> : (
            <Card label={tab === "approve" ? "To approve" : tab === "approved" ? "Approved" : "Paid"}>
              {rows.map((x, i) => <div key={x._id} className="wp-rowwrap">{i > 0 && <Divider />}
                <ListRow lead={{ avatar: x.vendor, two: true }} to={`/vendors/payments/${x._id}`} title={`${x.number} · ${x.vendor}`}
                  meta={[x.project, x.what, x.status === "paid" && x.paidOn ? `paid ${dayShort(x.paidOn)}${x.paidMethod ? ` · ${x.paidMethod}` : ""}` : x.status === "approved" && x.approvedAt ? `approved ${when(x.approvedAt)}` : x.sentAt ? `sent ${when(x.sentAt)}` : null].filter(Boolean).join(" · ")}
                  trailing={money(x.paidCents ?? x.totalCents)} action={<span className="btn sm vp-review">{x.status === "sent" ? "Review" : x.status === "approved" ? "Mark paid" : "Open"}</span>} /></div>)}
            </Card>
          );
        })()}
        {tab !== "1099" && <div className="wp-notice vpay-note"><Icon name="info" size={20} /><span className="txt"><b>Paying vendors in the portal comes later</b><br />{D92}</span></div>}
      </div>
    </>
  );
}

// ---------- the 1099 tab (730:5780) ----------

function csvCell(s: string | number) {
  const t = String(s);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function Totals1099() {
  const [year, setYear] = useState<number | undefined>(undefined);
  const r = useQuery(api.vendorPayments.totals1099, year ? { year } : {});
  if (r === undefined) return <Card label="Loading"><SkeletonRows n={3} /></Card>;
  const exportCsv = () => {
    const head = ["Name", "Business name", "Mailing address", "Email", "TIN status", "Payments", "Last paid", `Total paid ${r.year}`];
    const body = r.rows.map((x) => [x.name, x.businessName ?? "", (x.address ?? "").replace(/\s*\n\s*/g, ", "), x.email ?? "", x.w9 ? "W-9 on file" : "W-9 missing", x.payments, x.last ?? "", (x.totalCents / 100).toFixed(2)]);
    const csv = [head, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `vendor-payments-${r.year}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const missing = r.missing.filter((m) => m.email);
  const remind = missing.length ? `mailto:${missing.length === 1 ? missing[0].email : ""}?${new URLSearchParams({ ...(missing.length > 1 ? { bcc: missing.map((m) => m.email).join(",") } : {}), subject: "Your W-9", body: `Hi${missing.length === 1 ? ` ${firstOf(missing[0].name)}` : ""},\n\nCould you upload your W-9 in your vendor portal (Settings)? I need it for ${r.year}'s 1099s.\n\nThanks!` }).toString().replace(/\+/g, "%20")}` : null;
  return (
    <>
      <div className="vpay-bar">
        <label className="vpay-year"><span className="sr-only">Year</span>
          <select className="input" value={r.year} onChange={(e) => setYear(Number(e.target.value))}>{r.years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
        <p className="wp-small secondary">Totals paid this year, for 1099-NEC forms. Check them with your accountant.</p>
        <Button onClick={exportCsv} disabled={r.rows.length === 0}>Export CSV</Button>
      </div>
      {r.rows.length === 0 ? <EmptyState icon="invoice" title={`Nothing paid in ${r.year}.`} body="Each vendor's total shows here once you mark their invoices paid." /> : (
        <Card label={`Paid in ${r.year}`}>
          {r.rows.map((x, i) => <div key={x.vendorId} className="wp-rowwrap">{i > 0 && <Divider />}
            <ListRow lead={{ avatar: x.name, two: true }} to={`/vendors/${x.vendorId}`} title={x.name} meta={`${x.payments} payment${x.payments === 1 ? "" : "s"}${x.last ? ` · last ${dayShort(x.last)}` : ""}`}
              trailing={money(x.totalCents)} chip={x.w9 ? <StatusChip tone="success">W-9 on file</StatusChip> : <StatusChip tone="warning">W-9 missing</StatusChip>} chevron /></div>)}
        </Card>
      )}
      {r.missing.length > 0 && (
        <div className="wp-notice warn vpay-note"><Icon name="alert" size={20} />
          <span className="txt"><b>{r.missing.length === 1 ? "1 vendor has no W-9" : `${r.missing.length} vendors have no W-9`}</b><br />Ask {r.missing.map((m) => m.name).join(", ")} to upload one in their portal.</span>
          {remind && <a className="btn sm" href={remind}>Send a reminder</a>}
        </div>
      )}
    </>
  );
}

// ---------- a vendor invoice (731:2198 · 731:2769 · 731:3341) ----------

export function VendorInvoicePage({ invoiceId }: { invoiceId: string }) {
  const x = useQuery(api.vendorPayments.get, { invoiceId });
  const approve = useMutation(api.vendorPayments.approve);
  const [toast, show] = useToast();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | "paid" | "decline">(null);
  const top = <TopBar><a {...linkProps("/vendors")}>Vendors</a><Sep /><a {...linkProps("/vendors/payments")}>Payments</a>{x && <><Sep /><span className="here">{x.number}</span></>}</TopBar>;
  if (x === undefined) return <>{top}<div className="wp-page"><Card label="Loading"><SkeletonRows n={5} /></Card></div></>;
  if (x === null) return <>{top}<div className="wp-page"><EmptyState icon="invoice" title="This invoice isn't here." actions={<ButtonLink to="/vendors/payments">Vendor payments</ButtonLink>} /></div></>;
  const first = firstOf(x.vendor.name);
  const k = x.booking;
  const diff = k ? x.totalCents - k.expectedCents : 0;
  const ask = x.vendor.email ? `mailto:${x.vendor.email}?${new URLSearchParams({ subject: `Your invoice ${x.number}` }).toString().replace(/\+/g, "%20")}` : null;
  const onApprove = async () => {
    setBusy(true);
    try { await approve({ invoiceId: x._id }); show(`Approved. It's in the Ledger, and ${first} gets an email.`); } catch (e) { show(errText(e)); } finally { setBusy(false); }
  };
  const pdf = async () => {
    try {
      const { vendorInvoicePdf } = await import("./vendorInvoicePdf");
      const blob = await vendorInvoicePdf({
        number: x.number, status: x.status === "sent" ? "To approve" : x.status, to: x.to, project: x.project.label,
        vendor: { name: x.vendor.name, businessName: x.vendor.businessName, email: x.vendor.email, address: x.vendor.address },
        booking: k ? `${k.role} · ${shortRange(k.start, k.end)} · ${rateText(k.rate)}` : null,
        sent: x.sentAt ? new Date(x.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null,
        approved: x.approvedAt ? new Date(x.approvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null,
        paid: x.paidOn ? `${dateRange(x.paidOn, x.paidOn)}${x.paidMethod ? ` · ${x.paidMethod}` : ""}${x.paidCents !== null && x.paidCents !== x.totalCents ? ` · ${money(x.paidCents)}` : ""}` : null,
        lines: x.lines.map((l) => ({ label: l.label, qty: l.qty !== null && l.rateCents !== null ? `${l.qty} x ${money(l.rateCents)}` : null, cents: l.cents })),
        totalCents: x.totalCents, note: x.note,
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${x.number.replace(/[^\w.-]+/g, "-")}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { show(errText(e)); }
  };
  const fmt = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <>
      {top}
      <div className="wp-page">
        <PageHeader eyebrow={`Vendor invoice · ${x.vendor.name}`} title={`${x.number}.`} sub={`${x.project.label} · ${money(x.totalCents)}`} actions={<VendorInvoiceChip status={x.status} />} />
        {x.status === "approved" && <div className="wp-notice vpay-note"><Icon name="info" size={20} /><span className="txt"><b>Approved and in the Ledger</b><br />Pay {first} your usual way, then press Mark paid.</span></div>}
        {x.status === "declined" && <div className="wp-notice warn vpay-note"><Icon name="alert" size={20} /><span className="txt"><b>You declined it</b><br />“{x.declineReason}” {first} sees this in their portal and can fix it and send it again. The portal doesn’t email {first} about it.</span>{ask && <a className="btn sm" href={ask}>Email {first}</a>}</div>}
        <div className="wp-homecols">
          <div className="col">
            <Card label="Vendor invoice" className="vpay-inv">
              <div className="vpay-head">
                <Avatar name={x.vendor.name} size={36} two />
                <span className="txt"><b>{x.vendor.name}</b>{x.vendor.email && <span className="wp-small secondary">{x.vendor.email}</span>}</span>
                <span className="vpay-num"><span className="wp-eyebrow-sm secondary">Vendor invoice</span><b>{x.number}</b></span>
              </div>
              <Divider />
              <div className="vd-pad">
                <div className="vd-row"><span className="secondary">To</span><span>{x.to}</span></div>
                <div className="vd-row"><span className="secondary">Project</span><a {...linkProps(`/projects/${x.project._id}?tab=ledger`)}>{x.project.label}</a></div>
                {k && <div className="vd-row"><span className="secondary">Booking</span><a {...linkProps(`/vendors/bookings/${k._id}`)}>{k.role} · {shortRange(k.start, k.end)} · {rateText(k.rate)} agreed</a></div>}
                {x.sentAt && <div className="vd-row"><span className="secondary">Sent</span><span>{new Date(x.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></div>}
              </div>
              <Divider />
              {x.lines.map((l, i) => <div key={i}>{i > 0 && <Divider />}<div className="vd-pad vd-row vpay-line"><span>{l.label}</span><span><span className="secondary">{l.qty !== null && l.rateCents !== null ? `${l.qty} × ${money(l.rateCents)}` : ""}</span> <b>{money(l.cents)}</b></span></div></div>)}
              <Divider />
              <div className="vd-pad">
                <div className="vd-row vi-total"><b>Total</b><b className="vpay-total">{money(x.totalCents)}</b></div>
                {k && <div className="vd-row"><span className="secondary">Agreed on the booking</span><span>{money(k.expectedCents)} · {diff === 0 ? "matches" : `${money(Math.abs(diff))} ${diff > 0 ? "more" : "less"}`}</span></div>}
                {x.note && <p className="wp-small secondary">“{x.note}”</p>}
              </div>
            </Card>
          </div>
          <div className="col right">
            <Card label="Actions" head={<SectionHead label="Actions" />}>
              <div className="vd-pad vpay-actions">
                {x.status === "sent" && <>
                  <Button variant="primary" loading={busy} onClick={() => void onApprove()}>Approve</Button>
                  {ask ? <a className="btn" href={ask}>Ask a question</a> : <Button disabled>Ask a question</Button>}
                  <Button variant="ghost" onClick={() => setDialog("decline")}>Decline</Button>
                  <p className="wp-small secondary">Approve adds {money(x.totalCents)} to the project’s Ledger as an actual cost, in place of the booking’s expected cost, and emails {first}.</p>
                </>}
                {x.status === "approved" && <>
                  <Button variant="primary" onClick={() => setDialog("paid")}>Mark paid</Button>
                  <Button disabled>Pay in portal</Button>
                  <p className="wp-small secondary">Later: paying in the portal depends on a Stripe test.</p>
                </>}
                {x.status === "declined" && ask && <a className="btn" href={ask}>Ask a question</a>}
                {x.status !== "declined" && <Button onClick={() => void pdf()}>Download PDF</Button>}
              </div>
            </Card>
            <Card label={`${first}'s payment details`} head={<SectionHead label={`${first}’s payment details`} />}>
              <p className="wp-body vd-pad">{x.vendor.payMethod ? `${x.vendor.payMethod.method}${x.vendor.payMethod.note ? ` · ${x.vendor.payMethod.note}` : ""} (as ${first} typed it)` : `${first} hasn’t said how they’d like to be paid yet. They add it in their portal’s Settings.`}</p>
            </Card>
            <Card label="History" head={<SectionHead label="History" />}>
              <div className="vd-pad">{x.history.map((h, i) => <div key={i} className="vd-row"><span className="secondary">{h.text}</span><span className="vpay-when">{fmt(h.at)}</span></div>)}</div>
            </Card>
          </div>
        </div>
      </div>
      {dialog === "paid" && <MarkPaid invoiceId={x._id} number={x.number} vendor={x.vendor.name} totalCents={x.totalCents} payMethod={x.vendor.payMethod?.method ?? null} onClose={() => setDialog(null)} onDone={() => show(`Marked paid. ${first} gets an email.`)} />}
      {dialog === "decline" && <DeclineInvoice invoiceId={x._id} number={x.number} vendor={x.vendor.name} onClose={() => setDialog(null)} onDone={() => show("Declined.")} />}
      {toast}
    </>
  );
}

// ---------- Mark paid (732:3190) ----------

function MarkPaid({ invoiceId, number, vendor, totalCents, payMethod, onClose, onDone }: { invoiceId: Id<"vendorInvoices">; number: string; vendor: string; totalCents: number; payMethod: string | null; onClose: () => void; onDone: () => void }) {
  const mark = useMutation(api.vendorPayments.markPaid);
  const first = firstOf(vendor);
  const today = todayCentral();
  const [on, setOn] = useState(today);
  const [cents, setCents] = useState(totalCents);
  const [method, setMethod] = useState<string>(payMethod && PAY_METHODS.includes(payMethod) ? payMethod : PAY_METHODS[0]);
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} label="Mark paid" width={520}>
      <div className="crm-dialog">
        <DialogHeader eyebrow={`${number} · ${vendor}`} title="Mark paid." body={`Record how you paid ${first}. This doesn’t move any money.`} onClose={onClose} />
        <div className="vpay-two">
          <label className="wp-field"><span className="wp-field-label">Paid on</span><input className="input" type="date" value={on} max={today} onChange={(e) => setOn(e.target.value)} /></label>
          <div className="wp-field"><span className="wp-field-label">Amount</span><MoneyInput label="Amount" value={cents} onChange={setCents} /></div>
        </div>
        <div className="wp-field"><span className="wp-field-label">How</span>
          <div className="qz-chips">{PAY_METHODS.map((m) => <button key={m} type="button" className={`qz-chip${method === m ? " on" : ""}`} aria-pressed={method === m} onClick={() => setMethod(m)}>{m}</button>)}</div></div>
        <label className="wp-field"><span className="wp-field-label">Reference (optional)</span><input className="input" value={ref} placeholder="Confirmation 000000" onChange={(e) => setRef(e.target.value)} /></label>
        <p className="wp-small secondary">{first} gets an email that it’s paid. It counts toward their 1099 total for {on.slice(0, 4) || today.slice(0, 4)}.{cents !== totalCents && cents > 0 ? ` The invoice was ${money(totalCents)}.` : ""}</p>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); setErr(null); try { await mark({ invoiceId, paidOn: on, cents, method, ...(ref.trim() ? { reference: ref } : {}) }); onClose(); onDone(); } catch (e) { setErr(errText(e)); setBusy(false); } }}>Mark paid</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Decline (with a reason; no frame: the booking Decline dialog's pattern) ----------

function DeclineInvoice({ invoiceId, number, vendor, onClose, onDone }: { invoiceId: Id<"vendorInvoices">; number: string; vendor: string; onClose: () => void; onDone: () => void }) {
  const decline = useMutation(api.vendorPayments.decline);
  const first = firstOf(vendor);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} label="Decline this invoice" width={520}>
      <div className="crm-dialog">
        <DialogHeader eyebrow={`${number} · ${vendor}`} title="Decline this invoice?" body={`${first} sees your reason in their portal and can fix it and send it again. Nothing goes in the Ledger.`} onClose={onClose} />
        <label className="wp-field"><span className="wp-field-label">Reason</span><textarea className="input" rows={3} value={reason} placeholder="The hours don't match the call sheet" onChange={(e) => setReason(e.target.value)} /></label>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy} disabled={!reason.trim()} onClick={async () => { setBusy(true); setErr(null); try { await decline({ invoiceId, reason }); onClose(); onDone(); } catch (e) { setErr(errText(e)); setBusy(false); } }}>Decline invoice</Button>
        </div>
      </div>
    </Modal>
  );
}
