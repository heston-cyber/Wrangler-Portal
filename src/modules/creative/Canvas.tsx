// 5l round 2 (D183–D185; Design Log "Handoff ready: Creative planning, round 2"): Canvas and mood boards.
// The list (cards with a small picture of each board), New canvas, and the board itself: items on a board with its edge
// visible; tools Select, Pan, Pen, Eraser, Text, Note, Box, Table, Frame, Image or file, Link, Import; zoom 25–400%
// (immediate), undo and redo, an item menu (right-click, or press and hold on touch), saves as you go (D184, no live
// cursors). iPad: Pencil draws, fingers move the board (D185); a phone gets Select, Text, Photo and the Tools sheet with
// the rest greyed "On iPad and desktop". Popovers move in 140 ms with no fade. Shared people use the same board on their
// own link (/cv/<token>): Can view reads it, Can edit changes it (no uploads).
import { useLinkWindow } from "../../lib/linkWindow";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import rough from "roughjs";
import { hapticHold } from "../../lib/haptic";
import { useMutation, useQuery } from "convex/react";
import {
  MousePointer2, Hand, Pencil, Eraser, Type, Square, Circle, ArrowRight, Minus as LineIcon, ImagePlus, Box, Lock, LockOpen, Undo2, Redo2, Minus, Plus, Menu, CircleQuestionMark,
  StickyNote, Table2, Frame, Link2, Upload, ChevronLeft, ChevronRight, Download, MoreHorizontal, ArrowDownToLine, ArrowDown, ArrowUp, ArrowUpToLine,
} from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { Modal, swallowNextClick, useConfirm, useToast } from "../../ui/kit";
import { Button, DialogHeader, EmptyState, PageHeader, PillTabs, SkeletonRows, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { errLine } from "../../ui/hold";
import { AttachDialog } from "../projects/Homes";
import { HomeSelect, HomeTag, copyText, shareUrl } from "./parts";

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
  const at = useLinkWindow();
  const list = useQuery(api.canvas.list, { at });
  const [f, setF] = useState<"all" | "canvas" | "mood" | "shared" | "loose">("all");
  const [open, setOpen] = useState<null | "canvas" | "mood">(() => (new URLSearchParams(location.search).get("new") === "mood" ? "mood" : new URLSearchParams(location.search).has("new") ? "canvas" : null));
  const [toast, show] = useToast();
  const all = list ?? [];
  const rows = all.filter((c) => f === "all" || (f === "shared" ? c.shared > 0 : f === "loose" ? !c.home : c.kind === f));
  const n = (k: string) => all.filter((c) => (k === "shared" ? c.shared > 0 : k === "loose" ? !c.home : c.kind === k)).length;
  return (
    <>
      <TopBar><a {...linkProps("/production")}>Production</a><Sep /><a {...linkProps("/creative")}>Creative planning</a><Sep /><span className="here">Canvas and mood boards</span></TopBar>
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

function MiniBoard({ items }: { items: Array<{ type: string; x: number; y: number; w: number; h: number; color: string | null; fill?: string | null; pts?: number[] | null; src: string | null }> }) {
  const box = items.length ? items.reduce((b, i) => ({ x0: Math.min(b.x0, i.x), y0: Math.min(b.y0, i.y), x1: Math.max(b.x1, i.x + i.w), y1: Math.max(b.y1, i.y + i.h) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }) : { x0: 0, y0: 0, x1: 800, y1: 500 };
  const pad = 40;
  const ink = (i: { color: string | null }) => i.color ?? "#D3D3D3";
  return (
    <svg className="cv-mini" viewBox={`${box.x0 - pad} ${box.y0 - pad} ${box.x1 - box.x0 + pad * 2} ${box.y1 - box.y0 + pad * 2}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {items.map((i, k) => i.type === "image" && i.src ? <image key={k} href={i.src} x={i.x} y={i.y} width={i.w} height={i.h} preserveAspectRatio="xMidYMid slice" />
        : i.type === "ellipse" ? <ellipse key={k} cx={i.x + i.w / 2} cy={i.y + i.h / 2} rx={i.w / 2} ry={i.h / 2} fill={i.fill ?? "none"} stroke={ink(i)} strokeWidth={4} />
        : i.type === "arrow" || i.type === "line" ? <line key={k} x1={i.x + (i.pts?.[0] ?? 0)} y1={i.y + (i.pts?.[1] ?? 0)} x2={i.x + (i.pts?.[2] ?? i.w)} y2={i.y + (i.pts?.[3] ?? i.h)} stroke={ink(i)} strokeWidth={4} strokeLinecap="round" />
        : i.type === "pen" ? <rect key={k} x={i.x} y={i.y} width={i.w} height={i.h} rx={2} fill="none" stroke={ink(i)} strokeWidth={3} strokeDasharray="6 6" />
        : i.type === "box" ? <rect key={k} x={i.x} y={i.y} width={i.w} height={i.h} rx={8} fill={i.fill ?? "none"} stroke={ink(i)} strokeWidth={4} />
        : <rect key={k} x={i.x} y={i.y} width={i.w} height={i.h} rx={i.type === "note" ? 6 : 2} fill={i.type === "frame" ? "none" : i.type === "note" ? i.color ?? "#FFF4B8" : "rgba(255,255,255,.14)"} stroke={i.type === "frame" ? "rgba(255,255,255,.35)" : "none"} strokeWidth={6} />)}
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
  const at = useLinkWindow();
  const c = useQuery(api.canvas.get, { canvasId, at });
  const save = useMutation(api.canvas.save);
  const rename = useMutation(api.canvas.rename);
  const remove = useMutation(api.canvas.remove);
  const duplicate = useMutation(api.canvas.duplicate);
  const uploadUrl = useMutation(api.canvas.uploadUrl);
  const addFile = useMutation(api.canvas.addFile);
  const dropUnused = useMutation(api.canvas.dropUnused);
  const [toast, show] = useToast();
  const [ask, confirmNode] = useConfirm();
  const [dialog, setDialog] = useState<null | "share" | "move" | "rename">(null);
  const [nameDraft, setNameDraft] = useState("");
  if (c === undefined) return <><TopBar><a {...linkProps("/production")}>Production</a><Sep /><a {...linkProps("/creative")}>Creative planning</a><Sep /><a {...linkProps("/creative/canvas")}>Canvas and mood boards</a></TopBar><div className="wp-page"><SkeletonRows n={4} /></div></>;
  if (c === null) return <><TopBar><a {...linkProps("/production")}>Production</a><Sep /><a {...linkProps("/creative")}>Creative planning</a><Sep /><a {...linkProps("/creative/canvas")}>Canvas and mood boards</a></TopBar><div className="wp-page"><EmptyState icon="creative" title="This board isn't here." actions={<Button onClick={() => navigate("/creative/canvas")}>All boards</Button>} /></div></>;
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
            <Button variant="primary" size="sm" onClick={() => setDialog("share")}>Share{c.people.length ? ` · ${c.people.length}` : ""}</Button>
          </>}>
            <a {...linkProps("/creative")} className="hide-sm">Creative planning</a><Sep /><a {...linkProps("/creative/canvas")}>Canvas and mood boards</a><Sep />
            <button type="button" className="here cv-name" onClick={() => { setNameDraft(c.name); setDialog("rename"); }} title="Rename">{c.name}</button>
          </TopBar>
        )} show={show} menu={[
          { label: "Rename", onClick: () => { setNameDraft(c.name); setDialog("rename"); } },
          { label: c.home ? "Move to…" : "Attach to…", onClick: () => setDialog("move") },
          { label: "Duplicate", onClick: () => void duplicate({ canvasId }).then((id) => navigate(`/creative/canvas/${id}`), (e) => show(errLine(e))) },
          { label: "Delete", danger: true, onClick: async () => { if (await ask({ title: `Delete ${c.name}?`, body: "Its photos and files go too, and every share link stops working.", yes: "Delete", danger: true })) { try { await remove({ canvasId }); navigate("/creative/canvas"); } catch (e) { show(errLine(e)); } } } },
        ]} />
      {dialog === "share" && <ShareCanvas c={c} onClose={() => setDialog(null)} show={show} />}
      {dialog === "move" && <AttachDialog kind="canvas" id={c._id} name={c.name} hasHome={!!c.home} onClose={() => setDialog(null)} show={show} />}
      {dialog === "rename" && <Modal onClose={() => setDialog(null)} label="Rename" width={440}><form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void rename({ canvasId, name: nameDraft }).then(() => setDialog(null), (er) => show(errLine(er))); }}>
        <DialogHeader title="Rename the board" onClose={() => setDialog(null)} /><TextField label="Name" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoFocus />
        <div className="dfoot"><button type="button" className="btn ghost" onClick={() => setDialog(null)}>Cancel</button><Button variant="primary" type="submit" disabled={!nameDraft.trim()}>Save</Button></div></form></Modal>}
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
const useCanvasGet = (canvasId: string) => useQuery(api.canvas.get, { canvasId, at: useLinkWindow() });

// ---------- the shared board (/cv/<token>) ----------

export function SharedCanvas({ token }: { token: string }) {
  const at = useLinkWindow();
  const c = useQuery(api.canvas.shared, { token, at });
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

type Uploads = { upload: (f: File, onProgress: (p: number) => void) => Promise<{ error: string | null; fileId?: string; url?: string | null; type?: string; size?: number }>; bytes: number };
type BoardMenuItem = { label: string; onClick: () => void; danger?: boolean };

type Tool = "select" | "pan" | "box" | "ellipse" | "arrow" | "line" | "pen" | "text" | "image" | "eraser" | "note" | "table" | "frame" | "link" | "import";
const MAIN: Array<{ k: Tool; label: string; icon: React.ReactNode; n?: string; key?: string; phone?: boolean }> = [
  { k: "pan", label: "Hand", icon: <Hand size={18} />, key: "h", phone: true },
  { k: "select", label: "Select", icon: <MousePointer2 size={18} />, n: "1", key: "v", phone: true },
  { k: "box", label: "Rectangle", icon: <Square size={18} />, n: "2", key: "r" },
  { k: "ellipse", label: "Circle", icon: <Circle size={18} />, n: "3", key: "o" },
  { k: "arrow", label: "Arrow", icon: <ArrowRight size={18} />, n: "4", key: "a" },
  { k: "line", label: "Line", icon: <LineIcon size={18} style={{ transform: "rotate(-45deg)" }} />, n: "5", key: "l" },
  { k: "pen", label: "Draw", icon: <Pencil size={18} />, n: "6", key: "p" },
  { k: "text", label: "Text", icon: <Type size={18} />, n: "7", key: "t", phone: true },
  { k: "image", label: "Image", icon: <ImagePlus size={18} />, n: "8", phone: true },
  { k: "eraser", label: "Eraser", icon: <Eraser size={18} />, n: "9", key: "e" },
];
const MORE: Array<{ k: Tool; label: string; icon: React.ReactNode; key?: string }> = [
  { k: "note", label: "Note", icon: <StickyNote size={18} />, key: "n" },
  { k: "table", label: "Table", icon: <Table2 size={18} /> },
  { k: "frame", label: "Frame", icon: <Frame size={18} />, key: "f" },
  { k: "link", label: "Link", icon: <Link2 size={18} /> },
  { k: "import", label: "Import", icon: <Upload size={18} /> },
];
const HINT: Partial<Record<Tool, string>> = {
  select: "To move canvas, hold Scroll wheel or Space while dragging, or use the hand tool",
  pan: "Drag to move the canvas",
  box: "Click and drag to draw a rectangle. Hold Shift for a square",
  ellipse: "Click and drag to draw a circle. Hold Shift for a perfect circle",
  arrow: "Click and drag to draw an arrow. Hold Shift to snap the angle",
  line: "Click and drag to draw a line. Hold Shift to snap the angle",
  pen: "Draw freely. On iPad, Pencil draws and fingers move the canvas",
  text: "Click anywhere to type",
  eraser: "Click or drag over things to erase them",
  note: "Click to place a note", table: "Click to place a table", frame: "Click and drag to draw a frame",
};
// Excalidraw-like dark palette (Heston's screenshot): stroke and background swatches, then a custom colour.
const STROKES = ["#D3D3D3", "#FF8383", "#3A994C", "#56A2E8", "#B76100"];
const FILLS: Array<string | null> = [null, "#5B2C2C", "#043B0C", "#154163", "#362600"];
const NOTE_COLORS = ["#FFF4B8", "#FFD6E0", "#CFF5D7", "#D6E9FF", "#EADCFF"];
const WIDTHS = [1, 2, 4];
const TEXT_PX: Record<string, number> = { S: 16, M: 22, L: 34, XL: 56 };
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const seed = () => Math.floor(Math.random() * 2 ** 31);
const clampZoom = (z: number) => Math.min(4, Math.max(0.25, z));
const SHAPES = new Set(["box", "ellipse"]);
const LINES = new Set(["arrow", "line"]);
type Style = { color: string; fill: string | null; stroke: number; dash: "solid" | "dashed" | "dotted"; rough: 0 | 1 | 2; round: boolean; opacity: number; size: "S" | "M" | "L" | "XL"; note: string; rows: number; cols: number };

function Board({ title, items: initial, rev: initialRev, files: fileUrls, canEdit, uploads, onSave, top, show, menu }: {
  title: string; items: CanvasItem[]; rev: number; files: Record<string, string | null>; canEdit: boolean; uploads?: Uploads;
  onSave: (items: CanvasItem[], rev: number) => Promise<SaveResult>; top: (state: React.ReactNode) => React.ReactNode; show: (t: string) => void; menu?: BoardMenuItem[];
}) {
  const [items, setItemsRaw] = useState<CanvasItem[]>(initial);
  const itemsRef = useRef(items); itemsRef.current = items;
  const rev = useRef(initialRev);
  const dirty = useRef(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const hist = useRef<{ past: CanvasItem[][]; future: CanvasItem[][] }>({ past: [], future: [] });
  const [, tick] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [tool, setToolRaw] = useState<Tool>(canEdit ? "select" : "pan");
  const [keep, setKeep] = useState(false); // keep the tool picked after drawing
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [editing, setEditing] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [pop, setPop] = useState<null | "more" | "menu" | "tools" | "help">(null);
  const [st, setSt] = useState<Style>({ color: STROKES[0], fill: null, stroke: 2, dash: "solid", rough: 1, round: true, opacity: 100, size: "M", note: NOTE_COLORS[0], rows: 3, cols: 3 });
  const [drawing, setDrawing] = useState<{ points: number[] } | null>(null);
  const [ghost, setGhost] = useState<CanvasItem | null>(null); // the shape or line being drawn
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [linkAsk, setLinkAsk] = useState<{ x: number; y: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [files, setFiles] = useState(fileUrls);
  const [space, setSpace] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const phone = typeof window !== "undefined" && window.matchMedia("(max-width: 600px)").matches;
  // Phase 6 review L1: file links last 10-20 minutes and the page asks for fresh ones each window; a picture already on
  // the board keeps the link it loaded with (no re-download), and only a failed load or a download takes the newest.
  const latest = useRef(fileUrls);
  useEffect(() => {
    latest.current = { ...latest.current, ...fileUrls };
    setFiles((f) => { const n = { ...f }; for (const [k, u] of Object.entries(fileUrls)) if (!n[k]) n[k] = u; return n; });
  }, [fileUrls]);
  const freshUrl = useCallback((id: string) => latest.current[id] ?? null, []);
  const setTool = (t: Tool) => { setToolRaw(t); setPop(null); setCtxMenu(null); if (t !== "select") { setSel([]); setEditing(null); } };

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
  const done = () => { if (!keep) setToolRaw("select"); };
  const add = (it: Omit<CanvasItem, "id" | "z">, edit = false) => { const n = { ...it, id: uid(), z: topZ() } as CanvasItem; setItems((xs) => [...xs, n]); setSel([n.id]); if (edit) setEditing(n.id); done(); return n; };
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
    const b = xs.length ? xs.reduce((a, i) => ({ x0: Math.min(a.x0, i.x), y0: Math.min(a.y0, i.y), x1: Math.max(a.x1, i.x + i.w), y1: Math.max(a.y1, i.y + i.h) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }) : { x0: 0, y0: 0, x1: 1600, y1: 1000 };
    // Room for the toolbar above and the style panel on the left.
    const left = phone ? 16 : 250, topPad = phone ? 24 : 110, bottom = phone ? 180 : 80;
    const z = clampZoom(Math.min((r.width - left - 40) / (b.x1 - b.x0 || 1), (r.height - topPad - bottom) / (b.y1 - b.y0 || 1), 1));
    setZoom(z); setPan({ x: left + (r.width - left - 40) / 2 - ((b.x0 + b.x1) / 2) * z, y: topPad + (r.height - topPad - bottom) / 2 - ((b.y0 + b.y1) / 2) * z });
  };
  // The board fills the screen below whatever sits above it (on a phone, the app's header), so nothing hides off the bottom.
  const wrapRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const size = () => { el.style.height = `${Math.max(320, window.innerHeight - (el.getBoundingClientRect().top + window.scrollY))}px`; };
    size(); window.addEventListener("resize", size);
    return () => window.removeEventListener("resize", size);
  }, []);
  useEffect(() => { fit(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Phone (Heston, Nov 17): typing opens the keyboard over the bottom half, so the thing being typed in moves up near
  // the top of the board, and the bars at the bottom step aside until Done.
  useEffect(() => {
    if (!phone || !editing) return;
    const it = itemsRef.current.find((i) => i.id === editing); const r = viewRef.current?.getBoundingClientRect(); if (!it || !r) return;
    const z = Math.max(zoom, 0.8); // big enough to read what you type
    const sx = pan.x + it.x * z, sy = pan.y + it.y * z;
    const nx = z !== zoom || sx < 8 || sx + Math.min(it.w * z, r.width - 16) > r.width - 8 ? pan.x - sx + 16 : pan.x;
    const ny = z !== zoom || sy < 60 || sy > r.height * 0.3 ? pan.y - sy + 64 : pan.y;
    if (z !== zoom) setZoom(z);
    if (nx !== pan.x || ny !== pan.y) setPan({ x: nx, y: ny });
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Keys: numbers and letters pick tools; Space holds to move; delete, undo/redo, duplicate, escape.
  useEffect(() => {
    const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]");
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === " ") { e.preventDefault(); if (!space) setSpace(true); return; }
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); dup(); return; }
      if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); setToolRaw("select"); setSel(itemsRef.current.map((i) => i.id)); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && sel.length) { e.preventDefault(); del(); return; }
      if (e.key === "Escape") { setSel([]); setEditing(null); setCtxMenu(null); setPop(null); setToolRaw(canEdit ? "select" : "pan"); return; }
      if (e.shiftKey && e.key === "!") { fit(); return; }
      if (mod || e.altKey) return;
      if (e.key.toLowerCase() === "q" && canEdit) { setKeep((k) => !k); return; }
      if (e.key === "?") { setPop("help"); return; }
      const t = [...MAIN, ...MORE].find((x) => ("n" in x && x.n === e.key) || x.key === e.key.toLowerCase());
      if (!t || (!canEdit && t.k !== "select" && t.k !== "pan")) return;
      if (t.k === "image" || t.k === "import") { if (!uploads) return; if (t.k === "image") imageInput.current?.click(); else setImporting(true); return; }
      setTool(t.k);
    };
    const up = (e: KeyboardEvent) => { if (e.key === " ") setSpace(false); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  });

  const del = () => { const ids = new Set(sel.filter((id) => !itemsRef.current.find((i) => i.id === id)?.locked)); if (!ids.size) return; setItems((xs) => xs.filter((x) => !ids.has(x.id))); setSel([]); setCtxMenu(null); };
  const dup = () => { if (!sel.length) return; const z = topZ(); const copies = itemsRef.current.filter((i) => sel.includes(i.id)).map((i, k) => ({ ...i, id: uid(), x: i.x + 24, y: i.y + 24, z: z + k, locked: undefined })); setItems((xs) => [...xs, ...copies]); setSel(copies.map((c) => c.id)); setCtxMenu(null); };
  /** Layers: to back, back one, forward one, to front. */
  const layer = (how: "back" | "backward" | "forward" | "front") => {
    const xs = [...itemsRef.current].sort((a, b) => a.z - b.z);
    const ids = new Set(sel);
    let order = xs;
    if (how === "front") order = [...xs.filter((x) => !ids.has(x.id)), ...xs.filter((x) => ids.has(x.id))];
    else if (how === "back") order = [...xs.filter((x) => ids.has(x.id)), ...xs.filter((x) => !ids.has(x.id))];
    else {
      order = [...xs];
      const step = how === "forward" ? 1 : -1;
      const idx = order.map((x, i) => (ids.has(x.id) ? i : -1)).filter((i) => i >= 0);
      for (const i of step > 0 ? idx.reverse() : idx) { const j = i + step; if (j < 0 || j >= order.length || ids.has(order[j].id)) continue; [order[i], order[j]] = [order[j], order[i]]; }
    }
    const z = new Map(order.map((x, i) => [x.id, i + 1]));
    setItems((all) => all.map((x) => ({ ...x, z: z.get(x.id) ?? x.z }))); setCtxMenu(null);
  };
  const lock = () => { const on = !selected.every((i) => i.locked); setItems((xs) => xs.map((x) => (sel.includes(x.id) ? { ...x, locked: on || undefined } : x))); setCtxMenu(null); };

  /** A style change: it applies to what's selected and becomes the default for the next thing drawn. */
  const restyle = (p: Partial<Style>) => {
    setSt((s) => ({ ...s, ...p }));
    if (!selected.length) return;
    setItems((xs) => xs.map((x) => {
      if (!sel.includes(x.id) || x.locked) return x;
      const n = { ...x };
      if (p.color !== undefined && x.type !== "note") n.color = p.color;
      if (p.fill !== undefined && SHAPES.has(x.type)) n.fill = p.fill;
      if (p.note !== undefined && x.type === "note") n.color = p.note;
      if (p.stroke !== undefined && (SHAPES.has(x.type) || LINES.has(x.type))) n.stroke = p.stroke;
      if (p.stroke !== undefined && x.type === "pen") n.stroke = Math.max(2, p.stroke * 2); // a pen line is drawn twice as thick
      if (p.dash !== undefined && (SHAPES.has(x.type) || LINES.has(x.type))) n.dash = p.dash;
      if (p.rough !== undefined && (SHAPES.has(x.type) || LINES.has(x.type))) { n.rough = p.rough; n.seed = n.seed ?? seed(); }
      if (p.round !== undefined && x.type === "box") n.round = p.round;
      if (p.opacity !== undefined) n.opacity = p.opacity;
      if (p.size !== undefined && x.type === "text") { n.size = p.size; n.h = Math.max(x.h, TEXT_PX[p.size] * 1.6); }
      return n;
    }));
  };

  // ---- pointer handling ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  type G = { kind: "pan"; sx: number; sy: number; px: number; py: number } | { kind: "move"; sx: number; sy: number; start: Map<string, { x: number; y: number }>; moved: boolean }
    | { kind: "resize"; id: string; sx: number; sy: number; w: number; h: number; ratio: number | null; pts: number[] | null; started?: boolean } | { kind: "end"; id: string; which: 0 | 1; started?: boolean }
    | { kind: "draw" } | { kind: "make"; type: "box" | "ellipse" | "frame" | "arrow" | "line"; x0: number; y0: number } | { kind: "marquee"; x0: number; y0: number; add: string[] } | { kind: "erase" } | { kind: "pinch"; d: number; z: number; cx: number; cy: number };
  const gesture = useRef<G | null>(null);
  const holdTimer = useRef<number | null>(null);
  const styleFor = (type: string): Partial<CanvasItem> => ({
    color: st.color, ...(st.opacity < 100 ? { opacity: st.opacity } : {}),
    ...(SHAPES.has(type) || LINES.has(type) ? { stroke: st.stroke, dash: st.dash, rough: st.rough, seed: seed() } : {}),
    ...(SHAPES.has(type) ? { fill: st.fill } : {}), ...(type === "box" ? { round: st.round } : {}),
  });
  const lineItem = (type: "arrow" | "line", x1: number, y1: number, x2: number, y2: number, base?: Partial<CanvasItem>): Omit<CanvasItem, "id" | "z"> => {
    const x0 = Math.min(x1, x2), y0 = Math.min(y1, y2);
    return { ...(base ?? styleFor(type)), type, x: x0, y: y0, w: Math.max(1, Math.abs(x2 - x1)), h: Math.max(1, Math.abs(y2 - y1)), points: [x1 - x0, y1 - y0, x2 - x0, y2 - y0].map((v) => Math.round(v * 10) / 10) } as Omit<CanvasItem, "id" | "z">;
  };
  const snapEnd = (x0: number, y0: number, x1: number, y1: number, on: boolean) => {
    if (!on) return { x: x1, y: y1 };
    const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 12)) * (Math.PI / 12), d = Math.hypot(x1 - x0, y1 - y0);
    return { x: x0 + Math.cos(a) * d, y: y0 + Math.sin(a) * d };
  };
  const erase = (it: CanvasItem | null | undefined) => { if (it && !it.locked) setItems((xs) => xs.filter((x) => x.id !== it.id)); };

  const onDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    if ((e.target as HTMLElement).closest(".cv-ui")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ctxMenu || pop) { setCtxMenu(null); setPop(null); swallowNextClick(); return; } // Heston (10:47): a tap outside an open menu only closes it
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      setDrawing(null); setGhost(null); return;
    }
    const p = toBoard(e.clientX, e.clientY);
    const hitEl = (e.target as HTMLElement).closest("[data-id]") as HTMLElement | null;
    const hit = hitEl ? itemsRef.current.find((i) => i.id === hitEl.dataset.id) ?? null : null;
    const handle = (e.target as HTMLElement).closest("[data-handle]") as HTMLElement | null;
    // iPad (D185): Pencil draws, fingers move the board. Space or the wheel button moves it too.
    const fingerOnPen = e.pointerType === "touch" && (tool === "pen" || tool === "eraser");
    if (tool === "pan" || space || e.button === 1 || fingerOnPen || !canEdit) { if (!canEdit && hit) setSel([hit.id]); gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }; return; }
    if (tool === "pen") { gesture.current = { kind: "draw" }; setDrawing({ points: [p.x, p.y] }); return; }
    if (tool === "eraser") { gesture.current = { kind: "erase" }; erase(hit); return; }
    if (tool === "text") { add({ ...styleFor("text"), type: "text", x: p.x, y: p.y - TEXT_PX[st.size] * 0.8, w: 360, h: TEXT_PX[st.size] * 1.6, text: "", size: st.size } as CanvasItem, true); return; }
    if (tool === "note") { add({ type: "note", x: p.x - 110, y: p.y - 80, w: 220, h: 160, text: "", color: st.note, opacity: st.opacity }, true); return; }
    if (tool === "table") { add({ type: "table", x: p.x, y: p.y, w: st.cols * 140, h: st.rows * 40, rows: Array.from({ length: st.rows }, () => Array.from({ length: st.cols }, () => "")) }); return; }
    if (tool === "box" || tool === "ellipse" || tool === "frame" || tool === "arrow" || tool === "line") { gesture.current = { kind: "make", type: tool, x0: p.x, y0: p.y }; return; }
    if (tool === "link") { setLinkAsk(p); done(); return; }
    // Select
    if (handle && selected.length === 1) {
      const it = selected[0];
      if (handle.dataset.handle === "a" || handle.dataset.handle === "b") { gesture.current = { kind: "end", id: it.id, which: handle.dataset.handle === "a" ? 0 : 1 }; return; }
      gesture.current = { kind: "resize", id: it.id, sx: e.clientX, sy: e.clientY, w: it.w, h: it.h, ratio: it.type === "image" || e.shiftKey ? it.w / it.h : null, pts: it.points ? [...it.points] : null };
      return;
    }
    if (hit) {
      if (editing === hit.id) return;
      const next = e.shiftKey ? (sel.includes(hit.id) ? sel.filter((x) => x !== hit.id) : [...sel, hit.id]) : sel.includes(hit.id) ? sel : [hit.id];
      setSel(next);
      const start = new Map(itemsRef.current.filter((i) => next.includes(i.id) && !i.locked).map((i) => [i.id, { x: i.x, y: i.y }]));
      gesture.current = { kind: "move", sx: e.clientX, sy: e.clientY, start, moved: false };
      if (e.pointerType === "touch") { const cx = e.clientX, cy = e.clientY; holdTimer.current = window.setTimeout(() => { hapticHold(); setCtxMenu({ x: cx, y: cy }); gesture.current = null; }, 500); }
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
      zoomTo(g.z * (Math.hypot(a.x - b.x, a.y - b.y) / g.d), g.cx, g.cy);
    } else if (g.kind === "pan") setPan({ x: g.px + (e.clientX - g.sx), y: g.py + (e.clientY - g.sy) });
    else if (g.kind === "move") {
      const dx = (e.clientX - g.sx) / zoom, dy = (e.clientY - g.sy) / zoom;
      if (!g.moved && Math.hypot(dx, dy) * zoom < 3) return;
      const firstMove = !g.moved; g.moved = true;
      setItems((xs) => xs.map((x) => { const s = g.start.get(x.id); return s ? { ...x, x: Math.round(s.x + dx), y: Math.round(s.y + dy) } : x; }), firstMove);
    } else if (g.kind === "resize") {
      const dx = (e.clientX - g.sx) / zoom, dy = (e.clientY - g.sy) / zoom;
      const w = Math.max(8, g.w + dx); let h = Math.max(8, g.h + dy);
      if (g.ratio) h = w / g.ratio;
      const first = !g.started; g.started = true;
      // Strokes and lines stretch with their box.
      const pts = g.pts ? g.pts.map((v, i) => Math.round(v * (i % 2 === 0 ? w / g.w : h / g.h) * 10) / 10) : undefined;
      patch(g.id, { w: Math.round(w), h: Math.round(h), ...(pts ? { points: pts } : {}) }, first);
    } else if (g.kind === "end") {
      const it = itemsRef.current.find((x) => x.id === g.id); if (!it?.points) return;
      const ends = [it.x + it.points[0], it.y + it.points[1], it.x + it.points[2], it.y + it.points[3]];
      const other = g.which === 0 ? [ends[2], ends[3]] : [ends[0], ends[1]];
      const q = snapEnd(other[0], other[1], p.x, p.y, e.shiftKey);
      const first = !g.started; g.started = true;
      const n = g.which === 0 ? lineItem(it.type as "arrow", q.x, q.y, other[0], other[1], it) : lineItem(it.type as "arrow", other[0], other[1], q.x, q.y, it);
      patch(it.id, { x: n.x, y: n.y, w: n.w, h: n.h, points: n.points }, first);
    } else if (g.kind === "draw") setDrawing((d) => (d ? { points: [...d.points, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10] } : d));
    else if (g.kind === "erase") { const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-id]") as HTMLElement | null; erase(el ? itemsRef.current.find((i) => i.id === el.dataset.id) : null); }
    else if (g.kind === "make") {
      if (g.type === "arrow" || g.type === "line") { const q = snapEnd(g.x0, g.y0, p.x, p.y, e.shiftKey); setGhost({ ...lineItem(g.type, g.x0, g.y0, q.x, q.y), id: "ghost", z: 0, seed: 7 } as CanvasItem); }
      else {
        let w = p.x - g.x0, h = p.y - g.y0;
        if (e.shiftKey && g.type !== "frame") { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        const box = { x: Math.min(g.x0, g.x0 + w), y: Math.min(g.y0, g.y0 + h), w: Math.abs(w), h: Math.abs(h) };
        setGhost(g.type === "frame" ? ({ id: "ghost", type: "frame", z: 0, text: "Frame", ...box } as CanvasItem) : ({ ...styleFor(g.type), id: "ghost", type: g.type, z: 0, seed: 7, ...box } as CanvasItem));
      }
    } else if (g.kind === "marquee") setMarquee((m) => (m ? { ...m, x1: p.x, y1: p.y } : m));
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    const g = gesture.current; gesture.current = null;
    if (!g) return;
    if (g.kind === "draw" && drawing && drawing.points.length >= 4) {
      const xs = drawing.points.filter((_, i) => i % 2 === 0), ys = drawing.points.filter((_, i) => i % 2 === 1);
      const x0 = Math.min(...xs), y0 = Math.min(...ys), pad = st.stroke * 2;
      const n = { ...styleFor("pen"), type: "pen", x: x0 - pad, y: y0 - pad, w: Math.max(...xs) - x0 + pad * 2, h: Math.max(...ys) - y0 + pad * 2, points: drawing.points.map((v, i) => Math.round((v - (i % 2 === 0 ? x0 : y0) + pad) * 10) / 10), stroke: Math.max(2, st.stroke * 2), id: uid(), z: topZ() } as CanvasItem;
      setItems((all) => [...all, n]); // Draw stays picked
    }
    if (g.kind === "draw") setDrawing(null);
    if (g.kind === "make") {
      const gh = ghost; setGhost(null);
      const tiny = !gh || (LINES.has(g.type) ? Math.hypot(gh.w, gh.h) < 6 : gh.w < 6 || gh.h < 6);
      const type = g.type;
      if (type === "arrow" || type === "line") {
        const p = !tiny && gh?.points ? [gh.x + gh.points[0], gh.y + gh.points[1], gh.x + gh.points[2], gh.y + gh.points[3]] : [g.x0, g.y0, g.x0 + 200, g.y0];
        add(lineItem(type, p[0], p[1], p[2], p[3]));
      } else if (type === "frame") {
        const n = add(tiny || !gh ? { type: "frame", x: g.x0, y: g.y0, w: 800, h: 500, text: "Frame" } : { type: "frame", x: gh.x, y: gh.y, w: gh.w, h: gh.h, text: "Frame" });
        setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, z: Math.min(...xs.map((i) => i.z)) - 1 } : x)), false); // frames sit behind
      } else add({ ...styleFor(type), type, ...(tiny || !gh ? { x: g.x0, y: g.y0, w: type === "ellipse" ? 160 : 240, h: 160 } : { x: gh.x, y: gh.y, w: gh.w, h: gh.h }) } as CanvasItem);
    }
    if (g.kind === "marquee" && marquee) {
      const x0 = Math.min(marquee.x0, marquee.x1), y0 = Math.min(marquee.y0, marquee.y1), w = Math.abs(marquee.x1 - marquee.x0), h = Math.abs(marquee.y1 - marquee.y0);
      const inside = itemsRef.current.filter((i) => i.x >= x0 && i.y >= y0 && i.x + i.w <= x0 + w && i.y + i.h <= y0 + h).map((i) => i.id);
      if (w > 4 || h > 4) setSel([...new Set([...g.add, ...inside])]);
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
  const pick = (t: Tool) => {
    if (t === "image") { imageInput.current?.click(); setPop(null); return; }
    if (t === "import") { setImporting(true); setPop(null); return; }
    setTool(t);
  };

  const state = canEdit ? <span className={`ws-save hide-sm ${saveState}`}>{saveState === "saving" ? "Saving" : saveState === "error" ? <><Icon name="alert" size={14} /> Not saved</> : <><Icon name="check" size={14} plain /> Saved</>}</span> : null;
  const one = selected.length === 1 ? selected[0] : null;
  const selBox = selected.length ? selected.reduce((a, i) => ({ x0: Math.min(a.x0, i.x), y0: Math.min(a.y0, i.y), x1: Math.max(a.x1, i.x + i.w), y1: Math.max(a.y1, i.y + i.h) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }) : null;
  // The style panel: while drawing with a styled tool, or with something selected.
  const panelFor = selected.length ? selected : ["box", "ellipse", "arrow", "line", "pen", "text", "note"].includes(tool) ? [{ type: tool } as CanvasItem] : [];
  const showPanel = canEdit && !phone && (panelFor.length > 0 || tool === "table");
  // The grid: 20 board pixels, with every fifth line a little stronger; wider when zoomed far out.
  const step = 20 * zoom < 8 ? 100 : 20;
  const minor = step * zoom, major = step * 5 * zoom;
  const gridStyle: React.CSSProperties = {
    backgroundImage: `linear-gradient(to right, var(--cv-grid-major) 1px, transparent 1px), linear-gradient(to bottom, var(--cv-grid-major) 1px, transparent 1px), linear-gradient(to right, var(--cv-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--cv-grid) 1px, transparent 1px)`,
    backgroundSize: `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`,
    backgroundPosition: `${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px, ${pan.x}px ${pan.y}px`,
  };
  const hint = !canEdit ? (phone ? "View only · pinch to zoom, drag to move" : "View only · scroll or drag to move, ⌘ or Ctrl + scroll to zoom") : HINT[tool];

  return (
    <div className="cv-wrap" ref={wrapRef}>
      {top(state)}
      <div className="cv-stage">
      <div ref={viewRef} className={`cv-view tool-${space ? "pan" : tool}`} style={gridStyle} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onContextMenu={(e) => { const el = (e.target as HTMLElement).closest("[data-id]") as HTMLElement | null; if (!el || !canEdit) return; e.preventDefault(); if (!sel.includes(el.dataset.id!)) setSel([el.dataset.id!]); setToolRaw("select"); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        onDragOver={(e) => { if (canEdit && uploads) e.preventDefault(); }} onDrop={onDrop}
        onDoubleClick={(e) => { const el = (e.target as HTMLElement).closest("[data-id]") as HTMLElement | null; const it = el && itemsRef.current.find((i) => i.id === el.dataset.id); if (it && canEdit && !it.locked && ["note", "text", "box", "ellipse", "frame", "table", "link"].includes(it.type)) { setEditing(it.id); setSel([it.id]); } }}>
        <div className="cv-board" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: BOARD.w, height: BOARD.h }}>
          {sorted.map((it) => <ItemView key={it.id} it={it} url={it.fileId ? files[it.fileId] ?? null : null} freshUrl={freshUrl} editing={editing === it.id} canEdit={canEdit} onPatch={(p) => patch(it.id, p)} onDone={() => setEditing(null)} />)}
          {ghost && <ItemView it={ghost} url={null} editing={false} canEdit={false} onPatch={() => {}} onDone={() => {}} />}
          {drawing && <svg className="cv-ink" style={{ left: 0, top: 0, opacity: st.opacity / 100 }} width={BOARD.w} height={BOARD.h}><path d={smooth(drawing.points)} fill="none" stroke={st.color} strokeWidth={Math.max(2, st.stroke * 2)} strokeLinecap="round" strokeLinejoin="round" /></svg>}
          {marquee && <div className="cv-marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0), borderWidth: 1 / zoom }} />}
          {selBox && canEdit && !(one && LINES.has(one.type)) && <div className="cv-selbox" style={{ left: selBox.x0 - 6 / zoom, top: selBox.y0 - 6 / zoom, width: selBox.x1 - selBox.x0 + 12 / zoom, height: selBox.y1 - selBox.y0 + 12 / zoom, borderWidth: 1 / zoom }}>
            {one && !one.locked && editing !== one.id && <span data-handle="r" className="cv-handle" style={{ width: 10 / zoom, height: 10 / zoom, right: -5 / zoom, bottom: -5 / zoom, borderWidth: 1 / zoom, borderRadius: 2 / zoom }} />}
            {one?.locked && <span className="cv-lock" style={{ fontSize: 12 / zoom }}><Lock size={12 / zoom} /></span>}
          </div>}
          {one && canEdit && LINES.has(one.type) && one.points && !one.locked && ([0, 1] as const).map((k) => <span key={k} data-handle={k === 0 ? "a" : "b"} className="cv-handle end" style={{ left: one.x + one.points![k * 2] - 6 / zoom, top: one.y + one.points![k * 2 + 1] - 6 / zoom, width: 12 / zoom, height: 12 / zoom, borderWidth: 1.5 / zoom }} />)}
        </div>
      </div>

      {/* ☰ the board's menu, top left */}
      <div className="cv-ui cv-menubtn">
        <button className={`cv-tbtn${pop === "menu" ? " on" : ""}`} aria-label="Board menu" onClick={() => setPop(pop === "menu" ? null : "menu")}><Menu size={18} /></button>
        {pop === "menu" && <div className="cv-pop cv-dd" role="menu">
          {(menu ?? []).map((m) => <button key={m.label} role="menuitem" className={m.danger ? "danger" : ""} onClick={() => { setPop(null); m.onClick(); }}>{m.label}</button>)}
          {(menu ?? []).length > 0 && <hr />}
          <button role="menuitem" onClick={() => { setPop(null); fit(); }}>Zoom to fit<kbd>⇧1</kbd></button>
          <button role="menuitem" onClick={() => setPop("help")}>Keyboard shortcuts<kbd>?</kbd></button>
        </div>}
      </div>

      {/* The toolbar, top centre (a phone gets Select, Text, Photo and Tools at the bottom, D185) */}
      {!phone && <div className="cv-ui cv-top">
        <nav className="cv-toolbar" aria-label="Tools">
          {canEdit && <><button className={`cv-tbtn${keep ? " on" : ""}`} aria-pressed={keep} aria-label="Keep the tool picked after drawing" title="Keep the tool picked after drawing (Q)" onClick={() => setKeep(!keep)}>{keep ? <Lock size={17} /> : <LockOpen size={17} />}</button><span className="cv-sep" /></>}
          {MAIN.filter((t) => canEdit || t.k === "select" || t.k === "pan").filter((t) => uploads || t.k !== "image").map((t) => (
            <button key={t.k} className={`cv-tbtn${tool === t.k ? " on" : ""}`} aria-pressed={tool === t.k} aria-label={t.label} title={`${t.label}${t.n ? ` (${t.n})` : t.key ? ` (${t.key.toUpperCase()})` : ""}`} onClick={() => pick(t.k)}>{t.icon}{t.n && <i>{t.n}</i>}</button>
          ))}
          {canEdit && <><span className="cv-sep" /><span className="cv-morewrap">
            <button className={`cv-tbtn${MORE.some((m) => m.k === tool) || pop === "more" ? " on" : ""}`} aria-label="More tools" title="More tools: Note, Table, Frame, Link, Import" onClick={() => setPop(pop === "more" ? null : "more")}><Box size={18} /></button>
            {pop === "more" && <div className="cv-pop cv-dd right" role="menu">{MORE.filter((m) => uploads || m.k !== "import").map((m) => <button key={m.k} role="menuitem" onClick={() => pick(m.k)}>{m.icon}{m.label}{m.key && <kbd>{m.key.toUpperCase()}</kbd>}</button>)}</div>}
          </span></>}
        </nav>
        {hint && <p className="cv-hintline">{hint}</p>}
      </div>}

      {/* The style panel, on the left */}
      {showPanel && <StylePanel items={panelFor} st={st} onStyle={restyle} onLayer={selected.length ? layer : undefined} table={tool === "table" ? { rows: st.rows, cols: st.cols, set: (rows, cols) => setSt((s) => ({ ...s, rows, cols })) } : undefined} />}

      {phone && editing && <button className="cv-ui cv-done" onPointerDown={(e) => e.preventDefault()} onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); setEditing(null); }}>Done</button>}
      {phone && !editing && <nav className="cv-ui cv-phonebar" aria-label="Tools">
        {MAIN.filter((t) => t.phone && (canEdit || t.k === "select" || t.k === "pan")).filter((t) => uploads || t.k !== "image").map((t) => <button key={t.k} className={tool === t.k ? "on" : ""} onClick={() => pick(t.k)}>{t.icon}<span>{t.k === "image" ? "Photo" : t.label}</span></button>)}
        {canEdit && <button className={pop === "tools" ? "on" : ""} onClick={() => setPop(pop === "tools" ? null : "tools")}><MoreHorizontal size={18} /><span>Tools</span></button>}
      </nav>}
      {pop === "tools" && phone && <div className="cv-ui cv-sheet" role="dialog" aria-label="Tools">
        <span className="wp-field-label">On iPad and desktop</span>
        <div className="cv-sheetgrid off">{[...MAIN.filter((t) => !t.phone), ...MORE].map((t) => <button key={t.k} disabled>{t.icon}<span>{t.label}</span></button>)}</div>
      </div>}

      {one && canEdit && one.type === "table" && editing === one.id && <TableBar it={one} onPatch={(p) => patch(one.id, p)} />}
      {ctxMenu && canEdit && selected.length > 0 && (
        <div className="cv-ui cv-pop cv-dd cv-ctx" style={{ left: Math.min(ctxMenu.x, window.innerWidth - 230), top: Math.min(ctxMenu.y, window.innerHeight - 300) }} role="menu">
          <button role="menuitem" onClick={dup}>Duplicate<kbd>⌘D</kbd></button>
          <button role="menuitem" onClick={lock}>{selected.every((i) => i.locked) ? "Unlock" : "Lock"}</button>
          <button role="menuitem" onClick={() => layer("front")}>Bring to front</button>
          <button role="menuitem" onClick={() => layer("back")}>Send to back</button>
          {one?.fileId && files[one.fileId] && <a role="menuitem" href={freshUrl(one.fileId) ?? files[one.fileId]!} target="_blank" rel="noreferrer" onClick={() => setCtxMenu(null)}>Download</a>}
          <hr />
          <button role="menuitem" className="danger" onClick={del}>Delete<kbd>⌫</kbd></button>
        </div>
      )}

      {/* Bottom left: zoom, then undo and redo */}
      {!(phone && editing) && <div className="cv-ui cv-bl">
        <div className="cv-group">
          <button className="cv-tbtn" aria-label="Zoom out" onClick={() => zoomTo(zoom / 1.25)}><Minus size={16} /></button>
          <button className="cv-pct" onClick={() => zoomTo(1)} title="Reset to 100%">{Math.round(zoom * 100)}%</button>
          <button className="cv-tbtn" aria-label="Zoom in" onClick={() => zoomTo(zoom * 1.25)}><Plus size={16} /></button>
        </div>
        {canEdit && <div className="cv-group">
          <button className="cv-tbtn" aria-label="Undo" title="Undo (⌘Z)" disabled={!hist.current.past.length} onClick={undo}><Undo2 size={17} /></button>
          <button className="cv-tbtn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!hist.current.future.length} onClick={redo}><Redo2 size={17} /></button>
        </div>}
      </div>}
      {!phone && <button className="cv-ui cv-tbtn cv-help" aria-label="Keyboard shortcuts" onClick={() => setPop("help")}><CircleQuestionMark size={18} /></button>}
      </div>

      <input ref={fileInput} type="file" hidden multiple onChange={(e) => { if (e.target.files) void uploadMany(e.target.files); e.target.value = ""; }} />
      <input ref={imageInput} type="file" accept="image/*" hidden multiple onChange={(e) => { if (e.target.files) void uploadMany(e.target.files); e.target.value = ""; }} />
      {linkAsk && <LinkDialog onClose={() => setLinkAsk(null)} onAdd={(u) => { addLink(u, linkAsk); setLinkAsk(null); }} />}
      {importing && uploads && <ImportDialog onClose={() => setImporting(false)} onFiles={(fl, row) => uploadMany(fl, undefined, row)} onLink={(u) => { addLink(u); setImporting(false); }} />}
      {pop === "help" && <Shortcuts onClose={() => setPop(null)} />}
      <span className="sr-only" aria-live="polite">{title}</span>
    </div>
  );
}

// ---------- the style panel (Heston's screenshot) ----------

function StylePanel({ items, st, onStyle, onLayer, table }: {
  items: CanvasItem[]; st: Style; onStyle: (p: Partial<Style>) => void; onLayer?: (how: "back" | "backward" | "forward" | "front") => void;
  table?: { rows: number; cols: number; set: (rows: number, cols: number) => void };
}) {
  const types = new Set(items.map((i) => i.type));
  const has = (...t: string[]) => t.some((x) => types.has(x as CanvasItem["type"]));
  const first = items[0];
  // Show the selection's own values (the first one's), else the defaults for the next thing drawn.
  const v = <K extends keyof CanvasItem>(k: K, d: CanvasItem[K]) => (first && first[k] !== undefined ? first[k] : d);
  const color = has("note") && types.size === 1 ? undefined : (v("color", st.color) as string);
  const fill = v("fill", st.fill) as string | null;
  const stroke = has("pen") && types.size === 1 ? (v("stroke", st.stroke * 2) as number) / 2 : (v("stroke", st.stroke) as number);
  const strokeOpts = has("box", "ellipse", "arrow", "line", "pen", "text");
  const fillOpts = has("box", "ellipse");
  const widthOpts = has("box", "ellipse", "arrow", "line", "pen");
  const styleOpts = has("box", "ellipse", "arrow", "line");
  const edgeOpts = has("box");
  const textOpts = has("text");
  const noteOpts = has("note");
  const custom = (val: string, on: (c: string) => void, label: string) => <label className="cv-sw custom" title="Custom colour" style={{ background: val }}><input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(val) ? val : "#d3d3d3"} onChange={(e) => on(e.target.value.toUpperCase())} /></label>;
  return (
    <aside className="cv-ui cv-panel" aria-label="Style" onPointerDown={(e) => e.stopPropagation()}>
      {strokeOpts && color !== undefined && <section><h4>Stroke</h4><div className="cv-row">
        {STROKES.map((c) => <button key={c} className={`cv-sw${color.toUpperCase() === c ? " on" : ""}`} style={{ background: c }} aria-label={`Stroke ${c}`} onClick={() => onStyle({ color: c })} />)}
        <span className="cv-vsep" />{custom(color, (c) => onStyle({ color: c }), "Stroke colour")}
      </div></section>}
      {fillOpts && <section><h4>Background</h4><div className="cv-row">
        {FILLS.map((c) => <button key={c ?? "none"} className={`cv-sw${c === null ? " none" : ""}${(fill ?? null) === c ? " on" : ""}`} style={c ? { background: c } : undefined} aria-label={c ? `Background ${c}` : "No background"} onClick={() => onStyle({ fill: c })} />)}
        <span className="cv-vsep" />{custom(fill ?? "#343A40", (c) => onStyle({ fill: c }), "Background colour")}
      </div></section>}
      {noteOpts && <section><h4>Paper</h4><div className="cv-row">
        {NOTE_COLORS.map((c) => <button key={c} className={`cv-sw${(v("color", st.note) as string)?.toUpperCase() === c ? " on" : ""}`} style={{ background: c }} aria-label={`Paper ${c}`} onClick={() => onStyle({ note: c })} />)}
      </div></section>}
      {widthOpts && <section><h4>Stroke width</h4><div className="cv-row">
        {WIDTHS.map((w) => <button key={w} className={`cv-opt${stroke === w ? " on" : ""}`} aria-label={["Thin", "Bold", "Extra bold"][WIDTHS.indexOf(w)]} onClick={() => onStyle({ stroke: w })}><i className="cv-wline" style={{ height: w + 1 }} /></button>)}
      </div></section>}
      {styleOpts && <section><h4>Stroke style</h4><div className="cv-row">
        {(["solid", "dashed", "dotted"] as const).map((d) => <button key={d} className={`cv-opt${(v("dash", st.dash) ?? "solid") === d ? " on" : ""}`} aria-label={d[0].toUpperCase() + d.slice(1)} onClick={() => onStyle({ dash: d })}><svg width="22" height="6"><line x1="1" y1="3" x2="21" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={d === "dashed" ? "5 4" : d === "dotted" ? "0.5 4" : undefined} /></svg></button>)}
      </div></section>}
      {styleOpts && <section><h4>Sloppiness</h4><div className="cv-row">
        {([0, 1, 2] as const).map((r) => <button key={r} className={`cv-opt${(v("rough", st.rough) ?? 1) === r ? " on" : ""}`} aria-label={["Clean", "A little rough", "Very rough"][r]} onClick={() => onStyle({ rough: r })}><svg width="22" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">{r === 0 ? <path d="M2 8 C 7 2, 12 2, 20 6" /> : r === 1 ? <path d="M2 9 C 6 3, 9 10, 13 5 S 18 3, 20 6" /> : <><path d="M2 9 C 6 3, 9 10, 13 5 S 18 3, 20 6" /><path d="M3 7 C 7 1, 10 9, 14 3 S 19 2, 21 4" /><path d="M4 10 C 8 5, 11 11, 15 7" /></>}</svg></button>)}
      </div></section>}
      {edgeOpts && <section><h4>Edges</h4><div className="cv-row">
        {[false, true].map((r) => <button key={String(r)} className={`cv-opt${(v("round", st.round) ?? true) === r ? " on" : ""}`} aria-label={r ? "Round" : "Sharp"} onClick={() => onStyle({ round: r })}><svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 2.5">{r ? <path d="M3 16 V 9 Q 3 3 9 3 H 16" /> : <path d="M3 16 V 3 H 16" />}</svg></button>)}
      </div></section>}
      {textOpts && <section><h4>Font size</h4><div className="cv-row">
        {(["S", "M", "L", "XL"] as const).map((z) => <button key={z} className={`cv-opt${(v("size", st.size) ?? "M") === z ? " on" : ""}`} onClick={() => onStyle({ size: z })}>{z}</button>)}
      </div></section>}
      {table && <section><h4>Table</h4><div className="cv-row cv-tsize">
        <label>Rows<input className="input sm" type="number" min={1} max={40} value={table.rows} onChange={(e) => table.set(Math.max(1, Math.min(40, Number(e.target.value) || 1)), table.cols)} /></label>
        <label>Columns<input className="input sm" type="number" min={1} max={20} value={table.cols} onChange={(e) => table.set(table.rows, Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
      </div></section>}
      {items.length > 0 && <section><h4>Opacity</h4>
        <input className="cv-range" type="range" min={0} max={100} step={10} value={(v("opacity", st.opacity) as number) ?? 100} onChange={(e) => onStyle({ opacity: Number(e.target.value) })} aria-label="Opacity" />
        <div className="cv-rangeends"><span>0</span><span>100</span></div>
      </section>}
      {onLayer && <section><h4>Layers</h4><div className="cv-row">
        <button className="cv-opt" aria-label="Send to back" title="Send to back" onClick={() => onLayer("back")}><ArrowDownToLine size={16} /></button>
        <button className="cv-opt" aria-label="Send backward" title="Send backward" onClick={() => onLayer("backward")}><ArrowDown size={16} /></button>
        <button className="cv-opt" aria-label="Bring forward" title="Bring forward" onClick={() => onLayer("forward")}><ArrowUp size={16} /></button>
        <button className="cv-opt" aria-label="Bring to front" title="Bring to front" onClick={() => onLayer("front")}><ArrowUpToLine size={16} /></button>
      </div></section>}
    </aside>
  );
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ["Hand (move the canvas)", "H, or hold Space"], ["Select", "V or 1"], ["Rectangle", "R or 2"], ["Circle", "O or 3"], ["Arrow", "A or 4"], ["Line", "L or 5"], ["Draw", "P or 6"], ["Text", "T or 7"], ["Image", "8"], ["Eraser", "E or 9"],
    ["Note", "N"], ["Frame", "F"], ["Keep the tool picked", "Q"], ["Zoom", "⌘ or Ctrl + scroll"], ["Zoom to fit", "⇧1"], ["Undo / redo", "⌘Z / ⇧⌘Z"], ["Duplicate", "⌘D"], ["Select all", "⌘A"], ["Delete", "Delete"], ["Perfect square or circle, snap angles", "Hold Shift"],
  ];
  return (
    <Modal onClose={onClose} label="Keyboard shortcuts" width={520}>
      <div className="crm-dialog">
        <DialogHeader title="Keyboard shortcuts" onClose={onClose} />
        <dl className="cv-keys">{rows.map(([a, b]) => <div key={a}><dt>{a}</dt><dd><kbd>{b}</kbd></dd></div>)}</dl>
      </div>
    </Modal>
  );
}

// ---------- items ----------

const pairs = (pts: number[]) => { const o: string[] = []; for (let i = 0; i + 1 < pts.length; i += 2) o.push(`${pts[i]},${pts[i + 1]}`); return o.join(" "); };
/** A freehand stroke, smoothed through the midpoints. */
function smooth(pts: number[]) {
  if (pts.length < 4) return "";
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 2; i + 3 < pts.length; i += 2) { const mx = (pts[i] + pts[i + 2]) / 2, my = (pts[i + 1] + pts[i + 3]) / 2; d += ` Q${pts[i]} ${pts[i + 1]} ${mx} ${my}`; }
  return `${d} L${pts[pts.length - 2]} ${pts[pts.length - 1]}`;
}
const gen = rough.generator();
const dashOf = (it: CanvasItem, sw: number) => (it.dash === "dashed" ? `${8 + sw * 2} ${6 + sw * 2}` : it.dash === "dotted" ? `${Math.max(0.5, sw * 0.4)} ${sw * 2.5 + 3}` : undefined);
/** A shape's or line's paths: clean SVG at Sloppiness 0, rough.js (a seeded, steady hand-drawn look) above it. */
function shapePaths(it: CanvasItem): Array<{ d: string; stroke: string; fill: string; sw: number }> {
  const sw = it.stroke ?? (it.border === "thick" ? 4 : it.border === "none" ? 0 : 2);
  const color = it.color ?? "#D3D3D3", fill = it.fill ?? "none", w = it.w, h = it.h, r = it.rough ?? (it.type === "box" && it.border ? 0 : 1);
  const o = { roughness: [0, 1, 2.2][r], bowing: r ? 1 : 0, stroke: sw ? color : "none", strokeWidth: sw || 1, fill: fill === "none" ? undefined : fill, fillStyle: "solid", seed: it.seed ?? 1, preserveVertices: true, disableMultiStroke: r === 0 };
  const radius = it.type === "box" && (it.round ?? !it.border) ? Math.min(32, Math.min(w, h) * 0.25) : 0;
  let drawables;
  if (it.type === "ellipse") drawables = [gen.ellipse(w / 2, h / 2, w, h, o)];
  else if (it.type === "box") drawables = [radius ? gen.path(`M${radius} 0 H${w - radius} Q${w} 0 ${w} ${radius} V${h - radius} Q${w} ${h} ${w - radius} ${h} H${radius} Q0 ${h} 0 ${h - radius} V${radius} Q0 0 ${radius} 0 Z`, o) : gen.rectangle(0, 0, w, h, o)];
  else {
    const [x1, y1, x2, y2] = it.points ?? [0, 0, w, h];
    drawables = [gen.line(x1, y1, x2, y2, o)];
    if (it.type === "arrow") {
      const a = Math.atan2(y2 - y1, x2 - x1), len = Math.min(30, Math.max(10, Math.hypot(x2 - x1, y2 - y1) * 0.3)) + sw * 2;
      for (const s of [-1, 1]) drawables.push(gen.line(x2, y2, x2 - len * Math.cos(a + (s * Math.PI) / 7), y2 - len * Math.sin(a + (s * Math.PI) / 7), { ...o, fill: undefined }));
    }
  }
  return drawables.flatMap((dr) => gen.toPaths(dr).map((p) => ({ d: p.d, stroke: p.stroke, fill: p.fill ?? "none", sw: p.strokeWidth })));
}

const ItemView = memo(function ItemView({ it, url, freshUrl, editing, canEdit, onPatch, onDone }: { it: CanvasItem; url: string | null; freshUrl?: (id: string) => string | null; editing: boolean; canEdit: boolean; onPatch: (p: Partial<CanvasItem>) => void; onDone: () => void }) {
  const base: React.CSSProperties = { left: it.x, top: it.y, width: it.w, height: it.h, zIndex: it.z, ...(it.opacity !== undefined && it.opacity < 100 ? { opacity: it.opacity / 100 } : {}) };
  const textEdit = (cls: string, style?: React.CSSProperties) => editing && canEdit
    ? <textarea className={`cv-edit ${cls}`} style={style} autoFocus defaultValue={it.text ?? ""} onPointerDown={(e) => e.stopPropagation()} onBlur={(e) => { if (e.target.value !== (it.text ?? "")) onPatch({ text: e.target.value }); onDone(); }} onKeyDown={(e) => { if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur(); }} />
    : <div className={cls} style={style}>{it.text || (canEdit ? <span className="cv-ph">{it.type === "frame" ? "Frame" : it.type === "box" || it.type === "ellipse" ? "" : "Double-click to type"}</span> : null)}</div>;
  const paths = useMemo(() => (it.type === "box" || it.type === "ellipse" || it.type === "arrow" || it.type === "line" ? shapePaths(it) : null), [it]);
  if (paths) {
    const sw = paths[0]?.sw ?? 2;
    const filled = !!it.fill && (it.type === "box" || it.type === "ellipse");
    const hitD = it.type === "ellipse" ? `M0 ${it.h / 2} A${it.w / 2} ${it.h / 2} 0 1 0 ${it.w} ${it.h / 2} A${it.w / 2} ${it.h / 2} 0 1 0 0 ${it.h / 2}` : it.type === "box" ? `M0 0 H${it.w} V${it.h} H0 Z` : `M${it.points![0]} ${it.points![1]} L${it.points![2]} ${it.points![3]}`;
    return (
      <div data-id={it.id} className="cv-item cv-shape" style={base}>
        <svg width={it.w} height={it.h} overflow="visible">
          {paths.map((p, i) => <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.sw} fill={p.fill} strokeDasharray={dashOf(it, sw)} strokeLinecap="round" strokeLinejoin="round" />)}
          <path className="hit" d={hitD} stroke="transparent" strokeWidth={Math.max(14, sw + 10)} fill={filled ? "transparent" : "none"} />
        </svg>
        {(it.type === "box" || it.type === "ellipse") && (it.text || editing) && textEdit("cv-boxtxt", { color: it.color ?? "#D3D3D3" })}
      </div>
    );
  }
  switch (it.type) {
    case "note": return <div data-id={it.id} className="cv-item cv-note" style={{ ...base, background: it.color ?? NOTE_COLORS[0] }}>{textEdit("cv-notetxt")}</div>;
    case "text": return <div data-id={it.id} className="cv-item cv-text" style={{ ...base, color: it.color ?? "#D3D3D3", fontSize: TEXT_PX[it.size ?? "M"], fontWeight: it.weight === "bold" ? 700 : 400 }}>{textEdit("cv-texttxt")}</div>;
    case "frame": return <div data-id={it.id} className="cv-item cv-frame" style={base}><div className="cv-frametitle">{textEdit("cv-frametxt")}</div></div>;
    case "pen": return <svg data-id={it.id} className="cv-item cv-pen" style={base} width={it.w} height={it.h}><path d={smooth(it.points ?? [])} fill="none" stroke={it.color ?? "#D3D3D3"} strokeWidth={it.stroke ?? 3} strokeLinecap="round" strokeLinejoin="round" /><polyline className="hit" points={pairs(it.points ?? [])} fill="none" stroke="transparent" strokeWidth={Math.max(16, (it.stroke ?? 3) + 12)} /></svg>;
    case "image": return <div data-id={it.id} className="cv-item cv-image" style={base}>{url ? <img src={url} alt={it.name ?? ""} draggable={false} onError={(e) => { const f = it.fileId && freshUrl ? freshUrl(it.fileId) : null; if (f && e.currentTarget.src !== f) e.currentTarget.src = f; }} /> : <span className="cv-ph">Photo</span>}</div>;
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
    default: return null;
  }
}, (a, b) => a.it === b.it && a.url === b.url && a.editing === b.editing && a.canEdit === b.canEdit);

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
