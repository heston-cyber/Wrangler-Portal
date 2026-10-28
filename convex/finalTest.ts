// Phase R2b live test (Oct 22): a throwaway "Approve final test" video with four versions of the public lab clip,
// in the "Tests" project, NOT numbered (so no register number is used up). Run from CI; returns counts, numbers
// and Bunny status codes only. Removed with removeFinalTest when the test is done.
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { bunnyCall, bunnyEnv } from "./bunny";
import { LAB_CLIP } from "./lib/site";

const PROJECT = "Tests";
const TITLE = "Approve final test";

async function importClip(tag: string): Promise<string> {
  const { lib } = bunnyEnv();
  const fetched = (await bunnyCall(`/library/${lib}/videos/fetch`, { method: "POST", body: JSON.stringify({ url: LAB_CLIP(), title: tag }) })) as { id?: string };
  let guid: string | null = typeof fetched?.id === "string" && fetched.id ? fetched.id : null;
  for (let i = 0; i < 20 && !guid; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const found = (await bunnyCall(`/library/${lib}/videos?page=1&itemsPerPage=10&search=${encodeURIComponent(tag)}`)) as { items?: Array<{ guid: string; title: string }> };
    guid = found.items?.find((x) => x.title === tag)?.guid ?? null;
  }
  if (!guid) throw new Error("Bunny didn't start the import.");
  return guid;
}

export const target = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"videos">> => {
    const p = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", PROJECT)).first();
    const projectId = p?._id ?? (await ctx.db.insert("projects", { name: PROJECT, createdAt: Date.now() }));
    const vids = await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect();
    const existing = vids.find((x) => x.title === TITLE);
    if (existing) return existing._id;
    const now = Date.now();
    return await ctx.db.insert("videos", { projectId, title: TITLE, createdAt: now, updatedAt: now });
  },
});

export const addVersionRow = internalMutation({
  args: { videoId: v.id("videos"), guid: v.string(), withNote: v.boolean() },
  handler: async (ctx, a): Promise<number> => {
    const existing = await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", a.videoId)).collect();
    const number = existing.reduce((m, x) => Math.max(m, x.number), 0) + 1;
    const versionId = await ctx.db.insert("versions", {
      videoId: a.videoId, number, status: "processing", pollCount: 0, bunnyGuid: a.guid, fileName: "frametest_23976_h264.mp4",
      startTimecode: "01:00:00:00", uploaderName: "R2b test", createdAt: Date.now(),
    });
    await ctx.db.patch(a.videoId, { updatedAt: Date.now(), final: undefined }); // same as any new version
    if (a.withNote) {
      const now = Date.now();
      const noteId = await ctx.db.insert("notes", { versionId, videoId: a.videoId, kind: "frame", inFrame: 10, text: `Test note on v${number}`, status: "open", authorName: "R2b test", createdAt: now, updatedAt: now });
      await ctx.db.insert("replies", { noteId, text: "Test reply", authorName: "R2b test", createdAt: now });
    }
    await ctx.scheduler.runAfter(5000, internal.uploads.poll, { versionId });
    return number;
  },
});

// Adds `count` versions (each a fresh Bunny import of the lab clip), each with a note and a reply.
export const seed = internalAction({
  args: { count: v.number(), notes: v.optional(v.boolean()) },
  handler: async (ctx, { count, notes }): Promise<{ videoId: Id<"videos">; added: number[] }> => {
    const videoId: Id<"videos"> = await ctx.runMutation(internal.finalTest.target, {});
    const added: number[] = [];
    for (let i = 0; i < count; i++) {
      const guid = await importClip(`r2b-final-test-${Date.now()}-${i}`);
      added.push(await ctx.runMutation(internal.finalTest.addVersionRow, { videoId, guid, withNote: notes ?? true }));
    }
    return { videoId, added };
  },
});

export const state = internalQuery({
  args: {},
  handler: async (ctx) => {
    const p = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", PROJECT)).first();
    const vid = p ? (await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).find((x) => x.title === TITLE) : null;
    if (!vid) return { exists: false };
    const versions = (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()).sort((a, b) => a.number - b.number);
    const notes = await ctx.db.query("notes").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect();
    let replies = 0;
    for (const n of notes) replies += (await ctx.db.query("replies").withIndex("by_note", (q) => q.eq("noteId", n._id)).collect()).length;
    return {
      exists: true, videoId: vid._id, number: vid.number ?? null, final: vid.final ?? null,
      versions: versions.map((x) => ({ n: x.number, status: x.status, guid: x.bunnyGuid, mb: x.storageBytes ? Math.round(x.storageBytes / 1e5) / 10 : null, notes: notes.filter((m) => m.versionId === x._id).length })),
      notes: notes.length, replies,
    };
  },
});

// What Bunny says about these guids (404 = deleted).
export const bunnyStatus = internalAction({
  args: { guids: v.array(v.string()) },
  handler: async (_ctx, { guids }) => {
    const { lib, key } = bunnyEnv();
    const out: Record<string, number> = {};
    for (const g of guids) {
      const r = await fetch(`https://video.bunnycdn.com/library/${lib}/videos/${encodeURIComponent(g)}`, { headers: { AccessKey: key, accept: "application/json" } });
      out[g.slice(0, 8)] = r.status;
      await r.text();
    }
    return out;
  },
});

// Removes the test video and its Bunny copies.
export const removeFinalTest = internalMutation({
  args: {},
  handler: async (ctx) => {
    const p = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", PROJECT)).first();
    if (!p) return { removed: 0 };
    const vids = (await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).filter((x) => x.title === TITLE);
    let removed = 0;
    for (const vid of vids) {
      for (const ver of await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()) {
        for (const n of await ctx.db.query("notes").withIndex("by_version", (q) => q.eq("versionId", ver._id)).collect()) {
          for (const r of await ctx.db.query("replies").withIndex("by_note", (q) => q.eq("noteId", n._id)).collect()) await ctx.db.delete(r._id);
          await ctx.db.delete(n._id);
        }
        for (const t of await ctx.db.query("transcripts").withIndex("by_version", (q) => q.eq("versionId", ver._id)).collect()) await ctx.db.delete(t._id);
        for (const w of await ctx.db.query("waveforms").withIndex("by_version", (q) => q.eq("versionId", ver._id)).collect()) await ctx.db.delete(w._id);
        await ctx.scheduler.runAfter(0, internal.stills.cleanup, { bunnyGuid: ver.bunnyGuid, stillUrls: [] });
        await ctx.db.delete(ver._id);
        removed++;
      }
      for (const o of await ctx.db.query("opens").collect()) if (o.videoId === vid._id) await ctx.db.delete(o._id);
      await ctx.db.delete(vid._id);
    }
    const left = await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", p._id)).first();
    if (!left) await ctx.db.delete(p._id);
    return { removed };
  },
});
