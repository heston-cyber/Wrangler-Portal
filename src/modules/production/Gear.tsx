// Phase 5d step 3 (Nov 4, Q57): Production › Gear. The list with tiles and chips, an item page (Details, Maintenance,
// Booked on shoots, Status), Add gear, Log maintenance and Export for insurer, and the "Gear on this shoot" section of a
// shoot. Owner only. Serials show their last 4; a same-day clash warns and never blocks.
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, Card, DialogHeader, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { clock, shootDay } from "../projects/Shoots";

const KINDS = ["camera", "lens", "audio", "lighting", "grip", "drone", "computer", "other"] as const;
type Kind = (typeof KINDS)[number];
type Status = "in_service" | "in_repair" | "retired";
const KIND_LABEL: Record<Kind, string> = { camera: "Camera", lens: "Lens", audio: "Audio", lighting: "Lighting", grip: "Grip", drone: "Drone", computer: "Computer", other: "Other" };
const STATUS_LABEL: Record<Status, string> = { in_service: "In service", in_repair: "In repair", retired: "Retired" };
const usd = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 ? 2 : 0 }));
const toCents = (s: string) => { const t = s.replace(/[$,\s]/g, ""); if (!t) return undefined; const n = Number(t); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const fromCents = (c: number | null | undefined) => (c === null || c === undefined ? "" : String(c / 100));
const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

type List = NonNullable<ReturnType<typeof useQuery<typeof api.gear.list>>>;
type Item = NonNullable<ReturnType<typeof useQuery<typeof api.gear.get>>>;

function Tile({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return <div className="pov-stat prod-tile"><span className="lbl">{label}</span><b>{value}</b><span className="sub">{sub}</span></div>;
}

function rowChip(i: { status: Status; due: boolean }) {
  if (i.status === "in_repair") return <StatusChip tone="warning">In repair</StatusChip>;
  if (i.status === "retired") return <StatusChip tone="neutral">Retired</StatusChip>;
  if (i.due) return <StatusChip tone="warning">Maintenance due</StatusChip>;
  return undefined;
}

// ---------- the list ----------

export default function GearPage() {
  const d = useQuery(api.gear.list, {});
  const [show, setShow] = useState<Status>("in_service");
  const [adding, setAdding] = useState(false), [exporting, setExporting] = useState(false);
  const [toast, say] = useToast();
  const rows = !d ? [] : d.items.filter((i) => i.status === show);
  return (
    <>
      <TopBar><span className="secondary">Production</span><Sep /><a {...linkProps("/production/prin-pro")}>Prin-pro</a><Sep /><span className="here">Gear</span></TopBar>
      <div className="wp-page prod">
        <PageHeader eyebrow="Production" title="Gear." sub="What you own, what it's insured for, and what's booked on a shoot."
          actions={<><Button onClick={() => setExporting(true)} disabled={!d || d.tiles.items === 0}>Export for insurer</Button><Button variant="primary" onClick={() => setAdding(true)}>Add gear</Button></>} />
        {d === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card> : d === null ? null : <>
          <div className="pov-stats prod-tiles">
            <Tile label="Items" value={d.tiles.items} sub="in service or in repair" />
            <Tile label="Insured value" value={usd(d.tiles.insuredCents)} sub="all items, not retired" />
            <Tile label="In repair" value={d.tiles.inRepair} sub={d.tiles.inRepair ? `${plural(d.tiles.inRepair, "item")} away` : "nothing away"} />
            <Tile label="Maintenance due" value={d.tiles.due} sub={d.tiles.due ? "on or past the date" : "all up to date"} />
          </div>
          <PillTabs label="Which gear" value={show} onChange={setShow} items={[
            { key: "in_service", label: "In service", count: d.counts.in_service }, { key: "in_repair", label: "In repair", count: d.counts.in_repair }, { key: "retired", label: "Retired", count: d.counts.retired },
          ]} />
          {rows.length === 0
            ? <EmptyState icon="video" title={d.items.length === 0 ? "No gear yet." : show === "in_service" ? "Nothing in service." : show === "in_repair" ? "Nothing in repair." : "Nothing retired."}
                body={d.items.length === 0 ? "Add your cameras, lenses and lights. Only a name is needed." : undefined}
                actions={d.items.length === 0 ? <Button variant="primary" onClick={() => setAdding(true)}>Add gear</Button> : undefined} />
            : <Card label="Gear">{rows.map((i, n) => (
                <div key={i._id} className="wp-rowwrap">{n > 0 && <Divider />}
                  <ListRow className="ilead" lead={i.photoUrl ? { thumb: i.photoUrl, size: 56 } : { icon: "video" }} to={`/production/gear/${i._id}`} chevron
                    title={i.name} meta={[KIND_LABEL[i.kind as Kind], i.serialLast4 ? `Serial ending ${i.serialLast4}` : null, i.insuredCents ? `${usd(i.insuredCents)} insured` : null].filter(Boolean).join(" · ")}
                    chip={rowChip(i as { status: Status; due: boolean })} />
                </div>))}</Card>}
        </>}
      </div>
      {adding && <GearDialog onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); say(m); }} />}
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {toast}
    </>
  );
}

// ---------- Add / edit ----------

function GearDialog({ item, onClose, onDone }: { item?: Item; onClose: () => void; onDone: (msg: string) => void }) {
  const add = useMutation(api.gear.add), update = useMutation(api.gear.update);
  const [name, setName] = useState(item?.name ?? "");
  const [kind, setKind] = useState<Kind>((item?.kind as Kind) ?? "camera");
  const [serial, setSerial] = useState("");
  const [bought, setBought] = useState(item?.boughtOn ?? "");
  const [price, setPrice] = useState(fromCents(item?.priceCents));
  const [insured, setInsured] = useState(fromCents(item?.insuredCents));
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const p = toCents(price), ins = toCents(insured);
    if (Number.isNaN(p) || Number.isNaN(ins)) { setErr("Prices are numbers, like 1299 or 1299.50."); return; }
    setBusy(true); setErr(null);
    try {
      const body = { name, kind, ...(serial.trim() ? { serial } : {}), ...(bought ? { boughtOn: bought } : {}), ...(p !== undefined ? { priceCents: p } : {}), ...(ins !== undefined ? { insuredCents: ins } : {}), ...(notes.trim() ? { notes } : {}) };
      if (item) { await update({ gearId: item._id as Id<"gear">, ...body }); onDone("Saved."); } else { await add(body); onDone("Gear added."); }
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label={item ? "Edit gear" : "Add gear"} width={560}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Gear" title={item ? "Edit details." : "Add gear."} body={item ? undefined : "Only a name is needed. Fill in the rest when you have it."} onClose={onClose} />
        <div className="qz-grid sh-grid">
          <label className="wp-field qz-q wide"><span className="wp-field-label">Name</span><input className="input" value={name} maxLength={120} placeholder="Sony FX3" onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Kind</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Serial number (optional)</span>
            <input className="input" value={serial} maxLength={80} autoComplete="off" placeholder={item?.serialLast4 ? `Ends in ${item.serialLast4}. Type a new one to replace it.` : "Optional"} onChange={(e) => setSerial(e.target.value)} /></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Bought (optional)</span><input className="input" type="date" value={bought} onChange={(e) => setBought(e.target.value)} /></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Price paid (optional)</span><input className="input" inputMode="decimal" value={price} placeholder="$0,000.00" onChange={(e) => setPrice(e.target.value)} /></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Insurance value (optional)</span><input className="input" inputMode="decimal" value={insured} placeholder="$0,000.00" onChange={(e) => setInsured(e.target.value)} /></label>
          <label className="wp-field qz-q wide"><span className="wp-field-label">Notes (optional)</span><textarea className="input" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>{item ? "Save" : "Add gear"}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Log maintenance ----------

function MaintenanceDialog({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: (msg: string) => void }) {
  const log = useMutation(api.gear.logMaintenance);
  const [date, setDate] = useState(item.today);
  const [what, setWhat] = useState(""), [cost, setCost] = useState(""), [next, setNext] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const c = toCents(cost);
    if (Number.isNaN(c)) { setErr("The cost is a number, like 85 or 85.50."); return; }
    setBusy(true); setErr(null);
    try { await log({ gearId: item._id as Id<"gear">, date, what, ...(c !== undefined ? { costCents: c } : {}), ...(next ? { nextDue: next } : {}) }); onDone("Maintenance logged."); } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Log maintenance" width={520}>
      <div className="crm-dialog">
        <DialogHeader eyebrow={item.name} title="Log maintenance." body="What was done, and when it's next due." onClose={onClose} />
        <div className="qz-grid sh-grid">
          <label className="wp-field qz-q"><span className="wp-field-label">Done on</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Next due (optional)</span><input className="input" type="date" min={date} value={next} onChange={(e) => setNext(e.target.value)} /></label>
          <label className="wp-field qz-q wide"><span className="wp-field-label">What was done</span><input className="input" maxLength={300} value={what} placeholder="Sensor cleaned" onChange={(e) => setWhat(e.target.value)} autoFocus /></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Cost (optional)</span><input className="input" inputMode="decimal" value={cost} placeholder="$0.00" onChange={(e) => setCost(e.target.value)} /></label>
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy} disabled={!what.trim() || !date} onClick={() => void save()}>Log it</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Export for insurer ----------

function ExportDialog({ onClose }: { onClose: () => void }) {
  const out = useQuery(api.gear.exportCsv, {});
  const download = () => {
    if (!out) return;
    const url = URL.createObjectURL(new Blob([out.csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = out.filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onClose();
  };
  return (
    <Modal onClose={onClose} label="Export for insurer" width={480}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Gear" title="Export for insurer." body="A spreadsheet (CSV) with name, kind, serial number, date bought, price and insurance value, and the total. Retired gear is left out." onClose={onClose} />
        {out === undefined ? <SkeletonRows n={1} /> : <dl className="pov-paid prod-week"><dt>Items</dt><dd>{out.count}</dd><dt>Insured total</dt><dd>{usd(out.totalCents)}</dd><dt>File</dt><dd>{out.filename}</dd></dl>}
        <p className="secondary">The whole serial number is in the file, so share it only with your insurer.</p>
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Close</button>
          <Button variant="primary" icon="download" disabled={!out || out.count === 0} onClick={download}>Download CSV</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- an item ----------

export function GearItem({ gearId }: { gearId: string }) {
  const d = useQuery(api.gear.get, { gearId });
  const setStatus = useMutation(api.gear.setStatus);
  const upUrl = useMutation(api.gear.uploadUrl), setPhoto = useMutation(api.gear.setPhoto), removePhoto = useMutation(api.gear.removePhoto);
  const [open, setOpen] = useState<null | "edit" | "maintenance">(null);
  const [toast, say] = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (f: File) => {
    if (f.size > 10 * 1024 * 1024) { say("That photo is over 10 MB."); return; }
    setBusy(true);
    try {
      const res = await fetch(await upUrl({}), { method: "POST", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
      if (!res.ok) throw new Error("The upload didn't finish. Try again.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const r = await setPhoto({ gearId: gearId as Id<"gear">, storageId });
      say(r ?? "Photo saved.");
    } catch (e) { say(errText(e)); } finally { setBusy(false); }
  };
  const crumbs = <TopBar><a {...linkProps("/production")} className="secondary">Production</a><Sep /><a {...linkProps("/production/prin-pro")}>Prin-pro</a><Sep /><a {...linkProps("/production/gear")} className="secondary">Gear</a><Sep /><span className="here">{d?.name ?? ""}</span></TopBar>;
  if (d === undefined) return <>{crumbs}<div className="wp-page prod"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (d === null) return <>{crumbs}<div className="wp-page prod"><EmptyState icon="video" title="That gear isn't here any more." actions={<a {...linkProps("/production/gear")} className="btn">Back to Gear</a>} /></div></>;
  const pick = async (s: Status) => { try { await setStatus({ gearId: d._id as Id<"gear">, status: s }); say(s === "retired" ? "Retired. It won't show when you book a shoot." : `Marked ${STATUS_LABEL[s].toLowerCase()}.`); } catch (e) { say(errText(e)); } };
  return (
    <>
      {crumbs}
      <div className="wp-page prod">
        <PageHeader eyebrow={`Gear · ${KIND_LABEL[d.kind as Kind]}`} title={d.name} sub={d.status === "in_service" ? (d.due ? "Maintenance is due." : undefined) : STATUS_LABEL[d.status as Status]}
          actions={<><Button onClick={() => setOpen("maintenance")}>Log maintenance</Button><Button variant="primary" onClick={() => setOpen("edit")}>Edit</Button></>} />
        <div className="pov-cols">
          <div className="col">
            <Card label="Details" head={<SectionHead label="Details" />}>
              <div className="gear-photo">
                {d.photoUrl ? <img src={d.photoUrl} alt={d.name} /> : <span className="gear-nophoto" aria-hidden><Icon name="video" size={28} /></span>}
                <span className="gear-photo-actions">
                  <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
                  <Button size="sm" loading={busy} onClick={() => file.current?.click()}>{d.photoUrl ? "Replace photo" : "Add photo"}</Button>
                  {d.photoUrl && <Button size="sm" variant="ghost" onClick={() => void removePhoto({ gearId: d._id as Id<"gear"> })}>Remove</Button>}
                </span>
              </div>
              <dl className="pov-paid prod-week">
                <dt>Serial</dt><dd>{d.serialLast4 ? `Ending ${d.serialLast4}` : "—"}</dd>
                <dt>Bought</dt><dd>{d.boughtOn ? shortDay(d.boughtOn) : "—"}</dd>
                <dt>Price paid</dt><dd>{usd(d.priceCents)}</dd>
                <dt>Insurance value</dt><dd>{usd(d.insuredCents)}</dd>
              </dl>
              {d.notes && <p className="pj-pad gear-notes">{d.notes}</p>}
            </Card>
            <Card label="Status" head={<SectionHead label="Status" />}>
              <div className="pj-pad gear-status">
                <div className="qz-chips">{(["in_service", "in_repair", "retired"] as Status[]).map((s) => <button key={s} type="button" className={`qz-chip${d.status === s ? " on" : ""}`} aria-pressed={d.status === s} onClick={() => void pick(s)}>{STATUS_LABEL[s]}</button>)}</div>
              </div>
            </Card>
          </div>
          <div className="col">
            <Card label="Maintenance" head={<SectionHead label="Maintenance" count={d.maintenance.length || undefined} action={<Button size="sm" variant="ghost" onClick={() => setOpen("maintenance")}>Log maintenance</Button>} />}>
              {d.nextDue && <ListRow className="ilead" lead={{ icon: "clock" }} title={`Next due ${shortDay(d.nextDue)}`} chip={d.due ? <StatusChip tone="warning">Due</StatusChip> : undefined} />}
              {d.maintenance.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "note" }} title="Nothing logged yet." />
                : d.maintenance.map((m) => <div key={m._id} className="wp-rowwrap"><Divider /><ListRow className="ilead" lead={{ icon: "check-circle" }} title={m.what} meta={[shortDay(m.date), m.costCents ? usd(m.costCents) : null].filter(Boolean).join(" · ")} /></div>)}
            </Card>
            <Card label="Booked on shoots" head={<SectionHead label="Booked on shoots" count={d.upcoming.length || undefined} />}>
              {d.upcoming.length === 0 && d.past.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "calendar" }} title="Not on any shoot." meta="Add it from a shoot's Edit window." />
                : [...d.upcoming, ...d.past].map((s, i) => <div key={s.shootId} className="wp-rowwrap">{i > 0 && <Divider />}<ListRow className="ilead" lead={{ icon: "calendar" }} to={`/projects/${s.projectId}`} chevron title={`${s.project} · ${shootDay(s.date)}`} meta={`${clock(s.call)} call · ${s.location}`} chip={s.date < d.today ? <StatusChip tone="neutral">Past</StatusChip> : undefined} /></div>)}
            </Card>
          </div>
        </div>
      </div>
      {open === "edit" && <GearDialog item={d} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); say(m); }} />}
      {open === "maintenance" && <MaintenanceDialog item={d} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); say(m); }} />}
      {toast}
    </>
  );
}

// ---------- on a shoot ----------

/** "Gear on this shoot" inside the owner's Edit-the-shoot window. A clash names the other shoot and never blocks. */
export function GearOnShoot({ shootId }: { shootId: string }) {
  const d = useQuery(api.gear.forShoot, { shootId });
  const addTo = useMutation(api.gear.addToShoot), removeFrom = useMutation(api.gear.removeFromShoot);
  const [pick, setPick] = useState(""), [err, setErr] = useState<string | null>(null);
  if (d === undefined) return <div className="wp-field qz-q wide"><span className="wp-field-label">Gear on this shoot</span><SkeletonRows n={1} /></div>;
  if (d === null) return null;
  const clashes = d.items.filter((i) => i.clash.length > 0 || i.status === "in_repair");
  const run = async (f: () => Promise<unknown>) => { setErr(null); try { await f(); } catch (e) { setErr(errText(e)); } };
  return (
    <div className="wp-field qz-q wide gear-on">
      <span className="wp-field-label">Gear on this shoot</span>
      {clashes.map((i) => (
        <p key={i.bookingId} className="gear-clash" role="status"><Icon name="alert" size={16} />
          {i.clash.length > 0 ? `${i.name} is also on ${i.clash.map((c) => `${c.project} (${clock(c.call)} call)`).join(" and ")} the same day. You can still keep it on both.` : `${i.name} is in repair.`}
        </p>))}
      {d.items.length === 0 ? <span className="wp-field-hint">{d.total === 0 ? "No gear yet. Add some under Production › Gear." : "Nothing booked yet."}</span>
        : <div className="qz-chips">{d.items.map((i) => <button key={i.bookingId} type="button" className="qz-chip on" aria-label={`Take ${i.name} off this shoot`} onClick={() => void run(() => removeFrom({ shootId: shootId as Id<"shoots">, gearId: i.gearId }))}>{i.name}<Icon name="close" size={14} /></button>)}</div>}
      {d.available.length > 0 && (
        <span className="gear-add">
          <select className="input" aria-label="Add gear to this shoot" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Add gear…</option>
            {d.available.map((g) => <option key={g._id} value={g._id}>{g.name} · {KIND_LABEL[g.kind as Kind]}{g.status === "in_repair" ? " (in repair)" : ""}</option>)}
          </select>
          <Button size="sm" disabled={!pick} onClick={() => void run(async () => { await addTo({ shootId: shootId as Id<"shoots">, gearId: pick as Id<"gear"> }); setPick(""); })}>Add</Button>
        </span>)}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}
