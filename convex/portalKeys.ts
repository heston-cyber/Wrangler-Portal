// Phase 8a (Heston, Nov 18, D207: "Business only can have Claude key"): the keys of the one Wrangler Portal connector
// (<convex site>/portal-mcp). Only the business's owner makes, sees and revokes them; a team member can't. A key acts
// for its own business only (lib/mcpServer.ts forBusiness). Stored only as a SHA-256 hash; the key is shown once.
import { action } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { requireOwner } from "./lib/access";
import { allowedEmails } from "./lib/owners";
import { defaultBusiness } from "./lib/business";
import { base64url, sha256Hex } from "./lib/hash";
import { audit } from "./lib/audit";

export const KEY_PREFIX = "wp_";

/** The owner only (not a team member, client or vendor). */
export const ownerCheck = internalQuery({ args: {}, handler: async (ctx) => { await requireOwner(ctx); return null; } });

/** 8d: how long a key works: 30 or 90 days, a year, or until revoked (null). */
const daysArg = v.optional(v.union(v.literal(30), v.literal(90), v.literal(365), v.null()));

export const createKey = action({
  args: { label: v.optional(v.string()), days: daysArg },
  handler: async (ctx, a): Promise<{ key: string; prefix: string }> => {
    await ctx.runQuery(internal.portalKeys.ownerCheck, {});
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const key = KEY_PREFIX + base64url(bytes);
    const prefix = key.slice(0, 10);
    await ctx.runMutation(internal.portalKeys.insertKey, { hash: await sha256Hex(key), prefix, label: (a.label ?? "").trim().slice(0, 60) || "Claude", days: a.days ?? null });
    return { key, prefix };
  },
});

export const insertKey = internalMutation({
  args: { hash: v.string(), prefix: v.string(), label: v.string(), days: v.union(v.literal(30), v.literal(90), v.literal(365), v.null()) },
  handler: async (ctx, a) => {
    const me = await requireOwner(ctx); // the same caller as createKey: the row is stamped with the owner's business
    const now = Date.now();
    await ctx.db.insert("portalKeys", { hash: a.hash, prefix: a.prefix, label: a.label, createdAt: now, madeBy: me.userId, ...(a.days ? { expiresAt: now + a.days * 86_400_000 } : {}) });
    await audit(ctx, { kind: "settings", text: `made a Claude connector key (${a.prefix}…)${a.days ? `, working ${a.days === 365 ? "a year" : `${a.days} days`}` : ", working until revoked"}`, where: "Settings › Claude connectors" });
  },
});

export const listKeys = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const keys = await ctx.db.query("portalKeys").collect();
    return keys.filter((k) => !k.revokedAt).sort((a, b) => b.createdAt - a.createdAt)
      .map((k) => ({ _id: k._id, prefix: k.prefix, label: k.label, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt ?? null, expiresAt: k.expiresAt ?? null,
        // 8d re-review R6: a key made before Nov 19 has no maker and no longer works.
        expired: (!!k.expiresAt && k.expiresAt <= Date.now()) || (!k.madeBy && !k.prefix.startsWith("wp_selftest")) }));
  },
});

export const revokeKey = mutation({
  args: { keyId: v.string() },
  handler: async (ctx, a) => {
    await requireOwner(ctx);
    const id = ctx.db.normalizeId("portalKeys", a.keyId);
    const k = id ? await ctx.db.get(id) : null; // another business's key is invisible here
    if (!k) throw new ConvexError("That key isn't here.");
    if (!k.revokedAt) {
      await ctx.db.patch(k._id, { revokedAt: Date.now() });
      await audit(ctx, { kind: "settings", text: `revoked a Claude connector key (${k.prefix}…)`, where: "Settings › Claude connectors" });
    }
    return null;
  },
});

/** Every connector request: is this key live, and for which business? Notes when it was last used (once a minute). */
export const checkKey = internalMutation({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const row = await ctx.db.query("portalKeys").withIndex("by_hash", (q) => q.eq("hash", hash)).unique();
    if (!row || row.revokedAt || !row.businessId) return false as const;
    const now = Date.now();
    if (row.expiresAt && row.expiresAt <= now) return false as const; // 8d: it ran out
    const biz = await ctx.db.get(row.businessId);
    if (!biz) return false as const; // a business that's gone
    // 8b review L8 / 8d review L3: the owner who made it must still own this business. Every key has its maker since
    // 8d (only the self-test's short-lived key has none).
    if (!row.madeBy) { if (!row.prefix.startsWith("wp_selftest")) return false as const; }
    else {
      const u = await ctx.db.get(row.madeBy);
      const email = u?.email?.toLowerCase();
      const dflt = await defaultBusiness(ctx);
      const owns = !!email && ((await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", email)).collect())
        .some((m) => m.businessId === row.businessId && m.role === "owner" && !m.revokedAt) || (allowedEmails().includes(email) && dflt?._id === row.businessId));
      if (!owns) return false as const;
    }
    if (!row.lastUsedAt || now - row.lastUsedAt > 60_000) await ctx.db.patch(row._id, { lastUsedAt: now });
    return { businessId: row.businessId };
  },
});

// For the live self-test and the tests only: a short-lived key for a named business.
export const insertTestKey = internalMutation({
  args: { hash: v.string(), businessId: v.id("businesses") },
  handler: async (ctx, a) => ctx.db.insert("portalKeys", { businessId: a.businessId, hash: a.hash, prefix: "wp_selftest", label: "Self-test (temporary)", createdAt: Date.now(), expiresAt: Date.now() + 15 * 60_000 }), // 8f review L5: runs out even if the test never cleans up
});
export const deleteKey = internalMutation({
  args: { keyId: v.id("portalKeys") },
  handler: async (ctx, { keyId }) => { await ctx.db.delete(keyId); },
});
