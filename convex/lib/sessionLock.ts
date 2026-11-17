// Q2 (Heston, Nov 17): a sign-in handed over for a release in person stays locked until the owner hands it back.
import { getAuthSessionId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";

/** This caller's session lock, if their phone is handed over (read straight from the session, never via viewerOf). */
export async function lockOf(ctx: QueryCtx | MutationCtx) {
  const sessionId = await getAuthSessionId(ctx);
  if (!sessionId) return null;
  return await ctx.db.query("sessionLocks").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).first();
}
