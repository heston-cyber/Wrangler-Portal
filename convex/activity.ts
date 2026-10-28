// The Activity page: new videos, new versions and notes, newest first.
// Notes left in one sitting (same person, same version, no gap over 3 hours) are one entry.
import { v } from "convex/values";
import { query } from "./lib/functions";
import { requireMe } from "./lib/access";
import type { Doc, Id } from "./_generated/dataModel";
import { signedThumbUrl } from "./lib/media";
import { labelOf } from "./lib/shareAccess";

const SITTING_GAP_MS = 3 * 3600_000;

type VersionInfo = {
  versionId: Id<"versions">; videoId: Id<"videos">; videoTitle: string; projectName: string | null;
  number: number; bunnyGuid: string; thumbUrl: string | null; status: Doc<"versions">["status"]; frameCount: number | null;
  fpsNum: number; fpsDen: number; startTimecode: string;
};

export const feed = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireMe(ctx);
    const max = Math.min(Math.max(limit ?? 60, 1), 200);
    const versions = await ctx.db.query("versions").collect();
    const videos = new Map((await ctx.db.query("videos").collect()).map((x) => [x._id as string, x]));
    const projects = new Map((await ctx.db.query("projects").collect()).map((x) => [x._id as string, x]));
    const info = new Map<string, VersionInfo>();
    for (const ver of versions) {
      const vid = videos.get(ver.videoId);
      if (!vid) continue;
      info.set(ver._id, {
        versionId: ver._id, videoId: ver.videoId, videoTitle: vid.title, projectName: projects.get(vid.projectId)?.name ?? null,
        number: ver.number, bunnyGuid: ver.bunnyGuid, thumbUrl: await signedThumbUrl(ver), status: ver.status, frameCount: ver.frameCount ?? null,
        fpsNum: ver.fpsNum ?? 24000, fpsDen: ver.fpsDen ?? 1001, startTimecode: ver.startTimecode,
      });
    }

    type Event =
      | { type: "version"; at: number; actor: string | null; version: VersionInfo }
      | { type: "notes"; at: number; actor: string; version: VersionInfo; notes: NoteCard[] }
      | { type: "share"; at: number; actor: string; kind: "opened" | "viewed"; share: { _id: Id<"shares">; label: string; shareKind: Doc<"shares">["kind"] }; videoId: Id<"videos"> | null; videoTitle: string | null };
    type NoteCard = { _id: Id<"notes">; kind: Doc<"notes">["kind"]; inFrame: number | null; outFrame: number | null; text: string; hasDrawing: boolean; still: string | null; status: Doc<"notes">["status"]; createdAt: number };
    const events: Event[] = [];

    for (const ver of versions) {
      const i = info.get(ver._id);
      if (i) events.push({ type: "version", at: ver.createdAt, actor: ver.uploaderName ?? null, version: i });
    }

    const notes = (await ctx.db.query("notes").order("desc").take(1000)).sort((a, b) => b.createdAt - a.createdAt);
    let open: Extract<Event, { type: "notes" }> | null = null;
    let lastAt = 0;
    for (const n of notes) {
      const i = info.get(n.versionId);
      if (!i) continue;
      const card: NoteCard = {
        _id: n._id, kind: n.kind, inFrame: n.inFrame ?? null, outFrame: n.outFrame ?? null, text: n.text.slice(0, 400),
        hasDrawing: Boolean(n.drawing), still: n.still ?? null, status: n.status, createdAt: n.createdAt,
      };
      if (open && open.version.versionId === n.versionId && open.actor === n.authorName && lastAt - n.createdAt <= SITTING_GAP_MS) {
        open.notes.push(card);
      } else {
        open = { type: "notes", at: n.createdAt, actor: n.authorName, version: i, notes: [card] };
        events.push(open);
      }
      lastAt = n.createdAt;
    }
    // Share activity (C2): someone opened a share or viewed a video through it. Notes they leave are notes above.
    const labels = new Map<string, { label: string; shareKind: Doc<"shares">["kind"] }>();
    for (const a of await ctx.db.query("shareActivity").withIndex("by_at").order("desc").take(300)) {
      if (a.kind === "note") continue;
      let l = labels.get(a.shareId);
      if (!l) {
        const s = await ctx.db.get(a.shareId);
        if (!s) continue;
        l = { label: (await labelOf(ctx, s)).label, shareKind: s.kind };
        labels.set(a.shareId, l);
      }
      const vid = a.videoId ? videos.get(a.videoId) : null;
      events.push({ type: "share", at: a.at, actor: a.who, kind: a.kind, share: { _id: a.shareId, ...l }, videoId: a.videoId ?? null, videoTitle: vid?.title ?? null });
    }
    // Inside a sitting, show notes in timeline order.
    for (const e of events) if (e.type === "notes") e.notes.sort((a, b) => (a.inFrame ?? -1) - (b.inFrame ?? -1) || a.createdAt - b.createdAt);
    return events.sort((a, b) => b.at - a.at).slice(0, max);
  },
});
