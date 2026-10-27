// Contracts, the front page (B1, Oct 27): New document · Templates · Docs, plus what's happening now.
import { useQuery } from "convex/react";
import { Bot, ChevronRight, FilePlus2, FileSignature, Files, LayoutTemplate, PenLine } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { central, StatusChip } from "./common";
import { countByStatus } from "../../sign/docFilter";
import { SignNotices } from "./SignNotices";

export default function SignHome() {
  const docs = useQuery(api.sign.list);
  const templates = useQuery(api.builder.listTemplates);
  const c = docs ? countByStatus(docs) : null;
  const recent = (docs ?? []).slice(0, 5);
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
                    <tr key={d._id} onClick={() => navigate(`/sign/d/${d._id}`)} style={{ cursor: "pointer" }}>
                      <td className="num mono">{d.label}</td>
                      <td><a {...linkProps(`/sign/d/${d._id}`)} onClick={(e) => e.stopPropagation()}>{d.title}</a></td>
                      <td className="hide-sm secondary">{d.signers.filter(Boolean).join(", ") || "—"}</td>
                      <td><StatusChip status={d.status} /></td>
                      <td className="hide-sm secondary">{central(d.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
