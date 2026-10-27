// Right-click (or ⋯) menu for a document in Contracts lists (Oct 27): open, edit in the builder, send, download the
// signed copy, copy its number, cancel signing, delete, and remove from the list (or put back). Each item only shows
// when it can work for that status; cancelling and deleting ask first. Removing from the list keeps everything.
import { useState } from "react";
import { useConvex, useMutation } from "convex/react";
import { Ban, Copy, Download, ExternalLink, Eye, EyeOff, PencilLine, Send, Trash2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { navigate } from "../../lib/router";
import { ContextMenu, MenuItem, MenuSep, Modal, Spinner } from "../../ui/kit";
import { errText, type DocStatus } from "./common";

export type MenuDoc = { _id: string; label: string; title: string; status: DocStatus; inBuilder: boolean; buildId?: string | null; hidden?: boolean };
export type MenuAt = { doc: MenuDoc; x: number; y: number };

/** Open handlers for a row: right-click, the context-menu key, or a ⋯ button. */
export function menuOpeners(doc: MenuDoc, open: (m: MenuAt) => void) {
  return {
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); open({ doc, x: e.clientX, y: e.clientY }); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); open({ doc, x: r.left + 40, y: r.bottom }); }
    },
  };
}

export function DocMenu({ at, onClose, show }: { at: MenuAt; onClose: () => void; show: (m: string) => void }) {
  const convex = useConvex();
  const setHidden = useMutation(api.sign.setHidden);
  const [confirm, setConfirm] = useState<"delete" | "cancel" | null>(null);
  const d = at.doc;
  const docId = d._id as Id<"wsDocuments">;
  const builderHref = d.inBuilder ? `/sign/b/${d._id}` : d.buildId && (d.status === "draft" || d.status === "approved" || d.status === "voided") ? `/sign/b/${d.buildId}` : null;
  const canDelete = d.inBuilder || d.status === "draft" || d.status === "approved";

  const download = async () => {
    try {
      const g = await convex.query(api.sign.get, { documentId: docId });
      if (!g?.finalUrl) { show("The signed copy isn't ready yet."); return; }
      window.open(g.finalUrl, "_blank", "noopener");
    } catch (e) { show(errText(e)); }
  };
  const hide = async (hidden: boolean) => {
    try { await setHidden({ documentId: docId, hidden }); show(hidden ? `Removed ${d.label} from the list. It's kept, under Hidden in Docs.` : `${d.label} is back in the list.`); } catch (e) { show(errText(e)); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(d.label); show(`Copied ${d.label}`); } catch { show("Couldn't copy."); } };

  if (confirm) return confirm === "delete"
    ? <ConfirmDelete d={d} onClose={onClose} show={show} />
    : <ConfirmCancel d={d} onClose={onClose} show={show} />;

  return (
    <ContextMenu at={at} onClose={onClose} label={`${d.label === "—" ? d.title : d.label} actions`}>
      <MenuItem icon={<ExternalLink size={15} />} onSelect={() => navigate(d.inBuilder ? `/sign/b/${d._id}` : `/sign/d/${d._id}`)}>Open</MenuItem>
      {builderHref && !d.inBuilder && <MenuItem icon={<PencilLine size={15} />} onSelect={() => navigate(builderHref)}>Edit in the builder</MenuItem>}
      {d.inBuilder && <MenuItem icon={<PencilLine size={15} />} onSelect={() => navigate(builderHref!)}>Edit</MenuItem>}
      {!d.inBuilder && d.status === "draft" && !d.buildId && <MenuItem icon={<PencilLine size={15} />} onSelect={() => navigate(`/sign/d/${d._id}`)}>Edit boxes and signers</MenuItem>}
      {d.status === "approved" && <MenuItem icon={<Send size={15} />} onSelect={() => navigate(`/sign/d/${d._id}?send=1`)}>Send for signature…</MenuItem>}
      {d.status === "completed" && <MenuItem icon={<Download size={15} />} onSelect={() => void download()}>Download the signed copy</MenuItem>}
      {d.label !== "—" && <MenuItem icon={<Copy size={15} />} onSelect={() => void copy()}>Copy {d.label}</MenuItem>}
      {(d.status === "sent" || canDelete) && <MenuSep />}
      {d.status === "sent" && <MenuItem icon={<Ban size={15} />} danger keepOpen onSelect={() => setConfirm("cancel")}>Cancel signing…</MenuItem>}
      {canDelete && <MenuItem icon={<Trash2 size={15} />} danger keepOpen onSelect={() => setConfirm("delete")}>Delete…</MenuItem>}
      {!d.inBuilder && !canDelete && <MenuSep />}
      {!d.inBuilder && (d.hidden
        ? <MenuItem icon={<Eye size={15} />} onSelect={() => void hide(false)}>Put back in the list</MenuItem>
        : <MenuItem icon={<EyeOff size={15} />} onSelect={() => void hide(true)}>Remove from list</MenuItem>)}
    </ContextMenu>
  );
}

function ConfirmDelete({ d, onClose, show }: { d: MenuDoc; onClose: () => void; show: (m: string) => void }) {
  const remove = useMutation(api.sign.remove);
  const deleteBuild = useMutation(api.builder.deleteBuild);
  const [busy, setBusy] = useState(false);
  const name = d.label === "—" ? `"${d.title}"` : `${d.label} "${d.title}"`;
  return (
    <Modal onClose={onClose} label="Delete document" width={440}>
      <div style={{ display: "grid", gap: 14 }}>
        <h2 className="headline">Delete {name}?</h2>
        <p className="secondary">{d.inBuilder ? "The draft and its content are deleted. This can't be undone." : d.buildId ? "The document, its PDF and its builder draft are deleted. Nothing has been sent, so there's no record to keep. This can't be undone." : "The document and its PDF are deleted. Nothing has been sent, so there's no record to keep. This can't be undone."}</p>
        <div className="dfoot">
          <button className="btn ghost" onClick={onClose}>Keep it</button>
          <button className="btn danger" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              if (d.inBuilder) await deleteBuild({ buildId: d._id as Id<"wsBuilds"> });
              else await remove({ documentId: d._id as Id<"wsDocuments"> });
              show(`Deleted ${name}`); onClose();
            } catch (e) { show(errText(e)); setBusy(false); }
          }}>{busy ? <Spinner /> : <Trash2 size={15} />}Delete</button>
        </div>
      </div>
    </Modal>
  );
}

function ConfirmCancel({ d, onClose, show }: { d: MenuDoc; onClose: () => void; show: (m: string) => void }) {
  const voidDocument = useMutation(api.sign.voidDocument);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} label="Cancel signing" width={460}>
      <div style={{ display: "grid", gap: 14 }}>
        <h2 className="headline">Cancel signing for {d.label}?</h2>
        <p className="secondary">The signing links stop working and everyone who was sent it gets an email saying it was cancelled. The document stays in Docs, marked Cancelled, with its audit trail.</p>
        <label className="field"><span className="ws-flabel">Reason (optional, included in the email)</span><input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} autoFocus /></label>
        <div className="dfoot">
          <button className="btn ghost" onClick={onClose}>Keep it out for signature</button>
          <button className="btn danger" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await voidDocument({ documentId: d._id as Id<"wsDocuments">, reason: reason.trim() || undefined }); show(`${d.label} cancelled`); onClose(); }
            catch (e) { show(errText(e)); setBusy(false); }
          }}>{busy ? <Spinner /> : <Ban size={15} />}Cancel signing</button>
        </div>
      </div>
    </Modal>
  );
}
