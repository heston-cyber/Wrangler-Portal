// Phase 5b step 1 (Nov 3): Production › Overview (760:637; Empty 763:519; Loading 763:1067; Long 763:1713; phone
// 769:6647, 771:8608, 771:8851) and Production › Shoots (763:2708). Step 3 added call sheets: the fourth tile, the Call
// sheets card, each shoot's sheet chip and button, "Needs a call sheet". Step 5: the Google Calendar card's Last synced
// and Sync now, and Production › Calendar (Calendar.tsx).
import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, DialogHeader, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { sheetBits } from "./sheetBits";
import { ShootDialog, clock, shootDay } from "../projects/Shoots";

type Overview = NonNullable<ReturnType<typeof useQuery<typeof api.production.overview>>>;
type ShootRow = Overview["shoots"][number];
type Edit = Overview["edits"][number];

const day = (ymd: string, today: string) => (ymd === today ? "Today" : shootDay(ymd));
const dayLong = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const plural = (n: number, one: string, many = `${one}s`) => `${n === 1 ? one : many}`;
const shootTitle = (s: ShootRow) => (s.client ? `${s.project} · ${s.client}` : s.label);
const editMeta = (e: Edit) => [e.round ? `Round ${e.round}` : null, e.nextStep ?? (e.next ? `${e.next.label} ${shootDay(e.next.date).replace(/^\w+, /, "")}` : null)].filter(Boolean).join(" · ");

// Phase 5b step 5: the Google Calendar card's Last synced and Sync now.
function lastSynced(t: number | null) {
  if (!t) return "Not yet";
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? "Just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function SyncNow() {
  const sync = useAction(api.calendarSync.syncNow);
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  return <div className="prod-sync"><Button size="sm" loading={busy} onClick={async () => { setBusy(true); try { const r = await sync({}); show(r.state === "ok" ? "Synced." : r.state === "disconnected" ? "Google disconnected. Reconnect Google." : r.state === "busy" ? "Already syncing." : "Google didn't answer. Try again in a minute."); } catch (e) { show(errText(e)); } finally { setBusy(false); } }}>Sync now</Button>{toast}</div>;
}

function Tile({ label, n, sub, to, link }: { label: string; n: number; sub: string; to: string; link: string }) {
  return (
    <div className="pov-stat prod-tile">
      <span className="lbl">{label}</span>
      <b>{n}</b>
      <span className="sub">{sub}</span>
      <a {...linkProps(to)} className="go">{link}<Icon name="arrow-right" size={14} /></a>
    </div>
  );
}

function ShootLine({ s, today, first, phone, onSheet }: { s: ShootRow; today: string; first: boolean; phone?: boolean; onSheet?: boolean }) {
  const b = sheetBits(s, today);
  return (
    <div className="wp-rowwrap">{!first && <Divider />}
      <ListRow className="ilead ovact" lead={{ icon: "video" }} to={b.sent ? b.href : `/projects/${s.projectId}`} chevron={phone || b.sent}
        title={shootTitle(s)}
        meta={[day(s.date, today), `Call ${clock(s.call)}`, s.location, onSheet && s.sheet ? `${s.sheet.people} on the sheet` : null].filter(Boolean).join(" · ")}
        chip={b.chip} action={b.action} />
    </div>
  );
}

function EditLine({ e, first }: { e: Edit; first: boolean }) {
  return (
    <div className="wp-rowwrap">{!first && <Divider />}
      <ListRow className="ilead" lead={{ icon: "review" }} to={`/projects/${e._id}`} chevron title={e.label} meta={editMeta(e) || undefined}
        chip={<StatusChip tone={e.stage === "production" ? "accent" : "neutral"}>{e.stage === "production" ? "Production" : "Polish"}</StatusChip>} />
    </div>
  );
}

export function NewShoot({ onClose }: { onClose: () => void }) {
  const projects = useQuery(api.production.projectsForShoot, {});
  const [pid, setPid] = useState<string>("");
  const [picked, setPicked] = useState<{ _id: Id<"projects">; label: string; client: string | null } | null>(null);
  const data = useQuery(api.shoots.forProject, picked ? { projectId: picked._id } : "skip");
  const [toast, show] = useToast();
  if (picked && data) return <>{<ShootDialog projectId={picked._id} label={picked.label} data={data} shoot={null} client={picked.client} people={data.people} onClose={onClose} show={show} />}{toast}</>;
  return (
    <Modal onClose={onClose} label="New shoot" width={480}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Production" title="New shoot." body="Which project is it for?" onClose={onClose} />
        {projects === undefined ? <SkeletonRows n={2} />
          : projects.length === 0 ? <p className="secondary">No open projects yet. Start one from a client first.</p>
          : <label className="wp-field"><span className="wp-field-label">Project</span>
            <select className="input" value={pid} onChange={(e) => setPid(e.target.value)}>
              <option value="">Choose a project</option>
              {projects.map((p) => <option key={p._id} value={p._id}>{p.client ? `${p.label} · ${p.client}` : p.label}</option>)}
            </select></label>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" disabled={!pid} onClick={() => { const p = projects?.find((x) => x._id === pid); if (p) setPicked(p); }}>Next</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function ProductionOverview() {
  const o = useQuery(api.production.overview, {});
  const [adding, setAdding] = useState(false);
  const empty = o && o.shootsTotal === 0 && o.edits.length === 0;
  return (
    <>
      <TopBar><span className="secondary">Production</span><Sep /><span className="here">Overview</span></TopBar>
      <div className="wp-page pov prod">
        <PageHeader eyebrow="Production" title="Production." sub="Live shoots and edits, at a glance." actions={<ButtonLink variant="primary" to="/production/call-sheets/new" iconEnd={false}>New call sheet</ButtonLink>} />
        {o === undefined ? <>
          <div className="pov-stats prod-tiles">{[0, 1, 2, 3].map((i) => <div key={i} className="pov-stat prod-tile"><SkeletonRows n={1} /></div>)}</div>
          <Card label="Loading"><SkeletonRows n={4} /></Card>
        </>
          : o === null ? null
          : empty ? <EmptyState icon="video" title="Nothing in production yet"
              body="Shoots and live edits show up here once a project has a shoot date or reaches Production. You can also connect Google Calendar to see your own events next to them."
              actions={<><Button variant="primary" onClick={() => setAdding(true)}>New shoot</Button>{!o.calendar && <ButtonLink to="/settings/calendar" iconEnd={false}>Connect Google Calendar</ButtonLink>}</>} />
          : <>
            <div className="pov-stats prod-tiles">
              <Tile label="Today" n={o.tiles.today} sub={o.tiles.todayFirst ? `${plural(o.tiles.today, "shoot")} · ${o.tiles.todayFirst.client ?? o.tiles.todayFirst.project}` : "no shoots"}
                to={o.tiles.todayFirst ? `/projects/${o.tiles.todayFirst.projectId}` : "/production/shoots?show=today"} link={o.tiles.todayFirst ? "Open shoot" : "See shoots"} />
              <Tile label="This week" n={o.tiles.week} sub={`${plural(o.tiles.week, "shoot")}${o.tiles.weekNoSheet ? `, ${o.tiles.weekNoSheet} without a call sheet` : ""}`} to="/production/shoots" link="See shoots" />
              <Tile label="Live edits" n={o.tiles.edits} sub="in Production or Polish" to="/review" link="See edits" />
              <Tile label="Call sheets" n={o.callSheets.notSent} sub="not sent yet" to="/production/call-sheets" link={o.callSheets.notSent ? "Write them" : "See them"} />
            </div>
            <div className="pov-cols">
              <div className="col">
                <Card label="Shoots" head={<SectionHead label="Shoots" count={o.shootsTotal || undefined} action={<ButtonLink size="sm" variant="ghost" to="/production/shoots" iconEnd={false}>See all</ButtonLink>} />}>
                  {o.shoots.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "video" }} title="No shoots coming up." action={<Button size="sm" onClick={() => setAdding(true)}>New shoot</Button>} />
                    : o.shoots.map((s, i) => <ShootLine key={s._id} s={s} today={o.today} first={i === 0} />)}
                </Card>
                <Card label="Live edits" head={<SectionHead label="Live edits" count={o.edits.length || undefined} action={<ButtonLink size="sm" variant="ghost" to="/review" iconEnd={false}>See all</ButtonLink>} />}>
                  {o.edits.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "review" }} title="No projects in Production or Polish." />
                    : o.edits.map((e, i) => <EditLine key={e._id} e={e} first={i === 0} />)}
                </Card>
              </div>
              <div className="col">
                <Card label="This week" head={<SectionHead label="This week" />}>
                  {o.week.length === 0 ? <p className="pj-pad secondary">Nothing on this week.</p>
                    : <dl className="pov-paid prod-week">{o.week.map((w, i) => <div key={i} style={{ display: "contents" }}><dt>{dayLong(w.date)}</dt><dd><a {...linkProps(`/projects/${w.projectId}`)}>{w.text}</a></dd></div>)}</dl>}
                </Card>
                <Card label="Google Calendar" head={<SectionHead label="Google Calendar" action={<ButtonLink size="sm" variant="ghost" to="/production/calendar" iconEnd={false}>Open calendar</ButtonLink>} />}>
                  {o.calendar ? <><dl className="pov-paid prod-week">
                    <dt>{o.calendar.disconnected ? "Disconnected" : o.calendar.error ? "Needs reconnecting" : "Connected"}</dt><dd>{o.calendar.email}</dd>
                    {o.calendar.calendar && <><dt>Shoots go on</dt><dd>{o.calendar.calendar}</dd></>}
                    <dt>Last synced</dt><dd>{lastSynced(o.calendar.lastSyncedAt)}</dd>
                  </dl>{!o.calendar.disconnected ? <SyncNow /> : <div className="prod-sync"><ButtonLink size="sm" to="/production/calendar" iconEnd={false}>Reconnect Google</ButtonLink></div>}</>
                    : <ListRow className="ilead quiet" lead={{ icon: "calendar" }} title="Not connected." meta="See your own events next to your shoots." action={<ButtonLink size="sm" to="/settings/calendar" iconEnd={false}>Connect</ButtonLink>} />}
                </Card>
                <Card label="Call sheets" head={<SectionHead label="Call sheets" action={<ButtonLink size="sm" variant="ghost" to="/production/call-sheets" iconEnd={false}>All call sheets</ButtonLink>} />}>
                  <dl className="pov-paid prod-week">
                    <dt>Not sent</dt><dd>{o.callSheets.notSent}</dd><dt>Sent this week</dt><dd>{o.callSheets.sentWeek}</dd>
                    <dt>Saved templates</dt><dd><a {...linkProps("/production/call-sheets?tab=templates")}>{o.callSheets.templates}</a></dd>
                  </dl>
                </Card>
              </div>
            </div>
          </>}
      </div>
      {adding && <NewShoot onClose={() => setAdding(false)} />}
    </>
  );
}

type Show = "upcoming" | "today" | "past" | "needs";

export function ProductionShoots() {
  const d = useQuery(api.production.shoots, {});
  const first = new URLSearchParams(location.search).get("show");
  const [show, setShow] = useState<Show>(first === "today" || first === "past" || first === "needs" ? first : "upcoming");
  const [adding, setAdding] = useState(false);
  const rows = !d ? [] : show === "past" ? d.past : show === "today" ? d.upcoming.filter((s) => s.date === d.today) : show === "needs" ? d.upcoming.filter((s) => s.sheet?.state !== "sent") : d.upcoming;
  return (
    <>
      <TopBar><span className="secondary">Production</span><Sep /><span className="here">Shoots</span></TopBar>
      <div className="wp-page prod">
        <PageHeader eyebrow="Production" title="Shoots." sub="Every shoot, with its call sheet." actions={<Button variant="primary" onClick={() => setAdding(true)}>New shoot</Button>} />
        {d === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card> : d === null ? null : <>
          <PillTabs label="Which shoots" value={show} onChange={setShow} items={[
            { key: "upcoming", label: "Upcoming", count: d.upcoming.length },
            { key: "today", label: "Today", count: d.upcoming.filter((s) => s.date === d.today).length },
            { key: "past", label: "Past", count: d.pastTotal },
            { key: "needs", label: "Needs a call sheet", count: d.needsSheet },
          ]} />
          {rows.length === 0 ? <EmptyState icon="video" title={show === "past" ? "No past shoots." : show === "today" ? "No shoots today." : show === "needs" ? "Every shoot coming up has its call sheet." : "No shoots coming up."}
              actions={show === "past" ? undefined : <Button variant="primary" onClick={() => setAdding(true)}>New shoot</Button>} />
            : <Card label="Shoots">{rows.map((s, i) => <ShootLine key={s._id} s={s} today={d.today} first={i === 0} onSheet />)}</Card>}
        </>}
      </div>
      {adding && <NewShoot onClose={() => setAdding(false)} />}
    </>
  );
}

// D150 (Heston, Nov 4): Production › Delivery, a placeholder. Later: the catalog of each client's stored media.
export function ProductionDelivery() {
  return (
    <>
      <TopBar><a {...linkProps("/production")}>Production</a><Sep /><span className="here">Delivery</span></TopBar>
      <div className="wp-page prod">
        <PageHeader eyebrow="Production · Delivery" title="Delivery." sub="Coming soon." />
        <EmptyState icon="folder" title="Coming soon." body="This will be the catalog of the media you store for each client: finished videos, raw footage and stills, ready to find and send." />
      </div>
    </>
  );
}
