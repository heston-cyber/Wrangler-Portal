// Wrangler Sign — the client's side (Phase S2, Oct 27).
//
// A signer opens sign.wranglerportal.com/<token>. Everything they do goes through POST /ws/<op> on this backend
// (an HTTP action, so the caller's IP and browser are known and land in the audit trail):
//   open      what the link is (who it's from, the title, or why it doesn't work); logs "opened"
//   code      emails a 6-digit code to the address the document was sent to
//   verify    checks the code; returns a session for this page (only its hash is stored)
//   doc       the PDF, the boxes and what's done so far                                   (needs the session)
//   consent   agrees to sign electronically (the disclosure's id is recorded)              (needs the session)
//   viewed    a page was shown on screen                                                    (needs the session)
//   adopt     the signer's signature and initials (PNG images, made on the page)          (needs the session)
//   initial   initials one box (or takes them off before signing)                          (needs the session)
//   sign      the final, deliberate Sign                                                    (needs the session)
// Nothing here trusts the page: every rule (consent first, every initial, the signing order, expiry, a voided or
// replaced document) is checked again on the server, and every step is an event in the hash-chained trail.
import { httpAction, internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { appendEvent } from "./lib/wsAudit";
import { OWNER_KEY, docLabel, type LayoutBox } from "./lib/wsLayout";
import { sha256Bytes } from "./lib/wsPdf";
import { randomToken, sha256Hex } from "./lib/hash";
import { sendEmail, SITE, sixDigits } from "./lib/email";
import {
  CODE_GAP, CODE_PER_HOUR, CODE_TRIES, CODE_TTL, CONSENT_ID, FAILS_BEFORE_LOCK, LOCK_FOR, OPEN_EVENT_GAP, SESSION_TTL,
  SIGN_FROM, SIGN_SITE, callerIp, centralDate, consentText, linkState, maskEmail, signLink,
} from "./lib/wsSigning";
import { allowedEmails } from "./auth";

export const SIGN_STATEMENT = "By clicking Sign, I agree that my electronic signature and initials on this document are the legal equivalent of my handwritten signature and initials, and that I intend to sign it.";
export const COMPANY = "Wrangler Productions, a DBA of Hill Creative LLC";
export const contact = () => allowedEmails()[0] ?? "heston@wranglerproductions.com";
const MAX_PNG = 400 * 1024;

type Who = { ip?: string; userAgent?: string };
type Fail = { error: string; code?: string };

// ---------- the HTTP side ----------

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = new Set([SIGN_SITE(), SITE(), ...(process.env.SIGN_CORS_EXTRA ?? "").split(",").map((s) => s.trim()).filter(Boolean)].map((u) => new URL(u).origin));
  return allowed.has(origin) ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "600", Vary: "Origin" } : { Vary: "Origin" };
}
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...corsHeaders(req) } });

export const preflight = httpAction(async (_ctx, req) => new Response(null, { status: 204, headers: corsHeaders(req) }));

export const api = httpAction(async (ctx, req) => {
  const op = new URL(req.url).pathname.replace(/^\/ws\//, "").replace(/\/$/, "");
  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { return json(req, { error: "Bad request." }, 400); }
  const token = typeof body.token === "string" ? body.token.slice(0, 64) : "";
  const session = typeof body.session === "string" ? body.session.slice(0, 128) : undefined;
  const who: Who = { ip: callerIp(req.headers), userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300) || undefined };
  if (!token) return json(req, { error: "This link isn't complete." }, 400);
  try {
    switch (op) {
      case "open": return json(req, await ctx.runMutation(internal.signing.openLink, { token, session, ...who }));
      case "code": {
        const r = await ctx.runMutation(internal.signing.requestCode, { token, ...who });
        if ("error" in r) return json(req, r, 429);
        try {
          await sendEmail({
            from: SIGN_FROM(), to: r.email, replyTo: contact(), tag: "ws-code",
            subject: `${r.code} is your code to sign ${r.label}`,
            text: `Your code is ${r.code}\n\nEnter it on the signing page to open "${r.title}" from Wrangler Productions. It works for 10 minutes.\n\nIf you didn't ask for it, ignore this email: nothing happens without the code.\n\nWrangler Productions · sign.wranglerportal.com`,
          });
        } catch (e) {
          await ctx.runMutation(internal.signing.logEvent, { signingId: r.signingId, kind: "code_email_failed", detail: String((e as Error).message).slice(0, 200), ...who });
          return json(req, { error: "The code email couldn't be sent. Try again in a minute." }, 502);
        }
        return json(req, { sent: true, to: maskEmail(r.email) });
      }
      case "verify": return json(req, await ctx.runMutation(internal.signing.verifyCode, { token, code: String(body.code ?? "").replace(/\D/g, "").slice(0, 6), ...who }));
      case "doc": return json(req, await ctx.runMutation(internal.signing.docFor, { token, session: session ?? "" }));
      case "consent": return json(req, await ctx.runMutation(internal.signing.consent, { token, session: session ?? "", agreed: body.agreed === true, ...who }));
      case "viewed": return json(req, await ctx.runMutation(internal.signing.viewed, { token, session: session ?? "", page: Number(body.page) | 0, ...who }));
      case "initial": return json(req, await ctx.runMutation(internal.signing.initial, { token, session: session ?? "", boxId: String(body.boxId ?? "").slice(0, 40), on: body.on !== false, ...who }));
      case "adopt": {
        const name = String(body.name ?? "").trim().slice(0, 120), title = String(body.title ?? "").trim().slice(0, 120);
        const method = body.method === "drawn" ? "drawn" : "typed";
        const sig = decodePng(body.signature), ini = decodePng(body.initials);
        if (!sig || !ini) return json(req, { error: "The signature images didn't come through. Try again." }, 400);
        if (!name) return json(req, { error: "Type your full name." }, 400);
        const check = await ctx.runMutation(internal.signing.sessionOk, { token, session: session ?? "" });
        if (!check.ok) return json(req, { error: check.error, code: check.code }, 401);
        const signatureFileId = await ctx.storage.store(new Blob([new Uint8Array(sig)], { type: "image/png" }));
        const initialsFileId = await ctx.storage.store(new Blob([new Uint8Array(ini)], { type: "image/png" }));
        const r = await ctx.runMutation(internal.signing.adoptRecord, {
          token, session: session ?? "", name, title: title || undefined, method, signatureFileId, initialsFileId,
          signatureSha256: await sha256Bytes(sig), initialsSha256: await sha256Bytes(ini), ...who,
        });
        if ("error" in r) { await ctx.storage.delete(signatureFileId); await ctx.storage.delete(initialsFileId); }
        return json(req, r);
      }
      case "sign": return json(req, await ctx.runMutation(internal.signing.sign, { token, session: session ?? "", agreed: body.agreed === true, ...who }));
      default: return json(req, { error: "Unknown request." }, 404);
    }
  } catch (e) {
    console.error("ws", op, String((e as Error).message).slice(0, 200));
    return json(req, { error: "Something went wrong. Try again." }, 500);
  }
});

function decodePng(x: unknown): Uint8Array | null {
  if (typeof x !== "string" || x.length > MAX_PNG * 1.4) return null;
  const b64 = x.replace(/^data:image\/png;base64,/, "");
  let bin: string;
  try { bin = atob(b64); } catch { return null; }
  const b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return b.length > 8 && b.length <= MAX_PNG && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? b : null;
}

// ---------- shared checks ----------

async function load(ctx: MutationCtx, token: string) {
  const s = await ctx.db.query("wsSignings").withIndex("by_token", (q) => q.eq("token", token)).unique();
  if (!s) return null;
  const doc = (await ctx.db.get(s.documentId))!;
  const all = await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", s.documentId).eq("versionNumber", s.versionNumber)).collect();
  return { s, doc, all, state: linkState(doc, s, all, Date.now()) };
}

const STATE_MSG: Record<string, string> = {
  voided: "This document was cancelled by Wrangler Productions. The link no longer works.",
  expired: "This link has expired. Ask Wrangler Productions to send it again.",
  superseded: "There's a newer version of this document. Use the link in the most recent email.",
  signed: "You've already signed this document.",
  waiting: "It isn't your turn to sign yet. You'll get an email when it is.",
};

async function withSession(ctx: MutationCtx, token: string, session: string, opts: { allowSigned?: boolean } = {}): Promise<Fail | { s: Doc<"wsSignings">; doc: Doc<"wsDocuments">; all: Doc<"wsSignings">[] }> {
  const l = await load(ctx, token);
  if (!l) return { error: "This link doesn't go anywhere.", code: "missing" };
  const now = Date.now();
  if (!session || !l.s.sessionHash || !l.s.sessionExpiresAt || l.s.sessionExpiresAt < now || (await sha256Hex(`${token}:${session}`)) !== l.s.sessionHash) return { error: "For your security, confirm your email again.", code: "session" };
  if (l.state.state !== "ready" && !(opts.allowSigned && l.state.state === "signed")) return { error: STATE_MSG[l.state.state] ?? "This link can't be used.", code: l.state.state };
  await ctx.db.patch(l.s._id, { sessionExpiresAt: now + SESSION_TTL });
  return { s: l.s, doc: l.doc, all: l.all };
}

const ev = (ctx: MutationCtx, s: Doc<"wsSignings">, kind: string, who: Who, detail?: string) =>
  appendEvent(ctx, s.documentId, { kind, actor: `signer:${s.signerKey}`, versionNumber: s.versionNumber, email: s.email, ip: who.ip, userAgent: who.userAgent, detail });

const whoArgs = { ip: v.optional(v.string()), userAgent: v.optional(v.string()) };

// ---------- the ops ----------

export const openLink = internalMutation({
  args: { token: v.string(), session: v.optional(v.string()), ...whoArgs },
  handler: async (ctx, { token, session, ip, userAgent }) => {
    const l = await load(ctx, token);
    if (!l) return { state: "missing" as const, message: "This link doesn't go anywhere." };
    const now = Date.now();
    const base = { label: docLabel(l.doc.number), title: l.doc.title, from: "Heston Hill at Wrangler Productions", signer: l.s.name, email: maskEmail(l.s.email) };
    if (l.state.state !== "ready") {
      if (l.state.state === "waiting") return { ...base, state: "waiting" as const, before: l.state.before, message: STATE_MSG.waiting };
      return { ...base, state: l.state.state, message: STATE_MSG[l.state.state] };
    }
    if (!l.s.lastOpenEventAt || now - l.s.lastOpenEventAt > OPEN_EVENT_GAP) {
      await ctx.db.patch(l.s._id, { lastOpenEventAt: now, ...(l.s.openedAt ? {} : { openedAt: now }) });
      await ev(ctx, l.s, "opened", { ip, userAgent }, "Opened the signing link.");
    }
    const verified = !!(session && l.s.sessionHash && (l.s.sessionExpiresAt ?? 0) > now && (await sha256Hex(`${token}:${session}`)) === l.s.sessionHash);
    return { ...base, state: "ready" as const, verified, expiresAt: l.doc.expiresAt ?? null };
  },
});

export const requestCode = internalMutation({
  args: { token: v.string(), ...whoArgs },
  handler: async (ctx, { token, ip, userAgent }): Promise<Fail | { code: string; email: string; label: string; title: string; signingId: Id<"wsSignings"> }> => {
    const l = await load(ctx, token);
    if (!l) return { error: "This link doesn't go anywhere.", code: "missing" };
    if (l.state.state !== "ready") return { error: STATE_MSG[l.state.state] ?? "This link can't be used.", code: l.state.state };
    const now = Date.now();
    if (l.s.lockedUntil && l.s.lockedUntil > now) return { error: `Too many wrong codes. Try again after ${new Date(l.s.lockedUntil).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })}.`, code: "locked" };
    const sends = (l.s.codeSends ?? []).filter((t) => now - t < 3600_000);
    if (sends.length && now - sends[sends.length - 1] < CODE_GAP) return { error: "A code is on its way. Wait a moment before asking for another.", code: "wait" };
    if (sends.length >= CODE_PER_HOUR) return { error: "That's a lot of codes in one hour. Try again later.", code: "limit" };
    const code = sixDigits();
    await ctx.db.patch(l.s._id, { codeHash: await sha256Hex(`${token}:code:${code}`), codeExpiresAt: now + CODE_TTL, codeAttempts: 0, codeSends: [...sends, now] });
    await ev(ctx, l.s, "code_sent", { ip, userAgent }, `A 6-digit code was emailed to ${l.s.email}.`);
    return { code, email: l.s.email, label: docLabel(l.doc.number), title: l.doc.title, signingId: l.s._id };
  },
});

export const verifyCode = internalMutation({
  args: { token: v.string(), code: v.string(), ...whoArgs },
  handler: async (ctx, { token, code, ip, userAgent }): Promise<Fail | { session: string }> => {
    const l = await load(ctx, token);
    if (!l) return { error: "This link doesn't go anywhere.", code: "missing" };
    if (l.state.state !== "ready") return { error: STATE_MSG[l.state.state] ?? "This link can't be used.", code: l.state.state };
    const now = Date.now();
    const s = l.s;
    if (s.lockedUntil && s.lockedUntil > now) return { error: "Too many wrong codes. Wait 15 minutes, then ask for a new code.", code: "locked" };
    if (!s.codeHash || !s.codeExpiresAt) return { error: "Ask for a code first.", code: "nocode" };
    if (s.codeExpiresAt < now) return { error: "That code has expired. Ask for a new one.", code: "expired_code" };
    const good = code.length === 6 && (await sha256Hex(`${token}:code:${code}`)) === s.codeHash;
    if (!good) {
      const attempts = (s.codeAttempts ?? 0) + 1;
      const failures = [...(s.failures ?? []).filter((t) => now - t < 3600_000), now];
      const lock = failures.length >= FAILS_BEFORE_LOCK ? now + LOCK_FOR : undefined;
      await ctx.db.patch(s._id, { codeAttempts: attempts, failures, ...(attempts >= CODE_TRIES ? { codeHash: undefined, codeExpiresAt: undefined } : {}), ...(lock ? { lockedUntil: lock } : {}) });
      await ev(ctx, s, "code_failed", { ip, userAgent }, lock ? "Wrong code; the link is locked for 15 minutes." : attempts >= CODE_TRIES ? "Wrong code; that code is used up." : "Wrong code.");
      return { error: lock ? "Too many wrong codes. Wait 15 minutes, then ask for a new code." : attempts >= CODE_TRIES ? "That code is used up. Ask for a new one." : "That code isn't right. Check the email and try again.", code: lock ? "locked" : "wrong" };
    }
    const session = randomToken(32);
    await ctx.db.patch(s._id, { codeHash: undefined, codeExpiresAt: undefined, codeAttempts: 0, sessionHash: await sha256Hex(`${token}:${session}`), sessionExpiresAt: now + SESSION_TTL, ...(s.verifiedAt ? {} : { verifiedAt: now }) });
    await ev(ctx, s, "email_verified", { ip, userAgent }, `Entered the code sent to ${s.email}: the signer controls this email address.`);
    return { session };
  },
});

export const sessionOk = internalMutation({
  args: { token: v.string(), session: v.string() },
  handler: async (ctx, { token, session }) => {
    const r = await withSession(ctx, token, session);
    return "error" in r ? { ok: false as const, error: r.error, code: r.code } : { ok: true as const };
  },
});

export const docFor = internalMutation({
  args: { token: v.string(), session: v.string() },
  handler: async (ctx, { token, session }) => {
    const r = await withSession(ctx, token, session, { allowSigned: true });
    if ("error" in r) return r;
    const { s, doc, all } = r;
    const ver = (await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", doc._id).eq("number", s.versionNumber)).unique())!;
    const owner = ver.ownerSignatureId ? await ctx.db.get(ver.ownerSignatureId) : null;
    const byKey = new Map(all.map((x) => [x.signerKey, x]));
    const boxes = (ver.boxes as LayoutBox[]).map((b) => {
      const mine = b.signer === s.signerKey;
      const other = byKey.get(b.signer);
      return {
        id: b.id, kind: b.kind, page: b.page, x: b.x, y: b.y, w: b.w, h: b.h, cover: b.cover ?? null,
        who: mine ? "me" as const : b.signer === OWNER_KEY ? "heston" as const : "other" as const,
        otherName: !mine && b.signer !== OWNER_KEY ? other?.name ?? "Another signer" : null,
        otherSigned: !mine && b.signer !== OWNER_KEY ? other?.status === "signed" : null,
      };
    });
    return {
      label: docLabel(doc.number), title: doc.title, versionNumber: ver.number, fileSha256: ver.fileSha256, lockHash: ver.lockHash ?? "",
      fileUrl: await ctx.storage.getUrl(ver.fileId), fileName: ver.fileName, pages: ver.pages, boxes, expiresAt: doc.expiresAt ?? null,
      me: {
        name: s.name, title: s.title ?? null, email: maskEmail(s.email), consentAt: s.consentAt ?? null, initialed: s.initialed ?? [],
        adopted: s.adopted ? { name: s.adopted.name, title: s.adopted.title ?? null, method: s.adopted.method, signatureUrl: await ctx.storage.getUrl(s.adopted.signatureFileId), initialsUrl: await ctx.storage.getUrl(s.adopted.initialsFileId) } : null,
        signedAt: s.signedAt ?? null, signedDate: s.signedDate ?? null,
      },
      heston: ver.ownerSignedAt && owner ? { name: owner.name, title: owner.title, signedDate: centralDate(ver.ownerSignedAt), signatureUrl: await ctx.storage.getUrl(owner.signatureFileId), initialsUrl: await ctx.storage.getUrl(owner.initialsFileId) } : null,
      consent: { id: CONSENT_ID, lines: consentText(COMPANY, contact()) },
      statement: SIGN_STATEMENT,
      today: centralDate(Date.now()),
    };
  },
});

export const consent = internalMutation({
  args: { token: v.string(), session: v.string(), agreed: v.boolean(), ...whoArgs },
  handler: async (ctx, { token, session, agreed, ip, userAgent }) => {
    const r = await withSession(ctx, token, session);
    if ("error" in r) return r;
    if (!agreed) return { error: "Tick the box to agree first." };
    if (r.s.consentAt) return { ok: true };
    await ctx.db.patch(r.s._id, { consentAt: Date.now(), consentVersion: CONSENT_ID });
    await ev(ctx, r.s, "consent_given", { ip, userAgent }, `Agreed to sign electronically (disclosure ${CONSENT_ID}), and confirmed they can open and read the document.`);
    return { ok: true };
  },
});

export const viewed = internalMutation({
  args: { token: v.string(), session: v.string(), page: v.number(), ...whoArgs },
  handler: async (ctx, { token, session, page, ip, userAgent }) => {
    const r = await withSession(ctx, token, session, { allowSigned: true });
    if ("error" in r) return r;
    const ver = (await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", r.doc._id).eq("number", r.s.versionNumber)).unique())!;
    if (page < 0 || page >= ver.pages.length) return { error: "No such page." };
    const seen = r.s.viewedPages ?? [];
    if (seen.includes(page)) return { ok: true };
    await ctx.db.patch(r.s._id, { viewedPages: [...seen, page] });
    await ev(ctx, r.s, "page_viewed", { ip, userAgent }, `Viewed page ${page + 1} of ${ver.pages.length}.`);
    return { ok: true };
  },
});

export const adoptRecord = internalMutation({
  args: {
    token: v.string(), session: v.string(), name: v.string(), title: v.optional(v.string()), method: v.union(v.literal("typed"), v.literal("drawn")),
    signatureFileId: v.id("_storage"), initialsFileId: v.id("_storage"), signatureSha256: v.string(), initialsSha256: v.string(), ...whoArgs,
  },
  handler: async (ctx, a) => {
    const r = await withSession(ctx, a.token, a.session);
    if ("error" in r) return r;
    if (!r.s.consentAt) return { error: "Agree to sign electronically first." };
    const old = r.s.adopted;
    await ctx.db.patch(r.s._id, { adopted: { name: a.name, title: a.title, method: a.method, signatureFileId: a.signatureFileId, initialsFileId: a.initialsFileId, signatureSha256: a.signatureSha256, initialsSha256: a.initialsSha256, at: Date.now() } });
    if (old) { await ctx.storage.delete(old.signatureFileId); await ctx.storage.delete(old.initialsFileId); }
    await ev(ctx, r.s, old ? "signature_changed" : "signature_adopted", a, `Adopted a ${a.method} signature and initials as "${a.name}"${a.title ? `, ${a.title}` : ""} (signature image SHA-256 ${a.signatureSha256}, initials ${a.initialsSha256}).`);
    return { ok: true };
  },
});

export const initial = internalMutation({
  args: { token: v.string(), session: v.string(), boxId: v.string(), on: v.boolean(), ...whoArgs },
  handler: async (ctx, { token, session, boxId, on, ip, userAgent }) => {
    const r = await withSession(ctx, token, session);
    if ("error" in r) return r;
    if (!r.s.consentAt || !r.s.adopted) return { error: "Adopt your signature and initials first." };
    const ver = (await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", r.doc._id).eq("number", r.s.versionNumber)).unique())!;
    const box = (ver.boxes as LayoutBox[]).find((b) => b.id === boxId);
    if (!box || box.signer !== r.s.signerKey || box.kind !== "initials") return { error: "That isn't one of your initial boxes." };
    const done = new Set(r.s.initialed ?? []);
    if (on === done.has(boxId)) return { ok: true };
    if (on) done.add(boxId); else done.delete(boxId);
    await ctx.db.patch(r.s._id, { initialed: [...done] });
    await ev(ctx, r.s, on ? "initialed" : "initials_removed", { ip, userAgent }, `${on ? "Initialed" : "Took initials off"} the box on page ${box.page + 1}.`);
    return { ok: true };
  },
});

export const sign = internalMutation({
  args: { token: v.string(), session: v.string(), agreed: v.boolean(), ...whoArgs },
  handler: async (ctx, { token, session, agreed, ip, userAgent }) => {
    const r = await withSession(ctx, token, session);
    if ("error" in r) return r;
    const { s, doc, all } = r;
    if (!agreed) return { error: "Agree to the statement above the Sign button first." };
    if (!s.consentAt) return { error: "Agree to sign electronically first." };
    if (!s.adopted) return { error: "Adopt your signature and initials first." };
    const ver = (await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", doc._id).eq("number", s.versionNumber)).unique())!;
    const mine = (ver.boxes as LayoutBox[]).filter((b) => b.signer === s.signerKey);
    const missing = mine.filter((b) => b.kind === "initials" && !(s.initialed ?? []).includes(b.id));
    if (missing.length) return { error: `${missing.length} initial box${missing.length === 1 ? " is" : "es are"} still empty.` };
    if (!mine.some((b) => b.kind === "sign")) return { error: "This document has no signature box for you. Contact Wrangler Productions." };
    const now = Date.now();
    await ctx.db.patch(s._id, { status: "signed", signedAt: now, signedDate: centralDate(now), signIp: ip, signUserAgent: userAgent, sessionHash: undefined, sessionExpiresAt: undefined });
    await ev(ctx, s, "signed", { ip, userAgent }, `Signed version ${ver.number} as "${s.adopted.name}" (${s.adopted.method} signature, ${(s.initialed ?? []).length} initial${(s.initialed ?? []).length === 1 ? "" : "s"}) after agreeing: "${SIGN_STATEMENT}" Lock hash ${ver.lockHash}. File SHA-256 ${ver.fileSha256}.`);

    // Next in line (one after another), or done. When done, S3 takes over: the signed copy, the invoice draft, the
    // copies (Heston's is his "signed by everyone" email) and the archive (convex/signDone.ts).
    const rest = all.filter((x) => x._id !== s._id && x.status !== "signed");
    if (!rest.length) {
      await ctx.db.patch(doc._id, { status: "completed", completedAt: now, updatedAt: now });
      await appendEvent(ctx, doc._id, { kind: "all_signed", actor: "system", versionNumber: ver.number, detail: `Every signer has signed version ${ver.number}.` });
      await ctx.scheduler.runAfter(0, internal.signDone.finish, { documentId: doc._id });
      return { ok: true, complete: true };
    }
    await ctx.scheduler.runAfter(0, internal.signing.notifyOwner, { signingId: s._id, kind: "signed" });
    const waiting = rest.filter((x) => x.status === "waiting");
    if (waiting.length && !rest.some((x) => x.status === "sent")) {
      const next = Math.min(...waiting.map((x) => x.order));
      for (const x of waiting.filter((w) => w.order === next)) {
        await ctx.db.patch(x._id, { status: "sent", sentAt: now });
        await appendEvent(ctx, doc._id, { kind: "sent", actor: "system", versionNumber: ver.number, email: x.email, detail: `Signing link emailed to ${x.name} (${x.email}): their turn.` });
        await ctx.scheduler.runAfter(0, internal.signing.emailInvite, { signingId: x._id, kind: "invite" });
      }
    }
    await ctx.db.patch(doc._id, { updatedAt: now });
    return { ok: true, complete: false };
  },
});

export const logEvent = internalMutation({
  args: { signingId: v.id("wsSignings"), kind: v.string(), detail: v.optional(v.string()), ...whoArgs },
  handler: async (ctx, { signingId, kind, detail, ip, userAgent }) => {
    const s = await ctx.db.get(signingId);
    if (s) await ev(ctx, s, kind, { ip, userAgent }, detail);
    return null;
  },
});

// ---------- emails ----------

export const emailData = internalQuery({
  args: { signingId: v.id("wsSignings") },
  handler: async (ctx, { signingId }) => {
    const s = await ctx.db.get(signingId);
    if (!s) return null;
    const doc = (await ctx.db.get(s.documentId))!;
    const all = await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", s.documentId).eq("versionNumber", s.versionNumber)).collect();
    return { s, doc, label: docLabel(doc.number), all: all.map((x) => ({ name: x.name, status: x.status })) };
  },
});

export const emailInvite = internalAction({
  args: { signingId: v.id("wsSignings"), kind: v.union(v.literal("invite"), v.literal("reminder"), v.literal("voided")) },
  handler: async (ctx, { signingId, kind }) => {
    const d = await ctx.runQuery(internal.signing.emailData, { signingId });
    if (!d) return null;
    const { s, doc, label } = d;
    const until = doc.expiresAt ? centralDate(doc.expiresAt) : null;
    const text = kind === "voided"
      ? `Hi ${s.name.split(" ")[0] || "there"},\n\nHeston Hill at Wrangler Productions cancelled "${doc.title}" (${label}). The signing link you were sent no longer works, and there's nothing for you to do.${doc.voidReason ? `\n\nReason: ${doc.voidReason}` : ""}\n\nQuestions? Reply to this email.\n\nWrangler Productions`
      : `Hi ${s.name.split(" ")[0] || "there"},\n\n${kind === "reminder" ? "A reminder: " : ""}Heston Hill at Wrangler Productions sent you "${doc.title}" (${label}) to review and sign.\n\nReview and sign here:\n${signLink(s.token)}\n\nYou'll confirm this email address with a 6-digit code, read the document, add your initials where asked, and sign. It takes a few minutes on a phone or a computer.${until ? `\n\nThe link works until ${until}.` : ""}\n\nQuestions, or would you rather sign on paper? Reply to this email.\n\nWrangler Productions, a DBA of Hill Creative LLC · sign.wranglerportal.com`;
    const subject = kind === "voided" ? `Cancelled: ${doc.title} (${label})` : `${kind === "reminder" ? "Reminder: " : ""}Please sign: ${doc.title} (${label})`;
    try {
      await sendEmail({ from: SIGN_FROM(), to: s.email, replyTo: contact(), subject, text, tag: `ws-${kind}` });
      await ctx.runMutation(internal.signing.markEmailed, { signingId, kind, ok: true });
    } catch (e) {
      await ctx.runMutation(internal.signing.markEmailed, { signingId, kind, ok: false, error: String((e as Error).message).slice(0, 200) });
    }
    return null;
  },
});

export const markEmailed = internalMutation({
  args: { signingId: v.id("wsSignings"), kind: v.string(), ok: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, { signingId, kind, ok, error }) => {
    const s = await ctx.db.get(signingId);
    if (!s) return null;
    if (ok) await ctx.db.patch(signingId, { lastEmailAt: Date.now() });
    await appendEvent(ctx, s.documentId, { kind: ok ? "email_delivered_to_resend" : "email_failed", actor: "system", versionNumber: s.versionNumber, email: s.email, detail: ok ? `The ${kind} email was handed to the mail service for ${s.email}.` : `The ${kind} email to ${s.email} failed: ${error}` });
    return null;
  },
});

// Heston hears when someone signs. When everyone has, his copy of the signed PDF is that email (signDone.ts);
// "all_signed" stays for the rare case the copy can't be made.
export const notifyOwner = internalAction({
  args: { signingId: v.id("wsSignings"), kind: v.union(v.literal("signed"), v.literal("all_signed")) },
  handler: async (ctx, { signingId, kind }) => {
    const d = await ctx.runQuery(internal.signing.emailData, { signingId });
    if (!d) return null;
    const link = `${SITE()}/sign/d/${d.doc._id}`;
    const left = d.all.filter((x) => x.status !== "signed").map((x) => x.name);
    const text = kind === "all_signed"
      ? `Everyone has signed "${d.doc.title}" (${d.label}).\n\nOpen it: ${link}\n\n(The signed PDF and the copies to everyone come with Phase S3.)`
      : `${d.s.name} signed "${d.doc.title}" (${d.label}).${left.length ? `\n\nStill to sign: ${left.join(", ")}.` : ""}\n\nOpen it: ${link}`;
    try { await sendEmail({ from: SIGN_FROM(), to: contact(), replyTo: null, subject: kind === "all_signed" ? `Signed by everyone: ${d.doc.title} (${d.label})` : `${d.s.name} signed ${d.label}`, text, tag: `ws-owner-${kind}` }); } catch (e) { console.error("notifyOwner", String((e as Error).message).slice(0, 120)); }
    return null;
  },
});
