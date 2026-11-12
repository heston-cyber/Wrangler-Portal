// Hold for options (D170, Heston, Nov 11: "On mobile need to be able to hold on items for options like delete, multi
// select and share options"; "Every list in the portal", built from existing parts, the same menu on a right-click).
//
// - Holding an item on a phone (about half a second, without moving) or right-clicking it on a computer opens its
//   options: on a phone a glass sheet with the item's name, on a computer a glass menu at the pointer. Starting to
//   scroll cancels the hold; the browser's own link menu doesn't open on these rows.
// - The options: Open, Share (the phone's share sheet; on a computer the link is copied), Copy link, any link the item
//   has for a client or vendor, Select (when its list can select several), then the item's own actions, only those
//   the portal already allows for it in its state (D171). Anything that can't be undone asks first.
// - Select several: a list wrapped in <SelectList> shows checkboxes and a glass bar at the bottom with the count and the
//   actions every selected item has (bulk). Each item goes through its own action, so its own checks; the bar says what
//   couldn't be done.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, CheckSquare, Copy, ExternalLink, Share2, X } from "lucide-react";
import { navigate } from "../lib/router";
import { ContextMenu, MenuItem, MenuSep, Modal, useIsNarrow } from "./kit";

export type ItemAction = {
  /** the same key on every item that has this action: select-several offers it when every selected item has it */
  key: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  /** asks first (single item); bulk asks with the count */
  confirm?: { title: string; body?: string; yes: string };
  run: () => unknown;
  /** offered in select-several mode, with its label for many ("Delete", "Hide") */
  bulk?: string;
  /** a short line shown after it ran ("Deleted") */
  done?: string;
};

export type ItemSpec = {
  id: string;
  title: string;
  /** the portal page it opens (also what Share and Copy link use) */
  href?: string;
  /** links for someone outside (a client's review link, a vendor's briefing link) */
  share?: { label: string; url: string }[];
  actions?: ItemAction[];
  /** a list with its own select-several (the Review videos) starts it here instead of <SelectList> */
  select?: () => void;
};

// ---------- the one open menu (a tiny store: rows open it, the host shows it) ----------
type Open = { spec: ItemSpec; at: { x: number; y: number }; list: ListCtx | null };
let current: Open | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export function openItemMenu(spec: ItemSpec, at: { x: number; y: number }, list: ListCtx | null = null) { current = { spec, at, list }; emit(); }
const closeItemMenu = () => { current = null; emit(); };
const useOpen = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => current);

// ---------- holding ----------
const HOLD_MS = 480;
const SLOP = 8; // px a finger may drift before it counts as scrolling

/** Props to spread on an item (a row, a card): hold on a touch screen, right-click or the menu key on a computer. */
export function useHold(spec: ItemSpec | null | undefined): React.HTMLAttributes<HTMLElement> & { "data-hold"?: string } {
  const list = useContext(ListContext);
  return useHoldAt(spec ? (x, y) => openItemMenu(spec, { x, y }, list) : null);
}

/** The same gestures for a menu a page opens itself (the Contracts rows): `onOpen` gets the point to open it at. */
export function useHoldAt(onOpen: ((x: number, y: number) => void) | null | undefined): React.HTMLAttributes<HTMLElement> & { "data-hold"?: string } {
  const t = useRef<{ timer: number; x: number; y: number; held: boolean; el: HTMLElement | null }>({ timer: 0, x: 0, y: 0, held: false, el: null });
  useEffect(() => () => window.clearTimeout(t.current.timer), []);
  if (!onOpen) return {};
  const cancel = () => { window.clearTimeout(t.current.timer); t.current.timer = 0; t.current.el?.classList.remove("holding"); };
  const open = onOpen;
  return {
    "data-hold": "",
    onPointerDown: (e) => {
      if (e.pointerType === "mouse" || e.button !== 0) return;
      cancel();
      t.current.held = false;
      t.current.x = e.clientX; t.current.y = e.clientY;
      t.current.el = e.currentTarget as HTMLElement;
      t.current.el.classList.add("holding");
      t.current.timer = window.setTimeout(() => {
        t.current.timer = 0;
        t.current.held = true;
        t.current.el?.classList.remove("holding");
        open(t.current.x, t.current.y);
      }, HOLD_MS);
    },
    onPointerMove: (e) => { if (t.current.timer && Math.hypot(e.clientX - t.current.x, e.clientY - t.current.y) > SLOP) cancel(); },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // a right-click on a computer (and a long press on Android, which sends one)
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (t.current.held) return; // the hold already opened it
      cancel();
      open(e.clientX, e.clientY);
    },
    // the tap that ends a hold doesn't also open the item
    onClickCapture: (e) => { if (t.current.held) { e.preventDefault(); e.stopPropagation(); t.current.held = false; } },
    onKeyDown: (e) => {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        open(r.left + 24, r.bottom - 8);
      }
    },
  };
}

/** A menu a page keeps itself: a popup at the pointer on a computer, the same bottom sheet as the hold menu on a phone. */
export function MenuSurface({ at, onClose, label, title, children }: { at: { x: number; y: number }; onClose: () => void; label: string; title: string; children: React.ReactNode }) {
  const narrow = useIsNarrow();
  return narrow ? (
    <Modal onClose={onClose} label={label} width={420}>
      <div className="hold-sheet">
        <div className="hold-title"><span className="rbold">{title}</span></div>
        <div className="menu-list" role="menu" aria-label={label}>{children}</div>
      </div>
    </Modal>
  ) : <ContextMenu at={at} onClose={onClose} label={label}>{children}</ContextMenu>;
}

// ---------- select several ----------
type ListCtx = {
  name: string;
  on: boolean;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  start: (id?: string) => void;
  register: (spec: ItemSpec) => void;
  unregister: (id: string) => void;
};
const ListContext = createContext<ListCtx | null>(null);
export const useSelectList = () => useContext(ListContext);

/** Wrap a list whose items can be selected together. `name` is what the bar calls them ("projects"). */
export function SelectList({ name, children }: { name: string; children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const specs = useRef(new Map<string, ItemSpec>());
  const ctx = useMemo<ListCtx>(() => ({
    name, on,
    has: (id) => ids.includes(id),
    toggle: (id) => setIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    start: (id) => { setOn(true); setIds(id ? [id] : []); },
    register: (spec) => { specs.current.set(spec.id, spec); },
    unregister: (id) => { specs.current.delete(id); },
  }), [name, on, ids]);
  const done = useCallback(() => { setOn(false); setIds([]); }, []);
  // a selected item that's gone from the list (deleted, filtered away) leaves the selection
  useEffect(() => { if (on) setIds((s) => s.filter((id) => specs.current.has(id))); }, [on]);
  return (
    <ListContext.Provider value={ctx}>
      <div className={on ? "sel-on" : undefined} style={{ display: "contents" }}>{children}</div>
      {on && <SelectBarFor name={name} ids={ids} specs={specs.current} all={() => setIds([...specs.current.keys()])} onDone={done} />}
    </ListContext.Provider>
  );
}

/** A row's part in select-several: registers its options, and while selecting turns its tap into a toggle. */
export function useSelectable(spec: ItemSpec | null | undefined) {
  const list = useContext(ListContext);
  if (list && spec) list.register(spec);
  const id = spec?.id;
  const unregister = list?.unregister;
  useEffect(() => () => { if (id) unregister?.(id); }, [id, unregister]);
  const selecting = !!(list?.on && spec);
  const picked = selecting && list!.has(spec!.id);
  return {
    selecting, picked,
    toggle: () => { if (spec) list?.toggle(spec.id); },
    /** props for the row while selecting: a tap toggles, nothing opens */
    tapProps: selecting ? { onClickCapture: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); list!.toggle(spec!.id); } } : {},
  };
}

export function SelectTick({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" className={`selbox${on ? " on" : ""}`} role="checkbox" aria-checked={on} aria-label={label}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}>{on && <Check size={13} />}</button>
  );
}

function SelectBarFor({ name, ids, specs, all, onDone }: { name: string; ids: string[]; specs: Map<string, ItemSpec>; all: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<ItemAction | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const picked = ids.map((id) => specs.get(id)).filter((s): s is ItemSpec => !!s);
  // the actions every selected item has (by key), offered for many
  const common = picked.length
    ? (picked[0].actions ?? []).filter((a) => a.bulk && picked.every((s) => s.actions?.some((b) => b.key === a.key && b.bulk)))
    : [];
  const links = picked.filter((s) => s.href);
  const runAll = async (a: ItemAction) => {
    setAsk(null);
    setBusy(`${a.bulk}…`);
    let ok = 0;
    const failed: string[] = [];
    for (const s of picked) {
      const mine = s.actions?.find((b) => b.key === a.key);
      if (!mine) continue;
      try { await mine.run(); ok++; } catch (e) { failed.push(`${s.title}: ${errLine(e)}`); }
    }
    setBusy(null);
    setNote(failed.length ? `${a.done ?? "Done"}: ${ok}. Not done: ${failed.length} (${failed.slice(0, 2).join("; ")}${failed.length > 2 ? "…" : ""})` : `${a.done ?? "Done"}: ${ok}.`);
    if (!failed.length) onDone();
  };
  const shareMany = async () => {
    const text = links.map((s) => `${s.title}\n${abs(s.href!)}`).join("\n\n");
    const r = await shareOrCopy({ title: `${links.length} ${name}`, text });
    setNote(r === "copied" ? "Links copied." : null);
  };
  const total = specs.size;
  return createPortal(
    <>
      <div className="selbar hold-bar" role="toolbar" aria-label={`Selected ${name}`}>
        <span className="rbold">{ids.length} selected</span>
        {ids.length < total && <button className="linkbtn" onClick={all}>Select all {total}</button>}
        <span className="right">
          {busy ? <span className="secondary">{busy}</span> : <>
            {links.length > 0 && <button className="btn sm" disabled={!ids.length} onClick={() => void shareMany()}><Share2 size={14} />Share</button>}
            {common.map((a) => (
              <button key={a.key} className={`btn sm${a.danger ? " danger" : ""}`} disabled={!ids.length} onClick={() => (a.confirm || a.danger ? setAsk(a) : void runAll(a))}>{a.icon}{a.bulk}</button>
            ))}
          </>}
          <button className="btn sm ghost" onClick={onDone} disabled={!!busy}><X size={14} />Done</button>
        </span>
      </div>
      {note && <Toastish text={note} onGone={() => setNote(null)} />}
      {ask && (
        <Confirm title={`${ask.bulk} ${ids.length} ${ids.length === 1 ? singular(name) : name}?`} body={ask.confirm?.body} yes={`${ask.bulk} ${ids.length}`}
          danger={ask.danger} onNo={() => setAsk(null)} onYes={() => void runAll(ask)} />
      )}
    </>,
    document.body,
  );
}

// ---------- the host: shows the open menu (mounted once, in the shell) ----------
export function ItemMenuHost() {
  const open = useOpen();
  const narrow = useIsNarrow();
  const [ask, setAsk] = useState<{ a: ItemAction; spec: ItemSpec } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = async (a: ItemAction) => {
    try { await a.run(); if (a.done) setNote(a.done); } catch (e) { setNote(errLine(e)); }
  };
  const choose = (a: ItemAction, spec: ItemSpec) => { closeItemMenu(); if (a.confirm) setAsk({ a, spec }); else void run(a); };
  let body: React.ReactNode = null;
  if (open) {
    const { spec, list } = open;
    const href = spec.href;
    const entries: React.ReactNode[] = [];
    if (href) entries.push(<Entry key="open" icon={<ExternalLink size={16} />} onSelect={() => { closeItemMenu(); navigate(href); }}>Open</Entry>);
    if (href) entries.push(<Entry key="share" icon={<Share2 size={16} />} onSelect={async () => { closeItemMenu(); const r = await shareOrCopy({ title: spec.title, url: abs(href) }); if (r === "copied") setNote("Link copied."); }}>Share</Entry>);
    if (href) entries.push(<Entry key="copy" icon={<Copy size={16} />} onSelect={async () => { closeItemMenu(); setNote((await copy(abs(href))) ? "Link copied." : "Couldn't copy the link."); }}>Copy link</Entry>);
    for (const s of spec.share ?? []) entries.push(<Entry key={`s-${s.label}`} icon={<Share2 size={16} />} onSelect={async () => { closeItemMenu(); const r = await shareOrCopy({ title: spec.title, url: s.url }); if (r === "copied") setNote("Link copied."); }}>{s.label}</Entry>);
    if (spec.select) entries.push(<Entry key="select" icon={<CheckSquare size={16} />} onSelect={() => { closeItemMenu(); spec.select!(); }}>Select</Entry>);
    else if (list && !list.on) entries.push(<Entry key="select" icon={<CheckSquare size={16} />} onSelect={() => { closeItemMenu(); list.start(spec.id); }}>Select</Entry>);
    const acts = spec.actions ?? [];
    if (acts.length && entries.length) entries.push(<MenuSep key="sep" />);
    for (const a of acts) entries.push(<Entry key={a.key} icon={a.icon} danger={a.danger} onSelect={() => choose(a, spec)}>{a.label}</Entry>);
    body = narrow ? (
      <Modal onClose={closeItemMenu} label={`${spec.title} options`} width={420}>
        <div className="hold-sheet">
          <div className="hold-title"><span className="rbold">{spec.title}</span></div>
          <div className="menu-list" role="menu" aria-label={`${spec.title} options`}>{entries}</div>
        </div>
      </Modal>
    ) : (
      <ContextMenu at={open.at} onClose={closeItemMenu} label={`${spec.title} options`}>{entries}</ContextMenu>
    );
  }
  return (
    <>
      {body}
      {ask && <Confirm title={ask.a.confirm!.title} body={ask.a.confirm!.body} yes={ask.a.confirm!.yes} danger={ask.a.danger}
        onNo={() => setAsk(null)} onYes={() => { const a = ask.a; setAsk(null); void run(a); }} />}
      {note && <Toastish text={note} onGone={() => setNote(null)} />}
    </>
  );
}

/** A menu entry: the kit's MenuItem (desktop menu), or a full-width row in the phone sheet. */
function Entry({ icon, danger, onSelect, children }: { icon?: React.ReactNode; danger?: boolean; onSelect: () => void; children: React.ReactNode }) {
  return <MenuItem icon={icon} danger={danger} onSelect={onSelect}>{children}</MenuItem>;
}

function Confirm({ title, body, yes, danger, onYes, onNo }: { title: string; body?: string; yes: string; danger?: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <Modal onClose={onNo} label={title} width={460}>
      <div style={{ display: "grid", gap: 18 }}>
        <div className="dhead">
          <h2 className="headline">{title}</h2>
          <button className="icon-btn" onClick={onNo} aria-label="Close"><X size={18} /></button>
        </div>
        {body && <p className="caption" style={{ margin: 0, lineHeight: 1.5 }}>{body}</p>}
        <div className="dfoot">
          <button className="btn" onClick={onNo}>Cancel</button>
          <button className={`btn primary${danger ? " danger" : ""}`} onClick={onYes}>{yes}</button>
        </div>
      </div>
    </Modal>
  );
}

function Toastish({ text, onGone }: { text: string; onGone: () => void }) {
  useEffect(() => { const t = setTimeout(onGone, 3600); return () => clearTimeout(t); }, [onGone, text]);
  return createPortal(<div className="toast" role="status">{text}</div>, document.body);
}

// ---------- helpers ----------
const abs = (href: string) => (/^https?:/.test(href) ? href : `${location.origin}${href.startsWith("/") ? "" : "/"}${href}`);
const singular = (name: string) => (name.endsWith("ies") ? `${name.slice(0, -3)}y` : name.endsWith("s") ? name.slice(0, -1) : name);
export const errLine = (e: unknown) => String((e as Error)?.message ?? e).replace(/^.*ConvexError: /, "").replace(/^\[.*?\]\s*/, "").split("\n")[0];

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
/** The phone's share sheet where there is one; otherwise the link is copied. */
export async function shareOrCopy(d: { title: string; url?: string; text?: string }): Promise<"shared" | "copied" | "none"> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };
  const data: ShareData = { title: d.title, ...(d.url ? { url: d.url } : {}), ...(d.text ? { text: d.text } : {}) };
  if (nav.share && (!nav.canShare || nav.canShare(data)) && window.matchMedia("(hover: none)").matches) {
    try { await nav.share(data); return "shared"; } catch { return "none"; } // closing the sheet isn't an error worth showing
  }
  return (await copy(d.url ?? d.text ?? "")) ? "copied" : "none";
}
