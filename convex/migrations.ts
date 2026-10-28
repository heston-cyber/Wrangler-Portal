// Wrangler Portal, Phase 0.5d step 2 (Oct 28): tag every existing record with its business.
// Internal only, run by hand through the "Convex run" workflow (practice on the dev copy first, then live on
// Heston's OK). Output is counts only: the repo and its CI logs are public. Safe to run again: rows that already
// have a business are left alone, and nothing else on a row changes.
import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./lib/functions";
import { internal } from "./_generated/api";
import { BUSINESS_TABLES } from "./lib/tenancy";
import { defaultBusiness } from "./lib/business";

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
