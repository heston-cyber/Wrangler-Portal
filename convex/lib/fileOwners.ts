// Review fix (Phase 5e independent review, Nov 6; Heston "approved"): which business each stored file belongs to.
// Convex storage has no owner, and a storage id passed in by a caller used to be trusted as-is, so one business (or a
// team member) holding another's file id could read it, attach it or get it deleted. Now:
//   - a file id a caller hands in is claimed: the first time it's seen it must be a fresh upload (stored in the last
//     30 minutes) and it's recorded as the caller's business's; after that only that business may use it;
//   - a file the server stores itself is recorded as its business's;
//   - a file is deleted only by the business that owns it, and a refused upload is deleted only when it is the caller's
//     own fresh upload, never a file already in use.
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { GenericDatabaseReader, GenericDatabaseWriter } from "convex/server";
import type { DataModel } from "../_generated/dataModel";

export const FRESH_MS = 30 * 60_000;
type R = { db: GenericDatabaseReader<DataModel> };
type W = { db: GenericDatabaseWriter<DataModel>; storage: { delete: (id: Id<"_storage">) => Promise<void> } };

export const NOT_YOURS = "That file isn't one of yours. Upload it again.";

async function rowOf(ctx: R, id: Id<"_storage">) {
  return ctx.db.query("fileOwners").withIndex("by_storage", (q) => q.eq("storageId", id)).first();
}

/** A file id a caller handed in: theirs, or refused. `fresh` is true when this call is the first to see it. */
export async function claimUpload(ctx: W, id: Id<"_storage">, businessId: Id<"businesses"> | null, purpose: string, userId?: Id<"users"> | null): Promise<{ fresh: boolean }> {
  if (!businessId) throw new ConvexError(NOT_YOURS);
  const row = await rowOf(ctx, id);
  if (row) {
    if (row.businessId !== businessId) throw new ConvexError(NOT_YOURS);
    // Second 5e review (W-9 check): a tax form is only ever used as a tax form, even inside its own business.
    if ((row.purpose === "w9") !== (purpose === "w9")) throw new ConvexError(NOT_YOURS);
    return { fresh: false };
  }
  const meta = await ctx.db.system.get(id);
  if (!meta) throw new ConvexError("The upload didn't arrive. Try again.");
  if (Date.now() - meta._creationTime > FRESH_MS) throw new ConvexError(NOT_YOURS);
  await ctx.db.insert("fileOwners", { storageId: id, businessId, ...(userId ? { userId } : {}), purpose, at: Date.now() });
  return { fresh: true };
}

/** Has any business claimed this file? (Checked across businesses: the table is global.) */
export async function isClaimed(ctx: R, id: Id<"_storage">) {
  return !!(await rowOf(ctx, id));
}

/** Does this business own the file? (Files the portal stored before Nov 6 were recorded by the backfill.) */
export async function ownsFile(ctx: R, id: Id<"_storage">, businessId: Id<"businesses"> | null) {
  if (!businessId) return false;
  return (await rowOf(ctx, id))?.businessId === businessId;
}

/** A file the server stored for a business. */
export async function recordFile(ctx: W, id: Id<"_storage">, businessId: Id<"businesses"> | null, purpose: string) {
  if (!businessId || (await rowOf(ctx, id))) return;
  await ctx.db.insert("fileOwners", { storageId: id, businessId, purpose, at: Date.now() });
}

/** Delete a file, only if this business owns it. Returns whether it was deleted. */
export async function deleteFile(ctx: W, id: Id<"_storage"> | null | undefined, businessId: Id<"businesses"> | null): Promise<boolean> {
  if (!id || !businessId) return false;
  const row = await rowOf(ctx, id);
  if (!row || row.businessId !== businessId) return false;
  try { await ctx.storage.delete(id); } catch { /* gone already */ }
  await ctx.db.delete(row._id);
  return true;
}

/** A refused upload: deleted only when it was this call's own fresh upload. */
export async function discardFresh(ctx: W, id: Id<"_storage">, claim: { fresh: boolean }, businessId: Id<"businesses"> | null) {
  if (claim.fresh) await deleteFile(ctx, id, businessId);
}

/** The image files a document style points at (its logo, cover and backdrop image). */
export function styleFileIds(style: unknown): string[] {
  const x = style as Record<string, { fileId?: unknown } | null | undefined> | null | undefined;
  const out: string[] = [];
  for (const k of ["logo", "cover", "backdropImage"]) { const f = x?.[k]?.fileId; if (typeof f === "string" && f) out.push(f); }
  return out;
}

/** Second 5e review (Nov 10): a style a caller saves may point only at this business's own images. An image the saved
 *  style already had is let through unchanged (so a save between the deploy and the owner backfill doesn't fail). */
export async function assertStyleFiles(ctx: R, style: unknown, before: unknown, businessId: Id<"businesses"> | null) {
  const had = new Set(styleFileIds(before));
  for (const f of styleFileIds(style)) {
    if (had.has(f)) continue;
    const id = ctx.db.system.normalizeId("_storage", f);
    if (!id || !(await ownsFile(ctx, id, businessId))) throw new ConvexError(NOT_YOURS);
  }
}

/** A file id from a stored record, as a storage id, only when this business owns it (for reads that hand out a link). */
export async function ownedOrNull(ctx: R, f: string | null | undefined, businessId: Id<"businesses"> | null | undefined): Promise<Id<"_storage"> | null> {
  if (!f || !businessId) return null;
  const id = ctx.db.system.normalizeId("_storage", f);
  return id && (await ownsFile(ctx, id, businessId)) ? id : null;
}
