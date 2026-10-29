// Contracts, the front page (B1, Oct 27): New document · Templates · Docs, plus what's happening now.
import { useState } from "react";
import { useQuery } from "convex/react";
import { Bot, ChevronRight, FilePlus2, FileSignature, Files, LayoutTemplate, MoreHorizontal, PenLine } from "lucide-react";
import { useToast } from "../../../ui/kit";
import { DocMenu, menuOpeners, type MenuAt, type MenuDoc } from "./DocMenu";
import { api } from "../../../../convex/_generated/api";
import { TopBar } from "../../../shell/Shell";
import { linkProps, navigate } from "../../../lib/router";
import { central, StatusChip } from "./common";
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
  const card = (to: string, icon: React.ReactNode, title: string, text: string, meta: React.ReactNode) => (
    <a className="ws-hubcard" {...linkProps(to)}>
      <span className="ws-hubicon">{icon}</span>
      <span className="ws-hubtext"><b>{title}</b><span className="secondary">{text}</span>{meta && <span className="ws-hubmeta">{meta}</span>}</span>
      <ChevronRight size={18} className="ws-hubgo" />
    </a>
  );
  return (
    <>
      <TopBar right={<>
        <a className="btn ghost sm hide-sm" {...linkProps("/sign/connector")}><Bot size={15} />Claude connector</a>
        <a className="btn ghost sm" {...linkProps("/sign/signature")}><PenLine size={15} />Your signature</a>
      </>}>
        <FileSignature size={15} /><span className="here">Contracts</span>
      </TopBar>
      <div className="content">
        <div className="ws-list">
          <div className="reghead"><div>
            <span className="eyebrow">Wrangler Sign</span>
            <h1 className="headline">Contracts. <span className="rest">Write it, send it, get it signed.</span></h1>
          </div></div>
          <SignNotices />
          <div className="ws-hub">
            {card("/sign/new", <FilePlus2 size={22} />, "New document", "Build one from blocks or a template, or upload a finished PDF.", null)}
            {card("/sign/templates", <LayoutTemplate size={22} />, "Templates", "Start from a saved document. Edit, duplicate or delete them, and keep a library of clauses.", templates ? `${templates.length} template${templates.length === 1 ? "" : "s"}` : null)}
            {card("/sign/docs", <Files size={22} />, "Docs", "Every document: drafts, out for signature, signed. Filter, search and sort.", c ? <>{c.draft} draft{c.draft === 1 ? "" : "s"} · {c.sent} out for signature · {c.completed} signed</> : null)}
          </div>
          {recent.length > 0 && (
            <section className="ws-recent">
              <div className="ws-cardhead"><span className="label">Recent</span><a className="btn ghost sm" {...linkProps("/sign/docs")}>All docs</a></div>
              <div className="regwrap">
                <table className="regtable ws-table"><tbody>
                  {recent.map((d) => (
                    <tr key={d._id} onClick={() => navigate(`/sign/d/${d._id}`)} style={{ cursor: "pointer" }} tabIndex={0} className={menu?.doc._id === d._id ? "ws-menurow" : undefined} {...menuOpeners(md(d), setMenu)}>
                      <td className="num mono">{d.label}</td>
                      <td><a {...linkProps(`/sign/d/${d._id}`)} onClick={(e) => e.stopPropagation()}>{d.title}</a></td>
                      <td className="hide-sm secondary">{d.signers.filter(Boolean).join(", ") || "—"}</td>
                      <td><StatusChip status={d.status} /></td>
                      <td className="hide-sm secondary">{central(d.updatedAt)}</td>
                      <td className="ws-more"><button className="icon-btn" aria-label={`Actions for ${d.label === "—" ? d.title : d.label}`} aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ doc: md(d), x: r.right - 200, y: r.bottom + 4 }); }}><MoreHorizontal size={16} /></button></td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            </section>
          )}
          {menu && <DocMenu at={menu} onClose={() => setMenu(null)} show={show} />}
          {toast}
        </div>
      </div>
    </>
  );
}
