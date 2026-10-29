// The client page (P1 / Owner / Client page): header with Share a cut and Post a note; tabs Overview · Projects ·
// Shared · Documents · Their Inbox. Their Inbox shows exactly what one of their people sees.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, Button, ButtonLink, Card, Checkbox, Divider, EmptyState, InboxItem, ListRow, SectionHead, Segmented, SkeletonRows, StatusChip, Tabs, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { ShareDialog } from "../review/Share";
import { errText } from "../docs/pages/common";
import { INBOX_ICON, dayWord, firstName, itemDetail, monthDay, type InboxKind } from "../inbox/common";

type Page = NonNullable<ReturnType<typeof useQuery<typeof api.clients.page>>>;
type Person = Page["people"][number];
type Shared = Page["shared"][number];
type Doc = Page["documents"][number];
type Event = NonNullable<ReturnType<typeof useQuery<typeof api.inbox.forClient>>>[number];
export type ClientTab = "overview" | "projects" | "shared" | "documents" | "inbox";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ROLE = { signer: "Signs documents", contact: "Contact" } as const;
const rows = <T,>(list: T[], render: (x: T, i: number) => React.ReactNode, key: (x: T, i: number) => string) =>
  list.map((x, i) => <div key={key(x, i)} className="wp-rowwrap">{i > 0 && <Divider />}{render(x, i)}</div>);

// ---------- People ----------
function accessText(p: Person) {
  if (p.access.state === "active") return "Active";
  if (p.access.state === "invited") return <><span className="pc-only">invited {monthDay(p.access.at)}</span><span className="ph-only">Invited</span></>;
  return "not invited";
}
function PersonRow({ p, show }: { p: Person; show: (m: string) => void }) {
  const invite = useMutation(api.clients.invitePerson);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const r = await invite({ personId: p._id }); show(r.already ? `Invite kept for ${p.email}.` : `${p.name ?? p.email} is invited.`); }
    catch (e) { show(errText(e)); } finally { setBusy(false); }
  };
  return (
    <ListRow lead={{ avatar: p.name ?? p.email, two: true }} title={p.name ?? p.email} meta={<>{ROLE[p.role]} · {accessText(p)}</>}
      chip={p.access.state === "active" ? <span className="pc-only"><StatusChip tone="success">Active</StatusChip></span> : undefined}
      action={p.access.state === "active" ? undefined : (
        <Button size="sm" loading={busy} onClick={() => void go()}>
          {p.access.state === "invited" ? <><span className="pc-only">Resend invite</span><span className="ph-only">Resend</span></> : <><span className="pc-only">Invite to the portal</span><span className="ph-only">Invite</span></>}
        </Button>
      )} />
  );
}
function AddPerson({ clientId, client, onClose, show }: { clientId: Id<"clients">; client: string; onClose: () => void; show: (m: string) => void }) {
  const add = useMutation(api.clients.addPerson);
  const invite = useMutation(api.clients.invitePerson);
  const [name, setName] = useState(""), [email, setEmail] = useState("");
  const [role, setRole] = useState<"signer" | "contact">("contact");
  const [portal, setPortal] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  return (
    <Modal onClose={onClose} label="Add a person" width={520}>
      <form style={{ display: "grid", gap: 18 }} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null);
        try {
          const personId = await add({ clientId, email, name: name || undefined, role });
          if (portal) await invite({ personId });
          show(portal ? `${name.trim() || email.trim()} is added and invited.` : `${name.trim() || email.trim()} is added.`); onClose();
        } catch (err) { setError(errText(err)); setBusy(false); }
      }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">{client}</span>
            <h2 className="headline">Add a person.</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus />
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
        <div className="wp-field"><span className="wp-field-label">Role</span>
          <Segmented label="Role" value={role} onChange={setRole} items={[{ key: "signer", label: "Signs documents" }, { key: "contact", label: "Contact" }]} />
        </div>
        <Checkbox checked={portal} onChange={setPortal} label="Invite to the portal" hint="They can make an account with this email and see what you share with them." />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" type="submit" loading={busy} disabled={!email.trim()}>Add person</Button>
        </div>
      </form>
    </Modal>
  );
}
function PeopleCard({ page, show, onAdd }: { page: Page; show: (m: string) => void; onAdd: () => void }) {
  return (
    <Card className="cp-people" label="People" head={<SectionHead label="People" count={page.people.length} action={<Button size="sm" variant="ghost" icon="plus" onClick={onAdd}>Add a person</Button>} />}>
      {page.people.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "users" }} title="No one yet. Add the people who sign documents or get updates." action={<Button size="sm" onClick={onAdd}>Add a person</Button>} />
        : rows(page.people, (p) => <PersonRow p={p} show={show} />, (p) => p._id)}
    </Card>
  );
}

// ---------- Projects, Shared, Documents ----------
function ProjectRows({ page, max }: { page: Page; max?: number }) {
  const list = max ? page.projects.slice(0, max) : page.projects;
  if (!list.length) return <ListRow className="ilead quiet" lead={{ icon: "folder" }} title="No projects yet." />;
  return <>{rows(list, (p) => (
    <ListRow to={`/projects/${p._id}`} lead={{ thumb: p.thumbUrl, size: 64 }} title={p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name}
      meta={p.shared ? `${plural(p.videos, "video", "videos")} · updated ${dayWord(p.updatedAt)}` : "Nothing shared yet"} chevron />
  ), (p) => p._id)}</>;
}
function sharedChip(s: Shared) {
  if (s.state === "approved") return <StatusChip tone="success">Approved</StatusChip>;
  if (s.state === "notes") return <StatusChip tone="accent">{plural(s.notes, "note", "notes")}</StatusChip>;
  if (s.state === "watched") return <StatusChip tone="neutral">Watched</StatusChip>;
  return <StatusChip tone="neutral">Not watched</StatusChip>;
}
const sharedShort = (s: Shared) => (s.state === "approved" ? "approved" : s.state === "notes" ? plural(s.notes, "note", "notes") : s.state === "watched" ? "watched" : "not watched");
function SharedRows({ page, max }: { page: Page; max?: number }) {
  const list = max ? page.shared.slice(0, max) : page.shared;
  if (!list.length) return <ListRow className="ilead quiet" lead={{ icon: "send" }} title="Nothing shared with them yet." />;
  return <>{rows(list, (s) => (
    <ListRow to={`/v/${s.videoId}?version=${s.number}`} lead={{ thumb: s.thumbUrl, size: 64 }}
      title={<><span className="pc-only">{s.title} · v{s.number}</span><span className="ph-only">{s.title}</span></>}
      meta={<><span className="pc-only">{s.fileName ? `${s.fileName.replace(/\.[a-z0-9]+$/i, "")} · ` : ""}shared {dayWord(s.sharedAt)}</span><span className="ph-only">v{s.number} · {sharedShort(s)}</span></>}
      chip={<span className="pc-only">{sharedChip(s)}</span>} trailing={<span className="ph-only"><Icon name="chevron-right" size={16} className="chev" /></span>} />
  ), (s) => s.versionId)}</>;
}
function docChip(d: Doc) {
  if (d.status === "completed") return <StatusChip tone="success">Signed</StatusChip>;
  if (d.status === "voided") return <StatusChip tone="neutral">Cancelled</StatusChip>;
  return <StatusChip tone="warning">To sign</StatusChip>;
}
function docMeta(d: Doc) {
  if (d.status === "completed") return { pc: `Signed ${monthDay(d.completedAt ?? d.sentAt ?? 0)}`, ph: `${d.label} · signed ${monthDay(d.completedAt ?? d.sentAt ?? 0)}` };
  if (d.status === "voided") return { pc: `Cancelled ${monthDay(d.voidedAt ?? d.sentAt ?? 0)}`, ph: `${d.label} · cancelled` };
  const waiting = d.waitingOn.length ? ` · waiting on ${d.waitingOn.map(firstName).join(" and ")}` : "";
  return { pc: `Sent ${monthDay(d.sentAt ?? 0)}${waiting}`, ph: `${d.label} · to sign` };
}
function DocRows({ page, max }: { page: Page; max?: number }) {
  const list = max ? page.documents.slice(0, max) : page.documents;
  if (!list.length) return <ListRow className="ilead quiet" lead={{ icon: "document" }} title="No documents sent to them yet." />;
  return <>{rows(list, (d) => {
    const m = docMeta(d);
    return (
      <ListRow to={`/sign/d/${d._id}`} className="ilead" lead={{ icon: d.status === "completed" ? "check-circle" : d.status === "voided" ? "close" : "sign" }}
        title={<><span className="pc-only">{d.label} · {d.title}</span><span className="ph-only">{d.title}</span></>}
        meta={<><span className="pc-only">{m.pc}</span><span className="ph-only">{m.ph}</span></>} chip={docChip(d)} />
    );
  }, (d) => d._id)}</>;
}

// ---------- Their Inbox ----------
function readLine(e: Event, names: Map<string, string>) {
  const readers = e.people.filter((p) => p.readAt).map((p) => firstName(names.get(p.email) ?? p.email));
  const emailed = e.people.some((p) => p.emailed);
  const read = readers.length === 0 ? "Unread" : readers.length === 1 ? `Read by ${readers[0]}` : `Read by ${readers.length}`;
  return [read, emailed && "emailed", dayWord(e.createdAt)].filter(Boolean).join(" · ");
}
function InboxSummary({ events, names, onOpen }: { events: Event[] | undefined; names: Map<string, string>; onOpen: () => void }) {
  return (
    <Card className="cp-inbox" label="Their Inbox" head={<SectionHead label="Their Inbox" count={events?.length || undefined} action={<Button size="sm" variant="ghost" onClick={onOpen}>Open</Button>} />}>
      {events === undefined ? <SkeletonRows n={3} /> : events.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "inbox" }} title="Nothing in their Inbox yet." />
        : rows(events.slice(0, 3), (e) => <InboxItem icon={INBOX_ICON[e.kind as InboxKind]} title={e.title} detail={readLine(e, names)} />, (e) => e._id)}
    </Card>
  );
}
function TheirInbox({ page, events, business, show, onAdd }: { page: Page; events: Event[] | undefined; business: string; show: (m: string) => void; onAdd: () => void }) {
  const viewers = page.people.filter((p) => p.access.state !== "none" || (events ?? []).some((e) => e.people.some((x) => x.email === p.email)));
  const [who, setWho] = useState<string | null>(null);
  const email = who ?? viewers[0]?.email ?? null;
  const person = viewers.find((p) => p.email === email);
  const mine = (events ?? []).flatMap((e) => { const me = e.people.find((p) => p.email === email); return me ? [{ e, me }] : []; });
  const unread = mine.filter((x) => !x.me.readAt).length;
  const cuts = page.shared.length, projects = new Set(page.shared.map((s) => s.projectId)).size;
  const toSign = page.documents.filter((d) => d.status === "sent").length;
  return (
    <div className="wp-homecols">
      <div className="col">
        <div className="cp-viewing">
          <span className="wp-label">Viewing as</span>
          {viewers.length > 0 && <Segmented label="Viewing as" value={email ?? ""} onChange={(k) => setWho(k)} items={viewers.map((p) => ({ key: p.email, label: p.name ?? p.email }))} />}
          <span className="sp" />
          <ButtonLink size="sm" to={`/sent/new?client=${page.client._id}`}>Post a note</ButtonLink>
        </div>
        {events === undefined ? <Card label="Their Inbox"><SkeletonRows n={4} /></Card>
          : !person ? <EmptyState icon="inbox" title="No one here has portal access yet." body="Use Add a person (People, on Overview) to give someone an Inbox." />
          : mine.length === 0 ? <EmptyState icon="inbox" title="Nothing in their Inbox yet." body={`New cuts, documents and your notes show up here for ${firstName(person.name ?? person.email)}.`} />
          : (
            <Card label={`${person.name ?? person.email}'s Inbox`}>
              {rows(mine, ({ e, me }) => (
                <InboxItem icon={INBOX_ICON[e.kind as InboxKind]} title={e.title} detail={`${itemDetail(e, business)} · ${dayWord(e.createdAt)}`} unread={!me.readAt}
                  status={<span className={me.readAt ? "" : "cp-unread"}>{[me.readAt ? "Read" : "Unread", me.emailed && "emailed"].filter(Boolean).join(" · ")}</span>} />
              ), (x) => x.e._id)}
            </Card>
          )}
        {person && <p className="cp-foot"><Icon name="eye" size={16} />This is exactly what {firstName(person.name ?? person.email)} sees. Their replies come to you by email.</p>}
      </div>
      <div className="col right">
        <Card label="What they can see" head={<SectionHead label="What they can see" />}>
          <dl className="cp-see">
            <dt>Review</dt><dd>{cuts ? `${plural(cuts, "cut", "cuts")} in ${plural(projects, "project", "projects")}` : "Nothing shared yet"}</dd>
            <dt>Documents</dt><dd>{page.documents.length}{toSign ? ` (${toSign} to sign)` : ""}</dd>
            <dt>Inbox</dt><dd>{person ? `${plural(mine.length, "item", "items")} · ${unread} unread` : "—"}</dd>
          </dl>
        </Card>
        <PeopleCard page={page} show={show} onAdd={onAdd} />
      </div>
    </div>
  );
}

// ---------- the page ----------
export default function ClientPage({ clientId, tab: tabParam }: { clientId: Id<"clients">; tab: ClientTab }) {
  const page = useQuery(api.clients.page, { clientId });
  const events = useQuery(api.inbox.forClient, { clientId });
  const biz = useQuery(api.business.settings, {});
  const [toast, show] = useToast();
  const [sharing, setSharing] = useState(false);
  const [adding, setAdding] = useState(false);
  const tab = tabParam;
  const setTab = (k: ClientTab) => navigate(`/clients/${clientId}${k === "overview" ? "" : `?tab=${k}`}`);
  if (page === undefined) return <><TopBar><a {...linkProps("/clients")}>Clients</a></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (page === null) return <><TopBar><a {...linkProps("/clients")}>Clients</a></TopBar><div className="wp-page"><EmptyState icon="users" title="This client isn't here." body="It may have been deleted." actions={<ButtonLink to="/clients">All clients</ButtonLink>} /></div></>;
  const names = new Map(page.people.map((p) => [p.email, p.name ?? p.email]));
  const business = biz?.name ?? "your business";
  const name = page.client.name;
  const actions = (
    <>
      <Button onClick={() => setSharing(true)}>Share a cut</Button>
      <ButtonLink variant="primary" to={`/sent/new?client=${clientId}`}>Post a note</ButtonLink>
    </>
  );
  return (
    <>
      <TopBar><a {...linkProps("/clients")}>Clients</a><Sep /><span className="here">{name}</span></TopBar>
      <div className="wp-page cp">
        <a className="wp-setback" {...linkProps("/clients")}><Icon name="arrow-left" size={20} />Clients</a>
        <header className="cp-head">
          <Avatar name={name} two size={56} />
          <div className="txt">
            <h1 className="wp-h2" title={name}>{name}</h1>
            <div className="tags pc-only"><span className="wp-tag">{plural(page.people.length, "person", "people")}</span><span className="wp-tag">{plural(page.projects.length, "project", "projects")}</span></div>
            <span className="ph-only cp-sub">{plural(page.people.length, "person", "people")} · {plural(page.projects.length, "project", "projects")}</span>
          </div>
          <div className="acts">{actions}</div>
        </header>
        <div className="ws-tabs cp-tabs">
          <Tabs label="Client" value={tab} onChange={setTab} items={[
            { key: "overview", label: "Overview" }, { key: "projects", label: "Projects", count: page.projects.length },
            { key: "shared", label: "Shared", count: page.shared.length }, { key: "documents", label: "Documents", count: page.documents.length },
            { key: "inbox", label: "Their Inbox" },
          ]} />
        </div>
        {tab === "overview" && (
          <div className="wp-homecols cp-overview">
            <div className="col">
              <Card className="cp-projects" label="Projects" head={<SectionHead label="Projects" count={page.projects.length} action={<ButtonLink size="sm" variant="ghost" to="/projects">New project</ButtonLink>} />}><ProjectRows page={page} max={4} /></Card>
              <Card className="cp-shared" label="Shared with them" head={<SectionHead label="Shared with them" count={page.shared.length} action={<Button size="sm" variant="ghost" onClick={() => setSharing(true)}>Share a cut</Button>} />}><SharedRows page={page} max={5} /></Card>
              <Card className="cp-docs" label="Documents" head={<SectionHead label="Documents" count={page.documents.length} action={<ButtonLink size="sm" variant="ghost" to="/sign/new">New document</ButtonLink>} />}><DocRows page={page} max={5} /></Card>
            </div>
            <div className="col right">
              <PeopleCard page={page} show={show} onAdd={() => setAdding(true)} />
              <InboxSummary events={events} names={names} onOpen={() => setTab("inbox")} />
            </div>
          </div>
        )}
        {tab === "projects" && <Card label="Projects"><ProjectRows page={page} /></Card>}
        {tab === "shared" && <Card label="Shared with them"><SharedRows page={page} /></Card>}
        {tab === "documents" && <Card label="Documents"><DocRows page={page} /></Card>}
        {tab === "inbox" && <TheirInbox page={page} events={events} business={business} show={show} onAdd={() => setAdding(true)} />}
      </div>
      {sharing && <ShareDialog target={{ kind: "client", client: name }} label={name} onClose={() => setSharing(false)} show={show} />}
      {adding && <AddPerson clientId={clientId} client={name} onClose={() => setAdding(false)} show={show} />}
      {toast}
    </>
  );
}
