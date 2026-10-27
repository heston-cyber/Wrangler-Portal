// Wrangler Sign, Phase S2 (Oct 27): the rules for a signer's link, shared by the backend and the tests.
import type { Doc } from "../_generated/dataModel";

export const SIGN_SITE = () => (process.env.SIGN_SITE_URL || "https://sign.wranglerportal.com").replace(/\/$/, "");
export const SIGN_FROM = () => process.env.SIGN_EMAIL_FROM || "Wrangler Productions <contracts@wranglerportal.com>";
export const signLink = (token: string) => `${SIGN_SITE()}/${token}`;

export const CODE_TTL = 10 * 60_000;           // a code works for 10 minutes
export const CODE_TRIES = 5;                   // wrong guesses before a code is used up
export const CODE_GAP = 45_000;                // at most one code email every 45 seconds
export const CODE_PER_HOUR = 6;
export const FAILS_BEFORE_LOCK = 10;           // wrong codes in an hour before a 15-minute lock
export const LOCK_FOR = 15 * 60_000;
export const FAILS_LIFETIME = 30;              // wrong codes over the link's whole life before it's locked for good
export const SIGNER_ACTIONS_PER_HOUR = 300;    // initials toggles and signature changes, per signer, per hour
export const SESSION_TTL = 2 * 3600_000;       // a verified page stays open 2 hours from its last action
export const OPEN_EVENT_GAP = 30 * 60_000;     // "opened" is logged at most every 30 minutes
export const DEFAULT_EXPIRY_DAYS = 30;

// The electronic-records disclosure every signer agrees to before signing. Its id is recorded with the consent, so
// the trail says exactly which wording they saw. Change the wording → change the id.
export const CONSENT_ID = "ws-consent-2026-10-27";
export const consentText = (company: string, contact: string) => [
  `${company} would like you to review and sign this document electronically.`,
  "By agreeing, you consent to receive, review and sign this document and its records electronically, and you agree that your electronic signature and initials have the same legal effect as signing by hand.",
  `You may ask for a paper copy at any time, at no charge, by emailing ${contact}.`,
  `You may withdraw this consent before you sign by closing this page and emailing ${contact}; the document can then be signed on paper. Withdrawing doesn't affect anything already signed.`,
  "To sign and keep a copy you need: a current web browser, the ability to open PDF files, and access to the email address this was sent to. You'll receive the signed PDF by email.",
  `If your email address changes, tell ${contact}.`,
];

export type LinkState =
  | { state: "voided" }
  | { state: "expired" }
  | { state: "superseded" }
  | { state: "signed" }
  | { state: "waiting"; before: string[] }
  | { state: "ready" };

/** What a signer's link can do right now. */
export function linkState(doc: Doc<"wsDocuments">, s: Doc<"wsSignings">, all: Doc<"wsSignings">[], now: number): LinkState {
  if (s.status === "signed") return { state: "signed" };
  if (doc.status === "voided" || s.status === "closed") return { state: "voided" };
  if (doc.sentVersion !== s.versionNumber || doc.currentVersion !== s.versionNumber) return { state: "superseded" };
  if (doc.status !== "sent") return { state: doc.status === "completed" ? "signed" : "voided" };
  if (doc.expiresAt && now > doc.expiresAt) return { state: "expired" };
  if (s.status === "waiting") return { state: "waiting", before: all.filter((x) => x.order < s.order && x.status !== "signed").map((x) => x.name) };
  return { state: "ready" };
}

export function maskEmail(e: string): string {
  const [user, domain] = e.split("@");
  if (!domain) return "your email";
  const u = user.length <= 2 ? user[0] + "…" : `${user[0]}${"…"}${user[user.length - 1]}`;
  return `${u}@${domain}`;
}

export const centralDate = (t: number) => new Date(t).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });
export const centralStamp = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });

/** A name or title a signer typed: one plain line. No control characters or line breaks (it goes into emails and
 *  the certificate), no invisible direction marks, and it can't start like a heading or list. */
export function cleanLine(x: unknown, max = 120): string {
  return String(x ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/\s+/g, " ").replace(/^[#>*\-+=_~`|\s]+/, "").trim().slice(0, max);
}
/** A name can't carry a link or a web address (it's shown to the other signers in emails from contracts@). */
export function hasLink(s: string, strict: boolean): boolean {
  if (/:\/\/|www\.|@/i.test(s)) return true;
  // "acme.com" in a name; a plain "Jr." or "Inc." isn't a domain.
  return strict && /[a-z0-9-]\.[a-z]{2,}/i.test(s.replace(/\b(?:jr|sr|st|dr|mr|mrs|ms|inc|llc|co|ltd|corp)\./gi, "$& "));
}

/** The caller's IP as Cloudflare saw it (Convex sits behind Cloudflare; S0 checked it can't be forged). */
export function callerIp(h: Headers): string | undefined {
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim().slice(0, 80);
  const xff = h.get("x-forwarded-for");
  return xff ? xff.split(",")[0].trim().slice(0, 80) : undefined;
}
