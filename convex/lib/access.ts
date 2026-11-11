// The one access check in front of every app function (client side C1, Oct 23).
//   requireMe       the owner (Heston): signed in, on the allow list. Every function the site had before C1 uses it,
//                   so nothing is visible to anyone else unless a later phase explicitly allows it through a share.
//   requireSignedIn any account, owner or client: for the account page and, later, "Shared with me".
//   viewerOf        who is calling (owner / client / nobody), for functions that answer differently per role.
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { allowedEmails } from "./owners";
import { businessFor } from "./business";
import { sideOf } from "./roles";
import { assignedOnly, cleanPerms, isTeamRole, type Perm, type Perms, type TeamRole } from "./perms";

export type Me = { userId: Id<"users">; name: string; email: string; team?: TeamInfo };
// Phase 5e (Nov 5): a team member works in one business with their role's switches (lib/perms.ts).
export type TeamInfo = { businessId: Id<"businesses">; role: TeamRole; perms: Perms; membershipId: Id<"memberships"> };
// businessId (Phase 0.5d step 1): the business they work in or are a client of. Optional until step 3 makes every
// function use it; null only before the default business has been made.
// Phase 3c: "vendor" is a third side (the vendor portal). Vendors never pass requireMe or requireSignedIn; the vendor
// portal's own functions (vendorPortal.ts) check them with requireVendor.
export type Viewer = { kind: "owner" | "client" | "vendor"; userId: Id<"users">; name: string; email: string; businessId: Id<"businesses"> | null }
  | { kind: "team"; userId: Id<"users">; name: string; email: string; businessId: Id<"businesses">; team: TeamInfo }
  | { kind: "nobody" };

const fallbackName = (email: string) => { const local = email.split("@")[0] ?? ""; return local ? local[0].toUpperCase() + local.slice(1) : "Someone"; };

export async function viewerOf(ctx: QueryCtx | MutationCtx): Promise<Viewer> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return { kind: "nobody" };
  const user = await ctx.db.get(userId);
  const email = (user?.email ?? "").toLowerCase();
  if (!user || !email) return { kind: "nobody" };
  // Phase 5b step 4 (D127): a call-sheet guest's login is never an owner, client or vendor, whatever memberships or
  // allow-list entries its email has (or gets later): it only passes the guest functions' own check (lib/guests.ts).
  if (user.role === "guest") return { kind: "nobody" };
  const name = (user.name as string | undefined) || fallbackName(email);
  // Owner (Phase 0.5d step 3): an active owner membership in a business, or, for Wrangler, the ALLOWED_EMAILS list
  // (kept as the bootstrap and backup). Owner memberships are only ever made by internal code.
  const ms = await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", email)).collect();
  const ownerM = ms.filter((m) => !m.revokedAt && m.role === "owner").sort((a, b) => a.createdAt - b.createdAt)[0];
  if (ownerM) return { kind: "owner", userId, name, email, businessId: ownerM.businessId };
  if (allowedEmails().includes(email)) return { kind: "owner", userId, name, email, businessId: await businessFor(ctx, email, "owner") };
  // Phase 5e: a team member (a live team membership, made only when their invite was accepted). Never also a client or
  // vendor: the invite is refused for an email that already has either.
  const teamM = ms.filter((m) => !m.revokedAt && m.role === "team" && isTeamRole(m.teamRole)).sort((a, b) => a.createdAt - b.createdAt)[0];
  if (teamM && user.role === "team") {
    const role = teamM.teamRole as TeamRole;
    return { kind: "team", userId, name, email, businessId: teamM.businessId, team: { businessId: teamM.businessId, role, perms: cleanPerms(role, teamM.perms), membershipId: teamM._id } };
  }
  if (user.role === "team") return { kind: "nobody" }; // taken off the team
  // Nov 2: a client-and-vendor login's side (lib/roles.ts sideOf).
  const side = sideOf(user.role, ms);
  if (side === "client") return { kind: "client", userId, name, email, businessId: await businessFor(ctx, email, "client") };
  if (side === "vendor") return { kind: "vendor", userId, name, email, businessId: null };
  return { kind: "nobody" };
}

/**
 * The owner, or (Phase 5e) a team member whose role has this switch on. With no switch named, the owner only: every
 * function stays closed to the team until it names the switch that opens it.
 */
export async function requireMe(ctx: QueryCtx | MutationCtx, perm?: Perm | readonly Perm[]): Promise<Me> {
  const v = await viewerOf(ctx);
  if (v.kind === "nobody") throw new ConvexError(await getAuthUserId(ctx) ? "Not allowed." : "Sign in first.");
  if (v.kind === "team" && perm && (typeof perm === "string" ? v.team.perms[perm] : perm.some((p) => v.team.perms[p]))) {
    return { userId: v.userId, name: v.name, email: v.email, team: v.team };
  }
  if (v.kind !== "owner") throw new ConvexError("Not allowed.");
  return { userId: v.userId, name: v.name, email: v.email };
}

/** The owner only, whatever anyone's switches say (Settings › Team, Your data, Activity). */
export const requireOwner = (ctx: QueryCtx | MutationCtx) => requireMe(ctx);

/** True when this caller may see what a project is worth (Heston, Nov 3: the owner and the Bookkeeper). */
export const seesValue = (me: Me) => !me.team || me.team.perms.value;

/**
 * Phase 5e: the projects a team member may open. An Editor only the ones they're assigned to; everyone else (the owner,
 * a Producer) every project of the business. Returns null for "all".
 */
export async function projectsFor(ctx: QueryCtx | MutationCtx, me: Me): Promise<Set<string> | null> {
  if (!me.team || !assignedOnly(me.team.role)) return null;
  const rows = await ctx.db.query("projectTeam").withIndex("by_user", (q) => q.eq("userId", me.userId)).collect();
  return new Set(rows.map((r) => r.projectId as string));
}

/** Refuses a project this caller may not open (an Editor's unassigned project). */
export async function requireProject(ctx: QueryCtx | MutationCtx, me: Me, projectId: Id<"projects"> | null | undefined) {
  const only = await projectsFor(ctx, me);
  if (only && (!projectId || !only.has(projectId))) throw new ConvexError("Not allowed.");
}

export async function requireSignedIn(ctx: QueryCtx | MutationCtx): Promise<Me & { kind: "owner" | "client" }> {
  const v = await viewerOf(ctx);
  if (v.kind === "nobody") throw new ConvexError(await getAuthUserId(ctx) ? "Not allowed." : "Sign in first.");
  // Phase 5e: these are the owner's and clients' own pages; a team member is refused unless a function lets them in itself.
  if (v.kind === "vendor" || v.kind === "team") throw new ConvexError("Not allowed.");
  return { userId: v.userId, name: v.name, email: v.email, kind: v.kind };
}

// Actions can't read the db directly: check sign-in through a query (users.assertAllowed does the owner check).
export async function requireMeInAction(ctx: ActionCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in first.");
  return userId;
}

/**
 * Phase 5e: the project a record belongs to: a project itself, or anything carrying projectId, videoId, versionId,
 * noteId or shootId (followed up to its project). undefined when the record isn't tied to a project at all.
 */
export async function projectOf(ctx: QueryCtx | MutationCtx, id: string): Promise<Id<"projects"> | null | undefined> {
  const asProject = ctx.db.normalizeId("projects", id);
  if (asProject) return (await ctx.db.get(asProject)) ? asProject : null;
  const doc = (await ctx.db.get(id as Id<"videos">)) as Record<string, unknown> | null;
  if (!doc) return null;
  return projectOfDoc(ctx, doc);
}
export async function projectOfDoc(ctx: QueryCtx | MutationCtx, doc: Record<string, unknown>): Promise<Id<"projects"> | null | undefined> {
  if (typeof doc.projectId === "string") return doc.projectId as Id<"projects">;
  for (const k of ["videoId", "versionId", "noteId", "shootId"]) {
    if (typeof doc[k] === "string") {
      const parent = (await ctx.db.get(doc[k] as Id<"videos">)) as Record<string, unknown> | null;
      return parent ? projectOfDoc(ctx, parent) : null;
    }
  }
  return undefined;
}

/**
 * Phase 5e: requireMe for a function that works on particular records. An Editor (assigned projects only) passes only
 * when every record named belongs to a project they're assigned to; a record tied to no project refuses them.
 */
export async function requireFor(ctx: QueryCtx | MutationCtx, perm: Perm | readonly Perm[], ...ids: Array<string | null | undefined>): Promise<Me> {
  const me = await requireMe(ctx, perm);
  const only = await projectsFor(ctx, me);
  if (only) for (const id of ids) {
    if (!id) throw new ConvexError("Not allowed.");
    const p = await projectOf(ctx, id);
    if (!p || !only.has(p)) throw new ConvexError("Not allowed.");
  }
  return me;
}

/** Phase 5e: the owner or a team member who sees every project with this switch (not an Editor, who sees assigned ones). */
export async function requireAll(ctx: QueryCtx | MutationCtx, perm: Perm | readonly Perm[]): Promise<Me> {
  const me = await requireMe(ctx, perm);
  if (me.team && assignedOnly(me.team.role)) throw new ConvexError("Not allowed.");
  return me;
}
