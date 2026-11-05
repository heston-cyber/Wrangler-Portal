// Phase 5b step 2 (Nov 3): the tool overviews. Clients 767:4392 (Empty 771:7489, Loading 771:8006), Review 767:5211,
// Docs 767:5964, Proposals 767:6705, Vendors 767:7477. A top-level side-menu item opens its overview; the layer's
// items still go straight to their pages. Same look as Production's and Payments' overviews (.pov-*).
// Row buttons are wired only to what exists: Remind on a document is Home's own resend; everything else opens the
// item's page. Nothing here emails anyone by itself.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, Divider, EmptyState, ListRow, PageHeader, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import { useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { Tile } from "./Tile";
import { useUpload } from "../../shell/UploadDialog";
import { NewClient } from "../review/Projects";
import { BookDialog } from "../vendors/Bookings";
import { VendorDialog } from "../vendors/Vendors";
import { errText } from "../docs/pages/common";

const TZ = "America/Chicago";
const md = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const ymd = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: TZ });
const mdOf = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const dayOf = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const first = (n: string) => n.trim().split(/\s+/)[0] || n;
function dayWord(t: number, now = Date.now()) {
  if (ymd(t) === ymd(now)) return "today";
  if (ymd(t) === ymd(now - 86_400_000)) return "yesterday";
  return md(t);
}

const Tiles = ({ children }: { children: React.ReactNode }) => <div className="pov-stats ov-tiles">{children}</div>;
const Loading = () => <>
  <div className="pov-stats ov-tiles">{[0, 1, 2, 3].map((i) => <div key={i} className="pov-stat prod-tile"><SkeletonRows n={1} /></div>)}</div>
  <Card label="Loading"><SkeletonRows n={4} /></Card>
</>;
/** Q89 (Nov 4, 860:9857 …): an overview loading: its tiles with a dash for each number, and its cards with grey rows. */
function Skeleton({ tiles, left, right }: { tiles: string[]; left: Array<[string, number]>; right: Array<[string, number]> }) {
  const card = ([label, n]: [string, number]) => <Card key={label} label={label} head={<SectionHead label={label} />}><SkeletonRows n={n} label={`Loading ${label.toLowerCase()}`} /></Card>;
  return <div aria-busy="true">
    <Tiles>{tiles.map((t) => <div key={t} className="pov-stat prod-tile ov-wait"><span className="lbl">{t}</span><b aria-label="Loading">–</b></div>)}</Tiles>
    <div className="pov-cols"><div className="col">{left.map(card)}</div><div className="col">{right.map(card)}</div></div>
  </div>;
}
const Crumb = ({ tool }: { tool: string }) => <TopBar><span className="secondary">{tool}</span><Sep /><span className="here">Overview</span></TopBar>;

/** A card's number rows (Pipeline, Briefings, Templates …). */
function Rows({ rows }: { rows: Array<[string, React.ReactNode, string?]> }) {
  return (
    <dl className="pov-paid prod-week">
      {rows.map(([k, v, to], i) => <div key={i} style={{ display: "contents" }}><dt>{k}</dt><dd>{to ? <a {...linkProps(to)}>{v}</a> : v}</dd></div>)}
    </dl>
  );
}
function Side({ label, action, to, children }: { label: string; action?: string; to?: string; children: React.ReactNode }) {
  return <Card label={label} head={<SectionHead label={label} action={action && to ? <ButtonLink size="sm" variant="ghost" to={to} iconEnd={false}>{action}</ButtonLink> : undefined} />}>{children}</Card>;
}
const Line = ({ first: f, children }: { first: boolean; children: React.ReactNode }) => <div className="wp-rowwrap">{!f && <Divider />}{children}</div>;

// ---------- Clients ----------
export function ClientsOverview() {
  const o = useQuery(api.overviews.clients, {});
  const [adding, setAdding] = useState(false);
  const [toast, show] = useToast();
  return (
    <>
      <Crumb tool="Clients" />
      <div className="wp-page pov prod">
        <PageHeader eyebrow="Clients" title="Clients." sub="Who you work with, and who’s next." actions={<Button variant="primary" onClick={() => setAdding(true)}>New client</Button>} />
        {o === undefined ? <Loading /> : o === null ? null : o.empty ? (
          <EmptyState icon="users" title="No clients yet" body="Add a client, or let the first lead from your website land here. Follow-ups and testimonials show up as they come in."
            actions={<Button variant="primary" onClick={() => setAdding(true)}>New client</Button>} />
        ) : <>
          <Tiles>
            <Tile label="Active clients" n={o.tiles.active} sub="with a live project" to="/clients" link="See clients" />
            <Tile label="Leads" n={o.tiles.leads} sub="in the pipeline" to="/clients/pipeline" link="Open pipeline" />
            <Tile label="Follow-ups due" n={o.tiles.followUps} sub="this week" to="/clients/follow-ups" link="See follow-ups" />
            <Tile label="Testimonials" n={o.tiles.testimonials} sub="new, not read yet" to="/clients/testimonials" link="Open testimonials" />
          </Tiles>
          <div className="pov-cols">
            <div className="col">
              <Card label="Needs you" head={<SectionHead label="Needs you" count={o.needsTotal || undefined} />}>
                {o.needs.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "check-circle" }} title="Nothing waiting on you here." />
                  : o.needs.map((n, i) => (
                    <Line key={n.kind + n.id} first={i === 0}>
                      <ListRow className="ilead ovact" lead={{ icon: n.kind === "testimonial" ? "note" : "user" }} title={n.title} meta={n.meta}
                        chip={n.kind === "followup" ? <StatusChip tone={n.overdue ? "danger" : "warning"}>{n.overdue ? "Overdue" : "Due today"}</StatusChip> : <StatusChip tone="accent">New</StatusChip>}
                        action={n.kind === "followup" ? <ButtonLink size="sm" to={n.clientId ? `/sent/new?client=${n.clientId}` : "/clients/follow-ups"} iconEnd={false}>{n.clientId ? "Write a note" : "Open"}</ButtonLink>
                          : n.kind === "lead" ? <ButtonLink size="sm" to={`/clients/deals/${n.id}`} iconEnd={false}>Open</ButtonLink>
                          : <ButtonLink size="sm" to="/clients/testimonials" iconEnd={false}>Read it</ButtonLink>} />
                    </Line>
                  ))}
              </Card>
              <Card label="Recently active" head={<SectionHead label="Recently active" action={<ButtonLink size="sm" variant="ghost" to="/activity" iconEnd={false}>See all</ButtonLink>} />}>
                {o.recent.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "activity" }} title="Client views, notes and approvals show up here." />
                  : o.recent.map((r, i) => <Line key={r.clientId} first={i === 0}><ListRow className="ilead" lead={{ icon: "user" }} to={`/clients/${r.clientId}`} chevron title={r.name} meta={`${r.what} · ${dayWord(r.at)}`} /></Line>)}
              </Card>
            </div>
            <div className="col">
              <Side label="Pipeline" action="Open" to="/clients/pipeline"><Rows rows={o.pipeline.map((s) => [s.name, s.n])} /></Side>
              <Side label="Follow-ups" action="See all" to="/clients/follow-ups"><Rows rows={[["Due today", o.followUps.today], ["This week", o.followUps.week], ["Later", o.followUps.later]]} /></Side>
            </div>
          </div>
        </>}
      </div>
      {adding && <NewClient onClose={() => setAdding(false)} onDone={() => { setAdding(false); show("Client added."); }} />}
      {toast}
    </>
  );
}

// ---------- Review ----------
export function ReviewOverview() {
  const o = useQuery(api.overviews.review, {});
  const { openUpload } = useUpload();
  return (
    <>
      <TopBar><a {...linkProps("/production")}>Production</a><Sep /><span className="here">Review</span></TopBar>
      <div className="wp-page pov prod">
        <PageHeader eyebrow="Production · Post-pro" title="Review." sub="Cuts, notes and who’s watching." actions={<Button variant="primary" onClick={() => openUpload({ newProject: true })}>New project</Button>} />
        {o === undefined ? <Skeleton tiles={["Waiting on clients", "New notes", "In progress", "Delivered"]} left={[["Notes to look at", 3], ["Waiting on clients", 2]]} right={[["Last opened", 2], ["Delivered this month", 2]]} /> : o === null ? null : o.empty ? (
          <EmptyState icon="review" title="No cuts out for review" body="Send a cut to a client and it will show up here. Notes, versions and who has watched it all gather in one place."
            actions={<Button variant="primary" onClick={() => openUpload({ newProject: true })}>New project</Button>} />
        ) : <>
          <Tiles>
            <Tile label="Waiting on clients" n={o.tiles.waiting} sub={`${plural(o.tiles.waiting, "cut")} out for review`} to="/projects" link="See projects" />
            <Tile label="New notes" n={o.tiles.notes} sub="to look at" to="/activity" link="Open notes" />
            <Tile label="In progress" n={o.tiles.inProgress} sub={plural(o.tiles.inProgress, "project")} to="/projects" link="See projects" />
            <Tile label="Delivered" n={o.tiles.delivered} sub="this month" to="/projects" link="See delivered" />
          </Tiles>
          <div className="pov-cols">
            <div className="col">
              <Card label="Notes to look at" head={<SectionHead label="Notes to look at" count={o.tiles.notes || undefined} action={<ButtonLink size="sm" variant="ghost" to="/activity" iconEnd={false}>See all</ButtonLink>} />}>
                {o.notes.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "note" }} title="No new notes from clients." />
                  : o.notes.map((n, i) => (
                    <Line key={i} first={i === 0}>
                      <ListRow className="ilead ovact" lead={{ icon: "review" }} title={`${n.video} · v${n.version}`} meta={`${n.count} new ${plural(n.count, "note")} from ${n.who}`}
                        chip={<StatusChip tone="accent">New</StatusChip>} action={<ButtonLink size="sm" to={`/v/${n.videoId}?version=${n.version}`} iconEnd={false}>Open</ButtonLink>} />
                    </Line>
                  ))}
              </Card>
              <Card label="Waiting on clients" head={<SectionHead label="Waiting on clients" count={o.waitingTotal || undefined} action={<ButtonLink size="sm" variant="ghost" to="/projects" iconEnd={false}>See all</ButtonLink>} />}>
                {o.waiting.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "review" }} title="No cuts out for review." />
                  : o.waiting.map((w, i) => (
                    <Line key={w.videoId} first={i === 0}>
                      <ListRow className="ilead" lead={{ icon: "review" }} to={`/v/${w.videoId}?version=${w.version}`} chevron title={`${w.video} · v${w.version}`}
                        meta={`Sent ${md(w.sentAt)} · ${w.opens === 0 ? "not opened" : w.opens === 1 ? "opened once" : `opened ${w.opens} times`}`}
                        chip={<StatusChip tone={w.opens === 0 ? "warning" : "neutral"}>{w.opens === 0 ? "Not opened" : "Opened"}</StatusChip>} />
                    </Line>
                  ))}
              </Card>
            </div>
            <div className="col">
              <Side label="Last opened" action="Activity" to="/activity">
                {o.lastOpened.length === 0 ? <p className="pj-pad secondary">Videos you open show up here.</p>
                  : <Rows rows={o.lastOpened.map((v) => [v.title, dayWord(v.at, o.now), `/v/${v.videoId}`])} />}
              </Side>
              <Side label="Delivered this month"><Rows rows={[["Projects", o.delivered]]} /></Side>
            </div>
          </div>
        </>}
      </div>
    </>
  );
}

// ---------- Docs ----------
export function DocsOverview() {
  const o = useQuery(api.overviews.docs, {});
  const resend = useMutation(api.sign.resend);
  const [toast, show] = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const remind = async (id: Id<"wsDocuments">, key: string, name: string) => {
    setBusy(id);
    try { await resend({ documentId: id, signerKey: key }); show(`Reminder sent to ${first(name)}.`); } catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  return (
    <>
      <Crumb tool="Docs" />
      <div className="wp-page pov prod">
        <PageHeader eyebrow="Docs" title="Docs." sub="Contracts and documents, out for signature and signed." actions={<ButtonLink variant="primary" to="/sign/new" iconEnd={false}>New document</ButtonLink>} />
        {o === undefined ? <Skeleton tiles={["To sign", "Signed", "Drafts", "Templates"]} left={[["Waiting on signatures", 3], ["Recently signed", 2]]} right={[["Templates", 2], ["Your signature", 1]]} /> : o === null ? null : o.empty ? (
          <EmptyState icon="document" title="No documents yet" body="Make a contract or another document and send it for signature. What is waiting and what is signed show up here."
            actions={<><ButtonLink variant="primary" to="/sign/new" iconEnd={false}>New document</ButtonLink><ButtonLink to="/sign/templates" iconEnd={false}>Start from a template</ButtonLink></>} />
        ) : <>
          <Tiles>
            <Tile label="To sign" n={o.tiles.toSign} sub="waiting on clients" to="/sign/docs" link="See them" />
            <Tile label="Signed" n={o.tiles.signed} sub="this month" to="/sign/docs" link="See signed" />
            <Tile label="Drafts" n={o.tiles.drafts} sub="not sent yet" to="/sign/docs" link="Open drafts" />
            <Tile label="Templates" n={o.tiles.templates} sub="saved" to="/sign/templates" link="See templates" />
          </Tiles>
          <div className="pov-cols">
            <div className="col">
              <Card label="Waiting on signatures" head={<SectionHead label="Waiting on signatures" count={o.tiles.toSign || undefined} />}>
                {o.waiting.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "sign" }} title="Nothing is waiting on a signature." />
                  : o.waiting.map((d, i) => (
                    <Line key={d._id} first={i === 0}>
                      <ListRow className="ilead ovact" lead={{ icon: "sign" }} to={`/sign/d/${d._id}`} title={d.client ? `${d.title} · ${d.client}` : d.title}
                        meta={`Sent ${md(d.sentAt)} · ${d.opened ? "opened" : "not opened"}${d.opened && d.of > 1 ? ` · ${d.signed} of ${d.of} signed` : ""}`}
                        chip={<StatusChip tone="warning">{d.opened ? "Waiting" : "Not opened"}</StatusChip>}
                        action={d.remind ? <Button size="sm" loading={busy === d._id} onClick={() => void remind(d._id, d.remind!.signerKey, d.remind!.name)}>Remind</Button> : undefined} />
                    </Line>
                  ))}
              </Card>
              <Card label="Recently signed" head={<SectionHead label="Recently signed" action={<ButtonLink size="sm" variant="ghost" to="/sign/docs" iconEnd={false}>See all</ButtonLink>} />}>
                {o.signed.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "sign" }} title="Signed documents show up here." />
                  : o.signed.map((d, i) => (
                    <Line key={d._id} first={i === 0}>
                      <ListRow className="ilead" lead={{ icon: "sign" }} to={`/sign/d/${d._id}`} chevron title={d.title} meta={`Signed ${md(d.at)}`} chip={<StatusChip tone="success">Signed</StatusChip>} />
                    </Line>
                  ))}
              </Card>
            </div>
            <div className="col">
              <Side label="Templates" action="Manage" to="/sign/templates"><Rows rows={[["Contracts", o.templates.contracts, "/sign/templates"], ["Call sheets", o.templates.callSheets, "/production/call-sheets?tab=templates"], ["Other", o.templates.other]]} /></Side>
              <Side label="Your signature" action={o.signature.adopted ? "Edit" : "Set up"} to="/sign/signature">
                <Rows rows={[["Adopted", o.signature.adopted ? `Yes · ${o.signature.method}` : "No"]]} />
              </Side>
            </div>
          </div>
        </>}
      </div>
      {toast}
    </>
  );
}

// ---------- Proposals ----------
export function ProposalsOverview() {
  const o = useQuery(api.overviews.proposals, {});
  return (
    <>
      <Crumb tool="Proposals" />
      <div className="wp-page pov prod">
        <PageHeader eyebrow="Proposals" title="Proposals." sub="Pitches out for review, and what to do with the accepted ones." actions={<ButtonLink variant="primary" to="/proposals/new" iconEnd={false}>New proposal</ButtonLink>} />
        {o === undefined ? <Skeleton tiles={["Out for review", "Accepted", "Drafts", "Declined"]} left={[["Needs you", 3], ["Out for review", 2]]} right={[["Templates", 1], ["Questionnaire", 1]]} /> : o === null ? null : o.empty ? (
          <EmptyState icon="document" title="No proposals yet" body="Write a proposal to pitch a client. Sent, accepted and declined ones show up here."
            actions={<><ButtonLink variant="primary" to="/proposals/new" iconEnd={false}>New proposal</ButtonLink><ButtonLink to="/proposals/templates" iconEnd={false}>Start from a template</ButtonLink></>} />
        ) : <>
          <Tiles>
            <Tile label="Out for review" n={o.tiles.out} sub="sent, not answered" to="/proposals" link="See them" />
            <Tile label="Accepted" n={o.tiles.accepted} sub="not made into contracts yet" to="/proposals" link="Choose" />
            <Tile label="Drafts" n={o.tiles.drafts} sub="not sent yet" to="/proposals" link="Open drafts" />
            <Tile label="Declined" n={o.tiles.declined} sub="this year" to="/proposals" link="See it" />
          </Tiles>
          <div className="pov-cols">
            <div className="col">
              <Card label="Needs you" head={<SectionHead label="Needs you" count={o.needsTotal || undefined} />}>
                {o.needs.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "check-circle" }} title="No accepted proposals waiting for a contract." />
                  : o.needs.map((n, i) => (
                    <Line key={n._id + n.kind} first={i === 0}>
                      <ListRow className="ilead ovact" lead={{ icon: "quote" }} title={n.title} meta={n.meta}
                        chip={<StatusChip tone={n.kind === "accepted" ? "success" : "neutral"}>{n.kind === "accepted" ? "Accepted" : "Viewed"}</StatusChip>}
                        action={<ButtonLink size="sm" to={`/proposals/${n._id}`} iconEnd={false}>{n.kind === "accepted" ? "Make contract" : "Open"}</ButtonLink>} />
                    </Line>
                  ))}
              </Card>
              <Card label="Out for review" head={<SectionHead label="Out for review" count={o.outTotal || undefined} action={<ButtonLink size="sm" variant="ghost" to="/proposals" iconEnd={false}>See all</ButtonLink>} />}>
                {o.out.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "quote" }} title="Nothing out for review." />
                  : o.out.map((p, i) => (
                    <Line key={p._id} first={i === 0}>
                      <ListRow className="ilead" lead={{ icon: "quote" }} to={`/proposals/${p._id}`} chevron title={p.title} meta={`Sent ${md(p.sentAt)}`}
                        chip={<StatusChip tone={p.viewed ? "neutral" : "accent"}>{p.viewed ? "Viewed" : "Sent"}</StatusChip>} />
                    </Line>
                  ))}
              </Card>
            </div>
            <div className="col">
              <Side label="Templates" action="Manage" to="/proposals/templates"><Rows rows={[["Saved", o.templates]]} /></Side>
              <Side label="Questionnaire" action="Edit" to="/proposals/questionnaire"><Rows rows={[["Questions", `${o.steps} ${plural(o.steps, "step")}`]]} /></Side>
            </div>
          </div>
        </>}
      </div>
    </>
  );
}

// ---------- Vendors ----------
const NEED_BTN = { waiting: "Open", invoice: "Review", w9: "Open" } as const;
export function VendorsOverview() {
  const o = useQuery(api.overviews.vendors, {});
  const [booking, setBooking] = useState(false);
  const [adding, setAdding] = useState<"add" | "invite" | null>(null);
  return (
    <>
      <Crumb tool="Vendors" />
      <div className="wp-page pov prod">
        <PageHeader eyebrow="Vendors" title="Vendors." sub="Your crew: bookings, briefings and invoices." actions={<Button variant="primary" onClick={() => setBooking(true)}>Book a vendor</Button>} />
        {o === undefined ? <Skeleton tiles={["Booked this week", "Waiting to accept", "Invoices to pay", "W-9 missing"]} left={[["Needs you", 3], ["Bookings this week", 2]]} right={[["Briefings", 2], ["Payments to vendors", 2]]} /> : o === null ? null : o.empty ? (
          <EmptyState icon="users" title="No vendors yet" body="Add your first vendor, or invite one. Their bookings, briefings and invoices all show up here."
            actions={<><Button variant="primary" onClick={() => setAdding("add")}>Add a vendor</Button><Button onClick={() => setAdding("invite")}>Invite a vendor</Button></>} />
        ) : <>
          <Tiles>
            <Tile label="Booked this week" n={o.tiles.booked} sub={o.tiles.shoots ? `on ${o.tiles.shoots} ${plural(o.tiles.shoots, "project")}` : "no bookings"} to="/vendors/bookings" link="See bookings" />
            <Tile label="Waiting to accept" n={o.tiles.waiting} sub="not answered yet" to="/vendors/bookings" link="See them" />
            <Tile label="Invoices to pay" n={o.tiles.invoices} sub="from vendors" to="/vendors/payments" link="See invoices" />
            <Tile label="W-9 missing" n={o.tiles.w9} sub={plural(o.tiles.w9, "vendor")} to="/vendors" link="See who" />
          </Tiles>
          <div className="pov-cols">
            <div className="col">
              <Card label="Needs you" head={<SectionHead label="Needs you" count={o.needsTotal || undefined} />}>
                {o.needs.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "check-circle" }} title="Nothing waiting on you here." />
                  : o.needs.map((n, i) => (
                    <Line key={n.kind + n.id} first={i === 0}>
                      <ListRow className="ilead ovact" lead={{ icon: "user" }} title={n.role ? `${n.vendor} · ${n.role}` : n.vendor} meta={n.meta}
                        chip={n.kind === "waiting" ? <StatusChip tone="warning">Waiting</StatusChip> : n.kind === "invoice" ? <StatusChip tone="danger">To approve</StatusChip> : <StatusChip tone="warning">Missing</StatusChip>}
                        action={<ButtonLink size="sm" iconEnd={false} to={n.kind === "waiting" ? `/vendors/bookings/${n.id}` : n.kind === "invoice" ? `/vendors/payments/${n.id}` : `/vendors/${n.id}`}>{NEED_BTN[n.kind]}</ButtonLink>} />
                    </Line>
                  ))}
              </Card>
              <Card label="Bookings this week" head={<SectionHead label="Bookings this week" count={o.weekTotal || undefined} action={<ButtonLink size="sm" variant="ghost" to="/vendors/bookings" iconEnd={false}>See all</ButtonLink>} />}>
                {o.week.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "calendar" }} title="No one is booked this week." />
                  : o.week.map((w, i) => (
                    <Line key={w.date + w.projectId} first={i === 0}>
                      <ListRow className="ilead" lead={{ icon: "calendar" }} to="/vendors/bookings" chevron title={`${w.date === o.today ? "Today" : dayOf(w.date)} · ${w.project}`} meta={w.people.join(", ")} />
                    </Line>
                  ))}
              </Card>
            </div>
            <div className="col">
              <Side label="Briefings" action="See all" to="/vendors/briefings"><Rows rows={[["Sent", o.briefings.sent], ["Not opened", o.briefings.notOpened]]} /></Side>
              <Side label="Payments to vendors" action="See all" to="/vendors/payments">
                <Rows rows={[["To approve", o.payments.toApprove], ["Approved, to pay", o.payments.toPay], ["Paid this month", o.payments.paidMonth]]} />
              </Side>
            </div>
          </div>
        </>}
      </div>
      {booking && <BookDialog onClose={() => setBooking(false)} />}
      {adding && <VendorDialog onClose={() => setAdding(null)} invite={adding === "invite"} />}
    </>
  );
}
