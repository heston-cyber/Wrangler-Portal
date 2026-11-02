// Phase 4 (Nov 2): file requests (frames: Ask for files 741:2666, the owner's Requests card 741:1424, the client's File
// request page 740:551 / 740:897 / 740:1276, phone 742:2365, Inbox 740:2435, emails 31 and 32).
//   - The owner asks for files on a project: what, details, a due date and the folder. The project's portal people get
//     an Inbox item and email 31, and email 32 the day before it's due if nothing's been uploaded (when ticked).
//   - The client uploads straight into the business's Dropbox, in
//     Apps/Wrangler Review/File requests/<Client>/<Project>/<Request> (Heston, Nov 2). Up to 150 MB a file goes
//     directly (Dropbox's one-time upload link); bigger files, up to 2 GB, go in 8 MB pieces through /upload/chunk,
//     so the Dropbox key never reaches the browser. The render watcher ignores File requests/.
//   - The owner gets one email per sitting (10 minutes after the last file). They close or cancel a request.
import { action, httpAction } from "./_generated/server";
import { forBusiness, internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe, requireSignedIn } from "./lib/access";
import { businessOf, postToInbox } from "./lib/inbox";
import { myProjects, portalPeople } from "./projects";
import { label } from "./lib/bookingRows";
import { todayCentral } from "./lib/bookings";
import { businessContact } from "./lib/business";
import { mailBrandOf } from "./lib/mail";
import { fileRequestMail, ownerFilesMail, requestFor, shootDay } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { SITE } from "./lib/site";
import { corsHeaders } from "./signing";

type Ctx = QueryCtx | MutationCtx;
export const MAX_BYTES = 2 * 1024 ** 3;          // D30: up to 2 GB a file
export const DIRECT_MAX = 150 * 1024 ** 2;       // Dropbox's one-time upload link takes up to 150 MB
export const CHUNK = 8 * 1024 ** 2;              // pieces through the portal (a multiple of 4 MB, as Dropbox asks)
const MAX_FILES = 200;
const UPLOAD_HOURS = 24;
const OWNER_MAIL_DELAY = 10 * 60_000;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
const tidy = (s: string | undefined, max: number) => (s ?? "").trim().replace(/\s+/g, " ").slice(0, max);
/** A safe Dropbox name: no slashes or characters Windows and Dropbox refuse, no leading or trailing dots and spaces. */
export const safeName = (s: string, max = 100) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").replace(/\s+\./g, ".").trim().replace(/^[.\s]+|[.\s]+$/g, "").slice(0, max).trim() || "Untitled";
const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** "/File requests/Harbor Coffee/26127 Launch": where a project's requests go. */
async function baseFolder(ctx: Ctx, p: Doc<"projects">) {
  const client = p.clientId ? (await ctx.db.get(p.clientId))?.name : p.client;
  return `/File requests/${safeName(client || "No client", 80)}/${safeName(label(p), 80)}`;
}
async function ownedProject(ctx: Ctx, projectId: string) {
  const id = ctx.db.normalizeId("projects", projectId);
  const p = id ? await ctx.db.get(id) : null;
  if (!p) throw new ConvexError("This project doesn't exist any more.");
  return p;
}

const view = (r: Doc<"fileRequests">) => ({
  _id: r._id, title: r.title, details: r.details ?? null, due: r.due, folder: r.folder, remind: r.remind, status: r.status,
  files: r.files.map((f) => ({ name: f.name, size: f.size, at: f.at, by: f.by })), lastUploadAt: r.lastUploadAt ?? null,
});

// ---------- the owner ----------

export const forProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("projects", projectId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) return null;
    const rows = (await ctx.db.query("fileRequests").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).filter((r) => r.status !== "cancelled");
    const biz = await businessOf(ctx, p);
    const dropbox = biz ? !!(await ctx.db.query("dropbox").first()) : false;
    return { requests: rows.sort((a, b) => a.due.localeCompare(b.due)).map(view), base: await baseFolder(ctx, p), dropbox, people: (await portalPeople(ctx, p)).length, today: todayCentral() };
  },
});

export const create = mutation({
  args: { projectId: v.string(), title: v.string(), details: v.optional(v.string()), due: v.string(), folderName: v.optional(v.string()), remind: v.boolean() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const p = await ownedProject(ctx, a.projectId);
    const title = tidy(a.title, 120);
    if (!title) throw new ConvexError("Say what you need.");
    if (!isDay(a.due)) throw new ConvexError("Pick a due date.");
    if (a.due < todayCentral()) throw new ConvexError("That date has passed.");
    if (!(await ctx.db.query("dropbox").first())) throw new ConvexError("Connect Dropbox first (Settings › Dropbox drop folder): the files go to your Dropbox.");
    const folder = `${await baseFolder(ctx, p)}/${safeName(a.folderName?.trim() || requestFor(title), 80)}`;
    const details = (a.details ?? "").trim().slice(0, 1000);
    const now = Date.now();
    const requestId = await ctx.db.insert("fileRequests", {
      projectId: p._id, title, ...(details ? { details } : {}), due: a.due, folder, remind: a.remind, status: "open", files: [],
      history: [{ at: now, text: "Asked" }], createdAt: now, updatedAt: now,
    });
    const biz = await businessOf(ctx, p);
    const people = biz ? await portalPeople(ctx, p) : [];
    for (const person of people) {
      await postToInbox(ctx, { businessId: biz!, clientId: p.clientId, email: person.email, kind: "files", title: `Files requested: ${requestFor(title).replace(/^./, (c) => c.toLowerCase())}`,
        text: `Due ${shootDay(a.due)}.`, link: `/requests/${requestId}`, linkLabel: "Upload", source: { module: "schedule", id: requestId }, key: `files:${requestId}` });
    }
    if (people.length) await ctx.scheduler.runAfter(0, internal.fileRequests.mail, { requestId, kind: "asked", emails: people.map((x) => x.email) });
    return { requestId, told: people.length, folder };
  },
});

export const setStatus = mutation({
  args: { requestId: v.id("fileRequests"), status: v.union(v.literal("open"), v.literal("closed"), v.literal("cancelled")) },
  handler: async (ctx, { requestId, status }) => {
    await requireMe(ctx);
    const r = await ctx.db.get(requestId);
    if (!r) throw new ConvexError("That request isn't here any more.");
    if (r.status === "cancelled") throw new ConvexError("That request was cancelled.");
    const now = Date.now();
    await ctx.db.patch(requestId, { status, updatedAt: now, history: [...r.history, { at: now, text: status === "open" ? "Reopened" : status === "closed" ? "Closed" : "Cancelled" }] });
    return null;
  },
});

// ---------- the client ----------

async function clientRequest(ctx: QueryCtx | MutationCtx, requestId: string) {
  const me = await requireSignedIn(ctx);
  if (me.kind !== "client") return null;
  const id = ctx.db.normalizeId("fileRequests", requestId);
  const r = id ? await ctx.db.get(id) : null;
  if (!r || r.status === "cancelled") return null;
  const row = (await myProjects(ctx as QueryCtx, me.email)).get(r.projectId);
  if (!row) return null;
  const b = row.project.businessId ? await ctx.db.get(row.project.businessId) : null;
  if (b?.modules?.projects === false) return null;
  return { me, r, p: row.project, b };
}

export const forClientProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return [];
    const id = ctx.db.normalizeId("projects", projectId);
    if (!id || !(await myProjects(ctx, me.email)).has(id)) return [];
    return (await ctx.db.query("fileRequests").withIndex("by_project", (q) => q.eq("projectId", id)).collect())
      .filter((r) => r.status === "open").map((r) => ({ _id: r._id, title: r.title, due: r.due, files: r.files.length }));
  },
});

export const page = query({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    const c = await clientRequest(ctx, requestId);
    if (!c) return null;
    const contact = await businessContact(ctx, c.p.businessId ?? null);
    return {
      _id: c.r._id, title: c.r.title, details: c.r.details ?? null, due: c.r.due, open: c.r.status === "open", remind: c.r.remind,
      files: c.r.files.map((f) => ({ name: f.name, size: f.size, at: f.at, mine: f.by === c.me.email })),
      project: { _id: c.p._id, label: label(c.p) }, business: c.b?.name ?? contact.name, owner: c.b?.ownerName?.trim() || contact.name,
      maxBytes: MAX_BYTES, today: todayCentral(),
    };
  },
});

// ---------- uploads ----------

/** Dropbox wants its argument header in plain ASCII. */
const headerJson = (x: unknown) => JSON.stringify(x).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
async function dropboxToken(ctx: ActionCtx, biz: Id<"businesses"> | null) {
  return await forBusiness(ctx, biz).runAction(internal.dropbox.freshToken, {});
}
async function rpc(token: string, path: string, body: unknown) {
  const r = await fetch(`https://api.dropboxapi.com/2${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}
async function content(token: string, path: string, arg: unknown, body: ArrayBuffer | null) {
  const r = await fetch(`https://content.dropboxapi.com/2${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": headerJson(arg), "content-type": "application/octet-stream" }, body: body ?? new ArrayBuffer(0) });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}

/** Starts one file: checks it's allowed, then hands back where to send it. */
export const start = action({
  args: { requestId: v.id("fileRequests"), name: v.string(), size: v.number() },
  handler: async (ctx, a): Promise<{ uploadId: Id<"fileUploads">; mode: "direct"; url: string } | { uploadId: Id<"fileUploads">; mode: "chunks"; token: string; chunk: number }> => {
    const name = safeName(a.name, 140);
    if (!(a.size > 0)) throw new ConvexError(`${name} is empty.`);
    if (a.size > MAX_BYTES) throw new ConvexError(`${name} is over 2 GB. Send big files another way, or ask for a link.`);
    const mode = a.size <= DIRECT_MAX ? "direct" : "chunks";
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = mode === "chunks" ? Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") : undefined;
    const u = await ctx.runMutation(internal.fileRequests.openUpload, { requestId: a.requestId, name, size: a.size, mode, ...(token ? { token } : {}) });
    if (mode === "chunks") return { uploadId: u.uploadId, mode, token: token!, chunk: CHUNK };
    try {
      const t = await dropboxToken(ctx, u.businessId);
      const r = await rpc(t, "/files/get_temporary_upload_link", { commit_info: { path: u.path, mode: "add", autorename: true, mute: false }, duration: 4 * 3600 });
      if (r.status !== 200 || !r.json?.link) throw new Error(r.json?.error_summary ?? r.text.slice(0, 120));
      return { uploadId: u.uploadId, mode, url: String(r.json.link) };
    } catch (e) {
      await ctx.runMutation(internal.fileRequests.failUpload, { uploadId: u.uploadId });
      const m = String((e as Error).message);
      console.error("upload link", m.slice(0, 160));
      // The Dropbox app needs the files.content.write permission to take uploads (its Permissions tab, then reconnect).
      throw new ConvexError(/missing_scope/.test(m) ? "The studio's Dropbox isn't set up to take uploads yet. Let them know." : "Dropbox didn't answer. Try again in a minute.");
    }
  },
});

/** The client's own check for a new upload: who, which request, still open. Makes the upload row. */
export const openUpload = internalMutation({
  args: { requestId: v.id("fileRequests"), name: v.string(), size: v.number(), mode: v.union(v.literal("direct"), v.literal("chunks")), token: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const c = await clientRequest(ctx, a.requestId);
    if (!c) throw new ConvexError("This request isn't here any more.");
    if (c.r.status !== "open") throw new ConvexError(`${c.b?.ownerName?.trim()?.split(" ")[0] || c.b?.name || "They"} closed this request. Reply to their email if you have more.`);
    if (c.r.files.length >= MAX_FILES) throw new ConvexError("That's the most files one request takes. Zip the rest together.");
    const now = Date.now();
    const uploadId = await ctx.db.insert("fileUploads", {
      requestId: a.requestId, email: c.me.email, name: a.name, size: a.size, path: `${c.r.folder}/${a.name}`, mode: a.mode, ...(a.token ? { token: a.token } : {}),
      offset: 0, status: "uploading", expiresAt: now + UPLOAD_HOURS * 3_600_000, createdAt: now,
    });
    return { uploadId, path: `${c.r.folder}/${a.name}`, businessId: (await businessOf(ctx, c.p)) };
  },
});
export const failUpload = internalMutation({
  args: { uploadId: v.id("fileUploads") },
  handler: async (ctx, { uploadId }) => {
    const u = await ctx.db.get(uploadId);
    if (u && u.status === "uploading") await ctx.db.patch(uploadId, { status: "failed" });
  },
});

/** After a direct upload: the browser says where Dropbox put it; the portal checks that with Dropbox before recording. */
export const finishDirect = action({
  args: { uploadId: v.id("fileUploads"), pathDisplay: v.string() },
  handler: async (ctx, { uploadId, pathDisplay }): Promise<{ name: string }> => {
    const u = await ctx.runQuery(internal.fileRequests.mineUpload, { uploadId });
    if (!u || u.mode !== "direct" || u.status !== "uploading") throw new ConvexError("This upload isn't open any more. Try the file again.");
    const folder = u.path.slice(0, u.path.lastIndexOf("/") + 1).toLowerCase();
    if (!pathDisplay.toLowerCase().startsWith(folder) || pathDisplay.slice(folder.length).includes("/")) throw new ConvexError("That file went somewhere else.");
    const t = await dropboxToken(ctx, u.businessId);
    const r = await rpc(t, "/files/get_metadata", { path: pathDisplay });
    if (r.status !== 200 || r.json?.[".tag"] !== "file" || r.json.size !== u.size) throw new ConvexError("Dropbox doesn't have the whole file. Try it again.");
    return await ctx.runMutation(internal.fileRequests.complete, { uploadId, path: String(r.json.path_display), name: String(r.json.name) });
  },
});
export const mineUpload = internalQuery({
  args: { uploadId: v.id("fileUploads") },
  handler: async (ctx, { uploadId }) => {
    const me = await requireSignedIn(ctx);
    const u = await ctx.db.get(uploadId);
    if (!u || u.email !== me.email || u.expiresAt < Date.now()) return null;
    const r = await ctx.db.get(u.requestId);
    const p = r ? await ctx.db.get(r.projectId) : null;
    return { ...u, businessId: p ? await businessOf(ctx, p) : null };
  },
});

/** Records a finished file on its request (once), and lines up the owner's email. */
export const complete = internalMutation({
  args: { uploadId: v.id("fileUploads"), path: v.string(), name: v.string() },
  handler: async (ctx, a) => {
    const u = await ctx.db.get(a.uploadId);
    if (!u) throw new ConvexError("This upload isn't here.");
    if (u.status === "done") return { name: a.name };
    const r = await ctx.db.get(u.requestId);
    if (!r) throw new ConvexError("This request isn't here any more.");
    const now = Date.now();
    await ctx.db.patch(a.uploadId, { status: "done", offset: u.size, path: a.path });
    if (!r.files.some((f) => f.path.toLowerCase() === a.path.toLowerCase())) {
      await ctx.db.patch(r._id, { files: [...r.files, { name: a.name, size: u.size, path: a.path, at: now, by: u.email }], lastUploadAt: now, updatedAt: now });
      await ctx.scheduler.runAfter(OWNER_MAIL_DELAY, internal.fileRequests.mailOwner, { requestId: r._id, at: now });
    }
    return { name: a.name };
  },
});

// The pieces of a big file: POST /upload/chunk?t=<upload token>&o=<offset>, the bytes as the body.
export const chunkPreflight = httpAction(async (_ctx, req) => new Response(null, { status: 204, headers: corsHeaders(req) }));
export const chunk = httpAction(async (ctx, req) => {
  const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders(req) } });
  const url = new URL(req.url);
  const token = (url.searchParams.get("t") ?? "").slice(0, 80);
  const offset = Number(url.searchParams.get("o"));
  if (!token || !Number.isSafeInteger(offset) || offset < 0) return out({ error: "Bad request." }, 400);
  const u = await ctx.runQuery(internal.fileRequests.uploadByToken, { token });
  if (!u || u.status !== "uploading" || u.expiresAt < Date.now()) return out({ error: "This upload isn't open any more. Try the file again." }, 410);
  if (offset !== u.offset) return out({ offset: u.offset }, 409); // the browser picks up where the portal is
  const body = await req.arrayBuffer();
  const len = body.byteLength;
  const last = offset + len === u.size;
  if (!len || len > CHUNK || offset + len > u.size || (!last && len !== CHUNK)) return out({ error: "That piece is the wrong size." }, 400);
  try {
    const t = await dropboxToken(ctx, u.businessId);
    let sessionId = u.sessionId;
    if (offset === 0) {
      const r = await content(t, "/files/upload_session/start", { close: false }, body);
      if (r.status !== 200 || !r.json?.session_id) throw new Error(r.json?.error_summary ?? r.text.slice(0, 160));
      sessionId = String(r.json.session_id);
    } else {
      const r = await content(t, "/files/upload_session/append_v2", { cursor: { session_id: sessionId, offset }, close: false }, body);
      if (r.status !== 200) {
        const right = r.json?.error?.correct_offset;
        if (typeof right === "number") { await ctx.runMutation(internal.fileRequests.advance, { uploadId: u._id, from: u.offset, to: right, sessionId: sessionId! }); return out({ offset: right }, 409); }
        throw new Error(r.json?.error_summary ?? r.text.slice(0, 160));
      }
    }
    await ctx.runMutation(internal.fileRequests.advance, { uploadId: u._id, from: offset, to: offset + len, sessionId: sessionId! });
    if (!last) return out({ offset: offset + len });
    const f = await content(t, "/files/upload_session/finish", { cursor: { session_id: sessionId, offset: u.size }, commit: { path: u.path, mode: "add", autorename: true, mute: false } }, null);
    if (f.status !== 200 || !f.json?.path_display) throw new Error(f.json?.error_summary ?? f.text.slice(0, 160));
    const done = await ctx.runMutation(internal.fileRequests.complete, { uploadId: u._id, path: String(f.json.path_display), name: String(f.json.name) });
    return out({ done: true, name: done.name });
  } catch (e) {
    console.error("upload chunk", String((e as Error).message).slice(0, 200));
    return out({ error: "Dropbox didn't take that piece. The upload will try again." }, 502);
  }
});
export const uploadByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const u = await ctx.db.query("fileUploads").withIndex("by_token", (q) => q.eq("token", token)).first();
    if (!u || u.mode !== "chunks") return null;
    const r = await ctx.db.get(u.requestId);
    const p = r ? await ctx.db.get(r.projectId) : null;
    if (!r || r.status !== "open" || !p) return null;
    return { ...u, businessId: await businessOf(ctx, p) };
  },
});
export const advance = internalMutation({
  args: { uploadId: v.id("fileUploads"), from: v.number(), to: v.number(), sessionId: v.string() },
  handler: async (ctx, a) => {
    const u = await ctx.db.get(a.uploadId);
    if (!u || u.status !== "uploading" || u.offset !== a.from) return false;
    await ctx.db.patch(a.uploadId, { offset: a.to, sessionId: a.sessionId });
    return true;
  },
});

// ---------- emails and the reminder ----------

export const mailData = internalQuery({
  args: { requestId: v.id("fileRequests") },
  handler: async (ctx, { requestId }) => {
    const r = await ctx.db.get(requestId);
    if (!r || r.status !== "open") return null;
    const p = await ctx.db.get(r.projectId);
    if (!p) return null;
    const biz = await businessOf(ctx, p);
    return { r, project: label(p), projectId: p._id, biz, brand: await mailBrandOf(ctx, biz), owner: (await businessContact(ctx, biz)).ownerEmail, people: (await portalPeople(ctx, p)).map((x) => x.email) };
  },
});
export const mail = internalAction({
  args: { requestId: v.id("fileRequests"), kind: v.union(v.literal("asked"), v.literal("tomorrow")), emails: v.array(v.string()) },
  handler: async (ctx, { requestId, kind, emails }) => {
    const d = await ctx.runQuery(internal.fileRequests.mailData, { requestId });
    if (!d) return 0;
    let sent = 0;
    for (const email of emails) {
      const m = fileRequestMail(d.brand, { kind, name: await ctx.runQuery(internal.shoots.nameOf, { email }), project: d.project, title: d.r.title, details: d.r.details ?? null, due: d.r.due, uploaded: d.r.files.length, link: `${SITE()}/requests/${requestId}` });
      try {
        if ((await deliverOnce(ctx, `files-${kind}:${requestId}:${email.toLowerCase()}`, kind === "asked" ? "file_request" : "files_due", email, m, d.brand.replyTo, d.biz)) === "sent") sent++;
        if (kind === "asked") await ctx.runMutation(internal.emails.markInboxEmailed, { key: `files:${requestId}`, email });
      } catch (e) { console.error("file request email", String((e as Error).message).slice(0, 120)); }
    }
    return sent;
  },
});
export const mailOwner = internalAction({
  args: { requestId: v.id("fileRequests"), at: v.number() },
  handler: async (ctx, { requestId, at }) => {
    const d = await ctx.runQuery(internal.fileRequests.ownerMailData, { requestId, at });
    if (!d) return;
    await ctx.runMutation(internal.fileRequests.ownerMailed, { requestId, at });
    await deliverOnce(ctx, `files-uploaded:${requestId}:${at}`, "files_uploaded", d.owner, ownerFilesMail(d.brand, {
      who: d.who, count: d.count, title: d.title, project: d.project, folder: d.folder, link: `${SITE()}/projects/${d.projectId}`,
    }), d.brand.replyTo, d.biz);
  },
});
/** One email per sitting: only the run for the last upload sends, counting the files since the last email. */
export const ownerMailData = internalQuery({
  args: { requestId: v.id("fileRequests"), at: v.number() },
  handler: async (ctx, { requestId, at }) => {
    const r = await ctx.db.get(requestId);
    if (!r || r.lastUploadAt !== at) return null;
    const p = await ctx.db.get(r.projectId);
    if (!p) return null;
    const biz = await businessOf(ctx, p);
    const fresh = r.files.filter((f) => f.at > (r.ownerMailedAt ?? 0) && f.at <= at);
    if (!fresh.length) return null;
    const by = fresh[fresh.length - 1].by;
    const who = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", by)).first())?.name ?? by;
    const owner = (await businessContact(ctx, biz)).ownerEmail;
    return owner ? { owner, who, count: fresh.length, title: r.title, project: label(p), projectId: p._id, folder: r.folder, biz, brand: await mailBrandOf(ctx, biz) } : null;
  },
});

export const ownerMailed = internalMutation({
  args: { requestId: v.id("fileRequests"), at: v.number() },
  handler: async (ctx, { requestId, at }) => { if (await ctx.db.get(requestId)) await ctx.db.patch(requestId, { ownerMailedAt: at }); },
});

/** Hourly: email 32 for requests due tomorrow with nothing uploaded (from 9 AM Central, once). */
export const remindDue = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const hour = Number(new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }));
    if (hour < 9) return 0;
    const due: Array<{ requestId: Id<"fileRequests">; emails: string[] }> = await ctx.runQuery(internal.fileRequests.dueTomorrow, {});
    for (const d of due) {
      await ctx.runMutation(internal.fileRequests.markReminded, { requestId: d.requestId });
      if (d.emails.length) await ctx.runAction(internal.fileRequests.mail, { requestId: d.requestId, kind: "tomorrow", emails: d.emails });
    }
    return due.length;
  },
});
export const dueTomorrow = internalQuery({
  args: {},
  handler: async (ctx) => {
    const t = new Date(`${todayCentral()}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    const tomorrow = t.toISOString().slice(0, 10);
    const rows = (await ctx.db.query("fileRequests").withIndex("by_status_due", (q) => q.eq("status", "open").eq("due", tomorrow)).collect()).filter((r) => r.remind && !r.remindedAt && !r.files.length);
    const out = [];
    for (const r of rows) {
      const p = await ctx.db.get(r.projectId);
      if (p) out.push({ requestId: r._id, emails: (await portalPeople(ctx, p)).map((x) => x.email) });
    }
    return out;
  },
});
export const markReminded = internalMutation({
  args: { requestId: v.id("fileRequests") },
  handler: async (ctx, { requestId }) => {
    const r = await ctx.db.get(requestId);
    if (r) await ctx.db.patch(requestId, { remindedAt: Date.now(), history: [...r.history, { at: Date.now(), text: `Reminder sent (due ${shortDay(r.due)})` }] });
  },
});
