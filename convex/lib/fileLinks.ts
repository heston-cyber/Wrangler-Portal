// Phase 6 security sweep M1 (Heston, Nov 17: "go with your suggestions"): files shown on shared or withdrawable pages
// (contract copies, proposals, creative docs, canvases, brand kits, signed PDFs, the connector's) open through a link
// that lasts 10 to 20 minutes, not a Convex storage address that works forever. The link is signed with a server secret
// and made inside the query that has just checked the caller, so turning a share off stops new links at once and old
// ones within 20 minutes. No database write, so queries can make them. Served by /fl/ (convex/http.ts).
import type { Id } from "../_generated/dataModel";

export const LINK_WINDOW_MS = 10 * 60_000;
const secret = () => process.env.FILE_LINK_SECRET || process.env.JWT_PRIVATE_KEY || "";

const b64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sign(payload: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(`wp-file-link:${secret()}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(payload))).slice(0, 32);
}
const cleanName = (name: string) => name.replace(/[^\w .()-]+/g, "_").slice(0, 120) || "file";

/** A link to a stored file, good until the end of the next 10-minute window (so a query's answer stays the same for a
 *  while and pages don't re-render every second). `null` when there's no file or no server secret. */
export async function fileLink(fileId: Id<"_storage"> | string | null | undefined, name = "file", now = Date.now()): Promise<string | null> {
  if (!fileId || !secret()) return null;
  const exp = Math.floor(now / LINK_WINDOW_MS) * LINK_WINDOW_MS + 2 * LINK_WINDOW_MS;
  const n = cleanName(name);
  const sig = await sign(`${fileId}|${exp}|${n}`);
  return `${(process.env.CONVEX_SITE_URL ?? "").replace(/\/$/, "")}/fl/${fileId}/${exp}/${sig}/${encodeURIComponent(n)}`;
}

/** Checks a /fl/ path: the file id when the link is genuine and in date. */
export async function checkFileLink(path: string, now = Date.now()): Promise<{ fileId: string; name: string } | null> {
  const m = /^\/fl\/([A-Za-z0-9_]{10,64})\/(\d{10,15})\/([A-Za-z0-9_-]{32})\/([^/]{1,400})$/.exec(path);
  if (!m || !secret()) return null;
  const [, fileId, exp, sig] = m;
  let name = "";
  try { name = decodeURIComponent(m[4]); } catch { return null; }
  if (Number(exp) < now || Number(exp) > now + 3 * LINK_WINDOW_MS) return null;
  const want = await sign(`${fileId}|${exp}|${name}`);
  let diff = want.length ^ sig.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (sig.charCodeAt(i) || 0);
  return diff === 0 ? { fileId, name } : null;
}
