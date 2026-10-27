// Phones (Oct 27): dragging Insert items and library clauses onto the page with a finger. Browsers on phones don't do
// the desktop's drag and drop, so a press-and-hold on an item picks it up: the sheet slides away, the item follows
// the finger with a line showing where it will land (between blocks, or inside a container), the page scrolls when
// the finger nears the top or bottom, and letting go drops it there. Letting go off the page cancels. A plain tap
// still adds the item after the cursor.
import type { Editor } from "@tiptap/react";
import type { PNode } from "../../convex/lib/wsBuilder";
import { dropLineAt, dropNodes } from "./editor/commands";

export type TouchDragView = { label: string; x: number; y: number; line: { top: number; left: number; width: number } | null };

const HOLD_MS = 260;
const SLOP = 10;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let e = el; e; e = e.parentElement) {
    const o = getComputedStyle(e).overflowY;
    if ((o === "auto" || o === "scroll") && e.scrollHeight > e.clientHeight) return e;
  }
  return document.scrollingElement as HTMLElement | null;
}

/**
 * Wires press-and-hold dragging. `begin` is called from an item's touchstart; the returned object is the item's
 * props. `onView` draws the floating label and the drop line; `onPicked` closes the sheet.
 */
export function touchDragger(opts: {
  editor: () => Editor | null;
  onView: (v: TouchDragView | null) => void;
  onPicked: () => void;
  onDropped: (label: string) => void;
}) {
  let timer: number | null = null;
  let lastDrop = 0;
  const cancelHold = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

  function start(nodes: PNode[], label: string, x0: number, y0: number) {
    const editor = opts.editor();
    if (!editor || editor.isDestroyed) return;
    opts.onPicked();
    try { navigator.vibrate?.(10); } catch { /* not on iPhone */ }
    let x = x0, y = y0, raf = 0;
    const scroller = scrollParent(editor.view.dom as HTMLElement);
    const draw = () => opts.onView({ label, x, y, line: overPage() ? dropLineAt(editor, nodes, { left: clampX(), top: y }) : null });
    const rect = () => (editor.view.dom as HTMLElement).getBoundingClientRect();
    const clampX = () => { const r = rect(); return Math.max(r.left + 4, Math.min(x, r.right - 4)); };
    const overPage = () => { const r = rect(); return x >= r.left - 24 && x <= r.right + 24 && y >= Math.max(r.top - 40, 0) && y <= r.bottom + 60; };
    // Near the top or bottom of the screen, the page scrolls while the finger rests there.
    const tick = () => {
      const edge = 110;
      const dy = y < edge ? -Math.ceil((edge - y) / 6) : y > innerHeight - edge ? Math.ceil((y - (innerHeight - edge)) / 6) : 0;
      if (dy && scroller) { scroller.scrollBy(0, dy); draw(); }
      raf = requestAnimationFrame(tick);
    };
    const move = (e: TouchEvent) => { e.preventDefault(); const t = e.touches[0]; if (!t) return; x = t.clientX; y = t.clientY; draw(); };
    const end = (e: TouchEvent) => {
      e.preventDefault();
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
      cancelAnimationFrame(raf);
      opts.onView(null);
      lastDrop = Date.now();
      if (e.type === "touchend" && overPage() && dropNodes(editor, nodes, { left: clampX(), top: y }, { focus: false })) opts.onDropped(label);
    };
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end, { passive: false });
    window.addEventListener("touchcancel", end, { passive: false });
    raf = requestAnimationFrame(tick);
    draw();
  }

  return {
    /** Props for an Insert item or a clause in the sheet. */
    item(nodes: () => PNode[], label: string) {
      let sx = 0, sy = 0;
      return {
        onTouchStart: (e: React.TouchEvent) => {
          if (e.touches.length !== 1) return;
          const t = e.touches[0];
          sx = t.clientX; sy = t.clientY;
          cancelHold();
          timer = window.setTimeout(() => { timer = null; start(nodes(), label, sx, sy); }, HOLD_MS);
        },
        onTouchMove: (e: React.TouchEvent) => { const t = e.touches[0]; if (t && Math.hypot(t.clientX - sx, t.clientY - sy) > SLOP) cancelHold(); },
        onTouchEnd: () => cancelHold(),
        onContextMenu: (e: React.MouseEvent) => { if (matchMedia("(pointer: coarse)").matches) e.preventDefault(); },
      };
    },
    /** True just after a drop: the tap that ends a drag mustn't also add the item. */
    justDropped: () => Date.now() - lastDrop < 700,
  };
}
