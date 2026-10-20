import { useEffect, useState } from "react";

// A tiny path router (GitHub Pages serves index.html for unknown paths via 404.html).
export function navigate(to: string) {
  if (to === location.pathname + location.search) return;
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
