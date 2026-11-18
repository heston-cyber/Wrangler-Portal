// Q2 (Heston, Nov 17): a sign-in handed over for a release in person stays locked until the owner hands it back.
// Review H1 (Nov 17): a sign-in is checked against its session row too, so a session signed out on the server (five
// wrong PINs, Sign out this device, a password change) stops answering at once, not when its token runs out.
import { getAuthSessionId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";

/** This caller's session lock, if their phone is handed over or was signed out after it (read straight from the session). */
export async function lockOf(ctx: QueryCtx | MutationCtx) {
  const sessionId = await getAuthSessionId(ctx);
  if (!sessionId) return null;
  return await ctx.db.query("sessionLocks").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).first();
}

/** True when this sign-in can't act: its session row is gone or expired, or the phone is handed over (or was signed out). */
export async function sessionBlocked(ctx: QueryCtx | MutationCtx): Promise<boolean> {
  const sessionId = await getAuthSessionId(ctx);
  if (!sessionId) return false; // no session in the token: getAuthUserId decides (signed out)
  const s = await ctx.db.get(sessionId);
  if (!s) return true; // ended on the server (expiry is the token's own business, and refresh's)
  return !!(await ctx.db.query("sessionLocks").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).first());
}
