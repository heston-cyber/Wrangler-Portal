// Wrangler Portal Phase 1 (Oct 29): the client's Documents. Everything sent to their email through Sign, in three
// tabs: to sign, signed (with the signed copy), cancelled. The portal only lists and links: "Sign" opens today's
// signing page with the same emailed code, consent and steps (rule 9). Nothing here signs anything.
import { v, ConvexError } from "convex/values";
import { query } from "./lib/functions";
import { requireSignedIn } from "./lib/access";
import { signLink } from "./lib/wsSigning";
import { docLabel } from "./lib/wsLayout";

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return { toSign: [], signed: [], cancelled: [] };
    const signings = await ctx.db.query("wsSignings").withIndex("by_email", (q) => q.eq("email", me.email)).collect();
    const byDoc = new Map<string, (typeof signings)[number]>();
    for (const s of signings) {
      const cur = byDoc.get(s.documentId);
      if (!cur || s.versionNumber > cur.versionNumber) byDoc.set(s.documentId, s);
    }
    const toSign = [], signed = [], cancelled = [];
    for (const s of byDoc.values()) {
      const d = await ctx.db.get(s.documentId);
      if (!d || d.status === "draft" || d.status === "approved") continue; // never sent: not theirs to see yet
      if (s.versionNumber !== d.sentVersion && d.status !== "voided") continue; // an older version they were sent
      const ver = (await ctx.db.query("wsVersions").withIndex("by_document", (q) => q.eq("documentId", d._id)).collect()).find((x) => x.number === s.versionNumber);
      const all = (await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", d._id)).collect()).filter((x) => x.versionNumber === s.versionNumber);
      const row = { documentId: d._id, label: docLabel(d.number), title: d.title, sentAt: d.sentAt ?? null, pages: ver?.pages.length ?? null, signers: all.filter((x) => x.status === "signed").map((x) => x.name) };
      if (d.status === "voided") cancelled.push({ ...row, cancelledAt: d.voidedAt ?? null, reason: d.voidReason ?? null });
      else if (d.status === "completed") signed.push({ ...row, signedAt: s.signedAt ?? null, completedAt: d.completedAt ?? null, hasCopy: !!d.final });
      else if (s.status === "signed") signed.push({ ...row, signedAt: s.signedAt ?? null, completedAt: null, hasCopy: false }); // waiting on others
      else if (s.status === "sent" || s.status === "waiting") {
        const expired = !!d.expiresAt && d.expiresAt < Date.now();
        toSign.push({ ...row, expiresAt: d.expiresAt ?? null, expired, waiting: s.status === "waiting", signUrl: s.status === "sent" && !expired ? signLink(s.token) : null });
      }
    }
    const desc = (a: { sentAt: number | null }, b: { sentAt: number | null }) => (b.sentAt ?? 0) - (a.sentAt ?? 0);
    return { toSign: toSign.sort(desc), signed: signed.sort(desc), cancelled: cancelled.sort(desc) };
  },
});

/** The signed copy, for a signer of a completed document. */
export const signedCopy = query({
  args: { documentId: v.id("wsDocuments") },
  handler: async (ctx, { documentId }) => {
    const me = await requireSignedIn(ctx);
    const d = await ctx.db.get(documentId);
    if (!d || d.status !== "completed" || !d.final) throw new ConvexError("Not allowed.");
    const mine = (await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", documentId)).collect()).some((s) => s.email === me.email && s.versionNumber === d.sentVersion);
    if (!mine && me.kind !== "owner") throw new ConvexError("Not allowed.");
    return { url: await ctx.storage.getUrl(d.final.fileId), fileName: d.final.fileName };
  },
});
