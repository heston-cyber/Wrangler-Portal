// Wrangler Sign — after everyone signs (Phase S3, Oct 27).
//
// finish runs four steps, in this order, each recording its own result on the document so one failing doesn't stop
// the rest and each can be retried from the document page:
//   pdf      the signed copy: every box stamped with its signer's mark, the audit certificate appended; stored, and
//            its SHA-256 written into the trail
//   invoice  a DRAFT invoice in Stripe for the amount set on the document (never finalized, sent or paid here)
//   copies   the signed copy emailed to every signer and to Heston, with its SHA-256 in the email
//   archive  the signed copy and the trail as JSON into Dropbox › Apps/Wrangler Sign/<year>/ (convex/wsArchive.ts)
// Plus the public check: sign.wranglerportal.com/verify hashes a PDF in the browser and asks here whether that hash is
// a completed Wrangler Sign document (the file itself never leaves the person's computer).
import { action, httpAction, type ActionCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery, mutation } from "./lib/functions";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMe } from "./lib/access";
import { appendEvent, eventsOf, verifyChain } from "./lib/wsAudit";
import { OWNER_KEY, docLabel, type LayoutBox } from "./lib/wsLayout";
import { sha256Bytes, stamp } from "./lib/wsPdf";
import { auditExport, b64, certificate, finalStamps, safeFileName, type FinalEvent, type FinalInput, type FinalSigner } from "./lib/wsFinal";
import { SIGN_FROM, SIGN_SITE, centralDate } from "./lib/wsSigning";
import { sendEmail, SITE } from "./lib/email";
import { SIGN_STATEMENT, corsHeaders } from "./signing";

export const STEPS = ["pdf", "invoice", "copies", "archive"] as const;
type Step = (typeof STEPS)[number];
const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^.*ConvexError: /, "").split("\n")[0].slice(0, 300);
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const verifyUrl = () => `${SIGN_SITE()}/verify`;

// ---------- the data ----------

export const finalData = internalQuery({
  args: { documentId: v.id("wsDocuments") },
  handler: async (ctx, { documentId }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc || doc.sentVersion === undefined) return null;
    const ver = (await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", documentId).eq("number", doc.sentVersion!)).unique())!;
    const signings = (await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", documentId).eq("versionNumber", ver.number)).collect()).sort((a, b) => a.order - b.order || a._creationTime - b._creationTime);
    const owner = ver.ownerSignatureId ? await ctx.db.get(ver.ownerSignatureId) : null;
    const events = await eventsOf(ctx, documentId);
    return { doc, ver, signings, owner, events };
  },
});

type Data = NonNullable<Awaited<ReturnType<typeof loadData>>>;
async function loadData(ctx: ActionCtx, documentId: Id<"wsDocuments">) {
  return ctx.runQuery(internal.signDone.finalData, { documentId });
}

async function bytesOf(ctx: ActionCtx, id: Id<"_storage">): Promise<Uint8Array> {
  const b = await ctx.storage.get(id);
  if (!b) throw new Error("A stored file is missing.");
  return new Uint8Array(await b.arrayBuffer());
}

const toEvents = (es: Doc<"wsEvents">[]): FinalEvent[] => es.map((e) => ({
  documentId: e.documentId, seq: e.seq, at: e.at, kind: e.kind, actor: e.actor,
  ...(e.versionNumber !== undefined ? { versionNumber: e.versionNumber } : {}), ...(e.email ? { email: e.email } : {}), ...(e.ip ? { ip: e.ip } : {}),
  ...(e.userAgent ? { userAgent: e.userAgent } : {}), ...(e.detail ? { detail: e.detail } : {}), prevHash: e.prevHash, hash: e.hash,
}));

/** Everything the certificate and the stamps need, with the signature images read from storage. */
async function finalInput(ctx: ActionCtx, d: Data): Promise<FinalInput> {
  const biz = await ctx.runQuery(internal.business.contact, {}); // Phase 0.5d step 4: this document's business
  const { doc, ver, signings, owner } = d;
  const clients: FinalSigner[] = [];
  for (const s of signings) {
    if (s.status !== "signed" || !s.adopted || !s.signedAt) throw new Error(`${s.name} hasn't signed.`);
    const a = s.adopted;
    clients.push({
      key: s.signerKey, name: s.name, email: s.email, title: s.title ?? null, adoptedName: a.name, adoptedTitle: a.title ?? s.title ?? null, method: a.method,
      signaturePng: await bytesOf(ctx, a.signatureFileId), initialsPng: await bytesOf(ctx, a.initialsFileId), signatureSha256: a.signatureSha256, initialsSha256: a.initialsSha256,
      signedAt: s.signedAt, signedDate: s.signedDate ?? centralDate(s.signedAt), ip: s.signIp ?? null, userAgent: s.signUserAgent ?? null,
      verifiedAt: s.verifiedAt ?? null, consentAt: s.consentAt ?? null, consentVersion: s.consentVersion ?? null, adoptedAt: a.at ?? null,
      initialed: s.initialed ?? [], viewedPages: s.viewedPages ?? [],
    });
  }
  const ownerSigns = ver.signers.some((x) => x.key === OWNER_KEY);
  let ownerSigner: FinalSigner | null = null;
  if (ownerSigns) {
    if (!owner || !ver.ownerSignedAt) throw new Error("Your signature wasn't applied when this was sent.");
    ownerSigner = {
      key: OWNER_KEY, name: owner.name, email: biz.ownerEmail, title: owner.title, adoptedName: owner.name, adoptedTitle: owner.title, method: owner.method,
      signaturePng: await bytesOf(ctx, owner.signatureFileId), initialsPng: await bytesOf(ctx, owner.initialsFileId), signatureSha256: owner.signatureSha256, initialsSha256: owner.initialsSha256,
      signedAt: ver.ownerSignedAt, signedDate: centralDate(ver.ownerSignedAt), ip: null, userAgent: null, verifiedAt: null, consentAt: null, consentVersion: null,
      adoptedAt: owner.adoptedAt, initialed: [], viewedPages: [],
    };
  }
  return {
    label: docLabel(doc.number), title: doc.title, company: biz.legalName, versionNumber: ver.number, fileName: ver.fileName, fileSha256: ver.fileSha256,
    lockHash: ver.lockHash ?? "", pages: ver.pages.length, sentAt: doc.sentAt ?? null, completedAt: doc.completedAt ?? Date.now(), signingOrder: ver.signingOrder,
    owner: ownerSigner, signers: clients, boxes: ver.boxes as LayoutBox[], events: toEvents(d.events), statement: SIGN_STATEMENT, verifyUrl: verifyUrl(),
  };
}

const signedName = (doc: Doc<"wsDocuments">) => `${docLabel(doc.number)} ${safeFileName(doc.title)} (signed).pdf`;

// ---------- the runner ----------

export const finish = internalAction({
  args: { documentId: v.id("wsDocuments"), steps: v.optional(v.array(v.string())) },
  handler: async (ctx, { documentId, steps }) => {
    const want = (steps ?? STEPS).filter((s): s is Step => (STEPS as readonly string[]).includes(s));
    for (const step of want) {
      const d = await loadData(ctx, documentId);
      if (!d || d.doc.status !== "completed") return null;
      if (step !== "pdf" && !d.doc.final) return null; // nothing to send or file without the signed copy
      try {
        if (step === "pdf") await makePdf(ctx, d);
        else if (step === "invoice") await makeInvoice(ctx, d);
        else if (step === "copies") await sendCopies(ctx, d);
        else await ctx.runAction(internal.wsArchive.archiveDocument, { documentId });
      } catch (e) {
        await ctx.runMutation(internal.signDone.stepFailed, { documentId, step, error: errText(e) });
        if (step === "pdf") return null;
      }
    }
    return null;
  },
});

export const stepFailed = internalMutation({
  args: { documentId: v.id("wsDocuments"), step: v.string(), error: v.string() },
  handler: async (ctx, { documentId, step, error }) => {
    const doc = await ctx.db.get(documentId);
    if (!doc) return null;
    const now = Date.now();
    if (step === "pdf") await ctx.db.patch(documentId, { finishError: error });
    else if (step === "invoice") await ctx.db.patch(documentId, { invoice: { status: "failed", at: now, error } });
    else if (step === "copies") await ctx.db.patch(documentId, { copies: { status: "failed", at: now, sent: doc.copies?.sent ?? [], failed: doc.copies?.failed ?? [] } });
    else await ctx.db.patch(documentId, { archive: { status: "failed", at: now, error } });
    await appendEvent(ctx, documentId, { kind: `${step}_failed`, actor: "system", versionNumber: doc.sentVersion, detail: `${{ pdf: "Making the signed copy", invoice: "Drafting the Stripe invoice", copies: "Emailing the signed copies", archive: "Archiving to Dropbox" }[step] ?? step} failed: ${error}` });
    return null;
  },
});

// Heston can re-run any step from the document page (each one skips what's already done).
export const retry = mutation({
  args: { documentId: v.id("wsDocuments"), step: v.union(v.literal("pdf"), v.literal("invoice"), v.literal("copies"), v.literal("archive")) },
  handler: async (ctx, { documentId, step }) => {
    await requireMe(ctx);
    const doc = await ctx.db.get(documentId);
    if (!doc || doc.status !== "completed") throw new ConvexError("Only a document everyone has signed.");
    if (step !== "pdf" && !doc.final) throw new ConvexError("Make the signed copy first.");
    // Making the PDF again re-runs everything after it that hasn't happened yet.
    await ctx.scheduler.runAfter(0, internal.signDone.finish, { documentId, steps: step === "pdf" ? [...STEPS] : [step] });
    return null;
  },
});

// ---------- 1. the signed PDF ----------

async function makePdf(ctx: ActionCtx, d: Data) {
  if (d.doc.final) return;
  const input = await finalInput(ctx, d);
  const original = await bytesOf(ctx, d.ver.fileId);
  if ((await sha256Bytes(original)) !== d.ver.fileSha256) throw new Error("The stored original no longer matches its hash. Stopped: nothing was stamped.");
  const out = await stamp(original, finalStamps(input.boxes, input.owner, input.signers), certificate(input));
  const sha = await sha256Bytes(out);
  const fileId = await ctx.storage.store(new Blob([new Uint8Array(out)], { type: "application/pdf" }));
  const kept = await ctx.runMutation(internal.signDone.recordPdf, { documentId: d.doc._id, fileId, sha256: sha, bytes: out.length, fileName: signedName(d.doc) });
  if (!kept) await ctx.storage.delete(fileId); // another run got there first
}

export const recordPdf = internalMutation({
  args: { documentId: v.id("wsDocuments"), fileId: v.id("_storage"), sha256: v.string(), bytes: v.number(), fileName: v.string() },
  handler: async (ctx, a) => {
    const doc = (await ctx.db.get(a.documentId))!;
    if (doc.final) return false;
    await ctx.db.patch(a.documentId, { final: { fileId: a.fileId, sha256: a.sha256, bytes: a.bytes, fileName: a.fileName, at: Date.now() }, finishError: undefined, updatedAt: Date.now() });
    await appendEvent(ctx, a.documentId, { kind: "signed_copy_made", actor: "system", versionNumber: doc.sentVersion, detail: `The signed copy "${a.fileName}" was made (${Math.round(a.bytes / 1024)} KB), with every signature, initial, name and date stamped and the audit certificate appended. SHA-256 ${a.sha256}` });
    return true;
  },
});

// ---------- 2. the Stripe draft invoice ----------

async function stripe(key: string, method: "GET" | "POST", path: string, form?: Record<string, string>, idem?: string) {
  if (/(^|\/)(finalize|send|pay|void|mark_uncollectible)(\?|$)/.test(path)) throw new Error("Refused: Wrangler Sign never finalizes, sends or pays an invoice.");
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}), ...(idem ? { "Idempotency-Key": idem } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${String(j.error?.message ?? "").slice(0, 160)}`);
  return j;
}

async function makeInvoice(ctx: ActionCtx, d: Data) {
  const { doc, ver, signings } = d;
  if (doc.invoice?.status === "created" || doc.invoice?.status === "none") return;
  const pay = ver.payment;
  if (!pay) { await ctx.runMutation(internal.signDone.recordInvoice, { documentId: doc._id, status: "none" }); return; }
  const key = process.env.STRIPE_SIGN_KEY;
  if (!key) throw new Error("STRIPE_SIGN_KEY isn't set in Convex.");
  const billTo = signings[0];
  if (!billTo) throw new Error("No client to bill.");
  const label = docLabel(doc.number);
  const meta = { "metadata[ws_doc]": label, "metadata[ws_document_id]": doc._id, "metadata[ws_version]": String(ver.number) };
  // Security review (Oct 27): Stripe's email filter is case-sensitive and its idempotency keys last 24 hours, so a
  // retry could make a second customer or a second draft. Search (case-insensitive) finds the customer, and a draft
  // already made for this document and version is reused rather than made again.
  const q = (x: string) => x.replace(/["\\]/g, "");
  const found = await stripe(key, "GET", `customers/search?${new URLSearchParams({ query: `email:"${q(billTo.email)}"`, limit: "10" })}`);
  const match = (found.data as Array<{ id: string; email?: string | null }> | undefined)?.find((c) => (c.email ?? "").toLowerCase() === billTo.email.toLowerCase());
  const customer = match?.id ?? (await stripe(key, "POST", "customers", { name: billTo.name, email: billTo.email, ...meta }, `ws-cust-${doc._id}`)).id as string;
  const earlier = await stripe(key, "GET", `invoices/search?${new URLSearchParams({ query: `metadata["ws_document_id"]:"${q(doc._id)}" AND metadata["ws_version"]:"${ver.number}"`, limit: "10" })}`);
  const prior = (earlier.data as Array<Record<string, any>> | undefined) ?? [];
  if (prior.some((x) => x.status !== "draft")) throw new Error(`Stripe already has a finalized invoice for this document (${prior.find((x) => x.status !== "draft")!.id}). Check it in Stripe.`);
  const inv = prior[0] ?? await stripe(key, "POST", "invoices", {
    customer, collection_method: "send_invoice", days_until_due: String(Math.max(0, Number(process.env.WS_INVOICE_DUE_DAYS ?? 3) || 0)), auto_advance: "false",
    description: `${pay.description} (${label}, "${doc.title}")`, ...meta,
  }, `ws-inv-${doc._id}-v${ver.number}`);
  if (!prior[0] || Number(prior[0].total ?? 0) === 0) await stripe(key, "POST", "invoiceitems", { customer: (inv.customer as string) ?? customer, invoice: inv.id, amount: String(pay.amountCents), currency: "usd", description: pay.description, ...meta }, `ws-item-${doc._id}-v${ver.number}`);
  const check = await stripe(key, "GET", `invoices/${inv.id}`);
  if (check.status !== "draft") throw new Error(`Stripe says the invoice is "${check.status}", not a draft. Check it in Stripe.`);
  const url = `https://dashboard.stripe.com/${check.livemode ? "" : "test/"}invoices/${inv.id}`;
  await ctx.runMutation(internal.signDone.recordInvoice, { documentId: doc._id, status: "created", id: inv.id, url, amountCents: Number(check.total ?? pay.amountCents), livemode: !!check.livemode, billTo: `${billTo.name} (${billTo.email})` });
}

export const recordInvoice = internalMutation({
  args: { documentId: v.id("wsDocuments"), status: v.union(v.literal("created"), v.literal("none")), id: v.optional(v.string()), url: v.optional(v.string()), amountCents: v.optional(v.number()), livemode: v.optional(v.boolean()), billTo: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const doc = (await ctx.db.get(a.documentId))!;
    if (doc.invoice?.status === "created") return null;
    await ctx.db.patch(a.documentId, { invoice: { status: a.status, at: Date.now(), ...(a.id ? { id: a.id, url: a.url, amountCents: a.amountCents, livemode: a.livemode } : {}) } });
    if (a.status === "created") await appendEvent(ctx, a.documentId, { kind: "invoice_drafted", actor: "system", versionNumber: doc.sentVersion, detail: `Draft invoice ${a.id} for ${money(a.amountCents ?? 0)} to ${a.billTo} created in Stripe${a.livemode ? "" : " (test mode)"}. Not finalized or sent.` });
    return null;
  },
});

// ---------- 3. the copies ----------

async function sendCopies(ctx: ActionCtx, d: Data) {
  const ownerEmail = (await ctx.runQuery(internal.business.contact, {})).ownerEmail;
  const { doc, signings } = d;
  const final = doc.final!;
  const bytes = await bytesOf(ctx, final.fileId);
  if ((await sha256Bytes(bytes)) !== final.sha256) throw new Error("The stored signed copy doesn't match its hash. Stopped: nothing was sent.");
  const attachment = [{ filename: final.fileName, content: b64(bytes) }];
  const label = docLabel(doc.number);
  const owner = d.owner;
  const signedBy = [
    ...signings.map((s) => `${s.adopted?.name ?? s.name}, ${s.signedDate ?? (s.signedAt ? centralDate(s.signedAt) : "")}`),
    ...(owner && d.ver.ownerSignedAt ? [`${owner.name}, ${owner.title}, Wrangler Productions, ${centralDate(d.ver.ownerSignedAt)}`] : []),
  ];
  const already = new Set(doc.copies?.sent ?? []);
  const people = [...signings.map((s) => ({ email: s.email, name: s.name, owner: false })), { email: ownerEmail, name: "Heston", owner: true }].filter((p, i, a) => a.findIndex((x) => x.email === p.email) === i);
  const sent: string[] = [], failed: string[] = [];
  for (const p of people) {
    if (already.has(p.email)) continue;
    const first = p.name.split(" ")[0] || "there";
    const fingerprint = `The attached PDF ends with a certificate listing every step. Its SHA-256 fingerprint is:\n${final.sha256}\n\nTo check a copy later, open ${verifyUrl()} and choose the file.`;
    const text = p.owner
      ? `Everyone has signed "${doc.title}" (${label}). The signed copy is attached, and a copy went to every signer.\n\nSigned by:\n${signedBy.map((x) => `- ${x}`).join("\n")}\n\n${fingerprint}\n\nOpen it: ${SITE()}/sign/d/${doc._id}${doc.invoice?.status === "created" ? `\n\nDraft invoice for ${money(doc.invoice.amountCents ?? 0)}${doc.invoice.livemode ? "" : " (Stripe test mode)"}, ready for you to review and send: ${doc.invoice.url}` : doc.invoice?.status === "failed" ? `\n\nThe Stripe draft invoice couldn't be made: ${doc.invoice.error}. Retry it from the document page.` : ""}`
      : `Hi ${first},\n\nEveryone has signed "${doc.title}" (${label}). Your signed copy is attached.\n\nSigned by:\n${signedBy.map((x) => `- ${x}`).join("\n")}\n\n${fingerprint}\n\nPlease keep this email for your records. Questions? Reply to this email.\n\nWrangler Productions, a DBA of Hill Creative LLC · sign.wranglerportal.com`;
    try {
      await sendEmail({ from: SIGN_FROM(), to: p.email, replyTo: p.owner ? null : ownerEmail, subject: `Signed: ${doc.title} (${label})`, text, tag: p.owner ? "ws-copy-owner" : "ws-copy", attachments: attachment });
      sent.push(p.email);
    } catch (e) { failed.push(`${p.email}: ${errText(e).slice(0, 100)}`); }
  }
  await ctx.runMutation(internal.signDone.recordCopies, { documentId: doc._id, sent, failed, sha256: final.sha256 });
}

export const recordCopies = internalMutation({
  args: { documentId: v.id("wsDocuments"), sent: v.array(v.string()), failed: v.array(v.string()), sha256: v.string() },
  handler: async (ctx, { documentId, sent, failed, sha256 }) => {
    const doc = (await ctx.db.get(documentId))!;
    const all = [...new Set([...(doc.copies?.sent ?? []), ...sent])];
    await ctx.db.patch(documentId, { copies: { status: failed.length ? (all.length ? "partial" : "failed") : "sent", at: Date.now(), sent: all, failed } });
    for (const e of sent) await appendEvent(ctx, documentId, { kind: "copy_emailed", actor: "system", versionNumber: doc.sentVersion, email: e, detail: `The signed copy (SHA-256 ${sha256}) was emailed to ${e}.` });
    for (const f of failed) await appendEvent(ctx, documentId, { kind: "copy_failed", actor: "system", versionNumber: doc.sentVersion, detail: `Emailing the signed copy failed: ${f}` });
    return null;
  },
});

// ---------- the record, as JSON (archive and download) ----------

export async function auditJson(ctx: ActionCtx, documentId: Id<"wsDocuments">): Promise<{ json: string; name: string; year: number }> {
  const d = await loadData(ctx, documentId);
  if (!d || !d.doc.final) throw new Error("There's no signed copy yet.");
  const input = await finalInput(ctx, d);
  const chain = await verifyChain(d.events);
  const out = { ...auditExport({ ...input, finalSha256: d.doc.final.sha256, finalBytes: d.doc.final.bytes, finalFileName: d.doc.final.fileName, boxesFull: input.boxes, exportedAt: Date.now() }), documentId, chain };
  const year = new Date(d.doc.completedAt ?? Date.now()).toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric" });
  return { json: JSON.stringify(out, null, 2), name: `${docLabel(d.doc.number)} ${safeFileName(d.doc.title)} (audit).json`, year: Number(year) };
}

export const downloadAudit = action({
  args: { documentId: v.id("wsDocuments") },
  handler: async (ctx, { documentId }): Promise<{ json: string; name: string }> => {
    await ctx.runQuery(internal.users.assertAllowed, { ids: [documentId] });
    try { const r = await auditJson(ctx, documentId); return { json: r.json, name: r.name }; }
    catch (e) { throw new ConvexError(errText(e)); }
  },
});

// ---------- the public check ----------

export const lookupHash = internalQuery({
  args: { sha256: v.string() },
  handler: async (ctx, { sha256 }) => {
    const doc = await ctx.db.query("wsDocuments").withIndex("by_final_sha", (q) => q.eq("final.sha256", sha256)).first();
    if (!doc || !doc.final) return null;
    const signings = await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", doc._id).eq("versionNumber", doc.sentVersion!)).collect();
    const ver = (await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", doc._id).eq("number", doc.sentVersion!)).unique())!;
    const owner = ver.ownerSignatureId ? await ctx.db.get(ver.ownerSignatureId) : null;
    return {
      label: docLabel(doc.number), title: doc.title, completed: centralDate(doc.completedAt ?? doc.final.at),
      signers: [...signings.sort((a, b) => a.order - b.order).map((s) => s.adopted?.name ?? s.name), ...(owner ? [`${owner.name} (Wrangler Productions)`] : [])],
    };
  },
});

export const verifyHttp = httpAction(async (ctx, req) => {
  const h = { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders(req) };
  let sha = "";
  try { sha = String(((await req.json()) as { sha256?: unknown }).sha256 ?? "").toLowerCase(); } catch { /* bad body */ }
  if (!/^[0-9a-f]{64}$/.test(sha)) return new Response(JSON.stringify({ error: "That isn't a SHA-256 fingerprint." }), { status: 400, headers: h });
  const m = await ctx.runQuery(internal.signDone.lookupHash, { sha256: sha });
  return new Response(JSON.stringify(m ? { match: true, ...m } : { match: false }), { headers: h });
});
