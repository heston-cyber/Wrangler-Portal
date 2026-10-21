// The Versions tab: every version of the video, newest first, with what changed and its notes.
import { useState } from "react";
import { useMutation } from "convex/react";
import { ArrowUpRight, Film } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import { navigate } from "../lib/router";
import { Avatar } from "../ui/kit";
import { ago, sizeText, statusChip, uploadText } from "../lib/format";
import type { UploadState } from "../lib/uploads";

type VideoData = NonNullable<FunctionReturnType<typeof api.library.video>>;
export type Version = VideoData["versions"][number];

export function VersionsList({ videoId, versions, current, uploads }: { videoId: string; versions: Version[]; current: number | null; uploads: UploadState[] }) {
  const active = uploads.filter((u) => u.status !== "done");
  return (
    <div className="vlist">
      {active.map((u) => (
        <div key={u.key} className="vcard" style={{ marginLeft: 46 }}>
          <span style={{ fontSize: 12.5 }}><b style={{ fontWeight: 500 }}>v{u.versionNumber ?? "…"} · {u.fileName}</b></span>
          <span className="secondary" style={{ fontSize: 12 }}>{uploadText(u.status, u.sent, u.total, u.error)}</span>
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(v.description ?? "");
  const st = statusChip(v.status, v.encodeProgress);
  const open = () => navigate(`/v/${videoId}?version=${v.number}`);
  const commit = async () => { setEditing(false); if ((draft.trim() || null) !== (v.description ?? null)) await save({ versionId: v._id, description: draft }); };
  return (
    <div className={`vitem${current ? " current" : ""}`}>
      <div className="vnum">
        <span className="radio" aria-hidden />
        <span className="chip">v{v.number}</span>
      </div>
      <div className="vcard">
        <div className="vh">
          {v.uploaderName && <><Avatar name={v.uploaderName} /><span style={{ color: "var(--text-primary)" }}>{v.uploaderName}</span></>}
          <span>{ago(v.createdAt)}</span>
          <span className="right">
            {st && <span className={`chip ${st.tone}`}>{st.text}</span>}
            {v.noteCount > 0 && <span className="chip fill" title={`${v.openCount} open of ${v.noteCount}`}>{v.openCount ? `${v.openCount} open` : `${v.noteCount} done`}</span>}
          </span>
        </div>
        <div className="file"><Film size={14} color="var(--text-secondary)" /><span>{v.fileName}</span>{v.fileSize ? <span className="secondary" style={{ marginLeft: "auto", flex: "0 0 auto" }}>{sizeText(v.fileSize)}</span> : null}</div>
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
        <div className="vf">
          {v.status === "failed" && v.error && <span className="error" style={{ fontSize: 12 }}>{v.error}</span>}
          <span className="right">
            {current ? <span className="secondary" style={{ fontSize: 12.5 }}>Viewing</span>
              : <button className="btn sm" onClick={open}><ArrowUpRight size={14} />View</button>}
          </span>
        </div>
      </div>
    </div>
  );
}
