// Client approval (Gate 4, Oct 28; Phase 1): a signed-in client can approve the version on screen. It deletes nothing
// and is separate from the owner's Approve final. Signed-in clients only (no guests); no email; it shows on the
// owner's video page (chip and version tag), in Activity and on Home.
import { mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { accessToVersion, accessToVideo, shareArg } from "./lib/viewer";

/** Approve this version, as the signed-in client looking at it through a share. Approving twice keeps the first. */
export const approve = mutation({
  args: { versionId: v.id("versions"), share: shareArg },
  handler: async (ctx, { versionId, share }) => {
    const { access, version } = await accessToVersion(ctx, versionId, share);
    if (access.kind !== "client") throw new ConvexError(access.kind === "owner" ? "Clients approve versions; use Approve final for your own." : "Sign in to approve.");
    const had = await ctx.db.query("clientApprovals").withIndex("by_version_user", (q) => q.eq("versionId", versionId).eq("userId", access.userId)).unique();
    if (had) return { at: had.at, versionNumber: had.versionNumber };
    const at = Date.now();
    await ctx.db.insert("clientApprovals", {
      videoId: version.videoId, versionId, versionNumber: version.number, userId: access.userId, name: access.name, email: access.email, shareId: access.share._id, at,
    });
    return { at, versionNumber: version.number };
  },
});

/** The approvals on a video: every one for the owner; only their own for a client; none for a guest. */
export const forVideo = query({
  args: { videoId: v.id("videos"), share: shareArg },
  handler: async (ctx, { videoId, share }) => {
    const access = await accessToVideo(ctx, videoId, share);
    if (access.kind === "guest") return [];
    const rows = await ctx.db.query("clientApprovals").withIndex("by_video", (q) => q.eq("videoId", videoId)).order("desc").collect();
    return rows
      .filter((r) => access.kind === "owner" || r.userId === access.userId)
      .map((r) => ({ versionId: r.versionId, versionNumber: r.versionNumber, name: r.name, email: access.kind === "owner" ? r.email : null, at: r.at, mine: access.kind === "client" }));
  },
});
