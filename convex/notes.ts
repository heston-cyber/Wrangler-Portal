import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMe } from "./lib/access";
import { accessToVersion, authorOf, noteVisible, ownsNote, shareArg, type Access } from "./lib/viewer";
import { signStillUrl } from "./lib/media";

const kind = v.union(v.literal("frame"), v.literal("range"), v.literal("general"));
const voiceArg = v.object({
  storageId: v.id("_storage"),
  mime: v.string(),
  durationMs: v.number(),
  language: v.optional(v.string()),
  played: v.boolean(),
  words: v.array(v.object({ t: v.string(), f: v.number(), s: v.number(), e: v.number() })),
  pointers: v.array(v.object({ word: v.string(), i: v.number(), f: v.number(), s: v.number(), still: v.optional(v.string()) })),
});
const MAX_TEXT = 5000;
const NOTIFY_DELAY_MS = 90_000; // gather notes for 90 s, then one Slack message

// The notes on a version. The owner sees every note and reply; a client or guest (through a share) sees shared notes
// and their visible replies. Stills come back as signed links when the stills zone needs them.
export const forVersion = query({
  args: { versionId: v.id("versions"), share: shareArg },
  handler: async (ctx, { versionId, share }) => {
    const { access } = await accessToVersion(ctx, versionId, share);
    if (access.can === "view") return []; // a view-only link shows no notes at all (Heston, Oct 23)
    const notes = await ctx.db.query("notes").withIndex("by_version", (q) => q.eq("versionId", versionId)).collect();
    const out = [];
    for (const n of notes) {
      if (!noteVisible(access, n)) continue;
      const replies = (await ctx.db.query("replies").withIndex("by_note", (q) => q.eq("noteId", n._id)).collect()).filter((r) => access.kind === "owner" || !r.hidden);
      const voiceUrl = n.voice ? await ctx.storage.getUrl(n.voice.storageId) : null;
      out.push({
        ...n,
        still: await signStillUrl(n.still), stillIn: await signStillUrl(n.stillIn), stillOut: await signStillUrl(n.stillOut),
        voice: n.voice ? { ...n.voice, pointers: await Promise.all(n.voice.pointers.map(async (p) => ({ ...p, still: await signStillUrl(p.still) }))) } : undefined,
        voiceUrl, replies: replies.sort((a, b) => a.createdAt - b.createdAt),
        mine: ownsNote(access, n), // may edit or delete (the owner: always; others: their own open notes)
        visibility: (n.visibility ?? "private") as "private" | "shared",
      });
    }
    // General notes first, then by frame.
    return out.sort((a, b) => (a.inFrame ?? -1) - (b.inFrame ?? -1) || a.createdAt - b.createdAt);
  },
});

function checkFrames(k: string, inFrame?: number, outFrame?: number) {
  const ok = (f?: number) => f !== undefined && Number.isInteger(f) && f >= 0 && f < 10_000_000;
  if (k === "frame" && !ok(inFrame)) throw new ConvexError("A frame note needs a frame.");
  if (k === "range") {
    if (!ok(inFrame) || !ok(outFrame)) throw new ConvexError("A range note needs a start and an end.");
    if ((outFrame as number) < (inFrame as number)) throw new ConvexError("The range ends before it starts.");
  }
}

export const create = mutation({
  args: {
    versionId: v.id("versions"),
    kind,
    inFrame: v.optional(v.number()),
    outFrame: v.optional(v.number()),
    drawFrame: v.optional(v.number()),
    text: v.string(),
    drawing: v.optional(v.any()),
    still: v.optional(v.string()),
    stillIn: v.optional(v.string()),
    stillOut: v.optional(v.string()),
    voice: v.optional(voiceArg),
    shared: v.optional(v.boolean()), // the owner's "Shared" switch on the note box; notes through a share are always shared
    share: shareArg,
  },
  handler: async (ctx, a) => {
    const { access, version: ver } = await accessToVersion(ctx, a.versionId, a.share, "comment");
    checkFrames(a.kind, a.inFrame, a.outFrame);
    const text = a.text.trim().slice(0, MAX_TEXT);
    if (!text && !a.drawing && !a.voice) throw new ConvexError("Write a note or draw something first.");
    if (a.voice) {
      if (a.voice.words.length > 20_000 || a.voice.pointers.length > 20) throw new ConvexError("That voice note is too long.");
      if (!(await ctx.db.system.get(a.voice.storageId))) throw new ConvexError("The recording didn't upload. Try again.");
    }
    if (a.drawing && JSON.stringify(a.drawing).length > 200_000) throw new ConvexError("That drawing is too big.");
    if (access.kind !== "owner") for (const u of [a.still, a.stillIn, a.stillOut, ...(a.voice?.pointers.map((p) => p.still) ?? [])]) if (u && !stillOk(u)) throw new ConvexError("That still isn't one of ours.");
    const now = Date.now();
    const id = await ctx.db.insert("notes", {
      versionId: a.versionId,
      videoId: ver.videoId,
      kind: a.kind,
      inFrame: a.kind === "general" ? undefined : a.inFrame,
      outFrame: a.kind === "range" ? a.outFrame : undefined,
      drawFrame: a.drawFrame,
      text,
      drawing: a.drawing,
      still: a.still,
      stillIn: a.stillIn,
      stillOut: a.stillOut,
      voice: a.voice,
      status: "open",
      authorName: authorOf(access),
      authorId: access.kind === "guest" ? undefined : access.userId,
      guestKey: access.kind === "guest" ? access.guestKey ?? undefined : undefined,
      shareId: access.share?._id,
      visibility: access.kind === "owner" ? (a.shared ? "shared" : "private") : "shared",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(ver.videoId, { updatedAt: now });
    if (access.share) await ctx.db.insert("shareActivity", { shareId: access.share._id, kind: "note", who: access.kind === "client" ? `${access.name} · ${access.email}` : authorOf(access), videoId: ver.videoId, noteId: id, at: now });
    await ctx.scheduler.runAfter(NOTIFY_DELAY_MS, internal.slack.newNotes, { versionId: a.versionId });
    return id;
  },
});

// A still URL a note may carry: only our stills zone or Convex storage, never an arbitrary address.
function stillOk(u: string) {
  const cdn = process.env.BUNNY_STILLS_CDN;
  return (cdn && u.startsWith(`https://${cdn}/stills/`)) || /^https:\/\/[\w.-]+\.convex\.cloud\/api\/storage\//.test(u);
}

async function noteFor(ctx: Parameters<typeof accessToVersion>[0], noteId: Id<"notes">, share: Parameters<typeof accessToVersion>[2], need: "view" | "comment"): Promise<{ note: Doc<"notes">; access: Access }> {
  const note = await ctx.db.get(noteId);
  if (!note) throw new ConvexError("That note no longer exists.");
  const { access } = await accessToVersion(ctx, note.versionId, share, need);
  if (!noteVisible(access, note)) throw new ConvexError("Not allowed.");
  return { note, access };
}

export const editText = mutation({
  args: { noteId: v.id("notes"), text: v.string(), share: shareArg },
  handler: async (ctx, { noteId, text, share }) => {
    const { note, access } = await noteFor(ctx, noteId, share, "comment");
    if (!ownsNote(access, note)) throw new ConvexError(note.status === "done" ? "That note is marked done; it can't be changed now." : "You can only change your own notes.");
    await ctx.db.patch(noteId, { text: text.trim().slice(0, MAX_TEXT), updatedAt: Date.now() });
  },
});

// Owner only: done / open.
export const setStatus = mutation({
  args: { noteId: v.id("notes"), status: v.union(v.literal("open"), v.literal("done")) },
  handler: async (ctx, { noteId, status }) => {
    await requireMe(ctx);
    await ctx.db.patch(noteId, { status, doneAt: status === "done" ? Date.now() : undefined, updatedAt: Date.now() });
  },
});

// Owner only (C3): the Shared switch on a note. Shared = everyone on a share covering the video can see it.
export const setVisibility = mutation({
  args: { noteId: v.id("notes"), visibility: v.union(v.literal("private"), v.literal("shared")) },
  handler: async (ctx, { noteId, visibility }) => {
    await requireMe(ctx);
    if (!(await ctx.db.get(noteId))) throw new ConvexError("That note no longer exists.");
    await ctx.db.patch(noteId, { visibility });
  },
});

// Owner only (C3): show or hide one reply (Claude's replies start hidden).
export const setReplyHidden = mutation({
  args: { replyId: v.id("replies"), hidden: v.boolean() },
  handler: async (ctx, { replyId, hidden }) => {
    await requireMe(ctx);
    if (!(await ctx.db.get(replyId))) throw new ConvexError("That reply no longer exists.");
    await ctx.db.patch(replyId, { hidden });
  },
});

export const remove = mutation({
  args: { noteId: v.id("notes"), share: shareArg },
  handler: async (ctx, { noteId, share }) => {
    const { note, access } = await noteFor(ctx, noteId, share, "comment");
    if (!ownsNote(access, note)) throw new ConvexError(note.status === "done" ? "That note is marked done; it can't be deleted now." : "You can only delete your own notes.");
    const replies = await ctx.db.query("replies").withIndex("by_note", (q) => q.eq("noteId", noteId)).collect();
    for (const r of replies) await ctx.db.delete(r._id);
    if (note.voice) await ctx.storage.delete(note.voice.storageId).catch(() => null);
    await ctx.db.delete(noteId);
  },
});

export const reply = mutation({
  args: { noteId: v.id("notes"), text: v.string(), share: shareArg },
  handler: async (ctx, { noteId, text, share }) => {
    const { access } = await noteFor(ctx, noteId, share, "comment");
    const t = text.trim().slice(0, MAX_TEXT);
    if (!t) throw new ConvexError("Write a reply first.");
    return await ctx.db.insert("replies", {
      noteId, text: t, authorName: authorOf(access), authorId: access.kind === "guest" ? undefined : access.userId,
      guestKey: access.kind === "guest" ? access.guestKey ?? undefined : undefined, createdAt: Date.now(),
    });
  },
});

// ---- internal, used by slack.ts ----

export const unnotified = internalQuery({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    const notes = await ctx.db.query("notes").withIndex("by_version", (q) => q.eq("versionId", versionId)).collect();
    return notes.filter((n) => !n.notifiedAt).sort((a, b) => (a.inFrame ?? -1) - (b.inFrame ?? -1));
  },
});

export const markNotified = internalMutation({
  args: { noteIds: v.array(v.id("notes")) },
  handler: async (ctx, { noteIds }) => {
    const now = Date.now();
    for (const id of noteIds) if (await ctx.db.get(id)) await ctx.db.patch(id, { notifiedAt: now });
  },
});

// Voice notes: where the browser sends the recording (private Convex storage). Anyone who may comment on the version.
export const voiceUploadUrl = mutation({
  args: { versionId: v.optional(v.id("versions")), share: shareArg },
  handler: async (ctx, { versionId, share }) => {
    if (versionId) await accessToVersion(ctx, versionId, share, "comment"); else await requireMe(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// A recorded draft you threw away: remove the recording (only if no note uses it).
export const discardVoice = mutation({
  args: { storageId: v.id("_storage"), versionId: v.optional(v.id("versions")), share: shareArg },
  handler: async (ctx, { storageId, versionId, share }) => {
    if (versionId) await accessToVersion(ctx, versionId, share, "comment"); else await requireMe(ctx);
    const used = (await ctx.db.query("notes").collect()).some((n) => n.voice?.storageId === storageId);
    if (!used) await ctx.storage.delete(storageId).catch(() => null);
  },
});
