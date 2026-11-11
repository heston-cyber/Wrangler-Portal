// Phase 5e step 1 (Nov 5): team members (Design Log, Phase 5e › Settings › Team, Member page and Roles, Team dialogs,
// Join the team, email 46; D146). The owner invites someone by email with a role; the invite link lasts 14 days; the
// invitee sets a name and password on the Join page and confirms their email with the 6-digit code (auth.ts), which
// makes their team membership. Each role has switches (lib/perms.ts); a member's own switches start from their role's.
// Everything here is the owner's: team members can't see or change the team.
//
// Memberships are global rows (not filtered by business like business records), so every function that takes one checks
// it belongs to the caller's business by hand (mine()).
import { internalAction, internalQuery, mutation, query } from "./lib/functions";
import { audit } from "./lib/audit";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe, requireOwner } from "./lib/access";
import { businessInScope } from "./lib/business";
import { randomToken, sha256Hex } from "./lib/hash";
import { SITE } from "./lib/site";
import { TZ } from "./lib/gcal";
import { mailBrandOf } from "./lib/mail";
import { teamInviteMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { allowedEmails } from "./lib/owners";
import { bumpDay } from "./lib/rate";
import { LOCKED_OFF, PERMS, PERM_NAMES, ROLE_NAMES, SUGGESTED, TEAM_ROLES, cleanPerms, rolePerms, type Perm, type TeamRole } from "./lib/perms";

const DAY = 86_400_000;
export const INVITE_DAYS = 14; // D146
const roleArg = v.union(v.literal("producer"), v.literal("editor"), v.literal("bookkeeper"));
const permArg = v.union(...PERMS.map((p) => v.literal(p)));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
type Ctx = QueryCtx | MutationCtx;

const lockedText = (role: TeamRole) => (role === "editor" ? "Editors work in Review on their assigned projects only." : "That switch can't be turned on for this role.");
const tokenHash = (token: string) => sha256Hex(`team-invite:${token}`);
const untilText = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });

function myBusiness(ctx: Ctx): Id<"businesses"> {
  const b = businessInScope(ctx);
  if (!b) throw new ConvexError("Not allowed.");
  return b;
}

/** A team membership of the caller's business, or a refusal (memberships aren't filtered by business). */
async function mine(ctx: Ctx, membershipId: Id<"memberships">): Promise<Doc<"memberships"> & { teamRole: TeamRole }> {
  const m = await ctx.db.get(membershipId);
  if (!m || m.revokedAt || m.role !== "team" || m.businessId !== myBusiness(ctx) || !m.teamRole) throw new ConvexError("That person isn't on your team.");
  return m as Doc<"memberships"> & { teamRole: TeamRole };
}

async function teamRows(ctx: Ctx, biz: Id<"businesses">) {
  return (await ctx.db.query("memberships").withIndex("by_business_email", (q) => q.eq("businessId", biz)).collect())
    .filter((m) => !m.revokedAt && m.role === "team" && m.teamRole) as Array<Doc<"memberships"> & { teamRole: TeamRole }>;
}

async function personOf(ctx: Ctx, m: Doc<"memberships">) {
  const u = m.userId ? await ctx.db.get(m.userId) : null;
  return { name: (u?.name as string | undefined) || m.email, lastSignedIn: u?.lastSignInAt ?? null };
}

/** Every session of a login (taking someone off the team signs them out everywhere). */
async function endSessions(ctx: MutationCtx, userId: Id<"users">) {
  for (const sess of await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect()) {
    for (const t of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", sess._id)).collect()) await ctx.db.delete(t._id);
    await ctx.db.delete(sess._id);
  }
}

// ---------- Settings › Team ----------

/** Members, pending invites and the role switches. */
export const page = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const biz = myBusiness(ctx);
    const b = await ctx.db.get(biz);
    const now = Date.now();
    const members = await Promise.all((await teamRows(ctx, biz)).sort((a, z) => a.createdAt - z.createdAt).map(async (m) => {
      const p = await personOf(ctx, m);
      const assigned = m.userId ? (await ctx.db.query("projectTeam").withIndex("by_user", (q) => q.eq("userId", m.userId!)).collect()).length : 0;
      return { membershipId: m._id, email: m.email, name: p.name, role: m.teamRole, lastSignedIn: p.lastSignedIn, assigned, joinedAt: m.createdAt };
    }));
    const invites = (await ctx.db.query("teamInvites").withIndex("by_business", (q) => q.eq("businessId", biz)).collect())
      .filter((i) => !i.revokedAt && !i.acceptedAt).sort((a, z) => z.sentAt - a.sentAt)
      .map((i) => ({ inviteId: i._id, email: i.email, name: i.name ?? null, role: i.teamRole, sentAt: i.sentAt, expiresAt: i.expiresAt, expired: i.expiresAt <= now }));
    const roles = Object.fromEntries(TEAM_ROLES.map((r) => [r, rolePerms(b?.teamRoles, r)])) as Record<TeamRole, Record<Perm, boolean>>;
    return { members, invites, roles, locked: LOCKED_OFF };
  },
});

/** One member's page: their switches, what their role says, and the projects they're assigned to. */
export const member = query({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, { membershipId }) => {
    await requireOwner(ctx);
    const m = await mine(ctx, membershipId);
    const b = await ctx.db.get(m.businessId);
    const p = await personOf(ctx, m);
    const rows = m.userId ? await ctx.db.query("projectTeam").withIndex("by_user", (q) => q.eq("userId", m.userId!)).collect() : [];
    const projects = (await Promise.all(rows.map(async (r) => { const pr = await ctx.db.get(r.projectId); return pr ? { projectId: pr._id, name: pr.name } : null; }))).filter((x) => !!x);
    const role = rolePerms(b?.teamRoles, m.teamRole);
    const perms = cleanPerms(m.teamRole, m.perms);
    return { membershipId: m._id, email: m.email, name: p.name, role: m.teamRole, perms, rolePerms: role, matchesRole: PERMS.every((k) => perms[k] === role[k]), locked: LOCKED_OFF[m.teamRole], lastSignedIn: p.lastSignedIn, joinedAt: m.createdAt, invitedBy: m.invitedBy ?? null, projects };
  },
});

/** Invite a team member (email 46). Refused for someone already on the team, with a live invite, or with another kind of login. */
export const invite = mutation({
  args: { email: v.string(), name: v.optional(v.string()), role: roleArg },
  handler: async (ctx, { email, name, role }) => {
    const me = await requireOwner(ctx);
    const biz = myBusiness(ctx);
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e) || e.length > 200) throw new ConvexError("Enter a valid email.");
    await bumpDay(ctx, "teamInvite", biz);
    if (allowedEmails().includes(e)) return { error: "owner" as const };
    const ms = (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", e)).collect()).filter((m) => !m.revokedAt);
    if (ms.some((m) => m.role === "team" && m.businessId === biz)) return { error: "already" as const };
    // One login is one kind of person (Phase 5e): an owner, a client or vendor of any business, or another team, can't be added.
    if (ms.length) return { error: "otherLogin" as const };
    const users = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", e)).collect();
    if (users.some((u) => u.role && u.role !== "team" && u.role !== "guest")) return { error: "otherLogin" as const };
    const pending = (await ctx.db.query("teamInvites").withIndex("by_email", (q) => q.eq("email", e)).collect()).find((i) => !i.revokedAt && !i.acceptedAt && i.expiresAt > Date.now());
    if (pending && pending.businessId === biz) return { error: "pending" as const, inviteId: pending._id };
    if (pending) return { error: "otherLogin" as const }; // invited to another business's team
    const now = Date.now();
    const token = randomToken(24);
    const n = name?.trim().slice(0, 60) || undefined;
    const inviteId = await ctx.db.insert("teamInvites", { businessId: biz, email: e, ...(n ? { name: n } : {}), teamRole: role, tokenHash: await tokenHash(token), invitedBy: me.name, createdAt: now, sentAt: now, expiresAt: now + INVITE_DAYS * DAY });
    await ctx.scheduler.runAfter(0, internal.team.inviteMail, { inviteId, token, at: now });
    await audit(ctx, { kind: "team", text: `invited ${e} as ${ROLE_NAMES[role]}`, where: "Settings › Team", link: "/settings/team" });
    return { ok: true as const, inviteId };
  },
});

/** A new link (the old one stops working) and 14 more days. */
export const resendInvite = mutation({
  args: { inviteId: v.id("teamInvites") },
  handler: async (ctx, { inviteId }) => {
    await requireOwner(ctx);
    const i = await ctx.db.get(inviteId);
    if (!i || i.revokedAt || i.acceptedAt) throw new ConvexError("That invite isn't open any more.");
    await bumpDay(ctx, "teamInvite", myBusiness(ctx));
    const now = Date.now();
    const token = randomToken(24);
    await ctx.db.patch(inviteId, { tokenHash: await tokenHash(token), sentAt: now, expiresAt: now + INVITE_DAYS * DAY });
    await ctx.scheduler.runAfter(0, internal.team.inviteMail, { inviteId, token, at: now });
    await audit(ctx, { kind: "team", text: `sent the team invite to ${i.email} again`, where: "Settings › Team", link: "/settings/team" });
    return { ok: true as const };
  },
});

/** Cancel the invite: its link stops working. */
export const cancelInvite = mutation({
  args: { inviteId: v.id("teamInvites") },
  handler: async (ctx, { inviteId }) => {
    await requireOwner(ctx);
    const i = await ctx.db.get(inviteId);
    if (!i || i.acceptedAt) throw new ConvexError("That invite isn't open any more.");
    if (!i.revokedAt) await ctx.db.patch(inviteId, { revokedAt: Date.now() });
    await audit(ctx, { kind: "team", text: `cancelled the team invite to ${i.email}`, where: "Settings › Team", link: "/settings/team" });
    return { ok: true as const };
  },
});

/** Take someone off the team: they're signed out everywhere and can't sign in to this business; their past work stays. */
export const remove = mutation({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, { membershipId }) => {
    await requireOwner(ctx);
    const m = await mine(ctx, membershipId);
    await ctx.db.patch(m._id, { revokedAt: Date.now() });
    await audit(ctx, { kind: "team", text: `removed ${(await personOf(ctx, m)).name} from the team`, where: "Settings › Team", link: "/settings/team" });
    if (m.userId) {
      for (const r of await ctx.db.query("projectTeam").withIndex("by_user", (q) => q.eq("userId", m.userId!)).collect()) await ctx.db.delete(r._id);
      await endSessions(ctx, m.userId);
    }
    return { ok: true as const };
  },
});

/** The role pills on the Member page: the new role, with that role's switches. */
export const setRole = mutation({
  args: { membershipId: v.id("memberships"), role: roleArg },
  handler: async (ctx, { membershipId, role }) => {
    await requireOwner(ctx);
    const m = await mine(ctx, membershipId);
    const b = await ctx.db.get(m.businessId);
    await ctx.db.patch(m._id, { teamRole: role, perms: rolePerms(b?.teamRoles, role) });
    await audit(ctx, { kind: "team", text: `made ${(await personOf(ctx, m)).name} ${ROLE_NAMES[role] === "Editor" ? "an" : "a"} ${ROLE_NAMES[role]}`, where: "Settings › Team", link: "/settings/team" });
    // An Editor only sees assigned projects; a role that sees every project keeps its assignments (they show on the project).
    return { ok: true as const };
  },
});

/** One switch for one member. The locked ones (project value for Producer and Editor) can't be turned on. */
export const setPerm = mutation({
  args: { membershipId: v.id("memberships"), perm: permArg, on: v.boolean() },
  handler: async (ctx, { membershipId, perm, on }) => {
    await requireOwner(ctx);
    const m = await mine(ctx, membershipId);
    if (on && LOCKED_OFF[m.teamRole].includes(perm)) throw new ConvexError(lockedText(m.teamRole));
    await ctx.db.patch(m._id, { perms: { ...cleanPerms(m.teamRole, m.perms), [perm]: on } });
    await audit(ctx, { kind: "team", text: `turned ${PERM_NAMES[perm]} ${on ? "on" : "off"} for ${(await personOf(ctx, m)).name}`, where: "Settings › Team", link: "/settings/team" });
    return { ok: true as const };
  },
});

/** "Reset to the role": the member's switches become their role's again. */
export const resetToRole = mutation({
  args: { membershipId: v.id("memberships") },
  handler: async (ctx, { membershipId }) => {
    await requireOwner(ctx);
    const m = await mine(ctx, membershipId);
    const b = await ctx.db.get(m.businessId);
    await ctx.db.patch(m._id, { perms: rolePerms(b?.teamRoles, m.teamRole) });
    await audit(ctx, { kind: "team", text: `reset ${(await personOf(ctx, m)).name} to the ${ROLE_NAMES[m.teamRole]} switches`, where: "Settings › Team", link: "/settings/team" });
    return { ok: true as const };
  },
});

async function saveRoles(ctx: MutationCtx, biz: Id<"businesses">, roles: Record<TeamRole, Record<Perm, boolean>>, only?: TeamRole) {
  await ctx.db.patch(biz, { teamRoles: roles, updatedAt: Date.now() });
  // "Changes apply to everyone in that role."
  for (const m of await teamRows(ctx, biz)) if (!only || m.teamRole === only) await ctx.db.patch(m._id, { perms: roles[m.teamRole] });
}

/** One switch on the Roles card; applies to everyone in that role. */
export const setRolePerm = mutation({
  args: { role: roleArg, perm: permArg, on: v.boolean() },
  handler: async (ctx, { role, perm, on }) => {
    await requireOwner(ctx);
    if (on && LOCKED_OFF[role].includes(perm)) throw new ConvexError(lockedText(role));
    const biz = myBusiness(ctx);
    const b = await ctx.db.get(biz);
    const roles = Object.fromEntries(TEAM_ROLES.map((r) => [r, rolePerms(b?.teamRoles, r)])) as Record<TeamRole, Record<Perm, boolean>>;
    roles[role] = cleanPerms(role, { ...roles[role], [perm]: on });
    await saveRoles(ctx, biz, roles, role);
    await audit(ctx, { kind: "team", text: `turned ${PERM_NAMES[perm]} ${on ? "on" : "off"} for every ${ROLE_NAMES[role]}`, where: "Settings › Team", link: "/settings/team" });
    return { ok: true as const };
  },
});

/** "Reset all to suggested": every role's switches, and everyone's, back to the suggested ones. */
export const resetRoles = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    await audit(ctx, { kind: "team", text: "reset every role to the suggested switches", where: "Settings › Team", link: "/settings/team" });
    await saveRoles(ctx, myBusiness(ctx), { producer: { ...SUGGESTED.producer }, editor: { ...SUGGESTED.editor }, bookkeeper: { ...SUGGESTED.bookkeeper } });
    return { ok: true as const };
  },
});

// ---------- Project page › Assigned people ----------

/** Who is assigned to a project. Anyone who can open projects sees the list; only the owner can change it. */
export const projectPeople = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const me = await requireMe(ctx, "projects");
    const p = await ctx.db.get(projectId);
    if (!p) return null;
    if (me.team?.role === "editor") {
      const mineRow = (await ctx.db.query("projectTeam").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect()).some((r) => r.userId === me.userId);
      if (!mineRow) throw new ConvexError("Not allowed.");
    }
    const biz = myBusiness(ctx);
    const team = await teamRows(ctx, biz);
    const rows = await ctx.db.query("projectTeam").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect();
    const people = (await Promise.all(rows.map(async (r) => {
      const m = team.find((x) => x.userId === r.userId);
      if (!m) return null;
      return { userId: r.userId, name: (await personOf(ctx, m)).name, role: m.teamRole };
    }))).filter((x) => !!x);
    const canAssign = !me.team;
    const candidates = canAssign ? await Promise.all(team.filter((m) => m.userId).map(async (m) => ({ userId: m.userId!, name: (await personOf(ctx, m)).name, role: m.teamRole }))) : [];
    return { people, candidates, canAssign };
  },
});

/** "Assign people": the team members on this project (team members only, D146). Owner only. */
export const assign = mutation({
  args: { projectId: v.id("projects"), userIds: v.array(v.id("users")) },
  handler: async (ctx, { projectId, userIds }) => {
    await requireOwner(ctx);
    const p = await ctx.db.get(projectId);
    if (!p) throw new ConvexError("That project isn't there any more.");
    const team = await teamRows(ctx, myBusiness(ctx));
    const want = new Set(userIds.map(String));
    for (const id of want) if (!team.some((m) => m.userId === id)) throw new ConvexError("Only people on your team can be assigned.");
    const rows = await ctx.db.query("projectTeam").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect();
    for (const r of rows) if (!want.has(r.userId)) await ctx.db.delete(r._id);
    const have = new Set(rows.map((r) => r.userId as string));
    for (const id of want) if (!have.has(id)) await ctx.db.insert("projectTeam", { projectId, userId: id as Id<"users">, createdAt: Date.now() });
    await audit(ctx, { kind: "team", text: `changed who is assigned to ${p.name}`, where: "Settings › Team", link: "/settings/team" });
    return { ok: true as const };
  },
});

// ---------- Join the team (public, /team/join/<token>) ----------

/** The Join page: which business, which role, which email. Answers only for an invite's own token. */
export const joinPage = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!TOKEN.test(token)) return { state: "missing" as const };
    const hash = await tokenHash(token);
    const inv = await ctx.db.query("teamInvites").withIndex("by_token", (q) => q.eq("tokenHash", hash)).unique();
    if (!inv || inv.revokedAt) return { state: "missing" as const };
    const b = inv.businessId ? await ctx.db.get(inv.businessId) : null;
    const base = { business: b?.name ?? "", legalName: b?.legalName ?? b?.name ?? "", role: ROLE_NAMES[inv.teamRole], invitedBy: inv.invitedBy };
    if (inv.acceptedAt) return { state: "joined" as const, ...base };
    if (inv.expiresAt <= Date.now()) return { state: "expired" as const, ...base };
    return { state: "open" as const, ...base, email: inv.email, name: inv.name ?? "" };
  },
});

// ---------- email 46 ----------

export const inviteData = internalQuery({
  args: { inviteId: v.id("teamInvites") },
  handler: async (ctx, { inviteId }) => {
    const i = await ctx.db.get(inviteId);
    if (!i) return null;
    return { i, brand: await mailBrandOf(ctx, i.businessId ?? null) };
  },
});

export const inviteMail = internalAction({
  args: { inviteId: v.id("teamInvites"), token: v.string(), at: v.number() },
  handler: async (ctx, { inviteId, token, at }): Promise<void> => {
    const d = await ctx.runQuery(internal.team.inviteData, { inviteId });
    // only the newest link: a resend or a cancel since this was queued means this one is stale
    if (!d || d.i.revokedAt || d.i.acceptedAt || d.i.sentAt !== at) return;
    const link = `${SITE()}/team/join/${token}`;
    await deliverOnce(ctx, `team-invite:${inviteId}:${at}`, "team_invite", d.i.email,
      teamInviteMail(d.brand, { invitedBy: d.i.invitedBy, role: ROLE_NAMES[d.i.teamRole], until: untilText(d.i.expiresAt), link }), d.brand.replyTo, d.i.businessId ?? null);
  },
});
