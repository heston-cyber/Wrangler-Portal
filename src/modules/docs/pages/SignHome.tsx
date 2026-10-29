// Docs, the front page (B1, Oct 27; Phase 1 look Oct 29, frame 90:3): New document · Templates · Docs, plus what's
// happening now.
import { useState } from "react";
import { useQuery } from "convex/react";
import { useToast } from "../../../ui/kit";
import { Icon, type IconName } from "../../../ui/Icon";
import { ButtonLink, PageHeader } from "../../../ui/wp";
import { DocMenu, menuOpeners, type MenuAt, type MenuDoc } from "./DocMenu";
import { api } from "../../../../convex/_generated/api";
import { TopBar } from "../../../shell/Shell";
import { linkProps, navigate } from "../../../lib/router";
import { central, shortWhen, StatusChip } from "./common";
import { countByStatus } from "../lib/docFilter";
import { SignNotices } from "./SignNotices";

export default function SignHome() {
  const docs = useQuery(api.sign.list);
  const templates = useQuery(api.builder.listTemplates);
  const c = docs ? countByStatus(docs) : null;
  const recent = (docs ?? []).filter((d) => !d.hidden).slice(0, 5);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [toast, show] = useToast();
  const md = (d: NonNullable<typeof docs>[number]): MenuDoc => ({ _id: d._id, label: d.label, title: d.title, status: d.status, inBuilder: false, buildId: d.buildId ?? null, hidden: d.hidden });
  const card = (to: string, icon: IconName, title: string, text: string, meta: React.ReactNode) => (
    <a className="wp-hubcard glass" {...linkProps(to)}>
      <span className="top"><Icon name={icon} size={24} /><span className="sp" /><Icon name="chevron-right" size={16} /></span>
      <span className="ttl">{title}</span>
      <span className="txt">{text}</span>
      {meta && <span className="meta">{meta}</span>}
    </a>
  );
  return (
    <>
      <TopBar right={<>
        <ButtonLink variant="ghost" size="sm" className="hide-sm" to="/sign/connector">Claude connector</ButtonLink>
        <ButtonLink variant="ghost" size="sm" className="hide-sm" to="/sign/signature">Your signature</ButtonLink>
      </>}>
        <span className="here">Docs</span>
      </TopBar>
      <div className="wp-page docs home">
        <PageHeader eyebrow="Wrangler Sign" title="Contracts." sub="Write it, send it, get it signed." />
        <SignNotices />
        <div className="wp-hub">
          {card("/sign/new", "plus", "New document", "Build one from blocks or a template, or upload a finished PDF.", null)}
          {card("/sign/templates", "folder", "Templates", "Start from a saved document. Edit, duplicate or delete them, and keep a library of clauses.", templates ? `${templates.length} template${templates.length === 1 ? "" : "s"}` : null)}
          {card("/sign/docs", "document", "Docs", "Every document: drafts, out for signature, signed. Filter, search and sort.", c ? <>{c.draft} draft{c.draft === 1 ? "" : "s"} · {c.sent} out for signature · {c.completed} signed</> : null)}
        </div>
        {recent.length > 0 && (
          <>
            <div className="wp-listhead"><span className="wp-eyebrow">Recent</span><ButtonLink variant="ghost" size="sm" to="/sign/docs">All docs</ButtonLink></div>
            <div className="wp-tablecard glass">
              <table className="wp-table ws-table">
                <colgroup><col className="c-num" /><col /><col className="c-who" /><col className="c-status" /><col className="c-when" /><col className="c-more" /></colgroup>
                <thead><tr><th scope="col" className="hide-sm">No.</th><th scope="col">Document</th><th scope="col" className="hide-sm">Signers</th><th scope="col">Status</th><th scope="col" className="hide-sm">Updated</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {recent.map((d) => (
                    <tr key={d._id} onClick={() => navigate(`/sign/d/${d._id}`)} tabIndex={0} className={menu?.doc._id === d._id ? "ws-menurow" : undefined} {...menuOpeners(md(d), setMenu)}>
                      <td className="num hide-sm">{d.label}</td>
                      <td className="ttl"><a {...linkProps(`/sign/d/${d._id}`)} onClick={(e) => e.stopPropagation()}>{d.title}</a></td>
                      <td className="hide-sm">{d.signers.filter(Boolean).join(", ") || "—"}</td>
                      <td><StatusChip status={d.status} /></td>
                      <td className="hide-sm" title={central(d.updatedAt)}>{shortWhen(d.updatedAt)}</td>
                      <td className="ws-more"><button className="icon-btn bare sm" aria-label={`Actions for ${d.label === "—" ? d.title : d.label}`} aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ doc: md(d), x: r.right - 200, y: r.bottom + 4 }); }}><Icon name="more" size={18} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {menu && <DocMenu at={menu} onClose={() => setMenu(null)} show={show} />}
        {toast}
      </div>
    </>
  );
}
