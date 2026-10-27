// Contracts › New document (B1–B3): start blank in the builder, start from a template, continue a draft, or upload a
// finished PDF (the original way).
import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { FilePen, FilePlus2, FileSignature, FileUp, LayoutTemplate, PencilLine, Trash2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { Spinner, useConfirm, useToast } from "../../ui/kit";
import { central, errText, uploadToStorage } from "./common";

export default function SignNew() {
  const templates = useQuery(api.builder.listTemplates);
  const builds = useQuery(api.builder.listBuilds);
  const createBuild = useMutation(api.builder.createBuild);
  const deleteBuild = useMutation(api.builder.deleteBuild);
  const uploadUrl = useMutation(api.sign.uploadUrl);
  const create = useAction(api.sign.create);
  const importPdf = useAction(api.builder.importPdf);
  const builderUpload = useMutation(api.builder.uploadUrl);
  const importInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const [toast, show] = useToast();
  const input = useRef<HTMLInputElement>(null);
  const start = async (templateId?: Id<"wsTemplates">) => {
    setBusy(templateId ?? "blank");
    try { navigate(`/sign/b/${await createBuild(templateId ? { templateId } : {})}`); } catch (e) { show(errText(e)); setBusy(null); }
  };
  const upload = async (file: File) => {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { show("Choose a PDF."); return; }
    setBusy("upload");
    try { const storageId = await uploadToStorage(await uploadUrl({}), file); const { documentId } = await create({ storageId, fileName: file.name }); navigate(`/sign/d/${documentId}`); }
    catch (e) { show(errText(e)); setBusy(null); }
  };
  // A PDF made editable (B4): its lines become titles, headings, paragraphs, lists and sections in the builder.
  const importIt = async (file: File) => {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { show("Choose a PDF."); return; }
    setBusy("import");
    try {
      const storageId = await uploadToStorage(await builderUpload({}), file);
      const r = await importPdf({ storageId, title: file.name.replace(/\.pdf$/i, "") });
      navigate(`/sign/b/${r.buildId}`);
    } catch (e) { show(errText(e)); setBusy(null); }
  };
  const drafts = (builds ?? []).filter((b) => !b.documentId);
  return (
    <>
      <TopBar><FileSignature size={15} /><a {...linkProps("/sign")}>Contracts</a><Sep /><span className="here">New document</span></TopBar>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
      <input ref={importInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importIt(f); }} />
      <div className="content">
        <div className="ws-list">
          <h1 className="headline">New document. <span className="rest">Build it here, start from a template, or bring a finished PDF.</span></h1>
          <div className="ws-hub">
            <button className="ws-hubcard" onClick={() => void start()} disabled={!!busy}><span className="ws-hubicon">{busy === "blank" ? <Spinner /> : <FilePlus2 size={22} />}</span><span className="ws-hubtext"><b>Blank document</b><span className="secondary">Start with a title, the parties and a signature block.</span></span></button>
            <button className="ws-hubcard" onClick={() => input.current?.click()} disabled={!!busy}><span className="ws-hubicon">{busy === "upload" ? <Spinner /> : <FileUp size={22} />}</span><span className="ws-hubtext"><b>Upload a finished PDF</b><span className="secondary">Markers like <code>{"{{sign:client}}"}</code> place the boxes.</span></span></button>
            <button className="ws-hubcard" onClick={() => importInput.current?.click()} disabled={!!busy}><span className="ws-hubicon">{busy === "import" ? <Spinner /> : <FilePen size={22} />}</span><span className="ws-hubtext"><b>Import a PDF to edit</b><span className="secondary">Its text becomes an editable draft: titles, headings, paragraphs, lists and sections.</span></span></button>
          </div>
          <div className="ws-cardhead"><span className="label">From a template</span><a className="btn ghost sm" {...linkProps("/sign/templates")}>Manage templates</a></div>
          {templates === undefined ? <Spinner /> : templates.length === 0 ? <p className="caption secondary">No templates yet. <a {...linkProps("/sign/templates")}>Open Templates</a> to add the Service Agreement starter.</p> : (
            <div className="ws-hub">{templates.map((t) => (
              <button key={t._id} className="ws-hubcard" onClick={() => void start(t._id)} disabled={!!busy}><span className="ws-hubicon">{busy === t._id ? <Spinner /> : <LayoutTemplate size={22} />}</span><span className="ws-hubtext"><b>{t.name}</b><span className="secondary">{t.description || `${t.blocks} blocks`}</span></span></button>
            ))}</div>
          )}
          {drafts.length > 0 && <>
            <span className="label">Still in the builder</span>
            <div className="regwrap"><table className="regtable ws-table"><tbody>{drafts.map((b) => (
              <tr key={b._id} onClick={() => navigate(`/sign/b/${b._id}`)} style={{ cursor: "pointer" }}>
                <td><PencilLine size={14} /> <a {...linkProps(`/sign/b/${b._id}`)} onClick={(e) => e.stopPropagation()}>{b.title}</a></td>
                <td className="hide-sm secondary">{b.client || "—"}</td>
                <td className="hide-sm secondary">{central(b.updatedAt)}</td>
                <td style={{ textAlign: "right" }}><button className="icon-btn" aria-label="Delete draft" onClick={async (e) => { e.stopPropagation(); if (!(await confirm({ title: `Delete the draft "${b.title}"?`, body: "Its content is deleted. This can't be undone." }))) return; try { await deleteBuild({ buildId: b._id }); } catch (er) { show(errText(er)); } }}><Trash2 size={14} /></button></td>
              </tr>
            ))}</tbody></table></div>
          </>}
        </div>
      </div>
      {confirmDialog}
      {toast}
    </>
  );
}
