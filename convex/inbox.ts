// Wrangler Portal Phase 1 (Oct 29): the Inbox. One-way: clients read it, and email stays the reply channel.
//   Client: mine, unreadCount, markRead, markAllRead (their own items only).
//   Owner:  forClient ("Their Inbox" on the client page), notes (the Sent list and drafts), saveNote, noteRecipients,
//           sendNote, discardNote. A note does nothing until the owner sends it on the site, including a draft Claude
//           wrote through the connector (T1.7).
//   Hooks:  onVersionReady, onReply (Review), onSignInvite, onSigned (Sign). Called where those emails are sent.
//           They only add Inbox rows; the emails themselves are unchanged until the one-email switch (task 10).
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { requireMe, requireSignedIn } from "./lib/access";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { businessOf, hasAccess, itemView, myItems, postToInbox } from "./lib/inbox";
import { shareCovers, shareState, sameBusiness } from "./lib/shareAccess";
import { signLink } from "./lib/wsSigning";
import { docLabel } from "./lib/wsLayout";
import { frameTc } from "./lib/frames";
import { signedThumbUrl, signStillUrl } from "./lib/media";

const MAX_TITLE = 120, MAX_TEXT = 2000, MAX_LINK = 500;
const projectLabel = (p: { name: string; jobNumber?: string } | null) => (p ? (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name) : "");
const eventKey = (key: string) => key.slice(0, key.lastIndexOf(":"));

// ---------- the client's side ----------

export const mine = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return { items: [], unread: 0 };
    const all = await myItems(ctx, me.email);
    const names = new Map<string, string>();
    const items = [];
    for (const i of all.slice(0, Math.min(Math.max(limit ?? 50, 1), 200))) {
      const k = String(i.businessId ?? "");
      if (!names.has(k)) names.set(k, (i.businessId ? (await ctx.db.get(i.businessId))?.name : null) ?? "Wrangler Productions");
      items.push({ ...itemView(i), from: names.get(k)! });
    }
    return { items, unread: all.filter((i) => !i.readAt).length };
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return 0;
    return (await myItems(ctx, me.email)).filter((i) => !i.readAt).length;
  },
});

export const markRead = mutation({
  args: { itemId: v.id("inboxItems") },
  handler: async (ctx, { itemId }) => {
    const me = await requireSignedIn(ctx);
    const item = await ctx.db.get(itemId);
    if (!item || item.email !== me.email || !(await myItems(ctx, me.email)).some((i) => i._id === itemId)) throw new ConvexError("Not allowed.");
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
    for (const i of await myItems(ctx, me.email)) {
      if (!i.readAt) { await ctx.db.patch(i._id, { readAt: now }); n++; }
    }
    return n;
  },
});

// ---------- the owner's side ----------

/** "Their Inbox": what this client's people see, one row per event, with who has read it. */
export const forClient = query({
  args: { clientId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const limit = a.limit;
    await requireMe(ctx);
    const clientId = ctx.db.normalizeId("clients", a.clientId);
    if (!clientId || !(await ctx.db.get(clientId))) return [];
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
  args: { clientId: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const clientId = ctx.db.normalizeId("clients", a.clientId);
    const client = clientId ? await ctx.db.get(clientId) : null;
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
        linkLabel: n.linkLabel ?? null, to: n.to ?? null, emailThem: n.emailThem ?? true,
        recipients: n.recipients ?? items.length, readBy: items.filter((i) => i.readAt).length, emailed: items.filter((i) => i.emailedAt).length,
      });
    }
    return out.sort((a, b) => (a.status === "draft" ? 0 : 1) - (b.status === "draft" ? 0 : 1) || (b.sentAt ?? b.updatedAt) - (a.sentAt ?? a.updatedAt));
  },
});

/** The Sent list (P1 / Owner / Sent): your notes (drafts first) and the automatic updates the portal posted, one row
 *  per event, newest first, with who it went to and how many have read it. */
export const sent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireMe(ctx);
    const max = Math.min(Math.max(limit ?? 100, 1), 300);
    type Row = {
      key: string; type: "draft" | "note" | "auto"; kind: string; title: string; subject: string | null; to: string; at: number;
      sentTo: number; readBy: number; emailed: boolean; draftedBy: "owner" | "claude" | null; open: string;
    };
    const out: Row[] = [];
    const clientName = new Map<string, string | null>();
    const nameOfClient = async (id: Id<"clients"> | undefined) => {
      if (!id) return null;
      if (!clientName.has(id)) clientName.set(id, (await ctx.db.get(id))?.name ?? null);
      return clientName.get(id)!;
    };
    // Drafts (yours and Claude's), then the notes you sent.
    for (const n of (await ctx.db.query("inboxNotes").order("desc").take(300)).filter((x) => x.status !== "discarded")) {
      const client = await nameOfClient(n.clientId);
      const items = n.status === "sent" ? await ctx.db.query("inboxItems").withIndex("by_note", (q) => q.eq("noteId", n._id)).collect() : [];
      const count = n.status === "sent" ? items.length : (n.to?.length ?? null);
      out.push({
        key: `note:${n._id}`, type: n.status === "draft" ? "draft" : "note", kind: "note", title: n.title, subject: null,
        to: `${client ?? "a client"}${count ? ` (${count})` : ""}`, at: n.sentAt ?? n.updatedAt, sentTo: items.length, readBy: items.filter((i) => i.readAt).length,
        emailed: items.some((i) => i.emailedAt), draftedBy: n.draftedBy, open: n.status === "draft" ? `/sent/new?note=${n._id}` : `/sent/${n._id}`,
      });
    }
    // Automatic updates: every other Inbox item, grouped by event.
    const events = new Map<string, { first: Doc<"inboxItems">; people: Doc<"inboxItems">[] }>();
    for (const r of await ctx.db.query("inboxItems").order("desc").take(1500)) {
      if (r.kind === "note") continue;
      const k = eventKey(r.key);
      const e = events.get(k) ?? { first: r, people: [] };
      e.people.push(r);
      events.set(k, e);
    }
    for (const [k, { first: r, people }] of events) {
      let open = "/sent";
      if (r.source.module === "sign") open = `/sign/d/${r.source.id}`;
      else if (r.kind === "cut_ready") { const ver = await ctx.db.get(r.source.id as Id<"versions">); if (ver) open = `/v/${ver.videoId}?version=${ver.number}`; }
      else if (r.kind === "reply") {
        const rep = await ctx.db.get(r.source.id as Id<"replies">);
        const note = rep ? await ctx.db.get(rep.noteId) : null;
        const ver = note ? await ctx.db.get(note.versionId) : null;
        if (note && ver) open = `/v/${note.videoId}?version=${ver.number}&note=${note._id}`;
      }
      const client = await nameOfClient(r.clientId);
      let to: string;
      if (people.length > 1 && client) to = `${client} (${people.length})`;
      else {
        const p = (await ctx.db.query("clientPeople").withIndex("by_email", (q) => q.eq("email", r.email)).collect()).find((x) => !x.removedAt);
        const u = p?.name ? null : await ctx.db.query("users").withIndex("email", (q) => q.eq("email", r.email)).unique();
        to = people.length > 1 ? `${people.length} people` : p?.name ?? (u?.name as string | undefined) ?? r.email;
      }
      out.push({
        key: k, type: "auto", kind: r.kind, title: r.title.replace(/ at \d\d:\d\d:\d\d[:;]\d\d$/, ""), subject: r.text.split(" · ")[0] || null, to,
        at: Math.min(...people.map((x) => x.createdAt)), sentTo: people.length, readBy: people.filter((x) => x.readAt).length, emailed: people.some((x) => x.emailedAt), draftedBy: null, open,
      });
    }
    return out.sort((a, b) => (a.type === "draft" ? 0 : 1) - (b.type === "draft" ? 0 : 1) || b.at - a.at).slice(0, max);
  },
});

/** A sent note, opened from the Sent list: its text and each person with Read {date} or not read yet. */
export const noteDetail = query({
  args: { noteId: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const noteId = ctx.db.normalizeId("inboxNotes", a.noteId);
    const n = noteId ? await ctx.db.get(noteId) : null;
    if (!n || !noteId || n.status === "discarded") return null;
    const client = await ctx.db.get(n.clientId);
    const items = await ctx.db.query("inboxItems").withIndex("by_note", (q) => q.eq("noteId", noteId)).collect();
    const people = [];
    for (const i of items) {
      const person = (await ctx.db.query("clientPeople").withIndex("by_email", (q) => q.eq("email", i.email)).collect()).find((p) => p.clientId === n.clientId);
      const user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", i.email)).unique();
      people.push({ email: i.email, name: person?.name ?? (user?.name as string | undefined) ?? null, readAt: i.readAt ?? null, emailedAt: i.emailedAt ?? null });
    }
    return {
      _id: n._id, clientId: n.clientId, client: client?.name ?? null, title: n.title, text: n.text, link: n.link ?? null,
      status: n.status, draftedBy: n.draftedBy, said: n.said ?? null, createdAt: n.createdAt, sentAt: n.sentAt ?? null,
      linkLabel: n.linkLabel ?? null, to: n.to ?? null, emailThem: n.emailThem ?? true, attachment: await attachmentOf(ctx, n.link),
      people: people.sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email)),
    };
  },
});

/** What a note's link points at, for the "Attached cut" row: the video and version (with its picture), or a page. */
async function attachmentOf(ctx: QueryCtx, link: string | undefined) {
  if (!link) return null;
  const m = /\/v\/([^/?]+)\?version=(\d+)/.exec(link);
  if (m) {
    const vidId = ctx.db.normalizeId("videos", m[1]);
    const vid = vidId ? await ctx.db.get(vidId) : null;
    const ver = vid ? (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()).find((x) => x.number === Number(m[2])) : null;
    if (vid && ver) return { kind: "cut" as const, videoId: vid._id, title: vid.title, number: ver.number, thumbUrl: (await signStillUrl(ver.posterUrl)) ?? (await signedThumbUrl(ver)) };
  }
  return { kind: link.startsWith("/docs") ? ("doc" as const) : ("page" as const), videoId: null, title: null, number: null, thumbUrl: null };
}

function checkNote(a: { title: string; text: string; link?: string | null; linkLabel?: string | null }) {
  const title = a.title.trim().replace(/\s+/g, " ");
  const text = a.text.trim();
  const link = a.link?.trim() || undefined;
  if (!title) throw new ConvexError("Give the note a title.");
  if (title.length > MAX_TITLE) throw new ConvexError(`Keep the title under ${MAX_TITLE} characters.`);
  if (text.length > MAX_TEXT) throw new ConvexError(`Keep the note under ${MAX_TEXT} characters.`);
  if (link && (link.length > MAX_LINK || !(/^\/(?![/\\])/.test(link) || /^https:\/\//.test(link)))) throw new ConvexError("A link must be a page in the portal (starting with /) or an https:// address.");
  const linkLabel = link ? a.linkLabel?.trim().replace(/\s+/g, " ").slice(0, 80) || undefined : undefined;
  return { title, text, link, linkLabel };
}

export const saveNote = mutation({
  args: {
    noteId: v.optional(v.id("inboxNotes")), clientId: v.id("clients"), title: v.string(), text: v.string(), link: v.optional(v.string()),
    linkLabel: v.optional(v.string()), to: v.optional(v.array(v.string())), emailThem: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const client = await ctx.db.get(a.clientId);
    if (!client) throw new ConvexError("That client isn't here.");
    const n = checkNote(a);
    let to: string[] | undefined;
    if (a.to) {
      const theirs = new Set((await noteAudience(ctx, client)).map((p) => p.email));
      to = [...new Set(a.to.map((e) => e.trim().toLowerCase()))];
      if (!to.length) throw new ConvexError("Pick at least one person.");
      if (to.some((e) => !theirs.has(e))) throw new ConvexError(`Everyone you send to must be one of ${client.name}'s people.`);
    }
    const fields = { clientId: a.clientId, title: n.title, text: n.text, link: n.link, linkLabel: n.linkLabel, to, emailThem: a.emailThem ?? true };
    const now = Date.now();
    if (a.noteId) {
      const cur = await ctx.db.get(a.noteId);
      if (!cur) throw new ConvexError("That note isn't here.");
      if (cur.status !== "draft") throw new ConvexError("This note was already sent, so it can't be changed.");
      await ctx.db.patch(a.noteId, { ...fields, updatedAt: now });
      return a.noteId;
    }
    const clean = Object.fromEntries(Object.entries(fields).filter(([, x]) => x !== undefined)) as typeof fields;
    return await ctx.db.insert("inboxNotes", { ...clean, status: "draft", draftedBy: "owner", createdAt: now, updatedAt: now });
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
    const audience = (await noteAudience(ctx, client)).filter((p) => p.access && (!n.to || n.to.includes(p.email)));
    if (!biz || !audience.length) throw new ConvexError(n.to ? "None of the people you picked has portal access yet." : `No one at ${client.name} has portal access yet. Invite someone first.`);
    let posted = 0;
    for (const p of audience) {
      if (await postToInbox(ctx, { businessId: biz, clientId: client._id, email: p.email, kind: "note", title: n.title, text: n.text, link: n.link, linkLabel: n.linkLabel, source: { module: "inbox", id: noteId }, key: `note:${noteId}`, noteId })) posted++;
    }
    await ctx.db.patch(noteId, { status: "sent", sentAt: Date.now(), recipients: posted, updatedAt: Date.now() });
    if (n.emailThem !== false && posted) await ctx.scheduler.runAfter(0, internal.emails.noteEmails, { noteId });
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
          title: "New cut ready", text: `${vid.title} · v${ver.number}`,
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
      title: note.kind === "general" || note.inFrame === undefined ? "Reply on your note" : `Reply on your note at ${frameTc(note.inFrame, ver.startTimecode, { num: ver.fpsNum ?? 24, den: ver.fpsDen ?? 1 })}`,
      text: `${vid.title} · v${ver.number}`,
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
      ? { businessId: biz, email: s.email, kind: "to_sign", title: "Document to sign", text: `${doc.title} · ${label}`, link: signLink(s.token), source: { module: "sign", id: s.documentId }, key: `sign:${signingId}:to_sign` }
      : { businessId: biz, email: s.email, kind: "cancelled", title: "Document cancelled", text: `${doc.title} · ${label}`, link: "/docs?tab=cancelled", source: { module: "sign", id: s.documentId }, key: `sign:${signingId}:cancelled` });
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
      if (await postToInbox(ctx, { businessId: biz, email: s.email, kind: "signed", title: "Signed copy ready", text: `${doc.title} · ${docLabel(doc.number)}`, link: "/docs?tab=signed", source: { module: "sign", id: documentId }, key: `sign:${documentId}:signed` })) n++;
    }
    return n;
  },
});
