// D160 (Heston, Nov 6: "I need to be able to CC people on the contracts"; read-back answered 10:29): people copied on a
// contract. Chosen: an email when it's sent with a view-only link, the signed copy when everyone has signed, the
// cancellation if it's cancelled, no reminders; contracts only for now; built in the existing styles without frames.
// The signers' own email says who is copied. A copy link (/c/<token>) only reads: it never reaches the signing steps,
// which take wsSignings tokens only (rule 9: signing is unchanged).
import { internalAction, internalMutation, internalQuery, mutation, query, focusBusiness } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { appendEvent } from "./lib/wsAudit";
import { docLabel, OWNER_KEY } from "./lib/wsLayout";
import { randomToken } from "./lib/hash";
import { bump } from "./lib/rate";
import { sendEmail } from "./lib/email";
import { SIGN_SITE } from "./lib/wsSigning";
import { copiedCancelledMail, copiedMail } from "./lib/mails";

export const MAX_CC = 10;
export const copyLink = (token: string) => `${SIGN_SITE()}/c/${token}`;
export const ccArg = v.optional(v.array(v.object({ email: v.string(), name: v.optional(v.string()) })));
export type Cc = Array<{ email: string; name?: string }>;

const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

/** The CC list as it's kept: lower-case, real addresses, no signer twice, no repeats, at most 10. */
export function cleanCc(cc: Cc | undefined, signerEmails: string[]): Cc {
  const out: Cc = [];
  const signers = new Set(signerEmails.map((e) => e.trim().toLowerCase()));
  for (const c of cc ?? []) {
    const email = c.email.trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL.test(email) || email.length > 200) throw new ConvexError(`"${c.email.trim().slice(0, 60)}" isn't an email address.`);
    if (signers.has(email)) throw new ConvexError(`${email} already signs this document, so they get every email anyway.`);
    if (out.some((x) => x.email === email)) continue;
    const name = c.name?.replace(/[\r\n<>]+/g, " ").trim().slice(0, 120);
    out.push({ email, ...(name ? { name } : {}) });
  }
  if (out.length > MAX_CC) throw new ConvexError(`Copy ${MAX_CC} people at most.`);
  return out;
}

/** At send (sign.ts sendCore): one row and one email per copied person. */
export async function copyOnSend(ctx: MutationCtx, doc: Doc<"wsDocuments">, versionNumber: number, cc: Cc, actor: string) {
  const now = Date.now();
  for (const c of cc) {
    const copyId = await ctx.db.insert("wsCopies", { documentId: doc._id, versionNumber, email: c.email, ...(c.name ? { name: c.name } : {}), token: randomToken(18), sentAt: now, opens: 0 });
    await appendEvent(ctx, doc._id, { kind: "copied", actor, versionNumber, email: c.email, detail: `Copied${c.name ? `: ${c.name}` : ""} (${c.email}). A view-only link was emailed; they don't sign.` });
    await ctx.scheduler.runAfter(0, internal.signCopies.email, { copyId, kind: "sent" });
  }
}

/** At cancel (sign.ts voidCore): everyone copied who was emailed hears it was cancelled. */
export async function copiesOnVoid(ctx: MutationCtx, doc: Doc<"wsDocuments">) {
  if (!doc.sentVersion) return;
  for (const c of await copiesOf(ctx, doc._id, doc.sentVersion)) if (c.emailedAt) await ctx.scheduler.runAfter(0, internal.signCopies.email, { copyId: c._id, kind: "voided" });
}

export const copiesOf = (ctx: QueryCtx | MutationCtx, documentId: Id<"wsDocuments">, versionNumber: number) =>
  ctx.db.query("wsCopies").withIndex("by_document", (q) => q.eq("documentId", documentId).eq("versionNumber", versionNumber)).collect();

/** For the owner's document page: who is copied on the shown version. */
export async function copiesFor(ctx: QueryCtx, documentId: Id<"wsDocuments">, versionNumber: number) {
  return (await copiesOf(ctx, documentId, versionNumber)).map((c) => ({ _id: c._id, email: c.email, name: c.name ?? null, sentAt: c.sentAt, emailedAt: c.emailedAt ?? null, emailError: c.emailError ?? null, openedAt: c.openedAt ?? null, opens: c.opens }));
}

// ---------- emails ----------

export const emailData = internalQuery({
  args: { copyId: v.id("wsCopies") },
  handler: async (ctx, { copyId }) => {
    const c = await ctx.db.get(copyId);
    if (!c) return null;
    const doc = await ctx.db.get(c.documentId);
    if (!doc) return null;
    const signers = (await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", c.documentId).eq("versionNumber", c.versionNumber)).collect())
      .sort((a, b) => a.order - b.order).map((s) => `${s.name}${s.title ? `, ${s.title}` : ""}`);
    return { c, doc, label: docLabel(doc.number), signers };
  },
});

export const email = internalAction({
  args: { copyId: v.id("wsCopies"), kind: v.union(v.literal("sent"), v.literal("voided")) },
  handler: async (ctx, { copyId, kind }) => {
    const d = await ctx.runQuery(internal.signCopies.emailData, { copyId });
    if (!d) return null;
    const { c, doc, label } = d;
    if (kind === "sent" && doc.status !== "sent") return null; // cancelled before it went out
    const b = await ctx.runQuery(internal.business.mailBrand, { businessId: doc.businessId ?? null });
    const m = kind === "voided"
      ? copiedCancelledMail(b, { name: c.name ?? null, title: doc.title, label, reason: doc.voidReason ?? null })
      : copiedMail(b, { name: c.name ?? null, title: doc.title, label, signers: d.signers, link: copyLink(c.token) });
    try {
      await sendEmail({ from: m.from, to: c.email, replyTo: b.replyTo, subject: m.subject, text: m.text, html: m.html, tag: `ws-cc-${kind}` });
      await ctx.runMutation(internal.signCopies.markEmailed, { copyId, kind, ok: true });
    } catch (e) {
      await ctx.runMutation(internal.signCopies.markEmailed, { copyId, kind, ok: false, error: String((e as Error).message).slice(0, 200) });
    }
    return null;
  },
});

export const markEmailed = internalMutation({
  args: { copyId: v.id("wsCopies"), kind: v.string(), ok: v.boolean(), error: v.optional(v.string()) },
  handler: async (ctx, { copyId, kind, ok, error }) => {
    const c = await ctx.db.get(copyId);
    if (!c) return null;
    if (kind === "sent") await ctx.db.patch(copyId, ok ? { emailedAt: Date.now(), emailError: undefined } : { emailError: error });
    if (!ok) await appendEvent(ctx, c.documentId, { kind: "copy_email_failed", actor: "system", versionNumber: c.versionNumber, email: c.email, detail: `Emailing ${c.email} (copied) failed: ${error ?? "unknown error"}` });
    return null;
  },
});

// ---------- the copy link: view only ----------

async function byToken(ctx: QueryCtx | MutationCtx, token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  return ctx.db.query("wsCopies").withIndex("by_token", (q) => q.eq("token", token)).unique();
}

export const page = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const c = await byToken(ctx, token);
    if (!c) return null;
    focusBusiness(ctx, c.businessId);
    const doc = await ctx.db.get(c.documentId);
    if (!doc) return null;
    const b = c.businessId ? await ctx.db.get(c.businessId) : null;
    const business = { name: b?.name ?? "", accent: b?.accent ?? null, logoUrl: b?.logoFileId ? await ctx.storage.getUrl(b.logoFileId) : null, replyTo: b?.replyTo ?? null };
    const base = { business, title: doc.title, label: docLabel(doc.number), name: c.name ?? null };
    // Only the version this person was copied on, and only while it's live or once it's signed.
    if (doc.sentVersion !== c.versionNumber || doc.status === "voided" || doc.status === "draft" || doc.status === "approved") return { ...base, state: "cancelled" as const };
    if (doc.status === "sent" && doc.expiresAt && doc.expiresAt < Date.now()) return { ...base, state: "expired" as const };
    const signings = (await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", doc._id).eq("versionNumber", c.versionNumber)).collect()).sort((a, b) => a.order - b.order);
    const ver = await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", doc._id)).collect().then((vs) => vs.find((x) => x.number === c.versionNumber));
    const signed = doc.status === "completed" && doc.final;
    const fileUrl = signed ? await ctx.storage.getUrl(doc.final!.fileId) : ver ? await ctx.storage.getUrl(ver.fileId) : null;
    return {
      ...base, state: signed ? "signed" as const : "sent" as const, fileUrl, fileName: signed ? doc.final!.fileName : ver?.fileName ?? `${docLabel(doc.number)}.pdf`,
      completedAt: doc.completedAt ?? null, expiresAt: doc.expiresAt ?? null,
      signers: signings.map((s) => ({ name: s.name, title: s.title ?? null, signedAt: s.status === "signed" ? s.signedAt ?? null : null })),
      ownerSigns: !!ver?.signers.some((s) => s.key === OWNER_KEY),
    };
  },
});

/** The page opened (counted on the copy's row and in the trail once). */
export const opened = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const c = await byToken(ctx, token);
    if (!c) return null;
    focusBusiness(ctx, c.businessId);
    try { await bump(ctx as unknown as MutationCtx, "briefingLink", `copy:${token}`); } catch { return null; } // a page reloaded all hour stops counting
    const first = !c.openedAt;
    await ctx.db.patch(c._id, { opens: c.opens + 1, ...(first ? { openedAt: Date.now() } : {}) });
    if (first) await appendEvent(ctx, c.documentId, { kind: "copy_opened", actor: "system", versionNumber: c.versionNumber, email: c.email, detail: `${c.email} (copied) opened their view-only link.` });
    return null;
  },
});

/** When everyone has signed (signDone): who is copied on the signed version. */
export const forFinish = internalQuery({
  args: { documentId: v.id("wsDocuments"), versionNumber: v.number() },
  handler: async (ctx, { documentId, versionNumber }) => (await copiesOf(ctx, documentId, versionNumber)).map((c) => ({ email: c.email, name: c.name ?? null })),
});
