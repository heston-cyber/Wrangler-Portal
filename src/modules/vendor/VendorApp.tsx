// Phase 3c step 4 · the vendor side of the portal, a third side beside the owner's and the client's (S5 · Phase 3c:
// Home 733:3100, a booking 733:3658, a briefing 733:3985, Decline 732:3285, the "Working for" switcher 734:5189, phones
// 735:4610 / 735:4933). One login across the businesses a vendor works for (D94): the switcher picks one, the portal
// takes on its look, and only its work shows. Invoices, Settings (W-9, payment method) and Review for editors come in
// the next part of step 4.
import { useContext, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ShellFrame, type Item } from "../../shell/Shell";
import { Sep, TopBar } from "../../shell/Shell";
import { useSignOutAsk } from "../../shell/SignOut";
import { Button, ButtonLink, Card, DialogHeader, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows, StatusChip, type Tone } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Menu, MenuItem, Modal, useToast } from "../../ui/kit";
import { linkProps, navigate, useLocation } from "../../lib/router";
import { useBrand } from "../../lib/brand";
import { errText } from "../docs/pages/common";
import { dateShort, money } from "../payments/common";
import { DECLINE_REASONS, dateRange, shortRange, type BookingState } from "../../../convex/lib/bookings";
import { PdfPages } from "../proposals/ClientProposal";
import wpLogo from "../../assets/d1/wp-logo.png";

import { Ctx, type Biz } from "./ctx";
import { InvoiceEditor, VendorInvoice, VendorInvoices, VendorReview, VendorSettings, HomeInvoices } from "./VendorWork";
const KEY = "wr.vendorBiz";
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* private window */ } };

const dollars = (c: number) => (c % 100 === 0 ? `$${(c / 100).toLocaleString("en-US")}` : money(c));
const rateText = (r: { cents: number; unit: "day" | "hour" }) => `${dollars(r.cents)} / ${r.unit}`;
const CHIP: Record<BookingState, [Tone, string]> = { offered: ["danger", "Offered"], accepted: ["success", "Accepted"], declined: ["neutral", "Declined"], cancelled: ["neutral", "Cancelled"], done: ["neutral", "Done"] };
const BookingChip = ({ state }: { state: BookingState }) => <StatusChip tone={CHIP[state][0]}>{CHIP[state][1]}</StatusChip>;
const when = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? "today" : dateShort(t));
const briefText = (b: { readAt: number | null } | null) => (b ? (b.readAt ? "brief read" : "brief to read") : null);

// ---------- the app: the vendor's shell and pages ----------

export default function VendorApp({ me }: { me: { name: string | null; email: string } }) {
  const mine = useQuery(api.vendorPortal.businesses, {});
  const [picked, setPicked] = useState<string | null>(read());
  const list = (mine?.list ?? []) as Biz[];
  const biz = (list.find((b) => b.businessId === picked) ?? list[0])?.businessId ?? null;
  const current = list.find((b) => b.businessId === biz) ?? null;
  useBrand(current);
  const setBiz = (b: Id<"businesses">) => { setPicked(b); write(b); };
  const { path } = useLocation();
  const counts = useQuery(api.vendorPortal.counts, biz ? { businessId: biz } : "skip");
  const reviews = useQuery(api.vendorPortal.reviews, biz ? { businessId: biz } : "skip");
  const starts = (p: string, ...pre: string[]) => pre.some((x) => p === x || p.startsWith(x + "/"));
  const nav = useMemo(() => {
    const home: Item = { to: "/", label: "Home", icon: "home", match: (p) => p === "/" };
    const bookings: Item = { to: "/vendor/bookings", label: "Bookings", icon: "calendar", match: (p) => starts(p, "/vendor/bookings"), badge: counts?.offered || 0 };
    const briefings: Item = { to: "/vendor/briefings", label: "Briefings", icon: "note", match: (p) => starts(p, "/vendor/briefings"), badge: counts?.toRead || 0 };
    const invoices: Item = { to: "/vendor/invoices", label: "Invoices", icon: "invoice", match: (p) => starts(p, "/vendor/invoices") };
    // D93: a booked editor gets Review, with that project (each opens its comment link).
    const rv = reviews?.rows ?? [];
    const review: Item | null = rv.length ? { to: "/vendor/review", label: "Review", icon: "review", match: (p) => p === "/vendor/review", tab: (p) => starts(p, "/vendor/review"),
      layer: rv.map((r) => ({ to: `/s/${r.token}`, label: r.project, match: () => false })), layerHas: (p) => starts(p, "/vendor/review") } : null;
    const more: Item = { to: "/more", label: "More", icon: "menu", match: (p) => starts(p, "/more", "/settings") };
    return { main: [home, bookings, briefings, invoices, ...(review ? [review] : [])], tabs: [home, bookings, briefings, invoices, more] };
  }, [counts?.offered, counts?.toRead, reviews?.rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const ctx = useMemo(() => ({ biz, setBiz, list }), [biz, list]); // eslint-disable-line react-hooks/exhaustive-deps
  if (mine === undefined) return <Loading />;
  if (!list.length) return <EmptyFrame />;
  return (
    <Ctx.Provider value={ctx}>
      <ShellFrame me={me} side="vendor" overlay={false} light logo={current?.logoUrl ?? wpLogo} bizName={current?.name ?? "WranglerPortal"} shared={[]} unread={0} recent={[]} search={false}
        nav={nav} top={<Switcher />}>
        <Routes path={path} me={me} />
      </ShellFrame>
    </Ctx.Provider>
  );
}

function Routes({ path, me }: { path: string; me: { name: string | null; email: string } }) {
  const booking = /^\/vendor\/bookings\/([^/]+)\/?$/.exec(path);
  const brief = /^\/vendor\/briefings\/([^/]+)\/?$/.exec(path);
  if (booking) return <VendorBooking key={booking[1]} bookingId={booking[1]} />;
  if (/^\/vendor\/bookings\/?$/.test(path)) return <VendorBookings />;
  if (brief) return <VendorBriefing key={brief[1]} briefingId={brief[1]} />;
  if (/^\/vendor\/briefings\/?$/.test(path)) return <VendorBriefings />;
  const inv = /^\/vendor\/invoices\/([^/]+)\/?$/.exec(path);
  if (/^\/vendor\/invoices\/new\/?$/.test(path)) return <InvoiceEditor key={location.search} bookingId={new URLSearchParams(location.search).get("booking")} />;
  if (inv) return <VendorInvoice key={inv[1]} invoiceId={inv[1]} />;
  if (/^\/vendor\/invoices\/?$/.test(path)) return <VendorInvoices />;
  if (/^\/vendor\/review\/?$/.test(path)) return <VendorReview />;
  if (/^\/more\/?$/.test(path)) return <VendorMore me={me} />;
  if (path.startsWith("/settings")) return <VendorSettings />;
  return <VendorHome />;
}

const Loading = () => <div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div>;
function EmptyFrame() {
  const [signOut, dialog] = useSignOutAsk();
  return <div className="wp-page"><EmptyState icon="user" title="No work here yet." body="The businesses that invited you will show up here once they've added you. If you think this is wrong, reply to their invite email." actions={<Button onClick={signOut}>Sign out</Button>} />{dialog}</div>;
}

// ---------- the "Working for" switcher (734:5189) ----------

function SwitchRow({ b, on }: { b: Biz; on: boolean }) {
  const c = useQuery(api.vendorPortal.counts, { businessId: b.businessId });
  return <span className="vp-swrow"><span>{b.name}</span>{on ? <Icon name="check" size={14} plain /> : c?.total ? <span className="secondary">{c.total} new</span> : null}</span>;
}
export function Switcher() {
  const { biz, setBiz, list } = useContext(Ctx);
  const current = list.find((b) => b.businessId === biz);
  if (!current) return null;
  if (list.length < 2) return <div className="vp-switch one"><span className="wp-label">Working for</span><b>{current.name}</b></div>;
  return (
    <Menu label="Businesses you work for" trigger={(p) => (
      <button {...p} className="vp-switch" type="button"><span className="wp-label">Working for</span><b>{current.name}</b><Icon name="chevron-down" size={16} /></button>
    )}>
      <div className="mlabel">Businesses you work for</div>
      {list.map((b) => <MenuItem key={b.businessId} onSelect={() => { setBiz(b.businessId); navigate("/"); }}><SwitchRow b={b} on={b.businessId === biz} /></MenuItem>)}
    </Menu>
  );
}

// ---------- Home (733:3100) ----------

function VendorHome() {
  const { biz, list } = useContext(Ctx);
  const others = list.length > 1;
  const h = useQuery(api.vendorPortal.home, biz ? { businessId: biz } : "skip");
  const [declining, setDeclining] = useState<Id<"vendorBookings"> | null>(null);
  const [toast, show] = useToast();
  const accept = useMutation(api.vendorPortal.accept);
  if (!h) return <Loading />;
  const first = h.name.split(" ")[0];
  return (
    <>
      <TopBar><span className="here">Home</span></TopBar>
      <div className="wp-page">
        <div className="vp-phoneswitch"><Switcher /></div>
        <PageHeader eyebrow={h.business} title={`Hi ${first}.`} sub={`Your work with ${h.business}.${others ? " Other businesses you work for are in the switcher, kept separate." : ""}`}
          actions={h.upcoming.length ? <><ButtonLink to="/vendor/invoices/new">Log hours</ButtonLink><ButtonLink variant="primary" to="/vendor/invoices/new">Send an invoice</ButtonLink></> : undefined} />
        <div className="wp-homecols">
          <div className="col">
            {h.offered.map((x) => (
              <Card key={x._id} label="New booking" head={<SectionHead label="New booking" count={h.offered.length > 1 ? undefined : 1} />}>
                <div className="vp-offer">
                  <b>{x.project} · {x.role}</b>
                  <span className="wp-small secondary">{[dateRange(x.start, x.end), x.location, rateText(x.rate)].filter(Boolean).join(" · ")}</span>
                  <span className="vp-acts">
                    <Button variant="primary" onClick={async () => { try { await accept({ bookingId: x._id }); show("Accepted."); } catch (e) { show(errText(e)); } }}>Accept</Button>
                    <Button onClick={() => setDeclining(x._id)}>Decline</Button>
                    <ButtonLink variant="ghost" to={`/vendor/bookings/${x._id}`}>Details</ButtonLink>
                  </span>
                </div>
              </Card>
            ))}
            <Card label="Briefings to read" head={<SectionHead label="Briefings to read" count={h.toRead.length} />}>
              {h.toRead.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "note" }} title="Nothing to read." />
                : h.toRead.map((b, i) => <div key={b._id} className="wp-rowwrap">{i > 0 && <Divider />}
                  <ListRow className="ilead" lead={{ icon: "note" }} to={`/vendor/briefings/${b._id}`} title={b.title} meta={`Sent ${when(b.sentAt)} by ${h.owner}`} chip={<StatusChip tone="danger">New</StatusChip>} chevron /></div>)}
            </Card>
            <Card label="Upcoming" head={<SectionHead label="Upcoming" count={h.upcoming.length} />}>
              {h.upcoming.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "calendar" }} title="Nothing booked yet." />
                : h.upcoming.map((x, i) => <div key={x._id} className="wp-rowwrap">{i > 0 && <Divider />}
                  <ListRow className="ilead" lead={{ icon: "calendar" }} to={`/vendor/bookings/${x._id}`} title={`${x.project} · ${x.role}`} meta={[shortRange(x.start, x.end), x.location, briefText(x.brief) ?? "no brief yet"].filter(Boolean).join(" · ")} chevron /></div>)}
            </Card>
          </div>
          <div className="col right">
            <HomeInvoices />
            <Card label="Your details" head={<SectionHead label="Your details" />}>
              <div className="vd-pad">
                <div className="vd-row"><span>W-9</span>{h.details.w9 ? <StatusChip tone="success">On file</StatusChip> : <StatusChip tone="warning">Missing</StatusChip>}</div>
                <p className="wp-small secondary">{h.details.payMethod ? `Payment details: ${h.details.payMethod}. ` : ""}<a {...linkProps("/settings")}>Change them in Settings</a>.</p>
              </div>
            </Card>
          </div>
        </div>
      </div>
      {declining && <DeclineDialog bookingId={declining} business={h.business} onClose={() => setDeclining(null)} onDone={() => show("Declined.")} />}
      {toast}
    </>
  );
}

// ---------- Decline (732:3285) ----------

function DeclineDialog({ bookingId, business, onClose, onDone }: { bookingId: Id<"vendorBookings">; business: string; onClose: () => void; onDone: () => void }) {
  const decline = useMutation(api.vendorPortal.decline);
  const [reason, setReason] = useState<string>(DECLINE_REASONS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} label="Decline this booking" width={520}>
      <div className="crm-dialog">
        <DialogHeader eyebrow={`Booking · ${business}`} title="Decline this booking?" body={`${business} will see your reason.`} onClose={onClose} />
        <div className="wp-field"><span className="wp-field-label">Reason</span>
          <div className="qz-chips">{DECLINE_REASONS.map((r) => <button key={r} type="button" className={`qz-chip${reason === r ? " on" : ""}`} aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)}</div></div>
        <label className="wp-field"><span className="wp-field-label">Anything to add (optional)</span><textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); setErr(null); try { await decline({ bookingId, reason, ...(note.trim() ? { note } : {}) }); onClose(); onDone(); } catch (e) { setErr(errText(e)); setBusy(false); } }}>Decline booking</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Bookings ----------

type Pill = "offered" | "upcoming" | "done" | "declined";
const inPill = (s: BookingState, p: Pill) => (p === "upcoming" ? s === "accepted" : p === "declined" ? s === "declined" || s === "cancelled" : s === p);
function VendorBookings() {
  const { biz } = useContext(Ctx);
  const r = useQuery(api.vendorPortal.bookings, biz ? { businessId: biz } : "skip");
  const [picked, setPill] = useState<Pill | null>(null);
  if (!r) return <Loading />;
  const count = (p: Pill) => r.rows.filter((x) => inPill(x.state, p)).length;
  const pill: Pill = picked ?? (count("offered") ? "offered" : "upcoming");
  const shown = r.rows.filter((x) => inPill(x.state, pill));
  if (pill === "done" || pill === "declined") shown.reverse();
  return (
    <>
      <TopBar><span className="here">Bookings</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow="Bookings" title="Bookings." sub="Work you've been offered and booked for." />
        {r.rows.length === 0 ? <EmptyState icon="calendar" title="No bookings yet." body="When you're offered work, it shows up here and in your email." /> : <>
          <PillTabs label="Show" value={pill} onChange={setPill} items={[{ key: "offered", label: "Offered", count: count("offered") }, { key: "upcoming", label: "Upcoming", count: count("upcoming") }, { key: "done", label: "Done", count: count("done") }, { key: "declined", label: "Declined", count: count("declined") }]} />
          <Card label="Bookings">
            {shown.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "calendar" }} title="None here." />
              : shown.map((x, i) => <div key={x._id} className="wp-rowwrap">{i > 0 && <Divider />}
                <ListRow className="ilead" lead={{ icon: "calendar" }} to={`/vendor/bookings/${x._id}`} title={`${x.project} · ${x.role}`} meta={[shortRange(x.start, x.end), rateText(x.rate), x.state === "offered" ? `offered ${when(x.offeredAt)}` : briefText(x.brief)].filter(Boolean).join(" · ")} chip={<BookingChip state={x.state} />} chevron /></div>)}
          </Card>
        </>}
      </div>
    </>
  );
}

// ---------- a booking (733:3658) ----------

function VendorBooking({ bookingId }: { bookingId: string }) {
  const { biz, setBiz } = useContext(Ctx);
  const x = useQuery(api.vendorPortal.booking, { bookingId });
  const accept = useMutation(api.vendorPortal.accept);
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  useEffect(() => { if (x && x.businessId !== biz) setBiz(x.businessId); }, [x?.businessId]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = <TopBar><a {...linkProps("/vendor/bookings")}>Bookings</a>{x && <><Sep /><span className="here">{x.projectName}</span></>}</TopBar>;
  if (x === undefined) return <>{top}<Loading /></>;
  if (x === null) return <>{top}<div className="wp-page"><EmptyState icon="calendar" title="This booking isn't here." body="It may be for another login, or the business took you off its list." actions={<ButtonLink to="/vendor/bookings">Your bookings</ButtonLink>} /></div></>;
  const ownerFirst = x.owner.split(" ")[0];
  return (
    <>
      {top}
      <div className="wp-page">
        <PageHeader eyebrow={`${x.state === "offered" ? "Booking offer" : "Booking"} · ${x.business}`} title={`${x.projectName}.`} sub={`Offered ${dateShort(x.offeredAt)} by ${x.owner}`} actions={<BookingChip state={x.state} />} />
        <div className="wp-homecols">
          <div className="col">
            <Card label="The job" head={<SectionHead label="The job" />}>
              <dl className="cp-see">
                <dt>Project</dt><dd>{x.project}</dd>
                <dt>Role</dt><dd>{x.role}</dd>
                <dt>Dates</dt><dd>{dateRange(x.start, x.end)}{x.days > 1 ? ` (${x.days} days)` : ""}</dd>
                {x.location && <><dt>Location</dt><dd>{x.location}</dd></>}
                <dt>Agreed rate</dt><dd>{rateText(x.rate)}</dd>
                {x.hours !== null && <><dt>Hours expected</dt><dd>{x.hours}</dd></>}
                <dt>Expected total</dt><dd>{money(x.expectedCents)}</dd>
              </dl>
            </Card>
            {x.note && <Card label={`Note from ${ownerFirst}`} head={<SectionHead label={`Note from ${ownerFirst}`} />}><p className="wp-body vd-pad">{x.note}</p></Card>}
            <Card label="Briefing" head={<SectionHead label="Briefing" />}>
              {x.brief ? <ListRow className="ilead" lead={{ icon: "note" }} to={`/vendor/briefings/${x.brief._id}`} title="Read the brief" meta={x.brief.readAt ? `You read it ${dateShort(x.brief.readAt)}` : `Sent ${when(x.brief.sentAt ?? Date.now())}`} chip={x.brief.readAt ? undefined : <StatusChip tone="danger">New</StatusChip>} chevron />
                : <p className="wp-small secondary vd-pad">Not sent yet. You'll get an email when it is.</p>}
            </Card>
          </div>
          <div className="col right">
            <Card label="Your answer" head={<SectionHead label="Your answer" />}>
              <div className="vd-pad vp-answer">
                {x.state === "offered" ? <>
                  <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await accept({ bookingId: x._id }); show("Accepted."); } catch (e) { show(errText(e)); } finally { setBusy(false); } }}>Accept booking</Button>
                  <Button onClick={() => setDeclining(true)}>Decline</Button>
                  <p className="wp-small secondary">Accepting adds it to your Upcoming and to {ownerFirst}'s crew list.</p>
                </> : x.state === "declined" ? <p className="wp-body">You declined it {x.answeredAt ? dateShort(x.answeredAt) : ""}{x.declineReason ? `: “${x.declineReason}”` : "."}</p>
                  : x.state === "cancelled" ? <p className="wp-body">{x.business} cancelled this booking.</p>
                  : <p className="wp-body">You accepted it {x.answeredAt ? dateShort(x.answeredAt) : ""}. {x.state === "done" ? "It's done." : "It's in your Upcoming."}</p>}
              </div>
            </Card>
          </div>
        </div>
      </div>
      {declining && <DeclineDialog bookingId={x._id} business={x.business} onClose={() => setDeclining(false)} onDone={() => show("Declined.")} />}
      {toast}
    </>
  );
}

// ---------- Briefings, and a briefing (733:3985) ----------

function VendorBriefings() {
  const { biz } = useContext(Ctx);
  const r = useQuery(api.vendorPortal.briefings, biz ? { businessId: biz } : "skip");
  if (!r) return <Loading />;
  return (
    <>
      <TopBar><span className="here">Briefings</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow="Briefings" title="Briefings." sub="Shoot and edit briefs for the work you're booked on." />
        {r.rows.length === 0 ? <EmptyState icon="note" title="No briefings yet." body="When a brief is sent to you, it shows up here and in your email." /> : (
          <Card label="Briefings">
            {r.rows.map((b, i) => <div key={b._id} className="wp-rowwrap">{i > 0 && <Divider />}
              <ListRow className="ilead" lead={{ icon: "note" }} to={`/vendor/briefings/${b._id}`} title={b.title} meta={[b.role, b.start && b.end ? shortRange(b.start, b.end) : null, `sent ${when(b.sentAt)}`, b.readAt ? `read ${when(b.readAt)}` : null].filter(Boolean).join(" · ")} chip={b.readAt ? <StatusChip tone="success">Read</StatusChip> : <StatusChip tone="danger">New</StatusChip>} chevron /></div>)}
          </Card>
        )}
      </div>
    </>
  );
}

function VendorBriefing({ briefingId }: { briefingId: string }) {
  const { biz, setBiz } = useContext(Ctx);
  const b = useQuery(api.vendorPortal.briefing, { briefingId });
  const markRead = useMutation(api.vendorPortal.markRead);
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  useEffect(() => { if (b && b.businessId !== biz) setBiz(b.businessId); }, [b?.businessId]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = <TopBar right={b?.pdfUrl ? <a className="btn sm" href={b.pdfUrl} target="_blank" rel="noopener noreferrer" download>Download PDF</a> : undefined}><a {...linkProps("/vendor/briefings")}>Briefings</a>{b && <><Sep /><span className="here">{b.title}</span></>}</TopBar>;
  if (b === undefined) return <>{top}<Loading /></>;
  if (b === null) return <>{top}<div className="wp-page"><EmptyState icon="note" title="This briefing isn't here." body="It may be for another login, or the business took you off its list." actions={<ButtonLink to="/vendor/briefings">Your briefings</ButtonLink>} /></div></>;
  const ownerFirst = b.owner.split(" ")[0];
  return (
    <>
      {top}
      <div className="wp-page">
        <PageHeader eyebrow={`Briefing · ${b.business}`} title={`${b.kind}.`} sub={[b.project, b.role, b.start && b.end ? shortRange(b.start, b.end) : null, `sent ${dateShort(b.sentAt)}`].filter(Boolean).join(" · ")} actions={b.readAt ? <StatusChip tone="success">Read</StatusChip> : <StatusChip tone="danger">New</StatusChip>} />
        <div className="vp-briefcols">
          {b.pdfUrl ? <PdfPages url={b.pdfUrl} title={b.title} /> : <Card label="Briefing"><p className="vd-pad">The brief couldn't be shown.</p></Card>}
          <Card label="Read it?" head={<SectionHead label="Read it?" />}>
            <div className="vd-pad vp-answer">
              <p className="wp-small">Let {ownerFirst} know you've read the brief. Questions? Reply to the email.</p>
              {b.readAt ? <Button disabled>Read {dateShort(b.readAt)}</Button>
                : <Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { await markRead({ briefingId: b._id }); show(`${ownerFirst} can see you've read it.`); } catch (e) { show(errText(e)); } finally { setBusy(false); } }}>I've read it</Button>}
            </div>
          </Card>
        </div>
      </div>
      {toast}
    </>
  );
}

// ---------- More (phones) ----------

function VendorMore({ me }: { me: { name: string | null; email: string } }) {
  const [signOut, dialog] = useSignOutAsk();
  return (
    <div className="wp-page">
      <PageHeader title={me.name ?? me.email} sub={me.email} />
      <div className="vp-phoneswitch"><Switcher /></div>
      <Card label="More">
        <ListRow className="ilead" lead={{ icon: "settings" }} to="/settings" title="Settings" meta="Your account" chevron />
        <Divider />
        <ListRow className="ilead" lead={{ icon: "sign-out" }} onClick={signOut} title="Sign out" />
      </Card>
      {dialog}
    </div>
  );
}
