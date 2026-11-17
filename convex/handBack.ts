// Q2 (Heston, Nov 17, "go with your suggestions"): handing the phone back after a release signed in person asks for the
// owner: Face ID or the phone's passcode (a passkey, passkeys.ts) or their 4-digit PIN. Hand over locks this sign-in
// (lib/sessionLock.ts; viewerOf answers nothing for it, in any tab) until one of them unlocks it. Five wrong PINs sign
// the session out (the owner signs in again with their password). Review H1: the lock stays as a "signed out" mark, and
// a session whose row is gone answers nothing (lib/sessionLock.ts), so the phone can't come back as the owner on its
// still-valid token. Review L5: the PIN's hash is keyed with a server secret that isn't in exports.
import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireOwner } from "./lib/access";
import { lockOf } from "./lib/sessionLock";
import { randomToken, sha256Hex } from "./lib/hash";

type Ctx = QueryCtx | MutationCtx;
export const PIN_TRIES = 5;
const CHALLENGE_MS = 5 * 60_000;
const pepper = () => process.env.HANDBACK_PEPPER || process.env.JWT_PRIVATE_KEY || "";
const pinHash = async (salt: string, pin: string) => sha256Hex(`wp-handback:${await sha256Hex(pepper())}:${salt}:${pin}`);
const rowOf = (ctx: Ctx, userId: Id<"users">) => ctx.db.query("handBack").withIndex("by_user", (q) => q.eq("userId", userId)).first();

/** The owner's hand-back setup: is there a PIN, and how many passkeys (never the PIN or keys themselves). */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireOwner(ctx);
    const r = await rowOf(ctx, me.userId);
    return { pin: !!r?.pinHash, passkeys: (r?.passkeys ?? []).map((k) => ({ id: k.id, device: k.device, at: k.at })) };
  },
});

/** Set (or change) the 4-digit PIN. */
export const setPin = mutation({
  args: { pin: v.string() },
  handler: async (ctx, { pin }) => {
    const me = await requireOwner(ctx);
    if (!/^\d{4}$/.test(pin)) throw new ConvexError("The PIN is 4 digits.");
    const salt = randomToken(16);
    const hash = await pinHash(salt, pin);
    const r = await rowOf(ctx, me.userId);
    if (r) await ctx.db.patch(r._id, { pinSalt: salt, pinHash: hash, updatedAt: Date.now() });
    else await ctx.db.insert("handBack", { userId: me.userId, pinSalt: salt, pinHash: hash, passkeys: [], updatedAt: Date.now() });
    return null;
  },
});

/** Take a passkey off (a lost phone). */
export const removePasskey = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const me = await requireOwner(ctx);
    const r = await rowOf(ctx, me.userId);
    if (r) await ctx.db.patch(r._id, { passkeys: r.passkeys.filter((k) => k.id !== id), updatedAt: Date.now() });
    return null;
  },
});

/** Called by releases.handOver: lock this sign-in. A PIN must be set first, so the owner can always get back in. */
export async function lockForRelease(ctx: MutationCtx, userId: Id<"users">, releaseId: Id<"releases">) {
  const sessionId = await getAuthSessionId(ctx);
  if (!sessionId) throw new ConvexError("Sign in first.");
  const r = await rowOf(ctx, userId);
  if (!r?.pinHash) throw new ConvexError("Set your hand-back PIN first.");
  for (const old of await ctx.db.query("sessionLocks").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).collect()) await ctx.db.delete(old._id);
  await ctx.db.insert("sessionLocks", { sessionId, userId, releaseId, tries: 0, at: Date.now() });
}

/** Hand back with the PIN. Wrong: tries left; the fifth wrong one signs this session out. */
export const unlockWithPin = mutation({
  args: { pin: v.string() },
  handler: async (ctx, { pin }): Promise<{ ok: true } | { ok: false; left: number } | { ok: false; signedOut: true }> => {
    const lock = await liveLock(ctx);
    const r = await rowOf(ctx, lock.userId);
    if (r?.pinHash && r.pinSalt && /^\d{4}$/.test(pin) && (await pinHash(r.pinSalt, pin)) === r.pinHash) {
      await ctx.db.delete(lock._id);
      return { ok: true };
    }
    const tries = lock.tries + 1;
    if (tries >= PIN_TRIES) { await signOutLocked(ctx, lock); return { ok: false, signedOut: true }; }
    await ctx.db.patch(lock._id, { tries });
    return { ok: false, left: PIN_TRIES - tries };
  },
});

/** The caller's own lock, still handed over (not one already signed out). */
async function liveLock(ctx: Ctx) {
  const lock = await lockOf(ctx);
  if (!lock || lock.signedOut || lock.userId !== (await getAuthUserId(ctx))) throw new ConvexError("Not allowed.");
  return lock;
}

/** Too many wrong tries: this session (only) is signed out; its lock stays, marked, until the token can't be used. */
async function signOutLocked(ctx: MutationCtx, lock: Doc<"sessionLocks">) {
  await ctx.db.patch(lock._id, { signedOut: true, tries: PIN_TRIES, challenge: undefined });
  for (const t of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", lock.sessionId)).collect()) await ctx.db.delete(t._id);
  if (await ctx.db.get(lock.sessionId)) await ctx.db.delete(lock.sessionId);
  for (const d of await ctx.db.query("sessionDevices").withIndex("by_session", (q) => q.eq("sessionId", lock.sessionId)).collect()) await ctx.db.delete(d._id);
}

// ---------- for passkeys.ts (its Node actions run these with the caller's sign-in) ----------

/** Adding a passkey: the owner (unlocked), their name for the device prompt, and the keys they already have. */
export const forRegister = internalQuery({
  args: {},
  handler: async (ctx) => {
    const me = await requireOwner(ctx);
    const r = await rowOf(ctx, me.userId);
    return { userId: me.userId, email: me.email, name: me.name, have: (r?.passkeys ?? []).map((k) => ({ id: k.id, transports: k.transports })) };
  },
});
export const saveChallenge = internalMutation({
  args: { value: v.string() },
  handler: async (ctx, { value }) => {
    const me = await requireOwner(ctx);
    const r = await rowOf(ctx, me.userId);
    if (r) await ctx.db.patch(r._id, { challenge: { value, at: Date.now() }, updatedAt: Date.now() });
    else await ctx.db.insert("handBack", { userId: me.userId, passkeys: [], challenge: { value, at: Date.now() }, updatedAt: Date.now() });
    return null;
  },
});
/** The waiting challenge, used once (it's cleared as it's read). */
export const takeChallenge = internalMutation({
  args: {},
  handler: async (ctx) => {
    const me = await requireOwner(ctx);
    const r = await rowOf(ctx, me.userId);
    const c = r?.challenge;
    if (r) await ctx.db.patch(r._id, { challenge: undefined });
    return c && Date.now() - c.at < CHALLENGE_MS ? c.value : null;
  },
});
export const addPasskey = internalMutation({
  args: { id: v.string(), publicKey: v.string(), counter: v.number(), transports: v.optional(v.array(v.string())), device: v.string() },
  handler: async (ctx, a) => {
    const me = await requireOwner(ctx);
    const r = await rowOf(ctx, me.userId);
    const key = { id: a.id, publicKey: a.publicKey, counter: a.counter, ...(a.transports ? { transports: a.transports.slice(0, 8) } : {}), device: a.device.slice(0, 40), at: Date.now() };
    if (!r) await ctx.db.insert("handBack", { userId: me.userId, passkeys: [key], updatedAt: Date.now() });
    else { if (r.passkeys.length >= 10) throw new ConvexError("Up to 10 passkeys."); await ctx.db.patch(r._id, { passkeys: [...r.passkeys.filter((k) => k.id !== a.id), key], updatedAt: Date.now() }); }
    return null;
  },
});

/** Unlocking with a passkey: the locked session's keys and a fresh challenge kept on the lock. */
export const lockKeys = internalQuery({
  args: {},
  handler: async (ctx) => {
    const lock = await liveLock(ctx);
    const r = await rowOf(ctx, lock.userId);
    return (r?.passkeys ?? []).map((k) => ({ id: k.id, publicKey: k.publicKey, counter: k.counter, transports: k.transports }));
  },
});
export const lockChallenge = internalMutation({
  args: { value: v.string() },
  handler: async (ctx, { value }) => {
    const lock = await liveLock(ctx);
    await ctx.db.patch(lock._id, { challenge: { value, at: Date.now() } });
    return null;
  },
});
export const takeLockChallenge = internalMutation({
  args: {},
  handler: async (ctx) => {
    const lock = await liveLock(ctx);
    const c = lock.challenge;
    await ctx.db.patch(lock._id, { challenge: undefined });
    return c && Date.now() - c.at < CHALLENGE_MS ? c.value : null;
  },
});
/** A passkey checked out: unlock, and keep its signature counter. */
export const unlockedByPasskey = internalMutation({
  args: { id: v.string(), counter: v.number() },
  handler: async (ctx, a) => {
    const lock = await liveLock(ctx);
    const r = await rowOf(ctx, lock.userId);
    if (!r?.passkeys.some((k) => k.id === a.id)) throw new ConvexError("Not allowed.");
    await ctx.db.patch(r._id, { passkeys: r.passkeys.map((k) => (k.id === a.id ? { ...k, counter: a.counter } : k)), updatedAt: Date.now() });
    await ctx.db.delete(lock._id);
    return null;
  },
});

/** Review L3: daily, marks and locks whose session has ended and whose token can no longer be used are cleared. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = Date.now() - 3 * 3_600_000; // tokens live an hour; a margin
    let n = 0;
    for (const l of await ctx.db.query("sessionLocks").collect()) if (l.at < old && !(await ctx.db.get(l.sessionId))) { await ctx.db.delete(l._id); n++; }
    return n;
  },
});
