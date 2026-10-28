// Test data for the connector acceptance test (Phase 4). Run from CI with `convex run`.
// Makes a "Connector test" video that plays the same render as a real video, copies that video's notes
// (with their saved frames and drawings) and adds edge-case notes, so there are 15 notes with known answers.
// The real video and its notes are left untouched. Logs are public, so it returns ids and counts only.
import { internalMutation } from "./lib/functions";
import { v } from "convex/values";

const TEST_PROJECT = "Tests";
const TEST_TITLE = "Connector test (Spirit Days Intro)";

// [kind, inFrame, outFrame, text]
const EXTRA: Array<["frame" | "range" | "general", number | null, number | null, string]> = [
  ["frame", 0, null, "T01 First frame: make sure the slate is gone"],
  ["frame", 3148, null, "T02 Last frame: hold on the logo 12 more frames"],
  ["range", 0, 23, "T03 Fade up from black over the first second"],
  ["range", 3100, 3148, "T04 Tail: take the music out under the logo"],
  ["range", 1200, 1201, "T05 Two-frame flash here?"],
  ["frame", 1201, null, "T06 Same frame as the end of T05: kill the flash frame"],
  ["range", 2000, 2399, "T07 B-roll run: swap to wider shots"],
  ["frame", 2500, null, "T08 Lower third typo: 'Spirt' should be 'Spirit'"],
  ["general", null, null, "T09 Loudness: master to -14 LUFS"],
  ["frame", 1657, null, "T10 Second note on this frame: colour match to the shot before"],
  ["range", 700, 800, "T11 Overlaps the range above: crossfade instead of a cut"],
];

export const seedConnectorTest = internalMutation({
  args: { sourceVideoId: v.id("videos") },
  handler: async (ctx, { sourceVideoId }) => {
    const src = (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", sourceVideoId)).collect()).sort((a, b) => b.number - a.number)[0];
    if (!src) throw new Error("source video has no versions");
    let project = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", TEST_PROJECT)).first();
    const projectId = project?._id ?? (await ctx.db.insert("projects", { name: TEST_PROJECT, createdAt: Date.now() }));
    const already = (await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect()).find((x) => x.title === TEST_TITLE);
    if (already) return { already: true, videoId: already._id };

    const now = Date.now();
    const videoId = await ctx.db.insert("videos", { projectId, title: TEST_TITLE, createdAt: now, updatedAt: now });
    const { _id, _creationTime, videoId: _v, number: _n, ...rest } = src;
    const versionId = await ctx.db.insert("versions", { ...rest, videoId, number: 1, description: "Test copy for the connector acceptance test", createdAt: now });

    let copied = 0;
    for (const n of await ctx.db.query("notes").withIndex("by_version", (q) => q.eq("versionId", src._id)).collect()) {
      const { _id: _i, _creationTime: _c, versionId: _vv, videoId: _vi, ...note } = n;
      await ctx.db.insert("notes", { ...note, versionId, videoId, status: "open", doneAt: undefined, notifiedAt: undefined });
      copied++;
    }
    let i = 0;
    for (const [kind, inFrame, outFrame, text] of EXTRA) {
      await ctx.db.insert("notes", {
        versionId, videoId, kind, text, status: "open", authorName: "Test notes",
        ...(inFrame !== null ? { inFrame } : {}), ...(outFrame !== null ? { outFrame } : {}),
        createdAt: now + ++i, updatedAt: now + i,
      });
    }
    return { already: false, videoId, versionId, copied, added: EXTRA.length, total: copied + EXTRA.length };
  },
});

// Removes the test video, its version, notes and replies (only that video).
export const removeConnectorTest = internalMutation({
  args: {},
  handler: async (ctx) => {
    const project = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", TEST_PROJECT)).first();
    if (!project) return { removed: 0 };
    const vid = (await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", project._id)).collect()).find((x) => x.title === TEST_TITLE);
    if (!vid) return { removed: 0 };
    let removed = 0;
    for (const n of await ctx.db.query("notes").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()) {
      for (const r of await ctx.db.query("replies").withIndex("by_note", (q) => q.eq("noteId", n._id)).collect()) await ctx.db.delete(r._id);
      await ctx.db.delete(n._id); removed++;
    }
    for (const ver of await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()) await ctx.db.delete(ver._id);
    await ctx.db.delete(vid._id);
    const left = await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", project._id)).first();
    if (!left) await ctx.db.delete(project._id);
    return { removed };
  },
});
