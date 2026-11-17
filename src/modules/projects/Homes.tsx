// How everything connects (Nov 16, D204–D206; Design Log "Handoff ready: How everything connects", frames 6c / …):
// Projects by client with "On their own" (1059-28911), Not attached (1060-29490), the Attach / Move picker
// (1062-30133, phone 1067-32311) and a project's Move confirmation (1062-30421). Every move goes through convex/homes.ts.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, Card, DialogHeader, EmptyState, PageHeader, PillTabs, SkeletonRows, TextField } from "../../ui/wp";
import { Icon, type IconName } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errLine } from "../../ui/hold";
import { usePerms } from "../../lib/teamAccess";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortDate = (d: string) => { const [y, m, day] = d.split("-").map(Number); const w = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }); return `${w} ${m}/${day}`; };

// ---------- the kinds (labels, icons, where each opens) ----------

export type HomeKind = "shoot" | "shotList" | "quote" | "estimate" | "proposal" | "invoice" | "subscription" | "briefing" | "lead" | "brief" | "fileRequest" | "creativeDoc" | "canvas" | "kit" | "task" | "todoList";
export const KIND: Record<HomeKind, { one: string; many: string; icon: IconName; open?: (id: string) => string }> = {
  shoot: { one: "shoot day", many: "Shoot days", icon: "clapper", open: (id) => `/production/shoots/${id}` },
  shotList: { one: "shot list", many: "Shot lists", icon: "shot-list", open: (id) => `/production/shot-lists/${id}` },
  quote: { one: "quote", many: "Quotes", icon: "quote", open: (id) => `/payments/quotes/${id}` },
  estimate: { one: "estimate", many: "Estimates", icon: "chart", open: (id) => `/clients/estimates/${id}` },
  proposal: { one: "proposal", many: "Proposals", icon: "presentation", open: (id) => `/proposals/${id}` },
  invoice: { one: "invoice", many: "Invoices", icon: "invoice", open: (id) => `/payments/invoices/${id}` },
  subscription: { one: "subscription", many: "Subscriptions", icon: "repeat", open: (id) => `/payments/subscriptions/${id}` },
  briefing: { one: "briefing", many: "Briefings", icon: "briefing", open: (id) => `/vendors/briefings/${id}` },
  lead: { one: "lead", many: "Leads", icon: "funnel", open: (id) => `/clients/deals/${id}` },
  brief: { one: "kickoff brief", many: "Kickoff briefs", icon: "questionnaire" },
  fileRequest: { one: "file request", many: "File requests", icon: "upload" },
  creativeDoc: { one: "creative doc", many: "Creative docs", icon: "document", open: (id) => `/creative/docs/${id}` },
  canvas: { one: "canvas", many: "Canvases and mood boards", icon: "creative", open: (id) => `/creative/canvas/${id}` },
  kit: { one: "brand kit", many: "Brand kits", icon: "layers", open: (id) => `/creative/kits/${id}` },
  task: { one: "task", many: "Tasks", icon: "work", open: (id) => `/work/all?task=${id}` },
  todoList: { one: "to-do list", many: "To-do lists", icon: "check-circle", open: (id) => `/work/lists?list=${id}` },
};
const TYPE_ICON: Record<string, IconName> = { client: "building", project: "folder", shoot: "clapper", lead: "funnel" };

// ---------- Attach / Move: one picker for every kind ----------

/** "Attach … to…" for a thing with no home, "Move … to…" for one that has one. Lists only the homes this kind can have. */
export function AttachDialog({ kind, id, name, hasHome, onClose, show }: { kind: HomeKind; id: string; name: string; hasHome: boolean; onClose: () => void; show: (t: string) => void }) {
  const places = useQuery(api.homes.places, { kind });
  const move = useMutation(api.homes.move);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const k = KIND[kind];
  const shown = (places ?? []).filter((p) => !q.trim() || `${p.name} ${p.sub ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const go = async (to: { type: "client" | "project" | "shoot" | "lead"; id: string } | null, label: string) => {
    setBusy(true);
    try { await move({ kind, id, to }); show(to ? `${hasHome ? "Moved" : "Attached"} to ${label}.` : "On its own now."); onClose(); }
    catch (e) { show(errLine(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label={`${hasHome ? "Move" : "Attach"} ${k.one}`} width={520}>
      <div className="crm-dialog hm-pick">
        <DialogHeader eyebrow={name} title={`${hasHome ? "Move" : "Attach"} this ${k.one} to…`} onClose={onClose} />
        <TextField placeholder="Search clients, projects, shoot days…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <div className="hm-list" role="list">
          {hasHome && (
            <button type="button" className="hm-row" disabled={busy} onClick={() => void go(null, "")}>
              <Icon name="minus" size={18} /><span className="t"><b>Nothing (on its own)</b><span className="secondary">It waits in Not attached</span></span>
            </button>
          )}
          {places === undefined ? <SkeletonRows n={3} /> : shown.length === 0 ? <p className="secondary hm-none">Nothing matches.</p>
            : shown.map((p) => (
              <button key={`${p.type}:${p.id}`} type="button" className="hm-row" disabled={busy || !!p.taken} onClick={() => void go({ type: p.type, id: p.id }, p.name)}>
                <Icon name={TYPE_ICON[p.type] ?? "folder"} size={18} />
                <span className="t"><b>{p.name}</b><span className="secondary">{p.taken ? "One list per day" : p.sub ?? (p.type === "client" ? "Client" : "")}</span></span>
              </button>
            ))}
        </div>
      </div>
    </Modal>
  );
}

// ---------- Move a project (to a client, to another client, or on its own) ----------

export function MoveProjectDialog({ projectId, onClose, show }: { projectId: string; onClose: () => void; show: (t: string) => void }) {
  const info = useQuery(api.homes.projectMove, { projectId });
  const clients = useQuery(api.homes.clientChoices, {});
  const move = useMutation(api.homes.moveProject);
  const [to, setTo] = useState<{ id: string | null; name: string } | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  if (info === null) return null;
  const go = async () => {
    if (!to) return;
    setBusy(true);
    try {
      const r = await move({ projectId, clientId: to.id });
      show(to.id ? `Moved to ${to.name}.${r.sharesOff ? ` ${info?.client ?? "The old client"}'s links are off.` : ""}` : "On its own now.");
      onClose();
    } catch (e) { show(errLine(e)); setBusy(false); }
  };
  // The confirmation (1062-30421): what moves, what stays because it was sent, and who stops seeing it.
  if (to && info) {
    const oc = info.oldClient;
    return (
      <Modal onClose={onClose} label="Move project" width={560}>
        <div className="crm-dialog hm-confirm">
          <DialogHeader eyebrow={info.label} title={to.id ? `Move ${info.label} and its ${plural(info.things, "thing")} to ${to.name}?` : `Take ${info.label} out of ${info.client ?? "its client"}?`} onClose={onClose} />
          <ul className="hm-what">
            <li><Icon name="check" size={16} /><span>Its shoots, call sheets, shot lists, briefs, requests, cuts and drafts go with it. Nothing is copied or relinked.</span></li>
            {info.staying.length > 0 && <li><Icon name="lock" size={16} /><span>Stays with {info.client ?? "its client"} because it was sent or addressed: {info.staying.map((s) => s.name).join(", ")}.</span></li>}
            {info.client && <li><Icon name="eye" size={16} /><span>{info.client}'s people stop seeing this project in their portal straight away. Their review links turn off; share again from each cut.</span></li>}
            {oc && <li className="warn"><Icon name="alert" size={16} /><span>{oc.name ?? "The old client"}'s {[oc.messages ? plural(oc.messages, "message") : null, oc.notes ? plural(oc.notes, "review note") : null].filter(Boolean).join(" and ")} go with it.{to.id ? ` ${to.name}'s people will see them.` : ""}</span></li>}
            {info.needsPayments && <li className="warn"><Icon name="alert" size={16} /><span>It has quotes or invoices: someone with Payments has to move it.</span></li>}
          </ul>
          <div className="dfoot">
            <button type="button" className="btn ghost" onClick={() => setTo(null)}>Back</button>
            <Button variant="primary" disabled={busy || info.needsPayments} onClick={() => void go()}>{to.id ? `Move to ${to.name}` : "Take it out"}</Button>
          </div>
        </div>
      </Modal>
    );
  }
  const shown = (clients ?? []).filter((c) => c._id !== info?.clientId && (!q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <Modal onClose={onClose} label="Move project" width={520}>
      <div className="crm-dialog hm-pick">
        <DialogHeader eyebrow={info?.label} title={info?.clientId ? "Move this project to…" : "Move to client…"} onClose={onClose} />
        <TextField placeholder="Search clients" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clients" />
        <div className="hm-list" role="list">
          {info?.clientId && (
            <button type="button" className="hm-row" onClick={() => setTo({ id: null, name: "" })}>
              <Icon name="minus" size={18} /><span className="t"><b>Nothing (on its own)</b><span className="secondary">Not under a client</span></span>
            </button>
          )}
          {clients === undefined ? <SkeletonRows n={3} /> : shown.length === 0 ? <p className="secondary hm-none">No clients match.</p>
            : shown.map((c) => (
              <button key={c._id} type="button" className="hm-row" onClick={() => setTo({ id: c._id, name: c.name })}>
                <Icon name="building" size={18} /><span className="t"><b>{c.name}</b><span className="secondary">Client</span></span>
              </button>
            ))}
        </div>
      </div>
    </Modal>
  );
}

/** The home chip at the top of a hub: the client, or a dashed "On its own" with Move to client… */
export function HomeChip({ client, onMove }: { client: { _id: string; name: string } | null; onMove?: () => void }) {
  return (
    <span className="hm-chip-row">
      {client ? <a className="hm-chip" {...linkProps(`/clients/${client._id}`)}><Icon name="building" size={14} />{client.name}</a>
        : <span className="hm-chip own"><Icon name="folder" size={14} />On its own</span>}
      {onMove && <button type="button" className="hm-move" onClick={onMove}>{client ? "Move to…" : "Move to client…"}</button>}
    </span>
  );
}

// ---------- New project ----------

function NewProject({ onClose, show }: { onClose: () => void; show: (t: string) => void }) {
  const clients = useQuery(api.homes.clientChoices, {});
  const create = useMutation(api.library.createProject);
  const move = useMutation(api.homes.moveProject);
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [client, setClient] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const id = await create({ name, ...(job.trim() ? { jobNumber: job } : {}) });
      if (client) await move({ projectId: id, clientId: client });
      navigate(`/projects/${id}`);
    } catch (e) { show(errLine(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="New project" width={520}>
      <form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <DialogHeader eyebrow="Projects" title="New project." body="Put it under a client now, or leave it on its own and move it later." onClose={onClose} />
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Launch" />
        <TextField label="Job number (optional)" value={job} onChange={(e) => setJob(e.target.value)} placeholder="26127" />
        <label className="field"><span className="flabel">Client</span>
          <select className="input" value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">On its own (no client)</option>
            {(clients ?? []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </label>
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" type="submit" disabled={busy || !name.trim()}>Make project</Button></div>
      </form>
    </Modal>
  );
}

// ---------- Projects (by client, by stage, list) ----------

type Board = NonNullable<ReturnType<typeof useQuery<typeof api.homes.projectsBoard>>>;
type Row = Board["projects"][number];
type View = "client" | "stage" | "list";
const STAGES = ["discovery", "strategy", "production", "polish", "delivery"];

function rowMeta(p: Row) {
  const parts = [p.next ? `Shoot ${shortDate(p.next)}` : null, p.shoots ? plural(p.shoots, "shoot") : null, p.lists ? plural(p.lists, "shot list") : null, p.docs ? plural(p.docs, "doc") : null, p.cuts ? plural(p.cuts, "cut") : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing on it yet";
}
function ProjectRow({ p, onMove }: { p: Row; onMove?: () => void }) {
  return (
    <div className="hm-prow">
      <a className="hm-plink" {...linkProps(`/projects/${p._id}`)}>
        <span className="t"><b>{p.label}</b><span className="secondary">{rowMeta(p)}</span></span>
        <span className="hm-stage">{p.stageName}</span>
        <Icon name="chevron-right" size={14} />
      </a>
      {onMove && <button type="button" className="hm-rowmove" aria-label={`Move ${p.label} to a client`} title="Move to client…" onClick={onMove}><Icon name="attach" size={16} /></button>}
    </div>
  );
}

const Crumbs = ({ here }: { here: string }) => <TopBar><a {...linkProps("/projects")}>Projects</a><Sep /><span className="here">{here}</span></TopBar>;

export default function ProjectsHub() {
  const board = useQuery(api.homes.projectsBoard, {});
  const perms = usePerms();
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem("wp.projects.view") as View) || "client"; } catch { return "client"; } });
  const [making, setMaking] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [toast, show] = useToast();
  const pick = (v: View) => { setView(v); try { localStorage.setItem("wp.projects.view", v); } catch { /* private mode */ } };
  const canMove = perms.perms.clients;
  const groups = useMemo(() => {
    if (!board) return [];
    if (view === "stage") return STAGES.map((st) => ({ key: st, title: board.projects.find((p) => p.stage === st)?.stageName ?? st, sub: "stage", rows: board.projects.filter((p) => p.stage === st), own: false, clientId: null as string | null })).filter((g) => g.rows.length);
    if (view === "list") return [{ key: "all", title: "All projects", sub: plural(board.projects.length, "project"), rows: board.projects, own: false, clientId: null }];
    const own = board.projects.filter((p) => !p.clientId);
    const by = new Map<string, Row[]>();
    for (const p of board.projects) if (p.clientId) by.set(p.clientId, [...(by.get(p.clientId) ?? []), p]);
    const cl = [...by.entries()].map(([id, rows]) => ({ key: id, title: rows[0].client ?? "Client", sub: "client", rows, own: false, clientId: id as string | null })).sort((a, b) => a.title.localeCompare(b.title));
    return [...(own.length ? [{ key: "own", title: "On their own", sub: "not under a client", rows: own, own: true, clientId: null }] : []), ...cl];
  }, [board, view]);
  return (
    <>
      <Crumbs here="All projects" />
      <div className="wp-page hm">
        <PageHeader eyebrow="Making the work" title="Projects." sub="Every project, under its client or on its own." actions={<Button variant="primary" onClick={() => setMaking(true)}>New project</Button>} />
        <div className="hm-toolbar">
          <PillTabs label="Group projects" value={view} onChange={pick} items={[{ key: "client", label: "By client" }, { key: "stage", label: "By stage" }, { key: "list", label: "List" }]} />
          <a className="hm-loose" {...linkProps("/projects/not-attached")}>Not attached <span className="secondary">{board ? plural(board.loose, "thing") : ""}</span></a>
        </div>
        {board === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card>
          : board.projects.length === 0 ? <EmptyState icon="folder" title="No projects yet" body="Make one under a client, or on its own and move it later." actions={<Button variant="primary" onClick={() => setMaking(true)}>New project</Button>} />
          : <div className={`hm-groups${view === "list" ? " one" : ""}`}>
              {groups.map((g) => (
                <section key={g.key} className={`hm-group glass${g.own ? " own" : ""}`} aria-label={g.title}>
                  <header className="hm-ghead">
                    <Icon name={g.own ? "folder" : view === "client" ? "building" : "stage"} size={18} />
                    <b>{g.title}</b><span className="secondary">{g.sub}</span>
                    <span className="sp" />
                    {g.clientId && <a className="hm-glink" {...linkProps(`/clients/${g.clientId}`)}>Open client</a>}
                  </header>
                  {g.rows.map((p) => <ProjectRow key={p._id} p={p} onMove={canMove && (g.own || view !== "client") ? () => setMoving(p._id) : undefined} />)}
                </section>
              ))}
            </div>}
      </div>
      {making && <NewProject onClose={() => setMaking(false)} show={show} />}
      {moving && <MoveProjectDialog projectId={moving} onClose={() => setMoving(null)} show={show} />}
      {toast}
    </>
  );
}

// ---------- Not attached (1060-29490) ----------

export function NotAttached() {
  const loose = useQuery(api.homes.loose, {});
  const [attaching, setAttaching] = useState<{ kind: HomeKind; id: string; name: string } | null>(null);
  const [toast, show] = useToast();
  const byKind = useMemo(() => {
    const m = new Map<HomeKind, NonNullable<typeof loose>>();
    for (const x of loose ?? []) m.set(x.kind as HomeKind, [...(m.get(x.kind as HomeKind) ?? []), x]);
    return [...m.entries()];
  }, [loose]);
  return (
    <>
      <Crumbs here="Not attached" />
      <div className="wp-page hm">
        <PageHeader eyebrow="Projects" title="Not attached." sub="Things made on their own. Give each a home when you are ready, or leave it here." />
        {loose === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card>
          : loose.length === 0 ? <EmptyState icon="attach" title="Everything has a home" body="Shot lists, quotes, briefs and the rest made on their own wait here until you attach them." />
          : byKind.map(([kind, rows]) => (
              <Card key={kind} className="hm-kind" label={KIND[kind].many}>
                <header className="hm-khead"><Icon name={KIND[kind].icon} size={18} /><b>{KIND[kind].many}</b><span className="secondary">{rows.length}</span></header>
                {rows.map((x) => {
                  const open = KIND[kind].open?.(x.id);
                  return (
                    <div key={x.id} className="hm-krow">
                      {open ? <a className="t" {...linkProps(open)}>{x.name}</a> : <span className="t">{x.name}</span>}
                      <span className="secondary">{new Date(x.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      <button type="button" className="btn sm" onClick={() => setAttaching({ kind, id: x.id, name: x.name })}><Icon name="attach" size={16} />Attach to…</button>
                    </div>
                  );
                })}
              </Card>
            ))}
      </div>
      {attaching && <AttachDialog {...attaching} hasHome={false} onClose={() => setAttaching(null)} show={show} />}
      {toast}
    </>
  );
}
export type { Id };
