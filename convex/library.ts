// Projects, videos and versions: what the home page and the video page read.
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireMe } from "./lib/access";
import { isValidTc } from "./lib/frames";
import type { Doc, Id } from "./_generated/dataModel";

const clean = (s: string, max = 200) => s.trim().replace(/\s+/g, " ").slice(0, max);

export const home = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const projects = await ctx.db.query("projects").collect();
    const videos = await ctx.db.query("videos").collect();
    const out = [];
    for (const p of projects.sort((a, b) => b.createdAt - a.createdAt)) {
      const vids = videos.filter((x) => x.projectId === p._id).sort((a, b) => b.updatedAt - a.updatedAt);
      const vidsOut = [];
      for (const vid of vids) {
        const versions = await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect();
        const latest = versions.sort((a, b) => b.number - a.number)[0] ?? null;
        const notes = await ctx.db.query("notes").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect();
        vidsOut.push({
          _id: vid._id,
          title: vid.title,
          updatedAt: vid.updatedAt,
          versionCount: versions.length,
          latest: latest && { number: latest.number, status: latest.status, bunnyGuid: latest.bunnyGuid, encodeProgress: latest.encodeProgress ?? 0 },
          openNotes: notes.filter((n) => n.status === "open" && n.versionId === latest?._id).length,
        });
      }
      out.push({ _id: p._id, name: p.name, jobNumber: p.jobNumber ?? null, client: p.client ?? null, videos: vidsOut });
    }
    return out;
  },
});

export const projectNames = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const projects = await ctx.db.query("projects").collect();
    return projects.sort((a, b) => b.createdAt - a.createdAt).map((p) => ({ _id: p._id, name: p.name }));
  },
});

export const createProject = mutation({
  args: { name: v.string(), jobNumber: v.optional(v.string()), client: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const name = clean(a.name, 120);
    if (!name) throw new ConvexError("Give the project a name.");
    return await ctx.db.insert("projects", {
      name,
      jobNumber: a.jobNumber ? clean(a.jobNumber, 40) : undefined,
      client: a.client ? clean(a.client, 120) : undefined,
      createdAt: Date.now(),
    });
  },
});

export const createVideo = mutation({
  args: { projectId: v.id("projects"), title: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const title = clean(a.title, 160);
    if (!title) throw new ConvexError("Give the video a title.");
    if (!(await ctx.db.get(a.projectId))) throw new ConvexError("That project no longer exists.");
    const now = Date.now();
    return await ctx.db.insert("videos", { projectId: a.projectId, title, createdAt: now, updatedAt: now });
  },
});

export const renameVideo = mutation({
  args: { videoId: v.id("videos"), title: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const title = clean(a.title, 160);
    if (!title) throw new ConvexError("Give the video a title.");
    await ctx.db.patch(a.videoId, { title, updatedAt: Date.now() });
  },
});

// Everything the video page needs about one video.
export const video = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await requireMe(ctx);
    const vid = await ctx.db.get(videoId);
    if (!vid) return null;
    const project = await ctx.db.get(vid.projectId);
    const versions = await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    return {
      _id: vid._id,
      title: vid.title,
      project: project && { _id: project._id, name: project.name, jobNumber: project.jobNumber ?? null },
      versions: versions.sort((a, b) => a.number - b.number).map(publicVersion),
    };
  },
});

export function publicVersion(x: Doc<"versions">) {
  return {
    _id: x._id,
    number: x.number,
    status: x.status,
    bunnyGuid: x.bunnyGuid,
    fileName: x.fileName,
    fpsNum: x.fpsNum ?? 24000,
    fpsDen: x.fpsDen ?? 1001,
    frameCount: x.frameCount ?? null,
    width: x.width ?? null,
    height: x.height ?? null,
    startTimecode: x.startTimecode,
    mp4Heights: x.mp4Heights ?? [],
    encodeProgress: x.encodeProgress ?? 0,
    error: x.error ?? null,
    createdAt: x.createdAt,
  };
}

export const setStartTimecode = mutation({
  args: { versionId: v.id("versions"), startTimecode: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const tc = a.startTimecode.trim().replace(";", ":");
    if (!isValidTc(tc)) throw new ConvexError("Use HH:MM:SS:FF, like 01:00:00:00.");
    await ctx.db.patch(a.versionId, { startTimecode: tc });
  },
});

// The player reports the real frame count once it has loaded the video (Bunny only gives whole seconds).
export const reportFrameCount = mutation({
  args: { versionId: v.id("versions"), frameCount: v.number() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const ver = await ctx.db.get(a.versionId);
    if (!ver || !Number.isInteger(a.frameCount) || a.frameCount <= 0 || a.frameCount > 10_000_000) return;
    if (ver.frameCount !== a.frameCount) await ctx.db.patch(a.versionId, { frameCount: a.frameCount });
  },
});

// ---- internal, used by uploads.ts ----

export const insertVersion = internalMutation({
  args: { videoId: v.id("videos"), bunnyGuid: v.string(), fileName: v.string(), fileSize: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", a.videoId)).collect();
    const number = existing.reduce((m, x) => Math.max(m, x.number), 0) + 1;
    const id = await ctx.db.insert("versions", {
      videoId: a.videoId,
      number,
      status: "uploading",
      bunnyGuid: a.bunnyGuid,
      fileName: a.fileName.slice(0, 300),
      fileSize: a.fileSize,
      startTimecode: "01:00:00:00",
      createdAt: Date.now(),
    });
    await ctx.db.patch(a.videoId, { updatedAt: Date.now() });
    return { versionId: id as Id<"versions">, number };
  },
});

export const getVersionInternal = internalQuery({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    const ver = await ctx.db.get(versionId);
    if (!ver) return null;
    const vid = await ctx.db.get(ver.videoId);
    const project = vid ? await ctx.db.get(vid.projectId) : null;
    return { version: ver, video: vid, project };
  },
});

export const patchVersion = internalMutation({
  args: { versionId: v.id("versions"), patch: v.any() },
  handler: async (ctx, { versionId, patch }) => {
    const allowed = ["status", "fpsNum", "fpsDen", "width", "height", "lengthSeconds", "mp4Heights", "encodeProgress", "pollCount", "error", "readyAt"];
    const p: Record<string, unknown> = {};
    for (const k of allowed) if (k in patch) p[k] = patch[k];
    await ctx.db.patch(versionId, p);
  },
});
