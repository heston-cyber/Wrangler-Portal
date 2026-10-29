// Wrangler Portal Phase 1 (Oct 29): the Inbox. One-way: clients read it, and email stays the reply channel.
//   Client: mine, unreadCount, markRead, markAllRead (their own items only).
//   Owner:  forClient ("Their Inbox" on the client page), notes (the Sent list and drafts), saveNote, noteRecipients,
//           sendNote, discardNote. A note does nothing until the owner sends it on the site, including a draft Claude
//           wrote through the connector (T1.7).
//   Hooks:  onVersionReady, onReply (Review), onSignInvite, onSigned (Sign). Called where those emails are sent.
//           They only add Inbox rows; the emails themselves are unchanged until the one-email switch (task 10).
import { v, ConvexError } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { requireMe, requireSignedIn } from "./lib/access";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { businessOf, hasAccess, itemView, postToInbox } from "./lib/inbox";
import { shareCovers, shareState, sameBusiness } from "./lib/shareAccess";
import { signLink } from "./lib/wsSigning";
import { docLabel } from "./lib/wsLayout";

const MAX_TITLE = 120, MAX_TEXT = 2000, MAX_LINK = 500;
const projectLabel = (p: { name: string; jobNumber?: string } | null) => (p ? (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name) : "");
const eventKey = (key: string) => key.slice(0, key.lastIndexOf(":"));

// ---------- the client's side ----------

export const mine = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return { items: [], unread: 0 };
    const rows = await ctx.db.query("inboxItems").withIndex("by_email", (q) => q.eq("email", me.email)).order("desc").take(Math.min(Math.max(limit ?? 50, 1), 200));
    const unread = (await ctx.db.query("inboxItems").withIndex("by_email", (q) => q.eq("email", me.email)).collect()).filter((i) => !i.readAt).length;
    return { items: rows.map(itemView), unread };
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return 0;
    return (await ctx.db.query("inboxItems").withIndex("by_email", (q) => q.eq("email", me.email)).collect()).filter((i) => !i.readAt).length;
  },
});

export const markRead = mutation({
  args: { itemId: v.id("inboxItems") },
  handler: async (ctx, { itemId }) => {
    const me = await requireSignedIn(ctx);
    const item = await ctx.db.get(itemId);
    if (!item || item.email !== me.email) throw new ConvexError("Not allowed.");
    if (!item.readAt) await ctx.db.patch(itemId, { readAt: Date.now() });
    return null;
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    const now = Date.now();
    let n = 0;
    for (const i of await ctx.db.query("inboxItems").withIndex("by_email", (q) => q.eq("email", me.email)).collect()) {
      if (!i.readAt) { await ctx.db.patch(i._id, { readAt: now }); n++; }
    }
    return n;
  },
});

// ---------- the owner's side ----------

/** "Their Inbox": what this client's people see, one row per event, with who has read it. */
export const forClient = query({
  args: { clientId: v.id("clients"), limit: v.optional(v.number()) },
  handler: async (ctx, { clientId, limit }) => {
    await requireMe(ctx);
    if (!(await ctx.db.get(clientId))) return [];
    const rows = await ctx.db.query("inboxItems").withIndex("by_client", (q) => q.eq("clientId", clientId)).order("desc").take(1000);
    const events = new Map<string, { item: ReturnType<typeof itemView>; people: Array<{ email: string; readAt: number | null; emailed: boolean }> }>();
    for (const r of rows) {
      const k = eventKey(r.key);
      const e = events.get(k) ?? { item: itemView(r), people: [] };
      e.people.push({ email: r.email, readAt: r.readAt ?? null, emailed: !!r.emailedAt });
      events.set(k, e);
    }
    return [...events.values()].slice(0, Math.min(Math.max(limit ?? 50, 1), 200)).map((e) => ({
      ...e.item, read: e.people.some((p) => p.readAt), readBy: e.people.filter((p) => p.readAt).length, sentTo: e.people.length, people: e.people,
    }));
  },
});

/** Who a note to this client would reach: their people with portal access. */
async function noteAudience(ctx: QueryCtx | MutationCtx, client: Doc<"clients">) {
  const biz = await businessOf(ctx, client);
  const people = (await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", client._id)).collect()).filter((p) => !p.removedAt);
  const out: Array<{ email: string; name: string | null; access: boolean }> = [];
  for (const p of people) out.push({ email: p.email, name: p.name ?? null, access: !!biz && (await hasAccess(ctx, biz, p.email)) });
  return out;
}

export const noteRecipients = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    await requireMe(ctx);
    const client = await ctx.db.get(clientId);
    if (!client) throw new ConvexError("That client isn't here.");
    return await noteAudience(ctx, client);
  },
});

/** The Sent list, with drafts first. */
export const notes = query({
  args: { clientId: v.optional(v.id("clients")) },
  handler: async (ctx, { clientId }) => {
    await requireMe(ctx);
    const rows = clientId
      ? await ctx.db.query("inboxNotes").withIndex("by_client", (q) => q.eq("clientId", clientId)).order("desc").collect()
      : await ctx.db.query("inboxNotes").order("desc").take(500);
    const out = [];
    for (const n of rows.filter((x) => x.status !== "discarded")) {
      const client = await ctx.db.get(n.clientId);
      const items = n.status === "sent" ? await ctx.db.query("inboxItems").withIndex("by_note", (q) => q.eq("noteId", n._id)).collect() : [];
      out.push({
        _id: n._id, clientId: n.clientId, client: client?.name ?? null, title: n.title, text: n.text, link: n.link ?? null,
        status: n.status, draftedBy: n.draftedBy, said: n.said ?? null, createdAt: n.createdAt, updatedAt: n.updatedAt, sentAt: n.sentAt ?? null,
        recipients: n.recipients ?? items.length, readBy: items.filter((i) => i.readAt).length, emailed: items.filter((i) => i.emailedAt).length,
      });
    }
    return out.sort((a, b) => (a.status === "draft" ? 0 : 1) - (b.status === "draft" ? 0 : 1) || (b.sentAt ?? b.updatedAt) - (a.sentAt ?? a.updatedAt));
  },
});

function checkNote(a: { title: string; text: string; link?: string | null }) {
  const title = a.title.trim().replace(/\s+/g, " ");
  const text = a.text.trim();
  const link = a.link?.trim() || undefined;
  if (!title) throw new ConvexError("Give the note a title.");
  if (title.length > MAX_TITLE) throw new ConvexError(`Keep the title under ${MAX_TITLE} characters.`);
  if (text.length > MAX_TEXT) throw new ConvexError(`Keep the note under ${MAX_TEXT} characters.`);
  if (link && (link.length > MAX_LINK || !(/^\/(?!\/)/.test(link) || /^https:\/\//.test(link)))) throw new ConvexError("A link must be a page in the portal (starting with /) or an https:// address.");
  return { title, text, link };
}

export const saveNote = mutation({
  args: { noteId: v.optional(v.id("inboxNotes")), clientId: v.id("clients"), title: v.string(), text: v.string(), link: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    if (!(await ctx.db.get(a.clientId))) throw new ConvexError("That client isn't here.");
    const n = checkNote(a);
    const now = Date.now();
    if (a.noteId) {
      const cur = await ctx.db.get(a.noteId);
      if (!cur) throw new ConvexError("That note isn't here.");
      if (cur.status !== "draft") throw new ConvexError("This note was already sent, so it can't be changed.");
      await ctx.db.patch(a.noteId, { clientId: a.clientId, title: n.title, text: n.text, link: n.link, updatedAt: now });
      return a.noteId;
    }
    return await ctx.db.insert("inboxNotes", { clientId: a.clientId, title: n.title, text: n.text, ...(n.link ? { link: n.link } : {}), status: "draft", draftedBy: "owner", createdAt: now, updatedAt: now });
  },
});

/** Sending is the owner's own act on the site, after the preview. It posts to every person with portal access. */
export const sendNote = mutation({
  args: { noteId: v.id("inboxNotes") },
  handler: async (ctx, { noteId }) => {
    await requireMe(ctx);
    const n = await ctx.db.get(noteId);
    if (!n) throw new ConvexError("That note isn't here.");
    if (n.status !== "draft") throw new ConvexError(n.status === "sent" ? "This note was already sent." : "This note was discarded.");
    const client = await ctx.db.get(n.clientId);
    if (!client) throw new ConvexError("That client isn't here.");
    const biz = await businessOf(ctx, n);
    const audience = (await noteAudience(ctx, client)).filter((p) => p.access);
    if (!biz || !audience.length) throw new ConvexError(`No one at ${client.name} has portal access yet. Invite someone first.`);
    let posted = 0;
    for (const p of audience) {
      if (await postToInbox(ctx, { businessId: biz, clientId: client._id, email: p.email, kind: "note", title: n.title, text: n.text, link: n.link, source: { module: "inbox", id: noteId }, key: `note:${noteId}`, noteId })) posted++;
    }
    await ctx.db.patch(noteId, { status: "sent", sentAt: Date.now(), recipients: posted, updatedAt: Date.now() });
    return { sent: posted };
  },
});

export const discardNote = mutation({
  args: { noteId: v.id("inboxNotes") },
  handler: async (ctx, { noteId }) => {
    await requireMe(ctx);
    const n = await ctx.db.get(noteId);
    if (!n) throw new ConvexError("That note isn't here.");
    if (n.status !== "draft") throw new ConvexError("Only a draft can be discarded.");
    await ctx.db.patch(noteId, { status: "discarded", updatedAt: Date.now() });
    return null;
  },
});

// ---------- the connector (Claude) ----------

/** Claude drafts a note; it waits on the Sent list until the owner sends it (the same rule as Sign's requests). */
export const draftNoteAs = internalMutation({
  args: { clientId: v.id("clients"), title: v.string(), text: v.string(), link: v.optional(v.string()), said: v.string() },
  handler: async (ctx, a) => {
    if (!(await ctx.db.get(a.clientId))) throw new ConvexError("That client isn't here.");
    const n = checkNote(a);
    const now = Date.now();
    const id = await ctx.db.insert("inboxNotes", { clientId: a.clientId, title: n.title, text: n.text, ...(n.link ? { link: n.link } : {}), status: "draft", draftedBy: "claude", said: a.said.slice(0, 500), createdAt: now, updatedAt: now });
    return { noteId: id };
  },
});

/** A client's Inbox for the connector: events, newest first, with read counts. */
export const forClientAs = internalQuery({
  args: { clientId: v.id("clients"), limit: v.optional(v.number()) },
  handler: async (ctx, { clientId, limit }) => {
    if (!(await ctx.db.get(clientId))) return null;
    const rows = await ctx.db.query("inboxItems").withIndex("by_client", (q) => q.eq("clientId", clientId)).order("desc").take(500);
    const seen = new Map<string, { title: string; text: string; kind: string; at: number; sentTo: number; readBy: number }>();
    for (const r of rows) {
      const k = eventKey(r.key);
      const e = seen.get(k) ?? { title: r.title, text: r.text, kind: r.kind, at: r.createdAt, sentTo: 0, readBy: 0 };
      e.sentTo++; if (r.readAt) e.readBy++;
      seen.set(k, e);
    }
    return [...seen.values()].slice(0, Math.min(Math.max(limit ?? 20, 1), 100));
  },
});

/** A client by name, for the connector: an exact match (ignoring case), else the close ones to pick from. */
export const findClient = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, { name }): Promise<{ clientId: Id<"clients">; name: string } | { error: string; candidates?: string[] }> => {
    const want = name.trim().toLowerCase();
    if (!want) return { error: "Pass client: the client's name." };
    const all = await ctx.db.query("clients").collect();
    const exact = all.find((c) => c.name.trim().toLowerCase() === want);
    if (exact) return { clientId: exact._id, name: exact.name };
    const close = all.filter((c) => c.name.toLowerCase().includes(want) || want.includes(c.name.toLowerCase())).map((c) => c.name).slice(0, 8);
    return close.length === 1 ? { clientId: all.find((c) => c.name === close[0])!._id, name: close[0] } : { error: close.length ? "More than one client matches. Pick one." : `No client called "${name}".`, ...(close.length ? { candidates: close } : {}) };
  },
});

// ---------- hooks: Review ----------

/** A version became ready: everyone on an invited share that covers it gets "new cut ready". */
export const onVersionReady = internalMutation({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    const ver = await ctx.db.get(versionId);
    if (!ver || ver.status !== "ready") return 0;
    const vid = await ctx.db.get(ver.videoId);
    if (!vid) return 0;
    const project = await ctx.db.get(vid.projectId);
    const biz = await businessOf(ctx, vid);
    if (!biz) return 0;
    const shares = (await ctx.db.query("shares").collect()).filter((s) => s.who === "invited" && !shareState(s) && shareCovers(s, vid, project));
    let n = 0;
    for (const s of shares) {
      for (const m of await ctx.db.query("shareMembers").withIndex("by_share", (q) => q.eq("shareId", s._id)).collect()) {
        if (await postToInbox(ctx, {
          businessId: biz, clientId: project?.clientId, email: m.email, kind: "cut_ready",
          title: `${vid.title} v${ver.number} is ready`, text: projectLabel(project) || "A new version to review",
          link: `/s/${s.token}/v/${vid._id}?version=${ver.number}`, source: { module: "review", id: versionId }, key: `version:${versionId}`,
        })) n++;
      }
    }
    return n;
  },
});

/** The owner replied on a client's shared note: that client gets "reply". */
export const onReply = internalMutation({
  args: { replyId: v.id("replies") },
  handler: async (ctx, { replyId }) => {
    const r = await ctx.db.get(replyId);
    if (!r || r.hidden) return 0;
    const note = await ctx.db.get(r.noteId);
    if (!note || note.visibility !== "shared" || !note.authorId) return 0;
    if (r.authorId && r.authorId === note.authorId) return 0;
    const author = await ctx.db.get(note.authorId);
    if (!author?.email || author.role !== "client") return 0;
    const ver = await ctx.db.get(note.versionId);
    const vid = ver ? await ctx.db.get(ver.videoId) : null;
    if (!ver || !vid) return 0;
    const project = await ctx.db.get(vid.projectId);
    const biz = await businessOf(ctx, vid);
    if (!biz) return 0;
    const share = note.shareId ? await ctx.db.get(note.shareId) : null;
    const link = share && !shareState(share) && sameBusiness(share, vid) ? `/s/${share.token}/v/${vid._id}?version=${ver.number}&note=${note._id}` : undefined;
    const id = await postToInbox(ctx, {
      businessId: biz, clientId: project?.clientId, email: author.email, kind: "reply",
      title: `${r.authorName} replied to your note`, text: `${vid.title} v${ver.number}: ${r.text}`.slice(0, 400),
      link, source: { module: "review", id: replyId }, key: `reply:${replyId}`,
    });
    return id ? 1 : 0;
  },
});

// ---------- hooks: Sign ----------

/** A signer was sent a document (or it was cancelled): their Inbox gets "to sign" (or "cancelled"). */
export const onSignInvite = internalMutation({
  args: { signingId: v.id("wsSignings"), kind: v.union(v.literal("invite"), v.literal("reminder"), v.literal("voided")) },
  handler: async (ctx, { signingId, kind }) => {
    if (kind === "reminder") return 0; // a reminder isn't a new event; the "to sign" item is still there
    const s = await ctx.db.get(signingId);
    if (!s) return 0;
    const doc = await ctx.db.get(s.documentId);
    if (!doc) return 0;
    const biz = await businessOf(ctx, doc);
    if (!biz) return 0;
    const label = docLabel(doc.number);
    const id = await postToInbox(ctx, kind === "invite"
      ? { businessId: biz, email: s.email, kind: "to_sign", title: `Please sign: ${doc.title}`, text: label, link: signLink(s.token), source: { module: "sign", id: s.documentId }, key: `sign:${signingId}:to_sign` }
      : { businessId: biz, email: s.email, kind: "cancelled", title: `Cancelled: ${doc.title}`, text: doc.voidReason ? `${label} · ${doc.voidReason}` : label, source: { module: "sign", id: s.documentId }, key: `sign:${signingId}:cancelled` });
    return id ? 1 : 0;
  },
});

/** Everyone signed: each signer's Inbox gets "your signed copy is ready". */
export const onSigned = internalMutation({
  args: { documentId: v.id("wsDocuments") },
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc || doc.status !== "completed" || !doc.final) return 0;
    const biz = await businessOf(ctx, doc);
    if (!biz) return 0;
    const signings = (await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", documentId)).collect()).filter((s) => s.versionNumber === doc.sentVersion && s.status === "signed");
    let n = 0;
    for (const s of signings) {
      if (await postToInbox(ctx, { businessId: biz, email: s.email, kind: "signed", title: `Signed: ${doc.title}`, text: `${docLabel(doc.number)} · your signed copy is ready`, link: "/documents", source: { module: "sign", id: documentId }, key: `sign:${documentId}:signed` })) n++;
    }
    return n;
  },
});
