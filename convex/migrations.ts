// Wrangler Portal, Phase 0.5d step 2 (Oct 28): tag every existing record with its business.
// Internal only, run by hand through the "Convex run" workflow (practice on the dev copy first, then live on
// Heston's OK). Output is counts only: the repo and its CI logs are public. Safe to run again: rows that already
// have a business are left alone, and nothing else on a row changes.
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./lib/functions";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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

// ---------- 5e review (Nov 6): who owns each stored file ----------
// Records a fileOwners row for every file a business's records point at (the fields the schema types as storage ids,
// plus the brand kits and Sign styles), so files from before Nov 6 can be deleted by their business and counted in
// Your data. Run by hand after a `convex export`, on the dev copy first. Safe to run again: a file already recorded is
// left alone.
// Second 5e review (Nov 10): first every reference is collected across all businesses; only a file exactly one business
// points at is recorded. A file two businesses point at (before Nov 6 one could point a logo or a style at another's
// file) is recorded for nobody and listed, for Heston to decide.
import { filesOf } from "./yourData";

const SMALL = new Set(["wsBuilds", "wsTemplates", "wsStyles", "proposals", "briefings"]); // big rows: fewer per call

export const ownersScan = internalQuery({
  args: { table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, cursor }) => {
    if (table !== "businesses" && !BUSINESS_TABLES.includes(table)) throw new Error(`Not a business table: ${table}`);
    const page = await ctx.db.query(table as never).paginate({ numItems: SMALL.has(table) ? 25 : BATCH, cursor });
    const refs: Array<{ id: string; biz: string }> = [];
    let missing = 0;
    for (const row of page.page as Array<{ _id: string; businessId?: string }>) {
      const biz = table === "businesses" ? row._id : row.businessId;
      if (!biz) continue;
      for (const f of filesOf(table, row)) {
        const id = ctx.db.system.normalizeId("_storage", f.id);
        if (!id || !(await ctx.db.system.get(id))) { missing++; continue; }
        refs.push({ id, biz });
      }
    }
    return { refs, missing, cursor: page.continueCursor, done: page.isDone };
  },
});

export const ownersRecord = internalMutation({
  args: { files: v.array(v.object({ id: v.id("_storage"), biz: v.id("businesses"), table: v.string() })) },
  handler: async (ctx, { files }) => {
    let recorded = 0, already = 0;
    for (const f of files) {
      const have = await ctx.db.query("fileOwners").withIndex("by_storage", (q) => q.eq("storageId", f.id)).first();
      if (have) { already++; continue; }
      await ctx.db.insert("fileOwners", { storageId: f.id, businessId: f.biz, purpose: `backfill:${f.table}`, at: Date.now() });
      recorded++;
    }
    return { recorded, already };
  },
});

type OwnersReport = { recorded: number; already: number; missing: number; conflicts: Array<{ fileId: string; businesses: string[]; tables: string[] }> };
export const ownersAll = internalAction({
  args: {},
  handler: async (ctx): Promise<OwnersReport> => {
    const seen = new Map<string, { biz: Set<string>; tables: Set<string> }>();
    let missing = 0;
    for (const table of ["businesses", ...BUSINESS_TABLES]) {
      let cursor: string | null = null;
      for (;;) {
        const r: { refs: Array<{ id: string; biz: string }>; missing: number; cursor: string; done: boolean } = await ctx.runQuery(internal.migrations.ownersScan, { table, cursor });
        missing += r.missing;
        for (const x of r.refs) { const e = seen.get(x.id) ?? { biz: new Set<string>(), tables: new Set<string>() }; e.biz.add(x.biz); e.tables.add(table); seen.set(x.id, e); }
        cursor = r.cursor;
        if (r.done) break;
      }
    }
    const single: Array<{ id: Id<"_storage">; biz: Id<"businesses">; table: string }> = [];
    const conflicts: OwnersReport["conflicts"] = [];
    for (const [id, e] of seen) {
      if (e.biz.size === 1) single.push({ id: id as Id<"_storage">, biz: [...e.biz][0] as Id<"businesses">, table: [...e.tables][0] });
      else conflicts.push({ fileId: id, businesses: [...e.biz], tables: [...e.tables] });
    }
    let recorded = 0, already = 0;
    for (let k = 0; k < single.length; k += 100) {
      const r: { recorded: number; already: number } = await ctx.runMutation(internal.migrations.ownersRecord, { files: single.slice(k, k + 100) });
      recorded += r.recorded; already += r.already;
    }
    return { recorded, already, missing, conflicts };
  },
});
