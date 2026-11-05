// Phase 3c step 2 · bookings, the owner's side: Book a vendor (S5 · Phase 3c 732:3051), Vendors › Bookings (730:3942),
// the Crew card on a project's Overview (730:2326, D96), the bookings card on a vendor's page, and one booking's page
// (no frame: built from the existing patterns). The vendor accepts or declines in their portal (step 4).
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, DialogHeader, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows, StatusChip, type Tone } from "../../ui/wp";
import { Modal, useConfirm, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { MoneyInput, dateShort, money } from "../payments/common";
import { NewBriefing } from "./NewBriefing";
import { dateRange, daysIn, expectedCents, isDate, shortRange, suggestRate, type BookingState, type Unit } from "../../../convex/lib/bookings";

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.bookings.list>>>[number];

const dollars = (c: number) => (c % 100 === 0 ? `$${(c / 100).toLocaleString("en-US")}` : money(c));
export const rateText = (r: { cents: number; unit: Unit }) => `${dollars(r.cents)} / ${r.unit}`;
const CHIP: Record<BookingState, [Tone, string]> = { offered: ["danger", "Offered"], accepted: ["success", "Accepted"], declined: ["danger", "Declined"], cancelled: ["neutral", "Cancelled"], done: ["neutral", "Done"] };
export const BookingChip = ({ state }: { state: BookingState }) => <StatusChip tone={CHIP[state][0]}>{CHIP[state][1]}</StatusChip>;
const offeredText = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? "offered today" : `offered ${dateShort(t)}`);
/** What follows the dates in a row: the rate, then where it stands. */
const BRIEF = { none: "no brief yet", draft: "brief drafted", sent: "brief sent", read: "brief read" } as const;
function rowMeta(x: Row, withProject: boolean) {
  const tail = x.state === "declined" ? (x.declineReason ? `“${x.declineReason}”` : "no reason given") : x.state === "offered" ? (x.brief === "none" ? offeredText(x.offeredAt) : BRIEF[x.brief]) : x.state === "cancelled" ? `cancelled ${dateShort(x.cancelledAt ?? x.offeredAt)}` : BRIEF[x.brief];
  return [withProject ? x.project : null, shortRange(x.start, x.end), rateText(x.rate), tail].filter(Boolean).join(" · ");
}

// ---------- Book a vendor (732:3051) ----------

const today = () => new Date().toLocaleDateString("en-CA");

export function BookDialog({ onClose, projectId, vendorId }: { onClose: () => void; projectId?: Id<"projects">; vendorId?: Id<"vendors"> }) {
  const f = useQuery(api.bookings.form, { projectId });
  const create = useMutation(api.bookings.create);
  const [vid, setVid] = useState<string>(vendorId ?? "");
  const [pid, setPid] = useState<string>(projectId ?? "");
  const [role, setRole] = useState("");
  const [start, setStart] = useState(""), [end, setEnd] = useState("");
  const [unit, setUnit] = useState<Unit>("day");
  const [cents, setCents] = useState(0);
  const [touched, setTouched] = useState(false); // typed their own rate: a suggestion no longer replaces it
  const [hours, setHours] = useState("");
  const [location, setLocation] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);

  const vendor = f?.vendors.find((x) => x._id === vid) ?? null;
  // Picking a vendor picks their first role (and the unit they charge it in, when they've said).
  useEffect(() => {
    if (!vendor) return;
    const r = vendor.roles.includes(role) ? role : vendor.roles[0] ?? "";
    setRole(r);
    const own = vendor.rates.find((x) => x.role === r);
    if (own) setUnit(own.unit);
  }, [vid, f === undefined]); // eslint-disable-line react-hooks/exhaustive-deps
  const sug = useMemo(() => (f && vendor && role ? suggestRate(f.rates, vendor.rates, role, unit) : null), [f, vendor, role, unit]);
  useEffect(() => { if (sug && !touched) setCents(sug.cents); }, [sug?.cents]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = !!sug && touched && cents !== sug.cents;
  const h = Number(hours);
  const datesOk = isDate(start) && isDate(end) && end >= start;
  const cost = datesOk && cents > 0 && (unit === "day" || h > 0) ? expectedCents({ start, end, rate: { cents, unit }, hours: h }) : null;
  const projectLabel = f?.project?.label ?? f?.projects.find((p) => p._id === pid)?.label ?? null;
  const first = vendor?.name.split(" ")[0] ?? "They";

  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const id = await create({ vendorId: vid as Id<"vendors">, projectId: pid as Id<"projects">, role, start, end, cents, unit, ...(unit === "hour" ? { hours: h } : {}),
        ...(sug ? { suggestedCents: sug.cents } : {}), ...(location.trim() ? { location } : {}), ...(note.trim() ? { note } : {}) });
      onClose();
      navigate(`/vendors/bookings/${id}`);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  const sugText = sug && (sug.source === "pricing"
    ? `Suggested ${rateText(sug)} from Pricing (${sug.name} ${rateText({ cents: sug.baseCents, unit: sug.baseUnit })}${sug.baseUnit !== sug.unit ? `${sug.unit === "day" ? " ×" : " ÷"} ${sug.hoursPerDay} h` : ""}).`
    : `Suggested ${rateText(sug)} from ${first}’s own ${sug.name} rate.`);

  return (
    <Modal onClose={onClose} label="Book a vendor" width={600}>
      <div className="crm-dialog">
        <DialogHeader eyebrow={projectId ? projectLabel ?? "Vendors" : "Vendors"} title="Book a vendor." body="They get the offer by email and in their portal, and accept or decline it." onClose={onClose} />
        {f === undefined ? <SkeletonRows n={4} /> : f.vendors.length === 0 ? (
          <EmptyState icon="user" title="No vendors yet." body="Add the people you hire first, then book them here." actions={<ButtonLink variant="primary" to="/vendors">Add a vendor</ButtonLink>} />
        ) : (
          <div className="qz-grid">
            <label className="wp-field qz-q wide"><span className="wp-field-label">Vendor</span>
              <select className="input" value={vid} onChange={(e) => { setVid(e.target.value); setTouched(false); }}>
                <option value="" disabled>Pick a vendor</option>
                {f.vendors.map((x) => <option key={x._id} value={x._id}>{x.name}{x.roles.length ? ` · ${x.roles.join(", ")}` : ""}</option>)}
              </select></label>
            {!projectId && <label className="wp-field qz-q wide"><span className="wp-field-label">Project</span>
              <select className="input" value={pid} onChange={(e) => setPid(e.target.value)}>
                <option value="" disabled>Pick a project</option>
                {f.projects.map((p) => <option key={p._id} value={p._id}>{p.label}</option>)}
              </select></label>}
            <label className="wp-field qz-q"><span className="wp-field-label">Role</span>
              <select className="input" value={role} disabled={!vendor} onChange={(e) => { setRole(e.target.value); setTouched(false); const own = vendor?.rates.find((x) => x.role === e.target.value); if (own) setUnit(own.unit); }}>
                {!vendor && <option value="">Pick a vendor first</option>}
                {vendor && vendor.roles.length === 0 && <option value="">No roles yet</option>}
                {vendor?.roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select></label>
            <div className="wp-field qz-q"><span className="wp-field-label">Agreed rate</span>
              <span className={`vd-rate${changed ? " bk-changed" : ""}`}><MoneyInput label="Agreed rate" value={cents} onChange={(c) => { setCents(c); setTouched(true); }} />
                <select className="input" aria-label="Per" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}><option value="day">/ day</option><option value="hour">/ hour</option></select></span></div>
            <div className="qz-q wide bk-sug">
              <p className="wp-small secondary">{sugText ?? (vendor && role ? `No suggestion: Pricing has no ${role} cost and ${first} has no ${role} rate.` : "The rate is suggested from Pricing once you pick the vendor and role.")}</p>
              {changed && <span className="qz-changed"><StatusChip tone="warning">Changed</StatusChip><button type="button" className="lnk" onClick={() => { setCents(sug!.cents); setTouched(false); }}>Use suggested</button></span>}
            </div>
            <div className="wp-field qz-q wide"><span className="wp-field-label">Dates</span>
              <span className="bk-dates">
                <input className="input" type="date" aria-label="First day" min={today()} value={start} onChange={(e) => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} />
                <span aria-hidden="true">–</span>
                <input className="input" type="date" aria-label="Last day" min={start || today()} value={end} onChange={(e) => setEnd(e.target.value)} />
              </span></div>
            <label className={`wp-field qz-q${unit === "hour" ? "" : " wide"}`}><span className="wp-field-label">Location</span><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Where they’ll be" /></label>
            {unit === "hour" && <label className="wp-field qz-q"><span className="wp-field-label">Hours you expect</span><input className="input" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 30" /></label>}
            <label className="wp-field qz-q wide"><span className="wp-field-label">Note (optional)</span><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <p className="wp-small secondary qz-q wide">{cost !== null ? <>Adds an expected cost of {money(cost)} to the project Ledger{unit === "day" ? ` (${daysIn(start, end)} day${daysIn(start, end) === 1 ? "" : "s"})` : ""}.</> : "Adds an expected cost to the project Ledger."}</p>
          </div>
        )}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy} disabled={!vid || !pid || !role || !datesOk || cents <= 0 || (unit === "hour" && !(h > 0))} onClick={() => void send()}>Send booking</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Vendors › Bookings (730:3942) ----------

type Pill = "upcoming" | "offered" | "declined" | "done" | "cancelled";
const inPill = (s: BookingState, p: Pill) => (p === "upcoming" ? s === "accepted" : s === p);

export default function BookingsPage() {
  const rows = useQuery(api.bookings.list, {});
  const [picked, setPill] = useState<Pill | null>(null);
  const [booking, setBooking] = useState(false);
  const count = (p: Pill) => (rows ?? []).filter((x) => inPill(x.state, p)).length;
  // Opens on Upcoming, or on Offered when nothing is upcoming yet.
  const pill: Pill = picked ?? (count("upcoming") === 0 && count("offered") > 0 ? "offered" : "upcoming");
  const shown = (rows ?? []).filter((x) => inPill(x.state, pill));
  if (pill === "done" || pill === "declined" || pill === "cancelled") shown.reverse(); // the most recent first
  return (
    <>
      <TopBar><a {...linkProps("/production")}>Production</a><Sep /><span className="here">Bookings</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow="Production · Pre-pro" title="Bookings." sub="Who you’ve booked, for which project and when." actions={<Button variant="primary" onClick={() => setBooking(true)}>Book a vendor</Button>} />
        {rows === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card> : rows.length === 0 ? (
          <EmptyState icon="calendar" title="No bookings yet." body="Book a vendor on a project: they get the offer by email and accept or decline it in their portal." actions={<Button variant="primary" onClick={() => setBooking(true)}>Book a vendor</Button>} />
        ) : (
          <>
            <PillTabs label="Show" value={pill} onChange={setPill} items={[{ key: "upcoming", label: "Upcoming", count: count("upcoming") }, { key: "offered", label: "Offered", count: count("offered") }, { key: "declined", label: "Declined", count: count("declined") }, { key: "done", label: "Done", count: count("done") }, ...(count("cancelled") ? [{ key: "cancelled" as Pill, label: "Cancelled", count: count("cancelled") }] : [])]} />
            <Card label="Bookings">
              {shown.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "calendar" }} title="None here." />
                : shown.map((x, i) => <div key={x._id} className="wp-rowwrap">{i > 0 && <Divider />}
                  <ListRow lead={{ avatar: x.vendor, two: true }} to={`/vendors/bookings/${x._id}`} title={`${x.vendor} · ${x.role}`} meta={rowMeta(x, true)} chip={<BookingChip state={x.state} />} chevron /></div>)}
            </Card>
          </>
        )}
      </div>
      {booking && <BookDialog onClose={() => setBooking(false)} />}
    </>
  );
}

// ---------- one booking ----------

export function BookingPage({ bookingId }: { bookingId: string }) {
  const x = useQuery(api.bookings.get, { bookingId });
  const cancel = useMutation(api.bookings.cancel);
  const [toast, show] = useToast();
  const [confirm, confirmNode] = useConfirm();
  const [briefing, setBriefing] = useState(false);
  const top = <TopBar><a {...linkProps("/production")}>Production</a><Sep /><a {...linkProps("/vendors/bookings")}>Bookings</a>{x && <><Sep /><span className="here">{x.vendor} · {x.role}</span></>}</TopBar>;
  if (x === undefined) return <>{top}<div className="wp-page"><Card label="Loading"><SkeletonRows n={5} /></Card></div></>;
  if (x === null) return <>{top}<div className="wp-page"><EmptyState icon="calendar" title="This booking isn't here." actions={<ButtonLink to="/vendors/bookings">All bookings</ButtonLink>} /></div></>;
  const first = x.vendor.split(" ")[0];
  const open = x.state === "offered" || x.state === "accepted";
  const doCancel = async () => {
    const offered = x.state === "offered";
    if (!(await confirm({ title: offered ? `Take back the offer to ${first}?` : `Cancel ${first}’s booking?`, body: `It comes off the project’s Crew card and Ledger, and ${first} gets an email saying so.`, yes: offered ? "Take back" : "Cancel booking" }))) return;
    try { await cancel({ bookingId: x._id }); show("Cancelled."); } catch (e) { show(errText(e)); }
  };
  const answer = x.state === "accepted" || x.state === "done" ? `Accepted ${dateShort(x.answeredAt ?? x.offeredAt)}` : x.state === "declined" ? `Declined ${dateShort(x.answeredAt ?? x.offeredAt)}${x.declineReason ? `: “${x.declineReason}”` : ""}` : x.state === "cancelled" ? `Cancelled ${dateShort(x.cancelledAt ?? x.offeredAt)}` : `Waiting for ${first} to accept or decline in their portal.`;
  return (
    <>
      {top}
      <div className="wp-page">
        <PageHeader eyebrow={<a {...linkProps(`/projects/${x.projectId}`)}>{x.project}</a>} title={`${x.vendor} · ${x.role}.`} sub={dateRange(x.start, x.end)}
          actions={<>{open && <Button onClick={() => void doCancel()}>{x.state === "offered" ? "Take back the offer" : "Cancel booking"}</Button>}<ButtonLink to={`/vendors/${x.vendorId}`}>Open {first}’s page</ButtonLink></>} />
        <div className="wp-homecols">
          <div className="col">
            <Card label="Booking" head={<SectionHead label="Booking" action={<BookingChip state={x.state} />} />}>
              <dl className="cp-see">
                <dt>Project</dt><dd><a {...linkProps(`/projects/${x.projectId}`)}>{x.project}</a></dd>
                <dt>Role</dt><dd>{x.role}</dd>
                <dt>Dates</dt><dd>{dateRange(x.start, x.end)}{x.days > 1 ? ` · ${x.days} days` : ""}</dd>
                <dt>Agreed rate</dt><dd>{rateText(x.rate)}{x.suggestedCents && x.suggestedCents !== x.rate.cents ? <span className="secondary"> · suggested {rateText({ cents: x.suggestedCents, unit: x.rate.unit })}</span> : null}</dd>
                {x.hours !== null && <><dt>Hours expected</dt><dd>{x.hours}</dd></>}
                <dt>Expected cost</dt><dd>{money(x.expectedCents)}{open ? " · in the Ledger" : ""}</dd>
                {x.location && <><dt>Location</dt><dd>{x.location}</dd></>}
                {x.note && <><dt>Note</dt><dd>{x.note}</dd></>}
              </dl>
            </Card>
          </div>
          <div className="col right">
            <Card label="Where it stands" head={<SectionHead label="Where it stands" />}>
              <dl className="cp-see">
                <dt>Offered</dt><dd>{dateShort(x.offeredAt)}{x.createdBy ? ` by ${x.createdBy}` : ""} · emailed to {x.vendorEmail ?? first}</dd>
                <dt>Answer</dt><dd>{answer}</dd>
                <dt>Briefing</dt><dd>{x.briefing ? <a {...linkProps(`/vendors/briefings/${x.briefing._id}`)}>{x.briefing.readAt ? `Read ${dateShort(x.briefing.readAt)}` : x.briefing.sentAt ? `Sent ${dateShort(x.briefing.sentAt)}, not read yet` : "A draft"}</a>
                  : open ? <button type="button" className="linkbtn" onClick={() => setBriefing(true)}>Write the briefing</button> : <span className="secondary">None</span>}</dd>
              </dl>
            </Card>
          </div>
        </div>
      </div>
      {briefing && <NewBriefing bookingId={x._id} onClose={() => setBriefing(false)} />}
      {confirmNode}{toast}
    </>
  );
}

// ---------- the Crew card (730:2326, D96) and a vendor's bookings ----------

export function CrewCard({ projectId }: { projectId: Id<"projects"> }) {
  const rows = useQuery(api.bookings.forProject, { projectId });
  const [booking, setBooking] = useState(false);
  return (
    <>
      <Card className="pj-crew" label="Crew" head={<SectionHead label="Crew" count={rows?.length ?? undefined} action={<Button size="sm" variant="ghost" onClick={() => setBooking(true)}>Book a vendor</Button>} />}>
        {rows === undefined ? <SkeletonRows n={2} /> : !rows || rows.length === 0 ? <p className="pj-pad secondary">No one booked yet. Book a shooter, editor or anyone else you hire.</p>
          : rows.map((x) => <ListRow key={x._id} lead={{ avatar: x.vendor, two: true }} to={`/vendors/bookings/${x._id}`} title={`${x.vendor} · ${x.role}`}
            meta={[shortRange(x.start, x.end), x.state === "declined" ? (x.declineReason ? `“${x.declineReason}”` : null) : x.state === "offered" && x.brief === "none" ? offeredText(x.offeredAt) : BRIEF[x.brief]].filter(Boolean).join(" · ")}
            chip={<BookingChip state={x.state} />} chevron />)}
      </Card>
      {booking && <BookDialog projectId={projectId} onClose={() => setBooking(false)} />}
    </>
  );
}

export function VendorBookings({ vendorId, first }: { vendorId: Id<"vendors">; first: string }) {
  const rows = useQuery(api.bookings.forVendor, { vendorId });
  return (
    <Card label="Bookings" head={<SectionHead label="Bookings" count={rows?.length ?? 0} action={rows && rows.length > 0 ? <ButtonLink size="sm" variant="ghost" to="/vendors/bookings">All bookings</ButtonLink> : undefined} />}>
      {rows === undefined ? <SkeletonRows n={2} /> : !rows || rows.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "calendar" }} title={`No bookings yet. Book ${first} on a project.`} />
        : rows.slice(0, 6).map((x, i) => <div key={x._id} className="wp-rowwrap">{i > 0 && <Divider />}
          <ListRow className="ilead" lead={{ icon: "calendar" }} to={`/vendors/bookings/${x._id}`} title={`${x.project} · ${x.role}`} meta={rowMeta(x, false)} chip={<BookingChip state={x.state} />} chevron /></div>)}
    </Card>
  );
}
