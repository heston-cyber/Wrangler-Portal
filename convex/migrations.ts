// Wrangler Portal, Phase 0.5d step 2 (Oct 28): tag every existing record with its business.
// Internal only, run by hand through the "Convex run" workflow (practice on the dev copy first, then live on
// Heston's OK). Output is counts only: the repo and its CI logs are public. Safe to run again: rows that already
// have a business are left alone, and nothing else on a row changes.
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./lib/functions";
import { internal } from "./_generated/api";
import { BUSINESS_TABLES } from "./lib/tenancy";
import { defaultBusiness } from "./lib/business";
import { eventsOf, verifyChain } from "./lib/wsAudit";

const BATCH = 200;

export const tagBatch = internalMutation({
  args: { table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, cursor }) => {
    if (!BUSINESS_TABLES.includes(table)) throw new Error(`Not a business table: ${table}`);
    const biz = await defaultBusiness(ctx);
    if (!biz) throw new Error("No default business yet: run business:bootstrap first.");
    const page = await ctx.db.query(table as never).paginate({ numItems: BATCH, cursor });
    let patched = 0;
    for (const row of page.page as Array<{ _id: never; businessId?: string }>) {
      if (row.businessId === undefined) { await ctx.db.patch(row._id, { businessId: biz._id } as never); patched++; }
    }
    return { seen: page.page.length, patched, cursor: page.continueCursor, done: page.isDone };
  },
});

export const tagAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ boot: unknown; tables: Record<string, { seen: number; patched: number }>; after: unknown }> => {
    const boot: unknown = await ctx.runMutation(internal.business.bootstrap, {});
    const tables: Record<string, { seen: number; patched: number }> = {};
    for (const table of BUSINESS_TABLES) {
      let cursor: string | null = null; let seen = 0; let patched = 0;
      for (;;) {
        const r: { seen: number; patched: number; cursor: string; done: boolean } = await ctx.runMutation(internal.migrations.tagBatch, { table, cursor });
        seen += r.seen; patched += r.patched; cursor = r.cursor;
        if (r.done) break;
      }
      tables[table] = { seen, patched };
    }
    const after: unknown = await ctx.runQuery(internal.migrations.tagSelfTest, {});
    return { boot, tables, after };
  },
});

/** Per business table: rows, and rows still without a business. ok when none are missing. */
export const tagSelfTest = internalQuery({
  args: {},
  handler: async (ctx) => {
    const out: Record<string, { rows: number; missing: number }> = {};
    let missing = 0, rows = 0;
    for (const table of BUSINESS_TABLES) {
      let r = 0, m = 0;
      for await (const row of ctx.db.query(table as never) as AsyncIterable<{ businessId?: string }>) { r++; if (row.businessId === undefined) m++; }
      out[table] = { rows: r, missing: m }; rows += r; missing += m;
    }
    return { rows, missing, ok: missing === 0, tables: out };
  },
});

/** Wrangler Sign's audit trails: how many documents' hash chains verify (counts only). Run before and after tagging. */
export const chainSelfTest = internalQuery({
  args: {},
  handler: async (ctx) => {
    let documents = 0, intact = 0, events = 0;
    for await (const d of ctx.db.query("wsDocuments")) {
      documents++;
      const evs = await eventsOf(ctx, d._id);
      events += evs.length;
      if ((await verifyChain(evs)).ok) intact++;
    }
    return { documents, intact, events, ok: intact === documents };
  },
});

// ---------- Phase 0.5d step 5: every client a project or share names gets a record, and they link to it ----------

export const linkClientsBatch = internalMutation({
  args: { table: v.union(v.literal("projects"), v.literal("shares")), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ numItems: BATCH, cursor });
    let linked = 0;
    for (const row of page.page as unknown as Array<{ _id: never; client?: string; clientId?: string; kind?: string }>) {
      const names = table === "projects" || row.kind === "client";
      if (names && row.client?.trim() && !row.clientId) { await ctx.db.patch(row._id, { client: row.client } as never); linked++; }
    }
    return { seen: page.page.length, linked, cursor: page.continueCursor, done: page.isDone };
  },
});

export const linkClients = internalAction({
  args: {},
  handler: async (ctx): Promise<{ projects: { seen: number; linked: number }; shares: { seen: number; linked: number }; after: unknown }> => {
    const out = { projects: { seen: 0, linked: 0 }, shares: { seen: 0, linked: 0 } };
    for (const table of ["projects", "shares"] as const) {
      let cursor: string | null = null;
      for (;;) {
        const r: { seen: number; linked: number; cursor: string; done: boolean } = await ctx.runMutation(internal.migrations.linkClientsBatch, { table, cursor });
        out[table].seen += r.seen; out[table].linked += r.linked; cursor = r.cursor;
        if (r.done) break;
      }
    }
    const after: unknown = await ctx.runQuery(internal.migrations.clientsSelfTest, {});
    return { ...out, after };
  },
});

/** Counts only: client records, and projects/shares that name a client but aren't linked to one. */
export const clientsSelfTest = internalQuery({
  args: {},
  handler: async (ctx) => {
    let unlinked = 0, linked = 0, mismatched = 0;
    const clients = await ctx.db.query("clients").collect();
    const byId = new Map(clients.map((c) => [c._id as string, c]));
    const check = (row: { client?: string; clientId?: string }) => {
      if (!row.client?.trim()) return;
      if (!row.clientId) { unlinked++; return; }
      linked++;
      const c = byId.get(row.clientId);
      if (!c || c.name.trim().toLowerCase() !== row.client.trim().toLowerCase()) mismatched++;
    };
    for await (const p of ctx.db.query("projects")) check(p);
    for await (const s of ctx.db.query("shares")) if (s.kind === "client") check(s);
    return { clients: clients.length, madeFromProjects: clients.filter((c) => c.fromProjects).length, linked, unlinked, mismatched, ok: unlinked === 0 && mismatched === 0 };
  },
});
