// The Versions tab: every version of the video, newest first, with what changed and its notes.
import { useState } from "react";
import { useMutation } from "convex/react";
import { ArrowUpRight, Ellipsis, Film, Pencil, Trash2, X } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { navigate } from "../lib/router";
import { ago, sizeText, statusChip, transcriptChip, uploadText } from "../lib/format";
import type { UploadState } from "../lib/uploads";
import { Menu, MenuItem, Modal, Spinner } from "../ui/kit";

type VideoData = NonNullable<FunctionReturnType<typeof api.library.video>>;
export type Version = VideoData["versions"][number];

export function VersionsList({ videoId, versions, current, uploads }: { videoId: string; versions: Version[]; current: number | null; uploads: UploadState[] }) {
  const active = uploads.filter((u) => u.status !== "done");
  return (
    <div className="vlist">
      {active.map((u) => (
        <div key={u.key} className="vcard rect">
          <span style={{ fontSize: 12.5 }}><b style={{ fontWeight: 500 }}>v{u.versionNumber ?? "…"} · {u.fileName}</b></span>
          <span className="secondary busyline" style={{ fontSize: 12 }}>{u.status !== "failed" && <Spinner />}{uploadText(u.status, u.sent, u.total, u.error)}</span>
          <div className="progress"><i style={{ width: `${u.total ? (100 * u.sent) / u.total : 0}%` }} /></div>
        </div>
      ))}
      {[...versions].reverse().map((v) => <VersionItem key={v._id} videoId={videoId} v={v} current={v.number === current} />)}
      {versions.length === 0 && active.length === 0 && <p className="caption" style={{ padding: 12 }}>No versions yet. Use + to upload the first one.</p>}
    </div>
  );
}

function VersionItem({ videoId, v, current }: { videoId: string; v: Version; current: boolean }) {
  const save = useMutation(api.library.setVersionDescription);
  const remove = useMutation(api.library.deleteVersion);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(v.description ?? "");
  const st = statusChip(v.status, v.encodeProgress);
  const tr = v.status === "ready" ? transcriptChip(v.transcript) : null;
  const open = () => navigate(`/v/${videoId}?version=${v.number}`);
  const commit = async () => { setEditing(false); if ((draft.trim() || null) !== (v.description ?? null)) await save({ versionId: v._id, description: draft }); };
  return (
    <div className={`vcard rect${current ? " current" : ""}`}>
      <div className="rrow">
        <span className="rlabel">Version {v.number}{v.uploaderName ? ` · ${v.uploaderName}` : ""} · {ago(v.createdAt)}</span>
        <span className="right">
          {current && <span className="viewing">Viewing</span>}
          <Menu align="end" label={`Version ${v.number} options`} trigger={(p) => <button {...p} className="icon-btn" aria-label={`Version ${v.number} options`}><Ellipsis size={15} /></button>}>
            <MenuItem icon={<Pencil size={16} />} onSelect={() => setEditing(true)}>Edit what changed</MenuItem>
            <MenuItem icon={<Trash2 size={16} />} danger onSelect={() => setConfirming(true)}>Delete version</MenuItem>
          </Menu>
        </span>
      </div>
      <div className="rbold" title={v.fileName}>v{v.number}</div>
      <div className="rtags">
        {st && <span className="rtag">{st.busy && <Spinner />}{st.text}</span>}
        {tr && <span className="rtag">{tr.busy && <Spinner />}{tr.text}</span>}
        {v.noteCount > 0 ? <span className="rtag">{v.openCount ? `${v.openCount} open` : "All done"} · {v.noteCount} {v.noteCount === 1 ? "note" : "notes"}</span> : <span className="rtag">No notes</span>}
        {v.fileSize ? <span className="rtag">{sizeText(v.fileSize)}</span> : null}
      </div>
      <div className="file" title={v.dropboxPath ?? v.fileName}><Film size={14} /><span>{v.dropboxPath ? `Dropbox › ${v.dropboxPath.split("/").filter(Boolean).join(" › ")}` : v.fileName}</span></div>
      {editing ? (
        <textarea className="input" style={{ minHeight: 64, fontSize: 13 }} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void commit(); } if (e.key === "Escape") { setDraft(v.description ?? ""); setEditing(false); } }}
          placeholder="What changed in this version?" />
      ) : (
        <div className={`desc${v.description ? "" : " ph"}`} role="button" tabIndex={0} onClick={() => setEditing(true)} onKeyDown={(e) => { if (e.key === "Enter") setEditing(true); }}>
          {v.description || "Add a note about what changed"}
        </div>
      )}
      {confirming && (
        <Modal onClose={() => setConfirming(false)} label={`Delete version ${v.number}`} width={480}>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="dhead">
              <h2 className="headline">Delete v{v.number}? <span className="rest">This can't be undone.</span></h2>
              <button className="icon-btn" onClick={() => setConfirming(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <p className="caption" style={{ margin: 0, lineHeight: 1.5 }}>
              {v.noteCount ? `Its ${v.noteCount} ${v.noteCount === 1 ? "note" : "notes"}, drawings and transcript are deleted with it.` : "Its transcript is deleted with it."} The other versions keep their numbers, and the original file{v.dropboxPath ? " in Dropbox" : ""} isn't touched.
            </p>
            <div className="dfoot">
              <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={async () => {
                setBusy(true);
                try { await remove({ versionId: v._id }); setConfirming(false); if (current) navigate(`/v/${videoId}`); }
                finally { setBusy(false); }
              }}><Trash2 size={15} />{busy ? "Deleting…" : `Delete v${v.number}`}</button>
            </div>
          </div>
        </Modal>
      )}
      {(v.status === "failed" || !current) && (
        <div className="vf">
          {v.status === "failed" && v.error && <span className="error" style={{ fontSize: 12 }}>{v.error}</span>}
          {!current && <span className="right"><button className="btn sm" onClick={open}><ArrowUpRight size={14} />View</button></span>}
        </div>
      )}
    </div>
  );
}
