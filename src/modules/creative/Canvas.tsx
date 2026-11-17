// 5l round 2 (D183–D185; Design Log "Handoff ready: Creative planning, round 2"): Canvas and mood boards.
// The list (cards with a small picture of each board), New canvas, and the board itself: items on a board with its edge
// visible; tools Select, Pan, Pen, Eraser, Text, Note, Box, Table, Frame, Image or file, Link, Import; zoom 25–400%
// (immediate), undo and redo, an item menu (right-click, or press and hold on touch), saves as you go (D184, no live
// cursors). iPad: Pencil draws, fingers move the board (D185); a phone gets Select, Text, Photo and the Tools sheet with
// the rest greyed "On iPad and desktop". Popovers move in 140 ms with no fade. Shared people use the same board on their
// own link (/cv/<token>): Can view reads it, Can edit changes it (no uploads).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  MousePointer2, Hand, Pen, Eraser, Type, StickyNote, Square, Table2, Frame, ImagePlus, Link2, Upload, Undo2, Redo2, Minus, Plus, Maximize, MoreHorizontal, Lock, ChevronLeft, ChevronRight, Download,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { Modal, useConfirm, useToast } from "../../ui/kit";
import { Button, DialogHeader, EmptyState, PageHeader, PillTabs, SkeletonRows, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { errLine } from "../../ui/hold";
import { AttachDialog } from "../projects/Homes";
import { HomeTag, copyText, shareUrl } from "./parts";
import { HomeSelect } from "./Creative";
import { BOARD, type CanvasItem, type CanvasType } from "../../../convex/lib/canvas";
import { openPdf, renderPage, type PdfDoc } from "../docs/lib/pdf";

type HomeIn = { type: "client" | "project" | "shoot" | "lead"; id: string } | null;
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const mb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// ---------- the list (1076-35492) ----------

export function CanvasList() {
  const list = useQuery(api.canvas.list);
  const [f, setF] = useState<"all" | "canvas" | "mood" | "shared" | "loose">("all");
  const [open, setOpen] = useState<null | "canvas" | "mood">(() => (new URLSearchParams(location.search).has("new") ? "canvas" : null));
  const [toast, show] = useToast();
  const all = list ?? [];
  const rows = all.filter((c) => f === "all" || (f === "shared" ? c.shared > 0 : f === "loose" ? !c.home : c.kind === f));
  const n = (k: string) => all.filter((c) => (k === "shared" ? c.shared > 0 : k === "loose" ? !c.home : c.kind === k)).length;
  return (
    <>
      <TopBar><a {...linkProps("/creative")}>Creative planning</a><Sep /><span className="here">Canvas and mood boards</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow="Creative planning" title="Canvas and mood boards" sub="Boards for ideas, references and plans. Only your business sees them until you share one." actions={<Button variant="primary" icon="plus" onClick={() => setOpen("canvas")}>New canvas</Button>} />
        {list !== undefined && all.length > 0 && <PillTabs label="Filter" value={f} onChange={setF} items={[{ key: "all", label: "All", count: all.length }, { key: "canvas", label: "Canvases", count: n("canvas") }, { key: "mood", label: "Mood boards", count: n("mood") }, { key: "shared", label: "Shared", count: n("shared") }, { key: "loose", label: "Not attached", count: n("loose") }]} />}
        {list === undefined ? <div className="wp-tablecard glass"><SkeletonRows n={3} /></div>
          : all.length === 0 ? <div className="wp-tablecard glass"><EmptyState icon="creative" title="No canvases yet." body="A canvas is an open board for photos, notes, sketches, PDFs and links. Start blank or from the mood board layout." actions={<><Button variant="primary" onClick={() => setOpen("canvas")}>New canvas</Button><Button onClick={() => setOpen("mood")}>New mood board</Button></>} /></div>
          : rows.length === 0 ? <div className="wp-tablecard glass"><EmptyState icon="creative" title="Nothing here." /></div>
          : <div className="cv-cards">
            {rows.map((c) => (
              <a key={c._id} className="cv-card glass" {...linkProps(`/creative/canvas/${c._id}`)}>
                <MiniBoard items={c.preview} />
                <span className="body">
                  <b>{c.name}</b>
                  <span className="secondary wp-small">{c.kind === "mood" ? "Mood board" : "Canvas"} · edited {ago(c.at)}{c.shared ? ` · Shared with ${c.shared}` : ""}</span>
                  <HomeTag home={c.home} />
                </span>
              </a>
            ))}
          </div>}
      </div>
      {open && <NewCanvas kind={open} onClose={() => setOpen(null)} show={show} />}
      {toast}
    </>
  );
}

function MiniBoard({ items }: { items: Array<{ type: string; x: number; y: number; w: number; h: number; color: string | null; src: string | null }> }) {
  const box = items.length ? items.reduce((b, i) => ({ x0: Math.min(b.x0, i.x), y0: Math.min(b.y0, i.y), x1: Math.max(b.x1, i.x + i.w), y1: Math.max(b.y1, i.y + i.h) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }) : { x0: 0, y0: 0, x1: 800, y1: 500 };
  const pad = 40;
  return (
    <svg className="cv-mini" viewBox={`${box.x0 - pad} ${box.y0 - pad} ${box.x1 - box.x0 + pad * 2} ${box.y1 - box.y0 + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {items.map((i, k) => i.type === "image" && i.src ? <image key={k} href={i.src} x={i.x} y={i.y} width={i.w} height={i.h} preserveAspectRatio="xMidYMid slice" />
        : <rect key={k} x={i.x} y={i.y} width={i.w} height={i.h} rx={i.type === "note" ? 6 : 2} fill={i.type === "frame" ? "none" : i.type === "note" ? i.color ?? "#FFF4B8" : i.type === "pen" ? "none" : "rgba(255,255,255,.14)"} stroke={i.type === "frame" ? "rgba(255,255,255,.35)" : i.type === "pen" ? i.color ?? "#fff" : "none"} strokeWidth={i.type === "frame" ? 6 : 3} />)}
    </svg>
  );
}

function NewCanvas({ kind, onClose, show }: { kind: "canvas" | "mood"; onClose: () => void; show: (t: string) => void }) {
  const make = useMutation(api.canvas.create);
  const [name, setName] = useState("");
  const [k, setK] = useState(kind);
  const [home, setHome] = useState<HomeIn>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const id = await make({ name, kind: k, home }); navigate(`/creative/canvas/${id}`); } catch (e) { show(errLine(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="New canvas" width={520}>
      <form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <DialogHeader eyebrow="Creative planning" title="New canvas" onClose={onClose} />
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder={k === "mood" ? "Mood board" : "Untitled canvas"} autoFocus />
        <div className="hm-list" role="radiogroup" aria-label="Start from">
          {([["canvas", "Blank canvas", "An empty board"], ["mood", "Mood board", "Frames for Look, Colour, Type, Words and References"]] as const).map(([v, t, s]) => (
            <button key={v} type="button" role="radio" aria-checked={k === v} className={`hm-row${k === v ? " on" : ""}`} onClick={() => setK(v)}><Icon name={k === v ? "check-circle" : "creative"} size={18} /><span className="t"><b>{t}</b><span className="secondary">{s}</span></span></button>
          ))}
        </div>
        <HomeSelect kind="canvas" value={home} onChange={setHome} />
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" type="submit" loading={busy}>Make it</Button></div>
      </form>
    </Modal>
  );
}

// ---------- the board page (owner and team) ----------

export function CanvasPage({ canvasId }: { canvasId: string }) {
  const c = useQuery(api.canvas.get, { canvasId });
  const save = useMutation(api.canvas.save);
  const rename = useMutation(api.canvas.rename);
  const remove = useMutation(api.canvas.remove);
  const duplicate = useMutation(api.canvas.duplicate);
  const uploadUrl = useMutation(api.canvas.uploadUrl);
  const addFile = useMutation(api.canvas.addFile);
  const dropUnused = useMutation(api.canvas.dropUnused);
  const [toast, show] = useToast();
  const [ask, confirmNode] = useConfirm();
  const [dialog, setDialog] = useState<null | "share" | "move" | "rename" | "more">(null);
  const [nameDraft, setNameDraft] = useState("");
  if (c === undefined) return <><TopBar><a {...linkProps("/creative")}>Creative planning</a><Sep /><a {...linkProps("/creative/canvas")}>Canvas and mood boards</a></TopBar><div className="wp-page"><SkeletonRows n={4} /></div></>;
  if (c === null) return <><TopBar><a {...linkProps("/creative")}>Creative planning</a><Sep /><a {...linkProps("/creative/canvas")}>Canvas and mood boards</a></TopBar><div className="wp-page"><EmptyState icon="creative" title="This board isn't here." actions={<Button onClick={() => navigate("/creative/canvas")}>All boards</Button>} /></div></>;
  const upload = async (file: File, onProgress: (p: number) => void) => {
    const url = await uploadUrl({ canvasId });
    const storageId = await new Promise<Id<"_storage">>((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("POST", url); x.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
      x.onload = () => { try { resolve(JSON.parse(x.responseText).storageId); } catch { reject(new Error("The upload didn't finish. Try again.")); } };
      x.onerror = () => reject(new Error("The upload didn't finish. Try again."));
      x.send(file);
    });
    return await addFile({ canvasId, storageId, name: file.name });
  };
  return (
    <>
      <Board key={c._id} title={c.name} items={c.items as CanvasItem[]} rev={c.rev} files={c.files} canEdit uploads={{ upload, bytes: c.limits.bytes }}
        onSave={async (items, rev) => { const r = await save({ canvasId, items, rev }); if (r.ok && items.length < (c.items as CanvasItem[]).length) void dropUnused({ canvasId }); return r as SaveResult; }}
        top={(state) => (
          <TopBar right={<>
            {state}
            <span className="hide-sm"><HomeTag home={c.home} onMove={() => setDialog("move")} /></span>
            <button type="button" className="icon-btn sm" aria-label="More" onClick={() => setDialog("more")}><MoreHorizontal size={18} /></button>
            <Button variant="primary" size="sm" onClick={() => setDialog("share")}>Share{c.people.length ? ` · ${c.people.length}` : ""}</Button>
          </>}>
            <a {...linkProps("/creative")} className="hide-sm">Creative planning</a><Sep /><a {...linkProps("/creative/canvas")}>Canvas and mood boards</a><Sep />
            <button type="button" className="here cv-name" onClick={() => { setNameDraft(c.name); setDialog("rename"); }} title="Rename">{c.name}</button>
          </TopBar>
        )} show={show} />
      {dialog === "share" && <ShareCanvas c={c} onClose={() => setDialog(null)} show={show} />}
      {dialog === "move" && <AttachDialog kind="canvas" id={c._id} name={c.name} hasHome={!!c.home} onClose={() => setDialog(null)} show={show} />}
      {dialog === "rename" && <Modal onClose={() => setDialog(null)} label="Rename" width={440}><form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void rename({ canvasId, name: nameDraft }).then(() => setDialog(null), (er) => show(errLine(er))); }}>
        <DialogHeader title="Rename the board" onClose={() => setDialog(null)} /><TextField label="Name" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
        <div className="dfoot"><button type="button" className="btn ghost" onClick={() => setDialog(null)}>Cancel</button><Button variant="primary" type="submit" disabled={!nameDraft.trim()}>Save</Button></div></form></Modal>}
      {dialog === "more" && <Modal onClose={() => setDialog(null)} label="Board" width={400}><div className="crm-dialog hm-pick">
        <DialogHeader title={c.name} body={`${c.kind === "mood" ? "Mood board" : "Canvas"}${c.editedBy ? ` · last edited by ${c.editedBy}, ${ago(c.at)}` : ""}`} onClose={() => setDialog(null)} />
        <div className="hm-list">
          <button type="button" className="hm-row" onClick={() => { setDialog("move"); }}><Icon name="attach" size={18} /><span className="t"><b>{c.home ? "Move to…" : "Attach to…"}</b></span></button>
          <button type="button" className="hm-row" onClick={() => void duplicate({ canvasId }).then((id) => navigate(`/creative/canvas/${id}`), (e) => show(errLine(e)))}><Icon name="layers" size={18} /><span className="t"><b>Duplicate</b><span className="secondary">Photos and files stay on this board</span></span></button>
          <button type="button" className="hm-row danger" onClick={async () => { setDialog(null); if (await ask({ title: `Delete ${c.name}?`, body: "Its photos and files go too, and every share link stops working.", yes: "Delete", danger: true })) { try { await remove({ canvasId }); navigate("/creative/canvas"); } catch (e) { show(errLine(e)); } } }}><Icon name="close" size={18} /><span className="t"><b>Delete</b></span></button>
        </div></div></Modal>}
      {confirmNode}{toast}
    </>
  );
}

type SaveResult = { ok: true; rev: number } | { ok: false; rev: number; items: CanvasItem[] };

/** Share (1075-35498): add someone from this project, Can view / Can edit, people with access, Stop sharing. */
function ShareCanvas({ c, onClose, show }: { c: NonNullable<ReturnType<typeof useCanvasGet>>; onClose: () => void; show: (t: string) => void }) {
  const choices = useQuery(api.canvas.shareChoices, { canvasId: c._id });
  const add = useMutation(api.canvas.addPerson);
  const setRole = useMutation(api.canvas.setRole);
  const removePerson = useMutation(api.canvas.removePerson);
  const setLink = useMutation(api.canvas.setLink);
  const stop = useMutation(api.canvas.stopSharing);
  const [email, setEmail] = useState("");
  const [role, setRoleNew] = useState<"view" | "edit">("view");
  const [busy, setBusy] = useState(false);
  const have = new Set(c.people.map((p) => p.email.toLowerCase()));
  const sugg = (choices ?? []).filter((p) => !have.has(p.email.toLowerCase()) && (!email.trim() || `${p.name ?? ""} ${p.email}`.toLowerCase().includes(email.trim().toLowerCase())));
  const addOne = async (e: string, name?: string | null) => {
    setBusy(true);
    try { const r = await add({ canvasId: c._id, email: e, ...(name ? { name } : {}), role }); setEmail(""); const ok = await copyText(shareUrl("cv", r.token)); show(ok ? `Added. Their link is copied: send it to them.` : "Added. Copy their link below."); }
    catch (er) { show(errLine(er)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Share" width={560}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Share" title={c.name} body="Only your business sees a canvas until you share it. You can share with this project's client and crew. Changes save as you go. People see the latest board when they open it." onClose={onClose} />
        <form className="cv-add" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void addOne(email.trim()); }}>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Add someone from this project, or an email" aria-label="Add someone" />
          <select className="input" value={role} onChange={(e) => setRoleNew(e.target.value as "view")} aria-label="Access"><option value="view">Can view</option><option value="edit">Can edit</option></select>
          <Button type="submit" loading={busy} disabled={!email.trim()}>Add</Button>
        </form>
        {sugg.length > 0 && <div className="hm-list">{sugg.slice(0, 6).map((p) => <button key={p.email} type="button" className="hm-row" disabled={busy} onClick={() => void addOne(p.email, p.name)}><Icon name={p.who === "crew" ? "users" : "building"} size={18} /><span className="t"><b>{p.name ?? p.email}</b><span className="secondary">{p.who === "crew" ? "Crew" : "Client"}{p.name ? ` · ${p.email}` : ""}</span></span></button>)}</div>}
        <div className="cv-people">
          <span className="wp-field-label">People with access</span>
          <div className="cv-person"><Icon name="user" size={18} /><span className="t"><b>Your business</b><span className="secondary">Owner and team with Projects</span></span><span className="secondary">Can edit</span></div>
          {c.people.map((p) => (
            <div key={p._id} className="cv-person"><Icon name="user" size={18} /><span className="t"><b>{p.name ?? p.email}</b><span className="secondary">{p.name ? `${p.email} · ` : ""}{p.openedAt ? `opened ${ago(p.openedAt)}` : "not opened yet"}</span></span>
              <button type="button" className="btn ghost sm" onClick={() => void copyText(shareUrl("cv", p.token)).then((ok) => show(ok ? "Their link is copied." : shareUrl("cv", p.token)))}>Copy link</button>
              <select className="input sm" value={p.role} aria-label={`Access for ${p.email}`} onChange={(e) => { if (e.target.value === "remove") void removePerson({ personId: p._id as Id<"canvasPeople"> }).then(() => show("Removed. Their link stopped working."), (er) => show(errLine(er))); else void setRole({ personId: p._id as Id<"canvasPeople">, role: e.target.value as "view" }); }}>
                <option value="view">Can view</option><option value="edit">Can edit</option><option value="remove">Remove</option>
              </select>
            </div>
          ))}
        </div>
        <label className="cr-switch"><input type="checkbox" checked={!!c.link?.on} onChange={(e) => void setLink({ canvasId: c._id, on: e.target.checked }).then((l) => { if (l.on) void copyText(shareUrl("cv", l.token)).then((ok) => show(ok ? "View-only link copied." : "The link is on.")); else show("The link is off."); }, (er) => show(errLine(er)))} /> A view-only link anyone can open</label>
        {c.link?.on && <div className="cr-link"><input className="input" readOnly value={shareUrl("cv", c.link.token)} onFocus={(e) => e.target.select()} aria-label="View-only link" /><Button onClick={() => void copyText(shareUrl("cv", c.link!.token)).then(() => show("Copied."))}>Copy</Button></div>}
        <div className="dfoot">{(c.people.length > 0 || c.link?.on) && <button type="button" className="btn ghost danger" onClick={() => void stop({ canvasId: c._id }).then(() => show("Only your business sees it now."), (e) => show(errLine(e)))}>Stop sharing</button>}<span className="sp" /><Button variant="primary" onClick={onClose}>Done</Button></div>
      </div>
    </Modal>
  );
}
const useCanvasGet = (canvasId: string) => useQuery(api.canvas.get, { canvasId });

// ---------- the shared board (/cv/<token>) ----------

export function SharedCanvas({ token }: { token: string }) {
  const c = useQuery(api.canvas.shared, { token });
  const save = useMutation(api.canvas.sharedSave);
  const opened = useMutation(api.canvas.opened);
  const [toast, show] = useToast();
  useEffect(() => { void opened({ token }).catch(() => {}); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  if (c === undefined) return <div className="cr-public"><SkeletonRows n={3} /></div>;
  if (c === null) return <div className="cr-public"><EmptyState icon="creative" title="This link isn't working." body="Sharing may have stopped. Ask whoever sent it." /></div>;
  return (
    <div className="cv-shared">
      <Board title={c.name} items={c.items as CanvasItem[]} rev={c.rev} files={c.files} canEdit={c.role === "edit"} show={show}
        onSave={async (items, rev) => (await save({ token, items, rev })) as SaveResult}
        top={(state) => <div className="cv-pubbar glass"><span className="wp-eyebrow">{c.from ?? ""}{c.from ? " · " : ""}{c.kind === "mood" ? "Mood board" : "Canvas"}</span><b>{c.name}</b><span className="sp" />{state}<span className="pill sm">{c.role === "edit" ? "Can edit" : "View only"}</span></div>} />
      {toast}
    </div>
  );
}

// ---------- the board ----------

type Tool = "select" | "pan" | "pen" | "eraser" | "text" | "note" | "box" | "table" | "frame" | "image" | "link" | "import";
const TOOLS: Array<{ k: Tool; label: string; icon: React.ReactNode; key?: string; phone?: boolean }> = [
  { k: "select", label: "Select", icon: <MousePointer2 size={18} />, key: "v", phone: true },
  { k: "pan", label: "Pan", icon: <Hand size={18} />, key: "h", phone: true },
  { k: "pen", label: "Pen", icon: <Pen size={18} />, key: "p" },
  { k: "eraser", label: "Eraser", icon: <Eraser size={18} />, key: "e" },
  { k: "text", label: "Text", icon: <Type size={18} />, key: "t", phone: true },
  { k: "note", label: "Note", icon: <StickyNote size={18} />, key: "n" },
  { k: "box", label: "Box", icon: <Square size={18} />, key: "b" },
  { k: "table", label: "Table", icon: <Table2 size={18} /> },
  { k: "frame", label: "Frame", icon: <Frame size={18} />, key: "f" },
  { k: "image", label: "Image or file", icon: <ImagePlus size={18} />, phone: true },
  { k: "link", label: "Link", icon: <Link2 size={18} /> },
  { k: "import", label: "Import", icon: <Upload size={18} /> },
];
const PEN_SIZES = [2, 4, 8, 14];
const COLORS = ["#F5F5F7", "#1D1D1F", "#E10600", "#FF9F0A", "#FFD60A", "#30D158", "#0A84FF", "#BF5AF2"];
const NOTE_COLORS = ["#FFF4B8", "#FFD6E0", "#CFF5D7", "#D6E9FF", "#EADCFF"];
const TEXT_PX: Record<string, number> = { S: 16, M: 22, L: 34, XL: 56 };
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const clampZoom = (z: number) => Math.min(4, Math.max(0.25, z));
type Settings = { penSize: number; penColor: string; textSize: "S" | "M" | "L" | "XL"; textWeight: "regular" | "bold"; textColor: string; boxFill: string | null; boxBorder: "none" | "thin" | "thick"; boxColor: string; noteColor: string; rows: number; cols: number };
type Uploads = { upload: (f: File, onProgress: (p: number) => void) => Promise<{ error: string | null; fileId?: string; url?: string | null; type?: string; size?: number }>; bytes: number };

function Board({ title, items: initial, rev: initialRev, files: fileUrls, canEdit, uploads, onSave, top, show }: {
  title: string; items: CanvasItem[]; rev: number; files: Record<string, string | null>; canEdit: boolean; uploads?: Uploads;
  onSave: (items: CanvasItem[], rev: number) => Promise<SaveResult>; top: (state: React.ReactNode) => React.ReactNode; show: (t: string) => void;
}) {
  const [items, setItemsRaw] = useState<CanvasItem[]>(initial);
  const itemsRef = useRef(items); itemsRef.current = items;
  const rev = useRef(initialRev);
  const dirty = useRef(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const hist = useRef<{ past: CanvasItem[][]; future: CanvasItem[][] }>({ past: [], future: [] });
  const [, tick] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pop, setPop] = useState<null | "settings" | "tools">(null);
  const [st, setSt] = useState<Settings>({ penSize: 4, penColor: "#F5F5F7", textSize: "M", textWeight: "regular", textColor: "#F5F5F7", boxFill: null, boxBorder: "thin", boxColor: "#F5F5F7", noteColor: NOTE_COLORS[0], rows: 3, cols: 3 });
  const [drawing, setDrawing] = useState<{ points: number[] } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [linkAsk, setLinkAsk] = useState<{ x: number; y: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [files, setFiles] = useState(fileUrls);
  const viewRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const phone = typeof window !== "undefined" && window.matchMedia("(max-width: 600px)").matches;
  useEffect(() => setFiles((f) => ({ ...f, ...fileUrls })), [fileUrls]);

  // Someone else saved: take the newer board when nothing here is waiting to save (D184: no live cursors).
  useEffect(() => {
    if (initialRev > rev.current && !dirty.current) { rev.current = initialRev; setItemsRaw(initial); }
  }, [initial, initialRev]);

  // Saves as you go (D184): 600 ms after the last change.
  const timer = useRef<number | null>(null);
  const flush = useCallback(async () => {
    if (!canEdit || !dirty.current) return;
    dirty.current = false; setSaveState("saving");
    try {
      const r = await onSave(itemsRef.current, rev.current);
      if (r.ok) { rev.current = r.rev; setSaveState(dirty.current ? "saving" : "saved"); }
      else { rev.current = r.rev; setItemsRaw(r.items); setSaveState("saved"); show("Someone changed the board at the same time: this is the newest. Make your last change again."); }
    } catch (e) { dirty.current = true; setSaveState("error"); show(errLine(e)); }
  }, [canEdit, onSave, show]);
  const setItems = useCallback((next: CanvasItem[] | ((x: CanvasItem[]) => CanvasItem[]), record = true) => {
    if (!canEdit) return;
    const prev = itemsRef.current;
    const v = typeof next === "function" ? next(prev) : next;
    if (record) { hist.current.past.push(prev); if (hist.current.past.length > 100) hist.current.past.shift(); hist.current.future = []; }
    itemsRef.current = v; setItemsRaw(v); dirty.current = true; setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 600);
  }, [canEdit, flush]);
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void flush(); } }, [flush]);
  useEffect(() => { const f = () => { if (dirty.current) void flush(); }; window.addEventListener("beforeunload", f); return () => window.removeEventListener("beforeunload", f); }, [flush]);
  const undo = () => { const p = hist.current.past.pop(); if (!p) return; hist.current.future.push(itemsRef.current); setItems(p, false); tick((n) => n + 1); };
  const redo = () => { const f = hist.current.future.pop(); if (!f) return; hist.current.past.push(itemsRef.current); setItems(f, false); tick((n) => n + 1); };

  const topZ = () => itemsRef.current.reduce((m, i) => Math.max(m, i.z), 0) + 1;
  const toBoard = (cx: number, cy: number) => { const r = viewRef.current!.getBoundingClientRect(); return { x: (cx - r.left - pan.x) / zoom, y: (cy - r.top - pan.y) / zoom }; };
  const add = (it: Omit<CanvasItem, "id" | "z">, edit = false) => { const n = { ...it, id: uid(), z: topZ() } as CanvasItem; setItems((xs) => [...xs, n]); setSel([n.id]); if (edit) setEditing(n.id); setTool("select"); return n; };
  const patch = (id: string, p: Partial<CanvasItem>, record = true) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)), record);
  const selected = items.filter((i) => sel.includes(i.id));
  const sorted = useMemo(() => [...items].sort((a, b) => a.z - b.z), [items]);

  // Zoom (immediate), around a point on screen.
  const zoomTo = (z: number, cx?: number, cy?: number) => {
    const r = viewRef.current?.getBoundingClientRect(); if (!r) return;
    const nz = clampZoom(z), px = cx ?? r.left + r.width / 2, py = cy ?? r.top + r.height / 2;
    const bx = (px - r.left - pan.x) / zoom, by = (py - r.top - pan.y) / zoom;
    setZoom(nz); setPan({ x: px - r.left - bx * nz, y: py - r.top - by * nz });
  };
  const fit = () => {
    const r = viewRef.current?.getBoundingClientRect(); if (!r) return;
    const xs = itemsRef.current;
    const b = xs.length ? xs.reduce((a, i) => ({ x0: Math.min(a.x0, i.x), y0: Math.min(a.y0, i.y), x1: Math.max(a.x1, i.x + i.w), y1: Math.max(a.y1, i.y + i.h) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }) : { x0: 0, y0: 0, x1: BOARD.w, y1: BOARD.h };
    const z = clampZoom(Math.min((r.width - 80) / (b.x1 - b.x0 || 1), (r.height - 80) / (b.y1 - b.y0 || 1)));
    setZoom(z); setPan({ x: r.width / 2 - ((b.x0 + b.x1) / 2) * z, y: r.height / 2 - ((b.y0 + b.y1) / 2) * z });
  };
  useEffect(() => { fit(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Wheel: ctrl/⌘ (and trackpad pinch) zooms; otherwise it moves the board.
  useEffect(() => {
    const el = viewRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("textarea, input, .cv-scroll")) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomTo(zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      else setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // Keys: delete, undo/redo, duplicate, escape, tool letters.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); dup(); return; }
      if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setSel(itemsRef.current.map((i) => i.id)); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && sel.length) { e.preventDefault(); del(); return; }
      if (e.key === "Escape") { setSel([]); setEditing(null); setMenu(null); setPop(null); setTool("select"); return; }
      if (!mod && !e.altKey) { const t = TOOLS.find((x) => x.key === e.key.toLowerCase()); if (t && (canEdit || t.k === "select" || t.k === "pan")) setTool(t.k); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const del = () => { const ids = new Set(sel.filter((id) => !itemsRef.current.find((i) => i.id === id)?.locked)); if (!ids.size) return; setItems((xs) => xs.filter((x) => !ids.has(x.id))); setSel([]); setMenu(null); };
  const dup = () => { if (!sel.length) return; const z = topZ(); const copies = itemsRef.current.filter((i) => sel.includes(i.id)).map((i, k) => ({ ...i, id: uid(), x: i.x + 24, y: i.y + 24, z: z + k, locked: undefined })); setItems((xs) => [...xs, ...copies]); setSel(copies.map((c) => c.id)); setMenu(null); };
  const forward = (dir: 1 | -1) => { const zs = itemsRef.current.map((i) => i.z); const z = dir > 0 ? Math.max(...zs) + 1 : Math.min(...zs) - 1; setItems((xs) => xs.map((x) => (sel.includes(x.id) ? { ...x, z } : x))); setMenu(null); };
  const lock = () => { const on = !selected.every((i) => i.locked); setItems((xs) => xs.map((x) => (sel.includes(x.id) ? { ...x, locked: on || undefined } : x))); setMenu(null); };

  // ---- pointer handling ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<null | { kind: "pan"; sx: number; sy: number; px: number; py: number } | { kind: "move"; sx: number; sy: number; start: Map<string, { x: number; y: number }>; moved: boolean } | { kind: "resize"; id: string; sx: number; sy: number; w: number; h: number; ratio: number | null } | { kind: "draw" } | { kind: "make"; type: "box" | "frame"; x0: number; y0: number } | { kind: "marquee"; x0: number; y0: number; add: string[] } | { kind: "erase" } | { kind: "pinch"; d: number; z: number; cx: number; cy: number }>(null);
  const holdTimer = useRef<number | null>(null);

  const onDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setMenu(null); setPop(null);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      setDrawing(null); return;
    }
    const p = toBoard(e.clientX, e.clientY);
    const hitEl = (e.target as HTMLElement).closest("[data-id]") as HTMLElement | null;
    const hit = hitEl ? itemsRef.current.find((i) => i.id === hitEl.dataset.id) ?? null : null;
    const handle = (e.target as HTMLElement).closest("[data-handle]");
    // iPad (D185): Pencil draws, fingers move the board.
    const fingerOnPen = e.pointerType === "touch" && (tool === "pen" || tool === "eraser");
    if (tool === "pan" || e.button === 1 || fingerOnPen || (!canEdit && !hit)) { gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }; return; }
    if (!canEdit) { if (hit) setSel([hit.id]); gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }; return; }
    if (tool === "pen") { gesture.current = { kind: "draw" }; setDrawing({ points: [p.x, p.y] }); return; }
    if (tool === "eraser") { gesture.current = { kind: "erase" }; if (hit?.type === "pen" && !hit.locked) setItems((xs) => xs.filter((x) => x.id !== hit.id)); return; }
    if (tool === "text") { add({ type: "text", x: p.x, y: p.y - 20, w: 320, h: TEXT_PX[st.textSize] * 1.6, text: "", size: st.textSize, weight: st.textWeight, color: st.textColor }, true); return; }
    if (tool === "note") { add({ type: "note", x: p.x - 100, y: p.y - 60, w: 220, h: 160, text: "", color: st.noteColor }, true); return; }
    if (tool === "table") { add({ type: "table", x: p.x, y: p.y, w: st.cols * 140, h: st.rows * 40, rows: Array.from({ length: st.rows }, () => Array.from({ length: st.cols }, () => "")) }); return; }
    if (tool === "box" || tool === "frame") { gesture.current = { kind: "make", type: tool, x0: p.x, y0: p.y }; setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); return; }
    if (tool === "link") { setLinkAsk(p); setTool("select"); return; }
    if (tool === "image") { fileInput.current?.click(); setTool("select"); return; }
    if (tool === "import") { setImporting(true); setTool("select"); return; }
    // Select
    if (handle && selected.length === 1) {
      const it = selected[0];
      gesture.current = { kind: "resize", id: it.id, sx: e.clientX, sy: e.clientY, w: it.w, h: it.h, ratio: it.type === "image" || e.shiftKey ? it.w / it.h : null };
      return;
    }
    if (hit) {
      if (editing === hit.id) return;
      const next = e.shiftKey ? (sel.includes(hit.id) ? sel.filter((x) => x !== hit.id) : [...sel, hit.id]) : sel.includes(hit.id) ? sel : [hit.id];
      setSel(next);
      const start = new Map(itemsRef.current.filter((i) => next.includes(i.id) && !i.locked).map((i) => [i.id, { x: i.x, y: i.y }]));
      gesture.current = { kind: "move", sx: e.clientX, sy: e.clientY, start, moved: false };
      if (e.pointerType === "touch") { const cx = e.clientX, cy = e.clientY; holdTimer.current = window.setTimeout(() => { setMenu({ x: cx, y: cy }); gesture.current = null; }, 500); }
      return;
    }
    if (e.pointerType === "touch") { gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }; setSel([]); setEditing(null); return; }
    setEditing(null);
    gesture.current = { kind: "marquee", x0: p.x, y0: p.y, add: e.shiftKey ? sel : [] };
    if (!e.shiftKey) setSel([]);
    setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current; if (!g) return;
    if (holdTimer.current && g.kind === "move" && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 6) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    const p = toBoard(e.clientX, e.clientY);
    if (g.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomTo(g.z * (d / g.d), g.cx, g.cy);
    } else if (g.kind === "pan") setPan({ x: g.px + (e.clientX - g.sx), y: g.py + (e.clientY - g.sy) });
    else if (g.kind === "move") {
      const dx = (e.clientX - g.sx) / zoom, dy = (e.clientY - g.sy) / zoom;
      if (!g.moved && Math.hypot(dx, dy) * zoom < 3) return;
      const firstMove = !g.moved; g.moved = true;
      setItems((xs) => xs.map((x) => { const s = g.start.get(x.id); return s ? { ...x, x: Math.round(s.x + dx), y: Math.round(s.y + dy) } : x; }), firstMove);
    } else if (g.kind === "resize") {
      const dx = (e.clientX - g.sx) / zoom, dy = (e.clientY - g.sy) / zoom;
      let w = Math.max(24, g.w + dx), h = Math.max(24, g.h + dy);
      if (g.ratio) h = w / g.ratio;
      const first = !(g as { started?: boolean }).started; (g as { started?: boolean }).started = true;
      patch(g.id, { w: Math.round(w), h: Math.round(h) }, first);
    } else if (g.kind === "draw") setDrawing((d) => (d ? { points: [...d.points, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10] } : d));
    else if (g.kind === "erase") { const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-id]") as HTMLElement | null; const it = el ? itemsRef.current.find((i) => i.id === el.dataset.id) : null; if (it?.type === "pen" && !it.locked) setItems((xs) => xs.filter((x) => x.id !== it.id)); }
    else if (g.kind === "make" || g.kind === "marquee") setMarquee((m) => (m ? { ...m, x1: p.x, y1: p.y } : m));
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    const g = gesture.current; gesture.current = null;
    if (!g) return;
    if (g.kind === "draw" && drawing && drawing.points.length >= 4) {
      const xs = drawing.points.filter((_, i) => i % 2 === 0), ys = drawing.points.filter((_, i) => i % 2 === 1);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), pad = st.penSize;
      add({ type: "pen", x: x0 - pad, y: y0 - pad, w: Math.max(...xs) - x0 + pad * 2, h: Math.max(...ys) - y0 + pad * 2, points: drawing.points.map((v, i) => Math.round((v - (i % 2 === 0 ? x0 : y0) + pad) * 10) / 10), stroke: st.penSize, color: st.penColor });
      setTool("pen"); setSel([]);
    }
    if (g.kind === "draw") setDrawing(null);
    if ((g.kind === "make" || g.kind === "marquee") && marquee) {
      const x0 = Math.min(marquee.x0, marquee.x1), y0 = Math.min(marquee.y0, marquee.y1), w = Math.abs(marquee.x1 - marquee.x0), h = Math.abs(marquee.y1 - marquee.y0);
      if (g.kind === "make") {
        const big = w > 12 && h > 12;
        if (g.type === "box") add({ type: "box", x: x0, y: y0, w: big ? w : 240, h: big ? h : 160, fill: st.boxFill, border: st.boxBorder, color: st.boxColor });
        else { const n = add({ type: "frame", x: x0, y: y0, w: big ? w : 800, h: big ? h : 500, text: "Frame" }); setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, z: Math.min(...xs.map((i) => i.z)) - 1 } : x)), false); }
      } else {
        const inside = itemsRef.current.filter((i) => i.x >= x0 && i.y >= y0 && i.x + i.w <= x0 + w && i.y + i.h <= y0 + h).map((i) => i.id);
        if (w > 4 || h > 4) setSel([...new Set([...g.add, ...inside])]);
      }
      setMarquee(null);
    }
  };

  // Image or file: uploaded, then placed in the middle of the view.
  const place = (r: { fileId?: string; type?: string; size?: number }, name: string, at?: { x: number; y: number }) => {
    if (!r.fileId) return;
    const view = viewRef.current!.getBoundingClientRect();
    const c = at ?? toBoard(view.left + view.width / 2, view.top + view.height / 2);
    const type = r.type ?? "";
    if (/^image\//.test(type)) {
      const img = new Image();
      img.onload = () => { const s = Math.min(1, 600 / Math.max(img.width, img.height)); add({ type: "image", x: c.x - (img.width * s) / 2, y: c.y - (img.height * s) / 2, w: Math.round(img.width * s), h: Math.round(img.height * s), fileId: r.fileId, name, mime: type, bytes: r.size }); };
      img.onerror = () => add({ type: "image", x: c.x - 200, y: c.y - 150, w: 400, h: 300, fileId: r.fileId, name, mime: type, bytes: r.size });
      img.src = files[r.fileId] ?? "";
    } else if (type === "application/pdf") add({ type: "pdf", x: c.x - 220, y: c.y - 290, w: 440, h: 580, fileId: r.fileId, name, mime: type, bytes: r.size, page: 1 });
    else add({ type: "file", x: c.x - 160, y: c.y - 50, w: 320, h: 92, fileId: r.fileId, name, mime: type, bytes: r.size });
  };
  const uploadMany = async (list: FileList | File[], at?: { x: number; y: number }, onRow?: (name: string, s: string) => void) => {
    if (!uploads) return;
    let k = 0;
    for (const f of Array.from(list)) {
      if (f.size > uploads.bytes) { onRow?.(f.name, "Too big: files can be up to 25 MB"); if (!onRow) show(`${f.name}: too big. Files can be up to 25 MB.`); continue; }
      try {
        onRow?.(f.name, "0%");
        const r = await uploads.upload(f, (p) => onRow?.(f.name, `${p}%`));
        if (r.error) { onRow?.(f.name, r.error); if (!onRow) show(`${f.name}: ${r.error}`); continue; }
        setFiles((x) => ({ ...x, [r.fileId!]: r.url ?? null }));
        await new Promise((res) => setTimeout(res, 0));
        place(r, f.name, at ? { x: at.x + k * 30, y: at.y + k * 30 } : undefined); k++;
        onRow?.(f.name, "Done");
      } catch (e) { onRow?.(f.name, errLine(e)); if (!onRow) show(errLine(e)); }
    }
  };
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); if (!canEdit || !uploads || !e.dataTransfer.files.length) return; void uploadMany(e.dataTransfer.files, toBoard(e.clientX, e.clientY)); };
  const addLink = (raw: string, at?: { x: number; y: number }) => {
    let u = raw.trim(); if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    let site = ""; try { site = new URL(u).hostname.replace(/^www\./, ""); } catch { show("That isn't a web address."); return; }
    const view = viewRef.current!.getBoundingClientRect();
    const c = at ?? toBoard(view.left + view.width / 2, view.top + view.height / 2);
    add({ type: "link", x: c.x, y: c.y, w: 320, h: 96, url: u, site, text: site });
  };

  const sz = (n: number) => n * zoom;
  const state = canEdit ? <span className={`ws-save hide-sm ${saveState}`}>{saveState === "saving" ? "Saving" : saveState === "error" ? <><Icon name="alert" size={14} /> Not saved</> : <><Icon name="check" size={14} plain /> Saved</>}</span> : null;
  const one = selected.length === 1 ? selected[0] : null;
  const selBox = selected.length ? selected.reduce((a, i) => ({ x0: Math.min(a.x0, i.x), y0: Math.min(a.y0, i.y), x1: Math.max(a.x1, i.x + i.w), y1: Math.max(a.y1, i.y + i.h) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }) : null;
  const toolbar = TOOLS.filter((t) => canEdit || t.k === "select" || t.k === "pan").filter((t) => uploads || (t.k !== "image" && t.k !== "import"));

  return (
    <div className="cv-wrap">
      {top(<>
        {canEdit && <span className="wsb-undo hide-sm"><button className="icon-btn sm" aria-label="Undo" title="Undo" disabled={!hist.current.past.length} onClick={undo}><Undo2 size={18} /></button>{!phone && <button className="icon-btn sm" aria-label="Redo" title="Redo" disabled={!hist.current.future.length} onClick={redo}><Redo2 size={18} /></button>}</span>}
        {state}
      </>)}
      <div ref={viewRef} className={`cv-view tool-${tool}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onContextMenu={(e) => { const el = (e.target as HTMLElement).closest("[data-id]") as HTMLElement | null; if (!el || !canEdit) return; e.preventDefault(); if (!sel.includes(el.dataset.id!)) setSel([el.dataset.id!]); setMenu({ x: e.clientX, y: e.clientY }); }}
        onDragOver={(e) => { if (canEdit && uploads) e.preventDefault(); }} onDrop={onDrop}
        onDoubleClick={(e) => { const el = (e.target as HTMLElement).closest("[data-id]") as HTMLElement | null; const it = el && itemsRef.current.find((i) => i.id === el.dataset.id); if (it && canEdit && !it.locked && ["note", "text", "box", "frame", "table", "link"].includes(it.type)) { setEditing(it.id); setSel([it.id]); } }}>
        <div className="cv-board" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: BOARD.w, height: BOARD.h }}>
          {sorted.map((it) => <ItemView key={it.id} it={it} url={it.fileId ? files[it.fileId] ?? null : null} editing={editing === it.id} canEdit={canEdit} onPatch={(p) => patch(it.id, p)} onDone={() => setEditing(null)} />)}
          {drawing && <svg className="cv-ink" style={{ left: 0, top: 0 }} width={BOARD.w} height={BOARD.h}><polyline points={pairs(drawing.points)} fill="none" stroke={st.penColor} strokeWidth={st.penSize} strokeLinecap="round" strokeLinejoin="round" /></svg>}
          {marquee && <div className={`cv-marquee${gesture.current?.kind === "make" ? " make" : ""}`} style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />}
          {selBox && canEdit && <div className="cv-selbox" style={{ left: selBox.x0 - 4 / zoom, top: selBox.y0 - 4 / zoom, width: selBox.x1 - selBox.x0 + 8 / zoom, height: selBox.y1 - selBox.y0 + 8 / zoom, borderWidth: 1.5 / zoom }}>
            {one && !one.locked && editing !== one.id && <span data-handle className="cv-handle" style={{ width: 14 / zoom, height: 14 / zoom, right: -7 / zoom, bottom: -7 / zoom, borderWidth: 2 / zoom }} />}
            {one?.locked && <span className="cv-lock" style={{ fontSize: 12 / zoom }}><Lock size={12 / zoom} /></span>}
          </div>}
        </div>
      </div>

      {/* Toolbar: down the left on iPad and desktop; Select, Text, Photo and Tools on a phone (D185). */}
      {phone ? (
        <nav className="cv-phonebar glass" aria-label="Tools">
          {(["select", "text", "image"] as Tool[]).filter((k) => toolbar.some((t) => t.k === k)).map((k) => { const t = TOOLS.find((x) => x.k === k)!; return <button key={k} className={tool === k ? "on" : ""} onClick={() => setTool(k)}>{t.icon}<span>{k === "image" ? "Photo" : t.label}</span></button>; })}
          {canEdit && <button className={pop === "tools" ? "on" : ""} onClick={() => setPop(pop === "tools" ? null : "tools")}><MoreHorizontal size={18} /><span>Tools</span></button>}
        </nav>
      ) : (
        <nav className="cv-toolbar glass" aria-label="Tools">
          {toolbar.map((t) => <button key={t.k} className={tool === t.k ? "on" : ""} aria-pressed={tool === t.k} title={`${t.label}${t.key ? ` (${t.key.toUpperCase()})` : ""}`} aria-label={t.label} onClick={() => { setTool(t.k); setPop(["pen", "text", "box", "table", "note"].includes(t.k) ? "settings" : null); if (t.k === "image") fileInput.current?.click(); if (t.k === "import") setImporting(true); if (t.k === "image" || t.k === "import") setTool("select"); }}>{t.icon}</button>)}
        </nav>
      )}
      {pop === "tools" && phone && <div className="cv-sheet glass" role="dialog" aria-label="Tools">
        <div className="cv-sheetgrid">{TOOLS.filter((t) => t.phone).map((t) => <button key={t.k} className={tool === t.k ? "on" : ""} onClick={() => { setTool(t.k); setPop(null); if (t.k === "image") fileInput.current?.click(); }}>{t.icon}<span>{t.k === "image" ? "Photo" : t.label}</span></button>)}</div>
        <span className="wp-field-label">On iPad and desktop</span>
        <div className="cv-sheetgrid off">{TOOLS.filter((t) => !t.phone).map((t) => <button key={t.k} disabled>{t.icon}<span>{t.label}</span></button>)}</div>
      </div>}
      {pop === "settings" && !phone && ["pen", "text", "box", "table", "note"].includes(tool) && <ToolSettings tool={tool} st={st} setSt={setSt} />}

      {/* Several selected: "4 selected" with ••• */}
      {selected.length > 1 && canEdit && <div className="cv-count glass">{selected.length} selected<button className="icon-btn sm" aria-label="Options" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}><MoreHorizontal size={16} /></button></div>}
      {one && canEdit && one.type === "table" && editing === one.id && <TableBar it={one} onPatch={(p) => patch(one.id, p)} />}
      {menu && canEdit && selected.length > 0 && (
        <div className="cv-menu glass" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 260) }} role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <button role="menuitem" onClick={() => forward(1)}>Bring forward</button>
          <button role="menuitem" onClick={() => forward(-1)}>Send back</button>
          <button role="menuitem" onClick={lock}>{selected.every((i) => i.locked) ? "Unlock" : "Lock"}</button>
          <button role="menuitem" onClick={dup}>Duplicate</button>
          {one?.fileId && files[one.fileId] && <a role="menuitem" href={files[one.fileId]!} target="_blank" rel="noreferrer" onClick={() => setMenu(null)}>Download</a>}
          <button role="menuitem" className="danger" onClick={del}>Delete</button>
        </div>
      )}

      <div className="cv-zoom glass">
        <button className="icon-btn sm" aria-label="Zoom out" onClick={() => zoomTo(zoom / 1.25)}><Minus size={16} /></button>
        <button className="cv-pct" onClick={() => zoomTo(1)} title="100%">{Math.round(zoom * 100)}%</button>
        <button className="icon-btn sm" aria-label="Zoom in" onClick={() => zoomTo(zoom * 1.25)}><Plus size={16} /></button>
        <button className="icon-btn sm" aria-label="Fit" title="Fit" onClick={fit}><Maximize size={16} /></button>
      </div>
      {!canEdit && <div className="cv-hint glass">{phone ? "Pinch to zoom · drag to move" : "Scroll to move · ⌘ or Ctrl + scroll to zoom"}</div>}
      {canEdit && tool === "pen" && !phone && <div className="cv-hint glass">Pencil draws · fingers move the board</div>}

      <input ref={fileInput} type="file" hidden multiple onChange={(e) => { if (e.target.files) void uploadMany(e.target.files); e.target.value = ""; }} />
      {linkAsk && <LinkDialog onClose={() => setLinkAsk(null)} onAdd={(u) => { addLink(u, linkAsk); setLinkAsk(null); }} />}
      {importing && uploads && <ImportDialog onClose={() => setImporting(false)} onFiles={(fl, row) => uploadMany(fl, undefined, row)} onLink={(u) => { addLink(u); setImporting(false); }} />}
      <span className="sr-only" aria-live="polite">{title}</span>
    </div>
  );
}

const pairs = (pts: number[]) => { const o: string[] = []; for (let i = 0; i + 1 < pts.length; i += 2) o.push(`${pts[i]},${pts[i + 1]}`); return o.join(" "); };

function ItemView({ it, url, editing, canEdit, onPatch, onDone }: { it: CanvasItem; url: string | null; editing: boolean; canEdit: boolean; onPatch: (p: Partial<CanvasItem>) => void; onDone: () => void }) {
  const base: React.CSSProperties = { left: it.x, top: it.y, width: it.w, height: it.h, zIndex: it.z };
  const textEdit = (cls: string, style?: React.CSSProperties) => editing && canEdit
    ? <textarea className={`cv-edit ${cls}`} style={style} autoFocus defaultValue={it.text ?? ""} onPointerDown={(e) => e.stopPropagation()} onBlur={(e) => { if (e.target.value !== (it.text ?? "")) onPatch({ text: e.target.value }); onDone(); }} onKeyDown={(e) => { if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur(); }} />
    : <div className={cls} style={style}>{it.text || (canEdit ? <span className="cv-ph">{it.type === "frame" ? "Frame" : "Double-click to type"}</span> : null)}</div>;
  switch (it.type) {
    case "note": return <div data-id={it.id} className="cv-item cv-note" style={{ ...base, background: it.color ?? NOTE_COLORS[0] }}>{textEdit("cv-notetxt")}</div>;
    case "text": return <div data-id={it.id} className="cv-item cv-text" style={{ ...base, color: it.color ?? "#F5F5F7", fontSize: TEXT_PX[it.size ?? "M"], fontWeight: it.weight === "bold" ? 700 : 400 }}>{textEdit("cv-texttxt")}</div>;
    case "box": return <div data-id={it.id} className="cv-item cv-box" style={{ ...base, background: it.fill ?? "transparent", border: it.border === "none" ? "none" : `${it.border === "thick" ? 6 : 2}px solid ${it.color ?? "#F5F5F7"}` }}>{(it.text || editing) && textEdit("cv-boxtxt")}</div>;
    case "frame": return <div data-id={it.id} className="cv-item cv-frame" style={base}><div className="cv-frametitle">{textEdit("cv-frametxt")}</div></div>;
    case "pen": return <svg data-id={it.id} className="cv-item cv-pen" style={base} width={it.w} height={it.h}><polyline points={pairs(it.points ?? [])} fill="none" stroke={it.color ?? "#F5F5F7"} strokeWidth={it.stroke ?? 3} strokeLinecap="round" strokeLinejoin="round" /><polyline className="hit" points={pairs(it.points ?? [])} fill="none" stroke="transparent" strokeWidth={Math.max(16, (it.stroke ?? 3) + 12)} /></svg>;
    case "image": return <div data-id={it.id} className="cv-item cv-image" style={base}>{url ? <img src={url} alt={it.name ?? ""} draggable={false} /> : <span className="cv-ph">Photo</span>}</div>;
    case "pdf": return <div data-id={it.id} className="cv-item cv-pdf" style={base}><PdfView url={url} page={it.page ?? 1} width={it.w} onPage={(p) => onPatch({ page: p })} name={it.name ?? "PDF"} /></div>;
    case "file": return <div data-id={it.id} className="cv-item cv-file" style={base}><Icon name="document" size={28} /><span className="t"><b>{it.name}</b><span className="secondary">{(it.name?.split(".").pop() ?? "File").toUpperCase()} · {mb(it.bytes ?? 0)}</span></span>{url && <a className="btn sm" href={url} target="_blank" rel="noreferrer" onPointerDown={(e) => e.stopPropagation()}><Download size={14} /> Download</a>}</div>;
    case "link": return <div data-id={it.id} className="cv-item cv-link" style={base}><span className="fav"><Icon name="globe" size={22} /></span><span className="t">{editing && canEdit ? textEdit("cv-linktitle") : <b>{it.text || it.site}</b>}<a className="secondary" href={it.url} target="_blank" rel="noreferrer noopener" onPointerDown={(e) => e.stopPropagation()}>{it.site}</a></span></div>;
    case "table": {
      const rows = it.rows ?? [[""]];
      return <div data-id={it.id} className="cv-item cv-table" style={base}>
        <table><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{editing && canEdit
          ? <input defaultValue={c} data-cell={`${i}:${j}`} onPointerDown={(e) => e.stopPropagation()} onBlur={(e) => { if (e.target.value !== c) onPatch({ rows: rows.map((rr, a) => (a === i ? rr.map((cc, b) => (b === j ? e.target.value : cc)) : rr)) }); }} />
          : <span>{c}</span>}</td>)}</tr>)}</tbody></table>
      </div>;
    }
  }
}

function PdfView({ url, page, width, onPage, name }: { url: string | null; page: number; width: number; onPage: (p: number) => void; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { if (!url) return; let live = true; openPdf(url).then((d) => { if (live) setDoc(d); }, () => setErr(true)); return () => { live = false; }; }, [url]);
  useEffect(() => { if (doc && ref.current) void renderPage(doc, Math.min(page, doc.numPages) - 1, ref.current, Math.min(width, 900)).catch(() => setErr(true)); }, [doc, page, width]);
  const n = doc?.numPages ?? 1;
  return (
    <>
      {err ? <div className="cv-ph"><Icon name="document" size={28} />{name}</div> : <canvas ref={ref} style={{ width: "100%", height: "auto" }} />}
      {n > 1 && <div className="cv-pdfnav" onPointerDown={(e) => e.stopPropagation()}><button className="icon-btn sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button><span>{page} / {n}</span><button className="icon-btn sm" aria-label="Next page" disabled={page >= n} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button></div>}
    </>
  );
}

function ToolSettings({ tool, st, setSt }: { tool: Tool; st: Settings; setSt: (s: Settings) => void }) {
  const up = (p: Partial<Settings>) => setSt({ ...st, ...p });
  const swatches = (v: string, on: (c: string) => void, list = COLORS) => <div className="cv-swatches">{list.map((c) => <button key={c} aria-label={c} className={v === c ? "on" : ""} style={{ background: c }} onClick={() => on(c)} />)}<input type="color" aria-label="Pick a colour" value={v} onChange={(e) => on(e.target.value)} /></div>;
  return (
    <div className="cv-pop glass" role="dialog" aria-label="Tool settings" onPointerDown={(e) => e.stopPropagation()}>
      {tool === "pen" && <><span className="wp-field-label">Size</span><div className="cv-seg">{PEN_SIZES.map((s) => <button key={s} className={st.penSize === s ? "on" : ""} onClick={() => up({ penSize: s })}><i style={{ width: s + 2, height: s + 2 }} /></button>)}</div><span className="wp-field-label">Colour</span>{swatches(st.penColor, (c) => up({ penColor: c }))}</>}
      {tool === "text" && <><span className="wp-field-label">Size</span><div className="cv-seg">{(["S", "M", "L", "XL"] as const).map((s) => <button key={s} className={st.textSize === s ? "on" : ""} onClick={() => up({ textSize: s })}>{s}</button>)}</div>
        <span className="wp-field-label">Weight</span><div className="cv-seg">{(["regular", "bold"] as const).map((w) => <button key={w} className={st.textWeight === w ? "on" : ""} onClick={() => up({ textWeight: w })}>{w === "bold" ? "Bold" : "Regular"}</button>)}</div><span className="wp-field-label">Colour</span>{swatches(st.textColor, (c) => up({ textColor: c }))}</>}
      {tool === "box" && <><span className="wp-field-label">Fill</span><div className="cv-swatches"><button className={st.boxFill === null ? "on none" : "none"} aria-label="No fill" onClick={() => up({ boxFill: null })} />{COLORS.map((c) => <button key={c} aria-label={c} className={st.boxFill === c ? "on" : ""} style={{ background: c }} onClick={() => up({ boxFill: c })} />)}</div>
        <span className="wp-field-label">Border</span><div className="cv-seg">{(["none", "thin", "thick"] as const).map((b) => <button key={b} className={st.boxBorder === b ? "on" : ""} onClick={() => up({ boxBorder: b })}>{b[0].toUpperCase() + b.slice(1)}</button>)}</div><span className="wp-field-label">Colour</span>{swatches(st.boxColor, (c) => up({ boxColor: c }))}</>}
      {tool === "note" && <><span className="wp-field-label">Paper</span>{swatches(st.noteColor, (c) => up({ noteColor: c }), NOTE_COLORS)}</>}
      {tool === "table" && <div className="cv-two"><label className="wp-field"><span className="wp-field-label">Rows</span><input className="input" type="number" min={1} max={40} value={st.rows} onChange={(e) => up({ rows: Math.max(1, Math.min(40, Number(e.target.value) || 1)) })} /></label><label className="wp-field"><span className="wp-field-label">Columns</span><input className="input" type="number" min={1} max={20} value={st.cols} onChange={(e) => up({ cols: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} /></label></div>}
    </div>
  );
}

/** A table being edited (1073-35992): add a row or a column; insert or delete where the cursor is. */
function TableBar({ it, onPatch }: { it: CanvasItem; onPatch: (p: Partial<CanvasItem>) => void }) {
  const rows = it.rows ?? [[""]];
  const at = () => { const a = (document.activeElement as HTMLElement | null)?.dataset.cell?.split(":").map(Number); return a && a.length === 2 ? { r: a[0], c: a[1] } : { r: rows.length - 1, c: rows[0].length - 1 }; };
  const set = (r: string[][]) => onPatch({ rows: r, w: Math.max(80, r[0].length * 140), h: Math.max(40, r.length * 40) });
  return (
    <div className="cv-tablebar glass" onPointerDown={(e) => e.preventDefault()}>
      <button onClick={() => { const { r } = at(); set([...rows.slice(0, r), rows[r].map(() => ""), ...rows.slice(r)]); }}>Row above</button>
      <button onClick={() => { const { r } = at(); set([...rows.slice(0, r + 1), rows[r].map(() => ""), ...rows.slice(r + 1)]); }}>Row below</button>
      <button disabled={rows.length < 2} onClick={() => { const { r } = at(); set(rows.filter((_, i) => i !== r)); }}>Delete row</button>
      <span className="sep" />
      <button onClick={() => { const { c } = at(); set(rows.map((x) => [...x.slice(0, c), "", ...x.slice(c)])); }}>Column left</button>
      <button onClick={() => { const { c } = at(); set(rows.map((x) => [...x.slice(0, c + 1), "", ...x.slice(c + 1)])); }}>Column right</button>
      <button disabled={rows[0].length < 2} onClick={() => { const { c } = at(); set(rows.map((x) => x.filter((_, i) => i !== c))); }}>Delete column</button>
    </div>
  );
}

function LinkDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (u: string) => void }) {
  const [u, setU] = useState("");
  return (
    <Modal onClose={onClose} label="Add a link" width={460}>
      <form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); if (u.trim()) onAdd(u); }}>
        <DialogHeader title="Add a link" onClose={onClose} />
        <TextField label="Web address" value={u} onChange={(e) => setU(e.target.value)} placeholder="vimeo.com/…" autoFocus />
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" type="submit" disabled={!u.trim()}>Add</Button></div>
      </form>
    </Modal>
  );
}

/** Import (1075-34928): drop zone, Browse, paste a link; each upload's state (done, 64%, too big, not allowed). */
function ImportDialog({ onClose, onFiles, onLink }: { onClose: () => void; onFiles: (f: FileList, row: (name: string, s: string) => void) => Promise<void>; onLink: (u: string) => void }) {
  const [rows, setRows] = useState<Array<{ name: string; s: string }>>([]);
  const [drag, setDrag] = useState(false);
  const [u, setU] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const row = (name: string, s: string) => setRows((r) => (r.some((x) => x.name === name) ? r.map((x) => (x.name === name ? { name, s } : x)) : [...r, { name, s }]));
  return (
    <Modal onClose={onClose} label="Import" width={560}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Import" title="Add photos, PDFs and files" body="Files can be up to 25 MB. Programs and web pages aren't allowed." onClose={onClose} />
        <button type="button" className={`bk-drop${drag ? " over" : ""}`} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void onFiles(e.dataTransfer.files, row); }}>
          <Icon name="upload" size={16} />Drop files here, or <b>browse</b>
        </button>
        <input ref={input} type="file" hidden multiple onChange={(e) => { if (e.target.files) void onFiles(e.target.files, row); e.target.value = ""; }} />
        {rows.length > 0 && <div className="cv-uploads">{rows.map((r) => <div key={r.name} className={`cv-up ${r.s === "Done" ? "ok" : /%$/.test(r.s) ? "" : "bad"}`}><span className="t">{r.name}</span><span className="secondary">{r.s === "Done" ? "Done" : /%$/.test(r.s) ? r.s : r.s}</span>{/%$/.test(r.s) && <i style={{ width: r.s }} />}</div>)}</div>}
        <form className="cr-link" onSubmit={(e) => { e.preventDefault(); if (u.trim()) onLink(u); }}><input className="input" value={u} onChange={(e) => setU(e.target.value)} placeholder="Or paste a link" aria-label="Paste a link" /><Button type="submit" disabled={!u.trim()}>Add link</Button></form>
        <div className="dfoot"><span className="sp" /><Button variant="primary" onClick={onClose}>Done</Button></div>
      </div>
    </Modal>
  );
}
export type { CanvasType };
