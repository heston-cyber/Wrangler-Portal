// Phase 5e step 2 (Nov 5): Settings › Security for everyone who signs in (owner, team, clients, vendors; not call-sheet
// guests). Design Log › Phase 5e: Settings › Security 818:14727, Change password and Change email dialogs 842:10398 …,
// Sign-in › Too many tries 819:14019, emails 47, 50, 51; D145 (email and password, the code only at sign-up and reset),
// D146 (5 wrong tries), D158 (an email change moves the login and the person's contact rows, never signed documents),
// D159 (the owner may change theirs; ALLOWED_EMAILS is Heston's to update).
import { internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthSessionId, getAuthUserId, invalidateSessions, modifyAccountCredentials, retrieveAccount } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { viewerOf } from "./lib/access";
import { sha256Hex } from "./lib/hash";
import { sixDigits } from "./lib/email";
import { bumpDay } from "./lib/rate";
import { SITE } from "./lib/site";
import { TZ } from "./lib/gcal";
import { mailBrandOf } from "./lib/mail";
import { emailChangedMail, newDeviceMail, newEmailCodeMail, passwordChangedMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { allowedEmails } from "./lib/owners";
import { SIGN_IN_TRIES } from "./auth";
import { audit } from "./lib/audit";

type Ctx = QueryCtx | MutationCtx;
const CODE_MIN = 10;
const CODE_TRIES = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const when = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const codeHash = (userId: string, code: string) => sha256Hex(`email-change:${userId}:${code}`);

/** The signed-in person (owner, team member, client or vendor). A call-sheet guest or a removed team member is refused. */
async function whoAmI(ctx: Ctx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  const u = await ctx.db.get(userId);
  const email = (u?.email ?? "").toLowerCase();
  if (!u || !email || u.role === "guest") throw new ConvexError("Not allowed.");
  const v = await viewerOf(ctx);
  if (v.kind === "nobody") throw new ConvexError("Not allowed.");
  return { userId, email, name: (u.name as string | undefined) ?? null, kind: v.kind, user: u };
}

// ---------- the page ----------

/** Settings › Security (or a client's and vendor's Account): the password row, the email row, and their signed-in devices. */
export const state = query({
  args: {},
  handler: async (ctx) => {
    const me = await whoAmI(ctx);
    const current = await getAuthSessionId(ctx);
    const rows = await ctx.db.query("sessionDevices").withIndex("by_user", (q) => q.eq("userId", me.userId)).collect();
    const devices = [];
    for (const r of rows.sort((a, b) => b.lastSeen - a.lastSeen)) {
      if (!(await ctx.db.get(r.sessionId))) continue; // signed out or expired
      devices.push({ sessionId: r.sessionId, label: r.label, lastSeen: r.lastSeen, current: r.sessionId === current });
    }
    const pending = await ctx.db.query("emailChanges").withIndex("by_user", (q) => q.eq("userId", me.userId)).unique();
    return {
      email: me.email, passwordChangedAt: me.user.passwordChangedAt ?? me.user._creationTime, devices,
      pending: pending && pending.until > Date.now() ? { newEmail: pending.newEmail, until: pending.until } : null,
    };
  },
});

// ---------- password ----------

export const who = internalQuery({ args: {}, handler: async (ctx) => { const m = await whoAmI(ctx); return { userId: m.userId, email: m.email, name: m.name, kind: m.kind }; } });

/** Change password: the current one (wrong ones count toward the 5 tries), then a new one of 10+ characters. Other devices are signed out; email 51. */
export const changePassword = action({
  args: { current: v.string(), next: v.string() },
  handler: async (ctx, { current, next }): Promise<{ ok: true } | { error: "short" | "wrong" | "locked" | "same" }> => {
    const me: { userId: Id<"users">; email: string; name: string | null; kind: string } = await ctx.runQuery(internal.security.who, {});
    if (next.length < 10) return { error: "short" };
    if (next === current) return { error: "same" };
    try { await retrieveAccount(ctx, { provider: "password", account: { id: me.email, secret: current } }); }
    catch (e) { return { error: /TooManyFailedAttempts/.test(String((e as Error).message)) ? "locked" : "wrong" }; }
    await modifyAccountCredentials(ctx, { provider: "password", account: { id: me.email, secret: next } });
    const sessionId = await getAuthSessionId(ctx);
    await invalidateSessions(ctx, { userId: me.userId, except: sessionId ? [sessionId] : [] });
    const at = Date.now();
    await ctx.runMutation(internal.security.passwordChanged, { userId: me.userId, at });
    if (me.kind === "owner" || me.kind === "team") await ctx.runMutation(internal.auditLog.log, { kind: "signin", text: "changed their password", where: "Settings › Security" });
    const brand = await ctx.runQuery(internal.security.brand, {});
    await deliverOnce(ctx, `password-changed:${me.userId}:${at}`, "password_changed", me.email, passwordChangedMail(brand, { name: me.name, when: when(at), resetLink: `${SITE()}/?reset=${encodeURIComponent(me.email)}` }), brand.replyTo, null);
    return { ok: true };
  },
});
export const passwordChanged = internalMutation({
  args: { userId: v.id("users"), at: v.number() },
  handler: async (ctx, { userId, at }) => {
    await ctx.db.patch(userId, { passwordChangedAt: at });
    for (const r of await ctx.db.query("sessionDevices").withIndex("by_user", (q) => q.eq("userId", userId)).collect()) if (!(await ctx.db.get(r.sessionId))) await ctx.db.delete(r._id);
  },
});
export const brand = internalQuery({ args: {}, handler: async (ctx) => mailBrandOf(ctx, null) });

// ---------- the sign-in page: Too many tries ----------

/** Too many tries (D146): whether this email's password sign-in is resting, and for how long. Only says anything after 5 wrong tries. */
export const signInLocked = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) return { locked: false as const };
    const acct = await ctx.db.query("authAccounts").withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", e)).unique();
    if (!acct) return { locked: false as const };
    const lim = await ctx.db.query("authRateLimits").withIndex("identifier", (q) => q.eq("identifier", acct._id)).unique();
    if (!lim) return { locked: false as const };
    const perMs = SIGN_IN_TRIES / 3_600_000;
    const left = Math.min(SIGN_IN_TRIES, lim.attemptsLeft + (Date.now() - lim.lastAttemptTime) * perMs);
    if (left >= 1) return { locked: false as const };
    return { locked: true as const, minutes: Math.max(1, Math.ceil((1 - left) / perMs / 60_000)) };
  },
});

// ---------- email ----------

/** Change email, step 1: a 6-digit code to the new address (10 minutes). */
export const startEmailChange = mutation({
  args: { newEmail: v.string() },
  handler: async (ctx, { newEmail }) => {
    const me = await whoAmI(ctx);
    const e = newEmail.trim().toLowerCase();
    if (!EMAIL.test(e) || e.length > 200) throw new ConvexError("Enter a valid email.");
    if (e === me.email) throw new ConvexError("That's the email you use now.");
    if (await emailTaken(ctx, e)) throw new ConvexError("That email already has a portal login. Use another one.");
    await bumpDay(ctx, "emailChange", me.userId);
    const now = Date.now();
    const code = sixDigits();
    const row = await ctx.db.query("emailChanges").withIndex("by_user", (q) => q.eq("userId", me.userId)).unique();
    const fields = { newEmail: e, codeHash: await codeHash(me.userId, code), tries: 0, sentAt: now, until: now + CODE_MIN * 60_000 };
    if (row) await ctx.db.patch(row._id, fields); else await ctx.db.insert("emailChanges", { userId: me.userId, ...fields });
    await ctx.scheduler.runAfter(0, internal.security.codeMail, { userId: me.userId, to: e, code, at: now });
    return { ok: true as const, until: fields.until };
  },
});

async function emailTaken(ctx: Ctx, e: string) {
  if (allowedEmails().includes(e)) return true;
  if ((await ctx.db.query("users").withIndex("email", (q) => q.eq("email", e)).collect()).length) return true;
  return (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", e)).collect()).some((m) => !m.revokedAt);
}

/** Change email, step 2: the code. Five wrong codes and the change is cancelled. On the right one the login moves (D158). */
export const confirmEmailChange = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<{ ok: true; email: string } | { error: "expired" | "wrong" | "tooMany" | "taken" }> => {
    const me = await whoAmI(ctx);
    const row = await ctx.db.query("emailChanges").withIndex("by_user", (q) => q.eq("userId", me.userId)).unique();
    const now = Date.now();
    if (!row || row.until <= now) { if (row) await ctx.db.delete(row._id); return { error: "expired" }; }
    if ((await codeHash(me.userId, code.replace(/\D/g, ""))) !== row.codeHash) {
      if (row.tries + 1 >= CODE_TRIES) { await ctx.db.delete(row._id); return { error: "tooMany" }; }
      await ctx.db.patch(row._id, { tries: row.tries + 1 });
      return { error: "wrong" };
    }
    await ctx.db.delete(row._id);
    const old = me.email, next = row.newEmail;
    if (await emailTaken(ctx, next)) return { error: "taken" };
    // The login: the user, its password account (the account id is the email) and its memberships, all in this transaction.
    await ctx.db.patch(me.userId, { email: next });
    for (const a of await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", me.userId).eq("provider", "password")).collect()) await ctx.db.patch(a._id, { providerAccountId: next });
    for (const m of await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", old)).collect()) await ctx.db.patch(m._id, { email: next });
    // The person's rows in each business (trusted code: every business, not only the caller's), and email 50 to the old address.
    await ctx.scheduler.runAfter(0, internal.security.moveContacts, { old, next });
    if (me.kind === "owner" || me.kind === "team") await audit(ctx, { kind: "signin", text: `changed their sign-in email to ${next}`, where: "Settings › Security" });
    await ctx.scheduler.runAfter(0, internal.security.changedMail, { userId: me.userId, old, next, at: now });
    return { ok: true, email: next };
  },
});

/** Cancel a change still waiting for its code. */
export const cancelEmailChange = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await whoAmI(ctx);
    const row = await ctx.db.query("emailChanges").withIndex("by_user", (q) => q.eq("userId", me.userId)).unique();
    if (row) await ctx.db.delete(row._id);
  },
});

/**
 * D158: the person's contact rows follow the new email in every business: client people, vendor records, share invites,
 * portal and team invites, and their email switches. Signed documents, audit trails, invoices and sent emails keep the
 * address they were made with.
 */
export const moveContacts = internalMutation({
  args: { old: v.string(), next: v.string() },
  handler: async (ctx, { old, next }) => {
    let moved = 0;
    for (const r of await ctx.db.query("clientPeople").withIndex("by_email", (q) => q.eq("email", old)).collect()) { await ctx.db.patch(r._id, { email: next }); moved++; }
    for (const r of await ctx.db.query("vendors").withIndex("by_email", (q) => q.eq("email", old)).collect()) { await ctx.db.patch(r._id, { email: next }); moved++; }
    for (const r of await ctx.db.query("shareMembers").withIndex("by_email", (q) => q.eq("email", old)).collect()) { await ctx.db.patch(r._id, { email: next }); moved++; }
    for (const r of await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", old)).collect()) { await ctx.db.patch(r._id, { email: next }); moved++; }
    for (const r of await ctx.db.query("teamInvites").withIndex("by_email", (q) => q.eq("email", old)).collect()) { await ctx.db.patch(r._id, { email: next }); moved++; }
    for (const r of await ctx.db.query("emailPrefs").withIndex("by_email", (q) => q.eq("email", old)).collect()) { await ctx.db.patch(r._id, { email: next }); moved++; }
    return moved;
  },
});

export const codeMail = internalAction({
  args: { userId: v.id("users"), to: v.string(), code: v.string(), at: v.number() },
  handler: async (ctx, { userId, to, code, at }): Promise<void> => {
    const brand = await ctx.runQuery(internal.security.brand, {});
    await deliverOnce(ctx, `email-change-code:${userId}:${at}`, "code", to, newEmailCodeMail(brand, { code, minutes: CODE_MIN }), brand.replyTo, null);
  },
});
export const changedMail = internalAction({
  args: { userId: v.id("users"), old: v.string(), next: v.string(), at: v.number() },
  handler: async (ctx, { userId, old, next, at }): Promise<void> => {
    const brand = await ctx.runQuery(internal.security.brand, {});
    const name = await ctx.runQuery(internal.security.nameOf, { userId });
    await deliverOnce(ctx, `email-changed:${userId}:${at}`, "email_changed", old, emailChangedMail(brand, { name, when: when(at), old, next }), brand.replyTo, null);
  },
});
export const nameOf = internalQuery({ args: { userId: v.id("users") }, handler: async (ctx, { userId }) => ((await ctx.db.get(userId))?.name as string | undefined) ?? null });

// ---------- devices ----------

/** The page tells the server which browser this session is (once per session). A browser not seen before for an owner or a team member sends email 47. */
export const seenDevice = mutation({
  args: { deviceKey: v.string(), label: v.string() },
  handler: async (ctx, { deviceKey, label }) => {
    const me = await whoAmI(ctx);
    const sessionId = await getAuthSessionId(ctx);
    if (!sessionId || !/^[A-Za-z0-9_-]{16,64}$/.test(deviceKey)) return null;
    const lbl = label.replace(/\s+/g, " ").trim().slice(0, 60) || "A browser";
    const now = Date.now();
    const mine = await ctx.db.query("sessionDevices").withIndex("by_user", (q) => q.eq("userId", me.userId)).collect();
    const here = mine.find((r) => r.sessionId === sessionId);
    if (here) { if (now - here.lastSeen > 60_000) await ctx.db.patch(here._id, { lastSeen: now }); return null; }
    const known = mine.some((r) => r.deviceKey === deviceKey);
    await ctx.db.insert("sessionDevices", { userId: me.userId, sessionId, deviceKey, label: lbl, firstSeen: now, lastSeen: now });
    if (!known && mine.length > 0 && (me.kind === "owner" || me.kind === "team")) await audit(ctx, { kind: "signin", text: `signed in from a new device (${lbl})`, where: "Settings › Security" });
    if (!known && mine.length > 0 && (me.kind === "owner" || me.kind === "team")) await ctx.scheduler.runAfter(0, internal.security.deviceMail, { userId: me.userId, to: me.email, name: me.name, device: lbl, at: now });
    return null;
  },
});
export const deviceMail = internalAction({
  args: { userId: v.id("users"), to: v.string(), name: v.union(v.string(), v.null()), device: v.string(), at: v.number() },
  handler: async (ctx, a): Promise<void> => {
    const brand = await ctx.runQuery(internal.security.brand, {});
    await deliverOnce(ctx, `new-device:${a.userId}:${a.at}`, "new_device", a.to, newDeviceMail(brand, { name: a.name, when: when(a.at), device: a.device }), brand.replyTo, null);
  },
});

/** Sign one of your own devices out (not the one you're on: that's Sign out). */
export const signOutDevice = mutation({
  args: { sessionId: v.id("authSessions") },
  handler: async (ctx, { sessionId }) => {
    const me = await whoAmI(ctx);
    const row = await ctx.db.query("sessionDevices").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).unique();
    if (!row || row.userId !== me.userId) throw new ConvexError("That device isn't yours.");
    if (sessionId === (await getAuthSessionId(ctx))) throw new ConvexError("Use Sign out for this device.");
    const sess = await ctx.db.get(sessionId);
    if (sess && sess.userId === me.userId) {
      for (const t of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", sessionId)).collect()) await ctx.db.delete(t._id);
      await ctx.db.delete(sessionId);
    }
    await ctx.db.delete(row._id);
    return { ok: true as const };
  },
});
