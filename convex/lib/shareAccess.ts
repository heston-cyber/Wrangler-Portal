// What a share covers and who may open it (client side C2, Oct 23). Used by convex/shares.ts now, and by the
// client's pages, note visibility and signed links in C3. One place decides, so the rules can't drift apart.
import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { sha256Hex } from "./hash";
import { viewerOf, type Viewer } from "./access";
import { focusBusiness } from "./functions";

export type Share = Doc<"shares">;

/** Does this share list every ready version, or only the latest? View-only links are the latest only (Heston, Oct 23). */
export const showsAllVersions = (s: Pick<Share, "allVersions" | "access">) => s.allVersions && s.access === "comment";

export const clientKey = (name: string | null | undefined) => (name ?? "").trim();

export const passcodeHash = (token: string, passcode: string) => sha256Hex(`${token}:${passcode}`);
/** What the page holds after a right passcode: a proof derived from the hash, never the passcode itself. Only the
 *  `unlock` mutation (rate-limited) can mint it, so a passcode can't be guessed against the open query. */
export const passProof = (token: string, hash: string) => sha256Hex(`unlock:${token}:${hash}`);
export const MIN_PASSCODE = 8;

/** Why a share won't open right now, or null when it would (before the who/passcode checks). */
export function shareState(share: Share, now = Date.now()): "off" | "expired" | null {
  if (share.offAt) return "off";
  if (share.expiresAt && now >= share.expiresAt) return "expired";
  return null;
}

const projectLabel = (p: { name: string; jobNumber?: string }) => (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name);

/** What a share covers, in words: "Harbor Coffee", "26201 Harbor Coffee Launch", "Brand Film · 26201 Harbor Coffee Launch". */
export async function labelOf(ctx: QueryCtx | MutationCtx, s: Share): Promise<{ label: string; sub: string | null; gone: boolean }> {
  if (s.kind === "client") return { label: s.client ?? "", sub: null, gone: false };
  if (s.kind === "project") {
    const p = s.projectId ? await ctx.db.get(s.projectId) : null;
    return p ? { label: projectLabel(p), sub: p.client ?? null, gone: false } : { label: "A deleted project", sub: null, gone: true };
  }
  const vid = s.videoId ? await ctx.db.get(s.videoId) : null;
  if (!vid) return { label: "A deleted video", sub: null, gone: true };
  const p = await ctx.db.get(vid.projectId);
  return { label: vid.title, sub: p ? projectLabel(p) : null, gone: false };
}

/** Step 6: is this record in the share's business? (Untagged records, only in tests, count as the same.) */
const sameBusiness = (share: Share, doc: { businessId?: Id<"businesses"> }) =>
  share.businessId === undefined || doc.businessId === undefined || doc.businessId === share.businessId;

/** The projects a share covers (all of a client's, the one project, or the video's project), in the share's business only. */
export async function coveredProjects(ctx: QueryCtx | MutationCtx, share: Share): Promise<Doc<"projects">[]> {
  if (share.kind === "client") {
    const all = await ctx.db.query("projects").collect();
    return all.filter((p) => sameBusiness(share, p) && (share.clientId && p.clientId ? p.clientId === share.clientId : clientKey(p.client) === clientKey(share.client)));
  }
  const projectId = share.kind === "project" ? share.projectId : (share.videoId && (await ctx.db.get(share.videoId))?.projectId);
  const p = projectId ? await ctx.db.get(projectId) : null;
  return p && sameBusiness(share, p) ? [p] : [];
}

/** The videos a share covers, live: anything added under a shared client or project counts. */
export async function coveredVideos(ctx: QueryCtx | MutationCtx, share: Share): Promise<Doc<"videos">[]> {
  if (share.kind === "video") {
    const vid = share.videoId ? await ctx.db.get(share.videoId) : null;
    return vid && sameBusiness(share, vid) ? [vid] : [];
  }
  const out: Doc<"videos">[] = [];
  for (const p of await coveredProjects(ctx, share)) out.push(...(await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()));
  return out;
}

export async function coversVideo(ctx: QueryCtx | MutationCtx, share: Share, videoId: Id<"videos">): Promise<boolean> {
  if (share.kind === "video") return share.videoId === videoId;
  const vid = await ctx.db.get(videoId);
  if (!vid || !sameBusiness(share, vid)) return false;
  if (share.kind === "project") return share.projectId === vid.projectId;
  const p = await ctx.db.get(vid.projectId);
  if (!p || !sameBusiness(share, p)) return false;
  return share.clientId && p.clientId ? p.clientId === share.clientId : clientKey(p.client) === clientKey(share.client);
}

export type Gate =
  | { ok: true; share: Share; viewer: Viewer; guest: boolean }
  | { ok: false; reason: "missing" | "off" | "expired" | "signin" | "notInvited" | "passcode" | "wrongPasscode"; share?: Share };

/**
 * May this caller open this share? Owners always can (to check what a client will see). Invited shares need a
 * signed-in member whose invite still stands. Link shares with a passcode need the right one.
 */
export async function gateShare(ctx: QueryCtx | MutationCtx, token: string, passcode?: string | null): Promise<Gate> {
  const share = await ctx.db.query("shares").withIndex("by_token", (q) => q.eq("token", token)).unique();
  if (!share) return { ok: false, reason: "missing" };
  focusBusiness(ctx, share.businessId); // step 6: the rest of this call sees only the share's business
  const state = shareState(share);
  if (state) return { ok: false, reason: state, share };
  const viewer = await viewerOf(ctx);
  if (viewer.kind === "owner") return { ok: true, viewer, guest: false, share };
  if (share.who === "invited") {
    if (viewer.kind !== "client") return { ok: false, reason: "signin", share };
    const member = (await ctx.db.query("shareMembers").withIndex("by_share", (q) => q.eq("shareId", share._id)).collect()).find((m) => m.email === viewer.email);
    const invite = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", viewer.email)).collect()).find((i) => !i.revokedAt && sameBusiness(share, i));
    if (!member || !invite) return { ok: false, reason: "notInvited", share };
    return { ok: true, viewer, guest: false, share };
  }
  if (share.passcodeHash) {
    if (!passcode) return { ok: false, reason: "passcode", share };
    if (passcode !== (await passProof(share.token, share.passcodeHash))) return { ok: false, reason: "wrongPasscode", share };
  }
  return { ok: true, viewer, guest: viewer.kind === "nobody", share };
}

/** The gate as a thrown error, for mutations that act on a share (a note left through it, a view recorded). */
export async function requireShare(ctx: QueryCtx | MutationCtx, token: string, passcode?: string | null) {
  const g = await gateShare(ctx, token, passcode);
  if (!g.ok) throw new ConvexError(g.reason === "signin" ? "Sign in first." : "Not allowed.");
  return g;
}
