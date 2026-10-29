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
      | { type: "share"; at: number; actor: string; kind: "opened" | "viewed"; share: { _id: Id<"shares">; label: string; shareKind: Doc<"shares">["kind"] }; videoId: Id<"videos"> | null; videoTitle: string | null }
      | { type: "approval"; at: number; actor: string; version: VersionInfo };
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
    // Client approvals (Phase 1): "{name} approved v{n} of {video}".
    for (const a of await ctx.db.query("clientApprovals").withIndex("by_at").order("desc").take(300)) {
      const i = info.get(a.versionId);
      if (i) events.push({ type: "approval", at: a.at, actor: a.name, version: i });
    }
    // Inside a sitting, show notes in timeline order.
    for (const e of events) if (e.type === "notes") e.notes.sort((a, b) => (a.inFrame ?? -1) - (b.inFrame ?? -1) || a.createdAt - b.createdAt);
    return events.sort((a, b) => b.at - a.at).slice(0, max);
  },
});

// ---------- Phase 1 (Oct 29): recent activity on the back-office Home ----------
// One list across Review (opened, watched, notes), Sign (viewed, signed, all signed) and the Inbox (read), newest
// first: "Maya watched Harbor Coffee 30s v2", "Jordan left 2 notes", "Maya read your note", "WS-00004 signed by Maya".
const SIGN_KINDS: Record<string, "viewed" | "signed" | "all_signed"> = { link_opened: "viewed", opened: "viewed", viewed: "viewed", signed: "signed", all_signed: "all_signed" };

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireMe(ctx);
    const max = Math.min(Math.max(limit ?? 20, 1), 100);
    type Row = { at: number; who: string; what: "opened" | "watched" | "notes" | "read" | "approved" | "doc_viewed" | "doc_signed" | "doc_all_signed"; label: string; count?: number; ref: { kind: "share" | "video" | "document" | "note"; id: string } };
    const rows: Row[] = [];
    const labels = new Map<string, string>();
    const videoLabel = async (id: Id<"videos">) => {
      if (labels.has(id)) return labels.get(id)!;
      const vid = await ctx.db.get(id);
      const l = vid?.title ?? "a video";
      labels.set(id, l);
      return l;
    };
    for (const a of await ctx.db.query("shareActivity").withIndex("by_at").order("desc").take(300)) {
      if (a.kind === "note") continue; // notes come from the notes table, grouped
      if (a.kind === "viewed" && a.videoId) rows.push({ at: a.at, who: a.who, what: "watched", label: await videoLabel(a.videoId), ref: { kind: "video", id: a.videoId } });
      else if (a.kind === "opened") { const s = await ctx.db.get(a.shareId); if (s) rows.push({ at: a.at, who: a.who, what: "opened", label: (await labelOf(ctx, s)).label, ref: { kind: "share", id: s._id } }); }
    }
    for (const a of await ctx.db.query("clientApprovals").withIndex("by_at").order("desc").take(200)) {
      rows.push({ at: a.at, who: a.name, what: "approved", label: `v${a.versionNumber} of ${await videoLabel(a.videoId)}`, ref: { kind: "video", id: a.videoId } });
    }
    // Client and guest notes, one row per person per video per sitting.
    const notes = (await ctx.db.query("notes").order("desc").take(500)).filter((n) => n.shareId);
    const groups = new Map<string, Row>();
    for (const n of notes) {
      const k = `${n.authorName}|${n.videoId}|${Math.floor(n.createdAt / SITTING_GAP_MS)}`;
      const g = groups.get(k);
      if (g) { g.count = (g.count ?? 1) + 1; continue; }
      const row: Row = { at: n.createdAt, who: n.authorName, what: "notes", label: await videoLabel(n.videoId), count: 1, ref: { kind: "video", id: n.videoId } };
      groups.set(k, row); rows.push(row);
    }
    for (const e of await ctx.db.query("wsEvents").order("desc").take(400)) {
      const what = SIGN_KINDS[e.kind];
      if (!what) continue;
      const d = await ctx.db.get(e.documentId);
      if (!d) continue;
      const signer = e.email ? (await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", d._id)).collect()).find((s) => s.email === e.email)?.name : undefined;
      rows.push({ at: e.at, who: signer ?? (e.actor.startsWith("signer:") ? "A signer" : "System"), what: what === "viewed" ? "doc_viewed" : what === "signed" ? "doc_signed" : "doc_all_signed", label: `${`WS-${String(d.number).padStart(5, "0")}`} ${d.title}`, ref: { kind: "document", id: d._id } });
    }
    for (const i of (await ctx.db.query("inboxItems").order("desc").take(500)).filter((x) => x.readAt && x.kind === "note")) {
      const u = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", i.email)).unique();
      rows.push({ at: i.readAt!, who: (u?.name as string | undefined) ?? i.email, what: "read", label: i.title, ref: { kind: "note", id: i.noteId ?? i._id } });
    }
    return rows.sort((a, b) => b.at - a.at).slice(0, max);
  },
});
