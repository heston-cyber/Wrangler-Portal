// Contracts › Docs (B1, Oct 27): every document, with status tabs, search, sort and a date filter. The filter lives in
// the address, so a filtered list can be bookmarked and Back works.
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { ArrowDown, ArrowUp, FilePlus2, FileSignature, MoreHorizontal, Search, X } from "lucide-react";
import { useToast } from "../../ui/kit";
import { DocMenu, menuOpeners, type MenuAt, type MenuDoc } from "./DocMenu";
import { api } from "../../../convex/_generated/api";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate, useLocation } from "../../lib/router";
import { central, StatusChip } from "./common";
import { countByStatus, filterDocs, RANGES, readQuery, SORTS, TABS, writeQuery, type DocQuery, type SortKey } from "../../sign/docFilter";

export default function SignDocs() {
  const signDocs = useQuery(api.sign.list);
  const builds = useQuery(api.builder.listBuilds);
  // Documents still in the builder (not yet gone to signing) show as drafts too.
  const docs = useMemo(() => signDocs === undefined || builds === undefined ? undefined : [
    ...signDocs.map((d) => ({ ...d, href: `/sign/d/${d._id}`, inBuilder: false, buildId: d.buildId ?? null })),
    ...builds.filter((b) => !b.documentId).map((b) => ({ _id: b._id, label: "—", number: 0, title: b.title, status: "draft" as const, version: 0, signers: b.client ? [b.client] : [], emails: [], createdAt: b.createdAt, updatedAt: b.updatedAt, sentAt: null, completedAt: null, amount: null, pages: 0, approved: false, fromBuilder: true, href: `/sign/b/${b._id}`, inBuilder: true, buildId: null })),
  ], [signDocs, builds]);
  const { search } = useLocation();
  const q = readQuery(search);
  const set = (patch: Partial<DocQuery>) => { const next = { ...q, ...patch }; history.replaceState(null, "", `/sign/docs${writeQuery(next)}`); window.dispatchEvent(new Event("wr:navigate")); };
  const rows = useMemo(() => (docs ? filterDocs(docs, q) : []), [docs, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = docs ? countByStatus(docs) : null;
  const sortBy = (k: SortKey) => set(q.sort === k ? { dir: q.dir === "asc" ? "desc" : "asc" } : { sort: k, dir: k === "title" || k === "client" ? "asc" : "desc" });
  const Th = ({ k, children, cls }: { k: SortKey; children: React.ReactNode; cls?: string }) => (
    <th scope="col" className={cls} aria-sort={q.sort === k ? (q.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button className="ws-thbtn" onClick={() => sortBy(k)}>{children}{q.sort === k && (q.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button>
    </th>
  );
  const filtered = q.q || q.range !== "any";
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [toast, show] = useToast();
  const md = (d: { _id: string; label: string; title: string; status: MenuDoc["status"]; inBuilder: boolean; buildId: string | null; hidden?: boolean }): MenuDoc => ({ _id: d._id, label: d.label, title: d.title, status: d.status, inBuilder: d.inBuilder, buildId: d.buildId, hidden: d.hidden });
  return (
    <>
      <TopBar right={<a className="btn primary sm" {...linkProps("/sign/new")}><FilePlus2 size={15} />New document</a>}>
        <FileSignature size={15} /><a {...linkProps("/sign")}>Contracts</a><Sep /><span className="here">Docs</span>
      </TopBar>
      <div className="content">
        <div className="ws-list">
          <div className="tabs" role="tablist" aria-label="Status">
            {TABS.filter((t) => t.key !== "hidden" || (counts?.hidden ?? 0) > 0 || q.status === "hidden").map((t) => (
              <button key={t.key} className="tab" role="tab" aria-selected={q.status === t.key} onClick={() => set({ status: t.key })}>{t.label}{counts && <span className="count">{counts[t.key]}</span>}</button>
            ))}
          </div>
          <div className="ws-filters">
            <label className="ws-search"><Search size={15} /><input className="input sm" placeholder="Search title, number or client" value={q.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search" />{q.q && <button className="icon-btn" aria-label="Clear search" onClick={() => set({ q: "" })}><X size={14} /></button>}</label>
            <select className="input sm" value={q.range} onChange={(e) => set({ range: e.target.value as DocQuery["range"] })} aria-label="Updated">
              {RANGES.map((r) => <option key={r.key} value={r.key}>{r.key === "any" ? "Updated any time" : `Updated ${r.label.toLowerCase()}`}</option>)}
            </select>
            <select className="input sm" value={q.sort} onChange={(e) => set({ sort: e.target.value as SortKey })} aria-label="Sort by">
              {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
            </select>
            <button className="btn ghost sm" onClick={() => set({ dir: q.dir === "asc" ? "desc" : "asc" })} aria-label={q.dir === "asc" ? "Ascending" : "Descending"}>{q.dir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}{q.dir === "asc" ? "Ascending" : "Descending"}</button>
          </div>
          {docs === undefined ? <p className="caption" style={{ padding: 18 }}>Loading…</p>
            : rows.length === 0 ? <div className="empty">{docs.length === 0 ? "No documents yet." : filtered || q.status !== "all" ? <>Nothing matches. <button className="btn ghost sm" onClick={() => navigate("/sign/docs")}>Clear filters</button></> : "No documents yet."}</div>
            : (
              <div className="regwrap">
                <table className="regtable ws-table">
                  <thead><tr><Th k="number">No.</Th><Th k="title">Document</Th><Th k="client" cls="hide-sm">Client</Th><th scope="col">Status</th><Th k="updated" cls="hide-sm">Updated</Th><th aria-label="Actions" /></tr></thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d._id} onClick={() => navigate(d.href)} style={{ cursor: "pointer" }} tabIndex={0} className={menu?.doc._id === d._id ? "ws-menurow" : undefined} {...menuOpeners(md(d), setMenu)}>
                        <td className="num mono">{d.label}</td>
                        <td><a {...linkProps(d.href)} onClick={(e) => e.stopPropagation()}>{d.title}</a> <span className="secondary">{d.inBuilder ? "· in the builder" : `· v${d.version}`}{d.amount ? ` · $${d.amount.toLocaleString("en-US")}` : ""}</span></td>
                        <td className="hide-sm secondary">{d.signers.filter(Boolean).join(", ") || "—"}</td>
                        <td><StatusChip status={d.status} /></td>
                        <td className="hide-sm secondary">{central(d.updatedAt)}</td>
                        <td className="ws-more"><button className="icon-btn" aria-label={`Actions for ${d.label === "—" ? d.title : d.label}`} aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ doc: md(d), x: r.right - 200, y: r.bottom + 4 }); }}><MoreHorizontal size={16} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          {docs && rows.length > 0 && <p className="caption secondary">{rows.length} of {q.status === "hidden" ? counts!.hidden : counts!.all} document{(q.status === "hidden" ? counts!.hidden : counts!.all) === 1 ? "" : "s"}{q.status === "hidden" ? " removed from the list (kept for the record)" : ""} · right-click a row (or ⋯) for actions</p>}
          {menu && <DocMenu at={menu} onClose={() => setMenu(null)} show={show} />}
          {toast}
        </div>
      </div>
    </>
  );
}
