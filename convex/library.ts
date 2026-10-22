// Projects, videos and versions: what the home page and the video page read.
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { requireMe } from "./lib/access";
import { isValidTc } from "./lib/frames";
import type { Doc, Id } from "./_generated/dataModel";
import { insertVideo, nextFileName } from "./lib/register";
import { scrubUrls, thumbUrl } from "./lib/media";

const clean = (s: string, max = 200) => s.trim().replace(/\s+/g, " ").slice(0, max);

export const projectNames = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const projects = await ctx.db.query("projects").collect();
    return projects.sort((a, b) => b.createdAt - a.createdAt).map((p) => ({ _id: p._id, name: p.name }));
  },
});

// One read for Home, Projects, the sidebar and search: every project and video with its latest version.
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMe(ctx);
    const projects = await ctx.db.query("projects").collect();
    const videos = await ctx.db.query("videos").collect();
    const opens = await ctx.db.query("opens").withIndex("by_user", (q) => q.eq("userId", me.userId)).collect();
    const openedAt = new Map(opens.map((o) => [o.videoId as string, o.openedAt]));
    const vidsOut = [];
    for (const vid of videos) {
      const versions = await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect();
      const latest = versions.sort((a, b) => b.number - a.number)[0] ?? null;
      const notes = await ctx.db.query("notes").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect();
      const tr = latest ? await ctx.db.query("transcripts").withIndex("by_version", (q) => q.eq("versionId", latest._id)).first() : null;
      const storageBytes = versions.reduce((sum, x) => sum + (x.storageBytes ?? 0), 0);
      vidsOut.push({
        _id: vid._id,
        projectId: vid.projectId,
        title: vid.title,
        number: vid.number ?? null,
        shortTitle: vid.shortTitle ?? null,
        final: vid.final ?? null,
        firstUploadAt: versions.length ? Math.min(...versions.map((x) => x.createdAt)) : null,
        storageBytes: versions.some((x) => x.storageBytes !== undefined) ? storageBytes : null,
        source: latest ? (latest.dropboxPath ? "Dropbox" : "Browser") : null,
        createdAt: vid.createdAt,
        updatedAt: vid.updatedAt,
        lastOpenedAt: openedAt.get(vid._id) ?? null,
        versionCount: versions.length,
        noteCount: notes.length,
        openNotes: latest ? notes.filter((n) => n.status === "open" && n.versionId === latest._id).length : 0,
        latest: latest && {
          number: latest.number, status: latest.status, bunnyGuid: latest.bunnyGuid, thumbUrl: thumbUrl(latest), encodeProgress: latest.encodeProgress ?? 0, isFile: latest.source === "file",
          frameCount: latest.frameCount ?? null, fpsNum: latest.fpsNum ?? 24000, fpsDen: latest.fpsDen ?? 1001,
          startTimecode: latest.startTimecode, width: latest.width ?? null, height: latest.height ?? null,
          transcript: tr?.status ?? null,
        },
      });
    }
    return {
      projects: projects.map((p) => ({
        _id: p._id, name: p.name, jobNumber: p.jobNumber ?? null, client: p.client ?? null, createdAt: p.createdAt,
        videoCount: videos.filter((x) => x.projectId === p._id).length,
        updatedAt: Math.max(p.createdAt, ...videos.filter((x) => x.projectId === p._id).map((x) => x.updatedAt)),
      })),
      videos: vidsOut,
      // Clients made with "New client" (they show even before they have projects).
      clients: (await ctx.db.query("clients").collect()).map((c) => c.name).sort((a, b) => a.localeCompare(b)),
    };
  },
});

// "New client": a client with no projects yet. A name already used by a client (made here or on a project) is refused.
export const createClient = mutation({
  args: { name: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const name = clean(a.name, 120);
    if (!name) throw new ConvexError("Give the client a name.");
    const key = name.toLowerCase();
    if (name.toLowerCase() === "no client") throw new ConvexError("Pick another name.");
    const made = (await ctx.db.query("clients").collect()).some((c) => c.name.toLowerCase() === key);
    const onProjects = (await ctx.db.query("projects").collect()).some((p) => (p.client ?? "").trim().toLowerCase() === key);
    if (made || onProjects) throw new ConvexError(`There's already a client called ${name}.`);
    await ctx.db.insert("clients", { name, createdAt: Date.now() });
    return name;
  },
});

// Remembers that I opened a video (for "Last opened").
export const markOpened = mutation({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    const me = await requireMe(ctx);
    const row = await ctx.db.query("opens").withIndex("by_user_video", (q) => q.eq("userId", me.userId).eq("videoId", videoId)).unique();
    if (row) await ctx.db.patch(row._id, { openedAt: Date.now() });
    else await ctx.db.insert("opens", { userId: me.userId, videoId, openedAt: Date.now() });
  },
});

export const renameProject = mutation({
  args: { projectId: v.id("projects"), name: v.string(), jobNumber: v.optional(v.string()), client: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const name = clean(a.name, 120);
    if (!name) throw new ConvexError("Give the project a name.");
    const p = await ctx.db.get(a.projectId);
    await ctx.db.patch(a.projectId, {
      name,
      jobNumber: a.jobNumber !== undefined ? clean(a.jobNumber, 40) || undefined : undefined,
      // Leaving client out keeps what's there; an empty string clears it.
      client: a.client !== undefined ? clean(a.client, 120) || undefined : p?.client,
    });
  },
});

export const setVersionDescription = mutation({
  args: { versionId: v.id("versions"), description: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    await ctx.db.patch(a.versionId, { description: a.description.trim().slice(0, 2000) || undefined });
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
    return (await insertVideo(ctx, { projectId: a.projectId, title })).videoId;
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
    const notes = await ctx.db.query("notes").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    const trs = new Map<string, string>();
    for (const x of versions) {
      const t = await ctx.db.query("transcripts").withIndex("by_version", (q) => q.eq("versionId", x._id)).first();
      if (t) trs.set(x._id, t.status);
    }
    return {
      _id: vid._id,
      title: vid.title,
      number: vid.number ?? null,
      shortTitle: vid.shortTitle ?? null,
      final: vid.final ?? null,
      nextFileName: nextFileName(vid, versions.reduce((m, x) => Math.max(m, x.number), 0)),
      project: project && { _id: project._id, name: project.name, jobNumber: project.jobNumber ?? null },
      versions: versions.sort((a, b) => a.number - b.number).map((x) => ({
        ...publicVersion(x),
        noteCount: notes.filter((n) => n.versionId === x._id).length,
        openCount: notes.filter((n) => n.versionId === x._id && n.status === "open").length,
        transcript: (trs.get(x._id) ?? null) as "pending" | "running" | "done" | "failed" | null,
      })),
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
    frameCountExact: x.frameCountFrom === "file",
    width: x.width ?? null,
    height: x.height ?? null,
    startTimecode: x.startTimecode,
    mp4Heights: x.mp4Heights ?? [],
    encodeProgress: x.encodeProgress ?? 0,
    error: x.error ?? null,
    description: x.description ?? null,
    uploaderName: x.uploaderName ?? null,
    fileSize: x.fileSize ?? null,
    dropboxPath: x.dropboxPath ?? null,
    createdAt: x.createdAt,
    streamOnly: x.streamOnly ?? false,
    storageBytes: x.storageBytes ?? null,
    source: x.source ?? "stream",
    fileUrl: x.source === "file" ? x.fileUrl ?? null : null,
    scrub: scrubUrls(x),
    scrubStatus: x.scrubStatus ?? null,
    thumbUrl: thumbUrl(x),
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

// Fallback only: the player's estimate from the video's length. It can be one high when the audio runs
// past the last picture, so it never replaces a count read from the file itself.
export const reportFrameCount = mutation({
  args: { versionId: v.id("versions"), frameCount: v.number() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const ver = await ctx.db.get(a.versionId);
    if (!ver || ver.frameCountFrom === "file") return;
    if (!Number.isInteger(a.frameCount) || a.frameCount <= 0 || a.frameCount > 10_000_000) return;
    if (ver.frameCount !== a.frameCount) await ctx.db.patch(a.versionId, { frameCount: a.frameCount, frameCountFrom: "player" });
  },
});

// ---- internal, used by uploads.ts ----

export const insertVersion = internalMutation({
  args: { videoId: v.id("videos"), bunnyGuid: v.string(), fileName: v.string(), fileSize: v.optional(v.number()), uploaderName: v.optional(v.string()) },
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
      uploaderName: a.uploaderName,
      createdAt: Date.now(),
    });
    await ctx.db.patch(a.videoId, { updatedAt: Date.now(), final: undefined }); // a new version reopens an approved video
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
    const allowed = ["status", "fpsNum", "fpsDen", "width", "height", "lengthSeconds", "mp4Heights", "encodeProgress", "pollCount", "error", "readyAt", "frameCount", "frameCountFrom", "stages", "storageBytes", "storageCheckedAt", "fileUrl", "copyError", "scrubGuid", "scrubStatus", "scrubPolls", "scrubReadyAt"];
    const p: Record<string, unknown> = {};
    for (const k of allowed) if (k in patch) p[k] = patch[k];
    await ctx.db.patch(versionId, p);
  },
});

// Ready versions whose frame count hasn't been read from the file yet.
export const versionsNeedingCount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("versions").collect();
    return all.filter((x) => x.status === "ready" && x.frameCountFrom !== "file").map((x) => x._id);
  },
});

// Deleting things on the site. Nothing here ever touches Dropbox: originals stay where they are.
// Removes a version's notes, replies, recordings, transcript and links to Dropbox rows; returns what to clean up
// outside the database (its Bunny video and still images), which happens after the last delete in the batch.
async function removeVersion(ctx: MutationCtx, ver: Doc<"versions">, why: string, stills: Set<string>, guids: Set<string>) {
  const notes = await ctx.db.query("notes").withIndex("by_version", (q) => q.eq("versionId", ver._id)).collect();
  for (const n of notes) {
    for (const u of [n.still, n.stillIn, n.stillOut, ...(n.voice?.pointers ?? []).map((p) => p.still)]) if (u) stills.add(u);
    if (n.voice) await ctx.storage.delete(n.voice.storageId).catch(() => null);
    for (const r of await ctx.db.query("replies").withIndex("by_note", (q) => q.eq("noteId", n._id)).collect()) await ctx.db.delete(r._id);
    await ctx.db.delete(n._id);
  }
  for (const t of await ctx.db.query("transcripts").withIndex("by_version", (q) => q.eq("versionId", ver._id)).collect()) {
    if (t.storageId) await ctx.storage.delete(t.storageId).catch(() => null);
    await ctx.db.delete(t._id);
  }
  for (const w of await ctx.db.query("waveforms").withIndex("by_version", (q) => q.eq("versionId", ver._id)).collect()) await ctx.db.delete(w._id);
  for (const f of await ctx.db.query("dropFiles").withIndex("by_version", (q) => q.eq("versionId", ver._id)).collect()) {
    await ctx.db.patch(f._id, { versionId: undefined, reason: why });
  }
  if (ver.bunnyGuid) guids.add(ver.bunnyGuid);
  if (ver.storagePath) guids.add(`storage:${ver.storagePath}`);
  if (ver.scrubGuid) guids.add(`scrub:${ver.scrubGuid}`);
  await ctx.db.delete(ver._id);
}

// After deleting: keep any Bunny video or still that something left on the site still uses (test copies can share).
async function scheduleCleanup(ctx: MutationCtx, stills: Set<string>, guids: Set<string>) {
  if (stills.size) {
    for (const other of await ctx.db.query("notes").collect()) {
      for (const u of [other.still, other.stillIn, other.stillOut, ...(other.voice?.pointers ?? []).map((p) => p.still)]) if (u) stills.delete(u);
    }
  }
  const gone: string[] = [];
  for (const g of guids) {
    if (g.startsWith("storage:") || g.startsWith("scrub:")) { gone.push(g); continue; }
    if (!(await ctx.db.query("versions").withIndex("by_guid", (q) => q.eq("bunnyGuid", g)).first())) gone.push(g);
  }
  for (let i = 0; i < Math.max(gone.length, 1); i++) {
    await ctx.scheduler.runAfter(i * 500, internal.stills.cleanup, { bunnyGuid: gone[i] ?? null, stillUrls: i === 0 ? [...stills] : [] });
  }
}

// For test helpers: removes one video (all its versions and their files) the same way the site does.
export async function removeVideoAndFiles(ctx: MutationCtx, videoId: Id<"videos">) {
  const stills = new Set<string>(), guids = new Set<string>();
  await removeVideo(ctx, videoId, stills, guids);
  await scheduleCleanup(ctx, stills, guids);
  return guids.size;
}

async function removeVideo(ctx: MutationCtx, videoId: Id<"videos">, stills: Set<string>, guids: Set<string>) {
  for (const ver of await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect()) {
    await removeVersion(ctx, ver, "Its video was deleted on the site.", stills, guids);
  }
  for (const o of await ctx.db.query("opens").collect()) if (o.videoId === videoId) await ctx.db.delete(o._id);
  await ctx.db.delete(videoId);
}

async function removeProject(ctx: MutationCtx, projectId: Id<"projects">, stills: Set<string>, guids: Set<string>) {
  const videos = await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect();
  for (const vid of videos) await removeVideo(ctx, vid._id, stills, guids);
  await ctx.db.delete(projectId);
  return videos.length;
}

// One version. The other versions keep their numbers.
export const deleteVersion = mutation({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    await requireMe(ctx);
    const ver = await ctx.db.get(versionId);
    if (!ver) throw new ConvexError("That version no longer exists.");
    const stills = new Set<string>(), guids = new Set<string>();
    await removeVersion(ctx, ver, `Its version (v${ver.number}) was deleted on the site.`, stills, guids);
    await ctx.db.patch(ver.videoId, { updatedAt: Date.now() });
    await scheduleCleanup(ctx, stills, guids);
    return { deleted: ver.number };
  },
});

// A whole project: every video in it, with all their versions.
export const deleteProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireMe(ctx);
    if (!(await ctx.db.get(projectId))) throw new ConvexError("That project no longer exists.");
    const stills = new Set<string>(), guids = new Set<string>();
    const videos = await removeProject(ctx, projectId, stills, guids);
    await scheduleCleanup(ctx, stills, guids);
    return { videos };
  },
});

// A client: every project filed under it. The page asks for the client's name to be typed first; so does this.
export const deleteClient = mutation({
  args: { client: v.string(), typed: v.string() },
  handler: async (ctx, { client, typed }) => {
    await requireMe(ctx);
    const c = client.trim();
    if (!c) throw new ConvexError("Which client?");
    if (typed.trim() !== c) throw new ConvexError(`Type ${c} exactly to delete it.`);
    const projects = (await ctx.db.query("projects").collect()).filter((p) => (p.client ?? "").trim().toLowerCase() === c.toLowerCase());
    const made = (await ctx.db.query("clients").collect()).filter((x) => x.name.toLowerCase() === c.toLowerCase());
    if (!projects.length && !made.length) throw new ConvexError("There's no client by that name.");
    for (const x of made) await ctx.db.delete(x._id);
    const stills = new Set<string>(), guids = new Set<string>();
    let videos = 0;
    for (const p of projects) videos += await removeProject(ctx, p._id, stills, guids);
    if (projects.length) await scheduleCleanup(ctx, stills, guids);
    return { projects: projects.length, videos };
  },
});

// ---------- Approve final (R2b, Oct 22) ----------
// Keeps one version and deletes everything belonging to the others, right away: their Bunny files, notes, drawings,
// replies, stills, transcripts and voice notes. Dropbox originals are never touched. Heston chose no undo.
export const approveFinal = mutation({
  args: { videoId: v.id("videos"), keep: v.number() },
  handler: async (ctx, { videoId, keep }) => {
    await requireMe(ctx);
    const vid = await ctx.db.get(videoId);
    if (!vid) throw new ConvexError("That video no longer exists.");
    const versions = await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect();
    const kept = versions.find((x) => x.number === keep);
    if (!kept) throw new ConvexError(`There's no v${keep}.`);
    if (kept.status !== "ready") throw new ConvexError(`v${keep} isn't ready yet. Approve a version that plays.`);
    const stills = new Set<string>(), guids = new Set<string>();
    const deleted: number[] = [];
    let freed = 0;
    for (const ver of versions.sort((a, b) => a.number - b.number)) {
      if (ver._id === kept._id) continue;
      freed += ver.storageBytes ?? 0;
      deleted.push(ver.number);
      await removeVersion(ctx, ver, `Deleted by Approve final (kept v${keep}).`, stills, guids);
    }
    const now = Date.now();
    await ctx.db.patch(videoId, { final: { version: keep, at: now }, updatedAt: now });
    if (deleted.length) await scheduleCleanup(ctx, stills, guids);
    return { kept: keep, deleted, freedBytes: freed };
  },
});

// Takes the Final badge off without deleting anything.
export const clearFinal = mutation({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await requireMe(ctx);
    await ctx.db.patch(videoId, { final: undefined });
  },
});

export const versionsForStorage = internalQuery({
  args: { all: v.boolean() },
  handler: async (ctx, { all }) => {
    const cutoff = Date.now() - 11 * 3600_000;
    return (await ctx.db.query("versions").collect())
      .filter((x) => x.status === "ready" && (x.bunnyGuid || (x.source === "file" && x.scrubGuid)) && (all || !x.storageCheckedAt || x.storageCheckedAt < cutoff))
      .map((x) => ({ _id: x._id, bunnyGuid: x.bunnyGuid, scrubGuid: x.source === "file" ? x.scrubGuid ?? null : null, fileSize: x.fileSize ?? 0 }));
  },
});
