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
  only: Id<"businesses"> | null;          // step 6: set once a share or link is resolved; then only its business
  isOwner: boolean;
  defaultBiz: Id<"businesses"> | null;
};

/** Who is calling and which businesses they may see. Reads only global tables (users, memberships, businesses). */
export async function scopeFor(ctx: QueryCtx | MutationCtx): Promise<Scope> {
  const defaultBiz = (await defaultBusiness(ctx))?._id ?? null;
  const scope: Scope = { owner: null, members: new Set(), pin: null, only: null, isOwner: false, defaultBiz };
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
  if (scope.only) return b === scope.only;
  if (b && scope.members.has(b)) return true;
  if (scope.pin === null) { scope.pin = b; return true; }
  return b === scope.pin;
}

/** The business a new record made by this caller belongs to. */
// Step 6: a non-owner's new record belongs to the share or link they're acting through. With none resolved yet,
// a client of exactly one business stamps that one; anything else is ambiguous and refused (never the default).
export function stampFor(scope: Scope): Id<"businesses"> | null {
  if (scope.isOwner) return scope.owner;
  if (scope.only) return scope.only;
  if (scope.pin) return scope.pin;
  if (scope.members.size === 1) return [...scope.members][0] as Id<"businesses">;
  return null;
}

/**
 * Step 6: narrow a non-owner caller to one business, once the share or link they came through is known. After this
 * the call sees only that business, even when the caller is a client of others too, and anything it writes or
 * schedules belongs to it. Owners are already scoped to their own business; trusted server code (no scope) is left alone.
 */
export function focusBusiness(ctx: object, businessId: Id<"businesses"> | undefined | null) {
  const scope = (ctx as { scope?: Scope | null }).scope;
  if (!scope || scope.isOwner) return;
  const b = businessId ?? scope.defaultBiz;
  if (!b) return;
  if (scope.only && scope.only !== b) throw new Error("Already acting for another business.");
  scope.only = b;
  scope.pin = scope.pin ?? b;
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

/**
 * Step 5: the client record a project or share names (matched by name, ignoring case, within the business; made if
 * there isn't one, marked fromProjects so it doesn't show as a separate "New client"). Returns its id.
 */
export async function linkClient(db: MutationCtx["db"], businessId: Id<"businesses"> | null | undefined, name: string): Promise<Id<"clients"> | undefined> {
  const n = name.trim();
  if (!n) return undefined;
  const key = n.toLowerCase();
  const rows = (await db.query("clients").collect()).filter((c) => !businessId || c.businessId === undefined || c.businessId === businessId);
  const found = rows.find((c) => c.name.trim().toLowerCase() === key);
  if (found) return found._id;
  return await db.insert("clients", { name: n, createdAt: Date.now(), fromProjects: true, ...(businessId ? { businessId } : {}) });
}

/** Wraps a writer so new business records get a businessId, and projects and shares stay linked to their client. */
export function stampingDb(db: MutationCtx["db"], businessId: () => Promise<Id<"businesses"> | null>): MutationCtx["db"] {
  const withClient = async (table: string, doc: Record<string, unknown>, biz: Id<"businesses"> | null | undefined) => {
    const names = table === "projects" || (table === "shares" && doc.kind === "client");
    if (!names || !("client" in doc)) return doc;
    const name = typeof doc.client === "string" ? doc.client : "";
    return { ...doc, clientId: name.trim() ? await linkClient(db, biz, name) : undefined };
  };
  const insert = (async (table: string, doc: Record<string, unknown>) => {
    let d = doc;
    if (BUSINESS_TABLES.includes(table) && d.businessId === undefined) {
      const b = await businessId();
      if (b) d = { ...d, businessId: b };
    }
    d = await withClient(table, d, d.businessId as Id<"businesses"> | undefined);
    return db.insert(table as never, d as never);
  }) as MutationCtx["db"]["insert"];
  const patch = (async (a0: unknown, a1: unknown, a2?: unknown) => {
    // Both forms: patch(id, value) and patch(table, id, value).
    const [table, id, value] = a2 === undefined ? [null, a0, a1] : [a0 as string, a1, a2];
    const v0 = value as Record<string, unknown>;
    if (v0 && "client" in v0) {
      const t = table ?? (db.normalizeId("projects", id as string) ? "projects" : db.normalizeId("shares", id as string) ? "shares" : null);
      if (t === "projects" || t === "shares") {
        const cur = (await db.get(id as never)) as Record<string, unknown> | null;
        if (cur) {
          const next = await withClient(t, { ...cur, ...v0 }, cur.businessId as Id<"businesses"> | undefined);
          const v1 = "clientId" in next ? { ...v0, clientId: next.clientId } : v0;
          return table ? db.patch(table as never, id as never, v1 as never) : db.patch(id as never, v1 as never);
        }
      }
    }
    return table ? db.patch(table as never, id as never, value as never) : db.patch(id as never, value as never);
  }) as MutationCtx["db"]["patch"];
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "insert") return insert;
      if (prop === "patch") return patch;
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
  return { owner: biz, members: new Set(), pin: null, only: null, isOwner: true, defaultBiz };
}

// Step 4: trusted server code (crons, the Claude connectors, signing links) says which business it's acting for by
// passing `asBusiness`. Every internal function accepts it; inside, that function then sees only that business, and
// anything it runs or schedules carries the business along.
const asBusinessArg = { asBusiness: v.optional(v.id("businesses")) };
const withBiz = (args: unknown, biz: Id<"businesses"> | null | undefined) =>
  biz ? { ...((args as Record<string, unknown>) ?? {}), asBusiness: biz } : args;

type Scheduler = MutationCtx["scheduler"];
// Step 6: the business can be decided when the job is scheduled (a function), not when the call starts, so a guest's
// job belongs to the share they reached during the call.
type BizSource = Id<"businesses"> | null | undefined | (() => Id<"businesses"> | null | undefined);
function carryingScheduler(s: Scheduler, src: BizSource): Scheduler {
  if (!src) return s;
  const biz = () => (typeof src === "function" ? src() : src);
  return new Proxy(s, {
    get(target, prop, receiver) {
      if (prop === "runAfter") return ((d: number, f: never, a?: unknown) => target.runAfter(d, f, withBiz(a, biz()) as never)) as Scheduler["runAfter"];
      if (prop === "runAt") return ((d: number | Date, f: never, a?: unknown) => target.runAt(d, f, withBiz(a, biz()) as never)) as Scheduler["runAt"];
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
  const stamp = async () => {
    const b = stampFor(scope);
    if (b) return b;
    if (scope.isOwner || (!scope.members.size && !scope.pin)) return await defaultStamp(ctx); // nobody, nothing reached yet
    throw new Error("Which business this belongs to isn't clear.");
  };
  return { db: stampingDb(guarded, stamp), scope, scheduler: carryingScheduler(ctx.scheduler, () => stampFor(scope)) };
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
    const stamp = async () => {
      const b = stampFor(scope);
      if (b) return b;
      if (scope.isOwner || (!scope.members.size && !scope.pin)) return await defaultStamp(ctx);
      throw new Error("Which business this belongs to isn't clear.");
    };
    return { ctx: { db: stampingDb(guarded, stamp), scheduler: carryingScheduler(ctx.scheduler, () => stampFor(scope)), scope: scope as Scope | null, asBusiness }, args: {} };
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
