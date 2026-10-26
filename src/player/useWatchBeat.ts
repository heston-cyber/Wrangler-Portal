// C9 (Oct 26): tells the server how much of a version is being watched. Once a second while the picture plays it
// adds the time that went by (bounded, so a jump doesn't count as watching) and notes the furthest point; every
// ten seconds, on pause, when the tab is hidden and when the page is left, it sends one beat. Owners don't report.
import { useEffect, useRef, type RefObject } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { ShareRef } from "../lib/viewer";

const FLUSH_MS = 10_000;

function sessionId() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function useWatchBeat(versionId: Id<"versions"> | null, videoRef: RefObject<HTMLVideoElement | null>, share: ShareRef | undefined, enabled: boolean) {
  const beat = useMutation(api.views.beat);
  const state = useRef({ session: "", pending: 0, max: 0, lastT: null as number | null, lastSent: 0, dirty: false });
  useEffect(() => {
    if (!enabled || !versionId) return;
    const s = state.current;
    s.session = sessionId(); s.pending = 0; s.max = 0; s.lastT = null; s.lastSent = Date.now(); s.dirty = false;
    const flush = () => {
      const v = videoRef.current;
      if (!s.dirty && !s.pending) return;
      const pending = s.pending; s.pending = 0; s.dirty = false; s.lastSent = Date.now();
      void beat({ versionId, session: s.session, watchedSec: pending, posSec: v?.currentTime ?? s.max, lengthSec: v && isFinite(v.duration) ? v.duration : 0, share }).catch(() => {});
    };
    const onPause = () => flush();
    let attached: HTMLVideoElement | null = null;
    const attach = (v: HTMLVideoElement | null) => {
      if (v === attached) return;
      attached?.removeEventListener("pause", onPause); attached?.removeEventListener("ended", onPause);
      attached = v;
      v?.addEventListener("pause", onPause); v?.addEventListener("ended", onPause);
    };
    const tick = setInterval(() => {
      const v = videoRef.current;
      attach(v); // the element can appear after the first tick, or be swapped when the copy changes
      if (!v) return;
      const t = v.currentTime;
      if (!v.paused && !v.ended && v.readyState >= 2 && s.lastT !== null) {
        const d = t - s.lastT;
        if (d > 0 && d < 1.6) { s.pending += d; s.dirty = true; } // a jump or a stall isn't watching
      }
      if (t > s.max) { s.max = t; s.dirty = true; }
      s.lastT = t;
      if (s.dirty && Date.now() - s.lastSent >= FLUSH_MS) flush();
    }, 1000);
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    attach(videoRef.current);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      clearInterval(tick);
      attach(null);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // A new version (or a new viewer) starts a new sitting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, enabled, share?.token]);
}
