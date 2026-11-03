// Phase 1 step 5 (Oct 29): each approved email (page "S5 · Emails", numbers as drawn) as a pure function of its data.
// The wording is today's, with "Wrangler Review" now "WranglerPortal" and the business's own name where it was
// Wrangler's. Senders: review@ for Review and sign-in, contracts@ for Sign, updates@ for notes (Heston, Oct 29).
import { type Block, type MailBrand, clientFooter, fromLine, renderMail } from "./mail";
import { SITE, SITE_HOST } from "./site";
import { dateRange } from "./bookings";

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
  const link = `${SITE()}/?invited=${encodeURIComponent(d.email).replace(/%40/g, "@")}&side=client`; // a client-and-vendor login lands on the client side
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
/** "Wrangler Productions, a DBA of Hill Creative LLC · {address} · {email} · Privacy policy" (as drawn on 08–12). */
const moneyFooter = (b: MailBrand): Block => ({ t: "small", text: [b.footerName, b.address, b.replyTo].filter(Boolean).join(" · ") + (b.privacyUrl ? " ·" : ""), ...(b.privacyUrl ? { link: { label: "Privacy policy", href: b.privacyUrl } } : {}) });
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
    moneyFooter(b),
    ...(!b.isDefault ? [{ t: "small", text: "Powered by WranglerPortal" } as Block] : []),
  ], `${usd(d.amountCents)} due ${longDate(d.dueDate)}`);
}

// ---------- 09 · 10 · 11 · 12: reminders, receipt, payment failed (Phase 2 Part B, step 4) ----------
const signoff = (b: MailBrand): Block[] => [
  { t: "small", text: first(b.ownerName) ? `— ${first(b.ownerName)}, ${b.name}` : `— ${b.name}` },
  moneyFooter(b),
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

// ---------- 13 · 14 · 15 · 16 · 17: subscriptions (Phase 2b) ----------
const periodWords = (every: string) => every.replace(/^\/ /, "every ");

export function subscriptionStartedMail(b: MailBrand, d: { name: string; plan: string; price: string; every: string; starts: string; firstCharge: string; description: string | null; link: string }): Mail {
  return mk(b, "updates", `${b.name} started your ${d.plan} plan`, [
    hi(d.name),
    { t: "p", text: `${b.name} set up ${d.plan} for you: ${d.price} ${periodWords(d.every)}.` },
    { t: "sums", rows: [{ label: "Price", value: `${d.price} ${d.every}`, big: true }, { label: "Starts", value: d.starts }, { label: "First charge", value: d.firstCharge }] },
    ...(d.description ? [{ t: "p", text: d.description, tone: "muted" } as Block] : []),
    { t: "p", text: "Add a card or bank account to get it going. Nothing is charged until you do; after that it’s charged automatically each period, and you get a receipt each time." },
    { t: "button", label: "Add payment method", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `Add a payment method for ${d.plan}`);
}

export function upcomingChargeMail(b: MailBrand, d: { name: string; plan: string; amountCents: number; on: string; method: string | null; link: string }): Mail {
  return mk(b, "updates", `Your ${d.plan} plan renews on ${d.on}`, [
    hi(d.name),
    { t: "p", text: `A heads-up: ${usd(d.amountCents)} for ${d.plan} will be charged on ${d.on}${d.method ? ` to ${d.method}` : ""}.` },
    { t: "sums", rows: [{ label: "Amount", value: usd(d.amountCents), big: true }, { label: "Charged on", value: d.on }, ...(d.method ? [{ label: "Payment method", value: d.method }] : [])] },
    { t: "p", text: "Nothing to do if that’s all right. To use a different card or bank account, update it on your subscription page." },
    { t: "button", label: "View subscription", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `${usd(d.amountCents)} on ${d.on}`);
}

export function subscriptionFailedMail(b: MailBrand, d: { name: string; plan: string; amountCents: number; reason: string; nextTry: string | null; link: string }): Mail {
  return mk(b, "updates", `Your payment for ${d.plan} didn’t go through`, [
    hi(d.name),
    { t: "p", text: `We tried to charge ${usd(d.amountCents)} for ${d.plan}, and it didn’t go through.` },
    { t: "sums", rows: [{ label: "Amount", value: usd(d.amountCents), big: true }, { label: "Reason", value: d.reason }, ...(d.nextTry ? [{ label: "Next try", value: d.nextTry }] : [])] },
    { t: "p", text: "Update your card or bank account so your plan keeps going. Saving a new one tries the payment again straight away." },
    { t: "button", label: "Update payment method", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `${usd(d.amountCents)} for ${d.plan} didn’t go through`);
}

export function subscriptionCancelledMail(b: MailBrand, d: { name: string; plan: string; ends: string; ended: boolean; link: string }): Mail {
  return mk(b, "updates", d.ended ? `Your ${d.plan} plan has ended` : `Your ${d.plan} plan will end on ${d.ends}`, [
    hi(d.name),
    { t: "p", text: d.ended ? `${b.name} cancelled ${d.plan}. There are no more charges.` : `${b.name} cancelled ${d.plan}. It runs until ${d.ends}, and there are no charges after that.` },
    { t: "p", text: "Your past invoices and receipts stay on your subscription page. Questions? Just reply." },
    { t: "button", label: "View subscription", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), d.ended ? `${d.plan} has ended` : `${d.plan} ends ${d.ends}`);
}

/** 17 · to the owner (D61), in the alert layout. */
export function ownerSubscriptionFailedMail(b: MailBrand, d: { client: string; plan: string; amountCents: number; reason: string; nextTry: string | null; link: string }): Mail {
  return mk(b, "updates", `Payment failed: ${d.client} · ${d.plan}`, [
    { t: "p", text: `${d.client}’s ${usd(d.amountCents)} payment for ${d.plan} didn’t go through.` },
    { t: "sums", rows: [{ label: "Reason", value: d.reason }, ...(d.nextTry ? [{ label: "Stripe tries again", value: d.nextTry }] : [{ label: "Stripe tries again", value: "No more tries" }])] },
    { t: "p", text: "They’ve been emailed a link to update their payment method." },
    { t: "button", label: "Open the subscription", href: d.link }, { t: "link", href: d.link },
  ], [{ t: "small", text: "WranglerPortal" }], `${d.client}: ${usd(d.amountCents)} didn’t go through`);
}

// ---------- 18 · 20 · 21: quick quotes (Phase 3b, S5 · Phase 3b 723:12971, 723:13026, 723:13052) ----------
/** 18 · the quote, to the person it's for (no account needed, D81). */
export function quoteMail(b: MailBrand, d: { name: string; number: string; title: string; totalCents: number; validUntil: string; terms: string | null; link: string }): Mail {
  return mk(b, "updates", `Quote ${d.number} from ${b.name}: ${usd(d.totalCents)}`, [
    hi(d.name),
    { t: "p", text: `Here’s quote ${d.number} for ${d.title}.` },
    { t: "sums", rows: [{ label: "Total", value: usd(d.totalCents), big: true }, { label: "Valid until", value: longDate(d.validUntil) }, { label: "Quote", value: `${d.number} · ${d.title}` }] },
    ...(d.terms ? [{ t: "p", text: d.terms, tone: "muted" } as Block] : []),
    { t: "p", text: "Accept or decline it on the quote page. No account needed. The PDF is there too." },
    { t: "button", label: "View and accept", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `${usd(d.totalCents)} · valid until ${longDate(d.validUntil)}`);
}

/** 19 · a proposal to the client (S5 · Phase 3b): read it and press Accept on its page; no account needed (D73). */
export function proposalMail(b: MailBrand, d: { name: string; number: string; title: string; totalCents: number; sentAt: number; message: string | null; link: string }): Mail {
  const sent = new Date(d.sentAt).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });
  return mk(b, "updates", `Proposal from ${b.name}: ${d.title}`, [
    hi(d.name),
    { t: "p", text: `Here’s our proposal for ${d.title}.` },
    { t: "sums", rows: [{ label: "Investment", value: usd(d.totalCents), big: true }, { label: "Sent", value: sent }, { label: "Proposal", value: `${d.number} · ${d.title}` }] },
    ...(d.message ? [{ t: "p", text: d.message } as Block] : []),
    { t: "p", text: "Read it and press Accept on the proposal page. No account needed. The PDF is there too." },
    { t: "button", label: "View proposal", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `${d.title} · ${usd(d.totalCents)}`);
}

/** 22 · 23 · to the owner when the client answers a proposal (D84: nothing is drafted or moved). */
export function ownerProposalAnsweredMail(b: MailBrand, d: { kind: "accepted" | "declined"; who: string; number: string; company: string; title: string; totalCents: number; at: string; reason: string | null; link: string }): Mail {
  const accepted = d.kind === "accepted";
  return mk(b, "updates", `${d.who} ${d.kind} proposal ${d.number}`, [
    { t: "eyebrow", text: `${d.who} ${d.kind} proposal ${d.number}` },
    { t: "title", text: `${d.company} · ${d.title} · ${usd(d.totalCents)}` },
    { t: "p", text: accepted
      ? `Accepted ${d.at}. Start the contract from it when you’re ready. Nothing has been drafted or moved.`
      : `Declined ${d.at}.${d.reason ? "" : " No reason given."}` },
    ...(!accepted && d.reason ? [{ t: "box", text: `Reason: ${d.reason}` } as Block] : []),
    { t: "button", label: "Open the proposal", href: d.link },
  ], [{ t: "small", text: "Sent to you when a client answers · WranglerPortal" }], `${d.who} ${d.kind} ${d.number}`);
}

/** 20 · 21 · to the owner when the person answers (D84: nothing is drafted or moved). */
export function ownerQuoteAnsweredMail(b: MailBrand, d: { kind: "accepted" | "declined"; who: string; number: string; company: string; title: string; totalCents: number; at: string; reason: string | null; link: string }): Mail {
  const accepted = d.kind === "accepted";
  return mk(b, "updates", `${d.who} ${d.kind} quote ${d.number}`, [
    { t: "eyebrow", text: `${d.who} ${d.kind} quote ${d.number}` },
    { t: "title", text: `${d.company} · ${d.title} · ${usd(d.totalCents)}` },
    { t: "p", text: accepted
      ? `Accepted ${d.at}. Draft a contract, an invoice, or both from it when you’re ready. Nothing has been drafted or moved.`
      : `Declined ${d.at}.${d.reason ? "" : " No reason given."}` },
    ...(!accepted && d.reason ? [{ t: "box", text: `Reason: ${d.reason}` } as Block] : []),
    { t: "button", label: "Open the quote", href: d.link },
  ], [{ t: "small", text: "Sent to you when a client answers · WranglerPortal" }], `${d.who} ${d.kind} ${d.number}`);
}

// ---------- 24: a booking offered to a vendor (Phase 3c, S5 · Phase 3c 735:5139) ----------
export { dateRange };
const dollars = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : usd(cents));
export function bookingOfferMail(b: MailBrand, d: { name: string; role: string; project: string; start: string; end: string; rateCents: number; unit: "day" | "hour"; hours: number | null; location: string | null; note: string | null; link: string }): Mail {
  const article = /^[aeiou]/i.test(d.role) ? "an" : "a";
  const extra = [d.location ? `${d.location.replace(/\.$/, "")}.` : null, d.note].filter(Boolean).join(" ");
  return mk(b, "updates", `${b.name} would like to book you: ${d.project}`, [
    hi(d.name),
    { t: "p", text: `${b.name} would like to book you as ${article} ${d.role}.` },
    { t: "sums", rows: [
      { label: "Rate", value: `${dollars(d.rateCents)} / ${d.unit}`, big: true },
      { label: "Dates", value: dateRange(d.start, d.end) },
      ...(d.unit === "hour" && d.hours ? [{ label: "Expected hours", value: String(d.hours) }] : []),
      { label: "Project", value: d.project },
    ] },
    ...(extra ? [{ t: "p", text: extra, tone: "muted" } as Block] : []),
    { t: "p", text: "Accept or decline it in your vendor portal." },
    { t: "button", label: "View the booking", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `${d.role} · ${dateRange(d.start, d.end)} · ${dollars(d.rateCents)} / ${d.unit}`);
}

// ---------- 25: a briefing sent to a booked vendor (Phase 3c, S5 · Phase 3c 735:5165) ----------
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
export function briefingMail(b: MailBrand, d: { name: string; kind: string; project: string; title: string; role: string; start: string; end: string; headings: string[]; link: string }): Mail {
  const sender = first(b.ownerName) || b.name;
  const parts = d.headings.slice(0, 4).map((h, i) => (i === 0 ? h : h.toLowerCase()));
  return mk(b, "updates", `Brief: ${d.project}`, [
    hi(d.name),
    { t: "p", text: `${sender} sent you the ${d.kind.toLowerCase()} for ${d.project}.` },
    { t: "sums", rows: [{ label: "Dates", value: dateRange(d.start, d.end), big: true }, { label: "Role", value: d.role }, { label: "Brief", value: d.title }] },
    ...(parts.length ? [{ t: "p", text: `${andList(parts)} ${parts.length === 1 ? "is" : "are"} in the brief.`, tone: "muted" } as Block] : []),
    { t: "p", text: "Read it in your portal and press “I’ve read it”." },
    { t: "button", label: "Read the brief", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `${d.title} · ${dateRange(d.start, d.end)}`);
}

// ---------- the vendor portal invite (Phase 3c step 4; the portal invite's layout, 03b) ----------
export function vendorInviteMail(b: MailBrand, d: { name: string; email: string; hasAccount: boolean }): Mail {
  const link = `${SITE()}/?invited=${encodeURIComponent(d.email).replace(/%40/g, "@")}&side=vendor`; // lands on the vendor side
  const who = byline(b);
  return mk(b, "updates", `${who} invited you to WranglerPortal`, [
    hi(d.name),
    { t: "p", text: `${who} invited you to WranglerPortal, where you’ll get bookings, read briefs and send invoices to ${b.name}.` },
    { t: "p", text: "Open it here:", tone: "muted" },
    { t: "button", label: d.hasAccount ? "Sign in to WranglerPortal" : "Open WranglerPortal", href: link }, { t: "link", href: link, full: true },
    { t: "p", text: d.hasAccount ? `Sign in with your WranglerPortal account (${d.email}). ${b.name}’s work shows up beside the other businesses you work for, kept separate.` : "The first time, you’ll create your account: a password, then a six-digit code we send you. After that, just sign in.", tone: "muted" },
    { t: "p", text: "Reply to this email if anything doesn't work.", tone: "muted" },
  ], b.isDefault ? [{ t: "small", text: "— WranglerPortal" }] : [{ t: "small", text: "Powered by WranglerPortal" }]);
}

// ---------- to the owner when a vendor accepts a booking (Heston, Nov 2; the alert layout, like 22) ----------
export function ownerBookingAcceptedMail(b: MailBrand, d: { vendor: string; role: string; project: string; start: string; end: string; rateCents: number; unit: "day" | "hour"; link: string }): Mail {
  return mk(b, "updates", `${d.vendor} accepted the booking: ${d.project}`, [
    { t: "eyebrow", text: `${d.vendor} accepted the booking` },
    { t: "title", text: `${d.project} · ${d.role} · ${dateRange(d.start, d.end)}` },
    { t: "p", text: `At ${dollars(d.rateCents)} / ${d.unit}. It's on the project's Crew card. Send them the briefing when it's ready.` },
    { t: "button", label: "Open the booking", href: d.link },
  ], [{ t: "small", text: "Sent to you when a vendor accepts a booking · WranglerPortal" }], `${d.vendor} · ${d.role} · ${dateRange(d.start, d.end)}`);
}

// ---------- 26: to the owner when a vendor sends an invoice (S5 · Phase 3c 735:5243) ----------
export function ownerVendorInvoiceMail(b: MailBrand, d: { vendor: string; number: string; project: string; role: string; amount: string; totalCents: number; expectedCents: number | null; link: string }): Mail {
  const first = d.vendor.trim().split(/\s+/)[0] || d.vendor;
  const vs = d.expectedCents === null ? "" : d.totalCents === d.expectedCents ? "It matches the agreed rate on the booking. " : `It's ${d.totalCents > d.expectedCents ? "more" : "less"} than the booking's expected ${usd(d.expectedCents)}. `;
  return mk(b, "updates", `${d.vendor} sent invoice ${d.number}`, [
    { t: "eyebrow", text: `${d.vendor} sent invoice ${d.number}` },
    { t: "title", text: `${d.project} · ${d.role}${d.amount ? `, ${d.amount}` : ""} · ${usd(d.totalCents)}` },
    { t: "p", text: `${vs}Approve it to add it to the Ledger, then mark it paid when you pay ${first}.` },
    { t: "button", label: "Review it", href: d.link },
  ], [{ t: "small", text: "Sent to you when a vendor sends an invoice · WranglerPortal" }], `${d.project} · ${usd(d.totalCents)}`);
}

// ---------- 27 · 28: to the vendor when the owner approves an invoice, then marks it paid (Phase 3c, 735:5191 · 735:5217) ----------
const ymdLong = (ymd: string) => dateRange(ymd, ymd);
export function vendorInvoiceApprovedMail(b: MailBrand, d: { name: string; number: string; project: string; totalCents: number; approvedOn: string; link: string }): Mail {
  const sender = first(b.ownerName) || b.name;
  return mk(b, "updates", `Invoice ${d.number} approved`, [
    hi(d.name),
    { t: "p", text: `${sender} approved your invoice ${d.number}.` },
    { t: "sums", rows: [{ label: "Total", value: usd(d.totalCents), big: true }, { label: "Approved", value: ymdLong(d.approvedOn) }, { label: "Invoice", value: `${d.number} · ${d.project}` }] },
    { t: "p", text: "You’ll get another email when it’s paid.", tone: "muted" },
    { t: "p", text: "You can see its status in your portal." },
    { t: "button", label: "View the invoice", href: d.link }, { t: "link", href: d.link },
  ], vendorFoot(b), `${d.number} · ${usd(d.totalCents)} approved`);
}
export function vendorInvoicePaidMail(b: MailBrand, d: { name: string; number: string; project: string; paidCents: number; paidOn: string; method: string; link: string }): Mail {
  return mk(b, "updates", `Invoice ${d.number} paid`, [
    hi(d.name),
    { t: "p", text: `${b.name} paid your invoice ${d.number}.` },
    { t: "sums", rows: [{ label: "Paid", value: usd(d.paidCents), big: true }, { label: "Paid on", value: `${ymdLong(d.paidOn)} · ${d.method}` }, { label: "Invoice", value: `${d.number} · ${d.project}` }] },
    { t: "p", text: first(d.name) ? `Thanks for the work, ${first(d.name)}.` : "Thanks for the work.", tone: "muted" },
    { t: "p", text: `It counts toward your ${d.paidOn.slice(0, 4)} total with ${b.name}.` },
    { t: "button", label: "View the invoice", href: d.link }, { t: "link", href: d.link },
  ], vendorFoot(b), `${d.number} · ${usd(d.paidCents)} paid`);
}

// ---------- Nov 2 (Heston: email notifications for everything): the events that had no email. No frames: each uses
// the layout of its nearest drawn sibling (owner alerts like 26; vendor emails like 27). ----------
const ownerFoot = (what: string): Block[] => [{ t: "small", text: `Sent to you when ${what} · Change which emails you get in Settings › Notifications · WranglerPortal` }];
export function ownerBookingDeclinedMail(b: MailBrand, d: { vendor: string; role: string; project: string; start: string; end: string; reason: string | null; link: string }): Mail {
  return mk(b, "updates", `${d.vendor} declined the booking: ${d.project}`, [
    { t: "eyebrow", text: `${d.vendor} declined the booking` },
    { t: "title", text: `${d.project} · ${d.role} · ${dateRange(d.start, d.end)}` },
    ...(d.reason ? [{ t: "box", text: `Reason: ${d.reason}` } as Block] : []),
    { t: "p", text: "It's off the project's expected costs. Book someone else from the project's Crew card." },
    { t: "button", label: "Open the booking", href: d.link },
  ], ownerFoot("a vendor declines a booking"), `${d.vendor} · ${d.role} · ${dateRange(d.start, d.end)}`);
}
export function ownerBriefingReadMail(b: MailBrand, d: { vendor: string; title: string; project: string; link: string }): Mail {
  return mk(b, "updates", `${d.vendor} read the brief: ${d.project}`, [
    { t: "eyebrow", text: `${d.vendor} read the brief` },
    { t: "title", text: d.title },
    { t: "p", text: `They pressed “I’ve read it” in their portal.` },
    { t: "button", label: "Open the briefing", href: d.link },
  ], ownerFoot("a vendor reads a briefing"), `${d.vendor} · ${d.project}`);
}
export function ownerW9Mail(b: MailBrand, d: { vendor: string; replaced: boolean; link: string }): Mail {
  return mk(b, "updates", `${d.vendor} ${d.replaced ? "replaced their" : "uploaded a"} W-9`, [
    { t: "eyebrow", text: `${d.vendor} ${d.replaced ? "replaced their" : "uploaded a"} W-9` },
    { t: "p", text: "It's on their vendor page under Tax, for your 1099s. Only you can open it." },
    { t: "button", label: "Open their page", href: d.link },
  ], ownerFoot("a vendor uploads a W-9"));
}
export function ownerPaidMail(b: MailBrand, d: { client: string; number: string; title: string; paidCents: number; method: string; leftCents: number; link: string }): Mail {
  return mk(b, "updates", `${d.client} paid ${usd(d.paidCents)}: invoice ${d.number}`, [
    { t: "eyebrow", text: `${d.client} paid invoice ${d.number}` },
    { t: "sums", rows: [{ label: "Paid", value: usd(d.paidCents), big: true }, { label: "Method", value: d.method }, { label: "Invoice", value: `${d.number} · ${d.title}` }, { label: "Left to pay", value: usd(d.leftCents) }] },
    { t: "button", label: "Open the invoice", href: d.link },
  ], ownerFoot("a client pays an invoice"), `${usd(d.paidCents)} · ${d.number}`);
}
const vendorFoot = (b: MailBrand): Block[] => [...signoff(b), { t: "small", text: `Choose which emails you get in your portal’s Settings › Notifications.` }];
export function vendorBookingCancelledMail(b: MailBrand, d: { name: string; role: string; project: string; start: string; end: string; wasAccepted: boolean; link: string }): Mail {
  return mk(b, "updates", `Booking cancelled: ${d.project}`, [
    hi(d.name),
    { t: "p", text: `${b.name} ${d.wasAccepted ? "cancelled your booking" : "took back the booking offer"} as ${/^[aeiou]/i.test(d.role) ? "an" : "a"} ${d.role}.` },
    { t: "sums", rows: [{ label: "Dates", value: dateRange(d.start, d.end), big: true }, { label: "Project", value: d.project }] },
    { t: "p", text: `Reply to this email if you have questions.`, tone: "muted" },
    { t: "button", label: "View your bookings", href: d.link }, { t: "link", href: d.link },
  ], vendorFoot(b), `${d.role} · ${dateRange(d.start, d.end)}`);
}
export function vendorInvoiceDeclinedMail(b: MailBrand, d: { name: string; number: string; project: string; totalCents: number; reason: string; link: string }): Mail {
  const sender = first(b.ownerName) || b.name;
  return mk(b, "updates", `Invoice ${d.number} declined`, [
    hi(d.name),
    { t: "p", text: `${sender} declined your invoice ${d.number}.` },
    { t: "box", text: `Reason: ${d.reason}` },
    { t: "sums", rows: [{ label: "Total", value: usd(d.totalCents), big: true }, { label: "Invoice", value: `${d.number} · ${d.project}` }] },
    { t: "p", text: "Fix it in your portal and send it again." },
    { t: "button", label: "Fix the invoice", href: d.link }, { t: "link", href: d.link },
  ], vendorFoot(b), `${d.number} · ${usd(d.totalCents)}`);
}

// ---------- Nov 2: Pay in portal (vendorPayouts.ts). Layouts of their siblings (owner alerts like 26; vendor like 27). ----------
export function ownerPayoutMail(b: MailBrand, d: { what: "posted" | "failed" | "returned"; vendor: string; number: string; project: string; cents: number; reason: string | null; link: string }): Mail {
  if (d.what === "posted") return mk(b, "updates", `Paid ${d.vendor} ${usd(d.cents)}: invoice ${d.number}`, [
    { t: "eyebrow", text: `Your payment to ${d.vendor} went out` },
    { t: "sums", rows: [{ label: "Paid", value: usd(d.cents), big: true }, { label: "Method", value: "Direct deposit (Stripe)" }, { label: "Invoice", value: `${d.number} · ${d.project}` }] },
    { t: "p", text: "It left your Stripe balance. The invoice is marked paid and they've been told." },
    { t: "button", label: "Open the invoice", href: d.link },
  ], ownerFoot("a vendor payment goes out through Stripe"), `${usd(d.cents)} · ${d.number}`);
  const back = d.what === "returned";
  return mk(b, "updates", back ? `Payment to ${d.vendor} came back: invoice ${d.number}` : `Payment to ${d.vendor} didn't go through: invoice ${d.number}`, [
    { t: "eyebrow", text: back ? `Your payment to ${d.vendor} came back from their bank` : `Your payment to ${d.vendor} didn't go through` },
    { t: "title", text: `${usd(d.cents)} · ${d.number} · ${d.project}` },
    ...(d.reason ? [{ t: "box", text: `Stripe says: ${d.reason}` } as Block] : []),
    { t: "p", text: "The money is back in your Stripe balance and the invoice is back to Approved. Ask them to check their direct deposit, then pay it again, or pay another way and mark it paid." },
    { t: "button", label: "Open the invoice", href: d.link },
  ], ownerFoot("a vendor payment through Stripe fails"), `${usd(d.cents)} · ${d.number}`);
}
export function vendorPayoutSetupMail(b: MailBrand, d: { name: string; link: string }): Mail {
  const sender = first(b.ownerName) || b.name;
  return mk(b, "updates", `Set up direct deposit with ${b.name}`, [
    hi(d.name),
    { t: "p", text: `${sender} would like to pay your invoices by direct deposit.` },
    { t: "p", text: "Set it up once in your portal's Settings. You'll enter your bank details on Stripe's secure form; they never pass through the portal or email." },
    { t: "button", label: "Set up direct deposit", href: d.link }, { t: "link", href: d.link },
  ], vendorFoot(b));
}
export function vendorPayoutReturnedMail(b: MailBrand, d: { name: string; number: string; project: string; cents: number; reason: string | null; link: string }): Mail {
  return mk(b, "updates", `Your payment for invoice ${d.number} came back`, [
    hi(d.name),
    { t: "p", text: `${b.name}'s direct deposit of ${usd(d.cents)} for invoice ${d.number} came back from your bank${d.reason ? ` (${d.reason})` : ""}, so it isn't paid yet.` },
    { t: "p", text: "Check your bank details in your portal's Settings › Direct deposit. Your invoice is back to Approved and will be paid again." },
    { t: "button", label: "Check your direct deposit", href: d.link }, { t: "link", href: d.link },
  ], vendorFoot(b), `${d.number} · ${usd(d.cents)}`);
}

// ---------- Phase 4 (frames 742:2564, 742:2590): 29 · Shoot scheduled, 30 · Shoot moved; and the owner's note when a
// client confirms (no frame: the owner-alert layout of 26). ----------
export const clock = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
export const shootDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
export function shootMail(b: MailBrand, d: { name: string | null; project: string; date: string; call: string; location: string; moved: null | { date: string; call: string; location: string }; prepare?: boolean; link: string }): Mail {
  if (!d.moved) return mk(b, "updates", `Your shoot for ${d.project} is set: ${shootDay(d.date)}`, [
    hi(d.name),
    { t: "p", text: `Your shoot for ${d.project} is set.` },
    { t: "sums", rows: [{ label: "Date", value: shootDay(d.date), big: true }, { label: "Call", value: clock(d.call) }, { label: "Where", value: d.location }] },
    ...(d.prepare !== false ? [{ t: "p", text: "What to prepare is on the shoot page.", tone: "muted" } as Block] : []),
    { t: "p", text: "Please confirm it in your portal." },
    { t: "button", label: "Confirm the shoot", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `${shootDay(d.date)} · ${clock(d.call)} call`);
  const m = d.moved;
  const sameDay = m.date === d.date, sameCall = m.call === d.call, samePlace = m.location === d.location;
  return mk(b, "updates", `Your shoot for ${d.project} has moved: ${shootDay(d.date)}`, [
    hi(d.name),
    { t: "p", text: `Your shoot for ${d.project} has moved.` },
    { t: "sums", rows: [
      { label: sameDay ? "Date" : "New date", value: shootDay(d.date), big: true },
      ...(sameDay ? [] : [{ label: "Was", value: shootDay(m.date) }]),
      ...(sameCall ? [] : [{ label: "Call", value: `${clock(d.call)} (was ${clock(m.call)})` }]),
      { label: "Where", value: samePlace ? `${d.location} (same)` : `${d.location} (was ${m.location})` },
    ] },
    ...(sameCall ? [{ t: "p", text: `Same call time: ${clock(d.call)}.`, tone: "muted" } as Block] : []),
    { t: "p", text: sameDay ? "Please confirm it again in your portal." : "Please confirm the new date in your portal." },
    { t: "button", label: sameDay ? "Confirm the shoot" : "Confirm the new date", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `Now ${shootDay(d.date)} · ${clock(d.call)} call`);
}
export function ownerShootConfirmedMail(b: MailBrand, d: { who: string; project: string; date: string; call: string; link: string }): Mail {
  return mk(b, "updates", `${d.who} confirmed the shoot: ${d.project}`, [
    { t: "eyebrow", text: `${d.who} confirmed the shoot` },
    { t: "title", text: `${shootDay(d.date)} · ${clock(d.call)} call · ${d.project}` },
    { t: "button", label: "Open the project", href: d.link },
  ], ownerFoot("a client confirms a shoot"), `${shootDay(d.date)} · ${d.project}`);
}

// ---------- Phase 4 (742:2616, 742:2642): 31 · Files requested, 32 · Files due tomorrow; the owner's note when files
// arrive (no frame: the owner-alert layout of 26). ----------
/** "Upload your logo and brand guide" → "Logo and brand guide" (the email's For row). */
export const requestFor = (title: string) => { const t = title.replace(/^(please\s+)?(upload|send|share)\s+(us\s+)?(your|the)\s+/i, "").trim() || title; return t[0].toUpperCase() + t.slice(1); };
export function fileRequestMail(b: MailBrand, d: { kind: "asked" | "tomorrow"; name: string | null; project: string; title: string; details: string | null; due: string; uploaded: number; link: string }): Mail {
  const owner = first(b.ownerName) || b.name;
  const due = shootDay(d.due).replace(/^(\w+),/, "$1,");
  if (d.kind === "asked") return mk(b, "updates", `${owner} asked for files: ${requestFor(d.title)}`, [
    hi(d.name),
    { t: "p", text: `${owner} asked for a few files for ${d.project}.` },
    { t: "sums", rows: [{ label: "Due", value: due, big: true }, { label: "For", value: requestFor(d.title) }, { label: "Project", value: d.project }] },
    ...(d.details ? [{ t: "p", text: d.details, tone: "muted" } as Block] : []),
    { t: "p", text: "Upload them in your portal, up to 2 GB a file." },
    { t: "button", label: "Upload files", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `Due ${due} · ${requestFor(d.title)}`);
  return mk(b, "updates", `Reminder: files due tomorrow for ${d.project}`, [
    hi(d.name),
    { t: "p", text: `A reminder: the files for ${d.project} are due tomorrow.` },
    { t: "sums", rows: [{ label: "Due", value: due, big: true }, { label: "For", value: requestFor(d.title) }, { label: "Uploaded so far", value: d.uploaded ? `${d.uploaded} ${d.uploaded === 1 ? "file" : "files"}` : "Nothing yet" }] },
    { t: "p", text: "If you’ve sent them another way, reply and let us know.", tone: "muted" },
    { t: "p", text: "Upload them in your portal." },
    { t: "button", label: "Upload files", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `Due tomorrow · ${requestFor(d.title)}`);
}
export function ownerFilesMail(b: MailBrand, d: { who: string; count: number; title: string; project: string; folder: string; link: string }): Mail {
  return mk(b, "updates", `${d.who} uploaded ${d.count} ${d.count === 1 ? "file" : "files"}: ${requestFor(d.title)}`, [
    { t: "eyebrow", text: `${d.who} uploaded ${d.count === 1 ? "a file" : `${d.count} files`}` },
    { t: "title", text: `${requestFor(d.title)} · ${d.project}` },
    { t: "p", text: `They're in your Dropbox: Apps › Wrangler Review${d.folder.replace(/\//g, " › ")}.` },
    { t: "button", label: "Open the project", href: d.link },
  ], ownerFoot("a client uploads files you asked for"), `${d.count} ${d.count === 1 ? "file" : "files"} · ${d.project}`);
}

// ---------- Phase 4 (Nov 2): the kickoff brief ----------

/** Email 33 (742:2668): "Before we start, tell us about {project}". Also the owner's reminder. */
export function briefMail(b: MailBrand, d: { kind: "sent" | "reminder"; name: string | null; project: string; covers: string; started: boolean; link: string }): Mail {
  const owner = first(b.ownerName) || b.name;
  const reminder = d.kind === "reminder";
  return mk(b, "updates", reminder ? `Reminder: the kickoff brief for ${d.project}` : `Before we start, tell us about ${d.project}`, [
    hi(d.name),
    { t: "p", text: reminder ? `A reminder from ${owner}: the kickoff brief for ${d.project} is still open.` : `Before we start, tell us about ${d.project}.` },
    { t: "sums", rows: [{ label: "Takes", value: "About 10 minutes", big: true }, { label: "Covers", value: d.covers }, { label: "Project", value: d.project }] },
    { t: "p", text: d.started ? "Your answers so far are saved. Pick up where you left off." : "You can save and come back any time.", tone: "muted" },
    { t: "p", text: "Answer it in your portal." },
    { t: "button", label: d.started ? "Finish the brief" : "Start the brief", href: d.link }, { t: "link", href: d.link },
  ], signoff(b), `About 10 minutes · ${d.covers}`);
}
/** To the owner when the brief comes back (or is changed afterwards). */
export function ownerBriefMail(b: MailBrand, d: { who: string; project: string; changed: boolean; answers: Array<{ question: string; answer: string }>; link: string }): Mail {
  const shown = d.answers.slice(0, 6);
  return mk(b, "updates", `${d.who} ${d.changed ? "changed" : "answered"} the kickoff brief: ${d.project}`, [
    { t: "eyebrow", text: `${d.who} ${d.changed ? "changed their answers" : "answered the kickoff brief"}` },
    { t: "title", text: d.project },
    ...(shown.length ? [{ t: "sums", rows: shown.map((a) => ({ label: a.question, value: a.answer.length > 90 ? `${a.answer.slice(0, 88)}…` : a.answer })) } as Block] : []),
    ...(d.answers.length > shown.length ? [{ t: "p", text: `And ${d.answers.length - shown.length} more on the project page.`, tone: "muted" } as Block] : []),
    { t: "button", label: "Open the project", href: d.link },
  ], ownerFoot("a client sends back the kickoff brief"), `${d.answers.length} ${d.answers.length === 1 ? "answer" : "answers"} · ${d.project}`);
}
