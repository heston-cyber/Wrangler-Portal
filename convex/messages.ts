// Phase 5d step 2 (Nov 4, D121, D144/58, Q85): Messages. Frames S5 · Phase 5d "Messages (side menu)": owner thread
// 847:17075, lead thread with a booked call 847:17720, empty 847:18391, loading 847:18928, client thread 848:15820,
// phones 849:16286 / 849:16543 / 849:16743 / 849:16919; emails 44 and 45.
//   - Its own side-menu item (after Clients for the owner, after Inbox for a client). One thread per project, between
//     the business and the client's people who can open that project; one per lead (deal), where the lead reads and
//     replies from a private link with no login. A booked call is a line in its lead's thread.
//   - Read receipts ("Read by Maya"), files (25 MB each, 10 a message), Show earlier messages, unread counts.
//   - When the business writes: the client's people get an Inbox row and email 44 (switch "A message from the
//     business"); a lead gets email 44 with their link. When a client or lead writes: the owner gets email 45 (switch).
//     Each is sent a couple of minutes later, once per unread stretch, and only if it still hasn't been read.
//   - Vendors have no Messages (booked vendors keep their briefings).
import { focusBusiness, internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe, requireSignedIn, viewerOf, requireAll } from "./lib/access";
import { bump } from "./lib/rate";
import { randomToken } from "./lib/hash";
import { SITE } from "./lib/site";
import { label } from "./lib/bookingRows";
import { businessOf, postToInbox } from "./lib/inbox";
import { myProjects, portalPeople } from "./projects";
import { businessContact } from "./lib/business";
import { mailBrandOf } from "./lib/mail";
import { messageMail, ownerMessageMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { TZ } from "./lib/gcal";
import { claimUpload, isClaimed } from "./lib/fileOwners";

type Ctx = QueryCtx | MutationCtx;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const PAGE = 40;
const MAX_TEXT = 5000;
const MAX_FILES = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const NOTIFY_AFTER = 2 * 60_000;
const OWNER = "owner";
const tidy = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+$/g, "").replace(/^\s+/g, "").slice(0, MAX_TEXT);
const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;
const fileArg = v.array(v.object({ storageId: v.id("_storage"), name: v.string() }));

// ---------- who may see a thread ----------

async function ownerThread(ctx: Ctx, threadId: string) {
  const me = await requireAll(ctx, "clients"); // Phase 5e: the owner, or a team member with Clients and leads on
  const id = ctx.db.normalizeId("msgThreads", threadId);
  const t = id ? await ctx.db.get(id) : null;
  return { me, t };
}
/** A signed-in client: only a project thread, for a project they can open in the portal. */
async function clientThread(ctx: Ctx, threadId: string) {
  const me = await requireSignedIn(ctx);
  if (me.kind !== "client") throw new ConvexError("Not allowed.");
  const id = ctx.db.normalizeId("msgThreads", threadId);
  const t = id ? await ctx.db.get(id) : null;
  if (!t || t.kind !== "project" || !t.projectId) return { me, t: null };
  const mine = await myProjects(ctx as QueryCtx, me.email.toLowerCase());
  if (!mine.has(t.projectId)) return { me, t: null };
  focusBusiness(ctx, t.businessId); // review M1: a client of several businesses acts for this thread's one
  return { me, t };
}
/** A lead, by their private link. */
async function leadThread(ctx: Ctx, token: string) {
  if (!TOKEN.test(token)) return null;
  const t = await ctx.db.query("msgThreads").withIndex("by_token", (q) => q.eq("token", token)).unique();
  if (!t || t.kind !== "lead") return null;
  focusBusiness(ctx, t.businessId);
  return t;
}
/** Review M3: a lead's link stops working for writing once the owner turns it off or the lead is closed. */
async function leadOpen(ctx: Ctx, t: Doc<"msgThreads">) {
  if (t.linkOff) return false;
  const d = t.dealId ? await ctx.db.get(t.dealId) : null;
  return !!d && !d.closedAt;
}

// ---------- reading ----------

async function fileView(ctx: Ctx, f: Doc<"messages">["files"][number]) {
  return { name: f.name, size: f.size, type: f.type, url: await ctx.storage.getUrl(f.storageId) };
}
async function readsOf(ctx: Ctx, t: Doc<"msgThreads">) {
  return await ctx.db.query("msgReads").withIndex("by_thread", (q) => q.eq("threadId", t._id)).collect();
}
/** A page of messages (newest last), with "Read by …" under the viewer's own latest message. */
async function pageOf(ctx: Ctx, t: Doc<"msgThreads">, viewer: { side: "owner" | "client" | "lead"; who: string }, before?: number) {
  const q = ctx.db.query("messages").withIndex("by_thread", (x) => (before ? x.eq("threadId", t._id).lt("createdAt", before) : x.eq("threadId", t._id))).order("desc");
  const rows = await q.take(PAGE + 1);
  const more = rows.length > PAGE;
  const list = rows.slice(0, PAGE).reverse();
  const reads = await readsOf(ctx, t);
  const own = (m: Doc<"messages">) => (viewer.side === "owner" ? m.side === "owner" : m.side !== "owner" && m.side !== "system");
  const lastOwn = [...list].reverse().find(own);
  // Who has read the viewer's side's latest message: the other side's readers.
  const readBy = lastOwn ? reads.filter((r) => (viewer.side === "owner" ? r.who !== OWNER : r.who === OWNER) && r.readAt >= lastOwn.createdAt).map((r) => ({ name: firstName(r.name), at: r.readAt })) : [];
  const out = [];
  for (const m of list) {
    out.push({
      _id: m._id, side: m.side, mine: own(m), name: m.name, text: m.text, createdAt: m.createdAt,
      files: await Promise.all(m.files.map((f) => fileView(ctx, f))),
      call: m.call ? { what: m.call.what, start: m.call.start, end: m.call.end, meet: !!m.call.meet } : null,
    });
  }
  return { messages: out, more, readBy: lastOwn ? { messageId: lastOwn._id, names: readBy } : null };
}

async function threadHead(ctx: Ctx, t: Doc<"msgThreads">) {
  if (t.kind === "lead") {
    const d = t.dealId ? await ctx.db.get(t.dealId) : null;
    // Review M2: the deal's title is the owner's own note; a lead is never shown it (`about` goes to them).
    return { title: t.leadName ?? d?.lead?.name ?? "A lead", sub: `Lead · ${d?.title ?? t.leadEmail ?? ""}`, projectId: null, dealId: t.dealId ?? null, about: "" };
  }
  const p = t.projectId ? await ctx.db.get(t.projectId) : null;
  const client = p?.clientId ? (await ctx.db.get(p.clientId))?.name ?? null : null;
  const person = t.lastSide === "client" ? t.lastName ?? null : null;
  return { title: person ?? client ?? (p ? label(p) : "A project"), sub: [client, p?.name].filter(Boolean).join(" · "), projectId: t.projectId ?? null, dealId: null, about: p?.name ?? "your project" };
}

/** Owner: Messages' list (All · Unread · Leads), searched by name, project and message text. */
export const threads = query({
  args: { q: v.optional(v.string()) },
  handler: async (ctx, { q }) => {
    await requireAll(ctx, "clients");
    // Review M4: bounded: the newest 150 conversations, and the newest 200 messages of each when searching.
    const words = (q ?? "").toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
    const out = [];
    for (const t of await ctx.db.query("msgThreads").withIndex("by_last").order("desc").take(150)) {
      const h = await threadHead(ctx, t);
      const mine = (await readsOf(ctx, t)).find((r) => r.who === OWNER);
      const unread = (t.inAt ?? 0) > (mine?.readAt ?? 0);
      if (words.length) {
        let hay = `${h.title} ${h.sub} ${t.lastText} ${t.leadEmail ?? ""}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) {
          hay += " " + (await ctx.db.query("messages").withIndex("by_thread", (x) => x.eq("threadId", t._id)).order("desc").take(200)).map((m) => m.text.toLowerCase()).join(" ");
          if (!words.every((w) => hay.includes(w))) continue;
        }
      }
      out.push({ _id: t._id, kind: t.kind, title: h.title, sub: h.sub, lastAt: t.lastAt, lastText: t.lastText, lastSide: t.lastSide ?? null, unread });
    }
    return out;
  },
});

/** Owner: one thread. */
export const thread = query({
  args: { threadId: v.string(), before: v.optional(v.number()) },
  handler: async (ctx, { threadId, before }) => {
    const { t } = await ownerThread(ctx, threadId);
    if (!t) return null;
    const h = await threadHead(ctx, t);
    const people = t.kind === "project" && t.projectId ? (await portalPeople(ctx, (await ctx.db.get(t.projectId))!)).length : t.leadEmail ? 1 : 0;
    return { _id: t._id, kind: t.kind, ...h, people, leadEmail: t.leadEmail ?? null, linkOff: !!t.linkOff, ...(await pageOf(ctx, t, { side: "owner", who: OWNER }, before)) };
  },
});

/** The unread count for the side menu (the owner's or a client's). */
export const unread = query({
  args: {},
  handler: async (ctx) => {
    const v0 = await viewerOf(ctx);
    if (v0.kind === "owner") {
      let n = 0;
      for (const t of await ctx.db.query("msgThreads").withIndex("by_last").order("desc").take(300)) {
        if (!t.inAt) continue;
        const r = (await readsOf(ctx, t)).find((x) => x.who === OWNER);
        if (t.inAt > (r?.readAt ?? 0)) n++;
      }
      return n;
    }
    if (v0.kind !== "client") return 0;
    return (await clientList(ctx, v0.email)).filter((x) => x.unread).length;
  },
});

async function clientList(ctx: Ctx, email: string) {
  const e = email.toLowerCase();
  const out = [];
  for (const { project: p } of (await myProjects(ctx as QueryCtx, e)).values()) {
    const t = await ctx.db.query("msgThreads").withIndex("by_project", (q) => q.eq("projectId", p._id)).first();
    if (!t) continue;
    const r = (await readsOf(ctx, t)).find((x) => x.who === e);
    const biz = p.businessId ? await ctx.db.get(p.businessId) : null;
    out.push({ _id: t._id, title: p.name, sub: biz?.name ?? "", lastAt: t.lastAt, lastText: t.lastSide === "owner" ? `${firstName(t.lastName ?? "")}: ${t.lastText}` : t.lastText, unread: (t.outAt ?? 0) > (r?.readAt ?? 0), projectId: p._id });
  }
  return out.sort((a, b) => b.lastAt - a.lastAt);
}

/** Client: their threads (one per project they can open that has messages), and the projects they could start one on. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return { threads: [], projects: [] };
    const threads = await clientList(ctx, me.email);
    const have = new Set(threads.map((t) => String(t.projectId)));
    const projects = [...(await myProjects(ctx, me.email.toLowerCase())).values()].filter((x) => !have.has(String(x.project._id))).map((x) => ({ _id: x.project._id, title: x.project.name }));
    return { threads, projects };
  },
});

/** Client: one thread. */
export const clientThreadPage = query({
  args: { threadId: v.string(), before: v.optional(v.number()) },
  handler: async (ctx, { threadId, before }) => {
    const { me, t } = await clientThread(ctx, threadId);
    if (!t) return null;
    const p = t.projectId ? await ctx.db.get(t.projectId) : null;
    const biz = p ? await businessOf(ctx, p) : null;
    const b = biz ? await ctx.db.get(biz) : null;
    return { _id: t._id, title: p?.name ?? "Your project", sub: b ? `With ${b.name}` : "", projectId: t.projectId ?? null, business: b?.name ?? null, ...(await pageOf(ctx, t, { side: "client", who: me.email.toLowerCase() }, before)) };
  },
});

/** A lead's own conversation (/m/<token>). */
export const leadPage = query({
  args: { token: v.string(), before: v.optional(v.number()) },
  handler: async (ctx, { token, before }) => {
    const t = await leadThread(ctx, token);
    if (!t) return null;
    const biz = t.businessId ? await ctx.db.get(t.businessId) : null;
    return {
      business: { name: biz?.name ?? "", legalName: biz?.legalName ?? null, owner: biz?.ownerName ?? null, logoUrl: biz?.logoFileId ? await ctx.storage.getUrl(biz.logoFileId) : null },
      name: t.leadName ?? "", about: null, open: await leadOpen(ctx, t), ...(await pageOf(ctx, t, { side: "lead", who: (t.leadEmail ?? "").toLowerCase() }, before)),
    };
  },
});

// ---------- writing ----------

/** Files a message carries (review H1): each must be an upload made in the last 30 minutes that nobody has attached
 *  before; attaching claims it for this caller. 25 MB at most each, 10 at most. A refused file is left alone: it may
 *  not be the caller's, so it's never deleted here. */
const FRESH_UPLOAD = 30 * 60_000;
async function checkFiles(ctx: MutationCtx, files: Array<{ storageId: Id<"_storage">; name: string }>, by: string, businessId: Id<"businesses"> | null) {
  const no = (msg: string) => ({ error: msg, files: [] as Doc<"messages">["files"] });
  if (files.length > MAX_FILES) return no(`Up to ${MAX_FILES} files a message.`);
  if (new Set(files.map((f) => f.storageId)).size !== files.length) return no("The same file is attached twice.");
  const out: Doc<"messages">["files"] = [];
  const now = Date.now();
  for (const f of files) {
    const meta = await ctx.db.system.get(f.storageId);
    if (!meta || meta._creationTime < now - FRESH_UPLOAD) return no("A file didn't upload. Attach it again.");
    if (await ctx.db.query("msgUploads").withIndex("by_storage", (q) => q.eq("storageId", f.storageId)).first()) return no("A file didn't upload. Attach it again.");
    if (await isClaimed(ctx, f.storageId)) return no("A file didn't upload. Attach it again."); // 5e review (Nov 6): across businesses
    if (meta.size > MAX_FILE_BYTES) return no(`${f.name.slice(0, 80)} is over 25 MB. Share a link to big files instead.`);
    out.push({ storageId: f.storageId, name: (f.name.trim() || "File").slice(0, 140), size: meta.size, type: (meta.contentType ?? "").slice(0, 100) });
  }
  for (const f of out) { await claimUpload(ctx, f.storageId, businessId, "message"); await ctx.db.insert("msgUploads", { storageId: f.storageId, by, at: now }); }
  return { error: null, files: out };
}

async function post(ctx: MutationCtx, t: Doc<"msgThreads">, m: { side: "owner" | "client" | "lead"; name: string; email?: string; text: string; files: Doc<"messages">["files"] }) {
  const now = await nextAt(ctx, t._id);
  const id = await ctx.db.insert("messages", { threadId: t._id, side: m.side, name: m.name, ...(m.email ? { email: m.email } : {}), text: m.text, files: m.files, createdAt: now });
  const preview = m.text ? m.text.replace(/\s+/g, " ").slice(0, 140) : `${m.files.length} ${m.files.length === 1 ? "file" : "files"}`;
  await ctx.db.patch(t._id, { lastAt: now, lastText: preview, lastSide: m.side, lastName: m.name, ...(m.side === "owner" ? { outAt: now } : { inAt: now }) });
  await markRead(ctx, t, m.side === "owner" ? OWNER : (m.email ?? "").toLowerCase(), m.name, now); // writing reads it
  await ctx.scheduler.runAfter(NOTIFY_AFTER, internal.messages.notify, { threadId: t._id, messageId: id });
  return id;
}

/** Review L2: every message in a thread gets its own time, so "Show earlier messages" never skips one. */
async function nextAt(ctx: MutationCtx, threadId: Id<"msgThreads">) {
  const last = await ctx.db.query("messages").withIndex("by_thread", (q) => q.eq("threadId", threadId)).order("desc").first();
  return Math.max(Date.now(), (last?.createdAt ?? 0) + 1);
}

async function markRead(ctx: MutationCtx, t: Doc<"msgThreads">, who: string, name: string, at = Date.now()) {
  if (!who) return;
  const r = (await readsOf(ctx, t)).find((x) => x.who === who);
  if (r) { if (r.readAt < at) await ctx.db.patch(r._id, { readAt: at, name }); }
  else await ctx.db.insert("msgReads", { threadId: t._id, who, name, readAt: at });
}

const textArg = { text: v.string(), files: v.optional(fileArg) };

/** Owner writes. */
export const send = mutation({
  args: { threadId: v.id("msgThreads"), ...textArg },
  handler: async (ctx, a) => {
    const { me, t } = await ownerThread(ctx, a.threadId);
    if (!t) throw new ConvexError("This conversation isn't here any more.");
    const text = tidy(a.text);
    if (!text && !(a.files ?? []).length) throw new ConvexError("Write a message.");
    const f = await checkFiles(ctx, a.files ?? [], `user:${me.userId}`, t.businessId ?? null);
    if (f.error) return { error: f.error };
    await bump(ctx, "msgSend", String(me.userId));
    const biz = t.businessId ? await ctx.db.get(t.businessId) : null;
    await post(ctx, t, { side: "owner", name: biz?.ownerName?.trim() || me.name, email: me.email, text, files: f.files });
    return { error: null };
  },
});

/** A signed-in client writes in their project's thread, or starts it. */
export const clientSend = mutation({
  args: { threadId: v.optional(v.id("msgThreads")), projectId: v.optional(v.id("projects")), ...textArg },
  handler: async (ctx, a) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") throw new ConvexError("Not allowed.");
    const email = me.email.toLowerCase();
    let t: Doc<"msgThreads"> | null = null;
    if (a.threadId) t = (await clientThread(ctx, a.threadId)).t;
    else if (a.projectId) {
      const mine = await myProjects(ctx as unknown as QueryCtx, email);
      const row = mine.get(a.projectId);
      if (row) { focusBusiness(ctx, row.project.businessId); t = await threadForProject(ctx, row.project); }
    }
    if (!t) throw new ConvexError("This conversation isn't here any more.");
    const text = tidy(a.text);
    if (!text && !(a.files ?? []).length) throw new ConvexError("Write a message.");
    const f = await checkFiles(ctx, a.files ?? [], `user:${me.userId}`, t.businessId ?? null);
    if (f.error) return { error: f.error, threadId: t._id };
    await bump(ctx, "msgSend", String(me.userId));
    await post(ctx, t, { side: "client", name: me.name, email, text, files: f.files });
    return { error: null, threadId: t._id };
  },
});

/** A lead writes from their link. */
export const leadSend = mutation({
  args: { token: v.string(), ...textArg },
  handler: async (ctx, a) => {
    const t = await leadThread(ctx, a.token);
    if (!t) throw new ConvexError("This link doesn't work.");
    if (!(await leadOpen(ctx, t))) throw new ConvexError("This conversation is closed. Reply to the email instead.");
    await bump(ctx, "msgLead", a.token);
    const text = tidy(a.text);
    if (!text && !(a.files ?? []).length) throw new ConvexError("Write a message.");
    const f = await checkFiles(ctx, a.files ?? [], `lead:${t._id}`, t.businessId ?? null);
    if (f.error) return { error: f.error };
    await post(ctx, t, { side: "lead", name: t.leadName ?? "Lead", email: t.leadEmail, text, files: f.files });
    return { error: null };
  },
});

/** Upload addresses: the owner and signed-in clients; a lead by their link (rate-limited). */
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    if (me.kind === "client" && (await myProjects(ctx as unknown as QueryCtx, me.email.toLowerCase())).size === 0) throw new ConvexError("Not allowed."); // review L3
    await bump(ctx, "msgUpload", String(me.userId));
    return await ctx.storage.generateUploadUrl();
  },
});
export const leadUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const t = await leadThread(ctx, token);
    if (!t) throw new ConvexError("This link doesn't work.");
    if (!(await leadOpen(ctx, t))) throw new ConvexError("This conversation is closed.");
    await bump(ctx, "msgUpload", token);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Opening a thread marks it read (the owner's or a client's). */
export const read = mutation({
  args: { threadId: v.id("msgThreads") },
  handler: async (ctx, { threadId }) => {
    const v0 = await viewerOf(ctx);
    if (v0.kind === "owner") { const { t } = await ownerThread(ctx, threadId); if (t) await markRead(ctx, t, OWNER, v0.name); return; }
    const { me, t } = await clientThread(ctx, threadId);
    if (t) await markRead(ctx, t, me.email.toLowerCase(), me.name);
  },
});
export const leadRead = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const t = await leadThread(ctx, token);
    if (t?.leadEmail) await markRead(ctx, t, t.leadEmail.toLowerCase(), t.leadName ?? "Lead");
  },
});

// ---------- starting a thread ----------

async function threadForProject(ctx: MutationCtx, p: Doc<"projects">) {
  const have = await ctx.db.query("msgThreads").withIndex("by_project", (q) => q.eq("projectId", p._id)).first();
  if (have) return have;
  const now = Date.now();
  const id = await ctx.db.insert("msgThreads", { ...(p.businessId ? { businessId: p.businessId } : {}), kind: "project", projectId: p._id, lastAt: now, lastText: "", createdAt: now });
  return (await ctx.db.get(id))!;
}
/** A lead's thread (one per deal; a lead who books twice keeps one). */
export async function threadForDeal(ctx: MutationCtx, d: Doc<"deals">) {
  const have = await ctx.db.query("msgThreads").withIndex("by_deal", (q) => q.eq("dealId", d._id)).first();
  if (have) return have;
  const email = (d.lead?.email ?? d.contactEmail ?? "").toLowerCase();
  const now = Date.now();
  const id = await ctx.db.insert("msgThreads", { ...(d.businessId ? { businessId: d.businessId } : {}), kind: "lead", dealId: d._id, token: randomToken(18), leadName: d.lead?.name ?? d.title, ...(email ? { leadEmail: email } : {}), lastAt: now, lastText: "", createdAt: now });
  return (await ctx.db.get(id))!;
}

/** Owner: New message: the projects whose client can open them, and open leads with an email. */
export const startOptions = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "clients");
    const projects = [];
    for (const p of await ctx.db.query("projects").order("desc").take(200)) {
      const people = await portalPeople(ctx, p);
      if (!people.length) continue;
      projects.push({ _id: p._id, title: label(p), people: people.length });
    }
    const leads = (await ctx.db.query("deals").collect()).filter((d) => !d.closedAt && d.stage === "lead" && (d.lead?.email || d.contactEmail)).map((d) => ({ _id: d._id, title: d.lead?.name ?? d.title, sub: d.title }));
    return { projects: projects.slice(0, 60), leads: leads.slice(0, 60) };
  },
});
export const start = mutation({
  args: { projectId: v.optional(v.id("projects")), dealId: v.optional(v.id("deals")) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "clients");
    if (a.projectId) {
      const p = await ctx.db.get(a.projectId);
      if (!p) throw new ConvexError("That project isn't here any more.");
      return (await threadForProject(ctx, p))._id;
    }
    if (a.dealId) {
      const d = await ctx.db.get(a.dealId);
      if (!d || !(d.lead?.email || d.contactEmail)) throw new ConvexError("That lead has no email address.");
      return (await threadForDeal(ctx, d))._id;
    }
    throw new ConvexError("Pick a project or a lead.");
  },
});

/** Owner: turn a lead's link off (it then opens read-only, and they can't write), or back on. Review M3. */
export const setLeadLink = mutation({
  args: { threadId: v.id("msgThreads"), off: v.boolean() },
  handler: async (ctx, { threadId, off }) => {
    const { t } = await ownerThread(ctx, threadId);
    if (!t || t.kind !== "lead") throw new ConvexError("That conversation isn't here any more.");
    await ctx.db.patch(t._id, { linkOff: off });
  },
});

/** Booking calls: a booked, moved or cancelled call is a line in its lead's thread. */
export async function callLine(ctx: MutationCtx, c: Doc<"calls">, what: "booked" | "moved" | "cancelled") {
  const d = c.dealId ? await ctx.db.get(c.dealId) : null;
  if (!d) return;
  const t = await threadForDeal(ctx, d);
  const now = await nextAt(ctx, t._id);
  await ctx.db.insert("messages", { threadId: t._id, side: "system", name: "", text: "", files: [], call: { callId: c._id, what, start: c.start, end: c.end, ...(c.meet ? { meet: true } : {}) }, createdAt: now });
  const when = new Date(c.start).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  await ctx.db.patch(t._id, { lastAt: now, lastText: `Call ${what === "booked" ? "booked" : what === "moved" ? "moved to" : "cancelled:"} ${when}`, lastSide: "system", lastName: "" });
}

// ---------- emails 44 and 45, an Inbox row ----------

export const notifyData = internalQuery({
  args: { threadId: v.id("msgThreads"), messageId: v.id("messages") },
  handler: async (ctx, { threadId, messageId }) => {
    const t = await ctx.db.get(threadId);
    const m = await ctx.db.get(messageId);
    if (!t || !m || m.side === "system") return null;
    const biz = await businessOf(ctx, t);
    const reads = await readsOf(ctx, t);
    const head = await threadHead(ctx, t);
    // The unread stretch this message belongs to: everything from the other side since the reader last read.
    const since = async (who: string) => (reads.find((r) => r.who === who)?.readAt ?? 0);
    const later = async (who: string) => (await ctx.db.query("messages").withIndex("by_thread", (q) => q.eq("threadId", t._id).gt("createdAt", Math.max(m.createdAt, 0))).collect()).filter((x) => x.side === m.side && x._id !== m._id).length;
    if (m.side === "owner") {
      const people = t.kind === "project" && t.projectId ? (await portalPeople(ctx, (await ctx.db.get(t.projectId))!)).map((p) => p.email.toLowerCase()) : t.leadEmail ? [t.leadEmail] : [];
      const to = [];
      for (const e of people) {
        const r = await since(e);
        if (r >= m.createdAt) continue; // they've read it already
        const first = (await ctx.db.query("messages").withIndex("by_thread", (q) => q.eq("threadId", t._id).gt("createdAt", r)).collect()).find((x) => x.side === "owner");
        if (!first || first._id !== m._id) continue; // only the first message of their unread stretch notifies
        to.push({ email: e, readAt: r });
      }
      return { kind: "toClient" as const, t: { _id: t._id, kind: t.kind, projectId: t.projectId ?? null, token: t.token ?? null, leadName: t.leadName ?? null }, businessId: biz, brand: await mailBrandOf(ctx, biz), about: head.about, sender: m.name, text: m.text, files: m.files.length, more: await later(""), to };
    }
    const r = await since(OWNER);
    if (r >= m.createdAt) return null;
    const first = (await ctx.db.query("messages").withIndex("by_thread", (q) => q.eq("threadId", t._id).gt("createdAt", r)).collect()).find((x) => x.side !== "owner" && x.side !== "system");
    if (!first || first._id !== m._id) return null;
    const contact = await businessContact(ctx, biz);
    const ownerAbout = t.kind === "lead" ? (t.dealId ? (await ctx.db.get(t.dealId))?.title : null) ?? head.title : head.about;
    return { kind: "toOwner" as const, t: { _id: t._id }, businessId: biz, brand: await mailBrandOf(ctx, biz), about: ownerAbout, who: m.name, text: m.text, files: m.files.length, more: await later(""), ownerEmail: contact.ownerEmail, readAt: r };
  },
});
export const inboxRow = internalMutation({
  args: { threadId: v.id("msgThreads"), email: v.string(), readAt: v.number(), sender: v.string(), about: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    const t = await ctx.db.get(a.threadId);
    const biz = t ? await businessOf(ctx, t) : null;
    if (!t || !biz) return;
    await postToInbox(ctx, { businessId: biz, email: a.email, kind: "message", title: `${firstName(a.sender)} sent you a message about ${a.about}`, text: a.text.slice(0, 200), link: `/messages?thread=${t._id}`, linkLabel: "Read and reply", source: { module: "messages", id: String(t._id) }, key: `msg:${t._id}:${a.readAt}` });
  },
});
export const notify = internalAction({
  args: { threadId: v.id("msgThreads"), messageId: v.id("messages") },
  handler: async (ctx, a): Promise<void> => {
    const d = await ctx.runQuery(internal.messages.notifyData, a);
    if (!d || !d.businessId) return;
    if (d.kind === "toOwner") {
      await deliverOnce(ctx, `msg45:${d.t._id}:${d.readAt}`, "message_owner", d.ownerEmail, ownerMessageMail(d.brand, { who: d.who, about: d.about, text: d.text, files: d.files, more: d.more, link: `${SITE()}/messages?thread=${d.t._id}` }), d.brand.replyTo, d.businessId);
      return;
    }
    for (const r of d.to) {
      const lead = d.t.kind === "lead";
      const link = lead ? `${SITE()}/m/${d.t.token}` : `${SITE()}/messages?thread=${d.t._id}`;
      if (!lead) await ctx.runMutation(internal.messages.inboxRow, { threadId: d.t._id, email: r.email, readAt: r.readAt, sender: d.sender, about: d.about, text: d.text });
      await deliverOnce(ctx, `msg44:${d.t._id}:${r.email}:${r.readAt}`, "message", r.email, messageMail(d.brand, { name: lead ? d.t.leadName : null, sender: d.sender, about: d.about, text: d.text, files: d.files, more: d.more, link, lead }), d.brand.replyTo, d.businessId);
    }
  },
});
