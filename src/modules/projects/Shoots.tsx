// Phase 4 (Nov 2): shoots. The owner's Shoots card and Schedule a shoot dialog (741:1424, 741:2529); the client's Coming
// up card (738:8722) and Shoot page (738:9111 To confirm, 738:9492 Confirmed; phone 742:2143).
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, Checkbox, DialogHeader, Divider, EmptyState, ListRow, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useConfirm, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { GearOnShoot } from "../production/Gear";

export const clock = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
export const shootDay = (ymd: string, long = false) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: long ? "long" : "short", month: "short", day: "numeric" });
const at = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const todayLocal = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const maps = (place: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;

type Owner = NonNullable<ReturnType<typeof useQuery<typeof api.shoots.forProject>>>;
type Shoot = Owner["shoots"][number];

// ---------- the owner ----------

export function ShootsCard({ projectId, client, label }: { projectId: Id<"projects">; client: string | null; label: string }) {
  const d = useQuery(api.shoots.forProject, { projectId });
  const [open, setOpen] = useState<null | "new" | Shoot>(null);
  const [toast, show] = useToast();
  if (d === undefined) return <Card className="pj-shoots" label="Shoots" head={<SectionHead label="Shoots" />}><SkeletonRows n={1} /></Card>;
  if (d === null) return null;
  return (
    <>
      <Card className="pj-shoots" label="Shoots" head={<SectionHead label="Shoots" count={d.shoots.length || undefined} action={<Button size="sm" variant="ghost" onClick={() => setOpen("new")}>Schedule a shoot</Button>} />}>
        {d.shoots.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "calendar" }} title="No shoots scheduled." meta={client ? `${client} confirms each one in their portal.` : undefined} />
          : d.shoots.map((s, i) => (
            <div key={s._id} className="wp-rowwrap">{i > 0 && <Divider />}
              <ListRow className="ilead" lead={{ icon: "calendar" }} onClick={() => setOpen(s)} chevron
                title={`${shootDay(s.date)} · ${clock(s.call)} call`}
                meta={[s.location, s.crew.map((c) => c.name).join(", "), s.date < d.today ? "past" : null].filter(Boolean).join(" · ")}
                chip={s.confirmed ? <StatusChip tone="success">Confirmed</StatusChip> : s.moved ? <StatusChip tone="warning">Moved · to confirm</StatusChip> : <StatusChip tone="warning">To confirm</StatusChip>} />
            </div>
          ))}
      </Card>
      {open && <ShootDialog projectId={projectId} label={label} data={d} shoot={open === "new" ? null : open} client={client} people={d.people} onClose={() => setOpen(null)} show={show} />}
      {toast}
    </>
  );
}

export function ShootDialog({ projectId, label, data, shoot, client, people, onClose, show }: { projectId: Id<"projects">; label: string; data: Owner; shoot: Shoot | null; client: string | null; people: number; onClose: () => void; show: (t: string) => void }) {
  const schedule = useMutation(api.shoots.schedule);
  const update = useMutation(api.shoots.update);
  const cancel = useMutation(api.shoots.cancel);
  const [ask, confirmDialog] = useConfirm();
  const [date, setDate] = useState(shoot?.date ?? "");
  const [call, setCall] = useState(shoot?.call ?? "07:00");
  const [wrap, setWrap] = useState(shoot?.wrap ?? "");
  const [location, setLocation] = useState(shoot?.location ?? "");
  const [parking, setParking] = useState(shoot?.parking ?? "");
  const [prepare, setPrepare] = useState((shoot?.prepare ?? []).join("\n"));
  const [withOwner, setWithOwner] = useState(shoot ? shoot.crew.some((c) => c.owner) : true);
  const [crew, setCrew] = useState<string[]>(shoot ? shoot.crew.filter((c) => c.bookingId).map((c) => c.bookingId!) : []);
  const [calendar, setCalendar] = useState(shoot?.calendar ?? !!data.calendar);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const who = client ?? "The client";
  const moved = !!shoot && (date !== shoot.date || call !== shoot.call || location.trim() !== shoot.location);
  const args = { date, call, ...(wrap ? { wrap } : {}), location, ...(parking.trim() ? { parking } : {}), prepare: prepare.split("\n"), withOwner, bookingIds: crew as Id<"vendorBookings">[], calendar };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (shoot) {
        const r = await update({ shootId: shoot._id as Id<"shoots">, ...args });
        show(r.moved ? (r.told ? `Moved. ${who} is asked to confirm again.` : "Moved.") : "Saved.");
      } else {
        const r = await schedule({ projectId, ...args });
        show(r.told ? `Scheduled. ${who} gets it in their Inbox and by email.` : "Scheduled. Nobody at the client can open this project yet, so nobody was told.");
      }
      onClose();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  const doCancel = async () => {
    if (!shoot || !(await ask({ title: "Cancel this shoot?", body: `It comes off ${who}'s pages, with a line in their Inbox. No email goes out.`, yes: "Cancel shoot", no: "Keep it" }))) return;
    try { await cancel({ shootId: shoot._id as Id<"shoots"> }); show("Cancelled."); onClose(); } catch (e) { setErr(errText(e)); }
  };
  const tell = people > 0 ? `${who} gets it in their Inbox and by email, and confirms it.` : `Nobody at ${who === "The client" ? "the client" : who} can open this project in the portal yet, so it's saved without telling anyone.`;
  return (
    <>
    <Modal onClose={onClose} label={shoot ? "Edit the shoot" : "Schedule a shoot"} width={600}>
      <div className="crm-dialog">
        <DialogHeader eyebrow={shoot ? `${label} · shoot ${shootDay(shoot.date)}` : label} title={shoot ? "Edit the shoot." : "Schedule a shoot."} body={shoot ? (moved ? `A new date, call time or place asks ${who === "The client" ? "the client" : who} to confirm again.` : "Changes to what to prepare and who's coming just save.") : tell} onClose={onClose} />
        <div className="qz-grid sh-grid">
          <label className="wp-field qz-q"><span className="wp-field-label">Date</span><input className="input" type="date" min={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <span className="sh-times">
            <label className="wp-field"><span className="wp-field-label">Call time</span><input className="input" type="time" step={300} value={call} onChange={(e) => setCall(e.target.value)} /></label>
            <label className="wp-field"><span className="wp-field-label">Wrap (optional)</span><input className="input" type="time" step={300} value={wrap} onChange={(e) => setWrap(e.target.value)} /></label>
          </span>
          <label className="wp-field qz-q wide"><span className="wp-field-label">Location</span><input className="input" value={location} placeholder="Harbor Coffee, 412 Main St." onChange={(e) => setLocation(e.target.value)} /></label>
          <label className="wp-field qz-q wide"><span className="wp-field-label">Parking (optional)</span><input className="input" value={parking} placeholder="Behind the shop" onChange={(e) => setParking(e.target.value)} /></label>
          <label className="wp-field qz-q wide"><span className="wp-field-label">What to prepare (one per line)</span><textarea className="input" rows={4} value={prepare} onChange={(e) => setPrepare(e.target.value)} /></label>
          <div className="wp-field qz-q wide"><span className="wp-field-label">Who's coming</span>
            <div className="qz-chips">
              <button type="button" className={`qz-chip${withOwner ? " on" : ""}`} aria-pressed={withOwner} onClick={() => setWithOwner(!withOwner)}>{data.owner}</button>
              {data.crew.map((c) => { const on = crew.includes(c.bookingId); return <button key={c.bookingId} type="button" className={`qz-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setCrew(on ? crew.filter((x) => x !== c.bookingId) : [...crew, c.bookingId])}>{c.name} ({c.status === "offered" ? "offered" : "booked"})</button>; })}
            </div>
            {data.crew.length === 0 && <span className="wp-field-hint">Book vendors on this project (the Crew card) to add them here.</span>}
          </div>
          {shoot && <GearOnShoot shootId={shoot._id} />}
          <div className="qz-q wide"><Checkbox checked={calendar} onChange={setCalendar} label={data.calendar ? `Add to ${data.calendar}` : "Add to your calendar"} hint={data.calendar ? "Set in Settings › Calendar." : "Once Settings › Calendar is connected, shoots you tick go on it and move with it."} /></div>
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          {shoot && <button className="btn ghost sh-cancel" type="button" onClick={() => void doCancel()}>Cancel shoot</button>}
          <button className="btn ghost" type="button" onClick={onClose}>Close</button>
          <Button variant="primary" loading={busy} disabled={!date || !call || !location.trim()} onClick={() => void save()}>{shoot ? (moved ? "Save and ask again" : "Save") : people > 0 ? "Schedule and send" : "Schedule"}</Button>
        </div>
      </div>
    </Modal>
    {confirmDialog}
    </>
  );
}

// ---------- the client ----------

/** The shoots in the client project's Coming up card (with file requests and the brief, later steps). */
export function ComingUpShoots({ projectId }: { projectId: string }) {
  const list = useQuery(api.shoots.forClientProject, { projectId });
  const sheets = useQuery(api.callSheets.forClientProject, { projectId }); // Phase 5b step 3: a call sheet sent to them, under its shoot
  if (!list?.length) return null;
  return <>{list.map((s, i) => {
    const cs = (sheets ?? []).find((c) => c.date === s.date);
    return (
      <div key={s._id} className="wp-rowwrap">{i > 0 && <Divider />}
        <ListRow className="ilead" lead={{ icon: "calendar" }} to={`/shoots/${s._id}`} title={`Shoot · ${shootDay(s.date)} · ${clock(s.call)} call`}
          meta={`${s.location}${s.confirmed ? " · confirmed" : " · please confirm"}`}
          action={s.confirmed ? <StatusChip tone="success">Confirmed</StatusChip> : <span className="btn sm" aria-hidden>Confirm</span>} />
        {cs && <><Divider /><ListRow className="ilead" lead={{ icon: "document" }} to={`/call-sheets/${cs._id}`} title={`Call sheet · ${shootDay(cs.date)}`} meta={cs.call ? `Your call ${clock(cs.call)}` : undefined} chip={cs.opened ? undefined : <StatusChip tone="danger">New</StatusChip>} chevron /></>}
      </div>
    );
  })}</>;
}
export const useComingUpCount = (projectId: string) => useQuery(api.shoots.forClientProject, { projectId })?.length ?? 0;

/** An .ics for "Add to my calendar" (floating local time: the shoot's own wall clock). */
function ics(d: { _id: string; date: string; call: string; wrap: string | null; location: string; project: { label: string }; business: string }) {
  const t = (ymd: string, hm: string) => `${ymd.replace(/-/g, "")}T${hm.replace(":", "")}00`;
  const end = d.wrap ?? `${String(Math.min(23, Number(d.call.slice(0, 2)) + 2)).padStart(2, "0")}${d.call.slice(2)}`;
  const esc = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//WranglerPortal//Shoot//EN", "BEGIN:VEVENT", `UID:${d._id}@wranglerportal.com`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`, `DTSTART:${t(d.date, d.call)}`, `DTEND:${t(d.date, end)}`,
    `SUMMARY:${esc(`Shoot · ${d.project.label}`)}`, `LOCATION:${esc(d.location)}`, `DESCRIPTION:${esc(`With ${d.business}. ${location.origin}/shoots/${d._id}`)}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
  a.download = `Shoot ${d.date}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function ClientShootPage({ shootId }: { shootId: string }) {
  const d = useQuery(api.shoots.page, { shootId });
  const confirm = useMutation(api.shoots.confirm);
  const [toast, show] = useToast();
  const [busy, setBusy] = useState(false);
  // What to prepare: ticks are only for you, on this device.
  const store = `wp-shoot-prep:${shootId}`;
  const [ticks, setTicks] = useState<number[]>(() => { try { return JSON.parse(localStorage.getItem(store) ?? "[]"); } catch { return []; } });
  useEffect(() => { try { localStorage.setItem(store, JSON.stringify(ticks)); } catch { /* private mode */ } }, [store, ticks]);
  const top = (label?: string) => <TopBar><a {...linkProps("/review")}>Review</a>{d && <><Sep /><a {...linkProps(`/projects/${d.project._id}`)}>{d.project.label}</a></>}<Sep /><span className="here">{label ?? "Shoot"}</span></TopBar>;
  if (d === undefined) return <>{top()}<div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (d === null) return <>{top()}<div className="wp-page"><EmptyState icon="calendar" title="This shoot isn't here." body="It may have been cancelled or moved to another project." actions={<ButtonLink to="/inbox">Back to your Inbox</ButtonLink>} /></div></>;
  const day = new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long" });
  const ownerFirst = d.owner.split(" ")[0];
  const mail = `mailto:${d.replyTo}?${new URLSearchParams({ subject: `Shoot on ${shootDay(d.date)}: ${d.project.label}` }).toString().replace(/\+/g, "%20")}`;
  const onConfirm = async () => {
    setBusy(true);
    try { await confirm({ shootId: d._id as Id<"shoots"> }); show(`Confirmed. ${ownerFirst} gets a note.`); } catch (e) { show(errText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      {top(`Shoot · ${shootDay(d.date).replace(/^\w+, /, "")}`)}
      <div className="wp-page sh-page">
        <header className="pj-head sh-head">
          <span className="wp-eyebrow">Shoot · {d.project.label}</span>
          <h1 className="wp-h2">{shootDay(d.date, true)}.</h1>
          <span className="sh-sub"><span className="secondary">Call {clock(d.call)}{d.wrap ? ` · wrap about ${clock(d.wrap)}` : ""}</span>
            {d.confirmed ? <StatusChip tone="success">Confirmed</StatusChip> : <StatusChip tone="warning">To confirm</StatusChip>}</span>
        </header>
        <div className="wp-homecols">
          <div className="col">
            <Card className="sh-where" label="Where" head={<SectionHead label="Where" />}>
              <dl className="cp-see"><dt>Location</dt><dd>{d.location}</dd>{d.parking && <><dt>Parking</dt><dd>{d.parking}</dd></>}</dl>
              <a className="sh-maps" href={maps(d.location)} target="_blank" rel="noopener noreferrer"><Icon name="map-pin" size={16} />Open in Maps</a>
            </Card>
            {d.prepare.length > 0 && (
              <Card className="sh-prep" label="What to prepare" head={<SectionHead label="What to prepare" count={d.prepare.length} />}>
                <div className="sh-checks">{d.prepare.map((line, i) => <Checkbox key={i} checked={ticks.includes(i)} onChange={(on) => setTicks(on ? [...ticks, i] : ticks.filter((x) => x !== i))} label={line} />)}</div>
              </Card>
            )}
            {d.crew.length > 0 && (
              <Card className="sh-who" label="Who's coming" head={<SectionHead label="Who's coming" />}>
                <dl className="cp-see">{d.crew.map((c, i) => <div key={i} style={{ display: "contents" }}><dt>{c.name}</dt><dd>{c.role}</dd></div>)}</dl>
              </Card>
            )}
          </div>
          <div className="col right">
            <Card className="sh-ask" label={d.confirmed ? "Confirmed" : "Can you make it?"} head={<SectionHead label={d.confirmed ? "Confirmed" : "Can you make it?"} />}>
              <div className="sh-askbody">
                {d.confirmed ? <>
                  <div className="sh-done"><Icon name="check-circle" size={20} /><span><b>Confirmed by {d.confirmed.name} · {at(d.confirmed.at)}</b><br /><span className="secondary">We'll see you {day}. If something changes, reply to the email.</span></span></div>
                  <Button onClick={() => ics(d)}>Add to my calendar</Button>
                </> : d.past ? <p className="secondary">This shoot has passed.</p> : <>
                  {d.moved && <p className="wp-small sh-moved">{d.moved.date !== d.date ? `It moved from ${shootDay(d.moved.date)}${d.moved.call !== d.call ? ` at ${clock(d.moved.call)}` : ""}.` : d.moved.call !== d.call ? `The call time changed from ${clock(d.moved.call)}.` : "The place changed."} Please confirm the new details.</p>}
                  <p className="secondary">Please confirm the date, time and place. Your confirmation is saved with your name and the time.</p>
                  <Button variant="primary" loading={busy} onClick={() => void onConfirm()}>Confirm the shoot</Button>
                  <a className="btn ghost" href={mail}>Ask to change it</a>
                </>}
              </div>
            </Card>
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}
