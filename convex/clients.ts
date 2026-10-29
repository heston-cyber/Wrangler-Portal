// Client accounts (client side C1, Oct 23). Owner only: invite an email, see and revoke invites. An invited email
// can then make an account on the sign-in page; everyone else is refused by auth.ts. Shares (C2) call invite too.
import { type MutationCtx } from "./_generated/server";
import { mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { requireMe, requireSignedIn } from "./lib/access";
import { allowedEmails } from "./auth";
import { prefsByEmail } from "./emails";
import { businessInScope, ensureMembership } from "./lib/business";

const cleanEmail = (e: string) => e.trim().toLowerCase();
const valid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

// Make sure an email is invited (an unrevoked invite exists). Returns the clean email and whether it was new.
export async function ensureInvite(ctx: MutationCtx, rawEmail: string, rawName?: string) {
  const email = cleanEmail(rawEmail);
  if (!valid(email)) throw new ConvexError("Enter a valid email.");
  if (allowedEmails().includes(email)) throw new ConvexError("That's an owner's email; it already has full access.");
  const ownsOne = (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", email)).collect()).some((m) => m.role === "owner" && !m.revokedAt);
  if (ownsOne) throw new ConvexError("That email runs a business here, so it can't be invited as a client.");
  const name = rawName?.trim().replace(/\s+/g, " ").slice(0, 60) || undefined;
  const existing = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()).find((i) => !i.revokedAt);
  if (existing) {
    if (name && name !== existing.name) await ctx.db.patch(existing._id, { name });
    return { inviteId: existing._id, email, name: existing.name ?? name, already: true };
  }
  const inviteId = await ctx.db.insert("invites", { email, name, createdAt: Date.now() });
  // Step 6: someone who already has an account (a client of another business) becomes a client of this one too.
  const biz = businessInScope(ctx);
  const user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).unique();
  if (biz && user) await ensureMembership(ctx, biz, email, "client", user._id);
  return { inviteId, email, name, already: false };
}

export const invite = mutation({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const r = await ensureInvite(ctx, a.email, a.name);
    return { inviteId: r.inviteId, already: r.already };
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    await requireMe(ctx);
    const inv = await ctx.db.get(inviteId);
    if (!inv || inv.revokedAt) return;
    await ctx.db.patch(inviteId, { revokedAt: Date.now() });
    // Step 6: and they're no longer a client of this business (other businesses' memberships stay).
    const biz = inv.businessId ?? businessInScope(ctx);
    for (const m of await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", inv.email)).collect())
      if (m.role === "client" && !m.revokedAt && m.businessId === biz) await ctx.db.patch(m._id, { revokedAt: Date.now() });
    // An account they already made keeps its role, but nothing is shared with a revoked email (C2 checks invites).
  },
});

export const listInvites = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const rows = await ctx.db.query("invites").collect();
    const prefs = await prefsByEmail(ctx, rows.map((i) => i.email));
    const out = [];
    for (const i of rows.sort((a, b) => b.createdAt - a.createdAt)) {
      const user = i.userId ? await ctx.db.get(i.userId) : null;
      out.push({
        _id: i._id, email: i.email, name: user?.name ?? i.name ?? null, createdAt: i.createdAt, revokedAt: i.revokedAt ?? null,
        acceptedAt: i.acceptedAt ?? null, lastSignInAt: user?.lastSignInAt ?? null,
        emails: prefs.get(i.email) ?? { versionsOff: false, repliesOff: false }, // C4: what they've switched off
      });
    }
    return out;
  },
});

// May this email make an account? Asked by the sign-up page before it tries, so the reason is plain when it can't
// (the auth error itself is redacted in production). Says only invited / not invited, nothing else.
export const canSignUp = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const e = cleanEmail(email);
    if (!valid(e)) return { ok: false, reason: "invalid" as const };
    if (allowedEmails().includes(e)) return { ok: true, reason: "owner" as const };
    const inv = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", e)).collect()).find((i) => !i.revokedAt);
    return inv ? { ok: true, reason: "invited" as const } : { ok: false, reason: "notInvited" as const };
  },
});

// A signed-in account's own details, for the account page (owner or client).
export const account = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    return { email: me.email, name: me.name, kind: me.kind };
  },
});

// ---------- Phase 1 (Oct 29): a client's people, the client page and the Clients list ----------
// Each person has a role ("Signs documents" or "Contact"). Portal access comes from their invite: not invited,
// invited on a date, or active once they've made an account.

type Access = { state: "none" } | { state: "invited"; at: number } | { state: "active"; since: number; lastSignInAt: number | null };

async function accessOf(ctx: { db: MutationCtx["db"] } | { db: import("./_generated/server").QueryCtx["db"] }, email: string): Promise<Access> {
  const inv = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()).find((i) => !i.revokedAt);
  if (!inv) return { state: "none" };
  const user = inv.userId ? await ctx.db.get(inv.userId) : await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).unique();
  if (inv.acceptedAt || user) return { state: "active", since: inv.acceptedAt ?? inv.createdAt, lastSignInAt: (user?.lastSignInAt as number | undefined) ?? null };
  return { state: "invited", at: inv.createdAt };
}

const roleArg = v.union(v.literal("signer"), v.literal("contact"));

export const people = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    await requireMe(ctx);
    if (!(await ctx.db.get(clientId))) return [];
    const rows = (await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", clientId)).collect()).filter((p) => !p.removedAt);
    const out = [];
    for (const p of rows.sort((a, b) => a.createdAt - b.createdAt)) out.push({ _id: p._id, email: p.email, name: p.name ?? null, role: p.role, access: await accessOf(ctx, p.email) });
    return out;
  },
});

export const addPerson = mutation({
  args: { clientId: v.id("clients"), email: v.string(), name: v.optional(v.string()), role: roleArg },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    if (!(await ctx.db.get(a.clientId))) throw new ConvexError("That client isn't here.");
    const email = cleanEmail(a.email);
    if (!valid(email)) throw new ConvexError("Enter a valid email.");
    if (allowedEmails().includes(email)) throw new ConvexError("That's an owner's email.");
    const name = a.name?.trim().replace(/\s+/g, " ").slice(0, 60) || undefined;
    const same = (await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", a.clientId)).collect()).find((p) => p.email === email);
    if (same && !same.removedAt) throw new ConvexError("That person is already on this client.");
    if (same) { await ctx.db.patch(same._id, { removedAt: undefined, name: name ?? same.name, role: a.role }); return same._id; }
    return await ctx.db.insert("clientPeople", { clientId: a.clientId, email, role: a.role, createdAt: Date.now(), ...(name ? { name } : {}) });
  },
});

export const updatePerson = mutation({
  args: { personId: v.id("clientPeople"), name: v.optional(v.string()), role: v.optional(roleArg) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const p = await ctx.db.get(a.personId);
    if (!p || p.removedAt) throw new ConvexError("That person isn't here.");
    const patch: Record<string, unknown> = {};
    if (a.name !== undefined) patch.name = a.name.trim().replace(/\s+/g, " ").slice(0, 60) || undefined;
    if (a.role) patch.role = a.role;
    await ctx.db.patch(a.personId, patch as never);
    return null;
  },
});

/** Takes the person off this client. Their portal access is separate (revoke the invite in Settings › Clients). */
export const removePerson = mutation({
  args: { personId: v.id("clientPeople") },
  handler: async (ctx, { personId }) => {
    await requireMe(ctx);
    const p = await ctx.db.get(personId);
    if (!p || p.removedAt) return null;
    await ctx.db.patch(personId, { removedAt: Date.now() });
    return null;
  },
});

/** "Invite to the portal" / "Resend invite": makes (or keeps) their invite. The invite email itself arrives with
 *  the Phase 1 emails (its design is still being approved); until then this records the invite only. */
export const invitePerson = mutation({
  args: { personId: v.id("clientPeople") },
  handler: async (ctx, { personId }) => {
    await requireMe(ctx);
    const p = await ctx.db.get(personId);
    if (!p || p.removedAt) throw new ConvexError("That person isn't here.");
    const r = await ensureInvite(ctx, p.email, p.name);
    return { already: r.already, emailed: false };
  },
});

/** The client page: who they are, their people, what's shared, their documents and Inbox counts. */
export const page = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    await requireMe(ctx);
    const client = await ctx.db.get(clientId);
    if (!client) return null;
    const people = (await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", clientId)).collect()).filter((p) => !p.removedAt);
    const projects = (await ctx.db.query("projects").collect()).filter((p) => p.clientId === clientId);
    const projectIds = new Set(projects.map((p) => p._id as string));
    const videos = (await ctx.db.query("videos").collect()).filter((x) => projectIds.has(x.projectId));
    const videoIds = new Set(videos.map((x) => x._id as string));
    const shares = (await ctx.db.query("shares").collect()).filter((s) =>
      (s.kind === "client" && s.clientId === clientId) || (s.kind === "project" && !!s.projectId && projectIds.has(s.projectId)) || (s.kind === "video" && !!s.videoId && videoIds.has(s.videoId)));
    const emails = new Set(people.map((p) => p.email));
    const docs = new Map<string, { _id: string; number: number; title: string; status: string; sentAt: number | null; completedAt: number | null }>();
    for (const e of emails) {
      for (const s of await ctx.db.query("wsSignings").withIndex("by_email", (q) => q.eq("email", e)).collect()) {
        const d = await ctx.db.get(s.documentId);
        if (d && !docs.has(d._id)) docs.set(d._id, { _id: d._id, number: d.number, title: d.title, status: d.status, sentAt: d.sentAt ?? null, completedAt: d.completedAt ?? null });
      }
    }
    const items = await ctx.db.query("inboxItems").withIndex("by_client", (q) => q.eq("clientId", clientId)).collect();
    return {
      client: { _id: client._id, name: client.name },
      people: await Promise.all(people.map(async (p) => ({ _id: p._id, email: p.email, name: p.name ?? null, role: p.role, access: await accessOf(ctx, p.email) }))),
      projects: projects.map((p) => ({ _id: p._id, name: p.name, jobNumber: p.jobNumber ?? null })),
      shares: shares.map((s) => ({ _id: s._id, kind: s.kind, who: s.who, access: s.access, off: !!s.offAt, expiresAt: s.expiresAt ?? null })),
      documents: [...docs.values()].sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0)),
      inbox: { items: items.length, unread: items.filter((i) => !i.readAt).length },
    };
  },
});

/** The Clients list: each client with its people and what's going on. */
export const directory = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const clients = await ctx.db.query("clients").collect();
    const people = (await ctx.db.query("clientPeople").collect()).filter((p) => !p.removedAt);
    const projects = await ctx.db.query("projects").collect();
    const out = [];
    for (const c of clients) {
      const mine = people.filter((p) => p.clientId === c._id);
      let active = 0;
      for (const p of mine) if ((await accessOf(ctx, p.email)).state === "active") active++;
      out.push({ _id: c._id, name: c.name, people: mine.length, active, projects: projects.filter((p) => p.clientId === c._id).length, fromProjects: !!c.fromProjects });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});
