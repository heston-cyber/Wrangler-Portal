// Phase R3 live test (Oct 22): register number 99999 is test-only (Heston, Oct 22), so 00002 stays free for the next
// real video. The test video lives in the "Tests" project (no Slack). Renders go in Dropbox › Apps › Wrangler Review ›
// R3 Test. Run from CI: returns statuses, sizes and timings for the test files only.
import { internalAction } from "./_generated/server";
import { internalMutation, internalQuery } from "./lib/functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { videoByNumber } from "./lib/register";
import { removeVideoAndFiles } from "./library";

const NUMBER = 99999;
const FOLDER = "/r3 test/";

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await videoByNumber(ctx, NUMBER)) return { created: false };
    const p = await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", "Tests")).first();
    const projectId = p?._id ?? (await ctx.db.insert("projects", { name: "Tests", createdAt: Date.now() }));
    const now = Date.now();
    // Not from the counter: 99999 never comes up in normal numbering.
    await ctx.db.insert("videos", { projectId, title: "R3 Test", number: NUMBER, shortTitle: "R3Test", createdAt: now, updatedAt: now });
    return { created: true };
  },
});

export const rows = internalQuery({
  args: {},
  handler: async (ctx) => {
    const vid = await videoByNumber(ctx, NUMBER);
    const versions = vid ? await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect() : [];
    const out = [];
    for (const x of versions) {
      const tr = await ctx.db.query("transcripts").withIndex("by_version", (q) => q.eq("versionId", x._id)).first();
      const wf = await ctx.db.query("waveforms").withIndex("by_version", (q) => q.eq("versionId", x._id)).first();
      out.push({
        v: x.number, source: x.source ?? "stream", status: x.status, error: x.error ?? null, file: x.fileName, mb: Math.round((x.fileSize ?? 0) / 1e5) / 10,
        frames: x.frameCount ?? null, exact: x.frameCountFrom ?? null, fps: x.fpsNum ? `${x.fpsNum}/${x.fpsDen}` : null, size: x.width ? `${x.width}x${x.height}` : null,
        createdAt: x.createdAt, readyAt: x.readyAt ?? null, copyMs: x.copyMs ?? null, copyError: x.copyError ?? null,
        scrub: x.scrubStatus ?? null, scrubReadyAt: x.scrubReadyAt ?? null, scrubPolls: x.scrubPolls ?? null, storageMB: x.storageBytes ? Math.round(x.storageBytes / 1e5) / 10 : null,
        transcript: tr ? `${tr.status}${tr.wordCount !== undefined ? ` ${tr.wordCount}w` : ""}${tr.error ? ` (${tr.error.slice(0, 80)})` : ""}` : null,
        waveform: wf ? `${wf.status}${wf.error ? ` (${wf.error.slice(0, 80)})` : ""}` : null,
      });
    }
    const drops = (await ctx.db.query("dropFiles").collect()).filter((f) => f.pathLower.startsWith(FOLDER)).map((f) => ({
      name: f.pathDisplay.split("/").pop(), pathLower: f.pathLower, status: f.status, reason: f.reason ?? null, mb: Math.round(f.size / 1e5) / 10,
      firstSeenAt: f.firstSeenAt, importedAt: f.importedAt ?? null, lastChangeAt: f.lastChangeAt, checks: f.checks,
    }));
    return { video: !!vid, versions: out, drops };
  },
});

// Timings are measured from the moment Dropbox finished the upload (its server_modified time).
export const state = internalAction({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const r: any = await ctx.runQuery(internal.reviewTest.rows, {});
    const token: string = await ctx.runAction(internal.dropbox.freshToken, {});
    const s = (a: number | null, b: number | null) => (a && b ? Math.round((b - a) / 100) / 10 : null);
    const drops = [];
    for (const d of r.drops) {
      const m = await fetch("https://api.dropboxapi.com/2/files/get_metadata", { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ path: d.pathLower }) });
      const meta = m.ok ? await m.json() as { server_modified?: string } : null;
      const done = meta?.server_modified ? Date.parse(meta.server_modified) : null;
      const ver = r.versions.find((x: any) => x.file === d.name);
      drops.push({
        name: d.name, mb: d.mb, status: d.status, reason: d.reason, checks: d.checks,
        seenAfterS: s(done, d.firstSeenAt), importStartAfterS: s(done, d.importedAt), readyAfterS: ver ? s(done, ver.readyAt) : null,
        copyS: ver?.copyMs ? Math.round(ver.copyMs / 100) / 10 : null, scrubAfterReadyS: ver ? s(ver.readyAt, ver.scrubReadyAt) : null,
      });
    }
    return { now: new Date().toISOString(), video: r.video, drops, versions: r.versions.map(({ createdAt, readyAt, scrubReadyAt, ...rest }: any) => rest) };
  },
});

// Is the connected Dropbox a team space? (Decides where Apps › Wrangler Review sits on disk.) No names.
export const dropboxRoot = internalAction({
  args: {},
  handler: async (ctx) => {
    const token: string = await ctx.runAction(internal.dropbox.freshToken, {});
    const res = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const a = await res.json() as { root_info?: { ".tag": string; root_namespace_id: string; home_namespace_id: string; home_path?: string }; account_type?: { ".tag": string } };
    return { status: res.status, rootTag: a.root_info?.[".tag"] ?? null, homeIsRoot: a.root_info ? a.root_info.root_namespace_id === a.root_info.home_namespace_id : null, homePathDepth: a.root_info?.home_path ? a.root_info.home_path.split("/").filter(Boolean).length : null, accountType: a.account_type?.[".tag"] ?? null };
  },
});

export const remove = internalMutation({
  args: {},
  handler: async (ctx) => {
    const vid = await videoByNumber(ctx, NUMBER);
    if (!vid) return { removed: false };
    const files = await removeVideoAndFiles(ctx, vid._id);
    const p = await ctx.db.get(vid.projectId);
    if (p && p.name === "Tests" && !(await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", p._id)).first())) await ctx.db.delete(p._id);
    return { removed: true, files };
  },
});
