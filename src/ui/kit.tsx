// Small shared pieces: popover menus, dialogs, avatars, thumbnails, toasts.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Film, LoaderCircle } from "lucide-react";
import { BUNNY_CDN_HOST } from "../config";

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
export function Thumb({ guid, className = "thumb", alt = "" }: { guid: string | null | undefined; className?: string; alt?: string }) {
  const [bad, setBad] = useState(false);
  if (!guid || bad) return <span className={`${className} ph`} aria-hidden><Film size={14} /></span>;
  return <img className={className} src={`https://${BUNNY_CDN_HOST}/${guid}/thumbnail.jpg`} alt={alt} loading="lazy" onError={() => setBad(true)} />;
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
