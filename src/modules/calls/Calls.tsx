// Phase 5d step 1 (Nov 4): booking calls. Frames S5 · Phase 5d: Settings › Booking calls (801:8966; no calendar
// 801:9496; loading 801:9938; phone 802:10446), the lead's page (801:10421 pick a time, 801:10512 your details,
// 801:10611 booked, 801:10666 no times open), Manage your call and its Cancel dialog (802:10221, 802:10312), the lead
// page's Upcoming call card (801:10703), and the Dashboard's Needs you row (Q86, not drawn).
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, Divider, EmptyState, ListRow, SectionHead, SkeletonRows, StatusChip, Toggle } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { useConfirm, useToast } from "../../ui/kit";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { Banner, Frame } from "../payments/ClientInvoice";
import { SetHead } from "../settings/Frame";
import { AHEAD, BUFFERS, DAY_NAMES, LENGTHS, NOTICE } from "../../../convex/lib/callSlots";

// ---------- times in a zone ----------
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago"; } catch { return "America/Chicago"; } };
const zoneName = (tz: string, at = Date.now()) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value ?? tz; } catch { return tz; } };
const zoneShort = (tz: string, at = Date.now()) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value ?? ""; } catch { return ""; } };
const dayKey = (ms: number, tz: string) => new Date(ms).toLocaleDateString("en-CA", { timeZone: tz });
const dayLabel = (ms: number, tz: string) => new Date(ms).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).replace(",", "");
const timeLabel = (ms: number, tz: string) => new Date(ms).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
export function whenLabel(start: number, end: number, tz: string) {
  const d = new Date(start).toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
  const s = timeLabel(start, tz), e = timeLabel(end, tz);
  const same = s.slice(-2) === e.slice(-2);
  return `${d} · ${same ? s.replace(/ ?[AP]M$/, "") : s} – ${e} (${zoneName(tz, start)})`;
}
const ZONES: string[] = (() => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone"); } catch { return ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "UTC"]; } })();
const legalLine = (b: { name: string; legalName: string | null }) => `${!b.legalName ? b.name : b.legalName.includes(b.name) ? b.legalName : `${b.name}, ${b.legalName}`} · Questions? Reply to the email that brought you here.`;

/** "Add to my calendar": a small .ics file. */
function icsFor(c: { start: number; end: number; business: string; meet: string | null }) {
  const f = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//WranglerPortal//Calls//EN", "BEGIN:VEVENT", `UID:${f(c.start)}-${Math.random().toString(36).slice(2)}@wranglerportal.com`, `DTSTAMP:${f(Date.now())}`,
    `DTSTART:${f(c.start)}`, `DTEND:${f(c.end)}`, `SUMMARY:${esc(`Call with ${c.business}`)}`, ...(c.meet ? [`LOCATION:${esc(c.meet)}`, `DESCRIPTION:${esc(`Google Meet: ${c.meet}`)}`] : []), "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
  const a = document.createElement("a"); a.href = url; a.download = "call.ics"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- the time picker (book, and move a booked call) ----------

function Picker({ slots, tz, setTz, lengthMin, value, onPick, onCheckAgain, busyLabel, onContinue }: {
  slots: number[]; tz: string; setTz: (z: string) => void; lengthMin: number; value: number | null; onPick: (s: number) => void; onCheckAgain: () => void; busyLabel?: string; onContinue: () => void;
}) {
  const days = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const s of slots) { const k = dayKey(s, tz); if (!m.has(k)) m.set(k, []); m.get(k)!.push(s); }
    return [...m.entries()];
  }, [slots, tz]);
  const [day, setDay] = useState<string | null>(null);
  const [zoneOpen, setZoneOpen] = useState(false);
  const current = days.find(([k]) => k === day) ?? days.find(([, xs]) => value !== null && xs.includes(value)) ?? days[0];
  if (!days.length) return (
    <div className="bc-none">
      <p className="wp-body">No times are open right now.</p>
      <p className="wp-small secondary">New times open as days come up. Check again later, or reply to the email that brought you here.</p>
      <Button onClick={onCheckAgain}>Check again</Button>
    </div>
  );
  return (
    <>
      <p className="wp-small secondary">Pick a time that suits you. Times are shown in your time zone: {zoneName(tz)}{zoneShort(tz) ? ` (${zoneShort(tz)})` : ""}.</p>
      <span className="bc-label">Day</span>
      <div className="qz-chips bc-days" role="group" aria-label="Day">
        {days.slice(0, 30).map(([k, xs]) => <button key={k} type="button" className={`qz-chip${current?.[0] === k ? " on" : ""}`} aria-pressed={current?.[0] === k} onClick={() => setDay(k)}>{dayLabel(xs[0], tz)}</button>)}
      </div>
      <span className="bc-label">Time</span>
      <div className="qz-chips bc-times" role="group" aria-label="Time">
        {(current?.[1] ?? []).map((s) => <button key={s} type="button" className={`qz-chip${value === s ? " on" : ""}`} aria-pressed={value === s} onClick={() => onPick(s)}>{timeLabel(s, tz)}</button>)}
      </div>
      <div className="bc-foot">
        {zoneOpen ? (
          <select className="input bc-zone" aria-label="Your time zone" value={tz} onChange={(e) => { setTz(e.target.value); setZoneOpen(false); }}>
            {ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </select>
        ) : <button type="button" className="linkbtn wp-small secondary" onClick={() => setZoneOpen(true)}>Not in {zoneName(tz)}? Change time zone</button>}
        <span className="sp" />
        <Button variant="primary" disabled={value === null} onClick={onContinue}>{busyLabel ?? "Continue"}</Button>
      </div>
      <p className="wp-small secondary bc-len">{lengthMin}-minute call</p>
    </>
  );
}

// ---------- /book/<slug> ----------

export function BookingPage({ slug }: { slug: string }) {
  const p = useQuery(api.calls.page, { slug });
  const refresh = useMutation(api.calls.refresh);
  const book = useMutation(api.calls.book);
  const [tz, setTz] = useState(browserZone);
  const [pick, setPick] = useState<number | null>(null);
  const [step, setStep] = useState<"pick" | "details">("pick");
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [note, setNote] = useState(""), [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [bot, setBot] = useState(false);
  const asked = useRef(false);
  useEffect(() => { if (p?.state === "open" && !asked.current) { asked.current = true; void refresh({ slug }).catch(() => undefined); } }, [p?.state, slug, refresh]);
  const brand = p && "business" in p ? { name: p.business.name, logoUrl: p.business.logoUrl } : null;
  const shell = (body: React.ReactNode) => (
    <Frame inShell={false} bar={null} brand={brand}>
      <section className="bc-card glass">{body}</section>
      {p && "business" in p && <p className="wp-small secondary bc-legal">{legalLine(p.business)}</p>}
    </Frame>
  );
  if (p === undefined) return shell(<SkeletonRows n={4} />);
  if (p === null) return shell(<EmptyState icon="lock" title="This link doesn't work." body="It may have been mistyped. Open it again from the email or the website." />);
  const biz = p.business.name;
  if (p.state === "otherOwner") return shell(<EmptyState icon="lock" title="You're signed in as another business." body={`You can't book with ${biz} while you're signed in to your own business. Open this page in a private window.`} />);
  if (p.state === "closed") return shell(<EmptyState icon="calendar" title="Booking isn't open right now." body={`${biz} isn't taking calls through this page at the moment. Reply to the email that brought you here.`} />);
  if (bot) return shell(<EmptyState icon="check-circle" title="Thanks." body="We'll be in touch." />);
  const eyebrow = <span className="wp-eyebrow">Book a call · {biz}</span>;
  const go = async () => {
    if (pick === null) return;
    setBusy(true); setErr(null);
    try {
      const r = await book({ slug, start: pick, name, email, ...(note.trim() ? { note } : {}), tz, ...(website ? { website } : {}) });
      if (r.error) { setErr(r.error); setStep("pick"); setPick(null); setBusy(false); return; }
      if (!r.token) { setBot(true); return; }
      navigate(`/call/${r.token}?new=1`);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  if (step === "details" && pick !== null) return shell(<>
    {eyebrow}
    <h1 className="bc-title">Your details</h1>
    <p className="wp-small secondary">{whenLabel(pick, pick + p.lengthMin * 60_000, tz)} · <button type="button" className="linkbtn" onClick={() => setStep("pick")}>Change</button></p>
    <div className="qz-grid bc-form">
      <label className="wp-field qz-q wide"><span className="wp-field-label">Your name</span><input className="input" value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label className="wp-field qz-q wide"><span className="wp-field-label">Email</span><input className="input" type="email" value={email} maxLength={254} autoComplete="email" onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="wp-field qz-q wide"><span className="wp-field-label">What would you like to talk about? (optional)</span><textarea className="input" rows={4} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {/* Only robots fill this in: it's hidden from people and screen readers. */}
      <label className="bc-hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
    </div>
    {err && <p className="error" role="alert">{err}</p>}
    <div className="bc-foot"><button type="button" className="btn ghost" onClick={() => setStep("pick")}>Back</button><span className="sp" />
      <Button variant="primary" loading={busy} disabled={!name.trim() || !email.trim()} onClick={() => void go()}>Continue</Button></div>
  </>);
  return shell(<>
    {eyebrow}
    <h1 className="bc-title">Book a {p.lengthMin}-minute call</h1>
    {err && <p className="error" role="alert">{err}</p>}
    {p.reading && !p.slots.length ? <div className="bc-reading"><SkeletonRows n={2} label="Finding open times" /><p className="wp-small secondary">Finding open times…</p></div>
      : <Picker slots={p.slots} tz={tz} setTz={setTz} lengthMin={p.lengthMin} value={pick} onPick={setPick} onCheckAgain={() => { void refresh({ slug }).catch(() => undefined); }} onContinue={() => setStep("details")} />}
  </>);
}

// ---------- /call/<token>: the lead's own call ----------

export function CallPage({ token }: { token: string }) {
  const c = useQuery(api.calls.manage, { token });
  const cancel = useMutation(api.calls.cancel);
  const move = useMutation(api.calls.reschedule);
  const refresh = useMutation(api.calls.refresh);
  const fresh = new URLSearchParams(location.search).has("new");
  const [moving, setMoving] = useState(false);
  const [tz, setTz] = useState(browserZone);
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const [ask, askDialog] = useConfirm();
  const p = useQuery(api.calls.page, moving && c ? { slug: c.slug, token } : "skip");
  useEffect(() => { if (moving && c) void refresh({ slug: c.slug }).catch(() => undefined); }, [moving, c?.slug, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const brand = c ? { name: c.business.name, logoUrl: c.business.logoUrl } : null;
  const shell = (body: React.ReactNode) => (
    <Frame inShell={false} bar={null} brand={brand}>
      <section className="bc-card glass">{body}</section>
      {c && <p className="wp-small secondary bc-legal">{legalLine(c.business)}</p>}
      {askDialog}
    </Frame>
  );
  if (c === undefined) return shell(<SkeletonRows n={4} />);
  if (c === null) return shell(<EmptyState icon="lock" title="This link doesn't work." body="It may have been mistyped. Open it again from your email." />);
  const biz = c.business.name;
  const withWho = c.business.owner ? `${c.business.owner}, ${biz}` : biz;
  const len = Math.round((c.end - c.start) / 60_000);
  const dl = <dl className="bc-dl"><dt>When</dt><dd>{whenLabel(c.start, c.end, tz)}</dd><dt>Length</dt><dd>{len} minutes</dd><dt>With</dt><dd>{withWho}</dd>{c.meet && <><dt>Video</dt><dd><a href={c.meet} target="_blank" rel="noopener noreferrer">Google Meet</a></dd></>}</dl>;
  if (c.status === "verifying" && c.code) return shell(<CodeStep token={token} email={c.email} when={whenLabel(c.start, c.end, tz)} code={c.code} slug={c.slug} />);
  if (c.status === "lapsed" || c.status === "verifying") return shell(<>
    <Banner tone="danger" icon="alert" title="Nothing was booked." text="The code wasn't entered in time, so the time was let go." />
    <ButtonLink variant="primary" to={`/book/${c.slug}`}>Pick a time again</ButtonLink>
  </>);
  if (c.status === "holding") return shell(<div className="bc-reading"><SkeletonRows n={2} label="Booking" /><p className="wp-body">Booking your call…</p><p className="wp-small secondary">Checking the time is still free. This takes a moment.</p></div>);
  if (c.status === "taken") return shell(<>
    <Banner tone="danger" icon="alert" title="That time was just taken." text="Someone booked it a moment before you. Nothing was booked for you." />
    <ButtonLink variant="primary" to={`/book/${c.slug}`}>Pick another time</ButtonLink>
  </>);
  if (c.status === "cancelled") return shell(<>
    <span className="wp-eyebrow">Cancelled</span>
    <h1 className="bc-title">Your call is cancelled.</h1>
    <p className="wp-small secondary">It's off the calendar. Want to talk after all?</p>
    <ButtonLink variant="primary" to={`/book/${c.slug}`}>Book another time</ButtonLink>
  </>);
  if (moving) {
    const send = async () => {
      if (pick === null) return;
      setBusy(true); setErr(null);
      try { const r = await move({ token, start: pick, tz }); if (r.error) { setErr(r.error); setPick(null); } else { setMoving(false); setPick(null); } } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
    };
    return shell(<>
      <span className="wp-eyebrow">Your call · {biz}</span>
      <h1 className="bc-title">Pick a new time</h1>
      <p className="wp-small secondary">Now: {whenLabel(c.start, c.end, tz)}</p>
      {err && <p className="error" role="alert">{err}</p>}
      {p === undefined || (p && p.state === "open" && p.reading && !p.slots.length) ? <SkeletonRows n={2} label="Finding open times" />
        : p && p.state === "open" ? <Picker slots={p.slots} tz={tz} setTz={setTz} lengthMin={len} value={pick} onPick={setPick} onCheckAgain={() => void refresh({ slug: c.slug })} busyLabel={busy ? "Moving…" : "Move the call"} onContinue={() => void send()} />
        : <p className="wp-small secondary">Calls can't be moved here right now. Reply to the email instead.</p>}
      <div className="bc-foot"><button type="button" className="btn ghost" onClick={() => { setMoving(false); setPick(null); setErr(null); }}>Keep the time I have</button></div>
    </>);
  }
  const doCancel = async () => {
    if (!(await ask({ title: "Cancel the call?", body: `Your call with ${biz} on ${whenLabel(c.start, c.end, tz)} comes off both calendars. ${biz} is told.`, yes: "Cancel the call", no: "Keep the call", danger: true }))) return;
    setErr(null);
    try { await cancel({ token }); } catch (e) { setErr(errText(e)); }
  };
  return shell(<>
    {fresh && !c.past ? <><Icon name="check-circle" size={24} className="bc-ok" /><span className="wp-eyebrow">Booked</span><h1 className="bc-title">You're booked.</h1>
      <p className="wp-small secondary">The details are in the calendar invite we emailed to {c.email}.</p></>
      : <><span className="wp-eyebrow">{c.past ? "Past call" : "Your call"} · {biz}</span><h1 className="bc-title">{c.past ? "This call has passed." : "Your call"}</h1></>}
    {c.moving && <Banner tone="neutral" icon="clock" title="Moving your call…" text="Checking the new time is still free." />}
    {c.moveTaken && !c.moving && <Banner tone="danger" icon="alert" title="That new time was just taken." text="Your call is still at the time below. Pick another if you like." />}
    {c.moveFailed && !c.moving && (!c.moveTaken || c.moveFailed > c.moveTaken) && <Banner tone="danger" icon="alert" title="Your call couldn't be moved just now." text="It's still at the time below. Try again in a few minutes." />}
    {dl}
    {err && <p className="error" role="alert">{err}</p>}
    {!c.past && <div className="bc-acts">
      <Button onClick={() => icsFor({ start: c.start, end: c.end, business: biz, meet: c.meet })}>Add to my calendar</Button>
      {c.meet && <a className="btn" href={c.meet} target="_blank" rel="noopener noreferrer">Join Google Meet</a>}
      {c.canChange && <Button variant="ghost" onClick={() => setMoving(true)}>Pick a new time</Button>}
      {c.canChange && <Button variant="ghost" onClick={() => void doCancel()}>Cancel the call</Button>}
    </div>}
  </>);
}

/** Heston (Nov 4, 21:57): the lead types the 6-digit code from their email before the time is booked. */
function CodeStep({ token, email, when, code, slug }: { token: string; email: string; when: string; code: { until: number; triesLeft: number; sentAt: number }; slug: string }) {
  const verify = useMutation(api.calls.verify);
  const resend = useMutation(api.calls.resendCode);
  const [toastNode, toast] = useToast();
  const [value, setValue] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const minsLeft = Math.max(0, Math.ceil((code.until - now) / 60_000));
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await verify({ token, code: value }); if (r.error) { setErr(r.error); setValue(""); } } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const again = async () => {
    setErr(null);
    try { await resend({ token }); setValue(""); toast("A new code is on its way."); } catch (e) { setErr(errText(e)); }
  };
  return (<>
    <span className="wp-eyebrow">Almost booked</span>
    <h1 className="bc-title">Check your email</h1>
    <p className="wp-small secondary">We sent a 6-digit code to <b>{email}</b>. Enter it to book {when}.</p>
    <form className="bc-code" onSubmit={(e) => { e.preventDefault(); if (value.replace(/\D/g, "").length === 6) void go(); }}>
      <label className="wp-field"><span className="wp-field-label">Code</span>
        <input className="input bc-code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d ]/g, ""))} autoFocus aria-describedby="bc-code-help" /></label>
      <Button variant="primary" type="submit" loading={busy} disabled={value.replace(/\D/g, "").length !== 6}>Book the call</Button>
    </form>
    {err && <p className="error" role="alert">{err}</p>}
    <p id="bc-code-help" className="wp-small secondary">Your time is held for {minsLeft} more minute{minsLeft === 1 ? "" : "s"}. No email? Check your spam folder, or <button type="button" className="linkbtn" onClick={() => void again()}>send a new code</button>.</p>
    <div className="bc-foot"><ButtonLink variant="ghost" to={`/book/${slug}`}>Pick a different time</ButtonLink></div>
    {toastNode}
  </>);
}

// ---------- Settings › Booking calls ----------

type Prefs = { lengthMin: number; bufferMin: number; aheadDays: number; noticeHours: number; hours: Array<{ on: boolean; start: string; end: string }> };
const clock = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

export function CallSettings({ show }: { show: (m: string) => void }) {
  const s = useQuery(api.calls.settings, {});
  const save = useMutation(api.calls.saveSettings);
  const setPaused = useMutation(api.calls.setPaused);
  const [p, setP] = useState<Prefs | null>(null);
  const [cal, setCal] = useState<string>("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (s && !p) { setP(s.prefs); setCal(s.calendar?.checkId ?? ""); } }, [s, p]);
  const head = <SetHead eyebrow="Settings" title="Booking calls." sub="Choose when leads can book a call with you." />;
  if (s === undefined || (s && !p)) return <>{head}<div className="panel"><SkeletonRows n={5} /></div></>;
  if (s === null || !p) return null;
  const off = !s.calendar;
  const set = (x: Partial<Prefs>) => setP({ ...p, ...x });
  const setDay = (i: number, x: Partial<Prefs["hours"][number]>) => set({ hours: p.hours.map((h, j) => (j === i ? { ...h, ...x } : h)) });
  const onSave = async () => {
    setBusy(true); setErr(null);
    try { await save({ ...p, ...(cal ? { calendarId: cal } : {}) }); show(s.saved ? "Saved. The booking page uses it now." : "Saved. Your booking page is open."); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(s.link); show("Booking link copied."); } catch { show(s.link); } };
  const sel = (label: string, value: number, opts: readonly number[], word: (n: number) => string, on: (n: number) => void) => (
    <select className="input bc-sel" aria-label={label} value={value} disabled={off} onChange={(e) => on(Number(e.target.value))}>{opts.map((n) => <option key={n} value={n}>{word(n)}</option>)}</select>
  );
  return (
    <>
      {head}
      {off && <div className="bc-banner"><Banner tone="neutral" icon="info" title="Connect Google Calendar first." text="Leads can only book once your calendar is connected: times already taken on it aren't offered, and each call goes on it with a Google Meet link. Until then the booking page stays off." />
        <ButtonLink variant="primary" to="/settings/calendar" iconEnd={false}>Connect Google Calendar</ButtonLink></div>}
      <fieldset className={`bc-set${off ? " off" : ""}`} disabled={off}>
        <div className="panel bc-panel">
          <span className="wp-eyebrow">The call</span>
          <div className="bc-row"><span className="l"><b>Call length</b><small>How long each booking lasts</small></span>
            <span className="v"><div className="qz-chips">{LENGTHS.map((n) => <button key={n} type="button" className={`qz-chip${p.lengthMin === n ? " on" : ""}`} aria-pressed={p.lengthMin === n} onClick={() => set({ lengthMin: n })}>{n} min</button>)}</div></span></div>
          <div className="bc-row"><span className="l"><b>Buffer between calls</b><small>Time kept free after each call</small></span><span className="v">{sel("Buffer between calls", p.bufferMin, BUFFERS, (n) => (n ? `${n} minutes` : "None"), (n) => set({ bufferMin: n }))}</span></div>
          <div className="bc-row"><span className="l"><b>How far ahead</b><small>Furthest day a lead can pick</small></span><span className="v">{sel("How far ahead", p.aheadDays, AHEAD, (n) => `${n} days`, (n) => set({ aheadDays: n }))}</span></div>
          <div className="bc-row"><span className="l"><b>Shortest notice</b><small>Earliest a lead can book from now</small></span><span className="v">{sel("Shortest notice", p.noticeHours, NOTICE, (n) => `${n} ${n === 1 ? "hour" : "hours"}`, (n) => set({ noticeHours: n }))}</span></div>
        </div>
        <div className="panel bc-panel">
          <span className="wp-eyebrow">Hours offered</span>
          {p.hours.map((h, i) => (
            <div key={i} className="bc-row">
              <span className="l"><b>{DAY_NAMES[i]}</b><small>{h.on ? `${clock(h.start)} – ${clock(h.end)}` : "Not offered"}</small></span>
              <span className="v bc-hours">
                {h.on && <><input className="input" type="time" step={900} aria-label={`${DAY_NAMES[i]} from`} value={h.start} onChange={(e) => setDay(i, { start: e.target.value })} />
                  <span className="secondary">to</span><input className="input" type="time" step={900} aria-label={`${DAY_NAMES[i]} until`} value={h.end} onChange={(e) => setDay(i, { end: e.target.value })} /></>}
                <Toggle checked={h.on} onChange={(on) => setDay(i, { on })} label={`Offer ${DAY_NAMES[i]}`} disabled={off} />
              </span>
            </div>
          ))}
          <p className="wp-small secondary bc-note">Hours are your own time (Central). Leads see them in theirs.</p>
        </div>
        <div className="panel bc-panel">
          <span className="wp-eyebrow">Calendar checked for busy times</span>
          <div className="bc-row"><span className="l"><b>{s.calendar ? `${s.calendar.checkName ?? "Your calendar"} · Google Calendar` : "No calendar connected"}</b><small>Times already taken on this calendar are not offered</small></span>
            <span className="v">{s.calendar && s.calendar.list.length > 1 && <select className="input bc-sel" aria-label="Calendar checked" value={cal} onChange={(e) => setCal(e.target.value)}>{s.calendar.list.map((c) => <option key={c.id} value={c.id}>{c.name}{c.primary ? " (main)" : ""}</option>)}</select>}</span></div>
          {s.calendar?.writeName && <p className="wp-small secondary bc-note">Booked calls go on {s.calendar.writeName}, the calendar picked in Settings › Calendar, with a Google Meet link.</p>}
          {s.readError && <p className="wp-small error bc-note">The last read of your calendar didn't work: {s.readError}</p>}
        </div>
        <div className="panel bc-panel">
          <span className="wp-eyebrow">The link leads get</span>
          {/* Heston (Nov 4, 21:57): an On/Off switch. Off, the page says booking isn't open; booked calls stay as they are. */}
          {s.saved && <div className="bc-row"><span className="l"><b>Booking page</b><small>{s.paused ? "Off: leads see that booking isn't open. Calls already booked stay." : "On: leads can book from the link below"}</small></span>
            <span className="v"><Toggle checked={!s.paused} label="Booking page on" disabled={off} onChange={(on) => { void setPaused({ paused: !on }).then(() => show(on ? "Your booking page is on." : "Your booking page is off.")).catch((e) => setErr(errText(e))); }} /></span></div>}
          <div className="bc-row"><span className="l"><b>Booking link</b><small className="bc-link">{s.link}</small></span><span className="v"><Button size="sm" onClick={() => void copy()} disabled={off}>Copy link</Button></span></div>
          <div className="bc-row"><span className="l"><b>Where leads find it</b><small>The website form's thank-you page, your emails, and the lead's page in Clients</small></span><span className="v">{s.open ? <StatusChip tone="success">Open</StatusChip> : <StatusChip tone="neutral">Off</StatusChip>}</span></div>
        </div>
      </fieldset>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="bc-save"><Button variant="primary" loading={busy} disabled={off} onClick={() => void onSave()}>Save</Button></div>
    </>
  );
}

// ---------- the lead page: Upcoming call ----------

export function UpcomingCall({ dealId }: { dealId: string }) {
  const rows = useQuery(api.calls.forDeal, { dealId });
  const s = useQuery(api.calls.settings, {});
  const [toast, show] = useToast();
  if (rows === undefined) return null;
  const up = rows.filter((r) => r.upcoming);
  const past = rows.filter((r) => !r.upcoming);
  const tz = "America/Chicago";
  const copy = async () => { if (!s) return; try { await navigator.clipboard.writeText(s.link); show("Booking link copied. Paste it into your email."); } catch { show(s.link); } };
  return (
    <Card label="Calls" head={<SectionHead label={up.length ? "Upcoming call" : "Calls"} count={rows.length > 1 ? rows.length : undefined} action={s?.open ? <Button size="sm" variant="ghost" onClick={() => void copy()}>Copy booking link</Button> : undefined} />}>
      {rows.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "calendar" }} title="No call booked." meta={s?.open ? "Send them your booking link." : "Set up Settings › Booking calls to send a booking link."} />
        : [...up, ...past.slice(0, 3)].map((c, i) => (
          <div key={c._id} className="wp-rowwrap">{i > 0 && <Divider />}
            <ListRow className="ilead" lead={{ icon: "calendar" }} title={whenLabel(c.start, c.end, tz).split(" (")[0]}
              meta={["Central Time", c.status === "cancelled" ? "Cancelled by the lead" : c.upcoming ? (c.onCalendar ? "On your calendar · Google Meet" : `Not on your calendar${c.calError ? `: ${c.calError}` : ""}`) : "Past", c.was ? "moved" : null].filter(Boolean).join(" · ")}
              chip={c.status === "cancelled" ? <StatusChip tone="neutral">Cancelled</StatusChip> : c.upcoming ? (c.onCalendar ? <StatusChip tone="success">Synced</StatusChip> : <StatusChip tone="warning">Not synced</StatusChip>) : undefined}
              action={c.upcoming && c.meet ? <a className="btn sm" href={c.meet} target="_blank" rel="noopener noreferrer">Join</a> : undefined} />
            {c.upcoming && c.note && <p className="pj-pad wp-small secondary bc-cnote">“{c.note}”</p>}
          </div>
        ))}
      {toast}
    </Card>
  );
}

/** Dashboard › Needs you: a lead booked, moved or cancelled a call (Q86). Done clears it. */
export function CallNeedRow({ n }: { n: { callId: Id<"calls">; dealId: Id<"deals"> | null; who: string; what: "booked" | "moved" | "cancelled"; start: number; end: number; was: number | null; calError: string | null } }) {
  const done = useMutation(api.calls.done);
  const [busy, setBusy] = useState(false);
  const verb = n.what === "booked" ? "booked a call" : n.what === "moved" ? "moved their call" : "cancelled their call";
  return (
    <ListRow className="ilead" lead={{ icon: "calendar" }} title={`${n.who} ${verb}`}
      meta={`${whenLabel(n.start, n.end, "America/Chicago")}${n.what === "moved" && n.was ? " · moved" : ""}${n.calError && n.what !== "cancelled" ? " · not on your calendar" : ""}`}
      titleChip={<span className="pc-only"><StatusChip tone={n.what === "cancelled" ? "neutral" : "accent"}>{n.what === "booked" ? "Call" : n.what === "moved" ? "Moved" : "Cancelled"}</StatusChip></span>}
      action={<span className="need-acts">
        {n.dealId && <a className="btn sm" {...linkProps(`/clients/deals/${n.dealId}`)}>Open</a>}
        <Button size="sm" variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await done({ callId: n.callId }); } finally { setBusy(false); } }}>Done</Button>
      </span>} />
  );
}
