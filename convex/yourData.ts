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

export const EXPORT_DAYS = 7;
export const WAIT_DAYS = 60;
export const REMIND_DAYS = 7;
export const KEEP_FINAL_DAYS = 30;
const DAY = 86_400_000;
const PAGE = 300;

/** Kept out of the export: keys and tokens, and records that are only the portal's own machinery. */
export const OMIT_TABLES = new Set(["connectorKeys", "sheetKeys", "wsConnectorKeys", "dropbox", "wsDropbox", "counters", "waveforms", "dataExports"]);
/** Fields never written into the export, wherever they appear: the secret part of links, sign-in codes and tokens. */
export const SECRET_FIELDS = new Set(["token", "linkToken", "payToken", "passcodeHash", "codeHash", "sessionHash", "tokenHash", "refreshToken", "accessToken", "accessExpiresAt", "syncToken", "codeSends", "codeAttempts", "codeExpiresAt", "failures", "failTotal"]);
/** Deleted last: what other records point at (the business's own records go first, then these). */
const LAST = ["wsDocuments", "projects", "clients", "vendors"];

// A string that could be a storage id (each one is checked with normalizeId before it counts). The second form is
// the test backend's.
const looksLikeId = (s: string) => /^[0-9a-z]{25,40}$/.test(s) || /^\d+_storage$/.test(s);

/** A record as it goes into the export: secret fields out, and the storage ids it mentions collected. */
function clean(x: unknown, found: (s: string, path: string) => void, path = ""): unknown {
  if (Array.isArray(x)) return x.map((y, i) => clean(y, found, `${path}[${i}]`));
  if (x && typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
      if (SECRET_FIELDS.has(k)) continue;
      out[k] = clean(val, found, path ? `${path}.${k}` : k);
    }
    return out;
  }
  if (typeof x === "string" && looksLikeId(x)) found(x, path);
  return x;
}

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
        .map((d) => ({ _id: d._id, name: d.name, doneAt: d.doneAt ?? null, bytes: d.finalBytes ?? null, purgeAt: d.purgeAt! }))
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
    const d = (await ctx.db.query("businessDeletions").withIndex("by_business", (q) => q.eq("businessId", b._id)).collect()).find((x) => x.status === "scheduled");
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
    const files: Array<{ table: string; record: string; field: string; storageId: string }> = [];
    const docs: unknown[] = [];
    for (const d of r.page) {
      if ((d.businessId ?? def) !== biz) continue; // belt and braces: the row rules already keep other businesses out
      const cands: Array<{ s: string; path: string }> = [];
      docs.push(clean(d, (s, path) => cands.push({ s, path })));
      for (const c of cands) if (ctx.db.system.normalizeId("_storage", c.s)) files.push({ table, record: d._id, field: c.path, storageId: c.s });
    }
    return { docs, files, cursor: r.continueCursor, done: r.isDone };
  },
});

/** Wrangler Sign's audit trail (it belongs to the business through its document). */
export const signEvents = internalQuery({
  args: { documentIds: v.array(v.id("wsDocuments")) },
  handler: async (ctx, { documentIds }) => {
    const out: unknown[] = [];
    for (const id of documentIds) {
      if (!(await ctx.db.get(id))) continue;
      for (const e of await ctx.db.query("wsEvents").withIndex("by_document", (q) => q.eq("documentId", id)).collect()) out.push(clean(e, () => {}));
    }
    return out;
  },
});

export const storageUrls = internalQuery({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, { ids }) => {
    const out: Record<string, string | null> = {};
    for (const s of ids) { const id = ctx.db.system.normalizeId("_storage", s); out[s] = id ? await ctx.storage.getUrl(id) : null; }
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
async function makeZip(ctx: Ctx, name: string) {
  const files: Record<string, Uint8Array> = {};
  const links: Array<{ table: string; record: string; field: string; storageId: string }> = [];
  const counts: Record<string, number> = {};
  const all: Record<string, Array<Record<string, unknown>>> = {};
  for (const table of BUSINESS_TABLES) {
    if (OMIT_TABLES.has(table)) continue;
    const rows: unknown[] = [];
    let cursor: string | null = null;
    for (;;) {
      const r: { docs: unknown[]; files: typeof links; cursor: string; done: boolean } = await ctx.runQuery(internal.yourData.exportPage, { table, cursor });
      rows.push(...r.docs); links.push(...r.files);
      if (r.done) break;
      cursor = r.cursor;
    }
    if (!rows.length) continue;
    counts[table] = rows.length;
    all[table] = rows as Array<Record<string, unknown>>;
    files[`records/${table}.json`] = strToU8(JSON.stringify(rows, null, 1));
  }
  const docIds = (all.wsDocuments ?? []).map((d) => d._id as Id<"wsDocuments">);
  if (docIds.length) {
    const ev: unknown[] = [];
    for (let i = 0; i < docIds.length; i += 50) ev.push(...(await ctx.runQuery(internal.yourData.signEvents, { documentIds: docIds.slice(i, i + 50) })));
    if (ev.length) { counts.wsEvents = ev.length; files["records/wsEvents.json"] = strToU8(JSON.stringify(ev, null, 1)); }
  }
  const urls: Record<string, string | null> = {};
  const ids = [...new Set(links.map((l) => l.storageId))];
  for (let i = 0; i < ids.length; i += 100) Object.assign(urls, await ctx.runQuery(internal.yourData.storageUrls, { ids: ids.slice(i, i + 100) }));
  const q = (x: unknown) => { const s = x === null || x === undefined ? "" : String(x); const t = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = (rows: unknown[][]) => rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
  const fileRows: unknown[][] = [["Kind", "Record", "Field", "Link"]];
  for (const l of links) if (urls[l.storageId]) fileRows.push([l.table, l.record, l.field, urls[l.storageId]]);
  for (const v of all.versions ?? []) if (v.dropboxPath) fileRows.push(["versions", v._id, "dropboxPath (in your Dropbox)", v.dropboxPath]);
  files["files.csv"] = strToU8(csv(fileRows));
  const money = (c: unknown) => (typeof c === "number" ? (c / 100).toFixed(2) : "");
  const nameOf = (table: string, id: unknown) => (all[table] ?? []).find((r) => r._id === id)?.name ?? "";
  files["clients.csv"] = strToU8(csv([["Client", "Email", "Created"], ...(all.clients ?? []).map((c) => [c.name, c.email ?? "", c.createdAt ? new Date(c.createdAt as number).toISOString().slice(0, 10) : ""])]));
  files["projects.csv"] = strToU8(csv([["Job number", "Project", "Client", "Stage"], ...(all.projects ?? []).map((p) => [p.jobNumber ?? "", p.name, nameOf("clients", p.clientId), p.stage ?? ""])]));
  files["invoices.csv"] = strToU8(csv([["Number", "Title", "Client", "Status", "Due", "Total (USD)", "Paid (USD)", "Refunded (USD)"], ...(all.invoices ?? []).map((i) => [i.number ?? "", i.title, nameOf("clients", i.clientId), i.status, i.dueDate, money(i.totalCents), money(i.amountPaidCents), money(i.refundedCents ?? 0)])]));
  files["vendors.csv"] = strToU8(csv([["Vendor", "Email", "Roles", "W-9 on file"], ...(all.vendors ?? []).map((x) => [x.name, x.email, Array.isArray(x.roles) ? x.roles.join("; ") : "", x.w9 ? "Yes" : "No"])]));
  const made = new Date().toISOString();
  files["README.txt"] = strToU8([
    `${name}: everything in Wrangler Portal`, `Made ${made}`, "",
    "records/  every record, one JSON file per kind (ids link records to each other)",
    "files.csv  links to the files the portal keeps (signed PDFs, uploads, W-9s, logos), and Dropbox paths of originals",
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

export const startDeletion = internalMutation({
  args: { deletionId: v.id("businessDeletions") },
  handler: async (ctx, { deletionId }) => {
    const d = await ctx.db.get(deletionId);
    const biz = businessInScope(ctx);
    if (!d || d.status !== "scheduled" || Date.now() < d.deleteAt || biz !== d.businessId) return null;
    if ((await defaultBusiness(ctx))?._id === d.businessId) { await ctx.db.patch(deletionId, { status: "failed", error: "The portal's own business can't be deleted." }); return null; }
    await ctx.db.patch(deletionId, { status: "running", startedAt: Date.now() });
    return d.name;
  },
});

export const keepFinal = internalMutation({
  args: { deletionId: v.id("businessDeletions"), fileId: v.id("_storage"), bytes: v.number() },
  handler: async (ctx, { deletionId, fileId, bytes }) => {
    await ctx.db.patch(deletionId, { finalExportId: fileId, finalBytes: bytes, purgeAt: Date.now() + KEEP_FINAL_DAYS * DAY });
  },
});

/** Every session of a login (as Settings › Team does when someone is taken off). */
async function endSessions(ctx: MutationCtx, userId: Id<"users">) {
  for (const sess of await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect()) {
    for (const t of await ctx.db.query("authRefreshTokens").withIndex("sessionId", (q) => q.eq("sessionId", sess._id)).collect()) await ctx.db.delete(t._id);
    await ctx.db.delete(sess._id);
  }
}

/** Step one of day 60: nobody can get in any more. Every membership goes and everyone in it is signed out. */
export const lockOut = internalMutation({
  args: { deletionId: v.id("businessDeletions") },
  handler: async (ctx, { deletionId }) => {
    const d = await ctx.db.get(deletionId);
    if (!d || d.status !== "running" || businessInScope(ctx) !== d.businessId) throw new Error("Not running.");
    const ms = await ctx.db.query("memberships").withIndex("by_business_email", (q) => q.eq("businessId", d.businessId)).collect();
    const users = new Set<Id<"users">>();
    for (const m of ms) { if (m.userId) users.add(m.userId); await ctx.db.delete(m._id); }
    for (const g of await ctx.db.query("guestPasses").collect()) if (g.businessId === d.businessId) await ctx.db.delete(g._id);
    for (const u of users) await endSessions(ctx as unknown as MutationCtx, u);
    return [...users];
  },
});

/** One batch of one table: this business's rows go, with the files the portal keeps for them. */
export const deleteBatch = internalMutation({
  args: { deletionId: v.id("businessDeletions"), table: v.string() },
  handler: async (ctx, { deletionId, table }) => {
    const d = await ctx.db.get(deletionId);
    const biz = businessInScope(ctx);
    if (!d || d.status !== "running" || biz !== d.businessId || !BUSINESS_TABLES.includes(table)) throw new Error("Not running.");
    const rows = await ctx.db.query(table as "projects").take(PAGE);
    const guids = new Set<string>(), stills = new Set<string>();
    let n = 0;
    for (const r of rows) {
      if (r.businessId !== biz) continue; // the row rules already keep other businesses out; never a legacy row
      const found: string[] = [];
      clean(r, (s) => found.push(s));
      for (const s of found) { const id = ctx.db.system.normalizeId("_storage", s); if (id) { try { await ctx.storage.delete(id); } catch { /* gone */ } } }
      if (table === "versions") {
        const ver = r as unknown as Doc<"versions">;
        if (ver.bunnyGuid) guids.add(ver.bunnyGuid);
        if (ver.storagePath) guids.add(`storage:${ver.storagePath}`);
        if (ver.scrubGuid) guids.add(`scrub:${ver.scrubGuid}`);
      }
      if (table === "notes") { const nt = r as unknown as Doc<"notes">; for (const u of [nt.still, nt.stillIn, nt.stillOut, ...(nt.voice?.pointers ?? []).map((p) => p.still)]) if (u) stills.add(u); }
      if (table === "wsDocuments") for (const e of await ctx.db.query("wsEvents").withIndex("by_document", (q) => q.eq("documentId", r._id as unknown as Id<"wsDocuments">)).collect()) await ctx.db.delete(e._id);
      await ctx.db.delete(r._id);
      n++;
    }
    // Bunny: the business's playback copies and stills (the originals are in Dropbox).
    const list = [...guids];
    for (let i = 0; i < Math.max(list.length, stills.size ? 1 : 0); i++) await ctx.scheduler.runAfter(i * 500, internal.stills.cleanup, { bunnyGuid: list[i] ?? null, stillUrls: i === 0 ? [...stills] : [] });
    const more = rows.length === PAGE;
    const deleted = { ...(d.deleted ?? {}) };
    if (n) { deleted[table] = (deleted[table] ?? 0) + n; await ctx.db.patch(deletionId, { deleted }); }
    return { n, more };
  },
});

/** Last: the business itself, and the logins that belonged only to it (never the portal's admins). */
export const finishDeletion = internalMutation({
  args: { deletionId: v.id("businessDeletions"), users: v.array(v.id("users")) },
  handler: async (ctx, { deletionId, users }) => {
    const d = await ctx.db.get(deletionId);
    if (!d || d.status !== "running") throw new Error("Not running.");
    const admins = new Set(allowedEmails());
    for (const u of users) {
      const user = await ctx.db.get(u);
      if (!user || (user.email && admins.has(user.email.toLowerCase()))) continue;
      if (await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", u)).first()) continue; // still in another business
      for (const a of await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", u)).collect()) await ctx.db.delete(a._id);
      for (const t of ["userPrefs", "sessionDevices", "emailChanges", "alertPrefs", "pushSubs"] as const) for (const r of await ctx.db.query(t).collect()) if ((r as { userId?: Id<"users"> }).userId === u) await ctx.db.delete(r._id);
      await ctx.db.delete(u);
    }
    await ctx.db.delete(d.businessId);
    await ctx.db.patch(deletionId, { status: "done", doneAt: Date.now() });
  },
});

export const deletionFailed = internalMutation({
  args: { deletionId: v.id("businessDeletions"), error: v.string() },
  handler: async (ctx, { deletionId, error }) => { await ctx.db.patch(deletionId, { status: "failed", error }); },
});

/** Day 60 (runs as the business): the safety-net export, then lock out, then delete, table by table. */
export const runDeletion = internalAction({
  args: { deletionId: v.id("businessDeletions") },
  handler: async (ctx, { deletionId }) => {
    const name: string | null = await ctx.runMutation(internal.yourData.startDeletion, { deletionId });
    if (!name) return;
    try {
      const { zip } = await makeZip(ctx, name);
      const fileId = await ctx.storage.store(new Blob([zip as BlobPart], { type: "application/zip" }));
      await ctx.runMutation(internal.yourData.keepFinal, { deletionId, fileId, bytes: zip.byteLength });
      const users: Id<"users">[] = await ctx.runMutation(internal.yourData.lockOut, { deletionId });
      const order = [...BUSINESS_TABLES.filter((t) => !LAST.includes(t)), ...LAST];
      for (const table of order) {
        for (let guard = 0; guard < 10_000; guard++) {
          const r: { n: number; more: boolean } = await ctx.runMutation(internal.yourData.deleteBatch, { deletionId, table });
          if (!r.more) break;
        }
      }
      await ctx.runMutation(internal.yourData.finishDeletion, { deletionId, users });
    } catch (e) {
      await ctx.runMutation(internal.yourData.deletionFailed, { deletionId, error: String((e as Error)?.message ?? e).slice(0, 300) });
    }
  },
});

/** Daily: exports past their 7 days lose their file; safety-net exports past their 30 days go. */
export const purge = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let n = 0;
    for (const e of await ctx.db.query("dataExports").withIndex("by_expires", (q) => q.lt("expiresAt", now)).take(200)) {
      if (e.fileId) { try { await ctx.storage.delete(e.fileId); } catch { /* gone */ } }
      if (e.status === "ready" || e.fileId) { await ctx.db.patch(e._id, { status: "expired", fileId: undefined }); n++; }
    }
    for (const d of await ctx.db.query("businessDeletions").withIndex("by_purge", (q) => q.lt("purgeAt", now)).take(50)) {
      if (d.finalExportId) { try { await ctx.storage.delete(d.finalExportId); } catch { /* gone */ } await ctx.db.patch(d._id, { finalExportId: undefined }); n++; }
    }
    return n;
  },
});
