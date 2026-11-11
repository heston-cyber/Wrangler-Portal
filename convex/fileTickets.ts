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
