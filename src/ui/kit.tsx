// Small shared pieces: popover menus, dialogs, avatars, thumbnails, toasts.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Film, LoaderCircle } from "lucide-react";
import { mediaUrl } from "../config";

// ---------- Menu: a button that opens a popover list ----------
type MenuCtx = { close: () => void };
const MenuContext = createContext<MenuCtx>({ close: () => {} });

export function Menu({ trigger, children, align = "start", side = "bottom", label, className }: {
  trigger: (props: { onClick: (e: React.MouseEvent) => void; "aria-expanded": boolean; "aria-haspopup": "menu"; ref: React.Ref<HTMLButtonElement> }) => React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end" | "center";
  side?: "bottom" | "top";
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return;
    const r = btn.current.getBoundingClientRect();
    const p = pop.current.getBoundingClientRect();
    let left = align === "end" ? r.right - p.width : align === "center" ? r.left + r.width / 2 - p.width / 2 : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - p.width - 8));
    let top = side === "top" ? r.top - p.height - 6 : r.bottom + 6;
    if (top + p.height > window.innerHeight - 8) top = Math.max(8, r.top - p.height - 6);
    if (top < 8) top = r.bottom + 6;
    setPos({ left, top });
  }, [open, align, side]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (pop.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    const onScroll = () => setOpen(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", onScroll); };
  }, [open]);

  return (
    <>
      {trigger({ onClick: (e) => { e.stopPropagation(); e.preventDefault(); setPos(null); setOpen((o) => !o); }, "aria-expanded": open, "aria-haspopup": "menu", ref: btn })}
      {open && createPortal(
        <div ref={pop} className={`menu${className ? " " + className : ""}`} role="menu" aria-label={label} style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
          onClick={(e) => e.stopPropagation()}>
          <MenuContext.Provider value={{ close }}>{children}</MenuContext.Provider>
        </div>,
        document.body,
      )}
    </>
  );
}

export function MenuItem({ icon, children, onSelect, kbd, checked, danger, disabled, keepOpen }: {
  icon?: React.ReactNode; children: React.ReactNode; onSelect?: () => void; kbd?: string; checked?: boolean; danger?: boolean; disabled?: boolean; keepOpen?: boolean;
}) {
  const { close } = useContext(MenuContext);
  return (
    <button type="button" role="menuitem" className={`mitem${danger ? " danger" : ""}`} disabled={disabled}
      onClick={() => { if (!keepOpen) close(); onSelect?.(); }}>
      {icon}
      <span>{children}</span>
      {kbd && <span className="kbd">{kbd}</span>}
      {checked !== undefined && <span className="tick" aria-hidden>{checked ? "✓" : ""}</span>}
    </button>
  );
}
export const MenuSep = () => <div className="sep" role="separator" />;

// ---------- ContextMenu: the same menu, opened at the pointer (right-click) or under a ⋯ button ----------
export function ContextMenu({ at, onClose, children, label }: { at: { x: number; y: number }; onClose: () => void; children: React.ReactNode; label?: string }) {
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!pop.current) return;
    const p = pop.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(at.x, window.innerWidth - p.width - 8));
    const top = at.y + p.height > window.innerHeight - 8 ? Math.max(8, at.y - p.height) : at.y;
    setPos({ left, top });
    pop.current.querySelector<HTMLButtonElement>(".mitem:not(:disabled)")?.focus();
  }, [at.x, at.y]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!pop.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = [...(pop.current?.querySelectorAll<HTMLButtonElement>(".mitem:not(:disabled)") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    const onCtx = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("contextmenu", onCtx, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("contextmenu", onCtx, true); window.removeEventListener("resize", onClose); window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);
  return createPortal(
    <div ref={pop} className="menu" role="menu" aria-label={label} style={pos ?? { left: -9999, top: -9999 }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <MenuContext.Provider value={{ close: onClose }}>{children}</MenuContext.Provider>
    </div>,
    document.body,
  );
}
export const MenuLabel = ({ children }: { children: React.ReactNode }) => <div className="mlabel">{children}</div>;

// ---------- Modal ----------
export function Modal({ onClose, children, label, width }: { onClose: () => void; children: React.ReactNode; label: string; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={label} style={width ? { width: `min(${width}px, 100%)` } : undefined}>{children}</div>
    </div>,
    document.body,
  );
}

// ---------- Avatar ----------
export function Avatar({ name, size }: { name: string | null | undefined; size?: "lg" }) {
  const n = (name || "?").trim();
  return <span className={`avatar${size === "lg" ? " lg" : ""}`} aria-hidden>{n[0]?.toUpperCase() ?? "?"}</span>;
}

// ---------- Thumbnail from Bunny ----------
// src (R3): the server's thumbnail URL, which knows where each version lives; guid is the older way (Bunny Stream only).
export function Thumb({ guid, src, className = "thumb", alt = "" }: { guid?: string | null; src?: string | null; className?: string; alt?: string }) {
  const url = src !== undefined ? src : guid ? mediaUrl(guid, "thumbnail.jpg") : null;
  const [badUrl, setBadUrl] = useState<string | null>(null);
  if (!url || badUrl === url) return <span className={`${className} ph`} aria-hidden><Film size={14} /></span>;
  return <img className={className} src={url} alt={alt} loading="lazy" onError={() => setBadUrl(url)} />;
}

// ---------- Toast ----------
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3200); return () => clearTimeout(t); }, [msg]);
  const node = msg ? createPortal(<div className="toast" role="status">{msg}</div>, document.body) : null;
  return [node, setMsg] as const;
}

// ---------- Viewport ----------
export function useIsNarrow(px = 820) {
  const [n, setN] = useState(() => window.innerWidth <= px);
  useEffect(() => { const on = () => setN(window.innerWidth <= px); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, [px]);
  return n;
}

// ---------- Spinner (for anything still uploading, converting or importing) ----------
export function Spinner({ size = 12 }: { size?: number }) {
  return <LoaderCircle size={size} className="spin" aria-hidden />;
}
