// D182 (Nov 16): ticks made with no signal wait on the phone and go when it reconnects. Each tick carries the time it
// was made; the server keeps the newest per shot and drops one made before a Reset, so sending one twice (a retry
// after a reload) is harmless. The queue lives in this browser's storage, one list per page (owner or crew).
import { useCallback, useEffect, useRef, useState } from "react";
import { useConvexConnectionState } from "convex/react";

export type Tick = { shotId: string; done: boolean; at: number };

/** Add a tick: it replaces an earlier waiting tick of the same shot. */
export function queueTick(q: Tick[], t: Tick): Tick[] {
  return [...q.filter((x) => x.shotId !== t.shotId), t];
}
/** What a shot shows: the waiting tick if there is one, else what the server has. */
export function shownDone(serverDone: boolean, shotId: string, q: Tick[]): boolean {
  const t = q.find((x) => x.shotId === shotId);
  return t ? t.done : serverDone;
}
/** The line under the header while ticks wait ("No signal · 1 tick saved on this phone · will sync"). */
export function waitingLine(n: number, online: boolean): string | null {
  if (!n) return null;
  const ticks = `${n} tick${n === 1 ? "" : "s"}`;
  return online ? `Syncing ${ticks}…` : `No signal · ${ticks} saved on this phone · will sync`;
}

const read = (key: string): Tick[] => {
  try { const v = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(v) ? v.filter((t) => t && typeof t.shotId === "string" && typeof t.at === "number") : []; } catch { return []; }
};
const write = (key: string, q: Tick[]) => { try { if (q.length) localStorage.setItem(key, JSON.stringify(q)); else localStorage.removeItem(key); } catch { /* private window: it still works until the page closes */ } };

/**
 * The queue for one page: `tick` shows at once, is saved on the phone, and is sent; it leaves the queue when the server
 * has it. Anything left from before (the page was closed with no signal) is sent again when the page opens.
 */
export function useTickQueue(key: string, send: (t: Tick) => Promise<unknown>) {
  const [q, setQ] = useState<Tick[]>(() => read(key));
  const conn = useConvexConnectionState();
  const [netOnline, setNetOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [synced, setSynced] = useState(false);
  const sending = useRef(new Set<string>());
  useEffect(() => {
    const on = () => setNetOnline(true), off = () => setNetOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  const online = netOnline && conn.isWebSocketConnected;
  // "Synced" shows only after ticks waited with no signal, not after every tick.
  const waited = useRef(false);
  if (!online && q.length) waited.current = true;
  const push = useCallback((t: Tick) => {
    const id = `${t.shotId}@${t.at}`;
    if (sending.current.has(id)) return;
    sending.current.add(id);
    // The Convex client holds a mutation until it's connected again, so this settles once the server has answered.
    send(t).then(() => {
      setQ((cur) => { const next = cur.filter((x) => !(x.shotId === t.shotId && x.at === t.at)); write(key, next); if (!next.length && waited.current) { waited.current = false; setSynced(true); } return next; });
    }, () => {
      // Refused (not a lost signal): drop it so the page shows what the server has.
      setQ((cur) => { const next = cur.filter((x) => !(x.shotId === t.shotId && x.at === t.at)); write(key, next); return next; });
    }).finally(() => sending.current.delete(id));
  }, [key, send]);
  // Send what was left from before, once.
  const once = useRef(false);
  useEffect(() => { if (!once.current) { once.current = true; read(key).forEach(push); } }, [key, push]);
  useEffect(() => { if (!synced) return; const t = setTimeout(() => setSynced(false), 2500); return () => clearTimeout(t); }, [synced]);
  const tick = useCallback((shotId: string, done: boolean) => {
    const t = { shotId, done, at: Date.now() };
    setSynced(false);
    setQ((cur) => { const next = queueTick(cur, t); write(key, next); return next; });
    push(t);
  }, [key, push]);
  return { queue: q, tick, online, line: waitingLine(q.length, online), synced };
}
