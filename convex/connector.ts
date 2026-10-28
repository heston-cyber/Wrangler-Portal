// The Claude connector's data side: connector keys, and the reads/writes its tools use.
// Keys are stored only as SHA-256 hashes; the full key is shown once, on the Settings page.
import { action } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { requireMe } from "./lib/access";
import type { Doc, Id } from "./_generated/dataModel";
import { frameTc, fpsValue, type Fps } from "./lib/frames";
import { markersEdl } from "./lib/edl";
import { nextFileName, pad5, videoByNumber } from "./lib/register";
import { numberVideo } from "./register";

import { base64url, sha256Hex } from "./lib/hash";
import { signStillUrl } from "./lib/media";
import { SITE } from "./lib/site";
import { defaultBusiness } from "./lib/business";
export { sha256Hex };

// ---------- keys ----------

// Made in an action so the key comes from real randomness. Returned once; only its hash is kept.
export const createKey = action({
  args: { label: v.optional(v.string()) },
  handler: async (ctx, a): Promise<{ key: string; prefix: string }> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const key = "wr_" + base64url(bytes);
    const prefix = key.slice(0, 10);
    await ctx.runMutation(internal.connector.insertKey, { hash: await sha256Hex(key), prefix, label: (a.label ?? "").trim().slice(0, 60) || "Claude" });
    return { key, prefix };
  },
});

export const insertKey = internalMutation({
  args: { hash: v.string(), prefix: v.string(), label: v.string() },
  handler: async (ctx, a) => {
    await ctx.db.insert("connectorKeys", { hash: a.hash, prefix: a.prefix, label: a.label, createdAt: Date.now() });
  },
});

export const listKeys = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const keys = await ctx.db.query("connectorKeys").collect();
    return keys.filter((k) => !k.revokedAt).sort((a, b) => b.createdAt - a.createdAt)
      .map((k) => ({ _id: k._id, prefix: k.prefix, label: k.label, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt ?? null }));
  },
});

export const revokeKey = mutation({
  args: { keyId: v.id("connectorKeys") },
  handler: async (ctx, { keyId }) => {
    await requireMe(ctx);
    await ctx.db.patch(keyId, { revokedAt: Date.now() });
  },
});

// Every connector request: is this key live? Notes when it was last used (at most once a minute).
export const checkKey = internalMutation({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const row = await ctx.db.query("connectorKeys").withIndex("by_hash", (q) => q.eq("hash", hash)).unique();
    if (!row || row.revokedAt) return false as const;
    const now = Date.now();
    if (!row.lastUsedAt || now - row.lastUsedAt > 60_000) await ctx.db.patch(row._id, { lastUsedAt: now });
    // Phase 0.5d step 4: the key's business (records made before tagging count as the default business's).
    return { businessId: row.businessId ?? (await defaultBusiness(ctx))?._id ?? null };
  },
});

// For the live self-test only: a short-lived key that the test removes when it's done.
export const insertTestKey = internalMutation({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => ctx.db.insert("connectorKeys", { hash, prefix: "wr_selftest", label: "Self-test (temporary)", createdAt: Date.now() }),
});
export const deleteKey = internalMutation({
  args: { keyId: v.id("connectorKeys") },
  handler: async (ctx, { keyId }) => { await ctx.db.delete(keyId); },
});

// ---------- shared helpers for the tools ----------

const site = () => SITE();
const COLOR_NAMES: Record<string, string> = { "#ff3b30": "red", "#ffd60a": "yellow", "#ffffff": "white", "#30d5ff": "cyan" };
const pct = (x: number) => Math.round(x * 1000) / 10;
const kindName = (k: Doc<"notes">["kind"]) => (k === "general" ? "whole_video" : k);
const fpsOf = (ver: Doc<"versions">): Fps => ({ num: ver.fpsNum ?? 24000, den: ver.fpsDen ?? 1001 });
const iso = (t: number) => new Date(t).toISOString();

// Drawing shapes in words and percentages of the picture (0,0 = top-left, 100,100 = bottom-right).
function describeDrawing(drawing: unknown) {
  const shapes = (drawing as { shapes?: Array<Record<string, unknown>> } | null)?.shapes;
  if (!Array.isArray(shapes)) return null;
  return shapes.map((s) => {
    const color = COLOR_NAMES[String(s.c).toLowerCase()] ?? String(s.c);
    if (s.t === "pen") {
      const pts = (s.pts as [number, number, number][]) ?? [];
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return {
        tool: "freehand", color,
        bounds_pct: pts.length ? { left: pct(Math.min(...xs)), top: pct(Math.min(...ys)), right: pct(Math.max(...xs)), bottom: pct(Math.max(...ys)) } : null,
        start_pct: pts.length ? [pct(pts[0][0]), pct(pts[0][1])] : null,
        end_pct: pts.length ? [pct(pts[pts.length - 1][0]), pct(pts[pts.length - 1][1])] : null,
      };
    }
    const x1 = Number(s.x1), y1 = Number(s.y1), x2 = Number(s.x2), y2 = Number(s.y2);
    if (s.t === "arrow") return { tool: "arrow", color, from_pct: [pct(x1), pct(y1)], points_to_pct: [pct(x2), pct(y2)] };
    return {
      tool: s.t === "box" ? "box" : "circle", color,
      bounds_pct: { left: pct(Math.min(x1, x2)), top: pct(Math.min(y1, y2)), right: pct(Math.max(x1, x2)), bottom: pct(Math.max(y1, y2)) },
    };
  });
}

type Found = { video: Doc<"videos">; project: Doc<"projects"> | null } | { error: string; candidates?: Array<{ video_id: string; title: string; project: string | null }> };

// A video by id, or by words from its title / project / job number.
export async function findVideo(ctx: QueryCtx, videoId?: string, words?: string): Promise<Found> {
  if (videoId) {
    const id = ctx.db.normalizeId("videos", videoId);
    const vid = id ? await ctx.db.get(id) : null;
    if (!vid) return { error: `No video with id ${videoId}. Use find_videos to look it up.` };
    return { video: vid, project: await ctx.db.get(vid.projectId) };
  }
  if (!words?.trim()) return { error: "Give video_id or video (words from the title, project or job number)." };
  const q = words.toLowerCase().trim();
  // A register number ("00001" or "1") or a register file name ("00001_LCArizona_v4") finds that video.
  const num = /^(\d{1,5})(?:_|$)/.exec(q);
  if (num) {
    const vid = await videoByNumber(ctx, Number(num[1]));
    if (vid) return { video: vid, project: await ctx.db.get(vid.projectId) };
  }
  const projects = new Map((await ctx.db.query("projects").collect()).map((p) => [p._id as string, p]));
  const scored = (await ctx.db.query("videos").collect()).map((vid) => {
    const p = projects.get(vid.projectId);
    const t = vid.title.toLowerCase();
    const hay = `${t} ${p?.name.toLowerCase() ?? ""} ${p?.jobNumber ?? ""}`;
    const terms = q.split(/\s+/).filter(Boolean);
    let score = t === q ? 100 : t.includes(q) ? 60 : 0;
    score += terms.filter((w) => hay.includes(w)).length * 10;
    return { vid, p, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || b.vid.updatedAt - a.vid.updatedAt);
  if (!scored.length) return { error: `No video matches "${words}". Use find_videos to see what's there.` };
  if (scored.length > 1 && scored[1].score === scored[0].score) {
    return { error: `More than one video matches "${words}". Ask which one, or pass video_id.`, candidates: scored.slice(0, 6).map((x) => ({ video_id: x.vid._id, title: x.vid.title, project: x.p?.name ?? null })) };
  }
  return { video: scored[0].vid, project: scored[0].p ?? null };
}

export async function pickVersion(ctx: QueryCtx, videoId: Id<"videos">, number?: number) {
  const versions = (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect()).sort((a, b) => a.number - b.number);
  if (!versions.length) return { error: "This video has no versions yet." } as const;
  const ver = number ? versions.find((x) => x.number === number) : versions[versions.length - 1];
  if (!ver) return { error: `There's no v${number}. Versions: ${versions.map((x) => "v" + x.number).join(", ")}.` } as const;
  return { ver, versions } as const;
}

export function versionInfo(ver: Doc<"versions">) {
  const fps = fpsOf(ver);
  const count = ver.frameCount ?? null;
  return {
    number: ver.number,
    file_name: ver.fileName,
    status: ver.status,
    frame_rate: Number(fpsValue(fps).toFixed(3)),
    frame_rate_exact: `${fps.num}/${fps.den}`,
    start_timecode: ver.startTimecode,
    frame_count: count,
    frame_count_exact: ver.frameCountFrom === "file",
    last_frame_timecode: count ? frameTc(count - 1, ver.startTimecode, fps) : null,
    width: ver.width ?? null,
    height: ver.height ?? null,
    uploaded: iso(ver.createdAt),
    description: ver.description ?? null,
  };
}

// ---------- tool reads ----------

export const findVideos = internalQuery({
  args: { query: v.optional(v.string()) },
  handler: async (ctx, { query: words }) => {
    const projects = new Map((await ctx.db.query("projects").collect()).map((p) => [p._id as string, p]));
    const q = (words ?? "").toLowerCase().trim();
    const out = [];
    const all = await ctx.db.query("videos").collect();
    const qn0 = /^\d{1,5}$/.test(q) ? pad5(Number(q)) : null;
    // A number finds that register number; if no video has it (e.g. a job number), search words as usual.
    const numberMode = Boolean(qn0 && all.some((x) => x.number && pad5(x.number) === qn0));
    for (const vid of all) {
      const p = projects.get(vid.projectId);
      const num = vid.number ? pad5(vid.number) : "";
      const hay = `${vid.title} ${p?.name ?? ""} ${p?.jobNumber ?? ""} ${p?.client ?? ""} ${num} ${vid.shortTitle ?? ""}`.toLowerCase();
      if (numberMode ? qn0 !== num : q && !q.split(/\s+/).every((w) => hay.includes(w))) continue;
      const versions = (await ctx.db.query("versions").withIndex("by_video", (x) => x.eq("videoId", vid._id)).collect()).sort((a, b) => a.number - b.number);
      const notes = await ctx.db.query("notes").withIndex("by_video", (x) => x.eq("videoId", vid._id)).collect();
      const next = nextFileName(vid, versions.length ? versions[versions.length - 1].number : 0);
      out.push({
        video_id: vid._id,
        number: num || null,
        title: vid.title,
        next_render: next ? next + ".mp4" : null,
        final: vid.final ? `v${vid.final.version} (approved ${iso(vid.final.at).slice(0, 10)})` : null,
        project: p?.name ?? null,
        job_number: p?.jobNumber ?? null,
        client: p?.client ?? null,
        updated: iso(vid.updatedAt),
        link: `${site()}/v/${vid._id}`,
        versions: versions.map((ver) => ({
          number: ver.number, status: ver.status, uploaded: iso(ver.createdAt),
          open_notes: notes.filter((n) => n.versionId === ver._id && n.status === "open").length,
          total_notes: notes.filter((n) => n.versionId === ver._id).length,
        })),
      });
    }
    return out.sort((a, b) => (a.updated < b.updated ? 1 : -1)).slice(0, 50);
  },
});

export const notesFor = internalQuery({
  args: { videoId: v.optional(v.string()), video: v.optional(v.string()), version: v.optional(v.number()), status: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const found = await findVideo(ctx, a.videoId, a.video);
    if ("error" in found) return found;
    const pv = await pickVersion(ctx, found.video._id, a.version);
    if ("error" in pv) return { error: pv.error };
    const { ver, versions } = pv;
    const fps = fpsOf(ver);
    const status = a.status === "done" || a.status === "all" ? a.status : "open";
    const all = await ctx.db.query("notes").withIndex("by_version", (q) => q.eq("versionId", ver._id)).collect();
    const picked = all.filter((n) => status === "all" || n.status === status)
      .sort((x, y) => (x.inFrame ?? -1) - (y.inFrame ?? -1) || x.createdAt - y.createdAt);
    const notes = [];
    for (const n of picked) {
      const replies = (await ctx.db.query("replies").withIndex("by_note", (q) => q.eq("noteId", n._id)).collect()).sort((x, y) => x.createdAt - y.createdAt);
      const isRange = n.kind === "range";
      notes.push({
        note_id: n._id,
        type: kindName(n.kind),
        status: n.status,
        in_frame: n.kind === "general" ? null : n.inFrame ?? null,
        out_frame: isRange ? n.outFrame ?? null : n.kind === "frame" ? n.inFrame ?? null : null,
        length_frames: isRange ? (n.outFrame! - n.inFrame! + 1) : n.kind === "frame" ? 1 : null,
        in_timecode: n.kind === "general" ? null : frameTc(n.inFrame!, ver.startTimecode, fps),
        out_timecode: isRange ? frameTc(n.outFrame!, ver.startTimecode, fps) : n.kind === "frame" ? frameTc(n.inFrame!, ver.startTimecode, fps) : null,
        text: n.text,
        author: n.authorName,
        created: iso(n.createdAt),
        drawing: n.drawing ? { on_frame: n.drawFrame ?? n.inFrame ?? null, on_timecode: (n.drawFrame ?? n.inFrame) !== undefined ? frameTc((n.drawFrame ?? n.inFrame)!, ver.startTimecode, fps) : null, shapes: describeDrawing(n.drawing) } : null,
        has_images: Boolean(n.still || n.stillIn || n.stillOut || n.voice?.pointers.some((p) => p.still)),
        voice: n.voice ? {
          seconds: Math.round(n.voice.durationMs / 100) / 10,
          played_while_talking: n.voice.played,
          said: n.voice.words.map((w) => w.t).join(" "),
          pointing_words: n.voice.pointers.map((p) => ({ word: p.word, frame: p.f, timecode: frameTc(p.f, ver.startTimecode, fps), has_still: Boolean(p.still) })),
          note: "text is what Heston posted (he may have edited the transcript); said is the raw transcript. Each pointing word is pinned to the frame on screen when he said it.",
        } : null,
        replies: replies.map((r) => ({ author: r.authorName, text: r.text, created: iso(r.createdAt) })),
        link: `${site()}/v/${found.video._id}?version=${ver.number}&note=${n._id}`,
      });
    }
    return {
      video: { video_id: found.video._id, title: found.video.title, project: found.project?.name ?? null, job_number: found.project?.jobNumber ?? null },
      version: versionInfo(ver),
      other_versions: versions.filter((x) => x._id !== ver._id).map((x) => x.number),
      showing: status,
      counts: { open: all.filter((n) => n.status === "open").length, done: all.filter((n) => n.status === "done").length },
      frames_note: "Frames count from 0 at the render's first frame. out_frame is the last frame of a range, inclusive. Timecodes use the version's start timecode.",
      notes,
    };
  },
});

export const notesForImages = internalQuery({
  args: { noteIds: v.array(v.string()) },
  handler: async (ctx, { noteIds }) => {
    const out = [];
    for (const raw of noteIds.slice(0, 8)) {
      const id = ctx.db.normalizeId("notes", raw);
      const n = id ? await ctx.db.get(id) : null;
      if (!n) { out.push({ note_id: raw, missing: true as const }); continue; }
      const ver = await ctx.db.get(n.versionId);
      const fps = ver ? fpsOf(ver) : { num: 24000, den: 1001 };
      const tc = (f?: number) => (f === undefined || !ver ? null : frameTc(f, ver.startTimecode, fps));
      out.push({
        note_id: raw, missing: false as const, type: kindName(n.kind), text: n.text,
        in_timecode: tc(n.inFrame), out_timecode: n.kind === "range" ? tc(n.outFrame) : null,
        drawing_timecode: n.drawing ? tc(n.drawFrame ?? n.inFrame) : null,
        still: (await signStillUrl(n.still)) ?? null, stillIn: n.kind === "range" ? (await signStillUrl(n.stillIn)) ?? null : null, stillOut: n.kind === "range" ? (await signStillUrl(n.stillOut)) ?? null : null,
        pointers: await Promise.all((n.voice?.pointers ?? []).filter((p) => p.still).map(async (p) => ({ word: p.word, timecode: tc(p.f), still: (await signStillUrl(p.still))! }))),
      });
    }
    return out;
  },
});

export const markersFor = internalQuery({
  args: { videoId: v.optional(v.string()), video: v.optional(v.string()), version: v.optional(v.number()), status: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const found = await findVideo(ctx, a.videoId, a.video);
    if ("error" in found) return found;
    const pv = await pickVersion(ctx, found.video._id, a.version);
    if ("error" in pv) return { error: pv.error };
    const ver = pv.ver;
    const fps = fpsOf(ver);
    const status = a.status === "done" || a.status === "all" ? a.status : "open";
    const notes = (await ctx.db.query("notes").withIndex("by_version", (q) => q.eq("versionId", ver._id)).collect())
      .filter((n) => status === "all" || n.status === status)
      .sort((x, y) => (x.inFrame ?? -1) - (y.inFrame ?? -1));
    const color = { frame: "Blue", range: "Yellow", general: "Green" } as const;
    const kindLabel = { frame: "Frame", range: "Range", general: "Whole video" } as const;
    const one = notes.map((n) => {
      const frame = n.kind === "general" ? 0 : n.inFrame ?? 0;
      const label = (n.text || "(drawing only)").replace(/\s+/g, " ").trim();
      const duration = n.kind === "range" ? n.outFrame! - n.inFrame! + 1 : 1;
      return {
        note_id: n._id as string, kind: n.kind, frame, duration, label,
        line: `${kindLabel[n.kind]}${n.kind === "range" ? ` ${duration}f → ${frameTc(n.outFrame!, ver.startTimecode, fps)}` : ""}: ${label}${n.drawing ? " [has drawing: see get_note_images]" : ""}${n.status === "done" ? " [done]" : ""} (${n.authorName})`,
      };
    });
    // Resolve keeps one marker per frame, so notes that start on the same frame share a marker:
    // the longest duration wins, the colour follows the most specific note (range > frame > whole video),
    // and custom_data lists every note id, comma-separated.
    const rank = { range: 3, frame: 2, general: 1 } as const;
    const byFrame = new Map<number, typeof one>();
    for (const m of one) byFrame.set(m.frame, [...(byFrame.get(m.frame) ?? []), m]);
    const markers = [...byFrame.entries()].sort((a, b) => a[0] - b[0]).map(([frame, group]) => {
      const lead = [...group].sort((a, b) => rank[b.kind] - rank[a.kind] || b.duration - a.duration)[0];
      const many = group.length > 1;
      return {
        note_ids: group.map((m) => m.note_id),
        frame,
        timecode: frameTc(frame, ver.startTimecode, fps),
        duration_frames: Math.max(...group.map((m) => m.duration)),
        color: color[lead.kind],
        name: many ? `${group.length} notes: ${group.map((m) => m.label).join(" | ")}`.slice(0, 80) : `${kindLabel[lead.kind]}: ${lead.label.slice(0, 60)}`,
        note: many ? group.map((m) => `• ${m.line}`).join("\n") : lead.line.replace(/^[^:]+: /, ""),
        custom_data: group.map((m) => m.note_id).join(","),
      };
    });
    return {
      video: { video_id: found.video._id, title: found.video.title, project: found.project?.name ?? null },
      render: versionInfo(ver),
      placement: [
        "frame is counted from the render's first frame (frame 0). In DaVinci Resolve, timeline.AddMarker(frameId, color, name, note, duration, customData) takes frameId relative to the timeline's start, so a render of the whole timeline maps 1:1.",
        "Before placing anything, check the timeline matches this render: same frame rate, the timeline's start timecode equals render.start_timecode, and its length equals render.frame_count. If any differ, don't place markers. Tell Heston what differs and ask how to proceed.",
        "Use custom_data so markers can be matched back to notes later: it holds the note id, or several ids separated by commas. Resolve keeps only one marker per frame, so notes that start on the same frame are already merged into one marker here (note_ids lists them). Place exactly one marker per entry. Colours: Blue = frame, Yellow = range, Green = whole video. Whole-video notes go at frame 0; a merged marker takes the colour of its most specific note (range, then frame, then whole video), so frame 0 is only Green when it holds whole-video notes alone.",
      ],
      markers,
      edl: markersEdl(`${found.video.title} v${ver.number}`, notes.map((n) => ({ kind: n.kind, inFrame: n.inFrame, outFrame: n.outFrame, text: n.text, status: n.status, authorName: n.authorName })), ver.startTimecode, fps),
    };
  },
});

// ---------- tool writes (author: Claude) ----------

export const replyAsClaude = internalMutation({
  args: { noteId: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    const id = ctx.db.normalizeId("notes", a.noteId);
    const note = id ? await ctx.db.get(id) : null;
    if (!note || !id) throw new ConvexError(`No note with id ${a.noteId}.`);
    const text = a.text.trim().slice(0, 5000);
    if (!text) throw new ConvexError("The reply is empty.");
    await ctx.db.insert("replies", { noteId: id, text, authorName: "Claude", createdAt: Date.now(), hidden: true }); // private to Heston until he shows it (C3)
    await ctx.db.patch(note.videoId, { updatedAt: Date.now() });
    return { note_id: a.noteId, replied: true };
  },
});

export const setStatuses = internalMutation({
  args: { noteIds: v.array(v.string()), status: v.union(v.literal("open"), v.literal("done")) },
  handler: async (ctx, { noteIds, status }) => {
    const changed: string[] = [], missing: string[] = [];
    const now = Date.now();
    for (const raw of noteIds.slice(0, 200)) {
      const id = ctx.db.normalizeId("notes", raw);
      const n = id ? await ctx.db.get(id) : null;
      if (!n || !id) { missing.push(raw); continue; }
      await ctx.db.patch(id, { status, doneAt: status === "done" ? now : undefined, updatedAt: now });
      changed.push(raw);
    }
    return { status, changed, missing };
  },
});

// ---------- the register (Phase R2) ----------

export const nextRenderFor = internalQuery({
  args: { videoId: v.optional(v.string()), video: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const found = await findVideo(ctx, a.videoId, a.video);
    if ("error" in found) return found;
    const vid = found.video;
    const versions = await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect();
    const top = versions.reduce((m, x) => Math.max(m, x.number), 0);
    const name = nextFileName(vid, top);
    if (!name) return { error: `${vid.title} isn't in the register (it was made before numbering started), so it has no register file name.` };
    return {
      video_id: vid._id, number: pad5(vid.number!), title: vid.title, short_title: vid.shortTitle, project: found.project?.name ?? null,
      latest_version: top || null, next_version: top + 1, next_file_name: name + ".mp4", timeline_name: name,
      where: "Render with the Wrangler Review preset that matches the timeline (16x9 1920x1080, Scope 1920x804 or Vertical 1080x1920) into any folder inside Dropbox › Apps/Wrangler Review, with exactly this file name. The name decides the video.",
    };
  },
});

export const describeVersion = internalMutation({
  args: { videoId: v.optional(v.string()), video: v.optional(v.string()), version: v.optional(v.number()), description: v.string() },
  handler: async (ctx, a) => {
    const found = await findVideo(ctx, a.videoId, a.video);
    if ("error" in found) return found;
    const picked = await pickVersion(ctx, found.video._id, a.version);
    if ("error" in picked) return { error: picked.error };
    const text = a.description.trim().slice(0, 2000);
    await ctx.db.patch(picked.ver._id, { description: text || undefined });
    return { video: found.video.title, version: picked.ver.number, description: text || null };
  },
});

export const addToRegisterFor = internalMutation({
  args: { videoId: v.optional(v.string()), video: v.optional(v.string()), number: v.optional(v.number()), shortTitle: v.string(), client: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const found = await findVideo(ctx, a.videoId, a.video);
    if ("error" in found) return found;
    const r = await numberVideo(ctx, { videoId: found.video._id, number: a.number, shortTitle: a.shortTitle, client: a.client });
    return { video_id: found.video._id, number: r.number, title: r.title, next_file_name: r.next ? r.next + ".mp4" : null, timeline_name: r.next };
  },
});
