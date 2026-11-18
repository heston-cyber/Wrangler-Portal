import { useEffect, useState } from "react";

// A tiny path router (GitHub Pages serves index.html for unknown paths via 404.html).
/** True when the last change of page was the browser's back/forward (a swipe from the edge, the back button): the browser
 *  shows its own slide then, so the portal's doesn't play a second one (Heston, Nov 17: slides on phones too). */
let byBrowser = false;
export const cameBackByBrowser = () => byBrowser;
if (typeof window !== "undefined") window.addEventListener("popstate", () => { byBrowser = true; }); // added first, so it runs before the hooks' own
export function navigate(to: string) {
  if (to === location.pathname + location.search) return;
  byBrowser = false;
  history.pushState(null, "", to);
  window.dispatchEvent(new Event("wr:navigate"));
  window.scrollTo(0, 0);
}

export function useLocation() {
  const [loc, setLoc] = useState(() => ({ path: location.pathname, search: location.search }));
  useEffect(() => {
    const on = () => setLoc({ path: location.pathname, search: location.search });
    window.addEventListener("popstate", on);
    window.addEventListener("wr:navigate", on);
    return () => { window.removeEventListener("popstate", on); window.removeEventListener("wr:navigate", on); };
  }, []);
  return loc;
}

export function linkProps(to: string) {
  return {
    href: to,
    onClick: (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(to);
    },
  };
}
