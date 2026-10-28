// Wrangler Sign — the archive copy in Dropbox (Phase S3, Oct 27).
// Its own Dropbox app, "Wrangler Sign", with App folder access: it can only see Dropbox › Apps/Wrangler Sign/, and
// Wrangler Review's app can't see it. Every completed document lands there as
//   <year>/WS-00002 Title (signed).pdf   and   <year>/WS-00002 Title (audit).json
// Each upload is read back and hashed, so "archived" means the copy in Dropbox matches the signed copy byte for byte.
import { action, httpAction, type ActionCtx } from "./_generated/server";
import { forBusiness, internalAction, internalMutation, internalQuery, query } from "./lib/functions";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMe } from "./lib/access";
import { appendEvent } from "./lib/wsAudit";
import { sha256Bytes } from "./lib/wsPdf";
import { randomToken } from "./lib/hash";
import { SITE } from "./lib/email";
import { auditJson } from "./signDone";

const API = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";
const redirectUri = () => `${(process.env.CONVEX_SITE_URL || "").replace(/\/$/, "")}/ws-dropbox/callback`;
const configured = () => Boolean(process.env.WS_DROPBOX_APP_KEY && process.env.WS_DROPBOX_APP_SECRET);
function creds() {
  const key = process.env.WS_DROPBOX_APP_KEY, secret = process.env.WS_DROPBOX_APP_SECRET;
  if (!key || !secret) throw new ConvexError("The archive isn't set up yet: WS_DROPBOX_APP_KEY and WS_DROPBOX_APP_SECRET are missing in Convex.");
  return { key, secret };
}
const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^.*ConvexError: /, "").split("\n")[0].slice(0, 300);

// ---------- status and connecting ----------

export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const c = await ctx.db.query("wsDropbox").first();
    return { configured: configured(), connected: !!c, email: c?.email ?? null, name: c?.name ?? null, connectedAt: c?.connectedAt ?? null, lastError: c?.lastError ?? null };
  },
});

export const authUrl = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const me: { userId: string } = await ctx.runQuery(internal.users.assertAllowed, {});
    const { key } = creds();
    const state = randomToken(24);
    await ctx.runMutation(internal.dropbox.insertState, { state, userId: me.userId });
    const q = new URLSearchParams({ client_id: key, response_type: "code", token_access_type: "offline", redirect_uri: redirectUri(), state });
    return `https://www.dropbox.com/oauth2/authorize?${q}`;
  },
});

async function tokenRequest(params: Record<string, string>) {
  const { key, secret } = creds();
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${btoa(`${key}:${secret}`)}` },
    body: new URLSearchParams(params),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; account_id?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`Dropbox sign-in failed: ${body.error_description || body.error || res.status}`);
  return body;
}

export const callback = httpAction(async (ctx, req) => {
  const u = new URL(req.url);
  const back = (q: string) => new Response(null, { status: 302, headers: { location: `${SITE()}/sign?${q}` } });
  if (u.searchParams.get("error")) return back(`archive=error&reason=${encodeURIComponent(u.searchParams.get("error_description") || u.searchParams.get("error") || "declined")}`);
  const code = u.searchParams.get("code"), state = u.searchParams.get("state");
  const st = code && state ? await ctx.runMutation(internal.dropbox.takeState, { state }) : false;
  if (!code || !st) return back("archive=error&reason=expired");
  ctx = forBusiness(ctx, st.businessId);
  try {
    const tok = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
    if (!tok.refresh_token) throw new Error("Dropbox didn't send a refresh token");
    const acct = await fetch(`${API}/users/get_current_account`, { method: "POST", headers: { authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json()).catch(() => ({})) as { email?: string; name?: { display_name?: string }; account_id?: string };
    await ctx.runMutation(internal.wsArchive.saveConnection, {
      accountId: tok.account_id ?? acct.account_id ?? "unknown", email: acct.email, name: acct.name?.display_name, refreshToken: tok.refresh_token,
      accessToken: tok.access_token!, accessExpiresAt: Date.now() + (tok.expires_in ?? 14400) * 1000,
    });
    await ctx.scheduler.runAfter(0, internal.wsArchive.archivePending, {});
    return back("archive=connected");
  } catch (e) {
    return back(`archive=error&reason=${encodeURIComponent(errText(e))}`);
  }
});

export const saveConnection = internalMutation({
  args: { accountId: v.string(), email: v.optional(v.string()), name: v.optional(v.string()), refreshToken: v.string(), accessToken: v.string(), accessExpiresAt: v.number() },
  handler: async (ctx, a) => {
    for (const old of await ctx.db.query("wsDropbox").collect()) await ctx.db.delete(old._id);
    await ctx.db.insert("wsDropbox", { ...a, connectedAt: Date.now() });
  },
});

export const getConnection = internalQuery({ args: {}, handler: async (ctx) => ctx.db.query("wsDropbox").first() });

export const patchConnection = internalMutation({
  args: { accessToken: v.optional(v.string()), accessExpiresAt: v.optional(v.number()), lastError: v.optional(v.string()), clearError: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const row = await ctx.db.query("wsDropbox").first();
    if (!row) return;
    await ctx.db.patch(row._id, {
      ...(a.accessToken ? { accessToken: a.accessToken, accessExpiresAt: a.accessExpiresAt } : {}),
      ...(a.lastError ? { lastError: a.lastError } : {}), ...(a.clearError ? { lastError: undefined } : {}),
    });
  },
});

export const disconnect = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    try { await call(ctx, "/auth/token/revoke", null); } catch { /* already gone */ }
    await ctx.runMutation(internal.wsArchive.removeConnection, {});
  },
});

export const removeConnection = internalMutation({ args: {}, handler: async (ctx) => { for (const r of await ctx.db.query("wsDropbox").collect()) await ctx.db.delete(r._id); } });

// ---------- calling Dropbox ----------

async function token(ctx: ActionCtx, force = false): Promise<string> {
  const c: Doc<"wsDropbox"> | null = await ctx.runQuery(internal.wsArchive.getConnection, {});
  if (!c) throw new Error("The archive's Dropbox isn't connected.");
  if (!force && c.accessToken && (c.accessExpiresAt ?? 0) > Date.now() + 120_000) return c.accessToken;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: c.refreshToken });
  await ctx.runMutation(internal.wsArchive.patchConnection, { accessToken: t.access_token, accessExpiresAt: Date.now() + (t.expires_in ?? 14400) * 1000 });
  return t.access_token!;
}

async function call(ctx: ActionCtx, path: string, body: unknown) {
  const go = async (tk: string) => fetch(API + path, { method: "POST", headers: { authorization: `Bearer ${tk}`, ...(body === null ? {} : { "content-type": "application/json" }) }, body: body === null ? undefined : JSON.stringify(body) });
  let r = await go(await token(ctx));
  if (r.status === 401) r = await go(await token(ctx, true));
  const text = await r.text();
  if (!r.ok) throw new Error(`Dropbox ${r.status}: ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

// Dropbox-API-Arg must be ASCII: anything else is written as \uXXXX.
const apiArg = (o: unknown) => JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

async function upload(ctx: ActionCtx, path: string, bytes: Uint8Array): Promise<string> {
  const go = async (tk: string) => fetch(`${CONTENT}/files/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${tk}`, "content-type": "application/octet-stream", "Dropbox-API-Arg": apiArg({ path, mode: "add", autorename: true, mute: true, strict_conflict: false }) },
    body: new Uint8Array(bytes),
  });
  let r = await go(await token(ctx));
  if (r.status === 401) r = await go(await token(ctx, true));
  const j = (await r.json().catch(() => ({}))) as { path_display?: string; error_summary?: string };
  if (!r.ok || !j.path_display) throw new Error(`Dropbox upload ${r.status}: ${j.error_summary ?? ""}`.trim());
  return j.path_display;
}

async function download(ctx: ActionCtx, path: string): Promise<Uint8Array> {
  const r = await fetch(`${CONTENT}/files/download`, { method: "POST", headers: { authorization: `Bearer ${await token(ctx)}`, "Dropbox-API-Arg": apiArg({ path }) } });
  if (!r.ok) throw new Error(`Dropbox download ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// ---------- archiving ----------

export const archiveDocument = internalAction({
  args: { documentId: v.id("wsDocuments") },
  handler: async (ctx, { documentId }) => {
    const d = await ctx.runQuery(internal.signDone.finalData, { documentId });
    if (!d || !d.doc.final) throw new Error("There's no signed copy yet.");
    if (d.doc.archive?.status === "archived") return null;
    if (!configured() || !(await ctx.runQuery(internal.wsArchive.getConnection, {}))) {
      await ctx.runMutation(internal.wsArchive.recordArchive, { documentId, status: "waiting" });
      return null;
    }
    const pdf = await (await ctx.storage.get(d.doc.final.fileId))!.arrayBuffer().then((b) => new Uint8Array(b));
    const audit = await auditJson(ctx, documentId);
    const folder = `/${audit.year}`;
    const pdfPath = await upload(ctx, `${folder}/${d.doc.final.fileName}`, pdf);
    const auditPath = await upload(ctx, `${folder}/${audit.name}`, new TextEncoder().encode(audit.json));
    // Read the PDF back: archived means Dropbox holds exactly the signed copy.
    const back = await download(ctx, pdfPath);
    const verified = (await sha256Bytes(back)) === d.doc.final.sha256;
    if (!verified) throw new Error(`The copy in Dropbox (${pdfPath}) doesn't match the signed copy's hash.`);
    await ctx.runMutation(internal.wsArchive.recordArchive, { documentId, status: "archived", pdfPath, auditPath, verified, sha256: d.doc.final.sha256 });
    await ctx.runMutation(internal.wsArchive.patchConnection, { clearError: true });
    return null;
  },
});

export const recordArchive = internalMutation({
  args: { documentId: v.id("wsDocuments"), status: v.union(v.literal("archived"), v.literal("waiting")), pdfPath: v.optional(v.string()), auditPath: v.optional(v.string()), verified: v.optional(v.boolean()), sha256: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const doc = (await ctx.db.get(a.documentId))!;
    if (doc.archive?.status === "archived") return null;
    await ctx.db.patch(a.documentId, { archive: { status: a.status, at: Date.now(), ...(a.pdfPath ? { pdfPath: a.pdfPath, auditPath: a.auditPath, verified: a.verified } : {}) } });
    if (a.status === "archived") await appendEvent(ctx, a.documentId, { kind: "archived", actor: "system", versionNumber: doc.sentVersion, detail: `Archived to Dropbox › Apps/Wrangler Sign${a.pdfPath} and${a.auditPath ? ` Apps/Wrangler Sign${a.auditPath}` : " the audit record"}. Read back and checked: SHA-256 ${a.sha256} matches.` });
    return null;
  },
});

// After connecting (and if anything was waiting or failed): archive every completed document not archived yet.
export const pendingIds = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("wsDocuments").collect()).filter((d) => d.status === "completed" && d.final && d.archive?.status !== "archived").map((d) => d._id),
});

export const archivePending = internalAction({
  args: {},
  handler: async (ctx) => {
    const ids: Id<"wsDocuments">[] = await ctx.runQuery(internal.wsArchive.pendingIds, {});
    for (const documentId of ids) await ctx.runAction(internal.signDone.finish, { documentId, steps: ["archive"] });
    return { tried: ids.length };
  },
});
