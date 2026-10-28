// C8 (Oct 26): link previews. A share link pasted into iMessage, WhatsApp, Slack or email shows the video's picture
// (first non-black frame with the Wrangler wordmark), its title and "Wrangler Review". The site itself is static
// (GitHub Pages), so a small Cloudflare Worker on review.wranglerportal.com/s/* asks here for the tags and slips
// them into the page's <head> (infra/cloudflare/og-worker.js).
//
//   GET /og/s/<token>[?v=<videoId>]          → JSON { title, description, image, url, siteName }
//   GET /og/s/<token>/image.jpg[?v=<videoId>] → the picture itself (proxied, so no signed link leaks into chats)
//
// What a preview may show: a link that opens for anyone (no passcode, not invited-only) shows the frame. A passcode
// or invited link shows the title and the generic Wrangler card, never a frame — the link may be forwarded before
// the passcode is. Off, expired and unknown links show the generic card with no title.
import { httpAction } from "./_generated/server";
import { internalQuery } from "./lib/functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { coveredVideos, labelOf, shareState } from "./lib/shareAccess";
import { signStillUrl, signedThumbUrl } from "./lib/media";
import { SITE } from "./lib/email";

const SITE_NAME = "Wrangler Review";
const GENERIC = () => `${SITE()}/brand/og-default.png`;
const DESCRIPTION = "A cut to review from Wrangler Productions. Watch, leave notes on exact frames, download.";

export type OgData = { title: string; description: string; image: string; imageIsFrame: boolean; url: string; siteName: string; state: string };

export const forShare = internalQuery({
  args: { token: v.string(), videoId: v.optional(v.string()) },
  handler: async (ctx, { token, videoId }): Promise<OgData & { frameUrl: string | null }> => {
    const generic = (state: string): OgData & { frameUrl: string | null } => ({ title: SITE_NAME, description: "Video review by Wrangler Productions.", image: GENERIC(), imageIsFrame: false, url: `${SITE()}/s/${token}`, siteName: SITE_NAME, state, frameUrl: null });
    const share = await ctx.db.query("shares").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (!share) return generic("missing");
    const state = shareState(share);
    if (state) return generic(state);
    const { label, gone } = await labelOf(ctx, share);
    if (gone) return generic("gone");
    const url = `${SITE()}/s/${token}${videoId ? `/v/${videoId}` : ""}`;
    const gated = !!share.passcodeHash || share.who === "invited";
    // Which video the picture comes from: the one in the link, or the only one, or the most recent one covered.
    const videos = await coveredVideos(ctx, share);
    let video: Doc<"videos"> | null = null;
    if (videoId) video = videos.find((x) => x._id === (videoId as Id<"videos">)) ?? null;
    else if (share.kind === "video") video = videos[0] ?? null;
    else video = [...videos].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    const title = video && (videoId || share.kind === "video") ? video.title : label;
    const count = videos.length;
    const description = share.kind === "video" || videoId ? DESCRIPTION : `${count} video${count === 1 ? "" : "s"} to review from Wrangler Productions.`;
    let frameUrl: string | null = null;
    if (video && !gated) {
      const ready = (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", video._id)).collect()).filter((x) => x.status === "ready").sort((a, b) => b.number - a.number);
      const latest = ready[0] ?? null;
      if (latest) frameUrl = (await signStillUrl(latest.posterUrl)) ?? (await signedThumbUrl(latest));
    }
    const image = frameUrl ? `${process.env.CONVEX_SITE_URL}/og/s/${token}/image.jpg${videoId ? `?v=${videoId}` : ""}` : GENERIC();
    return { title, description, image, imageIsFrame: !!frameUrl, url, siteName: SITE_NAME, state: "ok", frameUrl };
  },
});

function parse(req: Request): { token: string; videoId?: string; wantsImage: boolean } | null {
  const u = new URL(req.url);
  const m = /^\/og\/s\/([A-Za-z0-9_-]{8,64})(\/image\.jpg)?$/.exec(u.pathname);
  if (!m) return null;
  const vid = u.searchParams.get("v") ?? undefined;
  return { token: m[1], videoId: vid && /^[a-z0-9]{20,40}$/.test(vid) ? vid : undefined, wantsImage: !!m[2] };
}

export const og = httpAction(async (ctx, req) => {
  const p = parse(req);
  if (!p) return new Response("Not found", { status: 404 });
  const data = await ctx.runQuery(internal.og.forShare, { token: p.token, videoId: p.videoId });
  const cache = data.state === "ok" ? "public, max-age=300" : "public, max-age=60";
  if (!p.wantsImage) {
    const { frameUrl: _f, ...out } = data;
    void _f;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache, "access-control-allow-origin": "*" } });
  }
  // The picture: our poster or Bunny's thumbnail, fetched here and handed on (the signed link stays server-side).
  if (!data.frameUrl) return Response.redirect(GENERIC(), 302);
  try {
    const r = await fetch(data.frameUrl, { headers: { Referer: `${SITE()}/` } });
    if (!r.ok) return Response.redirect(GENERIC(), 302);
    const bytes = await r.arrayBuffer();
    if (bytes.byteLength > 6_000_000) return Response.redirect(GENERIC(), 302);
    return new Response(bytes, { status: 200, headers: { "content-type": r.headers.get("content-type") || "image/jpeg", "cache-control": cache, "access-control-allow-origin": "*" } });
  } catch {
    return Response.redirect(GENERIC(), 302);
  }
});
