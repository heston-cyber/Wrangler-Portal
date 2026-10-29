// Video list rows and grid cards, shared by Home, Projects and the register.
// R2b: the details beside each video follow "Show details" (account setting); Final shows as a badge.
import { useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { useConvex, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Check, Share2, Trash2, Upload, X } from "lucide-react";
import { Icon } from "../../ui/Icon";
import { linkProps, navigate } from "../../lib/router";
import { Menu, MenuItem, MenuSep, Modal, Spinner, Thumb, useToast } from "../../ui/kit";
import { ago, transcriptChip } from "../../lib/format";
import { isVideoFile, startUpload } from "../../lib/uploads";
import { ShareDialog } from "./Share";
import { DEFAULT_FIELDS, fieldText, pad5, statusText, type FieldKey } from "../../lib/details";

export type Overview = FunctionReturnType<typeof api.library.overview>;
export type VideoItem = Overview["videos"][number];
type Project = Overview["projects"][number];

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function FinalBadge({ final }: { final: { version: number; at: number } | null }) {
  if (!final) return null;
  return <span className="wp-status success" title={`Approved ${new Date(final.at).toLocaleString()}`}>Final · v{final.version} · {day(final.at)}</span>;
}

function Detail({ k, x, p }: { k: FieldKey; x: VideoItem; p: Project | undefined }) {
  const t = fieldText(k, x, p);
  if (!t) return null;
  if (k === "latest") return <span className="dt dt-latest">{t}</span>;
  if (k === "length") return <span className="dt dt-length">{t}</span>;
  if (k === "status") { const s = statusText(x); return s.tone === "final" ? null : <span className={`chip ${s.tone}`}>{t}</span>; }
  if (k === "notes") return <span className={`dt open${x.openNotes ? " has" : ""}`}>{t}</span>;
  return <span className={`dt dt-${k}`}>{t}</span>;
}

// Selection (Oct 23): when `select` is given, rows show a checkbox and clicking a row toggles it instead of opening.
export type Selection = { on: boolean; has: (id: string) => boolean; toggle: (id: string) => void; start: (ids?: string[]) => void };
type RowProps = {
  x: VideoItem; meta?: React.ReactNode; projectName?: string; project?: Project;
  fields?: FieldKey[]; onApprove?: (x: VideoItem) => void; select?: Selection;
};

export function SelectBox({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return <button type="button" className={`selbox${on ? " on" : ""}`} role="checkbox" aria-checked={on} aria-label={label} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}>{on && <Check size={13} />}</button>;
}

export function VideoRow({ x, meta, projectName, project, fields = DEFAULT_FIELDS, onApprove, select }: RowProps) {
  const st = statusText(x);
  const busy = x.latest && x.latest.status !== "ready";
  const tr = x.latest?.status === "ready" ? transcriptChip(x.latest.transcript) : null;
  const rest = fields.filter((k) => k !== "number");
  const canApprove = onApprove && x.latest && x.versionCount > 0;
  const selecting = !!select?.on;
  const picked = selecting && select!.has(x._id);
  const link = selecting ? { href: `/v/${x._id}`, onClick: (e: React.MouseEvent) => { e.preventDefault(); select!.toggle(x._id); } } : linkProps(`/v/${x._id}`);
  return (
    <div className={`vline${picked ? " picked" : ""}`}>
      {selecting && <SelectBox on={picked} onClick={() => select!.toggle(x._id)} label={`Select ${x.title}`} />}
      <a className="vrow" {...link} aria-selected={selecting ? picked : undefined}>
        <Thumb src={x.latest?.thumbUrl ?? null} />
        {fields.includes("number") && x.number ? <span className="wp-tag mono" title="Register number">{pad5(x.number)}</span> : null}
        <span className="vtext">
          <span className="t">
            <b>{x.title}</b>
            <FinalBadge final={x.final} />
            {!fields.includes("status") && (busy || st.tone === "fail") && <span className={`chip ${st.tone}`}>{busy && <Spinner />}{st.text}</span>}
            {!x.latest && !fields.includes("status") && <span className="chip">No versions</span>}
            {tr?.busy && <span className="chip warn"><Spinner />{tr.text}</span>}
          </span>
          <span className="details">
            {projectName && <span className="dt pname">{projectName}</span>}
            {rest.map((k) => <Detail key={k} k={k} x={x} p={project} />)}
          </span>
        </span>
        {meta && <span className="meta">{meta}</span>}
      </a>
      {canApprove && !selecting && <button className={`btn sm approve${x.final ? " done" : ""}`} onClick={() => onApprove!(x)} title="Keep one version and delete the others">{x.final ? `Final v${x.final.version}` : "Approve final"}</button>}
      {!selecting && <VideoMenu x={x} />}
    </div>
  );
}

// The ⋯ menu at the end of a video row or card (Oct 23): share, upload a new version from this computer, delete.
export function VideoMenu({ x }: { x: VideoItem }) {
  const convex = useConvex();
  const del = useMutation(api.library.deleteVideo);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<null | "share" | "delete">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, show] = useToast();
  return (
    <>
      <Menu align="end" label="Video options" trigger={(p) => <button {...p} className="icon-btn bare vmenu" aria-label={`${x.title} options`}><Icon name="more" size={18} /></button>}>
        <MenuItem icon={<Share2 size={16} />} onSelect={() => setDialog("share")}>Share video…</MenuItem>
        <MenuItem icon={<Upload size={16} />} onSelect={() => fileRef.current?.click()}>Upload a new version</MenuItem>
        <MenuSep />
        <MenuItem icon={<Trash2 size={16} />} danger onSelect={() => setDialog("delete")}>Delete video</MenuItem>
      </Menu>
      <input ref={fileRef} type="file" hidden accept="video/*,.mov,.mp4,.m4v,.mxf,.mkv"
        onChange={(e) => { const f = e.target.files?.[0]; if (f && isVideoFile(f)) { void startUpload(convex, x._id, f); navigate(`/v/${x._id}`); } e.target.value = ""; }} />
      {dialog === "share" && <ShareDialog target={{ kind: "video", videoId: x._id }} label={x.title} onClose={() => setDialog(null)} show={show} />}
      {dialog === "delete" && (
        <Modal onClose={() => setDialog(null)} label="Delete video" width={480}>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="dhead">
              <h2 className="headline">Delete {x.title}? <span className="rest">This can't be undone.</span></h2>
              <button className="icon-btn" onClick={() => setDialog(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <p className="caption" style={{ margin: 0, lineHeight: 1.5 }}>Its {x.versionCount} {x.versionCount === 1 ? "version" : "versions"} and {x.noteCount} {x.noteCount === 1 ? "note" : "notes"} are deleted, with their drawings, recordings and transcripts. Files in Dropbox aren't touched{x.number ? `; the register keeps number ${pad5(x.number)} as used` : ""}.</p>
            {error && <p className="error">{error}</p>}
            <div className="dfoot">
              <button className="btn" onClick={() => setDialog(null)}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={async () => {
                setBusy(true);
                try { await del({ videoId: x._id }); setDialog(null); } catch (e) { setError((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); setBusy(false); }
              }}><Trash2 size={15} />{busy ? "Deleting…" : "Delete video"}</button>
            </div>
          </div>
        </Modal>
      )}
      {toast}
    </>
  );
}

export function VideoCard({ x, meta, projectName, project, fields = DEFAULT_FIELDS, onApprove, select }: RowProps) {
  const st = statusText(x);
  const busy = x.latest && x.latest.status !== "ready";
  const rest = fields.filter((k) => k !== "number" && k !== "latest");
  const selecting = !!select?.on;
  const picked = selecting && select!.has(x._id);
  const link = selecting ? { href: `/v/${x._id}`, onClick: (e: React.MouseEvent) => { e.preventDefault(); select!.toggle(x._id); } } : linkProps(`/v/${x._id}`);
  return (
    <div className={`cardwrap${picked ? " picked" : ""}`}>
      {selecting && <span className="cardsel"><SelectBox on={picked} onClick={() => select!.toggle(x._id)} label={`Select ${x.title}`} /></span>}
      <a className="card rect" {...link} aria-selected={selecting ? picked : undefined}>
        <div className="media">
          <Thumb src={x.latest?.thumbUrl ?? null} className="" />
        </div>
        <div className="cbody">
          <span className="rlabel">{fields.includes("number") && x.number ? `${pad5(x.number)} · ` : ""}{projectName ? `${projectName} · ` : ""}{x.latest ? `v${x.latest.number}` : "No versions"}</span>
          <div className="rbold ctitle">{x.title}</div>
          <div className="rtags">
            {x.final && <span className="rtag final">Final · v{x.final.version}</span>}
            {!fields.includes("status") && busy && <span className="rtag"><Spinner />{st.text}</span>}
            {rest.map((k) => {
              const t = fieldText(k, x, project);
              if (!t || (k === "status" && st.tone === "final")) return null;
              return <span key={k} className="rtag">{t}</span>;
            })}
          </div>
          {meta && <div className="cm">{meta}</div>}
        </div>
      </a>
      {onApprove && x.latest && !selecting && <button className={`btn sm approve${x.final ? " done" : ""}`} onClick={() => onApprove(x)}>{x.final ? `Final v${x.final.version}` : "Approve final"}</button>}
      {!selecting && <span className="cardmenu"><VideoMenu x={x} /></span>}
    </div>
  );
}

export const updatedMeta = (x: VideoItem) => <>Updated <em>{ago(x.updatedAt)}</em></>;
export const openedMeta = (x: VideoItem) => x.lastOpenedAt ? <>Opened <em>{ago(x.lastOpenedAt)}</em></> : <>Not opened yet</>;


// The bar at the bottom while selecting (Oct 23): count, Download selected (one zip), Delete selected (owner), Cancel.
export function SelectBar({ count, size, onAll, allCount, onDownload, onDelete, onCancel, busy }: {
  count: number; size: string | null; onAll?: () => void; allCount?: number; onDownload?: () => void; onDelete?: () => void; onCancel: () => void; busy?: string | null;
}) {
  return (
    <div className="selbar" role="toolbar" aria-label="Selected videos">
      <span className="rbold">{count} selected{size ? <span className="secondary"> · {size}</span> : null}</span>
      {onAll && allCount !== undefined && count < allCount && <button className="linkbtn" onClick={onAll}>Select all {allCount}</button>}
      <span className="right">
        {busy ? <span className="secondary">{busy}</span> : <>
          {onDownload && <button className="btn sm primary" disabled={!count} onClick={onDownload}>Download selected</button>}
          {onDelete && <button className="btn sm" disabled={!count} onClick={onDelete}><Trash2 size={14} />Delete selected</button>}
        </>}
        <button className="btn sm ghost" onClick={onCancel} disabled={!!busy}><X size={14} />Done</button>
      </span>
    </div>
  );
}

// Selection state shared by the pages that offer it.
export function useSelection(): Selection & { ids: string[]; set: (ids: string[]) => void; clear: () => void } {
  const [on, setOn] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  return {
    on, ids, has: (id) => ids.includes(id),
    toggle: (id) => setIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    start: (ids = []) => { setOn(true); setIds(ids); },
    set: (next) => setIds(next),
    clear: () => { setOn(false); setIds([]); },
  };
}