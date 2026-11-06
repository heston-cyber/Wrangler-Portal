// Review fix (Nov 6): file ownership for actions (lib/fileOwners.ts). Each runs as the caller (or `asBusiness`), so the
// business is the caller's own.
import { v } from "convex/values";
import { internalMutation } from "./lib/functions";
import { businessInScope } from "./lib/business";
import { claimUpload, deleteFile, discardFresh, recordFile } from "./lib/fileOwners";
import type { MutationCtx } from "./_generated/server";

const W = (ctx: unknown) => ctx as MutationCtx;

export const claim = internalMutation({
  args: { storageId: v.id("_storage"), purpose: v.string(), businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, { storageId, purpose, businessId }) => claimUpload(W(ctx), storageId, businessInScope(ctx) ?? businessId ?? null, purpose),
});

export const record = internalMutation({
  args: { storageId: v.id("_storage"), purpose: v.string(), businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, { storageId, purpose, businessId }) => { await recordFile(W(ctx), storageId, businessInScope(ctx) ?? businessId ?? null, purpose); },
});

/** Throw away a refused upload: only the caller's own fresh one. */
export const discard = internalMutation({
  args: { storageId: v.id("_storage"), fresh: v.boolean() },
  handler: async (ctx, { storageId, fresh }) => { await discardFresh(W(ctx), storageId, { fresh }, businessInScope(ctx)); },
});

export const remove = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => deleteFile(W(ctx), storageId, businessInScope(ctx)),
});

// ---------- for actions ----------
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
type Act = { runMutation: (ref: any, args: any) => Promise<any> };
/** Claim a file id the caller handed to an action. */
export const claimIn = (ctx: Act, storageId: Id<"_storage">, purpose: string): Promise<{ fresh: boolean }> => ctx.runMutation(internal.fileOwners.claim, { storageId, purpose });
/** Record a file the action stored itself. */
export const recordIn = (ctx: Act, storageId: Id<"_storage">, purpose: string): Promise<void> => ctx.runMutation(internal.fileOwners.record, { storageId, purpose });
/** Throw away a refused upload (only the caller's own fresh one). */
export const discardIn = (ctx: Act, storageId: Id<"_storage">, claim: { fresh: boolean }): Promise<void> => ctx.runMutation(internal.fileOwners.discard, { storageId, fresh: claim.fresh });
/** Delete a file this business owns. */
export const removeIn = (ctx: Act, storageId: Id<"_storage">): Promise<boolean> => ctx.runMutation(internal.fileOwners.remove, { storageId });
