// Phase 5e step 3 (Nov 5): Settings › Activity (frames 820:13940 …, 820:16517 details). Owner only; kept 1 year (D146).
// What writes here (lib/audit.ts audit()): anything sent (contracts, invoices, quotes, proposals, Inbox notes, shares, portal
// and team invites, call sheets, briefings), signatures, payments (Stripe, vendor invoices), voids and deletions, settings,
// team changes, new-device sign-ins and password and email changes, and exports.
import { internalMutation, query } from "./lib/functions";
import { v } from "convex/values";
import { requireOwner } from "./lib/access";
import { businessInScope } from "./lib/business";
import { audit, type AuditKind } from "./lib/audit";

const KINDS: AuditKind[] = ["sent", "signed", "paid", "deleted", "settings", "team", "export", "signin"];
const kindArg = v.union(...KINDS.map((k) => v.literal(k)));
export const KEEP_DAYS = 365;

/** The log, newest first, 50 at a time ("Load earlier" passes the oldest `at` shown), with the counts for the filters. */
export const list = query({
  args: { kind: v.optional(kindArg), who: v.optional(v.string()), before: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, { kind, who, before, limit }) => {
    const n = Math.max(1, Math.min(500, Math.round(limit ?? 50)));
    await requireOwner(ctx);
    const biz = businessInScope(ctx);
    const all = await ctx.db.query("auditLog").withIndex("by_business_at", (q) => q.eq("businessId", biz ?? undefined)).order("desc").take(5000);
    const counts: Record<string, number> = { all: all.length };
    for (const r of all) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    const people = [...new Set(all.filter((r) => r.role !== "System").map((r) => r.who))].slice(0, 12);
    const rows = all.filter((r) => (!kind || r.kind === kind) && (!who || r.who === who) && (!before || r.at < before)).slice(0, n)
      .map((r) => ({ _id: r._id, at: r.at, kind: r.kind, who: r.who, role: r.role, text: r.text, where: r.where ?? null, link: r.link ?? null, device: r.device ?? null }));
    return { rows, counts, people, more: rows.length === n };
  },
});

/** For actions (which can't write): the same line, written as the caller. */
export const log = internalMutation({
  args: { kind: kindArg, text: v.string(), where: v.optional(v.string()), link: v.optional(v.string()), by: v.optional(v.object({ name: v.string(), role: v.string() })), businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, a) => { await audit(ctx, a); },
});

/** Daily: lines older than a year go (D146). */
export const purge = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db.query("auditLog").withIndex("by_at", (q) => q.lt("at", Date.now() - KEEP_DAYS * 86_400_000)).take(500);
    for (const r of old) await ctx.db.delete(r._id);
    return old.length;
  },
});
