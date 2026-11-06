// Phase 5e step 6 (Nov 6): Settings › Your data (Design Log › Phase 5e: 820:16562 default, 820:17090 being made,
// 820:17596 ready, 820:18136 failed, 820:18677 deletion scheduled, 820:19218 loading; dialogs 820:19717 and 820:19807;
// emails 48 (819:14179) and 49 (819:14205); phone 821:18776). D116, D146. The owner only.
//
// Heston's decisions (read-back approved Nov 6, 08:17):
//   1. The export holds every record the business owns, plus links to the files the portal keeps and Dropbox paths.
//      Left out: connector keys, Stripe / Dropbox / Google tokens, passwords and sign-in data, and the secret part of
//      every link (share, pay, signing, quote, proposal, briefing and call links), so the zip opens nothing by itself.
//      W-9s: the link to the file (the portal never stores the tax ID number written out).
//   2. On day 60: everyone is signed out (their memberships go), then the records and the files the portal itself keeps
//      are deleted, and the business's videos are removed from Bunny (playback copies; the originals are in Dropbox).
//      Dropbox is never touched. Stripe stays the business's own; the portal's connection goes with the business.
//   3. A safety net (rule 7): the run first saves one final export, kept 30 days, shown only to the portal's admins.
//   4. Wrangler, the platform's own business, can't be deleted from here.
//   5. A reminder a week before, in email 49's layout.
//   6. The download is the portal's own link, given only to the signed-in owner; its file is removed after 7 days.
import { strToU8, zipSync } from "fflate";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireOwner } from "./lib/access";
import { businessInScope, defaultBusiness } from "./lib/business";
import { allowedEmails } from "./lib/owners";
import { audit } from "./lib/audit";
import { BUSINESS_TABLES } from "./lib/tenancy";
import { mailBrandOf } from "./lib/mail";
import { SITE } from "./lib/email";
import { deletionMail, exportReadyMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import schema from "./schema";

export const EXPORT_DAYS = 7;
export const WAIT_DAYS = 60;
export const REMIND_DAYS = 7;
export const KEEP_FINAL_DAYS = 30;
const DAY = 86_400_000;
const PAGE = 300;
const BATCH = 100; // rows per step of the day-60 run (each step is its own short transaction)

/** Kept out of the export: keys and tokens, and records that are only the portal's own machinery. */
export const OMIT_TABLES = new Set(["connectorKeys", "sheetKeys", "wsConnectorKeys", "dropbox", "wsDropbox", "counters", "waveforms", "dataExports"]);
/** Fields never written into the export, wherever they appear: the secret part of links, sign-in codes and tokens, and
 *  Stripe's own pay-page and PDF links (anyone holding one can open the invoice). */
export const SECRET_FIELDS = new Set(["token", "linkToken", "payToken", "passcodeHash", "codeHash", "sessionHash", "tokenHash", "refreshToken", "accessToken", "accessExpiresAt", "syncToken", "codeSends", "codeAttempts", "codeExpiresAt", "failures", "failTotal", "hostedUrl", "pdfUrl"]);
/** Secret fields whose names mean something else in other tables (review fix, Nov 6). */
export const SECRET_PATHS: Record<string, string[]> = { calls: ["code"], emailPrefs: ["key"], fileUploads: ["sessionId"], wsDocuments: ["invoice.url"] };
/** Deleted last: what other records point at (the business's own records go first, then these). */
const LAST = ["wsDocuments", "projects", "clients", "vendors"];
const ORDER = [...BUSINESS_TABLES.filter((t) => !LAST.includes(t)), ...LAST];

// ---------- the files a record keeps: read from the schema (fields typed as storage ids), never guessed from text ----------

type Validator = { kind: string; tableName?: string; fields?: Record<string, Validator>; element?: Validator; members?: Validator[]; value?: Validator };
function storagePaths(val: Validator | undefined, path: string[], out: string[][]) {
  if (!val) return;
  if (val.kind === "id" && val.tableName === "_storage") out.push(path);
  else if (val.kind === "object") for (const [k, f] of Object.entries(val.fields ?? {})) storagePaths(f, [...path, k], out);
  else if (val.kind === "array") storagePaths(val.element, [...path, "[]"], out);
  else if (val.kind === "record") storagePaths(val.value, [...path, "{}"], out);
  else if (val.kind === "union") for (const m of val.members ?? []) storagePaths(m, path, out);
}
const TABLE_DEFS = (schema as unknown as { tables: Record<string, { validator: Validator }> }).tables;
// Files kept inside free-form fields (v.any()), which the schema can't type: the brand kits and Sign's styles.
const KIT = [["brandKit", "logoFileId"], ["brandKit", "files", "[]", "fileId"]];
const STYLE = [["style", "logo", "fileId"], ["style", "cover", "fileId"], ["style", "backdropImage", "fileId"]];
const EXTRA_PATHS: Record<string, string[][]> = { businesses: KIT, clients: KIT, wsStyles: STYLE, wsBuilds: STYLE, wsTemplates: STYLE };
export const STORAGE_PATHS: Record<string, string[][]> = Object.fromEntries(Object.entries(TABLE_DEFS).map(([t, d]) => {
  const out: string[][] = [...(EXTRA_PATHS[t] ?? [])]; storagePaths(d.validator, [], out);
  return [t, [...new Map(out.map((p) => [p.join("."), p])).values()]];
}));
/** The storage ids a record keeps, each with the field it's in. */
export function filesOf(table: string, doc: unknown): Array<{ field: string; id: Id<"_storage"> }> {
  const out: Array<{ field: string; id: Id<"_storage"> }> = [];
  const walk = (x: unknown, rest: string[], at: string) => {
    if (x === undefined || x === null) return;
    if (!rest.length) { if (typeof x === "string") out.push({ field: at, id: x as Id<"_storage"> }); return; }
    const [h, ...t] = rest;
    if (h === "[]") { if (Array.isArray(x)) x.forEach((y, i) => walk(y, t, `${at}[${i}]`)); return; }
    if (typeof x !== "object") return;
    if (h === "{}") { for (const [k, y] of Object.entries(x as Record<string, unknown>)) walk(y, t, `${at}.${k}`); return; }
    walk((x as Record<string, unknown>)[h], t, at ? `${at}.${h}` : h);
  };
  for (const p of STORAGE_PATHS[table] ?? []) walk(doc, p, "");
  return out;
}

// ---------- secrets: left out, and their values removed wherever else they turn up (a link that carries a token) ----------

const RUN = /[A-Za-z0-9_-]{12,}/g;
/** Stripe's object ids (an account, a customer, an invoice) sit in its pay-page links but aren't secret, and appear on
 *  their own in the records: never removed (review re-check, Nov 6). */
const STRIPE_ID = /^(acct|cus|in|sub|pi|ch|price|prod|cs)_[A-Za-z0-9]+$/;
function collectSecret(x: unknown, into: Set<string>) {
  if (typeof x === "string") { if (x.length >= 12) into.add(x); for (const m of x.match(RUN) ?? []) if (!STRIPE_ID.test(m)) into.add(m); }
  else if (Array.isArray(x)) x.forEach((y) => collectSecret(y, into));
  else if (x && typeof x === "object") Object.values(x).forEach((y) => collectSecret(y, into));
}
/** A record as it goes into the export: secret fields out (their values kept aside to be removed everywhere). */
function clean(table: string, x: unknown, secrets: Set<string>, path = ""): unknown {
  if (Array.isArray(x)) return x.map((y) => clean(table, y, secrets, path));
  if (x && typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
      const full = path ? `${path}.${k}` : k;
      if (SECRET_FIELDS.has(k) || SECRET_PATHS[table]?.includes(full)) { collectSecret(val, secrets); continue; }
      out[k] = clean(table, val, secrets, full);
    }
    return out;
  }
  return x;
}
/** Every run of link characters that is (or holds) a secret becomes [removed]. Tokens are base64url or hex. */
export const redact = (text: string, secrets: Set<string>) => (secrets.size ? text.replace(RUN, (m) => (secrets.has(m) ? "[removed]" : m)) : text);

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
const fmtWhen = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmtSize = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

async function ownBiz(ctx: QueryCtx | MutationCtx) {
  const me = await requireOwner(ctx);
  const id = businessInScope(ctx);
  const b = id ? await ctx.db.get(id) : null;
  if (!b) throw new ConvexError("Not allowed.");
  const isDefault = (await defaultBusiness(ctx))?._id === b._id;
  return { me, b, isDefault };
}
const isAdmin = (email: string) => allowedEmails().includes(email.toLowerCase());

// ---------- the page ----------

export const state = query({
  args: {},
  handler: async (ctx) => {
    const { me, b, isDefault } = await ownBiz(ctx);
    const rows = await ctx.db.query("dataExports").withIndex("by_requested").order("desc").take(20);
    const now = Date.now();
    const shape = (e: Doc<"dataExports">) => ({ _id: e._id, status: e.status === "ready" && (e.expiresAt ?? 0) <= now ? "expired" as const : e.status, requestedAt: e.requestedAt, readyAt: e.readyAt ?? null, bytes: e.bytes ?? null, expiresAt: e.expiresAt ?? null });
    const latest = rows[0] ? shape(rows[0]) : null;
    const lastReady = rows.find((e) => e.status === "ready" || e.status === "expired");
    const del = await ctx.db.query("businessDeletions").withIndex("by_business", (q) => q.eq("businessId", b._id)).order("desc").first();
    // The portal's admins (on the platform's own business) see the safety-net exports of deleted businesses.
    const safety = isDefault && isAdmin(me.email)
      ? (await ctx.db.query("businessDeletions").withIndex("by_purge", (q) => q.gt("purgeAt", now)).collect()).filter((d) => d.finalExportId)
        .map((d) => ({ _id: d._id, name: d.name, status: d.status, doneAt: d.doneAt ?? null, bytes: d.finalBytes ?? null, purgeAt: d.purgeAt ?? now + KEEP_FINAL_DAYS * DAY }))
      : [];
    return {
      business: { name: b.name, isDefault },
      latest, lastReady: lastReady ? shape(lastReady) : null,
      deletion: del && del.status === "scheduled" ? { _id: del._id, deleteAt: del.deleteAt, requestedBy: del.requestedBy } : null,
      safety,
    };
  },
});

export const requestExport = mutation({
  args: {},
  handler: async (ctx) => {
    const { me } = await ownBiz(ctx);
    const making = await ctx.db.query("dataExports").withIndex("by_requested").order("desc").take(5);
    if (making.some((e) => e.status === "making" && Date.now() - e.requestedAt < 30 * 60_000)) throw new ConvexError("An export is already being made.");
    const exportId = await ctx.db.insert("dataExports", { status: "making", requestedAt: Date.now(), requestedBy: me.userId });
    await ctx.scheduler.runAfter(0, internal.yourData.buildExport, { exportId });
    await audit(ctx, { kind: "export", text: "asked for an export of everything", where: "Settings › Your data", link: "/settings/data" });
    return exportId;
  },
});

export const cancelExport = mutation({
  args: { exportId: v.id("dataExports") },
  handler: async (ctx, { exportId }) => {
    await ownBiz(ctx);
    const e = await ctx.db.get(exportId);
    if (e?.status === "making") await ctx.db.patch(exportId, { status: "cancelled" });
  },
});

/** The download link: only for the signed-in owner, only while the export is good. */
export const exportLink = mutation({
  args: { exportId: v.id("dataExports") },
  handler: async (ctx, { exportId }) => {
    await ownBiz(ctx);
    const e = await ctx.db.get(exportId);
    if (!e || e.status !== "ready" || !e.fileId || (e.expiresAt ?? 0) <= Date.now()) throw new ConvexError("That export has expired. Ask for a new one.");
    await audit(ctx, { kind: "export", text: "downloaded the export of everything", where: "Settings › Your data", link: "/settings/data" });
    return await ctx.storage.getUrl(e.fileId);
  },
});

export const scheduleDeletion = mutation({
  args: { typedName: v.string() },
  handler: async (ctx, { typedName }) => {
    const { me, b, isDefault } = await ownBiz(ctx);
    if (isDefault) throw new ConvexError(`${b.name} is the portal's own business, so it can't be deleted from here.`);
    if (typedName.trim() !== b.name.trim()) throw new ConvexError("Type the business name exactly as it is to confirm.");
    const open = await ctx.db.query("businessDeletions").withIndex("by_business", (q) => q.eq("businessId", b._id)).collect();
    if (open.some((d) => d.status === "scheduled" || d.status === "running")) throw new ConvexError("A deletion is already scheduled.");
    const now = Date.now(), deleteAt = now + WAIT_DAYS * DAY;
    const id = await ctx.db.insert("businessDeletions", { businessId: b._id, name: b.name, ownerEmail: me.email, requestedBy: me.name ?? me.email, requestedAt: now, deleteAt, status: "scheduled" });
    const run = await ctx.scheduler.runAt(deleteAt, internal.yourData.runDeletion, { deletionId: id });
    const remind = await ctx.scheduler.runAt(deleteAt - REMIND_DAYS * DAY, internal.yourData.sendDeletionMail, { deletionId: id, reminder: true });
    await ctx.db.patch(id, { jobs: [run, remind] });
    await ctx.scheduler.runAfter(0, internal.yourData.sendDeletionMail, { deletionId: id, reminder: false });
    await audit(ctx, { kind: "deleted", text: `scheduled the deletion of ${b.name} for ${fmtDay(deleteAt)}`, where: "Settings › Your data", link: "/settings/data" });
    return { deleteAt };
  },
});

export const cancelDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const { b } = await ownBiz(ctx);
    const all = await ctx.db.query("businessDeletions").withIndex("by_business", (q) => q.eq("businessId", b._id)).collect();
    if (all.some((x) => x.status === "running")) throw new ConvexError("The deletion has already started, so it can't be cancelled.");
    const d = all.find((x) => x.status === "scheduled");
    if (!d) return null;
    for (const j of d.jobs ?? []) { try { await ctx.scheduler.cancel(j); } catch { /* already ran */ } }
    await ctx.db.patch(d._id, { status: "cancelled", cancelledAt: Date.now() });
    await audit(ctx, { kind: "settings", text: `cancelled the deletion of ${b.name}`, where: "Settings › Your data", link: "/settings/data" });
    return null;
  },
});

/** The portal's admins: the final export of a deleted business, while it's kept (30 days). */
export const finalExportLink = mutation({
  args: { deletionId: v.id("businessDeletions") },
  handler: async (ctx, { deletionId }) => {
    const { me, isDefault } = await ownBiz(ctx);
    if (!isDefault || !isAdmin(me.email)) throw new ConvexError("Not allowed.");
    const d = await ctx.db.get(deletionId);
    if (!d?.finalExportId || (d.purgeAt ?? 0) <= Date.now()) throw new ConvexError("That export is no longer kept.");
    return await ctx.storage.getUrl(d.finalExportId);
  },
});

// ---------- making the export (runs as the business: every read below sees only its records) ----------

/** One page of one table's records, as they go into the export. */
export const exportPage = internalQuery({
  args: { table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, cursor }) => {
    const biz = businessInScope(ctx);
    if (!biz || !BUSINESS_TABLES.includes(table)) throw new Error("No business.");
    const def = (await defaultBusiness(ctx))?._id;
    const r = await ctx.db.query(table as "projects").paginate({ cursor, numItems: PAGE });
    const files: Array<{ table: string; record: string; field: string; storageId: Id<"_storage"> }> = [];
    const docs: unknown[] = [];
    const secrets = new Set<string>();
    for (const d of r.page) {
      if ((d.businessId ?? def) !== biz) continue; // belt and braces: the row rules already keep other businesses out
      docs.push(clean(table, d, secrets));
      for (const f of filesOf(table, d)) files.push({ table, record: d._id, field: f.field, storageId: f.id });
    }
    return { docs, files, secrets: [...secrets], cursor: r.continueCursor, done: r.isDone };
  },
});

/** Wrangler Sign's audit trail (it belongs to the business through its document). */
export const signEvents = internalQuery({
  args: { documentIds: v.array(v.id("wsDocuments")) },
  handler: async (ctx, { documentIds }) => {
    const out: unknown[] = [];
    const secrets = new Set<string>();
    for (const id of documentIds) {
      if (!(await ctx.db.get(id))) continue;
      for (const e of await ctx.db.query("wsEvents").withIndex("by_document", (q) => q.eq("documentId", id)).collect()) out.push(clean("wsEvents", e, secrets));
    }
    return { events: out, secrets: [...secrets] };
  },
});

export const storageUrls = internalQuery({
  args: { ids: v.array(v.id("_storage")) },
  handler: async (ctx, { ids }) => {
    const out: Record<string, string | null> = {};
    for (const id of ids) out[id] = await ctx.storage.getUrl(id);
    return out;
  },
});

export const facts = internalQuery({
  args: { exportId: v.optional(v.id("dataExports")) },
  handler: async (ctx, { exportId }) => {
    const biz = businessInScope(ctx);
    const b = biz ? await ctx.db.get(biz) : null;
    const e = exportId ? await ctx.db.get(exportId) : null;
    const u = e ? await ctx.db.get(e.requestedBy) : null;
    return { name: b?.name ?? "Your business", businessId: b?._id ?? null, status: e?.status ?? null, to: u?.email ?? null, toName: u?.name ?? null, brand: await mailBrandOf(ctx, b?._id ?? null) };
  },
});

type Ctx = { runQuery: (ref: any, args: any) => Promise<any> };

/** The zip: README, a JSON file of records per kind, CSVs of the main lists, and files.csv with links. */
async function makeZip(ctx: Ctx, name: string, progress?: () => Promise<unknown>) {
  const files: Record<string, Uint8Array> = {};
  const links: Array<{ table: string; record: string; field: string; storageId: string }> = [];
  const secrets = new Set<string>();
  const json: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const all: Record<string, Array<Record<string, unknown>>> = {};
  for (const [ti, table] of BUSINESS_TABLES.entries()) {
    if (OMIT_TABLES.has(table)) continue;
    if (progress && ti % 5 === 0) await progress();
    const rows: unknown[] = [];
    let cursor: string | null = null;
    for (;;) {
      const r: { docs: unknown[]; files: typeof links; secrets: string[]; cursor: string; done: boolean } = await ctx.runQuery(internal.yourData.exportPage, { table, cursor });
      rows.push(...r.docs); links.push(...r.files);
      for (const x of r.secrets) secrets.add(x);
      if (r.done) break;
      cursor = r.cursor;
    }
    if (!rows.length) continue;
    counts[table] = rows.length;
    all[table] = rows as Array<Record<string, unknown>>;
    json[table] = rows;
  }
  const docIds = (all.wsDocuments ?? []).map((d) => d._id as Id<"wsDocuments">);
  if (docIds.length) {
    const ev: unknown[] = [];
    for (let i = 0; i < docIds.length; i += 50) {
      const r: { events: unknown[]; secrets: string[] } = await ctx.runQuery(internal.yourData.signEvents, { documentIds: docIds.slice(i, i + 50) });
      ev.push(...r.events); for (const x of r.secrets) secrets.add(x);
    }
    if (ev.length) { counts.wsEvents = ev.length; json.wsEvents = ev; }
  }
  // Every file is written only now, once the secrets of every table are known, with each secret's value removed.
  const put = (name: string, text: string) => { files[name] = strToU8(redact(text, secrets)); };
  for (const [table, rows] of Object.entries(json)) put(`records/${table}.json`, JSON.stringify(rows, null, 1));
  const urls: Record<string, string | null> = {};
  const ids = [...new Set(links.map((l) => l.storageId))];
  for (let i = 0; i < ids.length; i += 100) Object.assign(urls, await ctx.runQuery(internal.yourData.storageUrls, { ids: ids.slice(i, i + 100) }));
  const q = (x: unknown) => { const s = x === null || x === undefined ? "" : String(x); const t = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = (rows: unknown[][]) => rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
  const fileRows: unknown[][] = [["Kind", "Record", "Field", "Link"]];
  for (const l of links) if (urls[l.storageId]) fileRows.push([l.table, l.record, l.field, urls[l.storageId]]);
  for (const v of all.versions ?? []) if (v.dropboxPath) fileRows.push(["versions", v._id, "dropboxPath (in your Dropbox)", v.dropboxPath]);
  put("files.csv", csv(fileRows));
  const money = (c: unknown) => (typeof c === "number" ? (c / 100).toFixed(2) : "");
  const nameOf = (table: string, id: unknown) => (all[table] ?? []).find((r) => r._id === id)?.name ?? "";
  put("clients.csv", csv([["Client", "Email", "Created"], ...(all.clients ?? []).map((c) => [c.name, c.email ?? "", c.createdAt ? new Date(c.createdAt as number).toISOString().slice(0, 10) : ""])]))
  put("projects.csv", csv([["Job number", "Project", "Client", "Stage"], ...(all.projects ?? []).map((p) => [p.jobNumber ?? "", p.name, nameOf("clients", p.clientId), p.stage ?? ""])]))
  put("invoices.csv", csv([["Number", "Title", "Client", "Status", "Due", "Total (USD)", "Paid (USD)", "Refunded (USD)"], ...(all.invoices ?? []).map((i) => [i.number ?? "", i.title, nameOf("clients", i.clientId), i.status, i.dueDate, money(i.totalCents), money(i.amountPaidCents), money(i.refundedCents ?? 0)])]))
  put("vendors.csv", csv([["Vendor", "Email", "Roles", "W-9 on file"], ...(all.vendors ?? []).map((x) => [x.name, x.email, Array.isArray(x.roles) ? x.roles.join("; ") : "", x.w9 ? "Yes" : "No"])]))
  const made = new Date().toISOString();
  put("README.txt", [
    `${name}: everything in Wrangler Portal`, `Made ${made}`, "",
    "records/  every record, one JSON file per kind (ids link records to each other)",
    "files.csv  links to the files the portal keeps (signed PDFs, uploads, W-9s), and Dropbox paths of originals",
    "clients.csv, projects.csv, invoices.csv, vendors.csv  the main lists, for a spreadsheet", "",
    "Not included: connector keys, Stripe, Dropbox and Google tokens, passwords and sign-in data, and the secret part of",
    "every link (shares, invoices, signing, quotes, proposals, briefings, calls). Your files themselves stay in Dropbox.", "",
    "Records: " + Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", "),
  ].join("\r\n"));
  const zip = zipSync(files, { level: 6 });
  return { zip, counts };
}

export const buildExport = internalAction({
  args: { exportId: v.id("dataExports") },
  handler: async (ctx, { exportId }) => {
    const f = await ctx.runQuery(internal.yourData.facts, { exportId });
    if (f.status !== "making") return;
    try {
      const { zip } = await makeZip(ctx, f.name);
      const fileId = await ctx.storage.store(new Blob([zip as BlobPart], { type: "application/zip" }));
      const ok = await ctx.runMutation(internal.yourData.exportStored, { exportId, fileId, bytes: zip.byteLength });
      if (ok && f.to) {
        const until = Date.now() + EXPORT_DAYS * DAY;
        const link = `${SITE()}/settings/your-data`;
        await deliverOnce(ctx, `export-ready:${exportId}`, "export_ready", f.to, exportReadyMail(f.brand, { name: f.toName, business: f.name, made: fmtWhen(Date.now()), size: fmtSize(zip.byteLength), until: fmtDay(until), link }), f.brand.replyTo, f.businessId);
      }
    } catch (e) {
      await ctx.runMutation(internal.yourData.exportFailed, { exportId, error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  },
});

export const exportStored = internalMutation({
  args: { exportId: v.id("dataExports"), fileId: v.id("_storage"), bytes: v.number() },
  handler: async (ctx, { exportId, fileId, bytes }) => {
    const e = await ctx.db.get(exportId);
    if (!e || e.status !== "making") { await ctx.storage.delete(fileId); return false; } // cancelled while it was being made
    const now = Date.now();
    await ctx.db.patch(exportId, { status: "ready", fileId, bytes, readyAt: now, expiresAt: now + EXPORT_DAYS * DAY });
    return true;
  },
});

export const exportFailed = internalMutation({
  args: { exportId: v.id("dataExports"), error: v.string() },
  handler: async (ctx, { exportId, error }) => {
    const e = await ctx.db.get(exportId);
    if (e?.status === "making") await ctx.db.patch(exportId, { status: "failed", error });
  },
});

// ---------- deleting the business ----------

export const deletionFacts = internalQuery({
  args: { deletionId: v.id("businessDeletions") },
  handler: async (ctx, { deletionId }) => {
    const d = await ctx.db.get(deletionId);
    if (!d) return null;
    const owner = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", d.ownerEmail)).first();
    return { d, ownerName: owner?.name ?? null, brand: await mailBrandOf(ctx, d.businessId) };
  },
});

/** Email 49 (and its reminder a week before). */
export const sendDeletionMail = internalAction({
  args: { deletionId: v.id("businessDeletions"), reminder: v.boolean() },
  handler: async (ctx, { deletionId, reminder }) => {
    const f = await ctx.runQuery(internal.yourData.deletionFacts, { deletionId });
    if (!f || f.d.status !== "scheduled") return;
    if (reminder && Date.now() < f.d.deleteAt - REMIND_DAYS * DAY - 60_000) return; // never early
    const link = `${SITE()}/settings/your-data`;
    await deliverOnce(ctx, `deletion-${reminder ? "reminder" : "scheduled"}:${deletionId}`, reminder ? "deletion_reminder" : "deletion_scheduled", f.d.ownerEmail,
      deletionMail(f.brand, { name: f.ownerName, business: f.d.name, askedBy: f.d.requestedBy, on: fmtDay(f.d.deleteAt), link, reminder }), f.brand.replyTo, f.d.businessId);
  },
});

// The day-60 run, in short steps that each save where they got to (review fix, Nov 6): the safety-net export, then
// everyone out, then each table a batch at a time, then the logins and the business itself. A step that fails leaves the
// row "running" with an old heartbeat; the daily purge starts it again from where it stopped (5 tries at most).

export const startDeletion = internalMutation({
  args: { deletionId: v.id("businessDeletions"), resume: v.optional(v.boolean()) },
  handler: async (ctx, { deletionId, resume }) => {
    const d = await ctx.db.get(deletionId);
    const biz = businessInScope(ctx);
    if (!d || biz !== d.businessId) return null;
    if ((await defaultBusiness(ctx))?._id === d.businessId) { await ctx.db.patch(deletionId, { status: "failed", error: "The portal's own business can't be deleted." }); return null; }
    const now = Date.now();
    if (d.status === "scheduled") {
      if (now < d.deleteAt) return null;
      await ctx.db.patch(deletionId, { status: "running", startedAt: now, step: "export", heartbeat: now, attempts: 1 });
    } else if (resume && (d.status === "running" || d.status === "failed")) {
      await ctx.db.patch(deletionId, { status: "running", heartbeat: now, attempts: (d.attempts ?? 1) + 1, error: undefined });
    } else return null;
    return { name: d.name, needExport: !d.finalExportId };
  },
});

export const keepFinal = internalMutation({
  args: { deletionId: v.id("businessDeletions"), fileId: v.id("_storage"), bytes: v.number() },
  handler: async (ctx, { deletionId, fileId, bytes }) => {
    const d = await ctx.db.get(deletionId);
    if (!d || d.status !== "running" || d.finalExportId) { await ctx.storage.delete(fileId); return; } // a second try keeps the first one
    await ctx.db.patch(deletionId, { finalExportId: fileId, finalBytes: bytes, purgeAt: Date.now() + KEEP_FINAL_DAYS * DAY, step: "lockout", tableIndex: 0, cursor: null, heartbeat: Date.now() });
  },
});

/** Every session of a login (as Settings › Team does when someone is taken off). */
async function endSessions(ctx: MutationCtx, userId: Id<"users">) {
  for (const sess of await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect()) {
    for (const t of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", sess._id)).collect()) await ctx.db.delete(t._id);
    await ctx.db.delete(sess._id);
  }
}

/** Does this login still belong anywhere (another business, a guest pass, or the portal's admins)? */
async function stillBelongs(ctx: MutationCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!user) return true; // gone already: nothing to do
  const email = (user.email ?? "").toLowerCase();
  if (email && allowedEmails().includes(email)) return true;
  if (await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", userId)).first()) return true;
  if (email && await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", email)).first()) return true;
  if (email && await ctx.db.query("guestPasses").withIndex("by_email", (q) => q.eq("email", email)).first()) return true;
  return false;
}

/** One step of the run; it schedules the next one (as the same business) until the business is gone. */
export const deleteStep = internalMutation({
  args: { deletionId: v.id("businessDeletions") },
  handler: async (ctx, { deletionId }) => {
    const d = await ctx.db.get(deletionId);
    const biz = businessInScope(ctx);
    if (!d || d.status !== "running" || !biz || biz !== d.businessId || !d.finalExportId) return;
    const now = Date.now();
    const next = async (patch: Partial<Doc<"businessDeletions">>) => {
      await ctx.db.patch(deletionId, { ...patch, heartbeat: now });
      await ctx.scheduler.runAfter(0, internal.yourData.deleteStep, { deletionId });
    };
    const step = d.step ?? "lockout";

    if (step === "lockout") { // nobody can get in any more: every membership and guest pass of this business goes
      const users = new Set(d.users ?? []), emails = new Set(d.emails ?? []);
      const ms = await ctx.db.query("memberships").withIndex("by_business_email", (q) => q.eq("businessId", d.businessId)).take(BATCH);
      for (const m of ms) { if (m.userId) users.add(m.userId); emails.add(m.email.toLowerCase()); await ctx.db.delete(m._id); }
      const gs = ms.length < BATCH ? await ctx.db.query("guestPasses").withIndex("by_business", (q) => q.eq("businessId", d.businessId)).take(BATCH) : [];
      for (const g of gs) { emails.add(g.email.toLowerCase()); await ctx.db.delete(g._id); }
      const done = ms.length < BATCH && gs.length < BATCH;
      if (done) for (const e of emails) { const u = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", e)).first(); if (u) users.add(u._id); }
      return next({ users: [...users], emails: done ? [] : [...emails], ...(done ? { step: "signout" as const, tableIndex: 0 } : {}) });
    }

    if (step === "signout") { // signed out only where they have nothing else: a client of two businesses stays in the other
      const list = d.users ?? [], from = d.tableIndex ?? 0;
      for (const u of list.slice(from, from + 50)) if (!(await stillBelongs(ctx as unknown as MutationCtx, u))) await endSessions(ctx as unknown as MutationCtx, u);
      return next(from + 50 >= list.length ? { step: "tables", tableIndex: 0, cursor: null } : { tableIndex: from + 50 });
    }

    if (step === "tables") {
      const i = d.tableIndex ?? 0, table = ORDER[i];
      if (!table) return next((d.pass ?? 1) < 2 ? { pass: 2, tableIndex: 0, cursor: null } : { step: "finish", tableIndex: 0, cursor: null }); // a second pass: rows added while it ran
      const r = await ctx.db.query(table as "projects").paginate({ cursor: d.cursor ?? null, numItems: BATCH });
      const guids = new Set<string>(), stills = new Set<string>();
      let n = 0;
      for (const row of r.page) {
        if (row.businessId !== biz) continue; // the row rules already keep other businesses out; never a legacy row
        // Option B (Heston, Nov 6): the files the portal keeps stay 30 days with the safety-net export, then go with it.
        for (const f of filesOf(table, row)) await ctx.db.insert("deletionFiles", { deletionId, fileId: f.id, purgeAt: d.purgeAt ?? now + KEEP_FINAL_DAYS * DAY });
        if (table === "versions") {
          const ver = row as unknown as Doc<"versions">;
          if (ver.bunnyGuid) guids.add(ver.bunnyGuid);
          if (ver.storagePath) guids.add(`storage:${ver.storagePath}`);
          if (ver.scrubGuid) guids.add(`scrub:${ver.scrubGuid}`);
        }
        if (table === "notes") { const nt = row as unknown as Doc<"notes">; for (const u of [nt.still, nt.stillIn, nt.stillOut, ...(nt.voice?.pointers ?? []).map((p) => p.still)]) if (u) stills.add(u); }
        if (table === "wsDocuments") for (const e of await ctx.db.query("wsEvents").withIndex("by_document", (q) => q.eq("documentId", row._id as unknown as Id<"wsDocuments">)).collect()) await ctx.db.delete(e._id);
        await ctx.db.delete(row._id);
        n++;
      }
      // Bunny: the business's playback copies and stills (the originals are in Dropbox).
      const list = [...guids];
      for (let k = 0; k < Math.max(list.length, stills.size ? 1 : 0); k++) await ctx.scheduler.runAfter(k * 500, internal.stills.cleanup, { bunnyGuid: list[k] ?? null, stillUrls: k === 0 ? [...stills] : [] });
      const deleted = { ...(d.deleted ?? {}) };
      if (n) deleted[table] = (deleted[table] ?? 0) + n;
      return next(r.isDone ? { deleted, tableIndex: i + 1, cursor: null } : { deleted, cursor: r.continueCursor });
    }

    if (step === "finish") { // the logins that belonged only to this business (never an admin's), then the business itself
      const list = d.users ?? [], from = d.tableIndex ?? 0;
      for (const u of list.slice(from, from + 50)) {
        if (await stillBelongs(ctx as unknown as MutationCtx, u)) continue;
        await endSessions(ctx as unknown as MutationCtx, u);
        for (const a of await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", u)).collect()) await ctx.db.delete(a._id);
        for (const t of ["sessionDevices", "emailChanges", "alertPrefs", "pushSubs"] as const) for (const row of await ctx.db.query(t).withIndex("by_user", (q) => q.eq("userId", u)).collect()) await ctx.db.delete(row._id);
        for (const row of await ctx.db.query("userPrefs").withIndex("by_user_key", (q) => q.eq("userId", u)).collect()) await ctx.db.delete(row._id);
        await ctx.db.delete(u);
      }
      if (from + 50 < list.length) return next({ tableIndex: from + 50 });
      const b = await ctx.db.get(d.businessId);
      if (b) {
        for (const f of filesOf("businesses", b)) await ctx.db.insert("deletionFiles", { deletionId, fileId: f.id, purgeAt: d.purgeAt ?? now + KEEP_FINAL_DAYS * DAY }); // its logos
        await ctx.db.delete(d.businessId);
      }
      await ctx.db.patch(deletionId, { status: "done", step: "done", doneAt: now, heartbeat: now, users: [], emails: [] });
    }
  },
});

/** The run is still moving (so the daily purge doesn't start a second one). */
export const touch = internalMutation({
  args: { deletionId: v.id("businessDeletions") },
  handler: async (ctx, { deletionId }) => {
    const d = await ctx.db.get(deletionId);
    if (d?.status === "running" && businessInScope(ctx) === d.businessId) await ctx.db.patch(deletionId, { heartbeat: Date.now() });
  },
});

export const deletionFailed = internalMutation({
  args: { deletionId: v.id("businessDeletions"), error: v.string() },
  handler: async (ctx, { deletionId, error }) => { await ctx.db.patch(deletionId, { status: "failed", error }); },
});

/** Day 60 (runs as the business), and every later try: the safety-net export if it isn't made yet, then the steps. */
export const runDeletion = internalAction({
  args: { deletionId: v.id("businessDeletions"), resume: v.optional(v.boolean()) },
  handler: async (ctx, { deletionId, resume }) => {
    const s: { name: string; needExport: boolean } | null = await ctx.runMutation(internal.yourData.startDeletion, { deletionId, resume });
    if (!s) return;
    try {
      if (s.needExport) {
        const { zip } = await makeZip(ctx, s.name, () => ctx.runMutation(internal.yourData.touch, { deletionId }));
        const fileId = await ctx.storage.store(new Blob([zip as BlobPart], { type: "application/zip" }));
        await ctx.runMutation(internal.yourData.keepFinal, { deletionId, fileId, bytes: zip.byteLength });
      }
      await ctx.runMutation(internal.yourData.deleteStep, { deletionId });
    } catch (e) {
      await ctx.runMutation(internal.yourData.deletionFailed, { deletionId, error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  },
});

const STALE = 30 * 60_000; // a run that hasn't moved for 30 minutes has stopped
const TRIES = 5;

/** Daily: exports past their 7 days lose their file; safety-net exports and the files kept with them go after 30 days;
 *  a deletion that stopped part way is started again from where it got to. */
export const purge = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let n = 0;
    // Past rows lose their date, so the next run never meets them again (review fix: it used to stall on old rows).
    for (const e of await ctx.db.query("dataExports").withIndex("by_expires", (q) => q.gt("expiresAt", 0).lt("expiresAt", now)).take(200)) {
      if (e.fileId) { try { await ctx.storage.delete(e.fileId); } catch { /* gone */ } }
      await ctx.db.patch(e._id, { status: e.status === "ready" ? "expired" : e.status, fileId: undefined, expiresAt: undefined });
      n++;
    }
    for (const f of await ctx.db.query("deletionFiles").withIndex("by_purge", (q) => q.lt("purgeAt", now)).take(500)) {
      try { await ctx.storage.delete(f.fileId); } catch { /* gone */ }
      await ctx.db.delete(f._id);
      n++;
    }
    for (const d of await ctx.db.query("businessDeletions").withIndex("by_purge", (q) => q.gt("purgeAt", 0).lt("purgeAt", now)).take(50)) {
      if (d.status === "running" || d.status === "failed") continue; // its safety net stays until the run is finished
      if (d.finalExportId) { try { await ctx.storage.delete(d.finalExportId); } catch { /* gone */ } }
      await ctx.db.patch(d._id, { finalExportId: undefined, purgeAt: undefined });
      n++;
    }
    for (const status of ["running", "failed"] as const) {
      for (const d of await ctx.db.query("businessDeletions").withIndex("by_status", (q) => q.eq("status", status)).take(20)) {
        if (now - (d.heartbeat ?? 0) < STALE) continue;
        if ((d.attempts ?? 1) >= TRIES) { // stop trying, and tell the portal's admins (once)
          if (d.status === "running" || !d.error?.startsWith("Stopped")) {
            await ctx.db.patch(d._id, { status: "failed", error: `Stopped after ${TRIES} tries at step ${d.step ?? "?"}.` });
            await ctx.scheduler.runAfter(0, internal.bell.post, { kind: "sitewatch", title: `Deleting ${d.name} stopped part way. It needs a look.`, key: `deletion-stuck:${d._id}`, link: "/settings/data" });
          }
          continue;
        }
        await ctx.scheduler.runAfter(0, internal.yourData.runDeletion, { deletionId: d._id, resume: true, asBusiness: d.businessId });
      }
    }
    return n;
  },
});
