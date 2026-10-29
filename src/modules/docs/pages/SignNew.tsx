// Docs › New document (B1–B3; Phase 1 look Oct 29, frame 90:1495): start blank in the builder, start from a template, continue a draft, or upload a
// finished PDF (the original way).
import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Sep, TopBar } from "../../../shell/Shell";
import { linkProps, navigate } from "../../../lib/router";
import { Spinner, useConfirm, useToast } from "../../../ui/kit";
import { Icon, type IconName } from "../../../ui/Icon";
import { ButtonLink, PageHeader, SkeletonRows } from "../../../ui/wp";
import { central, errText, shortWhen, uploadToStorage } from "./common";

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
  const startCard = (key: string, icon: IconName, title: string, text: React.ReactNode, onClick: () => void) => (
    <button className="wp-hubcard glass start" onClick={onClick} disabled={!!busy} aria-busy={busy === key || undefined}>
      {busy === key ? <Spinner /> : <Icon name={icon} size={24} />}
      <span className="ttl">{title}</span>
      <span className="txt">{text}</span>
    </button>
  );
  return (
    <>
      <TopBar><a {...linkProps("/sign")}>Docs</a><Sep /><span className="here">New document</span></TopBar>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
      <input ref={importInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importIt(f); }} />
      <div className="wp-page docs">
        <PageHeader title="New document." sub="Build it here, start from a template, or bring a finished PDF." />
        <div className="wp-hub">
          {startCard("blank", "document", "Blank document", "Start with a title, the parties and a signature block.", () => void start())}
          {startCard("upload", "upload", "Upload a finished PDF", <>Markers like {"{{sign:client}}"} place the boxes.</>, () => input.current?.click())}
          {startCard("import", "note", "Import a PDF to edit", "Its text becomes an editable draft: titles, headings, paragraphs, lists and sections.", () => importInput.current?.click())}
        </div>
        <div className="wp-listhead"><span className="wp-eyebrow">From a template</span><ButtonLink variant="ghost" size="sm" to="/sign/templates">Manage templates</ButtonLink></div>
        {templates === undefined ? <div className="wp-tablecard glass"><SkeletonRows n={1} /></div> : templates.length === 0 ? <p className="wp-small ws-foot">No templates yet. <a className="wp-link" {...linkProps("/sign/templates")}>Open Templates</a> to add the Service Agreement starter.</p> : (
          <div className="wp-hub">{templates.map((t) => (
            <button key={t._id} className="wp-tplcard glass" onClick={() => void start(t._id)} disabled={!!busy} aria-busy={busy === t._id || undefined}>
              {busy === t._id ? <Spinner /> : <Icon name="folder" size={20} />}
              <span className="ttl">{t.name}</span>
              <span className="txt">{t.description || `${t.blocks} blocks`}</span>
            </button>
          ))}</div>
        )}
        {drafts.length > 0 && <>
          <span className="wp-eyebrow">Still in the builder</span>
          <div className="wp-tablecard glass">
            <table className="wp-table ws-table">
              <colgroup><col /><col className="c-who" /><col className="c-when" /><col className="c-more" /></colgroup>
              <thead><tr><th scope="col">Draft</th><th scope="col" className="hide-sm">Client</th><th scope="col" className="hide-sm">Updated</th><th aria-label="Actions" /></tr></thead>
              <tbody>{drafts.map((b) => (
                <tr key={b._id} onClick={() => navigate(`/sign/b/${b._id}`)} tabIndex={0}>
                  <td className="ttl"><a {...linkProps(`/sign/b/${b._id}`)} onClick={(e) => e.stopPropagation()}>{b.title}</a></td>
                  <td className="hide-sm">{b.client || "—"}</td>
                  <td className="hide-sm" title={central(b.updatedAt)}>{shortWhen(b.updatedAt)}</td>
                  <td className="ws-more"><button className="icon-btn bare sm" aria-label="Delete draft" title="Delete draft" onClick={async (e) => { e.stopPropagation(); if (!(await confirm({ title: `Delete the draft "${b.title}"?`, body: "Its content is deleted. This can't be undone." }))) return; try { await deleteBuild({ buildId: b._id }); } catch (er) { show(errText(er)); } }}><Icon name="close" size={16} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>}
      </div>
      {confirmDialog}
      {toast}
    </>
  );
}
