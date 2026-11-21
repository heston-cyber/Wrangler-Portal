// Nov 21 (Heston: "a site-wide animation that follows my mouse ... a gray highlight box of whatever I am hovering on
// ... that shows me that it's a button"; approved 11:05, "glide between"). One soft gray rounded rectangle sits over
// whatever can be clicked under the mouse and glides to the next one as the mouse moves. Nothing that can't be clicked
// gets it, so a look-alike that isn't a button stays plain. Mouse and trackpad only (never on a phone); no gliding
// with Reduce Motion on; text fields and Stripe's card form (an iframe) are left alone.
import { useEffect, useRef } from "react";

/** What counts as clickable. */
export const CLICKABLE = [
  "a[href]", "button:not(:disabled)", "summary", "label[for]",
  "[role=button]:not([aria-disabled=true])", "[role=link]", "[role=menuitem]", "[role=menuitemradio]", "[role=menuitemcheckbox]",
  "[role=tab]", "[role=option]", "[role=switch]", "[role=checkbox]", "[role=radio]",
  "input[type=checkbox]", "input[type=radio]", "[data-glow]",
].join(",");
/** Never: typing places, things that ask not to, and anything inside them. */
const SKIP = "input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=true], iframe, [data-no-glow]";

/** The clickable element under the pointer, or null. A huge one (a whole card that's a link) is skipped: a box the size
 *  of the page tells you nothing. */
export function clickableAt(el: Element | null, view = { w: 1280, h: 800 }): HTMLElement | null {
  if (!el || el.closest(SKIP)) return null;
  const c = el.closest(CLICKABLE) as HTMLElement | null;
  if (!c) return null;
  const r = c.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || r.width * r.height > view.w * view.h * 0.5) return null;
  return c;
}

export function HoverGlow() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fine = window.matchMedia?.("(hover: hover) and (pointer: fine)");
    if (!fine?.matches || !box.current) return;
    const b = box.current;
    let target: HTMLElement | null = null;
    let frame = 0;
    let lastX = 0, lastY = 0;
    const place = () => {
      frame = 0;
      const next = clickableAt(document.elementFromPoint(lastX, lastY), { w: innerWidth, h: innerHeight });
      if (!next) { target = null; b.dataset.on = ""; return; }
      const first = !b.dataset.on;
      target = next;
      const r = next.getBoundingClientRect();
      const radius = getComputedStyle(next).borderRadius;
      b.style.borderRadius = radius && radius !== "0px" ? radius : "10px";
      // Appearing from nothing: jump there, then fade in (gliding in from the last place would look like a slide).
      if (first) b.dataset.jump = "1";
      b.style.transform = `translate(${r.left}px, ${r.top}px)`;
      b.style.width = `${r.width}px`;
      b.style.height = `${r.height}px`;
      b.dataset.on = "1";
      if (first) requestAnimationFrame(() => { delete b.dataset.jump; });
    };
    const ask = () => { if (!frame) frame = requestAnimationFrame(place); };
    const move = (e: PointerEvent) => { if (e.pointerType !== "mouse" && e.pointerType !== "pen") return; lastX = e.clientX; lastY = e.clientY; ask(); };
    const leave = () => { target = null; b.dataset.on = ""; };
    const follow = () => { if (target) ask(); }; // scrolling or resizing moves what's under the mouse
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("scroll", follow, { passive: true, capture: true });
    window.addEventListener("resize", follow, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return <div ref={box} className="wp-hoverglow" aria-hidden="true" />;
}
