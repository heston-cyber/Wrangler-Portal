// Who's looking at the review page (client side C3, Oct 23). The owner's own site sets nothing (the default).
// A share link page provides the share (token, passcode, guest name and key), which every call to the backend
// carries, and what the viewer may do, which decides what the page shows.
import { createContext, useContext } from "react";

export type ShareRef = { token: string; passcode?: string; guestKey?: string; guestName?: string };
export type Viewer = {
  share: ShareRef | null;
  can: "owner" | "view" | "comment";
  kind: "owner" | "client" | "guest";
  name: string | null;
  downloads: boolean;
  /** Where "back" goes from a video (the share's list page, or the owner's site). */
  home: string;
  /** A guest on a comment link who hasn't given a name yet: the page asks before the first note. */
  needsName: boolean;
  setGuestName?: (name: string) => void;
};

export const OWNER: Viewer = { share: null, can: "owner", kind: "owner", name: null, downloads: true, home: "/", needsName: false };
export const ViewerCtx = createContext<Viewer>(OWNER);
export const useViewer = () => useContext(ViewerCtx);
/** `{ share }` to spread into a backend call's arguments, or nothing on the owner's site. */
export function useShareArgs(): { share?: ShareRef } {
  const { share } = useViewer();
  return share ? { share } : {};
}

// The guest's identity on this browser: a random key (so they can edit their own notes) and the name they gave.
const KEY = "wr.guest.key", NAME = "wr.guest.name";
export function guestKey(): string {
  try {
    let k = localStorage.getItem(KEY);
    if (!k) { const b = new Uint8Array(12); crypto.getRandomValues(b); k = Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""); localStorage.setItem(KEY, k); }
    return k;
  } catch { return "g-" + Math.random().toString(36).slice(2); }
}
export function readGuestName(): string { try { return localStorage.getItem(NAME) ?? ""; } catch { return ""; } }
export function writeGuestName(n: string) { try { localStorage.setItem(NAME, n); } catch { /* private mode */ } }
export function readPasscode(token: string): string | undefined { try { return sessionStorage.getItem(`wr.pass.${token}`) ?? undefined; } catch { return undefined; } }
export function writePasscode(token: string, p: string) { try { sessionStorage.setItem(`wr.pass.${token}`, p); } catch { /* ignore */ } }
