// Phase 8b (Heston, Nov 18, D208/D209): the connector runs a site function as the business owner (lib/siteActions.ts
// lists which, lib/siteGuard.ts watches what it would send). Called only by the connector (portalMcp.ts), always with
// the key's business as asBusiness (lib/mcpServer.ts forBusiness). The site function's own wrapper then sees exactly
// what the owner signed in would: only that business, through the same row-level guard.
import { v, ConvexError } from "convex/values";
import { internalMutation as rawInternalMutation, internalQuery as rawInternalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ACTIONS, argsOf, type Entry } from "./lib/siteActions";
import { argsProblem, asUser, ownerUserOf, recording, scrub, summarize, type Outbound } from "./lib/siteGuard";
import { viewerOf } from "./lib/access";
import { scopeFor } from "./lib/functions";
import { BUSINESS_TABLES } from "./lib/tenancy";
import { defaultBusiness } from "./lib/business";

/** Re-review Med-1: the state-aware checks read records before the site function's own scoping, so they run only when
 *  every record the arguments name is this business's (otherwise the site function itself refuses, as for any id). */
async function allMine(ctx: QueryCtx | MutationCtx, biz: Id<"businesses">, x: unknown, depth = 0): Promise<boolean> {
  if (depth > 5) return true;
  if (typeof x === "string") {
    const dflt = (await defaultBusiness(ctx))?._id ?? null;
    for (const t of BUSINESS_TABLES) {
      const id = ctx.db.normalizeId(t as never, x);
      if (!id) continue;
      const d = (await ctx.db.get(id)) as { businessId?: Id<"businesses"> } | null;
      return !d || (d.businessId ?? dflt) === biz;
    }
    return true;
  }
  if (Array.isArray(x)) { for (const y of x) if (!(await allMine(ctx, biz, y, depth + 1))) return false; return true; }
  if (x && typeof x === "object") { for (const y of Object.values(x)) if (!(await allMine(ctx, biz, y, depth + 1))) return false; }
  return true;
}
/** 8c review M1 / re-review N1, N2, L-a, L-b: while a send Heston confirmed is going out (confirmed and not yet
 *  started, or started and not yet reported back), nothing of THIS business's that it uses can be changed through the
 *  connector, so what goes out is what he saw. Only this business's requests and records are compared, by id. */
const MAX_IDS = 200;
async function ownIds(ctx: QueryCtx | MutationCtx, biz: Id<"businesses">, x: unknown, out = new Set<string>(), depth = 0): Promise<Set<string>> {
  if (depth > 5 || out.size > MAX_IDS) return out;
  if (typeof x === "string") {
    const dflt = (await defaultBusiness(ctx))?._id ?? null;
    for (const t of BUSINESS_TABLES) {
      const id = ctx.db.normalizeId(t as never, x);
      if (!id) continue;
      const d = (await ctx.db.get(id)) as { businessId?: Id<"businesses"> } | null;
      if (d && (d.businessId ?? dflt) === biz) out.add(id);
      break;
    }
  } else if (Array.isArray(x)) { for (const y of x) await ownIds(ctx, biz, y, out, depth + 1); }
  else if (x && typeof x === "object") { for (const y of Object.values(x)) await ownIds(ctx, biz, y, out, depth + 1); }
  return out;
}
async function locked(ctx: QueryCtx | MutationCtx, biz: Id<"businesses">, a: unknown): Promise<boolean> {
  const mine = await ownIds(ctx, biz, a);
  if (!mine.size) return false;
  const now = Date.now(), dflt = (await defaultBusiness(ctx))?._id ?? null;
  // Second re-review L2: newest first, and only this business's, so no pile of old rows hides a send going out now.
  const rows = (await ctx.db.query("pendingActions").withIndex("by_status", (q) => q.eq("status", "running").gt("requestedAt", now - 2 * 86_400_000)).order("desc").take(500))
    .filter((r) => (r.businessId ?? dflt) === biz && (r.claimedAt ? r.claimedAt > now - 60 * 60_000 : (r.doneAt ?? 0) > now - 2 * 60_000));
  // L3: a change naming more records than can be compared waits while anything is going out.
  if (rows.length && mine.size > MAX_IDS) return true;
  for (const r of rows) {
    let used: unknown = null;
    try { used = (JSON.parse(r.payload ?? "{}") as { args?: unknown }).args; } catch { /* not a site request */ }
    for (const id of await ownIds(ctx, biz, used)) if (mine.has(id)) return true;
  }
  return false;
}
const BUSY = "A send Heston just confirmed uses this. Try again in a minute, once it has gone out.";
const outsideOf = async (ctx: QueryCtx | MutationCtx, biz: Id<"businesses">, act: Entry, a: Record<string, unknown>) =>
  act.askWhen?.(a) ?? (act.outside && (await allMine(ctx, biz, a)) ? await act.outside(ctx as QueryCtx, a) : null);

const runArgs = { asBusiness: v.optional(v.id("businesses")), action: v.string(), args: v.any() };

/** The action, its arguments checked as Convex would, and a context signed in as the key's business's owner. */
async function prepare<C extends QueryCtx | MutationCtx>(ctx: C, biz: Id<"businesses"> | undefined, action: string, args: unknown, fits: (e: Entry) => string | null) {
  if (!biz) throw new ConvexError("The connector has no business here.");
  const act: Entry | undefined = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!act) throw new ConvexError(`There's no action called ${action}. site_actions lists them.`);
  const wrong = fits(act);
  if (wrong) throw new ConvexError(wrong);
  const a = (args ?? {}) as Record<string, unknown>;
  const problem = argsProblem(argsOf(action), a, "args", (table, id) => !!(table.startsWith("_") ? ctx.db.system.normalizeId(table as never, id) : ctx.db.normalizeId(table as never, id)));
  if (problem) throw new ConvexError(`${problem}. site_actions shows ${action}'s arguments.`);
  const no = act.refuse?.(a);
  if (no) throw new ConvexError(no);
  const as = asUser(ctx, await ownerUserOf(ctx, biz));
  // The site's own checks must see the owner of THIS business, or nothing runs.
  const who = await viewerOf(as);
  const scope = await scopeFor(as);
  if (who.kind !== "owner" || who.businessId !== biz || scope.owner !== biz) throw new ConvexError("The connector can't act as this business's owner.");
  return { act, a, as };
}

/** The owner's view of anything (clipped; W-9s, tax IDs, bank details and secrets never leave). */
export const read = rawInternalQuery({
  args: runArgs,
  handler: async (ctx, x) => {
    const { act, a, as } = await prepare(ctx, x.asBusiness, x.action, x.args, (e) => (e.mode !== "read" || !e.fn.isQuery ? `${x.action} changes things: use site_change or site_ask.` : null));
    return scrub(await act.fn._handler(as, a), act.hide);
  },
});

/**
 * A change, made directly. If it would send anything to anyone, it's undone (the whole run) and Claude is told what it
 * would have sent, so it can ask Heston.
 */
export const change = rawInternalMutation({
  args: runArgs,
  handler: async (ctx, x) => {
    const { act, a, as } = await prepare(ctx, x.asBusiness, x.action, x.args, (e) => (e.mode !== "change" || !e.fn.isMutation ? (e.mode === "read" ? `${x.action} only reads: use site_read.` : `${x.action} needs Heston: ask him, then site_ask.`) : null));
    if (await locked(ctx, x.asBusiness!, a)) throw new ConvexError(BUSY);
    const why = await outsideOf(as, x.asBusiness!, act, a);
    if (why) throw new ConvexError(`${why} Ask Heston, then site_ask.`);
    const seen: Outbound[] = [];
    const result = await act.fn._handler(recording(as as MutationCtx, seen), a);
    if (seen.length) throw new ConvexError({ blocked: true, outbound: summarize(seen) });
    return scrub(result ?? null, act.hide);
  },
});

/** An ask, tried once and undone: what it would send (who, and what). Always throws: `{ tried: true, outbound }` when it
 *  would work, or the site's own error when it can't be done. */
export const tryOut = rawInternalMutation({
  args: runArgs,
  handler: async (ctx, x) => {
    const { act, a, as } = await prepare(ctx, x.asBusiness, x.action, x.args, (e) => (e.mode === "read" ? `${x.action} only reads: use site_read.` : e.onPage || !e.fn.isMutation ? `${x.action} runs from Heston's Confirm page.` : null));
    const seen: Outbound[] = [];
    if (await locked(ctx, x.asBusiness!, a)) throw new ConvexError(BUSY);
    const why = await outsideOf(as, x.asBusiness!, act, a);
    await act.fn._handler(recording(as as MutationCtx, seen), a);
    throw new ConvexError({ tried: true, outbound: summarize(seen), ...(why ? { why } : {}) });
  },
});

/** Phase 8c: an ask that runs from Heston's Confirm page (it talks to Stripe): its arguments and the owner checked, as
 *  for any other; nothing is tried. */
export const checkOnPage = rawInternalQuery({
  args: runArgs,
  handler: async (ctx, x) => {
    await prepare(ctx, x.asBusiness, x.action, x.args, (e) => (!e.onPage || !e.fn.isAction || !e.shows ? `${x.action} isn't run from the Confirm page.` : null));
    return true;
  },
});
