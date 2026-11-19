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
    return scrub(await act.fn._handler(as, a));
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
    const why = act.askWhen?.(a);
    if (why) throw new ConvexError(`${why} Ask Heston, then site_ask.`);
    const seen: Outbound[] = [];
    const result = await act.fn._handler(recording(as as MutationCtx, seen), a);
    if (seen.length) throw new ConvexError({ blocked: true, outbound: summarize(seen) });
    return scrub(result ?? null);
  },
});

/** An ask, tried once and undone: what it would send (who, and what). Always throws: `{ tried: true, outbound }` when it
 *  would work, or the site's own error when it can't be done. */
export const tryOut = rawInternalMutation({
  args: runArgs,
  handler: async (ctx, x) => {
    const { act, a, as } = await prepare(ctx, x.asBusiness, x.action, x.args, (e) => (e.mode === "read" || !e.fn.isMutation ? `${x.action} only reads: use site_read.` : null));
    const seen: Outbound[] = [];
    await act.fn._handler(recording(as as MutationCtx, seen), a);
    throw new ConvexError({ tried: true, outbound: summarize(seen) });
  },
});
