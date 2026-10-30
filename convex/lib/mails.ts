// Phase 1 step 5 (Oct 29): each approved email (page "S5 · Emails", numbers as drawn) as a pure function of its data.
// The wording is today's, with "Wrangler Review" now "WranglerPortal" and the business's own name where it was
// Wrangler's. Senders: review@ for Review and sign-in, contracts@ for Sign, updates@ for notes (Heston, Oct 29).
import { type Block, type MailBrand, clientFooter, fromLine, renderMail } from "./mail";
import { SITE, SITE_HOST } from "./site";

export type Mail = { from: string; subject: string; html: string; text: string };
const first = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "";
const hi = (name: string | null | undefined): Block => ({ t: "p", text: first(name) ? `Hi ${first(name)},` : "Hi," });
/** "Heston at Wrangler Productions" (or just the business when no owner name is set). */
const byline = (b: MailBrand, full = false) => (b.ownerName ? `${full ? b.ownerName : first(b.ownerName)} at ${b.name}` : b.name);
const SIGN_HOST = "sign.wranglerportal.com";
const mk = (b: MailBrand, address: "review" | "contracts" | "updates", subject: string, blocks: Block[], footer: Block[], preheader?: string): Mail =>
  ({ from: fromLine(b, address), subject, ...renderMail(b, blocks, { footer, preheader }) });

// ---------- 01 · 02: sign-in code and password reset ----------
export function signInCodeMail(b: MailBrand, d: { code: string; minutes: number }): Mail {
  return mk(b, "review", `${d.code} is your WranglerPortal code`, [
    { t: "p", text: "Your code is" }, { t: "code", code: d.code },
    { t: "p", text: `It works for ${d.minutes} minutes.` },
    { t: "p", text: "Enter it on the page where you were signing in." },
    { t: "small", text: "If you didn't ask for it, ignore this email." },
  ], [{ t: "small", text: `WranglerPortal · ${SITE_HOST()}` }], `It works for ${d.minutes} minutes.`);
}
export function resetMail(b: MailBrand, d: { code: string; minutes: number }): Mail {
  return mk(b, "review", "Reset your WranglerPortal password", [
    { t: "p", text: "Someone asked to reset the password for this email on WranglerPortal. Your reset code is" }, { t: "code", code: d.code },
    { t: "p", text: `It works for ${d.minutes} minutes.` },
    { t: "small", text: "If that wasn't you, ignore this email and nothing changes." },
  ], [{ t: "small", text: `WranglerPortal · ${SITE_HOST()}` }]);
}

// ---------- 03: share invite (and the portal invite, which uses its layout) ----------
export function shareInviteMail(b: MailBrand, d: { kind: string; label: string; sub: string | null; access: string; hasAccount: boolean; name: string | null; link: string }): Mail {
  const what = d.kind === "client" ? `everything for ${d.label}` : d.kind === "project" ? `the project ${d.label}` : `the video "${d.label}"${d.sub ? ` (${d.sub})` : ""}`;
  return mk(b, "review", `${b.ownerName ? first(b.ownerName) : b.name} shared ${d.label} with you on WranglerPortal`, [
    hi(d.name),
    { t: "p", text: `${byline(b)} shared ${what} with you on WranglerPortal${d.access === "comment" ? ", and you can leave notes on it" : ""}.` },
    { t: "p", text: "Open it here:", tone: "muted" },
    { t: "button", label: `Open ${d.label}`, href: d.link }, { t: "link", href: d.link },
    { t: "p", text: d.hasAccount ? "Sign in with your WranglerPortal account to see it." : "It's for this email address only. The first time, you'll create your account (a password, then a six-digit code we send you); after that, just sign in." },
    { t: "p", text: "Reply to this email if anything doesn't work.", tone: "muted" },
  ], clientFooter(b));
}
/** 03b Portal invite (drawn Oct 29): "Invite to the portal" / "Resend invite" from the client page. */
export function portalInviteMail(b: MailBrand, d: { name: string | null; email: string; hasAccount: boolean }): Mail {
  const link = `${SITE()}/?invited=${encodeURIComponent(d.email).replace(/%40/g, "@")}`;
  const who = byline(b);
  return mk(b, "review", `${who} invited you to WranglerPortal`, [
    hi(d.name),
    { t: "p", text: `${who} invited you to WranglerPortal. It's where you'll find the cuts, documents and notes ${b.name} shares with you.` },
    { t: "p", text: "Open it here:", tone: "muted" },
    { t: "button", label: d.hasAccount ? "Sign in to WranglerPortal" : "Open WranglerPortal", href: link }, { t: "link", href: link, full: true },
    { t: "p", text: d.hasAccount ? `Sign in with your WranglerPortal account (${d.email}). Your email is filled in for you.` : "The first time, you'll create your account: a password, then a six-digit code we send you. After that, just sign in.", tone: "muted" },
    { t: "p", text: "Reply to this email if anything doesn't work.", tone: "muted" },
  ], b.isDefault ? [{ t: "small", text: "— WranglerPortal" }] : [{ t: "small", text: "Powered by WranglerPortal" }]);
}

// ---------- 04 · 05: new version, reply to a note ----------
export function newVersionMail(b: MailBrand, d: { title: string; number: number; description: string | null; project: string; name: string | null; link: string; unsub: string; thumbUrl: string | null }): Mail {
  return mk(b, "review", `${d.title} v${d.number} is ready to review`, [
    ...(d.thumbUrl ? [{ t: "image", src: d.thumbUrl, alt: `${d.title} v${d.number}`, href: d.link } as Block] : []),
    hi(d.name),
    { t: "p", text: `A new cut of "${d.title}" is ready to review on WranglerPortal: version ${d.number}${d.project ? ` (${d.project})` : ""}.` },
    ...(d.description ? [{ t: "p", text: `What changed: ${d.description}`, tone: "muted" } as Block] : []),
    { t: "p", text: "Watch it here:", tone: "muted" },
    { t: "button", label: `Watch v${d.number}`, href: d.link }, { t: "link", href: d.link },
    { t: "p", text: "Reply to this email if anything doesn't work.", tone: "muted" },
  ], clientFooter(b, { what: "new versions", href: d.unsub }), d.description ? `What changed: ${d.description}` : undefined);
}
export function replyMail(b: MailBrand, d: { name: string | null; replyAuthor: string; replyText: string; noteText: string; when: string; title: string; number: number; project: string; link: string; unsub: string }): Mail {
  return mk(b, "review", `${d.replyAuthor} replied on ${d.title}`, [
    hi(d.name),
    { t: "p", text: `${d.replyAuthor} replied to your note on "${d.title}" v${d.number}${d.project ? ` (${d.project})` : ""}, at ${d.when}:` },
    { t: "quote", rows: [{ who: "You", text: d.noteText || "(drawing)" }, { who: d.replyAuthor, text: d.replyText }] },
    { t: "p", text: "See it here:", tone: "muted" },
    { t: "button", label: "See the reply", href: d.link }, { t: "link", href: d.link },
  ], clientFooter(b, { what: "replies", href: d.unsub }), d.replyText.slice(0, 120));
}

// ---------- 06: the owner's alert about new client notes ----------
export function ownerAlertMail(b: MailBrand, d: { title: string; project: string; rows: Array<{ version: number; author: string; text: string; drawing: boolean; voice: boolean; when: string; link: string }> }): Mail {
  const who = [...new Set(d.rows.map((r) => r.author))];
  const n = d.rows.length, notes = `${n} new ${n === 1 ? "note" : "notes"}`;
  return mk(b, "review", `${notes} on ${d.title} from ${who[0]}${who.length > 1 ? ` and ${who.length - 1} more` : ""}`, [
    { t: "p", text: `${notes} from ${who.join(", ")} on "${d.title}"${d.project ? ` (${d.project})` : ""}.` },
    ...d.rows.map((r): Block => ({ t: "card", meta: `v${r.version} · ${r.when} · ${r.author}${r.drawing ? " · drawing" : ""}${r.voice ? " · voice" : ""}`, text: r.text || "(no words)", href: r.link })),
  ], [{ t: "small", text: "— WranglerPortal" }]);
}

// ---------- 07 · 07b · 08 · 09: signing ----------
export function pleaseSignMail(b: MailBrand, d: { name: string; title: string; label: string; link: string; until: string | null; reminder: boolean }): Mail {
  return mk(b, "contracts", `${d.reminder ? "Reminder: " : ""}Please sign: ${d.title} (${d.label})`, [
    hi(d.name),
    { t: "p", text: `${d.reminder ? "A reminder: " : ""}${byline(b, true)} sent you "${d.title}" (${d.label}) to review and sign.` },
    { t: "p", text: "Review and sign here:", tone: "muted" },
    { t: "button", label: "Review and sign", href: d.link }, { t: "link", href: d.link },
    { t: "p", text: "You'll confirm this email address with a 6-digit code, read the document, add your initials where asked, and sign. It takes a few minutes on a phone or a computer.", tone: "muted" },
    ...(d.until ? [{ t: "p", text: `The link works until ${d.until}.`, tone: "muted" } as Block] : []),
    { t: "p", text: "Questions, or would you rather sign on paper? Reply to this email.", tone: "muted" },
  ], [{ t: "small", text: `${b.footerName} · ${SIGN_HOST}` }]);
}
export function cancelledMail(b: MailBrand, d: { name: string; title: string; label: string; reason: string | null }): Mail {
  return mk(b, "contracts", `Cancelled: ${d.title} (${d.label})`, [
    hi(d.name),
    { t: "p", text: `${byline(b, true)} cancelled "${d.title}" (${d.label}). The signing link you were sent no longer works, and there's nothing for you to do.` },
    ...(d.reason ? [{ t: "box", text: `Reason: ${d.reason}` } as Block] : []),
    { t: "p", text: "Questions? Reply to this email.", tone: "muted" },
  ], [{ t: "small", text: b.name }]);
}
export function signerCodeMail(b: MailBrand, d: { code: string; title: string; label: string }): Mail {
  return mk(b, "contracts", `${d.code} is your code to sign ${d.label}`, [
    { t: "p", text: "Your code is" }, { t: "code", code: d.code },
    { t: "p", text: `Enter it on the signing page to open "${d.title}" from ${b.name}. It works for 10 minutes.` },
    { t: "small", text: "If you didn't ask for it, ignore this email: nothing happens without the code." },
  ], [{ t: "small", text: `${b.name} · ${SIGN_HOST}` }]);
}

// ---------- 10 · 11 · 12: the owner hears about signing ----------
export function ownerSignedMail(b: MailBrand, d: { signer: string; title: string; label: string; left: string[]; link: string }): Mail {
  return mk(b, "contracts", `${d.signer} signed ${d.label}`, [
    { t: "p", text: `${d.signer} signed "${d.title}" (${d.label}).` },
    ...(d.left.length ? [{ t: "p", text: `Still to sign: ${d.left.join(", ")}.`, tone: "muted" } as Block] : []),
    { t: "button", label: "Open it", href: d.link }, { t: "link", href: d.link },
  ], []);
}
/** The fallback when the signed copy couldn't be made (the copy email is the usual one). */
export function ownerAllSignedMail(b: MailBrand, d: { title: string; label: string; link: string }): Mail {
  return mk(b, "contracts", `Signed by everyone: ${d.title} (${d.label})`, [
    { t: "p", text: `Everyone has signed "${d.title}" (${d.label}).` },
    { t: "button", label: "Open it", href: d.link }, { t: "link", href: d.link },
  ], []);
}
export function ownerLockedMail(b: MailBrand, d: { signer: string; title: string; label: string; link: string }): Mail {
  return mk(b, "contracts", `Signing link locked: ${d.label}`, [
    { t: "p", text: `${d.signer}'s signing link for "${d.title}" (${d.label}) had too many wrong codes, so it's locked for good.` },
    { t: "p", text: `If that was ${first(d.signer) || d.signer} having trouble, cancel the document and send it again for a fresh link. If not, someone else may have the link.`, tone: "muted" },
    { t: "button", label: "Open it", href: d.link }, { t: "link", href: d.link },
  ], []);
}

// ---------- 13 · 13b: the signed copy ----------
export function signedCopyMail(b: MailBrand, d: {
  owner: boolean; name: string; title: string; label: string; fileName: string; fileMeta: string; signedBy: string[]; sha256: string; verifyUrl: string; link: string;
  invoice: { kind: "created"; amount: string; testMode: boolean; url: string } | { kind: "failed"; error: string } | null;
}): Mail {
  const verify = d.verifyUrl.replace(/^https?:\/\//, "");
  const common: Block[] = [
    { t: "file", name: d.fileName, meta: d.fileMeta },
    { t: "p", text: "Signed by:" }, { t: "list", items: d.signedBy },
    { t: "p", text: "The attached PDF ends with a certificate listing every step. Its SHA-256 fingerprint is:", tone: "muted" },
    { t: "mono", text: d.sha256 },
    { t: "p", text: `To check a copy later, open ${verify} and choose the file.`, tone: "muted" },
  ];
  if (d.owner) {
    return mk(b, "contracts", `Signed: ${d.title} (${d.label})`, [
      { t: "p", text: `Everyone has signed "${d.title}" (${d.label}). The signed copy is attached, and a copy went to every signer.` },
      ...common,
      { t: "button", label: "Open it", href: d.link }, { t: "link", href: d.link },
      ...(d.invoice?.kind === "created" ? [{ t: "box", text: `Draft invoice for ${d.invoice.amount}${d.invoice.testMode ? " (Stripe test mode)" : ""}, ready for you to review and send: ${d.invoice.url}` } as Block]
        : d.invoice?.kind === "failed" ? [{ t: "box", text: `The Stripe draft invoice couldn't be made: ${d.invoice.error}. Retry it from the document page.` } as Block] : []),
    ], []);
  }
  return mk(b, "contracts", `Signed: ${d.title} (${d.label})`, [
    hi(d.name),
    { t: "p", text: `Everyone has signed "${d.title}" (${d.label}). Your signed copy is attached.` },
    ...common,
    { t: "p", text: "Please keep this email for your records. Questions? Reply to this email.", tone: "muted" },
  ], [{ t: "small", text: `${b.footerName} · ${SIGN_HOST}` }]);
}

// ---------- Inbox alert: a note from the business ----------
export function noteMail(b: MailBrand, d: { title: string; text: string; link: string | null; linkLabel: string | null; unsub?: string }): Mail {
  const href = d.link ? (/^https:\/\//.test(d.link) ? d.link : `${SITE()}${d.link}`) : `${SITE()}/inbox`;
  return mk(b, "updates", d.title, [
    { t: "eyebrow", text: `A note from ${b.name}` },
    { t: "title", text: d.title },
    ...(d.text ? [{ t: "p", text: d.text } as Block] : []),
    { t: "button", label: d.link && d.linkLabel ? d.linkLabel : "Open in the portal", href },
  ], [
    { t: "small", text: `${b.footerName} · Replies go to ${b.replyTo} ·`, link: { label: "Email settings", href: `${SITE()}/settings` } },
    ...(d.unsub ? [{ t: "small", text: "Stop emails about notes:", link: { label: "unsubscribe", href: d.unsub } } as Block] : []),
    ...(!b.isDefault ? [{ t: "small", text: "Powered by WranglerPortal" } as Block] : []),
  ], d.text.slice(0, 120));
}

// ---------- 08 · Invoice sent (Phase 2 Part B, step 3) ----------
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function invoiceMail(b: MailBrand, d: { name: string; number: string; title: string; project: string | null; amountCents: number; dueDate: string; memo: string | null; link: string }): Mail {
  const owner = first(b.ownerName);
  return mk(b, "updates", `Invoice ${d.number} from ${b.name}: ${usd(d.amountCents)} due ${longDate(d.dueDate)}`, [
    hi(d.name),
    { t: "p", text: d.project ? `Here’s invoice ${d.number} for ${d.project}.` : `Here’s invoice ${d.number}.` },
    { t: "sums", rows: [{ label: "Amount due", value: usd(d.amountCents), big: true }, { label: "Due", value: longDate(d.dueDate) }, { label: "Invoice", value: `${d.number} · ${d.title}` }] },
    ...(d.memo ? [{ t: "p", text: d.memo, tone: "muted" } as Block] : []),
    { t: "p", text: "You can pay by card or bank account on the invoice page. The PDF is there too." },
    { t: "button", label: "View and pay", href: d.link }, { t: "link", href: d.link },
  ], [
    { t: "small", text: owner ? `— ${owner}, ${b.name}` : `— ${b.name}` },
    { t: "small", text: `${b.footerName} · ${b.replyTo}` },
    ...(!b.isDefault ? [{ t: "small", text: "Powered by WranglerPortal" } as Block] : []),
  ], `${usd(d.amountCents)} due ${longDate(d.dueDate)}`);
}

// ---------- 09 · 10 · 11 · 12: reminders, receipt, payment failed (Phase 2 Part B, step 4) ----------
const signoff = (b: MailBrand): Block[] => [
  { t: "small", text: first(b.ownerName) ? `— ${first(b.ownerName)}, ${b.name}` : `— ${b.name}` },
  { t: "small", text: `${b.footerName} · ${b.replyTo}` },
  ...(!b.isDefault ? [{ t: "small", text: "Powered by WranglerPortal" } as Block] : []),
];
const at = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function reminderMail(b: MailBrand, d: { kind: "before" | "overdue"; name: string; number: string; title: string; amountCents: number; dueDate: string; link: string }): Mail {
  const due = longDate(d.dueDate);
  if (d.kind === "before") return mk(b, "updates", `Reminder: invoice ${d.number} from ${b.name} is due ${due}`, [
    hi(d.name),
    { t: "p", text: `A quick reminder that invoice ${d.number} is due on ${due}.` },
    { t: "sums", rows: [{ label: "Amount due", value: usd(d.amountCents), big: true }, { label: "Due", value: due }, { label: "Invoice", value: `${d.number} · ${d.title}` }] },
    { t: "p", text: "If you’ve already paid, thank you. You can ignore this." },
    { t: "button", label: "View and pay", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `${usd(d.amountCents)} due ${due}`);
  return mk(b, "updates", `Invoice ${d.number} from ${b.name} is overdue`, [
    hi(d.name),
    { t: "p", text: `Invoice ${d.number} was due on ${due} and is still open.` },
    { t: "sums", rows: [{ label: "Amount due", value: usd(d.amountCents), big: true }, { label: "Was due", value: due }, { label: "Invoice", value: `${d.number} · ${d.title}` }] },
    { t: "p", text: "If you’ve already paid, thank you. You can ignore this. If something’s wrong with the invoice, just reply." },
    { t: "button", label: "View and pay", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `${usd(d.amountCents)} was due ${due}`);
}

export function receiptMail(b: MailBrand, d: { name: string; number: string; title: string; paidCents: number; paidAt: number; method: string; amountCents: number; link: string }): Mail {
  return mk(b, "updates", `Receipt from ${b.name}: ${usd(d.paidCents)} paid`, [
    hi(d.name),
    { t: "p", text: "Thank you. We received your payment." },
    { t: "sums", rows: [{ label: "Amount paid", value: usd(d.paidCents), big: true }, { label: "Paid", value: at(d.paidAt) }, { label: "Method", value: d.method }, { label: "Invoice", value: `${d.number} · ${d.title}` }, { label: "Amount remaining", value: usd(d.amountCents) }] },
    { t: "p", text: "Keep this email as your receipt. The receipt PDF is on the invoice page." },
    { t: "button", label: "View receipt", href: d.link }, { t: "link", href: d.link },
  ], [...signoff(b), { t: "small", text: `Payment processed by Stripe for ${b.footerName}.` }], `${usd(d.paidCents)} paid · ${d.number}`);
}

export function paymentFailedMail(b: MailBrand, d: { name: string; number: string; title: string; amountCents: number; dueDate: string; message: string; link: string }): Mail {
  // Stripe's reason when it's a card decline ("Your card was declined."), in the design's words.
  const declined = /declin/i.test(d.message);
  return mk(b, "updates", `Payment didn’t go through: invoice ${d.number} from ${b.name}`, [
    hi(d.name),
    { t: "p", text: declined ? "Your card was declined, so nothing was charged." : `Your payment didn’t go through, so nothing was charged.${d.message && !/payment attempt failed/i.test(d.message) ? ` Stripe said: ${d.message.replace(/\.$/, "")}.` : ""}` },
    { t: "sums", rows: [{ label: "Amount due", value: usd(d.amountCents), big: true }, { label: "Due", value: longDate(d.dueDate) }, { label: "Invoice", value: `${d.number} · ${d.title}` }] },
    { t: "p", text: "You can try again, or use a different card or your bank account." },
    { t: "button", label: "Try again", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `Nothing was charged · ${d.number}`);
}
