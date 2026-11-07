// Phase 5e step 4 (Nov 5): the notification centre (the bell beside Search, the See all page, Settings › Notifications'
// bell and phone switches). D146: the bell shows every kind; phone alerts start on for payments, signed contracts,
// accepted quotes and proposals and client messages; the feed is kept 90 days; alerts reach every device a person turns on.
// Who gets an item: the business owner, and each team member whose switches cover its kind (lib/bell.ts BELL_PERM).
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { viewerOf } from "./lib/access";
import { allowedEmails } from "./lib/owners";
import { defaultBusiness } from "./lib/business";
import { assignedOnly, cleanPerms, isTeamRole } from "./lib/perms";
import { BELL_KINDS, BELL_NAMES, BELL_PERM, PHONE_DEFAULT, type BellKind } from "./lib/bell";

export const KEEP_DAYS = 90;
const kindArg = v.union(...BELL_KINDS.map((k) => v.literal(k)));
type Ctx = QueryCtx | MutationCtx;

/** The owner or a team member (the bell is the back office's). */
async function me(ctx: Ctx) {
  const v = await viewerOf(ctx);
  if (v.kind === "owner" || v.kind === "team") return v;
  throw new ConvexError(v.kind === "nobody" && !(await getAuthUserId(ctx)) ? "Sign in first." : "Not allowed.");
}

async function prefsOf(ctx: Ctx, userId: Id<"users">) {
  const row = await ctx.db.query("alertPrefs").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  return { row, bellOff: new Set(row?.bellOff ?? []), phoneOn: new Set(row?.phoneOn ?? PHONE_DEFAULT) };
}

/** Who a business's items go to: its owners (memberships, and ALLOWED_EMAILS for the default business) and team members whose switches cover the kind. */
// D157: an Editor only hears about the projects they're assigned to, so an item reaches them only when it names one of those.
async function recipients(ctx: MutationCtx, businessId: Id<"businesses">, kind: BellKind, projectId?: Id<"projects">): Promise<Id<"users">[]> {
  const out = new Set<string>();
  const ms = (await ctx.db.query("memberships").withIndex("by_business_email", (q) => q.eq("businessId", businessId)).collect()).filter((m) => !m.revokedAt);
  const userOf = async (email: string, userId?: Id<"users">) => userId ?? (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).first())?._id;
  for (const m of ms.filter((x) => x.role === "owner")) { const u = await userOf(m.email, m.userId); if (u) out.add(u); }
  if ((await defaultBusiness(ctx))?._id === businessId) for (const e of allowedEmails()) { const u = await userOf(e); if (u) out.add(u); }
  const need = BELL_PERM[kind];
  if (need) for (const m of ms.filter((x) => x.role === "team" && x.userId && isTeamRole(x.teamRole))) {
    const perms = cleanPerms(m.teamRole as never, m.perms);
    if (!need.some((p) => perms[p])) continue;
    if (assignedOnly(m.teamRole as never)) {
      const mine = projectId && (await ctx.db.query("projectTeam").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect()).some((r) => r.userId === m.userId);
      if (!mine) continue;
    }
    out.add(m.userId!);
  }
  return [...out] as Id<"users">[];
}

/** Puts one event in the bell of everyone it's for, and sends a phone alert where they've switched that kind on. */
export const post = internalMutation({
  args: { businessId: v.optional(v.id("businesses")), kind: kindArg, title: v.string(), link: v.optional(v.string()), key: v.string(), projectId: v.optional(v.id("projects")) },
  handler: async (ctx, a) => {
    const now = Date.now();
    // 5e review H3 (Nov 6): an alert lands only in the business it's about. Without one it's dropped (and noted in the
    // log), never put in Wrangler's bell; only Site watch, which is about the portal itself, goes to the default business.
    const businessId = a.businessId ?? (a.kind === "sitewatch" ? (await defaultBusiness(ctx))?._id : undefined);
    if (!businessId) { console.warn(`bell: no business for ${a.kind} (${a.key.slice(0, 40)}); not posted`); return 0; }
    const head = `${(await ctx.db.get(businessId))?.name ?? "Wrangler Portal"} · ${BELL_NAMES[a.kind].label}`; // 824:21489
    let made = 0;
    for (const userId of await recipients(ctx, businessId, a.kind, a.projectId)) {
      const p = await prefsOf(ctx, userId);
      if (p.bellOff.has(a.kind)) continue;
      if (await ctx.db.query("bellItems").withIndex("by_user_key", (q) => q.eq("userId", userId).eq("key", a.key)).first()) continue;
      await ctx.db.insert("bellItems", { businessId, userId, kind: a.kind, title: a.title.slice(0, 160), ...(a.link ? { link: a.link } : {}), key: a.key, at: now });
      made++;
      if (p.phoneOn.has(a.kind) && (await ctx.db.query("pushSubs").withIndex("by_user", (q) => q.eq("userId", userId)).first())) {
        await ctx.scheduler.runAfter(0, internal.push.send, { userId, head, body: a.title.slice(0, 160), url: a.link ?? "/notifications", tag: a.key });
      }
    }
    return made;
  },
});

// ---------- the bell and the See all page ----------

/** The caller's feed, newest first: `limit` rows of the kinds asked for, with the unread count and the counts per kind. */
export const feed = query({
  args: { kinds: v.optional(v.array(kindArg)), limit: v.optional(v.number()) },
  handler: async (ctx, { kinds, limit }) => {
    const m = await me(ctx);
    const n = Math.max(1, Math.min(300, Math.round(limit ?? 30)));
    const all = await ctx.db.query("bellItems").withIndex("by_user_at", (q) => q.eq("userId", m.userId)).order("desc").take(1000);
    const counts: Record<string, number> = { all: all.length };
    for (const r of all) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    const want = kinds?.length ? new Set<string>(kinds) : null;
    const rows = all.filter((r) => !want || want.has(r.kind)).slice(0, n)
      .map((r) => ({ _id: r._id, kind: r.kind, title: r.title, link: r.link ?? null, at: r.at, unread: !r.readAt }));
    return { rows, counts, unread: all.filter((r) => !r.readAt).length, more: rows.length === n };
  },
});

/** The badge on the bell (9+ above nine). */
export const unread = query({
  args: {},
  handler: async (ctx) => {
    const m = await me(ctx);
    return (await ctx.db.query("bellItems").withIndex("by_user_at", (q) => q.eq("userId", m.userId)).order("desc").take(200)).filter((r) => !r.readAt).length;
  },
});

export const markRead = mutation({
  args: { itemId: v.id("bellItems") },
  handler: async (ctx, { itemId }) => {
    const m = await me(ctx);
    const r = await ctx.db.get(itemId);
    if (!r || r.userId !== m.userId) throw new ConvexError("That notification isn't yours.");
    if (!r.readAt) await ctx.db.patch(itemId, { readAt: Date.now() });
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const m = await me(ctx);
    const now = Date.now();
    for (const r of await ctx.db.query("bellItems").withIndex("by_user_at", (q) => q.eq("userId", m.userId)).collect()) if (!r.readAt) await ctx.db.patch(r._id, { readAt: now });
  },
});

// ---------- Settings › Notifications: the bell and phone switches, and this person's phones ----------

export const prefs = query({
  args: {},
  handler: async (ctx) => {
    const m = await me(ctx);
    const p = await prefsOf(ctx, m.userId);
    const subs = await ctx.db.query("pushSubs").withIndex("by_user", (q) => q.eq("userId", m.userId)).collect();
    // A team member only sees the kinds their switches cover.
    const kinds = BELL_KINDS.filter((k) => m.kind !== "team" || (BELL_PERM[k] ?? []).some((x) => m.team.perms[x]));
    return {
      kinds: kinds.map((k) => ({ kind: k, bell: !p.bellOff.has(k), phone: p.phoneOn.has(k) })),
      devices: subs.map((s) => ({ endpoint: s.endpoint, label: s.label, createdAt: s.createdAt })),
    };
  },
});

export const setPref = mutation({
  args: { kind: kindArg, bell: v.optional(v.boolean()), phone: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const m = await me(ctx);
    const p = await prefsOf(ctx, m.userId);
    if (a.bell !== undefined) { if (a.bell) p.bellOff.delete(a.kind); else p.bellOff.add(a.kind); }
    if (a.phone !== undefined) { if (a.phone) p.phoneOn.add(a.kind); else p.phoneOn.delete(a.kind); }
    const row = { bellOff: [...p.bellOff], phoneOn: [...p.phoneOn] };
    if (p.row) await ctx.db.patch(p.row._id, row); else await ctx.db.insert("alertPrefs", { userId: m.userId, ...row });
  },
});

/** "Turn all off": every phone switch off (the bell keeps showing them). */
export const phoneAllOff = mutation({
  args: {},
  handler: async (ctx) => {
    const m = await me(ctx);
    const p = await prefsOf(ctx, m.userId);
    if (p.row) await ctx.db.patch(p.row._id, { phoneOn: [] }); else await ctx.db.insert("alertPrefs", { userId: m.userId, bellOff: [], phoneOn: [] });
  },
});

const ENDPOINT = /^https:\/\/[^\s]{10,500}$/;
/** This phone turned alerts on: keep its Web Push address (one row per address; a new person on the same phone takes it over). */
export const subscribe = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string(), label: v.string() },
  handler: async (ctx, a) => {
    const m = await me(ctx);
    if (!ENDPOINT.test(a.endpoint) || a.p256dh.length > 200 || a.auth.length > 100) throw new ConvexError("That phone's alert address isn't valid.");
    const label = a.label.replace(/\s+/g, " ").trim().slice(0, 60) || "A phone";
    for (const s of await ctx.db.query("pushSubs").withIndex("by_endpoint", (q) => q.eq("endpoint", a.endpoint)).collect()) await ctx.db.delete(s._id);
    const mine = await ctx.db.query("pushSubs").withIndex("by_user", (q) => q.eq("userId", m.userId)).collect();
    if (mine.length >= 10) await ctx.db.delete(mine.sort((x, y) => x.createdAt - y.createdAt)[0]._id);
    await ctx.db.insert("pushSubs", { userId: m.userId, endpoint: a.endpoint, p256dh: a.p256dh, auth: a.auth, label, createdAt: Date.now() });
  },
});

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const m = await me(ctx);
    for (const s of await ctx.db.query("pushSubs").withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint)).collect()) if (s.userId === m.userId) await ctx.db.delete(s._id);
  },
});

/** The public half of the portal's Web Push key (null until the first phone asks; push.ensureKey makes it). */
export const pushKey = query({ args: {}, handler: async (ctx) => { await me(ctx); return (await ctx.db.query("pushKeys").first())?.publicKey ?? null; } });

// ---------- for push.ts (Node) and the daily purge ----------

/** push.ensureKey's check: the caller is the owner or a team member. */
export const canAlert = internalQuery({ args: {}, handler: async (ctx) => { const v = await viewerOf(ctx); return v.kind === "owner" || v.kind === "team"; } });
export const keyPair = internalQuery({ args: {}, handler: async (ctx) => { const k = await ctx.db.query("pushKeys").first(); return k ? { publicKey: k.publicKey, privateKey: k.privateKey } : null; } });
export const saveKeyPair = internalMutation({
  args: { publicKey: v.string(), privateKey: v.string() },
  handler: async (ctx, a) => { if (await ctx.db.query("pushKeys").first()) return; await ctx.db.insert("pushKeys", { ...a, createdAt: Date.now() }); },
});
export const subsOf = internalQuery({ args: { userId: v.id("users") }, handler: async (ctx, { userId }) => (await ctx.db.query("pushSubs").withIndex("by_user", (q) => q.eq("userId", userId)).collect()).map((s) => ({ _id: s._id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })) });
export const pushResult = internalMutation({
  args: { subId: v.id("pushSubs"), gone: v.boolean(), ok: v.boolean() },
  handler: async (ctx, { subId, gone, ok }) => {
    const s = await ctx.db.get(subId);
    if (!s) return;
    if (gone || (!ok && (s.fails ?? 0) >= 4)) await ctx.db.delete(subId);
    else await ctx.db.patch(subId, { fails: ok ? 0 : (s.fails ?? 0) + 1 });
  },
});
export const purge = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db.query("bellItems").withIndex("by_at", (q) => q.lt("at", Date.now() - KEEP_DAYS * 86_400_000)).take(500);
    for (const r of old) await ctx.db.delete(r._id);
    return old.length;
  },
});
export type BellItem = Doc<"bellItems">;
