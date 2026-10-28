// Waveform bookkeeping (the decoding itself is in waveform.ts, which runs in Node).
import { internalQuery, query } from "./_generated/server";
import { internalMutation } from "./lib/functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { accessToVersion, shareArg } from "./lib/viewer";

async function upsert(ctx: MutationCtx, versionId: Id<"versions">, patch: Record<string, unknown>) {
  const row = await ctx.db.query("waveforms").withIndex("by_version", (q) => q.eq("versionId", versionId)).first();
  if (row) { await ctx.db.patch(row._id, { ...patch, updatedAt: Date.now() }); return row.attempts; }
  await ctx.db.insert("waveforms", { versionId, status: "pending", attempts: 0, updatedAt: Date.now(), ...patch } as never);
  return 0;
}

export const markPending = internalMutation({
  args: { versionId: v.id("versions"), note: v.optional(v.string()) },
  handler: async (ctx, { versionId, note }) => { await upsert(ctx, versionId, { status: "pending", error: note }); },
});

export const begin = internalMutation({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    const row = await ctx.db.query("waveforms").withIndex("by_version", (q) => q.eq("versionId", versionId)).first();
    const attempts = (row?.attempts ?? 0) + 1;
    await upsert(ctx, versionId, { status: "running", attempts, error: undefined });
    return attempts;
  },
});

export const finish = internalMutation({
  args: { versionId: v.id("versions"), rate: v.number(), seconds: v.number(), peaks: v.bytes() },
  handler: async (ctx, { versionId, rate, seconds, peaks }) => {
    if (!(await ctx.db.get(versionId))) return; // deleted while decoding
    await upsert(ctx, versionId, { status: "done", rate, seconds, peaks, error: undefined });
  },
});

export const none = internalMutation({
  args: { versionId: v.id("versions"), reason: v.string() },
  handler: async (ctx, { versionId, reason }) => {
    if (!(await ctx.db.get(versionId))) return;
    await upsert(ctx, versionId, { status: "none", error: reason, peaks: undefined });
  },
});

export const fail = internalMutation({
  args: { versionId: v.id("versions"), error: v.string() },
  handler: async (ctx, { versionId, error }) => {
    if (!(await ctx.db.get(versionId))) return;
    await upsert(ctx, versionId, { status: "failed", error });
  },
});

// The review page's timeline.
export const forVersion = query({
  args: { versionId: v.id("versions"), share: shareArg },
  handler: async (ctx, { versionId, share }) => {
    await accessToVersion(ctx, versionId, share);
    const row = await ctx.db.query("waveforms").withIndex("by_version", (q) => q.eq("versionId", versionId)).first();
    if (!row) return null;
    return { status: row.status, rate: row.rate ?? null, seconds: row.seconds ?? null, peaks: row.status === "done" ? row.peaks ?? null : null };
  },
});

// Makes waveforms for ready versions that don't have one (or whose last try failed), a few seconds apart.
export const backfill = internalMutation({
  args: { retryFailed: v.optional(v.boolean()) },
  handler: async (ctx, { retryFailed }) => {
    let n = 0;
    for (const ver of await ctx.db.query("versions").collect()) {
      if (ver.status !== "ready") continue;
      const row = await ctx.db.query("waveforms").withIndex("by_version", (q) => q.eq("versionId", ver._id)).first();
      if (row && !(retryFailed && row.status === "failed")) continue;
      await upsert(ctx, ver._id, { status: "pending" });
      await ctx.scheduler.runAfter(n * 5_000, internal.waveform.run, { versionId: ver._id, attempt: 0 });
      n++;
    }
    return { scheduled: n };
  },
});

// For the CI check (public logs): counts and errors only.
export const summary = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("waveforms").collect();
    const by: Record<string, number> = {};
    for (const r of rows) by[r.status] = (by[r.status] ?? 0) + 1;
    return {
      byStatus: by,
      done: rows.filter((r) => r.status === "done").map((r) => ({ rate: r.rate, seconds: Math.round(r.seconds ?? 0), bytes: r.peaks?.byteLength ?? 0 })),
      errors: rows.filter((r) => r.error).map((r) => `${r.status}: ${r.error}`),
    };
  },
});
