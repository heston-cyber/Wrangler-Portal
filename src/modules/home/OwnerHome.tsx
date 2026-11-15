// The back-office Home (P1 / Owner / Home, page "S5 · Phase 1"): what needs you today, your clients, and recent
// activity across Review, Docs and the Inbox.
import { CallNeedRow } from "../calls/Calls";
import { money } from "../payments/common";
import { Suspense, lazy, useState } from "react";
import { sheetBits } from "../production/sheetBits";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { SwRow } from "../settings/SiteWatch";
import { CreateMenu } from "./CreateMenu";
import { Button, ButtonLink, Card, Divider, EmptyState, InboxItem, ListRow, PageHeader, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import type { IconName } from "../../ui/Icon";
import { useToast } from "../../ui/kit";
import { errText } from "../docs/pages/common";
import { TopBar } from "../../shell/Shell";
import { Tile } from "../overviews/Tile";
import { clock, shootDay } from "../projects/Shoots";
import { FollowUpRow } from "../crm/common";
import { DEFAULT_TOOLS, type Tools, type WidgetKey } from "../../../convex/lib/tools";
import { OutstandingCard, RevenueYearCard } from "../payments/ReportsWidgets";

// Phase 2b: monthly recurring and any past-due subscription (loaded with the Payments code).
const Recurring = lazy(() => import("../payments/PaymentsOverview").then((m) => ({ default: m.Recurring })));

const TZ = "America/Chicago";
const first = (who: string) => who.trim().split(/\s+/)[0] || who;
const ymd = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: TZ });
const monthDay = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const DAY = 86_400_000;

/** "today", "yesterday", "Oct 26": for the line under a row. */
function dayWord(t: number, now = Date.now()) {
  if (ymd(t) === ymd(now)) return "today";
  if (ymd(t) === ymd(now - DAY)) return "yesterday";
  return monthDay(t);
}
/** "10 min", "1h", "Yesterday", "Oct 20": the time on a Recent activity row. */
export function activityWhen(t: number, now = Date.now()) {
  const m = Math.max(0, (now - t) / 60_000);
  if (m < 1) return "Just now";
  if (m < 60) return `${Math.round(m)} min`;
  if (ymd(t) === ymd(now)) return `${Math.round(m / 60)}h`;
  if (ymd(t) === ymd(now - DAY)) return "Yesterday";
  return monthDay(t);
}

type Need = NonNullable<ReturnType<typeof useQuery<typeof api.home.needs>>>[number];
type Recent = NonNullable<ReturnType<typeof useQuery<typeof api.activity.recent>>>[number];
type ClientRow = NonNullable<ReturnType<typeof useQuery<typeof api.clients.directory>>>[number];

const VERB = { approve: "approve", send: "send", cancel: "cancel signing of" } as const;

function NeedRow({ n, remind }: { n: Need; remind: (n: Extract<Need, { kind: "doc" }>) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  if (n.kind === "notes") {
    return (
      <ListRow lead={{ avatar: n.who, two: true }} title={`${n.count} new note${n.count === 1 ? "" : "s"} from ${first(n.who)}`}
        meta={`${n.video} · v${n.version} · ${dayWord(n.at)}`}
        action={<ButtonLink size="sm" to={`/v/${n.videoId}?version=${n.version}`}>Open</ButtonLink>} />
    );
  }
  if (n.kind === "doc") {
    const days = Math.floor((Date.now() - n.sentAt) / DAY);
    const dayText = days >= 1 ? `${days} day${days === 1 ? "" : "s"}` : null;
    return (
      <ListRow className="ilead" lead={{ icon: "sign" }}
        title={<><span className="pc-only">{n.title} waiting on {n.waitingOn.map(first).join(" and ")}</span><span className="ph-only">{n.title} waiting</span></>}
        meta={<><span className="pc-only">{n.label} · sent {monthDay(n.sentAt)}{n.client ? ` · ${n.client}` : ""}</span><span className="ph-only">{n.label} · on {n.waitingOn.map(first).join(" and ")}{dayText ? ` · ${dayText}` : ""}</span></>}
        chip={dayText ? <span className="pc-only"><StatusChip tone="warning">{dayText}</StatusChip></span> : undefined}
        action={<Button size="sm" loading={busy} onClick={async () => { setBusy(true); try { await remind(n); } finally { setBusy(false); } }}>Remind</Button>} />
    );
  }
  if (n.kind === "quote") {
    return (
      <ListRow className="ilead" lead={{ icon: n.what === "accepted" ? "check-circle" : "close" }}
        title={`${first(n.who)} ${n.what} quote ${n.number}`} meta={`${n.company} · ${n.title} · ${dayWord(n.at)}`}
        titleChip={<span className="pc-only"><StatusChip tone={n.what === "accepted" ? "success" : "danger"}>{n.what === "accepted" ? "Accepted" : "Declined"}</StatusChip></span>}
        action={<ButtonLink size="sm" variant={n.what === "accepted" ? "primary" : "secondary"} to={`/payments/quotes/${n.quoteId}`}>Open</ButtonLink>} />
    );
  }
  if (n.kind === "vendorInvoice") { // Phase 3c: a vendor's invoice to approve (email 26), until it's approved or declined
    return (
      <ListRow className="ilead" lead={{ icon: "invoice" }} title={`${n.vendor} sent invoice ${n.number}`} meta={`${n.project} · ${money(n.totalCents)} · ${dayWord(n.at)}`}
        titleChip={<span className="pc-only"><StatusChip tone="warning">To approve</StatusChip></span>}
        action={<ButtonLink size="sm" variant="primary" to={`/vendors/payments/${n.invoiceId}`}>Review it</ButtonLink>} />
    );
  }
  if (n.kind === "proposal") { // Phase 3b: an answered proposal, until the contract starts / Not now, or it's seen
    return (
      <ListRow className="ilead" lead={{ icon: n.what === "accepted" ? "check-circle" : "close" }}
        title={`${first(n.who)} ${n.what} proposal ${n.number}`} meta={`${n.company} · ${n.title} · ${dayWord(n.at)}`}
        titleChip={<span className="pc-only"><StatusChip tone={n.what === "accepted" ? "success" : "danger"}>{n.what === "accepted" ? "Accepted" : "Declined"}</StatusChip></span>}
        action={<ButtonLink size="sm" variant={n.what === "accepted" ? "primary" : "secondary"} to={`/proposals/${n.proposalId}`}>{n.what === "accepted" ? "Start the contract" : "Open"}</ButtonLink>} />
    );
  }
  if (n.kind === "footage") { // Phase 5: a storage invoice draft to send, or raw footage past its keep date
    const c = n.client ?? "A client";
    const t = { kept: `${c} is keeping their raw footage`, renewal: "Raw footage storage renews soon", ended: `${c} didn't keep their raw footage`, unpaid: `${c}'s storage invoice isn't paid`, paidLate: `${c} paid for storage after it ended` }[n.what];
    const meta = { kept: "an invoice draft to check and send", renewal: "an invoice draft to check and send", ended: "delete or move it when you're ready; the portal never deletes files", unpaid: "the keep date has passed: remind them, or void the invoice", paidLate: "keep it for a year, or refund it in Stripe" }[n.what];
    const chip = { kept: "To send", renewal: "To send", ended: "Keep date", unpaid: "Not paid", paidLate: "Paid late" }[n.what];
    return (
      <ListRow className="ilead" lead={{ icon: n.what === "kept" || n.what === "renewal" ? "invoice" : "alert" }} title={t}
        meta={`${n.project} · ${meta}`}
        titleChip={<span className="pc-only"><StatusChip tone="warning">{chip}</StatusChip></span>}
        action={<ButtonLink size="sm" variant="primary" to={`/projects/${n.projectId}?tab=delivery`}>Open</ButtonLink>} />
    );
  }
  if (n.kind === "testimonial") { // Phase 5: a testimonial not read yet
    return (
      <ListRow className="ilead" lead={{ icon: "note" }} title={`${n.who} sent a few words`} meta={`${n.project} · ${dayWord(n.at)}`}
        titleChip={<span className="pc-only"><StatusChip tone="accent">New</StatusChip></span>}
        action={<ButtonLink size="sm" variant="primary" to="/clients/testimonials">Read</ButtonLink>} />
    );
  }
  if (n.kind === "weatherChanged") { // D148: a sent call sheet's forecast changed; readers still have the sent line, nobody was emailed
    return (
      <ListRow className="ilead" lead={{ icon: "calendar" }}
        title={<><span className="pc-only">Weather changed for {n.title}: Send an update</span><span className="ph-only">Weather changed</span></>}
        meta={`${shootDay(n.date)} · now ${n.line}${n.was ? ` (was ${n.was})` : ""} · nobody was emailed`}
        titleChip={<span className="pc-only"><StatusChip tone="warning">Weather</StatusChip></span>}
        action={<ButtonLink size="sm" variant="primary" to={`/production/call-sheets/${n.callSheetId}?update=1`}>Send an update</ButtonLink>} />
    );
  }
  if (n.kind === "call") return <CallNeedRow n={n} />; // Phase 5d (Q86): a lead booked, moved or cancelled a call
  if (n.kind === "shootMoved") return <ShootMovedRow n={n} />; // Phase 5b step 5 (D143): moved in Google Calendar, nobody emailed
  if (n.kind === "draft") {
    return (
      <ListRow className="ilead" lead={{ icon: "mail" }}
        title={<><span className="pc-only">Note drafted by Claude: confirm to send</span><span className="ph-only">Note drafted by Claude</span></>}
        titleChip={<span className="pc-only"><StatusChip tone="accent">Draft</StatusChip></span>}
        meta={<><span className="pc-only">To {n.client ?? "a client"} · “{n.title}”</span><span className="ph-only">Confirm to send · {n.client ?? "a client"}</span></>}
        action={<ButtonLink size="sm" variant="primary" to={`/sent/new?note=${n.noteId}`}>Review</ButtonLink>} />
    );
  }
  return (
    <ListRow className="ilead" lead={{ icon: "sign" }} title={`Claude asks to ${VERB[n.what]} ${n.label}: confirm`}
      meta={`${n.title} · nothing happens unless you confirm`}
      action={<ButtonLink size="sm" variant="primary" to={`/sign/d/${n.documentId}`}>Review</ButtonLink>} />
  );
}

/** Phase 5b step 5 (D143): a shoot someone moved in Google Calendar. The portal moved it too and emailed nobody: the
 *  owner tells the crew (the call sheet's Send an update) and the client (Ask to confirm: the portal's usual move
 *  message, Inbox and email 30), or presses Done. */
function ShootMovedRow({ n }: { n: Extract<Need, { kind: "shootMoved" }> }) {
  const ask = useMutation(api.calendarSync.askConfirmAgain);
  const done = useMutation(api.calendarSync.shootMoveDone);
  const [busy, setBusy] = useState<"ask" | "done" | null>(null);
  const [toast, show] = useToast();
  const run = async (k: "ask" | "done") => { setBusy(k); try { if (k === "ask") { const r = await ask({ shootId: n.shootId }); show(r.told ? `Asked ${r.told === 1 ? "the client" : `${r.told} people`} to confirm.` : "Done."); } else await done({ shootId: n.shootId }); } catch (e) { show(errText(e)); } finally { setBusy(null); } };
  const who = [n.crew ? "the crew" : null, n.people ? "the client" : null].filter(Boolean).join(" and ") || "anyone coming";
  // Review fix H2: the other way round: someone changed it in Google, but the portal's later change won and was written
  // back over it (nobody was emailed). Nothing moved, so there's only Done.
  if (n.kept) return (
    <ListRow className="ilead" lead={{ icon: "calendar" }}
      title={<><span className="pc-only">A Google Calendar change to a shoot was put back</span><span className="ph-only">Google change put back</span></>}
      meta={`${n.project} · Google had ${shootDay(n.wasDate)} ${clock(n.wasCall)}; your later change in the portal (${shootDay(n.date)} ${clock(n.call)}) is on Google now · nobody was emailed`}
      titleChip={<span className="pc-only"><StatusChip tone="warning">Put back</StatusChip></span>}
      action={<span className="need-acts">
        <Button size="sm" variant="primary" loading={busy === "done"} onClick={() => run("done")}>Done</Button>
        {toast}
      </span>} />
  );
  return (
    <ListRow className="ilead" lead={{ icon: "calendar" }}
      title={<><span className="pc-only">Shoot moved in Google Calendar: tell {who}</span><span className="ph-only">Shoot moved in Google</span></>}
      meta={`${n.project} · now ${shootDay(n.date)} ${clock(n.call)} (was ${shootDay(n.wasDate)} ${clock(n.wasCall)}) · nobody was emailed`}
      titleChip={<span className="pc-only"><StatusChip tone="warning">Moved</StatusChip></span>}
      action={<span className="need-acts">
        {n.sheetId && <ButtonLink size="sm" to={`/production/call-sheets/${n.sheetId}`}>Call sheet</ButtonLink>}
        {n.people > 0 && <Button size="sm" variant="primary" loading={busy === "ask"} onClick={() => run("ask")}>Ask to confirm</Button>}
        <Button size="sm" variant={n.people > 0 ? "secondary" : "primary"} loading={busy === "done"} onClick={() => run("done")}>Done</Button>
        {toast}
      </span>} />
  );
}

const RECENT_ICON: Record<Recent["what"], IconName> = {
  watched: "eye", opened: "eye", notes: "note", read: "mail", approved: "check-circle", doc_viewed: "eye", doc_signed: "check-circle", doc_all_signed: "check-circle",
};
function recentTitle(r: Recent) {
  const who = first(r.who);
  switch (r.what) {
    case "watched": return `${who} watched ${r.subject}`;
    case "opened": return `${who} opened ${r.subject}`;
    case "notes": return `${who} left ${r.count ?? 1} note${(r.count ?? 1) === 1 ? "" : "s"}`;
    case "read": return `${who} read your note`;
    case "approved": return `${who} approved ${r.subject}`;
    case "doc_viewed": return `${who} opened ${r.subject}`;
    case "doc_signed": return `${r.subject} signed by ${who}`;
    case "doc_all_signed": return `${r.subject} signed by everyone`;
  }
}
function recentLink(r: Recent) {
  const ref = r.ref as { kind: string; id: string; version?: number };
  if (ref.kind === "video") return `/v/${ref.id}${ref.version ? `?version=${ref.version}` : ""}`;
  if (ref.kind === "document") return `/sign/d/${ref.id}`;
  if (ref.kind === "note") return `/sent/${ref.id}`;
  return "/settings/shares";
}

function waitingChip(c: ClientRow) {
  const parts = [c.toSign > 0 && `${c.toSign} to sign`, c.toReview > 0 && `${c.toReview} to review`].filter(Boolean);
  return parts.length ? <StatusChip tone="warning">{parts.join(" · ")}</StatusChip> : undefined;
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
type Dash = NonNullable<ReturnType<typeof useQuery<typeof api.home.dashboard>>>;

/** "Site watch found N things" (frame 786:10853). Opens the report. Not drawn at all when nothing is found. */
function SiteWatchRow({ w }: { w: { open: number; urgent: number; fixReady: number; checkedAt: number | null } }) {
  const found = w.open - w.urgent - w.fixReady;
  const meta = [
    w.urgent > 0 && `${w.urgent} ${w.urgent === 1 ? "needs" : "need"} you`,
    w.fixReady > 0 && `${plural(w.fixReady, "fix", "fixes")} ready, waiting for your go`,
    found > 0 && `${found} found`,
    w.checkedAt && `checked ${new Date(w.checkedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`,
  ].filter(Boolean).join(" · ");
  const chip = w.urgent > 0 ? <StatusChip tone="danger">Needs you</StatusChip> : w.fixReady > 0 ? <StatusChip tone="warning">Fix ready</StatusChip> : <StatusChip tone="neutral">Found</StatusChip>;
  return (
    <Card className="sw-dash" label="Site watch">
      <SwRow lead="activity" to="/settings/sitewatch" title={`Site watch found ${plural(w.open, "thing", "things")}`} meta={meta} chip={chip} />
    </Card>
  );
}

export default function OwnerHome() {
  const needs = useQuery(api.home.needs);
  const recent = useQuery(api.activity.recent, { limit: 8 });
  const clients = useQuery(api.clients.directory);
  const due = useQuery(api.crm.due, {}); // Phase 3: follow-ups due today or overdue
  const watch = useQuery(api.siteWatch.summary); // Phase 5c: null unless one of the portal's admins; the row hides when nothing is found (Q45)
  const dash = useQuery(api.home.dashboard, { tzOffsetMin: new Date().getTimezoneOffset() }); // Phase 5b: Today, Coming up, Live edits, Money this month
  const resend = useMutation(api.sign.resend);
  const [toast, show] = useToast();
  const now = Date.now();
  const remind = async (n: Extract<Need, { kind: "doc" }>) => {
    try { await resend({ documentId: n.documentId as Id<"wsDocuments">, signerKey: n.signerKey }); show(`Reminder sent to ${first(n.waitingOn[0])}.`); }
    catch (e) { show(errText(e)); }
  };
  const shownClients = (clients ?? []).slice().sort((a, b) => Number(b.toSign + b.toReview > 0) - Number(a.toSign + a.toReview > 0) || a.name.localeCompare(b.name)).slice(0, 5);
  // Nov 2 (Heston): the Dashboard's widgets and their order come from Settings › Tools.
  const tools = useQuery(api.users.me)?.tools as Tools | undefined;
  const on = (tools?.widgets ?? DEFAULT_TOOLS.widgets).filter((w) => w.on).map((w) => w.id);
  const card: Record<WidgetKey, React.ReactNode> = {
    needs: (
      <div key="needs" id="needs"><Card label="Needs you" head={<SectionHead label="Needs you" count={needs?.length ? needs.length : undefined} />}>
        {needs === undefined ? <SkeletonRows n={3} />
          : needs.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "check-circle" }} title="New client notes, documents waiting on clients and drafts to confirm show up here." />
          : needs.map((n, i) => <div key={i} className="wp-rowwrap">{i > 0 && <Divider />}<NeedRow n={n} remind={remind} /></div>)}
      </Card></div>
    ),
    followups: due && due.length > 0 ? (
      <Card key="followups" label="Follow-ups" head={<SectionHead label="Follow-ups" count={due.length} action={<ButtonLink size="sm" variant="ghost" to="/clients/follow-ups">All follow-ups</ButtonLink>} />}>
        {due.map((f, i) => <div key={f._id} className="wp-rowwrap">{i > 0 && <Divider />}<FollowUpRow f={f} show={show} /></div>)}
      </Card>
    ) : null,
    clients: clients && clients.length > 0 ? (
      <Card key="clients" className="wp-homeclients" label="Your clients" head={<SectionHead label="Your clients" count={clients.length} action={<ButtonLink size="sm" variant="ghost" to="/clients">All clients</ButtonLink>} />}>
        {shownClients.map((c, i) => (
          <div key={c._id} className="wp-rowwrap">{i > 0 && <Divider />}
            <ListRow to={`/clients/${c._id}`} lead={{ avatar: c.name, two: true }} title={c.name} meta={`${plural(c.people, "person", "people")} · ${plural(c.projects, "project", "projects")}`} chip={waitingChip(c)} chevron />
          </div>
        ))}
      </Card>
    ) : null,
    activity: (
      <Card key="activity" label="Recent activity" head={<SectionHead label="Recent activity" action={<ButtonLink size="sm" variant="ghost" to="/activity">See all</ButtonLink>} />}>
        {recent === undefined ? <SkeletonRows n={4} />
          : recent.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "activity" }} title="Client views, notes and signatures show up here." />
          : recent.slice(0, 5).map((r, i) => (
            <div key={i} className="wp-rowwrap">{i > 0 && <Divider />}
              <InboxItem icon={RECENT_ICON[r.what]} title={recentTitle(r)} detail={r.detail ?? undefined} time={activityWhen(r.at, now)} to={recentLink(r)} />
            </div>
          ))}
      </Card>
    ),
    coming_up: (
      <Card key="coming_up" label="Coming up" head={<SectionHead label="Coming up" count={dash?.comingTotal || undefined} action={<ButtonLink size="sm" variant="ghost" to="/production" iconEnd={false}>Production</ButtonLink>} />}>
        {dash === undefined ? <SkeletonRows n={3} />
          : dash.coming.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "video" }} title="No shoots coming up." />
          : dash.coming.map((c, i) => (
            <div key={c._id} className="wp-rowwrap">{i > 0 && <Divider />}
              {(() => { const b = sheetBits(c, dash.today, true); return ( // Phase 5b step 3: its call sheet
              <ListRow className="ilead ovact" lead={{ icon: "video" }} to={b.sent ? b.href : `/projects/${c.projectId}`} chevron={b.sent}
                title={c.client ? `${c.project} · ${c.client}` : c.label}
                meta={[c.date === dash.today ? "Today" : shootDay(c.date), `Call ${clock(c.call)}`].join(" · ")}
                chip={b.chip} action={b.action} />); })()}
            </div>
          ))}
      </Card>
    ),
    live_edits: (
      <Card key="live_edits" label="Live edits" head={<SectionHead label="Live edits" count={dash?.tiles.edits || undefined} action={<ButtonLink size="sm" variant="ghost" to="/review" iconEnd={false}>Review</ButtonLink>} />}>
        {dash === undefined ? <SkeletonRows n={2} />
          : dash.edits.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "review" }} title="No projects in Production or Polish." />
          : dash.edits.map((e, i) => (
            <div key={e._id} className="wp-rowwrap">{i > 0 && <Divider />}
              <ListRow className="ilead" lead={{ icon: "review" }} to={`/projects/${e._id}`} chevron title={e.label}
                meta={[e.round ? `Round ${e.round}` : null, e.nextStep ?? (e.next ? `${e.next.label} ${shootDay(e.next.date).replace(/^\w+, /, "")}` : null)].filter(Boolean).join(" · ") || undefined} />
            </div>
          ))}
      </Card>
    ),
    money: (
      <Card key="money" label="Money this month" head={<SectionHead label="Money this month" action={<ButtonLink size="sm" variant="ghost" to="/payments" iconEnd={false}>Payments</ButtonLink>} />}>
        {dash === undefined ? <SkeletonRows n={3} />
          : !dash.money.stripe ? <ListRow className="ilead quiet" lead={{ icon: "invoice" }} title="Connect Stripe to see paid, due and overdue here." />
          : <dl className="pov-paid prod-week"><dt>Paid</dt><dd>{money(dash.money.paid)}</dd><dt>Due</dt><dd>{money(dash.money.due)}</dd><dt>Overdue</dt><dd>{money(dash.money.overdue)}</dd></dl>}
      </Card>
    ),
    recurring: <Suspense key="recurring" fallback={null}><Recurring withPastDue /></Suspense>,
    // Phase 5e step 5 (829:24616): the Reports widgets
    revenue_year: <RevenueYearCard key="revenue_year" />,
    outstanding: <OutstandingCard key="outstanding" />,
  };
  // Each widget keeps its column from the approved Home (lists on the left, activity and money on the right); your
  // order decides the order inside each. With only one column's widgets on, they take the page.
  const RIGHT = new Set<WidgetKey>(["live_edits", "money", "activity", "recurring", "outstanding"]);
  const cols: [React.ReactNode[], React.ReactNode[]] = [[], []];
  for (const id of on) if (card[id]) cols[RIGHT.has(id) ? 1 : 0].push(card[id]);
  if (!cols[0].length) { cols[0] = cols[1]; cols[1] = []; }
  return (
    <>
    <TopBar><span className="here">Dashboard</span></TopBar>
    <div className="wp-page wp-home pov">
      <PageHeader title="Dashboard." sub="What needs you today." actions={<><ButtonLink variant="secondary" to="/settings/tools" iconEnd={false}>Customize</ButtonLink><CreateMenu /></>} />
      {watch && watch.open > 0 && <SiteWatchRow w={watch} />}
      <div className="pov-stats ov-tiles">
        <Tile label="Today" n={dash ? dash.tiles.today : "–"} sub={dash?.tiles.todayFirst ? `${dash.tiles.today === 1 ? "shoot" : "shoots"} · ${dash.tiles.todayFirst.client ?? dash.tiles.todayFirst.project}` : "no shoots"}
          to={dash?.tiles.todayFirst ? `/projects/${dash.tiles.todayFirst.projectId}` : "/production/shoots"} link={dash?.tiles.todayFirst ? "Open shoot" : "See shoots"} />
        <Tile label="Live edits" n={dash ? dash.tiles.edits : "–"} sub="in Production or Polish" to="/review" link="See edits" />
        <Tile label="Money this month" n={dash ? (dash.money.stripe ? money(dash.money.paid) : "–") : "–"}
          sub={dash?.money.stripe ? `paid · ${money(dash.money.due + dash.money.overdue)} due` : "Stripe isn't connected"} to="/payments" link="See payments" />
        <Tile label="Needs you" n={needs ? needs.length : "–"} sub="across your tools" to="#needs" link="See them" />
      </div>
      {on.length === 0 ? <EmptyState icon="home" title="No widgets on your Dashboard." body="Pick what shows here in Settings › Tools." actions={<ButtonLink variant="primary" to="/settings/tools">Settings › Tools</ButtonLink>} />
        : <div className="wp-homecols"><div className="col">{cols[0]}</div><div className="col right">{cols[1]}</div></div>}
      {toast}
    </div>
    </>
  );
}
