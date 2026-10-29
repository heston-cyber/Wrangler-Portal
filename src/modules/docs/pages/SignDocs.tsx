// Docs › All docs (B1, Oct 27; Phase 1 look Oct 29, frame 90:2781): every document, with status tabs, search, sort and a date filter. The filter lives in
// the address, so a filtered list can be bookmarked and Back works.
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useToast } from "../../../ui/kit";
import { Icon } from "../../../ui/Icon";
import { Button, ButtonLink, EmptyState, IconButton, SkeletonRows, Tabs } from "../../../ui/wp";
import { DocMenu, menuOpeners, type MenuAt, type MenuDoc } from "./DocMenu";
import { api } from "../../../../convex/_generated/api";
import { Sep, TopBar } from "../../../shell/Shell";
import { linkProps, navigate, useLocation } from "../../../lib/router";
import { central, shortWhen, StatusChip } from "./common";
import { countByStatus, filterDocs, RANGES, readQuery, SORTS, TABS, writeQuery, type DocQuery, type SortKey } from "../lib/docFilter";

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
      <button className="ws-thbtn" onClick={() => sortBy(k)}>{children}{q.sort === k && <Icon name={q.dir === "asc" ? "arrow-up" : "arrow-down"} size={12} />}</button>
    </th>
  );
  const filtered = q.q || q.range !== "any";
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [toast, show] = useToast();
  const md = (d: { _id: string; label: string; title: string; status: MenuDoc["status"]; inBuilder: boolean; buildId: string | null; hidden?: boolean }): MenuDoc => ({ _id: d._id, label: d.label, title: d.title, status: d.status, inBuilder: d.inBuilder, buildId: d.buildId, hidden: d.hidden });
  const tabs = TABS.filter((t) => t.key !== "hidden" || (counts?.hidden ?? 0) > 0 || q.status === "hidden").map((t) => ({ key: t.key, label: t.label, count: counts ? counts[t.key] : undefined }));
  const total = counts ? (q.status === "hidden" ? counts.hidden : counts.all) : 0;
  return (
    <>
      <TopBar right={<ButtonLink variant="primary" size="sm" icon="document" className="ws-newbtn" to="/sign/new"><span className="long">New document</span><span className="short">New</span></ButtonLink>}>
        <a {...linkProps("/sign")}>Docs</a><Sep /><span className="here">All docs</span>
      </TopBar>
      <div className="wp-page docs">
        <div className="ws-tabs"><Tabs label="Status" value={q.status} onChange={(k) => set({ status: k })} items={tabs} /></div>
        <div className="ws-filters">
          <label className="ws-search">
            <Icon name="search" size={16} />
            <input placeholder="Search title, number or client" value={q.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search" />
            {q.q && <IconButton icon="close" label="Clear search" bare className="sm" iconSize={16} onClick={() => set({ q: "" })} />}
          </label>
          <span className="ws-select">
            <select value={q.range} onChange={(e) => set({ range: e.target.value as DocQuery["range"] })} aria-label="Updated">
              {RANGES.map((r) => <option key={r.key} value={r.key}>{r.key === "any" ? "Updated any time" : `Updated ${r.label.toLowerCase()}`}</option>)}
            </select>
            <Icon name="chevron-down" size={14} />
          </span>
          <span className="ws-select">
            <select value={q.sort} onChange={(e) => set({ sort: e.target.value as SortKey })} aria-label="Sort by">
              {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
            </select>
            <Icon name="chevron-down" size={14} />
          </span>
          <Button size="sm" className="ws-dir" onClick={() => set({ dir: q.dir === "asc" ? "desc" : "asc" })} aria-label={q.dir === "asc" ? "Ascending" : "Descending"}><span className="long">{q.dir === "asc" ? "Ascending" : "Descending"}</span><Icon name={q.dir === "asc" ? "arrow-up" : "arrow-down"} size={16} /></Button>
        </div>
        {docs === undefined ? <div className="wp-tablecard glass"><SkeletonRows n={4} /></div>
          : rows.length === 0 ? (
            docs.length === 0 || !(filtered || q.status !== "all")
              ? <EmptyState icon="document" title="No documents yet." actions={<ButtonLink variant="primary" to="/sign/new">New document</ButtonLink>} />
              : <EmptyState icon="search" title="Nothing matches." actions={<Button onClick={() => navigate("/sign/docs")}>Clear filters</Button>} />
          ) : (
            <div className="wp-tablecard glass">
              <table className="wp-table ws-table">
                <colgroup><col className="c-num" /><col /><col className="c-who" /><col className="c-status" /><col className="c-when" /><col className="c-more" /></colgroup>
                <thead><tr><Th k="number" cls="hide-sm">No.</Th><Th k="title">Document</Th><Th k="client" cls="hide-sm">Client</Th><th scope="col">Status</th><Th k="updated" cls="hide-sm">Updated</Th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d._id} onClick={() => navigate(d.href)} tabIndex={0} className={menu?.doc._id === d._id ? "ws-menurow" : undefined} {...menuOpeners(md(d), setMenu)}>
                      <td className="num hide-sm">{d.label}</td>
                      <td className="ttl"><a {...linkProps(d.href)} onClick={(e) => e.stopPropagation()}>{d.title}</a><span className="sub hide-sm"> {d.inBuilder ? "· in the builder" : `· v${d.version}`}{d.amount ? ` · $${d.amount.toLocaleString("en-US")}` : ""}</span></td>
                      <td className="hide-sm">{d.signers.filter(Boolean).join(", ") || "—"}</td>
                      <td><StatusChip status={d.status} /></td>
                      <td className="hide-sm" title={central(d.updatedAt)}>{shortWhen(d.updatedAt)}</td>
                      <td className="ws-more"><button className="icon-btn bare sm" aria-label={`Actions for ${d.label === "—" ? d.title : d.label}`} aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ doc: md(d), x: r.right - 200, y: r.bottom + 4 }); }}><Icon name="more" size={18} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {docs && rows.length > 0 && <p className="wp-small ws-foot">{rows.length} of {total} document{total === 1 ? "" : "s"}{q.status === "hidden" ? " removed from the list (kept for the record)" : ""} · right-click a row (or ⋯) for actions</p>}
        {menu && <DocMenu at={menu} onClose={() => setMenu(null)} show={show} />}
        {toast}
      </div>
    </>
  );
}
