// Wrangler Sign — Heston's side (Phase S1, Oct 27). Every public function here is owner-only.
//
// A document is a finished PDF. Heston (or Claude, S4) uploads it, places boxes (markers find most of them), adds
// signers, then approves. Approval locks that version: its file hash, boxes, signers, signing order and invoice are
// covered by one lock hash. Any change after that is a new version; earlier versions are kept as they were.
// Sending, signing and completion are Phases S2–S3.
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { appendEvent, eventsOf, verifyChain } from "./lib/wsAudit";
import { approvalProblems, docLabel, lockText, OWNER_KEY, shapeProblems, type LayoutBox, type LayoutSigner } from "./lib/wsLayout";
import { inspect, sha256Bytes, stamp, type Stamp } from "./lib/wsPdf";
import { sha256Hex } from "./lib/hash";
import { allowedEmails } from "./auth";

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PNG_BYTES = 600 * 1024;

const rectV = v.object({ page: v.number(), x: v.number(), y: v.number(), w: v.number(), h: v.number() });
const boxV = v.object({
  id: v.string(), signer: v.string(),
  kind: v.union(v.literal("sign"), v.literal("initials"), v.literal("name"), v.literal("date"), v.literal("title")),
  page: v.number(), x: v.number(), y: v.number(), w: v.number(), h: v.number(),
  cover: v.optional(rectV), fromMarker: v.optional(v.boolean()),
});
const signerV = v.object({ key: v.string(), name: v.string(), email: v.string(), title: v.optional(v.string()), order: v.number() });
const paymentV = v.union(v.null(), v.object({ amountCents: v.number(), description: v.string() }));

const ownerEmail = () => allowedEmails()[0] ?? "";

async function currentSignature(ctx: QueryCtx | MutationCtx) {
  const rows = await ctx.db.query("wsOwnerSignatures").withIndex("by_adopted").order("desc").take(5);
  return rows.find((r) => !r.replacedAt) ?? null;
}

async function currentVersion(ctx: QueryCtx | MutationCtx, doc: Doc<"wsDocuments">) {
  const ver = await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", doc._id).eq("number", doc.currentVersion)).unique();
  if (!ver) throw new ConvexError("This document has lost its current version.");
  return ver;
}

async function loadEditable(ctx: MutationCtx, versionId: Id<"wsVersions">) {
  const ver = await ctx.db.get(versionId);
  if (!ver) throw new ConvexError("That version doesn't exist.");
  const doc = (await ctx.db.get(ver.documentId))!;
  if (doc.currentVersion !== ver.number) throw new ConvexError("That's an older version. Open the current one.");
  if (ver.approvedAt) throw new ConvexError("This version is approved and locked. Make a new version to change it.");
  if (doc.status !== "draft") throw new ConvexError("Only a draft can be edited.");
  return { ver, doc };
}

// Heston's own signer row always carries his adopted name and title and his own email, whatever the page sent.
function withOwner(signers: LayoutSigner[], sig: Doc<"wsOwnerSignatures"> | null): LayoutSigner[] {
  return signers.map((s) => s.key === OWNER_KEY ? { key: OWNER_KEY, name: sig?.name ?? "Heston Hill", email: ownerEmail(), title: sig?.title ?? "Founder", order: s.order } : { ...s, name: s.name.trim(), email: s.email.trim().toLowerCase(), title: s.title?.trim() || undefined });
}

// ---------- reading ----------

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const docs = await ctx.db.query("wsDocuments").withIndex("by_updated").order("desc").take(500);
    return Promise.all(docs.map(async (d) => {
      const ver = await currentVersion(ctx, d);
      return {
        _id: d._id, label: docLabel(d.number), title: d.title, status: d.status, version: d.currentVersion, updatedAt: d.updatedAt, createdAt: d.createdAt,
        signers: ver.signers.filter((s) => s.key !== OWNER_KEY).map((s) => s.name || s.email || s.key),
        pages: ver.pages.length, approved: !!ver.approvedAt,
      };
    }));
  },
});

export const get = query({
  args: { documentId: v.id("wsDocuments"), versionNumber: v.optional(v.number()) },
  handler: async (ctx, { documentId, versionNumber }) => {
    await requireMe(ctx);
    const doc = await ctx.db.get(documentId);
    if (!doc) return null;
    const versions = await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", documentId)).collect();
    const shown = versions.find((x) => x.number === (versionNumber ?? doc.currentVersion)) ?? versions.find((x) => x.number === doc.currentVersion)!;
    const events = await eventsOf(ctx, documentId);
    const sig = await currentSignature(ctx);
    return {
      doc: { ...doc, label: docLabel(doc.number) },
      version: { ...shown, fileUrl: await ctx.storage.getUrl(shown.fileId), isCurrent: shown.number === doc.currentVersion, editable: shown.number === doc.currentVersion && !shown.approvedAt && doc.status === "draft" },
      versions: versions.sort((a, b) => b.number - a.number).map((x) => ({ number: x.number, fileName: x.fileName, fileSha256: x.fileSha256, approvedAt: x.approvedAt ?? null, lockHash: x.lockHash ?? null, ownerSignedAt: x.ownerSignedAt ?? null, createdAt: x.createdAt })),
      events: events.map((e) => ({ seq: e.seq, at: e.at, kind: e.kind, actor: e.actor, versionNumber: e.versionNumber ?? null, detail: e.detail ?? null, email: e.email ?? null, ip: e.ip ?? null })),
      chain: await verifyChain(events),
      owner: { email: ownerEmail(), name: sig?.name ?? null, title: sig?.title ?? null, adopted: !!sig },
      problems: approvalProblems({ signers: shown.signers, boxes: shown.boxes, pages: shown.pages.length, payment: shown.payment ?? null, ownerSignatureAdopted: !!sig }),
    };
  },
});

export const ownerSignature = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const sig = await currentSignature(ctx);
    if (!sig) return { adopted: false as const, email: ownerEmail() };
    return {
      adopted: true as const, email: ownerEmail(), name: sig.name, title: sig.title, method: sig.method, adoptedAt: sig.adoptedAt,
      signatureUrl: await ctx.storage.getUrl(sig.signatureFileId), initialsUrl: await ctx.storage.getUrl(sig.initialsFileId),
      signatureSha256: sig.signatureSha256,
    };
  },
});

// ---------- uploading and creating ----------

export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => { await requireMe(ctx); return ctx.storage.generateUploadUrl(); },
});

async function readPdf(ctx: { storage: { get: (id: Id<"_storage">) => Promise<Blob | null>; delete: (id: Id<"_storage">) => Promise<void> } }, storageId: Id<"_storage">) {
  const blob = await ctx.storage.get(storageId);
  if (!blob) throw new ConvexError("The upload didn't arrive. Try again.");
  const fail = async (msg: string) => { await ctx.storage.delete(storageId); throw new ConvexError(msg); };
  if (blob.size > MAX_PDF_BYTES) return fail("That PDF is over 25 MB. Export a smaller one.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  if (!head.includes("%PDF-")) return fail("That file isn't a PDF.");
  const ins = await inspect(bytes);
  if (!ins.ok) return fail(ins.reason === "encrypted" ? "This PDF is password-protected. Export it again without protection, then upload that." : "This PDF can't be read. Try exporting it again.");
  if (!ins.pages.length) return fail("This PDF has no pages.");
  if (ins.pages.length > 200) return fail("That PDF has over 200 pages.");
  return { bytes, pages: ins.pages, sha: await sha256Bytes(bytes) };
}

const titleFromFile = (f: string) => f.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim().slice(0, 120) || "Untitled document";

export const create = action({
  args: { storageId: v.id("_storage"), fileName: v.string(), title: v.optional(v.string()) },
  handler: async (ctx, { storageId, fileName, title }): Promise<{ documentId: Id<"wsDocuments">; label: string }> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    const pdf = await readPdf(ctx, storageId);
    return ctx.runMutation(internal.sign.insertDocument, {
      storageId, fileName: fileName.slice(0, 200), title: (title?.trim() || titleFromFile(fileName)).slice(0, 120),
      sha: pdf.sha, bytes: pdf.bytes.length, pages: pdf.pages,
    });
  },
});

export const insertDocument = internalMutation({
  args: { storageId: v.id("_storage"), fileName: v.string(), title: v.string(), sha: v.string(), bytes: v.number(), pages: v.array(v.object({ width: v.number(), height: v.number(), rotate: v.number() })) },
  handler: async (ctx, a) => {
    const c = await ctx.db.query("counters").withIndex("by_key", (q) => q.eq("key", "wsNumber")).first();
    const number = c?.value ?? 1;
    if (c) await ctx.db.patch(c._id, { value: number + 1 }); else await ctx.db.insert("counters", { key: "wsNumber", value: number + 1 });
    const now = Date.now();
    const documentId = await ctx.db.insert("wsDocuments", { number, title: a.title, status: "draft", currentVersion: 1, createdAt: now, updatedAt: now });
    await ctx.db.insert("wsVersions", {
      documentId, number: 1, fileId: a.storageId, fileName: a.fileName, fileSha256: a.sha, fileBytes: a.bytes, pages: a.pages,
      signers: [{ key: "client", name: "", email: "", order: 1 }], boxes: [], signingOrder: "any", createdAt: now, updatedAt: now,
    });
    await appendEvent(ctx, documentId, { kind: "created", actor: OWNER_KEY, versionNumber: 1, detail: `Uploaded "${a.fileName}" (${a.pages.length} page${a.pages.length === 1 ? "" : "s"}), SHA-256 ${a.sha}` });
    return { documentId, label: docLabel(number) };
  },
});

// ---------- editing a draft ----------

export const saveLayout = mutation({
  args: {
    versionId: v.id("wsVersions"), title: v.string(), signers: v.array(signerV), boxes: v.array(boxV),
    signingOrder: v.union(v.literal("any"), v.literal("sequence")), payment: paymentV, hasTextLayer: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const { ver, doc } = await loadEditable(ctx, a.versionId);
    const signers = withOwner(a.signers, await currentSignature(ctx));
    const problems = shapeProblems({ signers, boxes: a.boxes as LayoutBox[], pages: ver.pages.length });
    if (problems.length) throw new ConvexError(problems[0]);
    const title = a.title.trim().slice(0, 120) || doc.title;
    await ctx.db.patch(ver._id, {
      signers, boxes: a.boxes, signingOrder: a.signingOrder, payment: a.payment ?? undefined, updatedAt: Date.now(),
      ...(a.hasTextLayer !== undefined ? { hasTextLayer: a.hasTextLayer } : {}),
    });
    await ctx.db.patch(doc._id, { title, updatedAt: Date.now() });
    return null;
  },
});

export const approve = mutation({
  args: { versionId: v.id("wsVersions") },
  handler: async (ctx, { versionId }) => {
    await requireMe(ctx);
    const { ver, doc } = await loadEditable(ctx, versionId);
    const sig = await currentSignature(ctx);
    const problems = approvalProblems({ signers: ver.signers, boxes: ver.boxes, pages: ver.pages.length, payment: ver.payment ?? null, ownerSignatureAdopted: !!sig });
    if (problems.length) throw new ConvexError(problems.join(" "));
    const lockHash = await sha256Hex(lockText({ documentNumber: doc.number, versionNumber: ver.number, title: doc.title, fileSha256: ver.fileSha256, pages: ver.pages, signers: ver.signers, boxes: ver.boxes as LayoutBox[], signingOrder: ver.signingOrder, payment: ver.payment ?? null }));
    const now = Date.now();
    await ctx.db.patch(ver._id, { approvedAt: now, lockHash, updatedAt: now });
    await ctx.db.patch(doc._id, { status: "approved", updatedAt: now });
    await appendEvent(ctx, doc._id, { kind: "approved", actor: OWNER_KEY, versionNumber: ver.number, detail: `Version ${ver.number} approved and locked. Lock hash ${lockHash}. ${ver.boxes.length} boxes, ${ver.signers.length} signers.` });
    return { lockHash };
  },
});

// A new version from the current one: same file, same layout, unlocked. Only before it's sent.
export const revise = mutation({
  args: { documentId: v.id("wsDocuments") },
  handler: async (ctx, { documentId }) => {
    await requireMe(ctx);
    const doc = await ctx.db.get(documentId);
    if (!doc) throw new ConvexError("That document doesn't exist.");
    if (doc.status !== "approved") throw new ConvexError(doc.status === "draft" ? "This draft can be edited as it is." : "Sent documents can't be changed here (voiding comes with sending).");
    const cur = await currentVersion(ctx, doc);
    const now = Date.now();
    const number = cur.number + 1;
    await ctx.db.insert("wsVersions", {
      documentId, number, fileId: cur.fileId, fileName: cur.fileName, fileSha256: cur.fileSha256, fileBytes: cur.fileBytes, pages: cur.pages,
      hasTextLayer: cur.hasTextLayer, signers: cur.signers, boxes: cur.boxes, signingOrder: cur.signingOrder, payment: cur.payment, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(documentId, { status: "draft", currentVersion: number, updatedAt: now });
    await appendEvent(ctx, documentId, { kind: "new_version", actor: OWNER_KEY, versionNumber: number, detail: `Version ${number} started from version ${cur.number} (same file). Version ${cur.number} stays as approved.` });
    return { versionNumber: number };
  },
});

// A new version with a different PDF. Signers carry over; boxes start empty (the page finds markers again).
export const replaceFile = action({
  args: { documentId: v.id("wsDocuments"), storageId: v.id("_storage"), fileName: v.string() },
  handler: async (ctx, { documentId, storageId, fileName }): Promise<{ versionNumber: number }> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    const pdf = await readPdf(ctx, storageId);
    return ctx.runMutation(internal.sign.insertReplacement, { documentId, storageId, fileName: fileName.slice(0, 200), sha: pdf.sha, bytes: pdf.bytes.length, pages: pdf.pages });
  },
});

export const insertReplacement = internalMutation({
  args: { documentId: v.id("wsDocuments"), storageId: v.id("_storage"), fileName: v.string(), sha: v.string(), bytes: v.number(), pages: v.array(v.object({ width: v.number(), height: v.number(), rotate: v.number() })) },
  handler: async (ctx, a) => {
    const doc = await ctx.db.get(a.documentId);
    if (!doc) { await ctx.storage.delete(a.storageId); throw new ConvexError("That document doesn't exist."); }
    if (doc.status !== "draft" && doc.status !== "approved") { await ctx.storage.delete(a.storageId); throw new ConvexError("Sent documents can't be changed here."); }
    const cur = await currentVersion(ctx, doc);
    const now = Date.now();
    const number = cur.number + 1;
    await ctx.db.insert("wsVersions", {
      documentId: doc._id, number, fileId: a.storageId, fileName: a.fileName, fileSha256: a.sha, fileBytes: a.bytes, pages: a.pages,
      signers: cur.signers, boxes: [], signingOrder: cur.signingOrder, payment: cur.payment, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(doc._id, { status: "draft", currentVersion: number, updatedAt: now });
    await appendEvent(ctx, doc._id, { kind: "new_version", actor: OWNER_KEY, versionNumber: number, detail: `Version ${number}: new file "${a.fileName}" (${a.pages.length} pages), SHA-256 ${a.sha}. Earlier versions are kept.` });
    return { versionNumber: number };
  },
});

// Delete a document that was never sent: its versions, files and trail go. Sent ones are kept for the record.
export const remove = mutation({
  args: { documentId: v.id("wsDocuments") },
  handler: async (ctx, { documentId }) => {
    await requireMe(ctx);
    const doc = await ctx.db.get(documentId);
    if (!doc) return null;
    if (doc.status !== "draft" && doc.status !== "approved") throw new ConvexError("Sent documents are kept for the record and can't be deleted.");
    const versions = await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", documentId)).collect();
    const files = new Set<Id<"_storage">>(versions.map((x) => x.fileId));
    for (const x of versions) await ctx.db.delete(x._id);
    for (const f of files) await ctx.storage.delete(f);
    for (const e of await eventsOf(ctx, documentId)) await ctx.db.delete(e._id);
    await ctx.db.delete(documentId);
    return null;
  },
});

// ---------- Heston's signature ----------

function isPng(b: Uint8Array) { return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; }

export const adoptSignature = action({
  args: { name: v.string(), title: v.string(), method: v.union(v.literal("typed"), v.literal("drawn")), signatureStorageId: v.id("_storage"), initialsStorageId: v.id("_storage") },
  handler: async (ctx, a): Promise<null> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    const read = async (id: Id<"_storage">) => {
      const blob = await ctx.storage.get(id);
      if (!blob || blob.size > MAX_PNG_BYTES) { if (blob) await ctx.storage.delete(id); throw new ConvexError("The signature image didn't arrive or is too big."); }
      const b = new Uint8Array(await blob.arrayBuffer());
      if (!isPng(b)) { await ctx.storage.delete(id); throw new ConvexError("The signature must be a PNG image."); }
      return sha256Bytes(b);
    };
    const name = a.name.trim(), title = a.title.trim();
    if (!name || name.length > 120 || title.length > 120) throw new ConvexError("Enter your name (and title) first.");
    const [signatureSha256, initialsSha256] = await Promise.all([read(a.signatureStorageId), read(a.initialsStorageId)]);
    await ctx.runMutation(internal.sign.insertSignature, { ...a, name, title, signatureSha256, initialsSha256 });
    return null;
  },
});

export const insertSignature = internalMutation({
  args: { name: v.string(), title: v.string(), method: v.union(v.literal("typed"), v.literal("drawn")), signatureStorageId: v.id("_storage"), initialsStorageId: v.id("_storage"), signatureSha256: v.string(), initialsSha256: v.string() },
  handler: async (ctx, a) => {
    const now = Date.now();
    const old = await currentSignature(ctx);
    if (old) await ctx.db.patch(old._id, { replacedAt: now }); // kept: documents signed with it point at it
    await ctx.db.insert("wsOwnerSignatures", { name: a.name, title: a.title, method: a.method, signatureFileId: a.signatureStorageId, initialsFileId: a.initialsStorageId, signatureSha256: a.signatureSha256, initialsSha256: a.initialsSha256, adoptedAt: now });
    // Drafts pick up the new name and title on Heston's signer row.
    for (const ver of await ctx.db.query("wsVersions").collect()) {
      if (ver.approvedAt || !ver.signers.some((s) => s.key === OWNER_KEY)) continue;
      await ctx.db.patch(ver._id, { signers: ver.signers.map((s) => s.key === OWNER_KEY ? { ...s, name: a.name, title: a.title } : s) });
    }
    return null;
  },
});

// Heston's signature goes on when the document is sent (S2 calls this). Refused unless the version is approved,
// current and unchanged since approval. Records which adopted signature was used; the image is stamped onto the
// PDF at completion together with everyone else's.
export const applyOwnerSignature = internalMutation({
  args: { versionId: v.id("wsVersions") },
  handler: async (ctx, { versionId }) => {
    const ver = await ctx.db.get(versionId);
    if (!ver) throw new ConvexError("That version doesn't exist.");
    const doc = (await ctx.db.get(ver.documentId))!;
    if (!ver.approvedAt || !ver.lockHash || doc.status !== "approved" || doc.currentVersion !== ver.number) throw new ConvexError("Only the current, approved version can be signed.");
    const again = await sha256Hex(lockText({ documentNumber: doc.number, versionNumber: ver.number, title: doc.title, fileSha256: ver.fileSha256, pages: ver.pages, signers: ver.signers, boxes: ver.boxes as LayoutBox[], signingOrder: ver.signingOrder, payment: ver.payment ?? null }));
    if (again !== ver.lockHash) throw new ConvexError("This version changed after it was approved. Approve it again.");
    if (!ver.signers.some((s) => s.key === OWNER_KEY)) return { applied: false as const };
    if (ver.ownerSignedAt) return { applied: true as const, already: true };
    const sig = await currentSignature(ctx);
    if (!sig) throw new ConvexError("Adopt your signature first.");
    const now = Date.now();
    await ctx.db.patch(ver._id, { ownerSignedAt: now, ownerSignatureId: sig._id });
    await appendEvent(ctx, doc._id, { kind: "owner_signed", actor: OWNER_KEY, versionNumber: ver.number, email: ownerEmail(), detail: `Signed by ${sig.name}, ${sig.title}, with the signature adopted ${new Date(sig.adoptedAt).toISOString()} (image SHA-256 ${sig.signatureSha256}).` });
    return { applied: true as const };
  },
});

// For tests and the S2 sender: the current version's id.
export const currentVersionId = internalQuery({
  args: { documentId: v.id("wsDocuments") },
  handler: async (ctx, { documentId }) => { const d = await ctx.db.get(documentId); return d ? (await currentVersion(ctx, d))._id : null; },
});

// ---------- preview ----------
// The PDF exactly as it will be stamped: Heston's adopted signature, initials, name, title and today's date in his
// boxes, and grey placeholders in the clients' boxes, with "PREVIEW" across the top of every page. Not stored.
export const preview = action({
  args: { versionId: v.id("wsVersions") },
  handler: async (ctx, { versionId }): Promise<{ url: string; fileName: string }> => {
    await ctx.runQuery(internal.users.assertAllowed, {});
    const data = await ctx.runQuery(internal.sign.previewData, { versionId });
    if (!data) throw new ConvexError("That version doesn't exist.");
    const pdfBlob = await ctx.storage.get(data.fileId);
    if (!pdfBlob) throw new ConvexError("The PDF is missing.");
    const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
    const png = async (id: Id<"_storage"> | null) => { if (!id) return null; const b = await ctx.storage.get(id); return b ? new Uint8Array(await b.arrayBuffer()) : null; };
    const [sigPng, iniPng] = await Promise.all([png(data.signatureFileId), png(data.initialsFileId)]);
    const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });
    const stamps: Stamp[] = [];
    for (const b of data.boxes as LayoutBox[]) {
      const cover = b.cover;
      const signer = data.signers.find((s) => s.key === b.signer);
      if (b.signer === OWNER_KEY) {
        if (b.kind === "sign" && sigPng) stamps.push({ box: b, cover, kind: "image", png: sigPng });
        else if (b.kind === "initials" && iniPng) stamps.push({ box: b, cover, kind: "image", png: iniPng });
        else stamps.push({ box: b, cover, kind: "text", text: b.kind === "date" ? today : b.kind === "name" ? (data.ownerName ?? "Heston Hill") : b.kind === "title" ? (data.ownerTitle ?? "Founder") : "[your signature]" });
      } else {
        const who = signer?.name || signer?.key || b.signer;
        stamps.push({ box: b, cover, kind: "text", text: b.kind === "sign" ? `[${who} signs here]` : b.kind === "initials" ? "[initials]" : `[${b.kind}: ${who}]` });
      }
    }
    for (let i = 0; i < data.pages; i++) stamps.push({ box: { page: i, x: 0.02, y: 0.004, w: 0.6, h: 0.018 }, kind: "text", text: `PREVIEW · ${data.label} v${data.versionNumber} · not signed` });
    const cert = [`PREVIEW of ${data.label} "${data.title}", version ${data.versionNumber}. Not a signed document.`, "", `Original file SHA-256 ${data.fileSha256}`, data.lockHash ? `Lock hash ${data.lockHash}` : "Not approved yet.", "", "The signed copy ends with an audit certificate listing every event, time, email and IP address, and the SHA-256 of the final file."];
    const out = await stamp(bytes, stamps, cert);
    // Kept for 15 minutes, then deleted: long enough to open, never a second copy lying around.
    const id = await ctx.storage.store(new Blob([new Uint8Array(out)], { type: "application/pdf" }));
    await ctx.scheduler.runAfter(15 * 60_000, internal.sign.deletePreview, { storageId: id });
    const url = await ctx.storage.getUrl(id);
    if (!url) throw new ConvexError("The preview couldn't be saved.");
    return { url, fileName: `${data.label} v${data.versionNumber} PREVIEW.pdf` };
  },
});

export const previewData = internalQuery({
  args: { versionId: v.id("wsVersions") },
  handler: async (ctx, { versionId }) => {
    const ver = await ctx.db.get(versionId);
    if (!ver) return null;
    const doc = (await ctx.db.get(ver.documentId))!;
    const sig = ver.ownerSignatureId ? await ctx.db.get(ver.ownerSignatureId) : await currentSignature(ctx);
    return {
      fileId: ver.fileId, fileSha256: ver.fileSha256, lockHash: ver.lockHash ?? null, boxes: ver.boxes, signers: ver.signers, pages: ver.pages.length,
      label: docLabel(doc.number), title: doc.title, versionNumber: ver.number,
      signatureFileId: sig?.signatureFileId ?? null, initialsFileId: sig?.initialsFileId ?? null, ownerName: sig?.name ?? null, ownerTitle: sig?.title ?? null,
    };
  },
});

export const deletePreview = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => { await ctx.storage.delete(storageId); return null; },
});
