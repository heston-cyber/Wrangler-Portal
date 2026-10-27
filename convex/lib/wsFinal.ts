// Wrangler Sign, Phase S3 (Oct 27): what goes into the signed copy. Pure functions, shared by the backend and tests.
//   finalStamps   every box filled with what its signer adopted (signature, initials, name, title, date)
//   certificate   the audit certificate appended to the signed copy
//   auditExport   the same record as JSON, for the archive
import type { Stamp } from "./wsPdf";
import type { LayoutBox } from "./wsLayout";
import { OWNER_KEY } from "./wsLayout";
import { centralStamp } from "./wsSigning";

export type FinalSigner = {
  key: string; name: string; email: string; title: string | null;
  adoptedName: string; adoptedTitle: string | null; method: string;
  signaturePng: Uint8Array; initialsPng: Uint8Array; signatureSha256: string; initialsSha256: string;
  signedAt: number; signedDate: string; ip: string | null; userAgent: string | null;
  verifiedAt: number | null; consentAt: number | null; consentVersion: string | null; adoptedAt: number | null;
  initialed: string[]; viewedPages: number[];
};

export type FinalEvent = { documentId: string; seq: number; at: number; kind: string; actor: string; versionNumber?: number; email?: string; ip?: string; userAgent?: string; detail?: string; prevHash: string; hash: string };

export type FinalInput = {
  label: string; title: string; company: string; versionNumber: number;
  fileName: string; fileSha256: string; lockHash: string; pages: number;
  sentAt: number | null; completedAt: number; signingOrder: string;
  owner: FinalSigner | null; // Heston, when he signs the document too
  signers: FinalSigner[];    // the clients, in order
  boxes: LayoutBox[];
  events: FinalEvent[];
  statement: string;
  verifyUrl: string;
};

/** Every box gets its signer's mark. A box with nothing to put in it is an error: the copy would look unsigned. */
export function finalStamps(boxes: LayoutBox[], owner: FinalSigner | null, signers: FinalSigner[]): Stamp[] {
  const by = new Map<string, FinalSigner>(signers.map((s) => [s.key, s]));
  if (owner) by.set(OWNER_KEY, owner);
  return boxes.map((b): Stamp => {
    const s = by.get(b.signer);
    if (!s) throw new Error(`Box ${b.id} belongs to "${b.signer}", who hasn't signed.`);
    const cover = b.cover;
    switch (b.kind) {
      case "sign": return { box: b, cover, kind: "image", png: s.signaturePng };
      case "initials":
        if (b.signer !== OWNER_KEY && !s.initialed.includes(b.id)) throw new Error(`${s.name} didn't initial box ${b.id}.`);
        return { box: b, cover, kind: "image", png: s.initialsPng };
      case "name": return { box: b, cover, kind: "text", text: s.adoptedName };
      case "title": return { box: b, cover, kind: "text", text: s.adoptedTitle ?? s.title ?? "" };
      case "date": return { box: b, cover, kind: "text", text: s.signedDate };
    }
  });
}

/** A short, readable name for a browser ("Safari on iPhone"); the full string is in the event list. */
export function deviceName(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  const br = /Edg\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null;
  return [br, os].filter(Boolean).join(" on ") || null;
}

const t = (ms: number | null | undefined) => (ms ? centralStamp(ms) : "—");

export function certificate(d: FinalInput): string[] {
  const L: string[] = [];
  L.push("# Certificate of completion");
  L.push(`${d.label} · "${d.title}" · version ${d.versionNumber}`);
  L.push(`${d.company}. Signed electronically with Wrangler Sign (sign.wranglerportal.com).`);
  L.push("");
  L.push("## The document");
  L.push(`Original file: ${d.fileName} (${d.pages} page${d.pages === 1 ? "" : "s"}).`);
  L.push(`SHA-256 of the original file, as approved and shown to every signer: ${d.fileSha256}`);
  L.push(`Lock hash (the file plus every box, signer and payment setting, fixed at approval): ${d.lockHash}`);
  L.push(`Sent: ${t(d.sentAt)}. Completed: ${t(d.completedAt)}. Signing order: ${d.signingOrder === "sequence" ? "one after another" : "any order"}.`);
  L.push("The SHA-256 of this signed copy can't be printed inside the copy itself. It is in the audit trail, in the email that delivered this copy, and anyone can check a copy at " + d.verifyUrl + ".");
  L.push("");
  L.push("## Signers");
  const who = (s: FinalSigner, isOwner: boolean) => {
    L.push(`${s.adoptedName}${s.adoptedTitle ? `, ${s.adoptedTitle}` : ""} · ${s.email}${isOwner ? " · sender" : ""}`);
    if (isOwner) {
      L.push(`Signed when sending: ${t(s.signedAt)}, signed in to the owner's Wrangler account. Signature adopted ${t(s.adoptedAt)} (${s.method}).`);
    } else {
      L.push(`Email confirmed with a one-time code sent to ${s.email}: ${t(s.verifiedAt)}.`);
      L.push(`Agreed to sign electronically: ${t(s.consentAt)} (disclosure ${s.consentVersion ?? "—"}).`);
      L.push(`Signature adopted (${s.method}): ${t(s.adoptedAt)}. Pages viewed: ${s.viewedPages.length ? [...s.viewedPages].sort((a, b) => a - b).map((p) => p + 1).join(", ") : "—"} of ${d.pages}.`);
      L.push(`Signed: ${t(s.signedAt)} from IP ${s.ip ?? "unknown"}${deviceName(s.userAgent) ? ` (${deviceName(s.userAgent)})` : ""}, after agreeing: "${d.statement}"`);
    }
    L.push(`Signature image SHA-256 ${s.signatureSha256}; initials image SHA-256 ${s.initialsSha256}.`);
    L.push("");
  };
  if (d.owner) who(d.owner, true);
  for (const s of d.signers) who(s, false);
  L.push("## Event log");
  L.push("Every event, in order. Each entry's hash covers the one before it, so changing or removing any entry breaks every hash after it. Times are US Central.");
  L.push("");
  for (const e of d.events) {
    const extra = [e.email, e.ip ? `IP ${e.ip}` : null, e.userAgent ? (deviceName(e.userAgent) ?? e.userAgent) : null].filter(Boolean).join(" · ");
    L.push(`${e.seq}. ${t(e.at)} · ${e.actor} · ${e.kind}${extra ? ` · ${extra}` : ""}`);
    if (e.detail) L.push(`    ${e.detail}`);
  }
  const last = d.events[d.events.length - 1];
  L.push("");
  L.push(`Chain: ${d.events.length} events, last hash ${last?.hash ?? "—"}.`);
  return L;
}

/** The archive copy of the record: everything needed to check the signed PDF and its trail without the app. */
export function auditExport(d: FinalInput & { finalSha256: string; finalBytes: number; finalFileName: string; boxesFull: LayoutBox[]; exportedAt: number }) {
  const s = (x: FinalSigner) => ({
    key: x.key, name: x.adoptedName, title: x.adoptedTitle, email: x.email, method: x.method,
    signedAt: x.signedAt ? new Date(x.signedAt).toISOString() : null, ip: x.ip, userAgent: x.userAgent,
    verifiedAt: x.verifiedAt ? new Date(x.verifiedAt).toISOString() : null, consentAt: x.consentAt ? new Date(x.consentAt).toISOString() : null, consentVersion: x.consentVersion,
    signatureSha256: x.signatureSha256, initialsSha256: x.initialsSha256, initialed: x.initialed, viewedPages: x.viewedPages,
  });
  return {
    format: "wrangler-sign-audit/1",
    exportedAt: new Date(d.exportedAt).toISOString(),
    document: { label: d.label, title: d.title, company: d.company, version: d.versionNumber, signingOrder: d.signingOrder },
    original: { fileName: d.fileName, sha256: d.fileSha256, pages: d.pages, lockHash: d.lockHash },
    signed: { fileName: d.finalFileName, sha256: d.finalSha256, bytes: d.finalBytes, completedAt: new Date(d.completedAt).toISOString() },
    owner: d.owner ? s(d.owner) : null,
    signers: d.signers.map(s),
    boxes: d.boxesFull,
    statement: d.statement,
    events: d.events,
    chainCheck: "hash = SHA-256(prevHash + \"\\n\" + canonical JSON of {documentId, seq, at, kind, actor, versionNumber, email, ip, userAgent, detail}, absent fields left out); the first prevHash is 64 zeros.",
  };
}

/** A file name Dropbox and every OS accept. */
export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);

export function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
