// Phase 6 review M2: file links last 10-20 minutes (convex/lib/fileLinks.ts). A subscribed query only re-runs when its
// data or its arguments change, so pages that show files pass this number, which moves every 10 minutes: the query asks
// again and the page gets fresh links before the old ones run out.
import { useEffect, useState } from "react";

export const LINK_WINDOW_MS = 10 * 60_000;
const now = () => Math.floor(Date.now() / LINK_WINDOW_MS);

export function useLinkWindow(): number {
  const [w, setW] = useState(now);
  useEffect(() => {
    const t = setTimeout(() => setW(now()), LINK_WINDOW_MS - (Date.now() % LINK_WINDOW_MS) + 1000);
    return () => clearTimeout(t);
  }, [w]);
  return w;
}
