// Wrangler Portal, Phase 0.5d step 2 (Oct 28): the mutation builders every backend file uses.
// They're Convex's own `mutation` / `internalMutation` with one addition: a new record in a business-owned table
// (lib/tenancy.ts) gets its `businessId` filled in, so no function can forget it. In this step every record belongs
// to the default business (Wrangler Productions); step 3 takes the business from the signed-in person or the parent
// record and refuses anything across businesses.
import { customCtx, customMutation } from "convex-helpers/server/customFunctions";
import { internalMutation as rawInternalMutation, mutation as rawMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { defaultBusiness, ensureDefaultBusiness } from "./business";
import { isBusinessTable } from "./tenancy";

export function stampingDb(ctx: MutationCtx): MutationCtx["db"] {
  const db = ctx.db;
  let biz: Id<"businesses"> | null = null;
  const businessId = async () => {
    if (biz) return biz;
    biz = (await defaultBusiness(ctx))?._id ?? (await ensureDefaultBusiness(ctx)).businessId;
    return biz;
  };
  const insert = (async (table: string, doc: Record<string, unknown>) => {
    if (isBusinessTable(table) && doc.businessId === undefined) return db.insert(table as never, { ...doc, businessId: await businessId() } as never);
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

const stamping = customCtx(async (ctx: MutationCtx) => ({ db: stampingDb(ctx) }));
export const mutation = customMutation(rawMutation, stamping);
export const internalMutation = customMutation(rawInternalMutation, stamping);
