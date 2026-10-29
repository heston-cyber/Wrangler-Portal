// Wrangler Portal Phase 1 (Oct 29): the client's Home (P1 / Client / Home): "Waiting for you".
//   cuts  the latest version of each video shared with them that they haven't watched or approved yet
//   docs  documents waiting on their signature now (their turn, link still open)
import { query } from "./lib/functions";
import { requireSignedIn } from "./lib/access";
import type { Id } from "./_generated/dataModel";
import { signedThumbUrl, signStillUrl } from "./lib/media";
import { coveredVideos, sameBusiness, shareState } from "./lib/shareAccess";
import { signLink } from "./lib/wsSigning";
import { docLabel } from "./lib/wsLayout";

export const waiting = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return { cuts: [], docs: [] };
    const invites = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", me.email)).collect()).filter((i) => !i.revokedAt);
    const cuts = new Map<string, { videoId: Id<"videos">; title: string; number: number; lengthSec: number | null; sharedAt: number; thumbUrl: string | null; link: string }>();
    if (invites.length) {
      for (const m of await ctx.db.query("shareMembers").withIndex("by_email", (q) => q.eq("email", me.email)).collect()) {
        const s = await ctx.db.get(m.shareId);
        if (!s || shareState(s) || !invites.some((i) => sameBusiness(s, i))) continue;
        for (const vid of await coveredVideos(ctx, s)) {
          if (cuts.has(vid._id)) continue;
          const latest = (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()).filter((x) => x.status === "ready").sort((a, b) => b.number - a.number)[0];
          if (!latest) continue;
          const watched = (await ctx.db.query("views").withIndex("by_version", (q) => q.eq("versionId", latest._id)).collect()).some((w) => w.whoKey.endsWith(`:u:${me.userId}`) && w.watchedSec >= 1);
          const approved = (await ctx.db.query("clientApprovals").withIndex("by_version_user", (q) => q.eq("versionId", latest._id).eq("userId", me.userId)).first()) !== null;
          if (watched || approved) continue;
          cuts.set(vid._id, {
            videoId: vid._id, title: vid.title, number: latest.number, lengthSec: latest.lengthSeconds ?? null, sharedAt: Math.max(s.createdAt, latest.createdAt),
            thumbUrl: (await signStillUrl(latest.posterUrl)) ?? (await signedThumbUrl(latest)), link: `/s/${s.token}/v/${vid._id}?version=${latest.number}`,
          });
        }
      }
    }
    const docs = [];
    const now = Date.now();
    for (const sg of await ctx.db.query("wsSignings").withIndex("by_email", (q) => q.eq("email", me.email)).collect()) {
      if (sg.status !== "sent") continue;
      const d = await ctx.db.get(sg.documentId);
      if (!d || d.status !== "sent" || d.sentVersion !== sg.versionNumber || (d.expiresAt && d.expiresAt < now)) continue;
      const ver = (await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", d._id)).collect()).find((x) => x.number === d.sentVersion);
      docs.push({ documentId: d._id, label: docLabel(d.number), title: d.title, sentAt: d.sentAt ?? null, pages: ver?.pages.length ?? null, signUrl: signLink(sg.token) });
    }
    return {
      cuts: [...cuts.values()].sort((a, b) => b.sharedAt - a.sharedAt),
      docs: docs.sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0)),
    };
  },
});
