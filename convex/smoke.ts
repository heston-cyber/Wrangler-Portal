// C5 (Oct 24): the production smoke test's fixtures. One test video in the "Tests" project (title below, keep it)
// with a ready file version pointing at the public frame-test clip, and five share links on it: comment, view,
// passcode, switched off, expired. `ensure` makes whatever is missing and returns the tokens; the smoke workflow
// opens each link in a real browser against the live site and fails if a page ever shows the error screen.
//
// The tokens are links to a test clip, nothing else; the workflow masks them in its log all the same.
// Run by hand: npx convex run smoke:ensure   (CI: .github/workflows/smoke.yml)
import { internalAction, internalMutation, internalQuery } from "./lib/functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { allowedEmails } from "./auth";
import { passcodeHash } from "./lib/shareAccess";
import { randomToken } from "./lib/hash";
import { signUrl } from "./lib/media";
import { renderFolder } from "./lib/bunnySign";
import { reviewStorage } from "./lib/reviewStorage";
import { LAB_CLIP, SITE } from "./lib/site";

export const TITLE = "Smoke test (keep)";
export const PASSCODE = "smoketest1";
const PATH = "review/_smoke/frametest_23976_h264.mp4";
const DAY = 86_400_000;

type Kind = "comment" | "view" | "pass" | "off" | "expired";
function kindOf(s: Doc<"shares">): Kind | null {
  if (s.offAt) return "off";
  if (s.expiresAt && s.expiresAt < Date.now()) return "expired";
  if (s.passcodeHash) return "pass";
  if (s.access === "view") return "view";
  if (s.access === "comment" && s.who === "link") return "comment";
  return null;
}

export const ensure = internalMutation({
  args: {},
  handler: async (ctx) => {
    const owner = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", allowedEmails()[0])).first();
    if (!owner) throw new Error("No owner account yet.");
    const now = Date.now();
    const p = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", "Tests")).first();
    const projectId = p?._id ?? (await ctx.db.insert("projects", { name: "Tests", createdAt: now }));
    let video = (await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect()).find((x) => x.title === TITLE) ?? null;
    let madeVideo = false;
    if (!video) {
      const videoId = await ctx.db.insert("videos", { projectId, title: TITLE, createdAt: now, updatedAt: now });
      const fileUrl = `https://${process.env.BUNNY_REVIEW_CDN || process.env.BUNNY_STILLS_CDN}/${PATH}`;
      await ctx.db.insert("versions", {
        videoId, number: 1, status: "ready", bunnyGuid: "", source: "file", storagePath: PATH, fileUrl, fileName: "frametest_23976_h264.mp4", startTimecode: "01:00:00:00",
        fpsNum: 24000, fpsDen: 1001, frameCount: 480, frameCountFrom: "file", width: 1920, height: 1080, createdAt: now, readyAt: now, description: "The smoke test's clip.",
      });
      video = (await ctx.db.get(videoId))!;
      madeVideo = true;
    }
    const videoId = video._id;
    // The clip's path moved once (Oct 24): keep the version pointing at the current one.
    const fileUrl = `https://${process.env.BUNNY_REVIEW_CDN || process.env.BUNNY_STILLS_CDN}/${PATH}`;
    for (const ver of await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect()) {
      if (ver.storagePath !== PATH || ver.fileUrl !== fileUrl) await ctx.db.patch(ver._id, { storagePath: PATH, fileUrl });
    }
    const have = new Map<Kind, Doc<"shares">>();
    for (const s of await ctx.db.query("shares").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect()) {
      const k = kindOf(s);
      if (k && !have.has(k)) have.set(k, s);
    }
    const made: Kind[] = [];
    const mk = async (k: Kind) => {
      let token = randomToken(16);
      while (await ctx.db.query("shares").withIndex("by_token", (q) => q.eq("token", token)).unique()) token = randomToken(16);
      const base = { token, kind: "video" as const, videoId, who: "link" as const, allVersions: true, downloads: true, emailNewVersions: false, createdAt: now, createdBy: owner._id };
      const row =
        k === "view" ? { ...base, access: "view" as const } :
        k === "pass" ? { ...base, access: "comment" as const, passcodeHash: await passcodeHash(token, PASSCODE) } :
        k === "off" ? { ...base, access: "comment" as const, offAt: now } :
        k === "expired" ? { ...base, access: "comment" as const, expiresAt: now + DAY } :
        { ...base, access: "comment" as const };
      const id = await ctx.db.insert("shares", row);
      if (k === "expired") await ctx.db.patch(id, { expiresAt: now - DAY }); // the dashboard refuses a past date; the smoke test needs one
      have.set(k, (await ctx.db.get(id))!);
      made.push(k);
    };
    for (const k of ["comment", "view", "pass", "off", "expired"] as Kind[]) if (!have.has(k)) await mk(k);
    const tokens = Object.fromEntries([...have].map(([k, s]) => [k, s.token])) as Record<Kind, string>;
    return { videoId, madeVideo, made, tokens, passcode: PASSCODE };
  },
});

export const clip = internalQuery({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    const ver = (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect()).find((x) => x.number === 1);
    return ver ? { fileUrl: ver.fileUrl ?? null, storagePath: ver.storagePath ?? null } : null;
  },
});

/** Everything the smoke run needs, plus a check that the clip itself answers through its signed link. */
export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<Record<string, unknown>> => {
    const f: any = await ctx.runMutation(internal.smoke.ensure, {});
    const clip: any = await ctx.runQuery(internal.smoke.clip, { videoId: f.videoId as Id<"videos"> });
    let clipStatus: number | null = null;
    let uploaded = false;
    if (clip?.fileUrl) {
      const u = await signUrl(clip.fileUrl, clip.storagePath ? { folder: renderFolder(clip.storagePath) } : {});
      const head = async () => { try { return (await fetch(u, { method: "HEAD" })).status; } catch { return 0; } };
      clipStatus = await head();
      // The clip lives in the review zone under its own path; put it there (from the public lab copy) if it's gone.
      const z = reviewStorage();
      if (clipStatus === 404 && z && clip.storagePath) {
        const src = await fetch(LAB_CLIP());
        if (src.ok) {
          const put = await fetch(`https://${z.host}/${z.zone}/${clip.storagePath}`, { method: "PUT", headers: { AccessKey: z.password, "content-type": "video/mp4" }, body: new Uint8Array(await src.arrayBuffer()) });
          uploaded = put.ok;
          clipStatus = await head();
        }
      }
    }
    return { ...f, clipStatus, uploaded, site: SITE() };
  },
});
