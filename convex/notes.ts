import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { requireMe } from "./lib/access";

const kind = v.union(v.literal("frame"), v.literal("range"), v.literal("general"));
const MAX_TEXT = 5000;
const NOTIFY_DELAY_MS = 90_000; // gather notes for 90 s, then one Slack message

export const forVersion = query({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    await requireMe(ctx);
    const notes = await ctx.db.query("notes").withIndex("by_version", (q) => q.eq("versionId", versionId)).collect();
    const out = [];
    for (const n of notes) {
      const replies = await ctx.db.query("replies").withIndex("by_note", (q) => q.eq("noteId", n._id)).collect();
      out.push({ ...n, replies: replies.sort((a, b) => a.createdAt - b.createdAt) });
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
  },
  handler: async (ctx, a) => {
    const me = await requireMe(ctx);
    const ver = await ctx.db.get(a.versionId);
    if (!ver) throw new ConvexError("That version no longer exists.");
    checkFrames(a.kind, a.inFrame, a.outFrame);
    const text = a.text.trim().slice(0, MAX_TEXT);
    if (!text && !a.drawing) throw new ConvexError("Write a note or draw something first.");
    if (a.drawing && JSON.stringify(a.drawing).length > 200_000) throw new ConvexError("That drawing is too big.");
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
      status: "open",
      authorName: me.name,
      authorId: me.userId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(ver.videoId, { updatedAt: now });
    await ctx.scheduler.runAfter(NOTIFY_DELAY_MS, internal.slack.newNotes, { versionId: a.versionId });
    return id;
  },
});

export const editText = mutation({
  args: { noteId: v.id("notes"), text: v.string() },
  handler: async (ctx, { noteId, text }) => {
    await requireMe(ctx);
    await ctx.db.patch(noteId, { text: text.trim().slice(0, MAX_TEXT), updatedAt: Date.now() });
  },
});

export const setStatus = mutation({
  args: { noteId: v.id("notes"), status: v.union(v.literal("open"), v.literal("done")) },
  handler: async (ctx, { noteId, status }) => {
    await requireMe(ctx);
    await ctx.db.patch(noteId, { status, doneAt: status === "done" ? Date.now() : undefined, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { noteId: v.id("notes") },
  handler: async (ctx, { noteId }) => {
    await requireMe(ctx);
    const replies = await ctx.db.query("replies").withIndex("by_note", (q) => q.eq("noteId", noteId)).collect();
    for (const r of replies) await ctx.db.delete(r._id);
    await ctx.db.delete(noteId);
  },
});

export const reply = mutation({
  args: { noteId: v.id("notes"), text: v.string() },
  handler: async (ctx, { noteId, text }) => {
    const me = await requireMe(ctx);
    const t = text.trim().slice(0, MAX_TEXT);
    if (!t) throw new ConvexError("Write a reply first.");
    if (!(await ctx.db.get(noteId))) throw new ConvexError("That note no longer exists.");
    return await ctx.db.insert("replies", { noteId, text: t, authorName: me.name, authorId: me.userId, createdAt: Date.now() });
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
