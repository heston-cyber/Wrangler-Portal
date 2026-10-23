// Who may see or comment on a video (client side C3, Oct 23). The owner always may. Anyone else needs a share
// that covers the video: a signed-in client on an invited share, or a guest on a link share. Every function the
// review page calls takes an optional `share` argument and goes through here, so one rule decides.
import { v, ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { viewerOf } from "./access";
import { coversVideo, gateShare, showsAllVersions, type Share } from "./shareAccess";

export const shareArg = v.optional(v.object({
  token: v.string(),
  passcode: v.optional(v.string()),
  guestKey: v.optional(v.string()),  // a random id the guest's browser keeps, so they can edit their own notes
  guestName: v.optional(v.string()), // what they typed when asked for a name
}));
export type ShareRef = { token: string; passcode?: string; guestKey?: string; guestName?: string };

export type Access =
  | { kind: "owner"; userId: Id<"users">; name: string; email: string; can: "owner"; share: null }
  | { kind: "client"; userId: Id<"users">; name: string; email: string; can: "view" | "comment"; share: Share }
  | { kind: "guest"; name: string; guestKey: string | null; can: "view" | "comment"; share: Share };

const cleanName = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ").slice(0, 60);

export async function accessToVideo(ctx: QueryCtx | MutationCtx, videoId: Id<"videos">, share: ShareRef | undefined, need: "view" | "comment" = "view"): Promise<Access> {
  const viewer = await viewerOf(ctx);
  if (viewer.kind === "owner") return { kind: "owner", userId: viewer.userId, name: viewer.name, email: viewer.email, can: "owner", share: null };
  const signedIn = !!(await getAuthUserId(ctx));
  if (!share) throw new ConvexError(signedIn ? "Not allowed." : "Sign in first.");
  const g = await gateShare(ctx, share.token, share.passcode);
  if (!g.ok) throw new ConvexError(g.reason === "signin" && !signedIn ? "Sign in first." : "Not allowed.");
  if (!(await coversVideo(ctx, g.share, videoId))) throw new ConvexError("Not allowed.");
  if (need === "comment" && g.share.access !== "comment") throw new ConvexError("This link is view only.");
  if (viewer.kind === "client") return { kind: "client", userId: viewer.userId, name: viewer.name, email: viewer.email, can: g.share.access, share: g.share };
  const name = cleanName(share.guestName);
  if (need === "comment" && !name) throw new ConvexError("Add your name first.");
  return { kind: "guest", name: name || "Someone", guestKey: share.guestKey?.slice(0, 80) || null, can: g.share.access, share: g.share };
}

/** The same, starting from a version: the version must be one the share shows (all, or only the latest ready one). */
export async function accessToVersion(ctx: QueryCtx | MutationCtx, versionId: Id<"versions">, share: ShareRef | undefined, need: "view" | "comment" = "view"): Promise<{ access: Access; version: Doc<"versions"> }> {
  const version = await ctx.db.get(versionId);
  if (!version) throw new ConvexError("That version no longer exists.");
  const access = await accessToVideo(ctx, version.videoId, share, need);
  if (access.share && !(await versionShown(ctx, access.share, version))) throw new ConvexError("Not allowed.");
  return { access, version };
}

export async function versionShown(ctx: QueryCtx | MutationCtx, share: Share, version: Doc<"versions">): Promise<boolean> {
  if (version.status !== "ready") return false;
  if (showsAllVersions(share)) return true;
  const all = await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", version.videoId)).collect();
  const latest = all.filter((x) => x.status === "ready").sort((a, b) => b.number - a.number)[0];
  return !!latest && latest._id === version._id;
}

/** The name that goes on a note or reply. */
export const authorOf = (a: Access) => (a.kind === "guest" ? `${a.name} (guest)` : a.name);

/** Which notes this viewer may see: the owner sees all; others see shared notes only. */
export const noteVisible = (a: Access, n: Pick<Doc<"notes">, "visibility">) => a.kind === "owner" || n.visibility === "shared";

/** May this viewer change this note? The owner may; a client or guest only their own, and only while it's open. */
export function ownsNote(a: Access, n: Pick<Doc<"notes">, "authorId" | "guestKey" | "status">): boolean {
  if (a.kind === "owner") return true;
  if (n.status === "done") return false;
  if (a.kind === "client") return !!n.authorId && n.authorId === a.userId;
  return !!a.guestKey && n.guestKey === a.guestKey;
}
