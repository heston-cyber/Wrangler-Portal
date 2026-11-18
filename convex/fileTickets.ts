// Second 5e review (Nov 10, W-9 check): W-9s are tax forms, and a Convex storage link works for anyone, forever. So a
// W-9 opens only through a ticket: made by a mutation that checks the caller right then, good for 10 minutes, served by
// /f/<token> with no caching. Someone whose switch is turned off later can't open it again from an old link.
import { httpAction } from "./_generated/server";
import { internalQuery } from "./lib/functions";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { randomToken } from "./lib/hash";
import { checkFileLink } from "./lib/fileLinks";

export const TICKET_MS = 10 * 60_000;
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/** A ticket for a file the caller has just been checked for. Returns the address to open. */
export async function ticketFor(ctx: MutationCtx, fileId: Id<"_storage">, businessId: Id<"businesses">, name: string) {
  const now = Date.now();
  for (const old of await ctx.db.query("fileTickets").withIndex("by_expiry", (q) => q.lt("expiresAt", now)).take(50)) await ctx.db.delete(old._id);
  const token = randomToken(24);
  await ctx.db.insert("fileTickets", { token, fileId, businessId, name: name.replace(/[^\w .()-]+/g, "_").slice(0, 120) || "file.pdf", expiresAt: now + TICKET_MS });
  return `${(process.env.CONVEX_SITE_URL ?? "").replace(/\/$/, "")}/f/${token}`;
}

export const byToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const t = await ctx.db.query("fileTickets").withIndex("by_token", (q) => q.eq("token", token)).unique();
    return t && t.expiresAt > Date.now() ? { fileId: t.fileId, name: t.name } : null;
  },
});

export const route = httpAction(async (ctx, req) => {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  let token = "";
  try { token = decodeURIComponent(new URL(req.url).pathname.replace(/^\/f\//, "")); } catch { token = ""; }
  const t = TOKEN.test(token) ? await ctx.runQuery(internal.fileTickets.byToken, { token }) : null;
  const blob = t ? await ctx.storage.get(t.fileId) : null;
  if (!t || !blob) return new Response("This link has expired. Open the file again from the portal.", { status: 404, headers: { ...headers, "Content-Type": "text/plain" } });
  return new Response(blob, { status: 200, headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${t.name.replace(/"/g, "")}"` } });
});

const INLINE = /^(application\/pdf|image\/(png|jpeg|gif|webp|avif)|video\/(mp4|quicktime|webm)|audio\/(mpeg|mp4|wav))$/i;
/** Phase 6 sweep M1: /fl/<file>/<expiry>/<signature>/<name>, a signed link made by lib/fileLinks.ts. Pictures, PDFs and
 *  media open in place; anything else downloads (never runs on this address). */
// Convex answers an HTTP action with at most 20 MB; a bigger file (canvas and brand-kit files go to 25 MB) is handed to
// the storage address for this one opening (review M3; its window was checked above, so a turned-off share stays off).
const BIG = 19 * 1024 * 1024;
export const linkRoute = httpAction(async (ctx, req) => {
  const headers: Record<string, string> = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Access-Control-Allow-Origin": "*" };
  let path = "";
  try { path = new URL(req.url).pathname; } catch { path = ""; }
  const ok = await checkFileLink(path);
  const meta = ok ? await ctx.runQuery(internal.fileTickets.fileMeta, { fileId: ok.fileId }) : null;
  const gone = () => new Response("This link has expired. Open the file again from the page you found it on.", { status: 404, headers: { ...headers, "Cache-Control": "no-store", "Content-Type": "text/plain" } });
  if (!ok || !meta) return gone();
  // Review L2: a browser keeps it only until the link runs out
  const cache = { "Cache-Control": `private, max-age=${Math.max(0, Math.floor((ok.exp - Date.now()) / 1000))}` };
  if (meta.size > BIG) { const url = await ctx.storage.getUrl(ok.fileId as Id<"_storage">); return url ? new Response(null, { status: 302, headers: { ...headers, "Cache-Control": "no-store", Location: url } }) : gone(); }
  const blob = await ctx.storage.get(ok.fileId as Id<"_storage">);
  if (!blob) return gone();
  const type = (meta.contentType || blob.type || "application/octet-stream").toLowerCase();
  const name = `filename="${ok.name.replace(/"/g, "")}"`;
  // Review M3: an SVG logo shows in place, but sandboxed so any script in it never runs.
  if (type === "image/svg+xml") return new Response(blob, { status: 200, headers: { ...headers, ...cache, "Content-Type": type, "Content-Disposition": `inline; ${name}`, "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'" } });
  const inline = INLINE.test(type);
  return new Response(blob, { status: 200, headers: { ...headers, ...cache, "Content-Type": inline ? type : "application/octet-stream", "Content-Disposition": `${inline ? "inline" : "attachment"}; ${name}` } });
});

export const fileMeta = internalQuery({
  args: { fileId: v.string() },
  handler: async (ctx, { fileId }) => {
    const id = ctx.db.system.normalizeId("_storage", fileId);
    const m = id ? await ctx.db.system.get(id) : null;
    return m ? { size: m.size, contentType: m.contentType ?? null } : null;
  },
});
