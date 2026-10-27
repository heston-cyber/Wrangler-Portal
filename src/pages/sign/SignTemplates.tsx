// Contracts › Templates (B3): saved templates (use, edit, duplicate, delete) and the clause library (new, edit,
// duplicate, delete, search). The Service Agreement starter and its clauses are added the first time this opens.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Copy, FileSignature, LayoutTemplate, Pencil, Plus, ScrollText, Search, Trash2, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate, useLocation } from "../../lib/router";
import { Modal, Spinner, useToast } from "../../ui/kit";
import { central, errText } from "./common";
import { RichEditor } from "../../builder/RichEditor";
import { plainText, rich, type Rich } from "../../../convex/lib/wsBuilder";

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
      <TopBar><FileSignature size={15} /><a {...linkProps("/sign")}>Contracts</a><Sep /><span className="here">Templates</span></TopBar>
      <div className="content">
        <div className="ws-list">
          <div className="tabs" role="tablist">
            <button className="tab" role="tab" aria-selected={tab === "templates"} onClick={() => setTab("templates")}><LayoutTemplate size={14} />Templates</button>
            <button className="tab" role="tab" aria-selected={tab === "clauses"} onClick={() => setTab("clauses")}><ScrollText size={14} />Clause library</button>
          </div>
          {tab === "templates" ? <Templates show={show} /> : <Clauses show={show} />}
        </div>
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
  if (list === undefined) return <Spinner />;
  return (
    <>
      <h1 className="headline">Templates. <span className="rest">Start new documents from these. Save any document as a template from the builder.</span></h1>
      {list.length === 0 ? <div className="empty">No templates yet.</div> : (
        <div className="wst-grid">
          {list.map((t) => (
            <div key={t._id} className="wst-card">
              <div className="wst-head"><LayoutTemplate size={18} /><b>{t.name}</b></div>
              <span className="secondary caption">{t.description || `${t.blocks} blocks`}</span>
              <span className="secondary ws-small">{t.styleName ? `${t.styleName} style · ` : ""}updated {central(t.updatedAt)}</span>
              <div className="wst-actions">
                <button className="btn primary sm" disabled={busy === t._id} onClick={async () => { setBusy(t._id); try { navigate(`/sign/b/${await createBuild({ templateId: t._id })}`); } catch (e) { show(errText(e)); setBusy(null); } }}>{busy === t._id ? <Spinner /> : <Plus size={14} />}Use</button>
                <a className="btn ghost sm" {...linkProps(`/sign/templates/${t._id}`)}><Pencil size={14} />Edit</a>
                <button className="btn ghost sm" onClick={async () => { try { await duplicate({ templateId: t._id }); show(`Duplicated "${t.name}"`); } catch (e) { show(errText(e)); } }}><Copy size={14} />Duplicate</button>
                <button className="btn ghost sm danger-text" onClick={() => setDeleting(t)}><Trash2 size={14} />Delete</button>
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
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button className="btn ghost" onClick={() => setDeleting(null)}>Keep it</button><button className="btn danger" onClick={async () => { await del({ templateId: deleting._id }); setDeleting(null); show("Template deleted"); }}><Trash2 size={15} />Delete</button></div>
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
  if (list === undefined) return <Spinner />;
  const rows = list.filter((c) => !q || `${c.title} ${plainText(c.body as Rich)}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <h1 className="headline">Clause library. <span className="rest">Reusable clauses to drop into any document or template (Insert › Clause library in the builder).</span></h1>
      <div className="ws-filters">
        <label className="ws-search"><Search size={15} /><input className="input sm" placeholder="Search clauses" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <button className="btn primary sm" onClick={() => setEditing("new")}><Plus size={14} />New clause</button>
      </div>
      {rows.length === 0 ? <div className="empty">{list.length ? "No clause matches." : "No clauses yet."}</div> : (
        <div className="wst-clauses">{rows.map((c) => (
          <div key={c._id} className="wst-clause">
            <div className="wst-head"><ScrollText size={16} /><b>{c.title}</b>{c.initials && <span className="chip">client initials</span>}</div>
            <p className="caption secondary wst-snip">{plainText(c.body as Rich).slice(0, 220)}</p>
            <div className="wst-actions">
              <button className="btn ghost sm" onClick={() => setEditing(c)}><Pencil size={14} />Edit</button>
              <button className="btn ghost sm" onClick={async () => { await duplicate({ clauseId: c._id }); show(`Duplicated "${c.title}"`); }}><Copy size={14} />Duplicate</button>
              <button className="btn ghost sm danger-text" onClick={() => setDeleting(c)}><Trash2 size={14} />Delete</button>
            </div>
          </div>
        ))}</div>
      )}
      {editing && <ClauseEditor clause={editing === "new" ? null : editing} onClose={() => setEditing(null)} show={show} />}
      {deleting && (
        <Modal onClose={() => setDeleting(null)} label="Delete clause" width={420}>
          <div style={{ display: "grid", gap: 12 }}>
            <h2 className="headline">Delete "{deleting.title}"?</h2>
            <p className="caption">Documents and templates that already use it keep their own copy.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button className="btn ghost" onClick={() => setDeleting(null)}>Keep it</button><button className="btn danger" onClick={async () => { await del({ clauseId: deleting._id }); setDeleting(null); show("Clause deleted"); }}><Trash2 size={15} />Delete</button></div>
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
        <div className="dhead"><h2 className="headline">{clause ? "Edit clause" : "New clause"}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
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
