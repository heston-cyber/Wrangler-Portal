// Phase 3c step 4 (part 2) · the vendor side's Invoices (S5 · Phase 3c 734:3958, Send an invoice 734:3527), Settings
// (734:4386: their details, the W-9 for this business D100, how they're paid D101) and Review for booked editors
// (734:4809, D93, D103). Approving and marking invoices paid is the owner's (step 5, convex/vendorPayments.ts); an
// invoice the owner declines comes back here to fix and send again.
import { SignInRows } from "../security/Security";
import { useContext, useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { TopBar, Sep } from "../../shell/Shell";
import { Button, ButtonLink, Card, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, Segmented, SkeletonRows, StatusChip, type Tone } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { useConfirm, useToast } from "../../ui/kit";
import { linkProps, navigate } from "../../lib/router";
import { errText, uploadToStorage } from "../docs/pages/common";
import { MoneyInput, dateShort, money } from "../payments/common";
import { PAY_METHODS, dateRange, shortRange } from "../../../convex/lib/bookings";
import { Ctx } from "./ctx";
import { NotificationList } from "../settings/Notifications";

const Loading = () => <div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div>;
const dollars = (c: number) => (c % 100 === 0 ? `$${(c / 100).toLocaleString("en-US")}` : money(c));
const when = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? "today" : dateShort(t));
const CHIP: Record<string, [Tone, string]> = { draft: ["neutral", "Draft"], sent: ["neutral", "Sent"], approved: ["danger", "Approved"], paid: ["success", "Paid"], declined: ["warning", "Declined"] };
const dayShort = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
export const InvoiceChip = ({ status }: { status: string }) => <StatusChip tone={CHIP[status]?.[0] ?? "neutral"}>{CHIP[status]?.[1] ?? status}</StatusChip>;
type Row = { _id: Id<"vendorInvoices">; number: string; status: string; projectName: string; role: string; amount: string; totalCents: number; sentAt: number | null; approvedAt: number | null; paidAt: number | null; paidOn: string | null; paidMethod: string | null; declinedAt: number | null; updatedAt: number };
const meta = (x: Row) => [x.projectName, x.role, x.amount, x.status === "paid" && x.paidOn ? `paid ${dayShort(x.paidOn)}${x.paidMethod ? ` · ${x.paidMethod}` : ""}` : x.status === "approved" && x.approvedAt ? `approved ${when(x.approvedAt)}`
  : x.status === "declined" && x.declinedAt ? `declined ${when(x.declinedAt)}` : x.status === "draft" ? "draft" : x.sentAt ? `sent ${when(x.sentAt)}` : "draft"].filter(Boolean).join(" · ");
const rowOf = (x: Row, i: number) => <div key={x._id} className="wp-rowwrap">{i > 0 && <Divider />}
  <ListRow className="ilead" lead={{ icon: "invoice" }} to={`/vendor/invoices/${x._id}`} title={x.number} meta={meta(x)} trailing={money(x.totalCents)} chip={<InvoiceChip status={x.status} />} chevron /></div>;

// ---------- Home's Invoices card ----------

export function HomeInvoices() {
  const { biz } = useContext(Ctx);
  const r = useQuery(api.vendorPortal.invoices, biz ? { businessId: biz } : "skip");
  const rows = (r?.rows ?? []) as Row[];
  return (
    <Card label="Invoices" head={<SectionHead label="Invoices" count={rows.length} action={rows.length ? <ButtonLink size="sm" variant="ghost" to="/vendor/invoices">All invoices</ButtonLink> : undefined} />}>
      {r === undefined ? <SkeletonRows n={2} /> : rows.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "invoice" }} title="No invoices yet." meta="Send one for a booking once the work's done." />
        : rows.slice(0, 4).map(rowOf)}
    </Card>
  );
}

// ---------- Invoices (734:3958) ----------

type Pill = "all" | "draft" | "declined" | "sent" | "approved" | "paid";
export function VendorInvoices() {
  const { biz } = useContext(Ctx);
  const r = useQuery(api.vendorPortal.invoices, biz ? { businessId: biz } : "skip");
  const owner = useQuery(api.vendorPortal.home, biz ? { businessId: biz } : "skip");
  const [pill, setPill] = useState<Pill>("all");
  if (!r) return <Loading />;
  const rows = r.rows as Row[];
  const count = (p: Pill) => rows.filter((x) => p === "all" || x.status === p).length;
  const shown = rows.filter((x) => pill === "all" || x.status === pill);
  const ownerFirst = (owner?.owner ?? "The business").split(" ")[0];
  return (
    <>
      <TopBar><span className="here">Invoices</span></TopBar>
      <div className="wp-page">
        <PageHeader help="/vendor/help/sending-an-invoice" eyebrow={owner?.business} title="Invoices." sub={`${ownerFirst} marks each one paid when it's paid.`} actions={<ButtonLink variant="primary" to="/vendor/invoices/new">Send an invoice</ButtonLink>} />
        {rows.length === 0 ? <EmptyState icon="invoice" title="No invoices yet." body="Send an invoice for a booking you've accepted: hours at the agreed rate, or line items." actions={<ButtonLink variant="primary" to="/vendor/invoices/new">Send an invoice</ButtonLink>} /> : <>
          <PillTabs label="Show" value={pill} onChange={setPill} items={[{ key: "all", label: "All", count: count("all") }, ...(count("draft") ? [{ key: "draft" as Pill, label: "Draft", count: count("draft") }] : []), ...(count("declined") ? [{ key: "declined" as Pill, label: "Declined", count: count("declined") }] : []), { key: "sent", label: "Sent", count: count("sent") }, { key: "approved", label: "Approved", count: count("approved") }, { key: "paid", label: "Paid", count: count("paid") }]} />
          <Card label="Invoices">{shown.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "invoice" }} title="None here." /> : shown.map(rowOf)}</Card>
        </>}
      </div>
    </>
  );
}

// ---------- Send an invoice (734:3527); a draft opens here too ----------

type H = { label: string; qty: string };
type L = { description: string; cents: number };
export function InvoiceEditor({ bookingId, invoiceId, onCancel }: { bookingId?: string | null; invoiceId?: string; onCancel?: () => void }) {
  const { biz, setBiz } = useContext(Ctx);
  const f = useQuery(api.vendorPortal.invoiceForm, invoiceId ? { invoiceId } : biz ? { businessId: biz } : "skip");
  const save = useMutation(api.vendorPortal.saveInvoice);
  const del = useMutation(api.vendorPortal.deleteInvoice);
  const [confirm, confirmNode] = useConfirm();
  const [toast, show] = useToast();
  const [bid, setBid] = useState<string>(bookingId ?? "");
  const [mode, setMode] = useState<"hours" | "lines">("hours");
  const [hours, setHours] = useState<H[]>([{ label: "", qty: "" }]);
  const [lines, setLines] = useState<L[]>([{ description: "", cents: 0 }]);
  const [number, setNumber] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<null | "draft" | "send">(null), [err, setErr] = useState<string | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (!f || loaded.current) return;
    loaded.current = true;
    if (f.businessId !== biz) setBiz(f.businessId);
    const inv = f.invoice;
    if (inv) {
      setBid(inv.bookingId); setMode(inv.mode); setNumber(inv.number); setNote(inv.note ?? "");
      if (inv.hours.length) setHours(inv.hours.map((h) => ({ label: h.label, qty: String(h.qty) })));
      if (inv.lines.length) setLines(inv.lines);
    } else if (!bid && f.bookings.length === 1) setBid(f.bookings[0]._id);
  }, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  if (f === undefined) return <Loading />;
  if (f === null) return <div className="wp-page"><EmptyState icon="invoice" title="This invoice isn't here." actions={<ButtonLink to="/vendor/invoices">Your invoices</ButtonLink>} /></div>;
  const k = f.bookings.find((b) => b._id === bid) ?? null;
  const unit = k?.rate.unit ?? "hour";
  const qty = hours.reduce((t, h) => t + (Number(h.qty) || 0), 0);
  const total = mode === "hours" ? Math.round(qty * (k?.rate.cents ?? 0)) : lines.reduce((t, l) => t + l.cents, 0);
  const ownerFirst = f.owner.split(" ")[0];
  const fixing = f.invoice?.status === "declined"; // step 5: declined by the owner; fixed here and sent again
  const go = async (send: boolean) => {
    if (!k) return;
    setBusy(send ? "send" : "draft"); setErr(null);
    try {
      const id = await save({ ...(f.invoice ? { invoiceId: f.invoice._id } : {}), bookingId: k._id, mode, send, ...(number.trim() ? { number } : {}), ...(note.trim() ? { note } : {}),
        hours: mode === "hours" ? hours.filter((h) => h.label.trim() || h.qty.trim()).map((h) => ({ label: h.label, qty: Number(h.qty) || 0 })) : [],
        lines: mode === "lines" ? lines.filter((l) => l.description.trim() || l.cents) : [] });
      if (send) { navigate(`/vendor/invoices/${id}`); onCancel?.(); } else { show("Saved as a draft."); if (!f.invoice) navigate(`/vendor/invoices/${id}`); else onCancel?.(); }
    } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  return (
    <>
      <TopBar><a {...linkProps("/vendor/invoices")}>Invoices</a><Sep /><span className="here">{f.invoice ? f.invoice.number : "New invoice"}</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow={f.business} title={fixing ? "Fix and send again." : "Send an invoice."} sub={fixing ? `${ownerFirst} declined it: ${f.invoice!.declineReason ?? "no reason given"}` : `It goes to ${f.owner} for approval. You'll see Sent · Approved · Paid here.`}
          actions={<>{fixing && onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}{f.invoice && !fixing && <Button variant="ghost" onClick={async () => { if (!(await confirm({ title: "Delete this draft?", body: "It hasn't been sent.", yes: "Delete" }))) return; await del({ invoiceId: f.invoice!._id }); navigate("/vendor/invoices"); }}>Delete draft</Button>}
            <Button loading={busy === "draft"} disabled={!k} onClick={() => void go(false)}>Save draft</Button>
            <Button variant="primary" loading={busy === "send"} disabled={!k || total <= 0} onClick={() => void go(true)}>{fixing ? "Send again" : "Send invoice"}</Button></>} />
        {f.bookings.length === 0 ? <EmptyState icon="calendar" title="Nothing to invoice yet." body={`Invoices are for bookings you've accepted with ${f.business}.`} actions={<ButtonLink to="/vendor/bookings">Your bookings</ButtonLink>} /> : (
          <div className="wp-homecols">
            <div className="col">
              <Card label="What it's for" head={<SectionHead label="What it's for" />}>
                <div className="vd-pad vi-for">
                  <label className="wp-field"><span className="wp-field-label">Booking</span>
                    <select className="input" value={bid} onChange={(e) => setBid(e.target.value)}>
                      {!k && <option value="" disabled>Pick a booking</option>}
                      {f.bookings.map((b) => <option key={b._id} value={b._id}>{b.label} · {shortRange(b.start, b.end)}</option>)}
                    </select></label>
                  <Segmented label="How" value={mode} onChange={setMode} items={[{ key: "hours", label: unit === "day" ? "Days × rate" : "Hours × rate" }, { key: "lines", label: "Line items" }]} />
                </div>
              </Card>
              {mode === "hours" ? (
                <Card label={unit === "day" ? "Days" : "Hours"} head={<SectionHead label={unit === "day" ? "Days" : "Hours"} count={hours.filter((h) => Number(h.qty)).length} />}>
                  <div className="vd-pad vi-rows">
                    {hours.map((h, i) => (
                      <div key={i} className="vi-row">
                        <input className="input" aria-label="What it was" placeholder={k ? `${shortRange(k.start, k.start)} · what you did` : "What you did"} value={h.label} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                        <span className="vi-qty"><input className="input" inputMode="decimal" aria-label={unit === "day" ? "Days" : "Hours"} value={h.qty} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /><span>{unit === "day" ? "d" : "h"}</span></span>
                        {hours.length > 1 && <button type="button" className="linkbtn" aria-label="Remove" onClick={() => setHours(hours.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>}
                      </div>
                    ))}
                    <button type="button" className="linkbtn vi-add" onClick={() => setHours([...hours, { label: "", qty: "" }])}><Icon name="plus" size={14} /> Add a day</button>
                  </div>
                </Card>
              ) : (
                <Card label="Line items" head={<SectionHead label="Line items" count={lines.filter((l) => l.cents).length} />}>
                  <div className="vd-pad vi-rows">
                    {lines.map((l, i) => (
                      <div key={i} className="vi-row">
                        <input className="input" aria-label="What it's for" placeholder="What it's for" value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                        <MoneyInput label="Amount" value={l.cents} onChange={(c) => setLines(lines.map((x, j) => (j === i ? { ...x, cents: c } : x)))} />
                        {lines.length > 1 && <button type="button" className="linkbtn" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>}
                      </div>
                    ))}
                    <button type="button" className="linkbtn vi-add" onClick={() => setLines([...lines, { description: "", cents: 0 }])}><Icon name="plus" size={14} /> Add a line</button>
                  </div>
                </Card>
              )}
            </div>
            <div className="col right">
              <Card label="Total" head={<SectionHead label="Total" />}>
                <div className="vd-pad">
                  {mode === "hours" && <><div className="vd-row"><span className="secondary">{unit === "day" ? "Days" : "Hours"}</span><span>{Math.round(qty * 100) / 100} {unit === "day" ? "d" : "h"}</span></div>
                    <div className="vd-row"><span className="secondary">Agreed rate</span><span>{k ? `${dollars(k.rate.cents)} / ${k.rate.unit}` : "—"}</span></div></>}
                  <div className="vd-row vi-total"><b>Total</b><b>{money(total)}</b></div>
                  {k && mode === "hours" && total > 0 && total !== k.expectedCents && <p className="wp-small secondary">The booking expected {money(k.expectedCents)}. {ownerFirst} sees the difference.</p>}
                  <label className="wp-field"><span className="wp-field-label">Your invoice number (optional)</span><input className="input" value={number} placeholder={f.invoice?.number ?? f.nextNumber} onChange={(e) => setNumber(e.target.value)} /></label>
                  <label className="wp-field"><span className="wp-field-label">Note (optional)</span><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                </div>
              </Card>
              {err && <p className="error" role="alert">{err}</p>}
            </div>
          </div>
        )}
      </div>
      {confirmNode}{toast}
    </>
  );
}

/** One invoice: a draft opens in the editor; a sent one shows where it stands. */
export function VendorInvoice({ invoiceId }: { invoiceId: string }) {
  const { biz, setBiz } = useContext(Ctx);
  const x = useQuery(api.vendorPortal.invoice, { invoiceId });
  const [fix, setFix] = useState(false);
  useEffect(() => { if (x && x.businessId !== biz) setBiz(x.businessId); }, [x?.businessId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (x === undefined) return <Loading />;
  if (x === null) return <div className="wp-page"><EmptyState icon="invoice" title="This invoice isn't here." body="It may be for another login, or the business took you off its list." actions={<ButtonLink to="/vendor/invoices">Your invoices</ButtonLink>} /></div>;
  if (x.status === "draft") return <InvoiceEditor invoiceId={x._id} />;
  if (x.status === "declined" && fix) return <InvoiceEditor invoiceId={x._id} onCancel={() => setFix(false)} />;
  const ownerFirst = x.owner.split(" ")[0];
  const where = x.status === "paid" ? `${ownerFirst} marked it paid${x.paidOn ? ` on ${dayShort(x.paidOn)}` : ""}${x.paidMethod ? ` (${x.paidMethod})` : ""}${x.paidCents !== null && x.paidCents !== x.totalCents ? `: ${money(x.paidCents)}` : ""}. It counts toward your ${(x.paidOn ?? "").slice(0, 4)} total with ${x.business}.`
    : x.status === "declined" ? `${ownerFirst} declined it ${x.declinedAt ? dateShort(x.declinedAt) : ""}: ${x.declineReason ?? "no reason given"}. Fix it and send it again.` : x.status === "approved" && x.onTheWay ? `${ownerFirst} is paying it by direct deposit${x.onTheWay.expectedArrival ? `. Expected in your bank ${dayShort(x.onTheWay.expectedArrival)}` : ""}. You'll get an email when it's sent.`
    : x.status === "approved" ? `${ownerFirst} approved it ${x.approvedAt ? dateShort(x.approvedAt) : ""}. You'll get an email when it's paid.` : `Sent ${x.sentAt ? dateShort(x.sentAt) : ""}. Waiting for ${ownerFirst} to approve it.`;
  return (
    <>
      <TopBar><a {...linkProps("/vendor/invoices")}>Invoices</a><Sep /><span className="here">{x.number}</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow={`Invoice · ${x.business}`} title={`${x.number}.`} sub={`${x.project} · ${x.role}`} actions={<InvoiceChip status={x.status} />} />
        <div className="wp-homecols">
          <div className="col">
            <Card label="Invoice" head={<SectionHead label={x.mode === "hours" ? (x.rate.unit === "day" ? "Days" : "Hours") : "Line items"} />}>
              <div className="vd-pad">
                {x.mode === "hours" ? x.hours.map((h, i) => <div key={i} className="vd-row"><span>{h.label || "—"}</span><span>{h.qty} {x.rate.unit === "day" ? "d" : "h"}</span></div>)
                  : x.lines.map((l, i) => <div key={i} className="vd-row"><span>{l.description}</span><span>{money(l.cents)}</span></div>)}
                {x.mode === "hours" && <div className="vd-row secondary"><span>at {dollars(x.rate.cents)} / {x.rate.unit}</span><span /></div>}
                <div className="vd-row vi-total"><b>Total</b><b>{money(x.totalCents)}</b></div>
                {x.note && <p className="wp-small secondary">{x.note}</p>}
              </div>
            </Card>
          </div>
          <div className="col right">
            <Card label="Where it stands" head={<SectionHead label="Where it stands" />}><div className="vd-pad"><p className="wp-body">{where}</p>
              {x.status === "declined" && <Button variant="primary" onClick={() => setFix(true)}>Fix and send again</Button>}</div></Card>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------- Settings (734:4386) ----------

export function VendorSettings() {
  const { biz } = useContext(Ctx);
  const s = useQuery(api.vendorPortal.settings, biz ? { businessId: biz } : "skip");
  const saveDetails = useMutation(api.vendorPortal.saveDetails);
  const uploadUrl = useMutation(api.vendorPortal.w9UploadUrl);
  const setW9 = useMutation(api.vendorPortal.setW9);
  const ntf = useQuery(api.vendorPortal.notifications, biz ? { businessId: biz } : "skip");
  const setNtf = useMutation(api.vendorPortal.setNotification);
  const [toast, show] = useToast();
  const [d, setD] = useState<null | { name: string; businessName: string; phone: string; address: string; portfolio: string; payMethod: string; payNote: string }>(null);
  const [busy, setBusy] = useState(false), [up, setUp] = useState(false), [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (s) setD({ name: s.name, businessName: s.businessName, phone: s.phone, address: s.address, portfolio: s.portfolio, payMethod: s.payMethod?.method ?? "", payNote: s.payMethod?.note ?? "" }); }, [s?.businessId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s || !d) return <Loading />;
  const set = (p: Partial<typeof d>) => setD({ ...d, ...p });
  const input = (label: string, k: keyof typeof d, type = "text", ph = "") => <label className="wp-field"><span className="wp-field-label">{label}</span><input className="input" type={type} value={d[k]} placeholder={ph} onChange={(e) => set({ [k]: e.target.value })} /></label>;
  const onSave = async () => {
    setBusy(true); setErr(null);
    try { await saveDetails({ businessId: s.businessId, name: d.name, businessName: d.businessName, phone: d.phone, address: d.address, portfolio: d.portfolio, ...(d.payMethod ? { payMethod: d.payMethod, payNote: d.payNote } : {}) }); show("Saved."); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setUp(true);
    try { const id = await uploadToStorage(await uploadUrl({ businessId: s.businessId }), f); await setW9({ businessId: s.businessId, storageId: id as Id<"_storage">, name: f.name }); show("W-9 uploaded."); }
    catch (e) { show(errText(e)); } finally { setUp(false); if (file.current) file.current.value = ""; }
  };
  return (
    <>
      <TopBar><span className="here">Settings</span></TopBar>
      <div className="wp-page">
        <PageHeader help="/vendor/help/adding-a-w9" eyebrow="Your account" title="Your details." sub={`What ${s.business} has for you. Your login (${s.email}) works for every business you work for.`} actions={<Button variant="primary" loading={busy} onClick={() => void onSave()}>Save</Button>} />
        {err && <p className="error" role="alert">{err}</p>}
        <div className="wp-homecols">
          <div className="col">
            <Card label="Details" head={<SectionHead label="Details" />}>
              <div className="vd-pad qz-grid">
                {input("Name", "name")}{input("Business name (optional)", "businessName")}
                <label className="wp-field"><span className="wp-field-label">Email</span><input className="input" value={s.email} disabled /></label>
                {input("Phone", "phone", "tel")}
                <div className="wide">{input("Mailing address (for 1099s)", "address", "text", "Street, city, state ZIP")}</div>
                <div className="wide">{input("Portfolio", "portfolio", "text", "yoursite.com")}</div>
              </div>
            </Card>
            <DirectDeposit businessId={s.businessId} business={s.business} hasBusiness={!!s.businessName} show={show} />
            <Card label="How you get paid" head={<SectionHead label="How you get paid" />}>
              <div className="vd-pad vi-for">
                <div className="wp-field"><span className="wp-field-label">Method</span>
                  <div className="qz-chips">{PAY_METHODS.map((m) => <button key={m} type="button" className={`qz-chip${d.payMethod === m ? " on" : ""}`} aria-pressed={d.payMethod === m} onClick={() => set({ payMethod: m })}>{m}</button>)}</div></div>
                <label className="wp-field"><span className="wp-field-label">Note (optional)</span><input className="input" value={d.payNote} placeholder="e.g. Zelle to my phone number, or who checks are made out to" onChange={(e) => set({ payNote: e.target.value })} /></label>
                <p className="wp-small secondary">Leave bank account and routing numbers out of this note. For direct deposit, use the Direct deposit card, when {s.business} offers it.</p>
              </div>
            </Card>
          </div>
          <div className="col right">
            {/* Phase 5e step 2: the same Password and Email rows as everyone's (842:11010, vendors assumed the same) */}
            <Card label="Sign-in" head={<SectionHead label="Sign-in" />}><SignInRows show={show} /></Card>
            <Card label="Help" head={<SectionHead label="Help" />}>
              <ListRow className="ilead" lead={{ icon: "info" }} to="/vendor/help" chevron title="Help" meta="Short guides: bookings, briefings, invoices and your W-9." />
            </Card>
            <Card label="W-9" head={<SectionHead label="W-9" />}>
              <div className="vd-pad vi-for">
                {s.w9 ? <div className="vd-row"><span>{s.w9.name} · uploaded {dateShort(s.w9.uploadedAt)}</span><StatusChip tone="success">On file</StatusChip></div> : <div className="vd-row"><span>No W-9 yet</span><StatusChip tone="warning">Missing</StatusChip></div>}
                <input ref={file} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
                <Button loading={up} onClick={() => file.current?.click()}>{s.w9 ? "Replace W-9" : "Upload your W-9 (PDF)"}</Button>
                <p className="wp-small secondary">Only {s.business} can download it. Each business you work for keeps its own copy.</p>
              </div>
            </Card>
            <Card label="Rates and roles" head={<SectionHead label="Rates and roles" />}>
              <div className="vd-pad"><div className="vd-gear">{s.roles.map((r) => <span key={r} className="wp-tag">{r}</span>)}</div>
                <p className="wp-small secondary">Each business sets the rate it agrees with you on the booking.</p></div>
            </Card>
          </div>
        </div>
        {/* Nov 2 (Heston): every email this business's portal sends you, each with its own switch */}
        <header className="wp-sethead vp-ntf"><span className="wp-eyebrow">Notifications</span><h2 className="wp-h4">The emails you get from {s.business}.</h2>
          <p className="wp-body">Each one is on until you switch it off. Each business you work for has its own list.</p></header>
        <NotificationList className="wp-card glass" items={ntf?.items} onToggle={async (key, on) => { if (!biz) return; await setNtf({ businessId: biz, key, on }); show(on ? "On." : "Off. You won't get these emails."); }} />
      </div>
      {toast}
    </>
  );
}

// ---------- Direct deposit (Nov 2, Pay in portal; no frame: the W-9 card's pattern) ----------

function DirectDeposit({ businessId, business, hasBusiness, show }: { businessId: Id<"businesses">; business: string; hasBusiness: boolean; show: (t: string) => void }) {
  const m = useQuery(api.vendorPayouts.mine, { businessId });
  const link = useAction(api.vendorPayouts.setupLink);
  const refresh = useAction(api.vendorPayouts.refreshMine);
  const [busy, setBusy] = useState(false);
  const [as, setAs] = useState<"individual" | "company">(hasBusiness ? "company" : "individual");
  const asked = useRef(false);
  // Back from Stripe's form (?payouts=<business>), or set up but not finished: ask Stripe once where it stands.
  useEffect(() => {
    if (!m?.on || asked.current) return;
    const back = new URLSearchParams(location.search).get("payouts");
    if (!back && m.state !== "started") return;
    asked.current = true;
    if (back) history.replaceState(null, "", "/settings");
    void refresh({ businessId }).then((r) => { if (back) show(r.state === "ready" ? "Direct deposit is set up." : r.state === "started" ? "Stripe still needs a few details. Press Finish setting up." : "Stripe didn't answer. Check again in a minute."); }, () => {});
  }, [m?.on, m?.state, businessId, refresh, show]);
  if (!m?.on) return null;
  const open = async () => {
    setBusy(true);
    try { const r = await link({ businessId, ...(m.state === "none" ? { as } : {}) }); window.location.assign(r.url); } catch (e) { show(errText(e)); setBusy(false); }
  };
  return (
    <Card label="Direct deposit" head={<SectionHead label="Direct deposit" />}>
      <div className="vd-pad vi-for">
        {m.state === "ready" && <div className="vd-row"><span>{m.bankName ? `${m.bankName} ` : "Bank "}{m.last4 ? `••••${m.last4}` : ""}</span><StatusChip tone="success">Ready</StatusChip></div>}
        {m.state === "started" && <div className="vd-row"><span>Started, not finished</span><StatusChip tone="warning">Needs details</StatusChip></div>}
        {m.state === "none" && <div className="vd-row"><span>Not set up</span><StatusChip tone="neutral">Off</StatusChip></div>}
        {m.state === "none" && <div className="wp-field"><span className="wp-field-label">Paid as</span>
          <div className="qz-chips">{([["individual", "Myself"], ["company", "My company (LLC, corp)"]] as const).map(([k, l]) => <button key={k} type="button" className={`qz-chip${as === k ? " on" : ""}`} aria-pressed={as === k} onClick={() => setAs(k)}>{l}</button>)}</div></div>}
        <Button variant={m.state === "ready" ? undefined : "primary"} loading={busy} onClick={() => void open()}>{m.state === "ready" ? "Update bank details" : m.state === "started" ? "Finish setting up" : "Set up direct deposit"}</Button>
        <p className="wp-small secondary">{business} can pay your approved invoices straight to your bank. You enter your bank on Stripe's secure form; the portal and {business} only see its last 4 digits.</p>
      </div>
    </Card>
  );
}

// ---------- Review for booked editors (734:4809, D93, D103) ----------

export function VendorReview() {
  const { biz } = useContext(Ctx);
  const r = useQuery(api.vendorPortal.reviews, biz ? { businessId: biz } : "skip");
  if (!r) return <Loading />;
  return (
    <>
      <TopBar><span className="here">Review</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow="Review" title="Review." sub="The projects you're booked to edit. Watch every cut and leave notes; uploads and sharing stay with the business." />
        {r.rows.length === 0 ? <EmptyState icon="review" title="Nothing to review." body="When you're booked as an editor, the project's cuts show up here." /> : (
          <Card label="Projects">
            {r.rows.map((x, i) => <div key={x.bookingId} className="wp-rowwrap">{i > 0 && <Divider />}
              <ListRow className="ilead" lead={{ icon: "review" }} to={`/s/${x.token}`} title={x.project} meta={[`Booked as ${x.role.toLowerCase()} · ${dateRange(x.start, x.end)}`, x.expiresAt ? `access until ${dateShort(x.expiresAt)}` : null].filter(Boolean).join(" · ")} chevron /></div>)}
          </Card>
        )}
        <div className="wp-notice"><Icon name="lock" size={18} /><span className="txt">Access ends 30 days after the booking's last day. The business can extend it.</span></div>
      </div>
    </>
  );
}
