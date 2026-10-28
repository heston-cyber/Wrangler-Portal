// Wrangler Portal, Phase 0.5d (Oct 28): the query and mutation builders every backend file uses.
//
// Step 2: a new record in a business-owned table (lib/tenancy.ts) gets its `businessId` filled in.
// Step 3: every PUBLIC query and mutation runs behind a database guard that only lets it see and change records of
// the caller's business:
//   - an owner (owner membership, or ALLOWED_EMAILS for Wrangler) sees only their own business;
//   - a signed-in client sees the businesses they're a client of;
//   - anyone else (a guest on a share link, a signer on a signing link) is pinned to the business of the first
//     record they reach (the share or signing link itself), and sees nothing of any other business.
// Records outside the scope are simply invisible (a lookup answers null, a list leaves them out), and changing one
// is refused. Internal functions are trusted server code: they keep plain access and stamp the default business.
// A record with no businessId (only in tests now: every live record is tagged) counts as the default business's.
import { customAction, customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { v } from "convex/values";
import { wrapDatabaseReader, wrapDatabaseWriter, type Rules } from "convex-helpers/server/rowLevelSecurity";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalAction as rawInternalAction, internalMutation as rawInternalMutation, internalQuery as rawInternalQuery, mutation as rawMutation, query as rawQuery, type ActionCtx, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { DataModel, Id } from "../_generated/dataModel";
import { defaultBusiness, ensureDefaultBusiness } from "./business";
import { allowedEmails } from "./owners";
import { BUSINESS_TABLES, INHERITED_TABLES } from "./tenancy";

export type Scope = {
  owner: Id<"businesses"> | null;        // an owner: exactly this business
  members: Set<string>;                   // a client: these businesses
  pin: Id<"businesses"> | null;           // anyone else: the first business they reach
  isOwner: boolean;
  defaultBiz: Id<"businesses"> | null;
};

/** Who is calling and which businesses they may see. Reads only global tables (users, memberships, businesses). */
export async function scopeFor(ctx: QueryCtx | MutationCtx): Promise<Scope> {
  const defaultBiz = (await defaultBusiness(ctx))?._id ?? null;
  const scope: Scope = { owner: null, members: new Set(), pin: null, isOwner: false, defaultBiz };
  const userId = await getAuthUserId(ctx);
  const user = userId ? await ctx.db.get(userId) : null;
  const email = (user?.email ?? "").toLowerCase();
  if (!email) return scope;
  const ms = (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", email)).collect()).filter((m) => !m.revokedAt);
  const ownerM = ms.filter((m) => m.role === "owner").sort((a, b) => a.createdAt - b.createdAt)[0];
  if (ownerM) { scope.owner = ownerM.businessId; scope.isOwner = true; return scope; }
  if (allowedEmails().includes(email)) { scope.owner = defaultBiz; scope.isOwner = true; return scope; }
  for (const m of ms) if (m.role === "client") scope.members.add(m.businessId);
  return scope;
}

export function allowed(scope: Scope, businessId: Id<"businesses"> | undefined | null): boolean {
  const b = businessId ?? scope.defaultBiz;
  if (scope.isOwner) return b === scope.owner;
  if (b && scope.members.has(b)) return true;
  if (scope.pin === null) { scope.pin = b; return true; }
  return b === scope.pin;
}

/** The business a new record made by this caller belongs to. */
export function stampFor(scope: Scope): Id<"businesses"> | null {
  if (scope.isOwner) return scope.owner;
  if (scope.pin) return scope.pin;
  if (scope.members.size === 1) return [...scope.members][0] as Id<"businesses">;
  return scope.defaultBiz;
}

function rulesFor(scope: Scope, raw: QueryCtx["db"]): Rules<unknown, DataModel> {
  const rules: Record<string, unknown> = {};
  const rule = async (_: unknown, doc: { businessId?: Id<"businesses"> }) => allowed(scope, doc.businessId);
  for (const t of BUSINESS_TABLES) rules[t] = { read: rule, modify: rule, insert: rule };
  // Wrangler Sign's audit trail belongs to its document's business.
  for (const t of INHERITED_TABLES) {
    const viaDoc = async (_: unknown, ev: { documentId: Id<"wsDocuments"> }) => allowed(scope, (await raw.get(ev.documentId))?.businessId);
    rules[t] = { read: viaDoc, modify: viaDoc, insert: viaDoc };
  }
  return rules as Rules<unknown, DataModel>;
}

/** Wraps a writer so new business records get a businessId. */
export function stampingDb(db: MutationCtx["db"], businessId: () => Promise<Id<"businesses"> | null>): MutationCtx["db"] {
  const insert = (async (table: string, doc: Record<string, unknown>) => {
    if (BUSINESS_TABLES.includes(table) && doc.businessId === undefined) {
      const b = await businessId();
      if (b) return db.insert(table as never, { ...doc, businessId: b } as never);
    }
    return db.insert(table as never, doc as never);
  }) as MutationCtx["db"]["insert"];
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "insert") return insert;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

async function defaultStamp(ctx: MutationCtx) {
  return (await defaultBusiness(ctx))?._id ?? (await ensureDefaultBusiness(ctx)).businessId;
}

/** An owner's view of one business: used when trusted server code acts for a business (asBusiness). */
function ownerScope(biz: Id<"businesses">, defaultBiz: Id<"businesses"> | null): Scope {
  return { owner: biz, members: new Set(), pin: null, isOwner: true, defaultBiz };
}

// Step 4: trusted server code (crons, the Claude connectors, signing links) says which business it's acting for by
// passing `asBusiness`. Every internal function accepts it; inside, that function then sees only that business, and
// anything it runs or schedules carries the business along.
const asBusinessArg = { asBusiness: v.optional(v.id("businesses")) };
const withBiz = (args: unknown, biz: Id<"businesses"> | null | undefined) =>
  biz ? { ...((args as Record<string, unknown>) ?? {}), asBusiness: biz } : args;

type Scheduler = MutationCtx["scheduler"];
function carryingScheduler(s: Scheduler, biz: Id<"businesses"> | null | undefined): Scheduler {
  if (!biz) return s;
  return new Proxy(s, {
    get(target, prop, receiver) {
      if (prop === "runAfter") return ((d: number, f: never, a?: unknown) => target.runAfter(d, f, withBiz(a, biz) as never)) as Scheduler["runAfter"];
      if (prop === "runAt") return ((d: number | Date, f: never, a?: unknown) => target.runAt(d, f, withBiz(a, biz) as never)) as Scheduler["runAt"];
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/** An action context whose runQuery / runMutation / runAction / scheduler all act for this business. */
export function forBusiness<C extends ActionCtx>(ctx: C, biz: Id<"businesses"> | null | undefined): C {
  if (!biz) return ctx;
  return new Proxy(ctx, {
    get(target, prop, receiver) {
      if (prop === "runQuery") return ((f: never, a?: unknown) => target.runQuery(f, withBiz(a, biz) as never)) as ActionCtx["runQuery"];
      if (prop === "runMutation") return ((f: never, a?: unknown) => target.runMutation(f, withBiz(a, biz) as never)) as ActionCtx["runMutation"];
      if (prop === "runAction") return ((f: never, a?: unknown) => target.runAction(f, withBiz(a, biz) as never)) as ActionCtx["runAction"];
      if (prop === "scheduler") return carryingScheduler(target.scheduler, biz);
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

export const query = customQuery(rawQuery, customCtx(async (ctx: QueryCtx) => {
  const scope = await scopeFor(ctx);
  return { db: wrapDatabaseReader(ctx, ctx.db, rulesFor(scope, ctx.db)), scope };
}));

export const mutation = customMutation(rawMutation, customCtx(async (ctx: MutationCtx) => {
  if (!(await defaultBusiness(ctx))) await ensureDefaultBusiness(ctx); // first ever write (tests, a fresh deployment)
  const scope = await scopeFor(ctx);
  const guarded = wrapDatabaseWriter(ctx, ctx.db, rulesFor(scope, ctx.db)) as unknown as MutationCtx["db"];
  const stamp = async () => stampFor(scope) ?? (await defaultStamp(ctx));
  return { db: stampingDb(guarded, stamp), scope, scheduler: carryingScheduler(ctx.scheduler, stampFor(scope)) };
}));

// Internal functions. Called from an action on behalf of a signed-in person (Convex passes their sign-in along), they
// get the same guard as a public function. Called with `asBusiness` (trusted server code acting for a business),
// they see only that business. Called with neither (the old way, still used by a few background jobs), they're
// trusted server code with plain access, stamping the default business.
export const internalQuery = customQuery(rawInternalQuery, {
  args: asBusinessArg,
  input: async (ctx: QueryCtx, { asBusiness }: { asBusiness?: Id<"businesses"> }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity && !asBusiness) return { ctx: { db: ctx.db, scope: null as Scope | null, asBusiness }, args: {} };
    const scope = identity ? await scopeFor(ctx) : ownerScope(asBusiness!, (await defaultBusiness(ctx))?._id ?? null);
    return { ctx: { db: wrapDatabaseReader(ctx, ctx.db, rulesFor(scope, ctx.db)), scope, asBusiness }, args: {} };
  },
});

export const internalMutation = customMutation(rawInternalMutation, {
  args: asBusinessArg,
  input: async (ctx: MutationCtx, { asBusiness }: { asBusiness?: Id<"businesses"> }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity && !asBusiness) return { ctx: { db: stampingDb(ctx.db, () => defaultStamp(ctx)), scheduler: ctx.scheduler, scope: null as Scope | null, asBusiness }, args: {} };
    if (!(await defaultBusiness(ctx))) await ensureDefaultBusiness(ctx);
    const scope = identity ? await scopeFor(ctx) : ownerScope(asBusiness!, (await defaultBusiness(ctx))?._id ?? null);
    const guarded = wrapDatabaseWriter(ctx, ctx.db, rulesFor(scope, ctx.db)) as unknown as MutationCtx["db"];
    return { ctx: { db: stampingDb(guarded, async () => stampFor(scope) ?? (await defaultStamp(ctx))), scheduler: carryingScheduler(ctx.scheduler, stampFor(scope)), scope: scope as Scope | null, asBusiness }, args: {} };
  },
});

export const internalAction = customAction(rawInternalAction, {
  args: asBusinessArg,
  input: async (ctx: ActionCtx, { asBusiness }: { asBusiness?: Id<"businesses"> }) => {
    const s = forBusiness(ctx, asBusiness); // no business: the same context, unchanged
    // ctx.asBusiness: the business this run acts for (undefined when it acts for none in particular).
    return { ctx: { runQuery: s.runQuery, runMutation: s.runMutation, runAction: s.runAction, scheduler: s.scheduler, asBusiness }, args: {} };
  },
});
