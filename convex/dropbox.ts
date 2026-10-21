// Phase 2: the Dropbox drop folder. Renders saved to Apps/Wrangler Review/<Project>/<Video>/ become new versions.
// Flow: Dropbox tells us something changed (webhook, plus a check every minute) → we list what changed → once a
// file has stopped changing and is complete, Bunny pulls it through a share link → the link is deleted as soon as
// Bunny has the file. Tokens stay in the backend; the Settings page only ever sees names, dates and statuses.
import { action, httpAction, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMe } from "./lib/access";
import { bunnyCall, bunnyEnv } from "./bunny";
import { httpRangeReader, mp4HasIndex } from "./lib/mp4";
import { directLink, placeFor, projectMatches, splitJob } from "./lib/dropboxPath";

const API = "https://api.dropboxapi.com/2";
const SETTLE_MS = 60_000; // a file must sit unchanged this long before we look at it
const MAX_CHECKS = 180; // ~3 hours of "not finished yet" before giving up
const LINK_SWEEP_MS = 3 * 3600_000; // any share link still around after this gets deleted regardless

const site = () => (process.env.SITE_URL || "https://review.wranglerportal.com").replace(/\/$/, "");
const redirectUri = () => `${(process.env.CONVEX_SITE_URL || "").replace(/\/$/, "")}/dropbox/callback`;
function appCreds() {
  const key = process.env.DROPBOX_APP_KEY, secret = process.env.DROPBOX_APP_SECRET;
  if (!key || !secret) throw new ConvexError("Dropbox isn't set up yet: DROPBOX_APP_KEY and DROPBOX_APP_SECRET are missing in Convex.");
  return { key, secret };
}
function randomToken(n = 24) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const errText = (e: unknown) => ((e as Error)?.message || String(e)).replace(/^.*ConvexError: /, "").split("\n")[0].slice(0, 300);

// ---------- what Settings shows ----------

export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const conn = await ctx.db.query("dropbox").first();
    const files = (await ctx.db.query("dropFiles").order("desc").take(40))
      .filter((f) => f.status !== "existing")
      .sort((a, b) => b.lastChangeAt - a.lastChangeAt).slice(0, 12);
    const recent = [];
    for (const f of files) {
      const ver = f.versionId ? await ctx.db.get(f.versionId) : null;
      recent.push({
        _id: f._id, path: f.pathDisplay, status: f.status, reason: f.reason ?? null, at: f.lastChangeAt, size: f.size,
        videoId: ver?.videoId ?? null, versionNumber: ver?.number ?? null, linkGone: !f.shareUrl || !!f.linkRevokedAt,
      });
    }
    return {
      configured: Boolean(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET),
      transcripts: Boolean(process.env.ELEVENLABS_API_KEY),
      connected: Boolean(conn),
      email: conn?.email ?? null,
      name: conn?.name ?? null,
      connectedAt: conn?.connectedAt ?? null,
      lastSyncAt: conn?.lastSyncAt ?? null,
      lastError: conn?.lastError ?? null,
      recent,
    };
  },
});

// ---------- connecting ----------

export const authUrl = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const me: { userId: string } = await ctx.runQuery(internal.users.assertAllowed, {});
    const { key } = appCreds();
    const state = randomToken();
    await ctx.runMutation(internal.dropbox.insertState, { state, userId: me.userId });
    const q = new URLSearchParams({ client_id: key, response_type: "code", token_access_type: "offline", redirect_uri: redirectUri(), state });
    return `https://www.dropbox.com/oauth2/authorize?${q}`;
  },
});

export const insertState = internalMutation({
  args: { state: v.string(), userId: v.string() },
  handler: async (ctx, a) => {
    for (const old of await ctx.db.query("oauthStates").collect()) if (Date.now() - old.createdAt > 3600_000) await ctx.db.delete(old._id);
    await ctx.db.insert("oauthStates", { ...a, createdAt: Date.now() });
  },
});

export const takeState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const row = await ctx.db.query("oauthStates").withIndex("by_state", (q) => q.eq("state", state)).unique();
    if (!row) return false;
    await ctx.db.delete(row._id);
    return Date.now() - row.createdAt < 15 * 60_000;
  },
});

async function tokenRequest(params: Record<string, string>) {
  const { key, secret } = appCreds();
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${btoa(`${key}:${secret}`)}` },
    body: new URLSearchParams(params),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; account_id?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`Dropbox sign-in failed: ${body.error_description || body.error || res.status}`);
  return body;
}

async function rawCall(token: string, path: string, body: unknown) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body ?? null),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: res.status, json, text };
}

class DropboxError extends Error {
  constructor(public status: number, public summary: string) { super(`Dropbox ${status}: ${summary}`); }
}

// The callback Dropbox sends Heston back to after he approves the app.
export const callback = httpAction(async (ctx, req) => {
  const u = new URL(req.url);
  const back = (q: string) => new Response(null, { status: 302, headers: { location: `${site()}/settings?${q}#dropbox` } });
  if (u.searchParams.get("error")) return back(`dropbox=error&reason=${encodeURIComponent(u.searchParams.get("error_description") || u.searchParams.get("error") || "declined")}`);
  const code = u.searchParams.get("code"), state = u.searchParams.get("state");
  if (!code || !state || !(await ctx.runMutation(internal.dropbox.takeState, { state }))) return back("dropbox=error&reason=expired");
  try {
    const tok = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
    if (!tok.refresh_token) throw new Error("Dropbox didn't send a refresh token");
    const acct = await rawCall(tok.access_token!, "/users/get_current_account", null);
    const email = acct.json?.email as string | undefined;
    const name = acct.json?.name?.display_name as string | undefined;
    // Baseline: whatever is already in the folder isn't treated as a new render.
    const existing: Array<{ pathLower: string; pathDisplay: string; rev: string; size: number }> = [];
    let r = await rawCall(tok.access_token!, "/files/list_folder", { path: "", recursive: true, include_deleted: false });
    if (r.status !== 200) throw new Error(`list_folder ${r.status}: ${r.json?.error_summary ?? r.text.slice(0, 100)}`);
    for (;;) {
      for (const e of r.json.entries ?? []) if (e[".tag"] === "file") existing.push({ pathLower: e.path_lower, pathDisplay: e.path_display, rev: e.rev, size: e.size });
      if (!r.json.has_more) break;
      r = await rawCall(tok.access_token!, "/files/list_folder/continue", { cursor: r.json.cursor });
      if (r.status !== 200) throw new Error(`list_folder/continue ${r.status}`);
    }
    await ctx.runMutation(internal.dropbox.saveConnection, {
      accountId: tok.account_id ?? acct.json?.account_id ?? "unknown", email, name, refreshToken: tok.refresh_token,
      accessToken: tok.access_token!, accessExpiresAt: Date.now() + (tok.expires_in ?? 14400) * 1000, cursor: r.json.cursor,
    });
    for (let i = 0; i < existing.length; i += 50) {
      await ctx.runMutation(internal.dropbox.recordFiles, { files: existing.slice(i, i + 50), baseline: true });
    }
    return back("dropbox=connected");
  } catch (e) {
    return back(`dropbox=error&reason=${encodeURIComponent(errText(e))}`);
  }
});

export const saveConnection = internalMutation({
  args: { accountId: v.string(), email: v.optional(v.string()), name: v.optional(v.string()), refreshToken: v.string(), accessToken: v.string(), accessExpiresAt: v.number(), cursor: v.string() },
  handler: async (ctx, a) => {
    for (const old of await ctx.db.query("dropbox").collect()) await ctx.db.delete(old._id);
    await ctx.db.insert("dropbox", { ...a, connectedAt: Date.now(), lastSyncAt: Date.now() });
  },
});

export const getConnection = internalQuery({ args: {}, handler: async (ctx) => ctx.db.query("dropbox").first() });

export const patchConnection = internalMutation({
  args: { patch: v.any() },
  handler: async (ctx, { patch }) => {
    const row = await ctx.db.query("dropbox").first();
    if (!row) return;
    const allowed = ["accessToken", "accessExpiresAt", "cursor", "lastSyncAt", "lastError"];
    const p: Record<string, unknown> = {};
    for (const k of allowed) if (k in patch) p[k] = patch[k];
    await ctx.db.patch(row._id, p);
  },
});

export const disconnect = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    const conn = await ctx.runQuery(internal.dropbox.getConnection, {});
    if (conn) {
      try { await rawCall(await accessToken(ctx), "/auth/token/revoke", null); } catch { /* already gone */ }
    }
    await ctx.runMutation(internal.dropbox.removeConnection, {});
  },
});

export const removeConnection = internalMutation({
  args: {},
  handler: async (ctx) => { for (const row of await ctx.db.query("dropbox").collect()) await ctx.db.delete(row._id); },
});

// A fresh access token (Dropbox's last 4 hours; the refresh token doesn't expire).
async function accessToken(ctx: ActionCtx, force = false): Promise<string> {
  const conn: Doc<"dropbox"> | null = await ctx.runQuery(internal.dropbox.getConnection, {});
  if (!conn) throw new Error("Dropbox isn't connected.");
  if (!force && conn.accessToken && (conn.accessExpiresAt ?? 0) > Date.now() + 120_000) return conn.accessToken;
  const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: conn.refreshToken });
  await ctx.runMutation(internal.dropbox.patchConnection, { patch: { accessToken: tok.access_token, accessExpiresAt: Date.now() + (tok.expires_in ?? 14400) * 1000 } });
  return tok.access_token!;
}

async function dbx(ctx: ActionCtx, path: string, body: unknown): Promise<any> {
  let r = await rawCall(await accessToken(ctx), path, body);
  if (r.status === 401) r = await rawCall(await accessToken(ctx, true), path, body);
  if (r.status !== 200) throw new DropboxError(r.status, r.json?.error_summary ?? r.text.slice(0, 200));
  return r.json;
}

// ---------- noticing new files ----------

const fileArg = v.object({ pathLower: v.string(), pathDisplay: v.string(), rev: v.string(), size: v.number() });

export const recordFiles = internalMutation({
  args: { files: v.array(fileArg), baseline: v.optional(v.boolean()) },
  handler: async (ctx, { files, baseline }) => {
    const now = Date.now();
    let fresh = 0;
    for (const f of files) {
      const place = placeFor(f.pathDisplay);
      if (!place.ok && place.ignore) continue;
      const rows = await ctx.db.query("dropFiles").withIndex("by_path", (q) => q.eq("pathLower", f.pathLower)).collect();
      const latest = rows.sort((a, b) => b.firstSeenAt - a.firstSeenAt)[0];
      if (latest && latest.rev === f.rev) continue;
      const status = baseline ? "existing" : place.ok ? "waiting" : "skipped";
      const reason = !place.ok ? place.reason : undefined;
      if (latest && !baseline && (latest.status === "waiting" || (latest.status === "failed" && !latest.versionId) || latest.status === "skipped")) {
        await ctx.db.patch(latest._id, { rev: f.rev, size: f.size, pathDisplay: f.pathDisplay, status, reason, lastChangeAt: now, checks: 0 });
      } else if (!latest || latest.status !== "importing") {
        await ctx.db.insert("dropFiles", { ...f, status, reason, firstSeenAt: now, lastChangeAt: now, checks: 0 });
      } else {
        // Being imported right now: the import re-checks the revision and starts over if it changed.
        continue;
      }
      if (status === "waiting") fresh++;
    }
    return fresh;
  },
});

export const dueFiles = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const waiting = await ctx.db.query("dropFiles").withIndex("by_status", (q) => q.eq("status", "waiting")).collect();
    const stuck = (await ctx.db.query("dropFiles").withIndex("by_status", (q) => q.eq("status", "importing")).collect())
      .filter((f) => now - f.lastChangeAt > 20 * 60_000); // an import that died mid-way gets another go
    return [...waiting.filter((f) => now - f.lastChangeAt >= SETTLE_MS), ...stuck].slice(0, 5).map((f) => f._id);
  },
});

export const linksToSweep = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) =>
    (await ctx.db.query("dropFiles").withIndex("by_status", (q) => q.eq("status", "imported")).collect())
      .filter((f) => f.shareUrl && !f.linkRevokedAt && now - (f.importedAt ?? 0) > LINK_SWEEP_MS)
      .map((f) => f._id),
});

// Runs every minute (crons.ts) and whenever Dropbox's webhook fires.
export const sync = internalAction({
  args: {},
  handler: async (ctx): Promise<{ connected: boolean; changes?: number; due?: number; error?: string }> => {
    const conn = await ctx.runQuery(internal.dropbox.getConnection, {});
    if (!conn) return { connected: false };
    let changes = 0;
    try {
      let cursor = conn.cursor;
      let r: any = cursor ? await dbx(ctx, "/files/list_folder/continue", { cursor }).catch((e) => {
        if (e instanceof DropboxError && e.status === 409 && /reset/.test(e.summary)) return null;
        throw e;
      }) : null;
      if (!r) r = await dbx(ctx, "/files/list_folder", { path: "", recursive: true, include_deleted: false });
      for (;;) {
        const files = (r.entries ?? []).filter((e: any) => e[".tag"] === "file")
          .map((e: any) => ({ pathLower: e.path_lower, pathDisplay: e.path_display, rev: e.rev, size: e.size }));
        if (files.length) changes += await ctx.runMutation(internal.dropbox.recordFiles, { files });
        cursor = r.cursor;
        if (!r.has_more) break;
        r = await dbx(ctx, "/files/list_folder/continue", { cursor });
      }
      await ctx.runMutation(internal.dropbox.patchConnection, { patch: { cursor, lastSyncAt: Date.now(), lastError: undefined } });
    } catch (e) {
      await ctx.runMutation(internal.dropbox.patchConnection, { patch: { lastError: errText(e), lastSyncAt: Date.now() } });
      return { connected: true, error: errText(e) };
    }
    const due: Id<"dropFiles">[] = await ctx.runQuery(internal.dropbox.dueFiles, { now: Date.now() });
    for (const fileId of due) await ctx.scheduler.runAfter(0, internal.dropbox.importFile, { fileId });
    for (const fileId of await ctx.runQuery(internal.dropbox.linksToSweep, { now: Date.now() })) {
      await ctx.scheduler.runAfter(0, internal.dropbox.revokeLink, { fileId });
    }
    return { connected: true, changes, due: due.length };
  },
});

export const syncNow = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    await ctx.scheduler.runAfter(0, internal.dropbox.sync, {});
  },
});

// Dropbox webhook: GET answers the one-time challenge; POST means "something changed".
export const webhookVerify = httpAction(async (_ctx, req) => {
  const challenge = new URL(req.url).searchParams.get("challenge") ?? "";
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain", "x-content-type-options": "nosniff" } });
});

export async function dropboxSignatureOk(body: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body)));
  const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export const webhookNotify = httpAction(async (ctx, req) => {
  const body = await req.text();
  const secret = process.env.DROPBOX_APP_SECRET;
  if (!secret || !(await dropboxSignatureOk(body, req.headers.get("x-dropbox-signature"), secret))) return new Response("bad signature", { status: 403 });
  await ctx.scheduler.runAfter(0, internal.dropbox.sync, {});
  return new Response(null, { status: 200 });
});

// ---------- importing one file ----------

export const claim = internalMutation({
  args: { fileId: v.id("dropFiles") },
  handler: async (ctx, { fileId }) => {
    const f = await ctx.db.get(fileId);
    if (!f) return null;
    const stuck = f.status === "importing" && Date.now() - f.lastChangeAt > 20 * 60_000;
    if (f.status !== "waiting" && !stuck) return null;
    await ctx.db.patch(fileId, { status: "importing", lastChangeAt: Date.now() });
    return f;
  },
});

export const patchFile = internalMutation({
  args: { fileId: v.id("dropFiles"), patch: v.any() },
  handler: async (ctx, { fileId, patch }) => {
    const allowed = ["status", "reason", "rev", "size", "lastChangeAt", "checks", "shareUrl", "linkRevokedAt"];
    const p: Record<string, unknown> = {};
    for (const k of allowed) if (k in patch) p[k] = patch[k];
    await ctx.db.patch(fileId, p);
  },
});

// Finds the project and video for /<Project>/<Video>/, making them if they're new.
export const findOrCreateTarget = internalMutation({
  args: { project: v.string(), video: v.string() },
  handler: async (ctx, a) => {
    const now = Date.now();
    const projects = await ctx.db.query("projects").collect();
    let project = projects.find((p) => projectMatches(a.project, p));
    if (!project) {
      const { jobNumber, name } = splitJob(a.project);
      const id = await ctx.db.insert("projects", { name, ...(jobNumber ? { jobNumber } : {}), createdAt: now });
      project = (await ctx.db.get(id))!;
    }
    const videos = await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", project!._id)).collect();
    const t = a.video.trim().toLowerCase();
    let video = videos.find((x) => x.title.trim().toLowerCase() === t);
    if (!video) {
      const id = await ctx.db.insert("videos", { projectId: project._id, title: a.video.trim(), createdAt: now, updatedAt: now });
      video = (await ctx.db.get(id))!;
    }
    return { projectId: project._id, videoId: video._id };
  },
});

export const addVersion = internalMutation({
  args: { fileId: v.id("dropFiles"), videoId: v.id("videos"), bunnyGuid: v.string(), fileName: v.string(), fileSize: v.number(), dropboxPath: v.string(), shareUrl: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", a.videoId)).collect();
    const number = existing.reduce((m, x) => Math.max(m, x.number), 0) + 1;
    const now = Date.now();
    const versionId = await ctx.db.insert("versions", {
      videoId: a.videoId, number, status: "processing", pollCount: 0, bunnyGuid: a.bunnyGuid, fileName: a.fileName.slice(0, 300),
      fileSize: a.fileSize, startTimecode: "01:00:00:00", uploaderName: "Dropbox", dropboxPath: a.dropboxPath, createdAt: now,
    });
    await ctx.db.patch(a.videoId, { updatedAt: now });
    await ctx.db.patch(a.fileId, { status: "imported", versionId, shareUrl: a.shareUrl, importedAt: now, lastChangeAt: now, reason: undefined });
    return { versionId, number };
  },
});

async function shareLink(ctx: ActionCtx, path: string): Promise<{ url: string; shared: boolean }> {
  try {
    const r = await dbx(ctx, "/sharing/create_shared_link_with_settings", { path, settings: { audience: "public", access: "viewer", allow_download: true } });
    return { url: r.url, shared: true };
  } catch (e) {
    if (e instanceof DropboxError && e.status === 409 && /shared_link_already_exists/.test(e.summary)) {
      const l = await dbx(ctx, "/sharing/list_shared_links", { path, direct_only: true });
      if (l.links?.[0]?.url) return { url: l.links[0].url, shared: true };
    }
    // The team may not allow public links. A temporary link (4 hours, nothing to clean up) is the fallback.
    const t = await dbx(ctx, "/files/get_temporary_link", { path });
    return { url: t.link, shared: false };
  }
}

async function revokeUrl(ctx: ActionCtx, url: string) {
  try {
    await dbx(ctx, "/sharing/revoke_shared_link", { url });
  } catch (e) {
    if (e instanceof DropboxError && e.status === 409 && /shared_link_not_found|shared_link_access_denied/.test(e.summary)) return;
    throw e;
  }
}

export const importFile = internalAction({
  args: { fileId: v.id("dropFiles") },
  handler: async (ctx, { fileId }): Promise<{ result: string }> => {
    const f: Doc<"dropFiles"> | null = await ctx.runMutation(internal.dropbox.claim, { fileId });
    if (!f) return { result: "not waiting" };
    const place = placeFor(f.pathDisplay);
    if (!place.ok) {
      await ctx.runMutation(internal.dropbox.patchFile, { fileId, patch: { status: "skipped", reason: place.reason } });
      return { result: "skipped" };
    }
    let link: { url: string; shared: boolean } | null = null;
    try {
      const meta = await dbx(ctx, "/files/get_metadata", { path: f.pathLower });
      if (meta[".tag"] !== "file") throw new Error("It's no longer a file.");
      if (meta.rev !== f.rev) {
        await ctx.runMutation(internal.dropbox.patchFile, { fileId, patch: { status: "waiting", rev: meta.rev, size: meta.size, lastChangeAt: Date.now(), checks: 0 } });
        return { result: "changed again; waiting" };
      }
      if (place.checkIndex) {
        const t = await dbx(ctx, "/files/get_temporary_link", { path: f.pathLower });
        const complete = await mp4HasIndex(httpRangeReader(t.link), meta.size);
        if (!complete) {
          const checks = f.checks + 1;
          await ctx.runMutation(internal.dropbox.patchFile, {
            fileId, patch: checks >= MAX_CHECKS
              ? { status: "failed", reason: "This file never finished: it has no index. Render or export it again.", checks }
              : { status: "waiting", reason: "Waiting for the file to finish.", lastChangeAt: Date.now(), checks },
          });
          return { result: "not finished yet" };
        }
      }
      const target = await ctx.runMutation(internal.dropbox.findOrCreateTarget, { project: place.project, video: place.video });
      link = await shareLink(ctx, f.pathLower);
      const { lib } = bunnyEnv();
      const tag = `wr-import-${fileId}`;
      await bunnyCall(`/library/${lib}/videos/fetch`, { method: "POST", body: JSON.stringify({ url: link.shared ? directLink(link.url) : link.url, title: tag }) });
      // Bunny's fetch doesn't return the new video's id, so find it by its one-off title, then give it the file's name.
      let guid: string | null = null;
      for (let i = 0; i < 20 && !guid; i++) {
        await new Promise((r) => setTimeout(r, i === 0 ? 1500 : 3000));
        const found = (await bunnyCall(`/library/${lib}/videos?page=1&itemsPerPage=10&search=${encodeURIComponent(tag)}`)) as { items?: Array<{ guid: string; title: string }> };
        guid = found.items?.find((x) => x.title === tag)?.guid ?? null;
      }
      if (!guid) throw new Error("Bunny didn't start the import.");
      await bunnyCall(`/library/${lib}/videos/${guid}`, { method: "POST", body: JSON.stringify({ title: place.fileName }) }).catch(() => null);
      const { versionId } = await ctx.runMutation(internal.dropbox.addVersion, {
        fileId, videoId: target.videoId, bunnyGuid: guid, fileName: place.fileName, fileSize: f.size, dropboxPath: f.pathDisplay,
        shareUrl: link.shared ? link.url : undefined,
      });
      await ctx.scheduler.runAfter(5000, internal.uploads.poll, { versionId });
      return { result: "imported" };
    } catch (e) {
      if (link?.shared) await revokeUrl(ctx, link.url).catch(() => null);
      await ctx.runMutation(internal.dropbox.patchFile, { fileId, patch: { status: "failed", reason: errText(e) } });
      return { result: `failed: ${errText(e)}` };
    }
  },
});

// Called by the upload poll once Bunny has the file (and by the sweep): deletes the share link.
export const fileForVersion = internalQuery({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => (await ctx.db.query("dropFiles").withIndex("by_version", (q) => q.eq("versionId", versionId)).first())?._id ?? null,
});

export const revokeForVersion = internalAction({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    const fileId = await ctx.runQuery(internal.dropbox.fileForVersion, { versionId });
    if (fileId) await ctx.runAction(internal.dropbox.revokeLink, { fileId });
  },
});

export const getFile = internalQuery({ args: { fileId: v.id("dropFiles") }, handler: async (ctx, { fileId }) => ctx.db.get(fileId) });

export const revokeLink = internalAction({
  args: { fileId: v.id("dropFiles") },
  handler: async (ctx, { fileId }) => {
    const f = await ctx.runQuery(internal.dropbox.getFile, { fileId });
    if (!f?.shareUrl || f.linkRevokedAt) return { revoked: false };
    await revokeUrl(ctx, f.shareUrl);
    await ctx.runMutation(internal.dropbox.patchFile, { fileId, patch: { linkRevokedAt: Date.now() } });
    return { revoked: true };
  },
});

// For tests and the CI check: are any share links left on files in the drop folder? Counts only.
export const shareLinkCount = internalAction({
  args: {},
  handler: async (ctx) => {
    const conn = await ctx.runQuery(internal.dropbox.getConnection, {});
    if (!conn) return { connected: false };
    let r = await dbx(ctx, "/sharing/list_shared_links", {});
    let n = (r.links ?? []).length;
    while (r.has_more) { r = await dbx(ctx, "/sharing/list_shared_links", { cursor: r.cursor }); n += (r.links ?? []).length; }
    return { connected: true, sharedLinks: n };
  },
});

// Live check of the Bunny half of an import, without Dropbox: Bunny fetches an existing version's small MP4
// (with the site as referer), we find the new video by its one-off title, then delete it. Returns steps only.
export const bunnyFetchCheck = internalAction({
  args: {},
  handler: async (ctx) => {
    const { lib } = bunnyEnv();
    const src: { guid: string; height: number } | null = await ctx.runQuery(internal.dropbox.anyReadyMp4, {});
    if (!src) return { ok: false, step: "no ready version with an MP4 copy" };
    const site = (process.env.SITE_URL || "https://review.wranglerportal.com").replace(/\/?$/, "/");
    const url = `https://${process.env.BUNNY_STREAM_CDN || "vz-3ba0610b-f90.b-cdn.net"}/${src.guid}/play_${src.height}p.mp4`;
    const tag = `wr-fetch-check-${randomToken(6)}`;
    const steps: string[] = [];
    let guid: string | null = null;
    try {
      const r = await bunnyCall(`/library/${lib}/videos/fetch`, { method: "POST", body: JSON.stringify({ url, title: tag, headers: { Referer: site } }) });
      steps.push(`fetch accepted: ${JSON.stringify(r).slice(0, 80)}`);
      for (let i = 0; i < 20 && !guid; i++) {
        await new Promise((res) => setTimeout(res, i === 0 ? 1500 : 3000));
        const found = (await bunnyCall(`/library/${lib}/videos?page=1&itemsPerPage=10&search=${encodeURIComponent(tag)}`)) as { items?: Array<{ guid: string; title: string }> };
        guid = found.items?.find((x) => x.title === tag)?.guid ?? null;
      }
      steps.push(guid ? "found the new video by its title" : "never found the new video");
      if (guid) {
        let status = -1;
        for (let i = 0; i < 20 && status < 1; i++) {
          await new Promise((res) => setTimeout(res, 3000));
          status = ((await bunnyCall(`/library/${lib}/videos/${guid}`)) as { status: number }).status;
        }
        steps.push(`status after fetch: ${status}`);
        await bunnyCall(`/library/${lib}/videos/${guid}`, { method: "POST", body: JSON.stringify({ title: "fetch check (renamed)" }) });
        steps.push("renamed");
      }
      return { ok: Boolean(guid), steps };
    } catch (e) {
      steps.push(`error: ${errText(e)}`);
      return { ok: false, steps };
    } finally {
      if (guid) { await bunnyCall(`/library/${lib}/videos/${guid}`, { method: "DELETE" }).catch(() => null); steps.push("deleted the test video"); }
    }
  },
});

export const anyReadyMp4 = internalQuery({
  args: {},
  handler: async (ctx) => {
    for (const ver of await ctx.db.query("versions").order("desc").collect()) {
      if (ver.status === "ready" && ver.mp4Heights?.length) return { guid: ver.bunnyGuid, height: Math.min(...ver.mp4Heights) };
    }
    return null;
  },
});
