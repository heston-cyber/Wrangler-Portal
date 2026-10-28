// Phase 2: the Dropbox drop folder. Renders saved to Apps/Wrangler Review/<Project>/<Video>/ become new versions.
// Flow: Dropbox tells us something changed (webhook, plus a check every minute) → we list what changed → once a
// file has stopped changing and is complete, Bunny pulls it through a share link → the link is deleted as soon as
// Bunny has the file. Tokens stay in the backend; the Settings page only ever sees names, dates and statuses.
import { action, httpAction } from "./_generated/server";
import { forBusiness, internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMe } from "./lib/access";
import { bunnyCall, bunnyEnv } from "./bunny";
import { checkReviewExport, httpRangeReader, mp4HasIndex } from "./lib/mp4";
import { directLink, folderPlace, pickProject, placeFor, projectFolderOf, splitJob } from "./lib/dropboxPath";
import { highestVersion, insertVideo, parseRegisterName, shortTitleError, shortTitleFrom, videoByNumber } from "./lib/register";
import { signUrl } from "./lib/media";
import { NEW_VERSION_DELAY_MS } from "./emails";
import { SITE, SITE_SLASH } from "./lib/site";
import { businessFor, defaultBusiness } from "./lib/business";

const API = "https://api.dropboxapi.com/2";
const SETTLE_MS = 60_000; // a file must sit unchanged this long before we look at it
// R3: a register-named MP4 is looked at sooner. The import still checks every box in the file adds up to its size
// (an unfinished render never passes), so waiting the full minute only slowed review exports down.
const FAST_SETTLE_MS = 15_000;
const fastLane = (pathDisplay: string) => {
  const p = placeFor(pathDisplay);
  return p.ok && !!p.register && (p.ext === "mp4" || p.ext === "m4v");
};
const MAX_CHECKS = 180; // ~3 hours of "not finished yet" before giving up
const LINK_SWEEP_MS = 3 * 3600_000; // any share link still around after this gets deleted regardless
const RECENT_DROPS = 10; // Settings shows at most this many recent drops (Heston, Oct 22)

const site = () => SITE();
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
      .sort((a, b) => b.lastChangeAt - a.lastChangeAt).slice(0, RECENT_DROPS);
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

// R3: renders whose names need fixing (last 14 days), for the Register page.
export const flagged = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const since = Date.now() - 14 * 86400_000;
    const rows = (await ctx.db.query("dropFiles").withIndex("by_status", (q) => q.eq("status", "flagged")).collect())
      .filter((f) => f.lastChangeAt > since)
      .sort((a, b) => b.lastChangeAt - a.lastChangeAt)
      .map((f) => ({ _id: f._id, path: f.pathDisplay, reason: f.reason ?? null, at: f.lastChangeAt, folder: projectFolderOf(f.pathLower, f.pathDisplay)?.folder ?? null }));
    // C7: which flagged files sit in a folder the site knows as a project (so "Register & import" can be offered).
    const out = [];
    for (const r of rows) {
      const p = r.folder ? await ctx.db.query("projects").withIndex("by_dropbox_folder", (q) => q.eq("dropboxFolder", r.folder!)).first() : null;
      const base = (r.path.split("/").pop() ?? "").replace(/\.[A-Za-z0-9]{2,4}$/, "");
      // A title to suggest: the file name without a leading number, a trailing _vN, or underscores.
      const suggestedTitle = base.replace(/^\d{5}[_\s-]+/, "").replace(/[_\s-]+[vV]\d{1,4}$/, "").replace(/[_-]+/g, " ").trim();
      out.push({ _id: r._id, path: r.path, reason: r.reason, at: r.at, project: p ? { name: p.name, client: p.client ?? null } : null, suggestedTitle });
    }
    return out;
  },
});

// Try a flagged render again (after adding its number to the register, say), without saving it again.
export const retryFlagged = mutation({
  args: { fileId: v.id("dropFiles") },
  handler: async (ctx, { fileId }) => {
    await requireMe(ctx);
    const f = await ctx.db.get(fileId);
    if (!f || f.status !== "flagged") return false;
    await ctx.db.patch(fileId, { status: "waiting", reason: undefined, lastChangeAt: Date.now() - 10 * 60_000, checks: 0 });
    await ctx.scheduler.runAfter(0, internal.dropbox.importFile, { fileId });
    return true;
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
    if (!row) return false as const;
    await ctx.db.delete(row._id);
    if (Date.now() - row.createdAt >= 15 * 60_000) return false as const;
    // Phase 0.5d step 4: the connection belongs to the business of the owner who started it.
    const user = await ctx.db.get(row.userId as Id<"users">);
    const email = (user?.email ?? "").toLowerCase();
    return { businessId: email ? await businessFor(ctx, email, "owner") : (await defaultBusiness(ctx))?._id ?? null };
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
  const st = code && state ? await ctx.runMutation(internal.dropbox.takeState, { state }) : false;
  if (!code || !st) return back("dropbox=error&reason=expired");
  ctx = forBusiness(ctx, st.businessId);
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

// For backend-only Node actions that stream files (never returned to a client or logged).
export const freshToken = internalAction({ args: {}, handler: async (ctx): Promise<string> => accessToken(ctx) });

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
      if (latest && !baseline && (latest.status === "waiting" || (latest.status === "failed" && !latest.versionId) || latest.status === "skipped" || latest.status === "flagged")) {
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

// A file (or folder) was deleted or moved away: anything still waiting under that path won't be imported.
// Versions already made stay; the review site never deletes anything because of Dropbox.
export const recordRemoved = internalMutation({
  args: { pathsLower: v.array(v.string()) },
  handler: async (ctx, { pathsLower }) => {
    for (const status of ["waiting", "importing", "flagged"] as const) {
      for (const f of await ctx.db.query("dropFiles").withIndex("by_status", (q) => q.eq("status", status)).collect()) {
        if (pathsLower.some((p) => f.pathLower === p || f.pathLower.startsWith(p + "/"))) {
          await ctx.db.patch(f._id, { status: "skipped", reason: status === "flagged" ? "Renamed or removed in Dropbox." : "Removed from Dropbox before it was imported.", lastChangeAt: Date.now() });
        }
      }
    }
  },
});

export const dueFiles = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const waiting = await ctx.db.query("dropFiles").withIndex("by_status", (q) => q.eq("status", "waiting")).collect();
    const stuck = (await ctx.db.query("dropFiles").withIndex("by_status", (q) => q.eq("status", "importing")).collect())
      .filter((f) => now - f.lastChangeAt > 20 * 60_000); // an import that died mid-way gets another go
    return [...waiting.filter((f) => now - f.lastChangeAt >= (fastLane(f.pathDisplay) ? FAST_SETTLE_MS : SETTLE_MS)), ...stuck].slice(0, 5).map((f) => f._id);
  },
});

export const linksToSweep = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) =>
    (await ctx.db.query("dropFiles").withIndex("by_status", (q) => q.eq("status", "imported")).collect())
      .filter((f) => f.shareUrl && !f.linkRevokedAt && now - (f.importedAt ?? 0) > LINK_SWEEP_MS)
      .map((f) => f._id),
});

// C7 (Oct 24): folders make projects. Clients/<Client>/<Project>/ makes the client and the project; Projects/<Project>/
// makes a project with no client. A folder is remembered on what it made (dropboxFolder), so renaming the folder
// renames the project or client (a rename arrives as the old path deleted and the new one added, in one batch).
// Deleting a folder deletes nothing here: it just forgets the link. Returns how many things were made or renamed.
export const recordFolders = internalMutation({
  args: { folders: v.array(v.object({ pathLower: v.string(), pathDisplay: v.string() })), gone: v.array(v.string()) },
  handler: async (ctx, { folders, gone }) => {
    let changed = 0;
    const now = Date.now();
    const goneLeft = new Set(gone.map((g) => g.toLowerCase()));
    const sameLevel = (a: string, b: string) => a.split("/").length === b.split("/").length && a.slice(0, a.lastIndexOf("/")) === b.slice(0, b.lastIndexOf("/"));
    const norm = (x: string) => x.trim().toLowerCase();

    const ensureClient = async (name: string, folder: string) => {
      const byFolder = await ctx.db.query("clients").withIndex("by_dropbox_folder", (q) => q.eq("dropboxFolder", folder)).first();
      if (byFolder) {
        if (byFolder.name !== name) { await renameClient(byFolder.name, name, byFolder._id, folder, folder); changed++; }
        return name;
      }
      const all = await ctx.db.query("clients").collect();
      const byName = all.find((c) => norm(c.name) === norm(name));
      if (byName) { await ctx.db.patch(byName._id, { dropboxFolder: folder }); return byName.name; }
      // The old folder of a renamed client went away in the same batch.
      for (const g of goneLeft) {
        if (!sameLevel(g, folder)) continue;
        const old = all.find((c) => c.dropboxFolder === g);
        if (old) { goneLeft.delete(g); await renameClient(old.name, name, old._id, g, folder); changed++; return name; }
      }
      // Projects already filed under this client name (made on the site) count as the client existing.
      const projectsUnder = (await ctx.db.query("projects").collect()).some((p) => norm(p.client ?? "") === norm(name));
      await ctx.db.insert("clients", { name, createdAt: now, dropboxFolder: folder });
      if (!projectsUnder) changed++;
      return name;
    };
    // A client's projects follow it: their client name, and their folders (which moved with the client folder).
    const renameClient = async (from: string, to: string, clientId: Id<"clients">, oldFolder: string, newFolder: string) => {
      await ctx.db.patch(clientId, { name: to, dropboxFolder: newFolder });
      for (const p of await ctx.db.query("projects").collect()) {
        const patch: Record<string, unknown> = {};
        if (norm(p.client ?? "") === norm(from)) patch.client = to;
        if (p.dropboxFolder && oldFolder !== newFolder && p.dropboxFolder.startsWith(oldFolder + "/")) patch.dropboxFolder = newFolder + p.dropboxFolder.slice(oldFolder.length);
        if (Object.keys(patch).length) await ctx.db.patch(p._id, patch);
      }
    };

    const ensureProject = async (folderName: string, client: string | undefined, folder: string) => {
      const byFolder = await ctx.db.query("projects").withIndex("by_dropbox_folder", (q) => q.eq("dropboxFolder", folder)).first();
      const split = splitJob(folderName);
      if (byFolder) {
        const patch: Record<string, unknown> = {};
        if (byFolder.name !== split.name) patch.name = split.name;
        if (split.jobNumber && byFolder.jobNumber !== split.jobNumber) patch.jobNumber = split.jobNumber;
        if (client && norm(byFolder.client ?? "") !== norm(client)) patch.client = client;
        if (Object.keys(patch).length) { await ctx.db.patch(byFolder._id, patch); changed++; }
        return;
      }
      const all = await ctx.db.query("projects").collect();
      const picked = pickProject(all.filter((p) => !p.dropboxFolder), folderName, client);
      if (picked) {
        await ctx.db.patch(picked.project._id, { dropboxFolder: folder, ...(picked.setClient && client ? { client } : {}) });
        return;
      }
      for (const g of goneLeft) {
        if (!sameLevel(g, folder)) continue;
        const old = all.find((p) => p.dropboxFolder === g);
        if (old) {
          goneLeft.delete(g);
          // A job number the old folder name carried goes with it; one set on the site stays.
          const oldJob = splitJob(g.split("/").pop() ?? "").jobNumber;
          const jobNumber = split.jobNumber ?? (oldJob && old.jobNumber === oldJob ? undefined : old.jobNumber);
          await ctx.db.patch(old._id, { name: split.name, dropboxFolder: folder, jobNumber, ...(client ? { client } : {}) });
          changed++;
          return;
        }
      }
      await ctx.db.insert("projects", { name: split.name, ...(split.jobNumber ? { jobNumber: split.jobNumber } : {}), ...(client ? { client } : {}), createdAt: now, dropboxFolder: folder });
      changed++;
    };

    // Shallow first, so a client folder exists before the project folders inside it.
    const sorted = [...folders].sort((a, b) => a.pathLower.split("/").length - b.pathLower.split("/").length);
    for (const f of sorted) {
      const place = folderPlace(f.pathLower, f.pathDisplay);
      if (!place) continue;
      if (place.kind === "client") { await ensureClient(place.client, place.folder); continue; }
      const client = place.client && place.clientFolder ? await ensureClient(place.client, place.clientFolder) : undefined;
      await ensureProject(place.project, client, place.folder);
    }
    // Folders that went away without coming back under a new name: forget the link, keep everything else.
    for (const g of goneLeft) {
      for (const p of await ctx.db.query("projects").withIndex("by_dropbox_folder", (q) => q.eq("dropboxFolder", g)).collect()) await ctx.db.patch(p._id, { dropboxFolder: undefined });
      for (const c of await ctx.db.query("clients").withIndex("by_dropbox_folder", (q) => q.eq("dropboxFolder", g)).collect()) await ctx.db.patch(c._id, { dropboxFolder: undefined });
    }
    return changed;
  },
});

// Runs every minute (crons.ts) and whenever Dropbox's webhook fires.
// Phase 0.5d step 4: with no business given (the cron, the webhook), sync every business that has Dropbox connected,
// each acting only for itself. With one (Sync now), just that business.
export const connectedBusinesses = internalQuery({
  args: {},
  handler: async (ctx) => {
    const def = (await defaultBusiness(ctx))?._id ?? null;
    return [...new Set((await ctx.db.query("dropbox").collect()).map((d) => d.businessId ?? def).filter((b): b is Id<"businesses"> => !!b))];
  },
});

export const sync = internalAction({
  args: {},
  handler: async (ctx): Promise<{ connected: boolean; changes?: number; due?: number; error?: string; businesses?: number }> => {
    if (!ctx.asBusiness) {
      const bizs: Id<"businesses">[] = await ctx.runQuery(internal.dropbox.connectedBusinesses, {});
      let changes = 0;
      for (const b of bizs) { const r: { changes?: number } = await ctx.runAction(internal.dropbox.sync, { asBusiness: b }); changes += r.changes ?? 0; }
      return { connected: bizs.length > 0, changes, businesses: bizs.length };
    }
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
        const gone = (r.entries ?? []).filter((e: any) => e[".tag"] === "deleted").map((e: any) => e.path_lower as string);
        if (gone.length) await ctx.runMutation(internal.dropbox.recordRemoved, { pathsLower: gone });
        // C7: folders under Clients/ and Projects/ make (or rename) clients and projects.
        const folders = (r.entries ?? []).filter((e: any) => e[".tag"] === "folder").map((e: any) => ({ pathLower: e.path_lower as string, pathDisplay: e.path_display as string }));
        if (folders.length || gone.length) changes += await ctx.runMutation(internal.dropbox.recordFolders, { folders, gone });
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
    // Something new came in: look again just after the short wait, rather than at the next minute's check.
    if (changes > 0) await ctx.scheduler.runAfter(FAST_SETTLE_MS + 2000, internal.dropbox.sync, {});
    for (const fileId of await ctx.runQuery(internal.dropbox.linksToSweep, { now: Date.now() })) {
      await ctx.scheduler.runAfter(0, internal.dropbox.revokeLink, { fileId });
    }
    return { connected: true, changes, due: due.length };
  },
});

export const syncNow = action({
  args: {},
  handler: async (ctx) => {
    const me: { businessId: Id<"businesses"> | null } = await ctx.runQuery(internal.users.assertAllowed, {});
    await ctx.scheduler.runAfter(0, internal.dropbox.sync, me.businessId ? { asBusiness: me.businessId } : {});
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
  args: { client: v.optional(v.string()), project: v.string(), video: v.string(), fileName: v.optional(v.string()) },
  handler: async (ctx, a) => {
    // A file named for the register (00001_LCArizona_v4.mp4) goes to that video, whatever folder it's in.
    const reg = a.fileName ? parseRegisterName(a.fileName) : null;
    const numbered = reg ? await videoByNumber(ctx, reg.number) : null;
    if (numbered) return { projectId: numbered.projectId, videoId: numbered._id };
    const now = Date.now();
    const projects = await ctx.db.query("projects").collect();
    const picked = pickProject(projects, a.project, a.client);
    let project = picked?.project;
    if (picked?.setClient && a.client) await ctx.db.patch(picked.project._id, { client: a.client.trim() });
    if (!project) {
      const { jobNumber, name } = splitJob(a.project);
      const id = await ctx.db.insert("projects", { name, ...(jobNumber ? { jobNumber } : {}), ...(a.client ? { client: a.client.trim() } : {}), createdAt: now });
      project = (await ctx.db.get(id))!;
    }
    const videos = await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", project!._id)).collect();
    const t = a.video.trim().toLowerCase();
    let video = videos.find((x) => x.title.trim().toLowerCase() === t);
    if (!video) {
      const { videoId } = await insertVideo(ctx, { projectId: project._id, title: a.video.trim() });
      video = (await ctx.db.get(videoId))!;
    }
    return { projectId: project._id, videoId: video._id };
  },
});

export const addVersion = internalMutation({
  args: { fileId: v.id("dropFiles"), videoId: v.id("videos"), bunnyGuid: v.string(), fileName: v.string(), fileSize: v.number(), dropboxPath: v.string(), shareUrl: v.optional(v.string()), number: v.optional(v.number()), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", a.videoId)).collect();
    const number = a.number && !existing.some((x) => x.number === a.number) ? a.number : existing.reduce((m, x) => Math.max(m, x.number), 0) + 1;
    const now = Date.now();
    const versionId = await ctx.db.insert("versions", {
      videoId: a.videoId, number, status: "processing", pollCount: 0, bunnyGuid: a.bunnyGuid, fileName: a.fileName.slice(0, 300),
      fileSize: a.fileSize, startTimecode: "01:00:00:00", uploaderName: "Dropbox", dropboxPath: a.dropboxPath, createdAt: now,
    });
    await ctx.db.patch(a.videoId, { updatedAt: now, final: undefined }); // a new version reopens an approved video
    await ctx.db.patch(a.fileId, { status: "imported", versionId, shareUrl: a.shareUrl, importedAt: now, lastChangeAt: now, reason: a.note });
    return { versionId, number };
  },
});

// ---------- Render-to-review (R3, Oct 22) ----------

// What a register name points at: the video for its number, and whether its version number is free.
export const registerTarget = internalQuery({
  args: { number: v.number(), version: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const vid = await videoByNumber(ctx, a.number);
    if (!vid) return { found: false as const };
    const versions = await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect();
    const top = versions.reduce((m, x) => Math.max(m, x.number), 0);
    const taken = a.version !== undefined && versions.some((x) => x.number === a.version);
    return { found: true as const, videoId: vid._id, projectId: vid.projectId, shortTitle: vid.shortTitle ?? "", next: top + 1, taken };
  },
});

// C7: when a register-named file sits in a project folder that isn't the video's project, a note for the drop list.
export const folderNote = internalQuery({
  args: { pathLower: v.string(), pathDisplay: v.string(), projectId: v.id("projects") },
  handler: async (ctx, a) => {
    const pf = projectFolderOf(a.pathLower, a.pathDisplay);
    if (!pf) return null;
    const folderProject = await ctx.db.query("projects").withIndex("by_dropbox_folder", (q) => q.eq("dropboxFolder", pf.folder)).first();
    if (!folderProject || folderProject._id === a.projectId) return null;
    const own = await ctx.db.get(a.projectId);
    return `Saved under ${pf.client ? `${pf.client} › ` : ""}${pf.project}, but video is in ${own?.client ? `${own.client} › ` : ""}${own?.name ?? "another project"} (the number wins).`;
  },
});

// C7: "Register & import" on a flagged render that sits in a project folder: registers a new video in that project
// (title and short title from the file name unless given), and imports the file as its v1 under the register name.
// The file in Dropbox keeps its own name; only the site's copy is named by the register.
export const registerFlagged = mutation({
  args: { fileId: v.id("dropFiles"), title: v.optional(v.string()), shortTitle: v.optional(v.string()), videoId: v.optional(v.id("videos")) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const f = await ctx.db.get(a.fileId);
    if (!f || f.status !== "flagged") throw new ConvexError("That file isn't waiting to be registered.");
    const ext = f.pathDisplay.split(".").pop();
    // The next version of a video that's already in the register (a plain-named render of an existing cut).
    if (a.videoId) {
      const vid = await ctx.db.get(a.videoId);
      if (!vid?.number || !vid.shortTitle) throw new ConvexError("That video isn't in the register yet.");
      const version = (await highestVersion(ctx, vid._id)) + 1;
      await ctx.db.patch(f._id, { status: "waiting", reason: undefined, registerAs: { number: vid.number, shortTitle: vid.shortTitle, version }, lastChangeAt: Date.now() - 10 * 60_000, checks: 0 });
      await ctx.scheduler.runAfter(0, internal.dropbox.importFile, { fileId: f._id });
      const p = await ctx.db.get(vid.projectId);
      return { videoId: vid._id, number: String(vid.number).padStart(5, "0"), fileName: `${String(vid.number).padStart(5, "0")}_${vid.shortTitle}_v${version}.${ext}`, project: p?.name ?? "", client: p?.client ?? null };
    }
    const pf = projectFolderOf(f.pathLower, f.pathDisplay);
    if (!pf) throw new ConvexError("Move it into a project folder first (Clients/<Client>/<Project>/ or Projects/<Project>/).");
    const project = await ctx.db.query("projects").withIndex("by_dropbox_folder", (q) => q.eq("dropboxFolder", pf.folder)).first();
    if (!project) throw new ConvexError("That folder hasn't been picked up as a project yet. Give it a minute, then try again.");
    const base = (f.pathDisplay.split("/").pop() ?? "video").replace(/\.[A-Za-z0-9]{2,4}$/, "");
    const title = (a.title ?? "").trim().slice(0, 160) || base.replace(/[_-]+/g, " ").trim() || "Video";
    const shortTitle = (a.shortTitle ?? "").trim() || shortTitleFrom(title);
    const bad = shortTitleError(shortTitle);
    if (bad) throw new ConvexError(bad);
    const made = await insertVideo(ctx, { projectId: project._id, title, shortTitle });
    await ctx.db.patch(f._id, { status: "waiting", reason: undefined, registerAs: { number: made.number, shortTitle, version: 1 }, lastChangeAt: Date.now() - 10 * 60_000, checks: 0 });
    await ctx.scheduler.runAfter(0, internal.dropbox.importFile, { fileId: f._id });
    return { videoId: made.videoId, number: String(made.number).padStart(5, "0"), fileName: `${made.fileName}.${ext}`, project: project.name, client: project.client ?? null };
  },
});

export const flagFile = internalMutation({
  args: { fileId: v.id("dropFiles"), reason: v.string() },
  handler: async (ctx, { fileId, reason }) => {
    await ctx.db.patch(fileId, { status: "flagged", reason, lastChangeAt: Date.now() });
  },
});

// A review export: the version starts as "processing" while the render is copied into Bunny Storage.
export const addFileVersion = internalMutation({
  args: {
    fileId: v.id("dropFiles"), videoId: v.id("videos"), number: v.optional(v.number()), fileName: v.string(), fileSize: v.number(), dropboxPath: v.string(),
    frames: v.number(), fpsNum: v.number(), fpsDen: v.number(), width: v.number(), height: v.number(), seconds: v.number(), note: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", a.videoId)).collect();
    const number = a.number && !existing.some((x) => x.number === a.number) ? a.number : existing.reduce((m, x) => Math.max(m, x.number), 0) + 1;
    const now = Date.now();
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => b.toString(16).padStart(2, "0")).join("");
    const safe = a.fileName.replace(/[^\w.-]+/g, "_").replace(/\.{2,}/g, "_").slice(0, 120);
    const storagePath = `review/${a.videoId}/${rand}/${safe}`;
    const versionId = await ctx.db.insert("versions", {
      videoId: a.videoId, number, status: "processing", source: "file", bunnyGuid: "", storagePath, fileName: a.fileName.slice(0, 300), fileSize: a.fileSize,
      fpsNum: a.fpsNum, fpsDen: a.fpsDen, frameCount: a.frames, frameCountFrom: "file", width: a.width, height: a.height, lengthSeconds: a.seconds,
      mp4Heights: [], startTimecode: "01:00:00:00", uploaderName: "Dropbox", dropboxPath: a.dropboxPath, createdAt: now, encodeProgress: 0,
    });
    await ctx.db.patch(a.videoId, { updatedAt: now, final: undefined });
    await ctx.db.patch(a.fileId, { status: "imported", versionId, importedAt: now, lastChangeAt: now, reason: a.note });
    return { versionId, number, storagePath };
  },
});

// The copy finished: the version plays now. Transcript, waveform, Slack and the scrub copy follow.
export const fileReady = internalMutation({
  args: { versionId: v.id("versions"), fileUrl: v.string(), bytes: v.number(), copyMs: v.number() },
  handler: async (ctx, a) => {
    const ver = await ctx.db.get(a.versionId);
    if (!ver || (ver.status === "ready" && ver.fileUrl)) return; // already done (a second copy run finds it ready)
    const now = Date.now();
    await ctx.db.patch(a.versionId, { status: "ready", readyAt: now, fileUrl: a.fileUrl, storageBytes: a.bytes, storageCheckedAt: now, encodeProgress: 100, copyError: undefined, copyMs: a.copyMs });
    await ctx.db.patch(ver.videoId, { updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.slack.versionReady, { versionId: a.versionId });
    await ctx.scheduler.runAfter(NEW_VERSION_DELAY_MS, internal.emails.newVersion, { versionId: a.versionId }); // C4
    if (process.env.ELEVENLABS_API_KEY) await ctx.runMutation(internal.transcripts.markPending, { versionId: a.versionId });
    await ctx.scheduler.runAfter(0, internal.transcribe.run, { versionId: a.versionId, attempt: 0 });
    await ctx.runMutation(internal.waveforms.markPending, { versionId: a.versionId });
    await ctx.scheduler.runAfter(2000, internal.waveform.run, { versionId: a.versionId, attempt: 0 });
    await ctx.scheduler.runAfter(0, internal.reviewFiles.startScrub, { versionId: a.versionId });
  },
});

export const fileVersionsWithoutScrub = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("versions").collect())
    .filter((x) => x.source === "file" && x.status === "ready" && x.fileUrl && (!x.scrubGuid || x.scrubStatus === "failed"))
    .map((x) => x._id as string),
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
      // R3: the name decides the video. Anything that doesn't match is flagged, never guessed.
      // C7: "Register & import" on a flagged file gives it a register name on the site without renaming the file.
      const reg = f.registerAs ?? place.register;
      const fileName = f.registerAs ? `${String(f.registerAs.number).padStart(5, "0")}_${f.registerAs.shortTitle}_v${f.registerAs.version}.${place.ext}` : place.fileName;
      if (!reg) {
        await ctx.runMutation(internal.dropbox.flagFile, { fileId, reason: "Not a register name. Press Register & import to make it a new video in its folder's project, or name it like 00002_Title_v1 (Register › New video gives the name) and save it again." });
        return { result: "flagged: not a register name" };
      }
      const num = String(reg.number).padStart(5, "0");
      const hit = await ctx.runQuery(internal.dropbox.registerTarget, { number: reg.number, version: reg.version ?? undefined });
      if (!hit.found) {
        await ctx.runMutation(internal.dropbox.flagFile, { fileId, reason: `There's no video ${num} in the register. Add it with Register › New video, then save the render again with the name it gives.` });
        return { result: "flagged: unknown number" };
      }
      if (hit.taken) {
        await ctx.runMutation(internal.dropbox.flagFile, { fileId, reason: `v${reg.version} of ${num} is already on the site. Rename it ${num}_${hit.shortTitle || reg.shortTitle}_v${hit.next}.${place.ext} and save it again.` });
        return { result: "flagged: version taken" };
      }
      let tempLink: string | null = null;
      if (place.checkIndex) {
        const t = await dbx(ctx, "/files/get_temporary_link", { path: f.pathLower });
        tempLink = t.link as string;
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
      const target = { videoId: hit.videoId };
      // C7: the number wins over the folder; say so when they disagree, so a misfiled render is easy to spot.
      const folderNote: string | null = await ctx.runQuery(internal.dropbox.folderNote, { pathLower: f.pathLower, pathDisplay: f.pathDisplay, projectId: hit.projectId });
      // A review export (H.264 + AAC MP4, index at the front) is stored and played as it is.
      let why = "";
      if (tempLink && (place.ext === "mp4" || place.ext === "m4v")) {
        const chk = await checkReviewExport(httpRangeReader(tempLink), meta.size);
        if (chk.ok) {
          const r = await ctx.runMutation(internal.dropbox.addFileVersion, {
            fileId, videoId: target.videoId, number: reg.version ?? undefined, fileName, fileSize: meta.size, dropboxPath: f.pathDisplay,
            frames: chk.frames, fpsNum: chk.fpsNum, fpsDen: chk.fpsDen, width: chk.width, height: chk.height, seconds: chk.seconds, note: folderNote ?? undefined,
          });
          await ctx.scheduler.runAfter(0, internal.reviewFiles.copy, { versionId: r.versionId, dropboxPath: f.pathLower, size: meta.size, attempt: 0 });
          return { result: "copying a review export" };
        }
        why = chk.reason;
      } else {
        why = `.${place.ext} file`;
      }
      // Anything else goes to Bunny Stream to be converted, as before.
      link = await shareLink(ctx, f.pathLower);
      const { lib } = bunnyEnv();
      const tag = `wr-import-${fileId}`;
      const fetched = (await bunnyCall(`/library/${lib}/videos/fetch`, { method: "POST", body: JSON.stringify({ url: link.shared ? directLink(link.url) : link.url, title: tag }) })) as { id?: string };
      // Bunny returns the new video's id (seen live, Oct 21), though its docs don't promise it: if it's missing,
      // find the video by its one-off title. Then give it the file's name.
      let guid: string | null = typeof fetched?.id === "string" && fetched.id ? fetched.id : null;
      for (let i = 0; i < 20 && !guid; i++) {
        await new Promise((r) => setTimeout(r, i === 0 ? 1500 : 3000));
        const found = (await bunnyCall(`/library/${lib}/videos?page=1&itemsPerPage=10&search=${encodeURIComponent(tag)}`)) as { items?: Array<{ guid: string; title: string }> };
        guid = found.items?.find((x) => x.title === tag)?.guid ?? null;
      }
      if (!guid) throw new Error("Bunny didn't start the import.");
      await bunnyCall(`/library/${lib}/videos/${guid}`, { method: "POST", body: JSON.stringify({ title: fileName }) }).catch(() => null);
      const { versionId } = await ctx.runMutation(internal.dropbox.addVersion, {
        fileId, videoId: target.videoId, bunnyGuid: guid, fileName, fileSize: f.size, dropboxPath: f.pathDisplay,
        shareUrl: link.shared ? link.url : undefined, number: reg.version ?? undefined, note: `Converted by Bunny (not a review export: ${why})${folderNote ? ` · ${folderNote}` : ""}`,
      });
      await ctx.scheduler.runAfter(5000, internal.uploads.poll, { versionId });
      return { result: "imported" };
    } catch (e) {
      if (link?.shared) await revokeUrl(ctx, link.url).catch(() => null);
      if (e instanceof DropboxError && e.status === 409 && /not_found/.test(e.summary)) {
        await ctx.runMutation(internal.dropbox.patchFile, { fileId, patch: { status: "skipped", reason: "Removed from Dropbox before it was imported." } });
        return { result: "removed before import" };
      }
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
    const site = SITE_SLASH();
    const url = await signUrl(`https://${process.env.BUNNY_STREAM_CDN || "vz-3ba0610b-f90.b-cdn.net"}/${src.guid}/play_${src.height}p.mp4`);
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

// For the CI check (public logs): what the drop folder has seen, without names or paths.
export const debugSummary = internalQuery({
  args: {},
  handler: async (ctx) => {
    const conn = await ctx.db.query("dropbox").first();
    const now = Date.now();
    const files = (await ctx.db.query("dropFiles").collect()).map((f) => ({
      depth: f.pathDisplay.split("/").filter(Boolean).length,
      ext: (f.pathDisplay.split(".").pop() ?? "").toLowerCase(),
      sizeMB: Math.round(f.size / 1e5) / 10,
      status: f.status, checks: f.checks, reason: f.reason ?? null,
      seenMinAgo: Math.round((now - f.firstSeenAt) / 60000), changedMinAgo: Math.round((now - f.lastChangeAt) / 60000),
      hasVersion: Boolean(f.versionId), linkOpen: Boolean(f.shareUrl && !f.linkRevokedAt),
    }));
    return {
      connected: Boolean(conn), connectedMinAgo: conn ? Math.round((now - conn.connectedAt) / 60000) : null,
      lastSyncSecAgo: conn?.lastSyncAt ? Math.round((now - conn.lastSyncAt) / 1000) : null, lastError: conn?.lastError ?? null,
      hasCursor: Boolean(conn?.cursor), files,
    };
  },
});

// For the CI check: list the drop folder's top two levels as Dropbox sees it (depth and counts only, no names).
export const folderShape = internalAction({
  args: {},
  handler: async (ctx) => {
    const conn = await ctx.runQuery(internal.dropbox.getConnection, {});
    if (!conn) return { connected: false };
    let r = await dbx(ctx, "/files/list_folder", { path: "", recursive: true, include_deleted: false });
    const entries: Array<{ tag: string; depth: number; ext: string | null; sizeMB: number | null }> = [];
    for (;;) {
      for (const e of r.entries ?? []) entries.push({ tag: e[".tag"], depth: (e.path_display as string).split("/").filter(Boolean).length, ext: e[".tag"] === "file" ? (e.name.split(".").pop() ?? "").toLowerCase() : null, sizeMB: e.size ? Math.round(e.size / 1e5) / 10 : null });
      if (!r.has_more) break;
      r = await dbx(ctx, "/files/list_folder/continue", { cursor: r.cursor });
    }
    const acct = await dbx(ctx, "/users/get_current_account", null).catch(() => null);
    return { connected: true, accountType: acct?.account_type?.[".tag"] ?? null, team: Boolean(acct?.team), rootIsTeamSpace: acct?.root_info?.[".tag"] ?? null, entries };
  },
});

// For the CI check: drop rows and Dropbox-made versions with ids and times only (no names), to trace an import.
export const debugTrace = internalQuery({
  args: {},
  handler: async (ctx) => {
    const t = (x?: number) => (x ? new Date(x).toISOString().slice(11, 19) : null);
    const files = (await ctx.db.query("dropFiles").collect()).map((f) => ({
      id: f._id.slice(-6), status: f.status, rev: f.rev, created: t(f._creationTime), firstSeen: t(f.firstSeenAt), lastChange: t(f.lastChangeAt), imported: t(f.importedAt), version: f.versionId?.slice(-6) ?? null, sizeMB: Math.round(f.size / 1e5) / 10,
    }));
    const versions = (await ctx.db.query("versions").collect()).filter((x) => x.dropboxPath).map((x) => ({
      id: x._id.slice(-6), number: x.number, video: x.videoId.slice(-6), guid: x.bunnyGuid.slice(0, 8), created: t(x.createdAt), status: x.status,
    }));
    const scheduled = (await ctx.db.system.query("_scheduled_functions").order("desc").take(60))
      .filter((s) => s.name.includes("importFile") || s.name.includes("dropbox:sync"))
      .map((s) => ({ name: s.name, at: t(s.scheduledTime), state: s.state.kind, args: s.name.includes("importFile") ? String((s.args[0] as { fileId?: string })?.fileId ?? "").slice(-6) : null }));
    return { files, versions, scheduled };
  },
});

// Oct 28 (Phase 0.5d step 4): run the minute job once, by hand, and report only whether it ran (counts, no names).
export const syncSelfTest = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; connected: boolean; businesses?: number; changes?: number; error?: string }> => {
    const r: { connected: boolean; businesses?: number; changes?: number; error?: string } = await ctx.runAction(internal.dropbox.sync, {});
    return { ok: r.connected && !r.error, connected: r.connected, businesses: r.businesses, changes: r.changes, error: r.error ? "failed" : undefined };
  },
});
