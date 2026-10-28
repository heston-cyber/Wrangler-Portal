// Diagnostics for the CI log (public): does every link the player may use for a video answer? Statuses only — no
// names, no URLs, no tokens.   npx convex run diag:media '{"number": 2}'
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { versionMedia } from "./lib/media";
import { videoByNumber } from "./lib/register";
import { SITE_SLASH } from "./lib/site";

export const versionsOf = internalQuery({
  args: { number: v.number() },
  handler: async (ctx, { number }) => {
    const vid = await videoByNumber(ctx, number);
    if (!vid) return [];
    const vs = (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()).sort((a, b) => a.number - b.number);
    const out = [];
    for (const x of vs) out.push({ number: x.number, status: x.status, source: x.source ?? "stream", mp4Heights: x.mp4Heights ?? [], size: `${x.width ?? "?"}x${x.height ?? "?"}`, streamOnly: !!x.streamOnly, media: await versionMedia(x) });
    return out;
  },
});

export const media = internalAction({
  args: { number: v.number() },
  handler: async (ctx, { number }) => {
    const site = SITE_SLASH();
    const head = async (u: string | null) => {
      if (!u) return null;
      try {
        const r = await fetch(u, { method: "HEAD", headers: { Referer: site, Origin: new URL(site).origin } });
        return { status: r.status, type: r.headers.get("content-type"), mb: r.headers.get("content-length") ? Math.round(Number(r.headers.get("content-length")) / 1e5) / 10 : null };
      } catch (e) { return { status: 0, error: String((e as Error).message).slice(0, 60) }; }
    };
    const rows: any[] = await ctx.runQuery(internal.diag.versionsOf, { number });
    const out = [];
    for (const r of rows) {
      const mp4: Record<string, unknown> = {};
      for (const [h, u] of Object.entries(r.media.mp4 as Record<string, string>)) mp4[h] = await head(u);
      out.push({ version: r.number, status: r.status, source: r.source, size: r.size, streamOnly: r.streamOnly, mp4Heights: r.mp4Heights, hls: await head(r.media.hls), file: await head(r.media.file), scrub: await head(r.media.scrub?.mp4 ?? null), thumb: await head(r.media.thumb), mp4 });
    }
    return out;
  },
});
