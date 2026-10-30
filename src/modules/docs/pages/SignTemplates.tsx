// Docs › Templates (B3; Phase 1 look Oct 29, frames 93:1920 and 93:2393): saved templates (use, edit, duplicate, delete) and the clause library (new, edit,
// duplicate, delete, search). The Service Agreement starter and its clauses are added the first time this opens.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Sep, TopBar } from "../../../shell/Shell";
import { linkProps, navigate, useLocation } from "../../../lib/router";
import { Modal, Spinner, useToast } from "../../../ui/kit";
import { errText } from "./common";
import { Icon } from "../../../ui/Icon";
import { Button, ButtonLink, EmptyState, IconButton, PageHeader, SkeletonRows, StatusChip, Tabs } from "../../../ui/wp";
import { RichEditor } from "../builder/RichEditor";
import { plainText, rich, type Rich } from "../../../../convex/lib/wsBuilder";

// "Oct 26" (Chicago), with the year when it isn't this year.
const dayOf = (t: number) => { const tz = "America/Chicago"; const y = (x: number) => new Date(x).toLocaleDateString("en-US", { timeZone: tz, year: "numeric" }); return new Date(t).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", ...(y(t) === y(Date.now()) ? {} : { year: "numeric" }) }); };

export default function SignTemplates() {
  const { search } = useLocation();
  const tab = new URLSearchParams(search).get("tab") === "clauses" ? "clauses" : "templates";
  const setTab = (t: string) => { history.replaceState(null, "", t === "clauses" ? "/sign/templates?tab=clauses" : "/sign/templates"); window.dispatchEvent(new Event("wr:navigate")); };
  const ensure = useMutation(api.builder.ensureStarter);
  const once = useRef(false);
  const [toast, show] = useToast();
  useEffect(() => { if (once.current) return; once.current = true; ensure({}).then((r) => { if (r.added) show("Added your Service Agreement as a starter template, and its clauses to the library."); }).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <TopBar><a {...linkProps("/sign")}>Docs</a><Sep /><span className="here">Templates</span></TopBar>
      <div className="wp-page docs">
        <div className="ws-tabs"><Tabs label="Templates or clauses" value={tab} onChange={setTab} items={[{ key: "templates", label: "Templates" }, { key: "clauses", label: "Clause library" }]} /></div>
        {tab === "templates" ? <Templates show={show} /> : <Clauses show={show} />}
      </div>
      {toast}
    </>
  );
}

function Templates({ show }: { show: (m: string) => void }) {
  const list = useQuery(api.builder.listTemplates);
  const createBuild = useMutation(api.builder.createBuild);
  const duplicate = useMutation(api.builder.duplicateTemplate);
  const del = useMutation(api.builder.deleteTemplate);
  const [deleting, setDeleting] = useState<{ _id: Id<"wsTemplates">; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const header = <PageHeader title="Templates." sub="Start new documents from these. Save any document as a template from the builder." />;
  if (list === undefined) return <>{header}<div className="wp-tablecard glass"><SkeletonRows n={2} /></div></>;
  return (
    <>
      {header}
      {list.length === 0 ? <EmptyState icon="folder" title="No templates yet." /> : (
        <div className="wst-grid">
          {list.map((t) => (
            <div key={t._id} className="wst-card glass">
              <span className="wst-mini" aria-hidden><i /><i /><i /><i /><i /><i /></span>
              <span className="ttl">{t.name}</span>
              <span className="txt">{t.description || `${t.blocks} blocks`}</span>
              <span className="meta">{t.styleName ? `${t.styleName} style · ` : ""}updated {dayOf(t.updatedAt)}</span>
              <div className="wst-actions">
                <Button variant="primary" size="sm" loading={busy === t._id} onClick={async () => { setBusy(t._id); try { navigate(`/sign/b/${await createBuild({ templateId: t._id })}`); } catch (e) { show(errText(e)); setBusy(null); } }}>Use</Button>
                <ButtonLink variant="ghost" size="sm" to={`/sign/templates/${t._id}`}>Edit</ButtonLink>
                <Button variant="ghost" size="sm" onClick={async () => { try { await duplicate({ templateId: t._id }); show(`Duplicated "${t.name}"`); } catch (e) { show(errText(e)); } }}>Duplicate</Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleting(t)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {deleting && (
        <Modal onClose={() => setDeleting(null)} label="Delete template" width={420}>
          <div style={{ display: "grid", gap: 12 }}>
            <h2 className="headline">Delete "{deleting.name}"?</h2>
            <p className="caption">Documents already made from it keep their own copy. This can't be undone.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button className="btn ghost" onClick={() => setDeleting(null)}>Keep it</button><button className="btn danger" onClick={async () => { await del({ templateId: deleting._id }); setDeleting(null); show("Template deleted"); }}>Delete</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

type Clause = { _id: Id<"wsClauses">; title: string; body: unknown; initials: boolean; updatedAt: number };

function Clauses({ show }: { show: (m: string) => void }) {
  const list = useQuery(api.builder.listClauses) as Clause[] | undefined;
  const duplicate = useMutation(api.builder.duplicateClause);
  const del = useMutation(api.builder.deleteClause);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Clause | "new" | null>(null);
  const [deleting, setDeleting] = useState<Clause | null>(null);
  const header = <PageHeader title="Clause library." sub="Reusable clauses to drop into any document or template (Insert › Clause library in the builder)." />;
  if (list === undefined) return <>{header}<div className="wp-tablecard glass"><SkeletonRows n={3} /></div></>;
  const rows = list.filter((c) => !q || `${c.title} ${plainText(c.body as Rich)}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      {header}
      <div className="ws-filters clauses">
        <label className="ws-search"><Icon name="search" size={16} /><input placeholder="Search clauses" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clauses" />{q && <IconButton icon="close" label="Clear search" bare className="sm" iconSize={16} onClick={() => setQ("")} />}</label>
        <Button variant="primary" size="sm" onClick={() => setEditing("new")}>New clause</Button>
      </div>
      {rows.length === 0 ? <EmptyState icon={list.length ? "search" : "note"} title={list.length ? "No clause matches." : "No clauses yet."} /> : (
        <div className="wst-clauses">{rows.map((c) => (
          <div key={c._id} className="wst-clause glass">
            <div className="wst-head">
              <Icon name="note" size={16} /><span className="ttl">{c.title}</span>{c.initials && <StatusChip>Client initials</StatusChip>}
              <span className="sp" />
              <span className="wst-actions">
                <Button variant="ghost" size="sm" onClick={() => setEditing(c)} iconEnd="edit">Edit</Button>
                <Button variant="ghost" size="sm" onClick={async () => { await duplicate({ clauseId: c._id }); show(`Duplicated "${c.title}"`); }}>Duplicate</Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleting(c)}>Delete</Button>
              </span>
            </div>
            <p className="wst-snip">{plainText(c.body as Rich).slice(0, 220)}</p>
          </div>
        ))}</div>
      )}
      {editing && <ClauseEditor clause={editing === "new" ? null : editing} onClose={() => setEditing(null)} show={show} />}
      {deleting && (
        <Modal onClose={() => setDeleting(null)} label="Delete clause" width={420}>
          <div style={{ display: "grid", gap: 12 }}>
            <h2 className="headline">Delete "{deleting.title}"?</h2>
            <p className="caption">Documents and templates that already use it keep their own copy.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button className="btn ghost" onClick={() => setDeleting(null)}>Keep it</button><button className="btn danger" onClick={async () => { await del({ clauseId: deleting._id }); setDeleting(null); show("Clause deleted"); }}>Delete</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

function ClauseEditor({ clause, onClose, show }: { clause: Clause | null; onClose: () => void; show: (m: string) => void }) {
  const save = useMutation(api.builder.saveClause);
  const [title, setTitle] = useState(clause?.title ?? "");
  const [body, setBody] = useState<Rich>((clause?.body as Rich) ?? rich(""));
  const [initials, setInitials] = useState(clause?.initials ?? false);
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} label={clause ? "Edit clause" : "New clause"} width={620}>
      <div style={{ display: "grid", gap: 12 }}>
        <div className="dhead"><h2 className="headline">{clause ? "Edit clause" : "New clause"}</h2><IconButton icon="close" label="Close" onClick={onClose} /></div>
        <label className="field"><span className="ws-flabel">Title</span><input className="input sm" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Revisions" /></label>
        <div className="wst-editor"><RichEditor value={body} onChange={setBody} placeholder="The clause's wording. Fill-in fields like {client.name} work here too." /></div>
        <label className="wsb-check"><input type="checkbox" checked={initials} onChange={(e) => setInitials(e.target.checked)} />Ask the client to initial it</label>
        <p className="caption secondary">Changing it here doesn't change documents that already use it.</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!title.trim() || busy} onClick={async () => { setBusy(true); try { await save({ clauseId: clause?._id, title, body, initials }); show(clause ? "Clause saved" : "Clause added"); onClose(); } catch (e) { show(errText(e)); setBusy(false); } }}>{busy ? <Spinner /> : null}Save</button></div>
      </div>
    </Modal>
  );
}
