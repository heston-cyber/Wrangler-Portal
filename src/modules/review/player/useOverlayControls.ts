// Nov 25 (Heston, approved): the player's controls (play, settings, sound, full screen) sit in a small glass box at the
// bottom centre of the picture. It shows while the mouse is over the video and goes away when it leaves.
//   D1 only with a mouse or trackpad (phones and iPads keep the controls under the picture)
//   D2 while playing, it also fades after 2.5 s without the mouse moving and comes back on the next move; while paused it
//      stays as long as the mouse is over the video. The mouse pointer hides with it while playing (full screen too).
//   D3 it isn't shown while drawing on a note (VideoPage doesn't render it then)
// It also stays up while its settings menu is open or a keyboard user is on its buttons (CSS: .vctl:has(...)).
import { useCallback, useEffect, useRef, useState } from "react";

export const IDLE_MS = 2500;
const FINE = "(hover: hover) and (pointer: fine)";

/** True on a device with a mouse or trackpad (the box needs hover to appear). */
export function useCanHover() {
  const q = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(FINE) : null);
  const [on, setOn] = useState(() => !!q()?.matches);
  useEffect(() => {
    const m = q();
    if (!m) return;
    const f = () => setOn(m.matches);
    m.addEventListener?.("change", f);
    return () => m.removeEventListener?.("change", f);
  }, []);
  return on;
}

/** Show/hide for the box: handlers for the picture (stage) and the box, and whether it's shown. */
export function useOverlayControls(playing: boolean) {
  const [shown, setShown] = useState(false);
  const inside = useRef(false), onBox = useRef(false), playingRef = useRef(playing);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const arm = useCallback(() => {
    clear();
    timer.current = setTimeout(() => { if (playingRef.current && !onBox.current) setShown(false); }, IDLE_MS);
  }, []);
  useEffect(() => {
    playingRef.current = playing;
    if (!inside.current) return;
    setShown(true); // a pause or play brings it back; playing then fades it again after a still moment
    if (playing) arm(); else clear();
  }, [playing, arm]);
  useEffect(() => clear, []);
  const stage = {
    onPointerMove: (e: React.PointerEvent) => {
      if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      inside.current = true; setShown(true);
      if (playingRef.current) arm(); else clear();
    },
    onPointerLeave: () => { inside.current = false; onBox.current = false; clear(); setShown(false); },
  };
  const box = {
    onPointerEnter: () => { onBox.current = true; clear(); },
    onPointerLeave: () => { onBox.current = false; if (playingRef.current && inside.current) arm(); },
  };
  return { shown, idle: !shown && playing && inside.current, stage, box };
}
