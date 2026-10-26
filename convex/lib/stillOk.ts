// Is this URL one of our own stills (our stills zone under /stills/, or Convex storage)? Parse, then check: https,
// the exact host, no query, no "..". Anything else is refused, so a note (or a poster) can't point at an outside picture.
export function stillOk(u: string) {
  let p: URL;
  try { p = new URL(u); } catch { return false; }
  if (p.protocol !== "https:" || p.search || p.hash || p.href !== u || p.pathname.includes("..")) return false;
  const cdn = process.env.BUNNY_STILLS_CDN;
  if (cdn && p.host === cdn) return p.pathname.startsWith("/stills/");
  const cloud = process.env.CONVEX_CLOUD_URL;
  return !!cloud && p.origin === cloud && p.pathname.startsWith("/api/storage/");
}
