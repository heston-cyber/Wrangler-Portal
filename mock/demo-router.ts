// Demo build: an in-memory router. An artifact can't use the page's own address for routes,
// so pages change inside the app only (Back goes through the app's own history).
import { useEffect, useState } from "react";

let current = { path: "/", search: "" };
const stack: Array<typeof current> = [];
const fire = () => window.dispatchEvent(new Event("wr:navigate"));

export function navigate(to: string) {
  const u = new URL(to, "https://demo.invalid");
  const next = { path: u.pathname, search: u.search };
  if (next.path === current.path && next.search === current.search) return;
  stack.push(current);
  current = next;
  fire();
  window.scrollTo(0, 0);
}

export function back() { const prev = stack.pop(); if (prev) { current = prev; fire(); } }

export function useLocation() {
  const [loc, setLoc] = useState(current);
  useEffect(() => {
    const on = () => setLoc(current);
    window.addEventListener("wr:navigate", on);
    return () => window.removeEventListener("wr:navigate", on);
  }, []);
  return loc;
}

export function linkProps(to: string) {
  return {
    href: "#",
    onClick: (e: React.MouseEvent) => { e.preventDefault(); navigate(to); },
  };
}
