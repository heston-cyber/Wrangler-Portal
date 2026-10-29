// Phase 1 step 5 (Oct 29): every email in the approved look (page "S5 · Emails" and the Inbox alert on "S5 · Phase 1").
// One renderer: a dark 600 px card with the business's logo and accent, built from blocks, plus a plain-text twin made
// from the same blocks (mail filters trust text + HTML more than HTML alone). Inline styles and tables only, so it
// survives Gmail, Outlook and Apple Mail.
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { businessContact, defaultBusiness } from "./business";
import { textOn } from "./color";
import { SITE } from "./site";

export type MailBrand = {
  name: string;            // "Wrangler Productions"
  fromName: string;        // the sender's display name (Settings › Business › Email from-name, else the name)
  footerName: string;      // "Wrangler Productions, a DBA of Hill Creative LLC"
  replyTo: string;         // where replies go
  accent: string;          // "#FF0000"
  onAccent: string;        // button text on the accent
  logoUrl: string;         // the logo on dark (hosted)
  isDefault: boolean;      // Wrangler: no "Powered by" line
  ownerName: string | null; // "Heston Hill": who "shared" and "sent" things in client emails
};

export type Block =
  | { t: "p"; text: string; tone?: "primary" | "muted" }
  | { t: "small"; text: string; link?: { label: string; href: string } }
  | { t: "eyebrow"; text: string }                          // "A NOTE FROM WRANGLER PRODUCTIONS" with the mail icon
  | { t: "title"; text: string }                            // the note's title
  | { t: "button"; label: string; href: string }
  | { t: "link"; href: string; full?: boolean }                             // the address under a button, in the accent
  | { t: "code"; code: string }                             // six boxes
  | { t: "image"; src: string; alt: string; href?: string } // a version's picture
  | { t: "quote"; rows: Array<{ who: string; text: string }> } // a note and its reply
  | { t: "card"; meta: string; text: string; href?: string } // one client note in the owner's alert
  | { t: "box"; text: string }                              // one line in a dark box ("Reason: …", the draft invoice)
  | { t: "file"; name: string; meta: string }               // the attached PDF
  | { t: "list"; items: string[] }                          // "Signed by:" names, with accent dots
  | { t: "mono"; text: string }                             // a fingerprint, in the accent
  | { t: "divider" };

const C = { bg: "#030104", edge: "#2A2829", primary: "#F4F1E9", muted: "#C6C3BC", secondary: "#8D8A86", block: "#0F0D10" };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif";
const TITLE = "'Industry','Saira',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = TITLE; // the design's "mono" style is the title face

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const nl = (s: string) => esc(s).replace(/\n/g, "<br>");
/** "app.wranglerportal.com/s/q8Hf2kLm…/v/…": the address as the design shows it, short and without https://. */
export function shortLink(href: string) {
  const bare = href.replace(/^https?:\/\//, "");
  if (bare.length <= 48) return bare;
  const parts = bare.split("/");
  return parts.map((p, i) => (i === 0 ? p : p.length > 10 ? `${p.slice(0, 8)}…` : p)).join("/").slice(0, 60);
}

/** The brand for a business row (or the default when there is none). */
export function brandFrom(b: { name?: string; legalName?: string | null; ownerName?: string | null; emailFromName?: string | null; replyTo?: string | null; accent?: string | null } | null, opts: { ownerEmail: string; logoUrl: string | null; isDefault: boolean }): MailBrand {
  const name = b?.name ?? "Wrangler Productions";
  const legal = b?.legalName?.trim();
  const accent = b?.accent ?? "#FF0000";
  // Wrangler keeps light text on red (approved exception); every other business gets what reaches 4.5:1.
  const onAccent = opts.isDefault && !b?.accent ? "#F4F1E9" : textOn(accent).text;
  return {
    name, fromName: b?.emailFromName?.trim() || name,
    // "Wrangler Productions, a DBA of Hill Creative LLC"; a legal name that already includes the name stands alone.
    footerName: !legal || legal === name ? name : legal.toLowerCase().includes(name.toLowerCase()) ? legal : `${name}, a DBA of ${legal}`,
    replyTo: b?.replyTo?.trim() || opts.ownerEmail, accent, onAccent,
    logoUrl: opts.logoUrl ?? `${SITE()}/brand/wp-logo-email.png`, isDefault: opts.isDefault,
    ownerName: b?.ownerName?.trim() || (opts.isDefault ? "Heston Hill" : null),
  };
}

/** "Wrangler Productions <review@wranglerportal.com>": the business's name on one of the portal's sending addresses. */
export function fromLine(brand: MailBrand, address: "review" | "contracts" | "updates") {
  const name = brand.fromName.replace(/["\\<>\r\n]/g, "").trim() || "WranglerPortal";
  // A plain word-only name goes as is; anything with commas, colons and the like is quoted (RFC 5322).
  return /^[\p{L}\p{N} &'\-]+$/u.test(name) ? `${name} <${address}@wranglerportal.com>` : `"${name}" <${address}@wranglerportal.com>`;
}

function blockHtml(b: Block, brand: MailBrand): string {
  const p = (text: string, color: string, size = 15, lh = 22.5) => `<p style="margin:0;font:400 ${size}px/${lh}px ${FONT};color:${color}">${text}</p>`;
  switch (b.t) {
    case "p": return p(nl(b.text), b.tone === "muted" ? C.muted : C.primary);
    case "small": return p(`${nl(b.text)}${b.link ? ` <a href="${esc(b.link.href)}" style="color:${C.secondary};text-decoration:underline">${esc(b.link.label)}</a>` : ""}`, C.secondary, 13, 18.85);
    case "eyebrow": return `<p style="margin:0;font:500 12px/15.6px ${TITLE};letter-spacing:.48px;text-transform:uppercase;color:${brand.accent}">&#9993;&nbsp;&nbsp;${esc(b.text)}</p>`;
    case "title": return `<p style="margin:0;font:600 20px/23.6px ${TITLE};color:${C.primary}">${esc(b.text)}</p>`;
    case "button": return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:12px;background:${brand.accent}"><a href="${esc(b.href)}" style="display:inline-block;padding:13px 20px;font:400 15px/18px ${TITLE};color:${brand.onAccent};text-decoration:none;border-radius:12px">${esc(b.label)}</a></td></tr></table>`;
    case "link": return `<p style="margin:0;font:400 13px/18.2px ${MONO};word-break:break-all"><a href="${esc(b.href)}" style="color:${brand.accent};text-decoration:none">${esc(b.full ? b.href.replace(/^https?:\/\//, "") : shortLink(b.href))}</a></p>`;
    case "code": return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${[...b.code].map((d) => `<td style="padding:0 8px 0 0"><div style="width:42px;height:50px;line-height:50px;text-align:center;border:1px solid ${C.edge};border-radius:10px;background:${C.block};font:600 22px/50px ${TITLE};color:${C.primary}">${esc(d)}</div></td>`).join("")}</tr></table>`;
    case "image": {
      const img = `<img src="${esc(b.src)}" alt="${esc(b.alt)}" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0;border-radius:12px">`;
      return b.href ? `<a href="${esc(b.href)}">${img}</a>` : img;
    }
    case "quote": return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.block};border-radius:10px"><tr><td style="padding:14px 16px">${b.rows.map((r, i) =>
      `<div style="border-left:2px solid ${brand.accent};padding:0 0 0 12px;${i ? "margin-top:12px" : ""}"><p style="margin:0 0 2px;font:400 12px/16px ${FONT};color:${C.secondary}">${esc(r.who)}</p>${p(nl(r.text), C.primary, 14, 21)}</div>`).join("")}</td></tr></table>`;
    case "card": return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.block};border-radius:10px"><tr><td style="padding:12px 16px">
      <p style="margin:0 0 4px;font:400 12px/16px ${FONT};color:${C.secondary}">${esc(b.meta)}</p>${p(nl(b.text), C.primary, 14, 21)}${b.href ? `<p style="margin:4px 0 0;font:400 12px/16px ${MONO}"><a href="${esc(b.href)}" style="color:${brand.accent};text-decoration:none">${esc(shortLink(b.href))}</a></p>` : ""}</td></tr></table>`;
    case "box": return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.block};border:1px solid ${C.edge};border-radius:12px"><tr><td style="padding:14px 16px">${p(nl(b.text), C.primary)}</td></tr></table>`;
    case "file": return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.block};border:1px solid ${C.edge};border-radius:12px"><tr>
      <td width="36" style="padding:14px 0 14px 16px;vertical-align:middle;font:400 18px/18px ${FONT};color:${brand.accent}">&#128196;</td>
      <td style="padding:14px 16px 14px 0;vertical-align:middle"><p style="margin:0;font:500 14px/20px ${FONT};color:${C.primary};word-break:break-all">${esc(b.name)}</p><p style="margin:0;font:400 12px/16px ${FONT};color:${C.secondary}">${esc(b.meta)}</p></td></tr></table>`;
    case "list": return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">${b.items.map((x) => `<tr><td style="padding:0 10px 10px 0;vertical-align:top"><div style="width:6px;height:6px;margin-top:8px;border-radius:3px;background:${brand.accent}"></div></td><td style="padding:0 0 10px;font:400 15px/22.5px ${FONT};color:${C.primary}">${esc(x)}</td></tr>`).join("")}</table>`;
    case "mono": return `<p style="margin:0;font:400 13px/18.2px ${MONO};color:${brand.accent};word-break:break-all">${esc(b.text)}</p>`;
    case "divider": return `<div style="height:1px;line-height:1px;font-size:1px;background:${C.edge}">&nbsp;</div>`;
  }
}

function blockText(b: Block): string {
  switch (b.t) {
    case "p": return b.text;
    case "small": return b.link ? `${b.text} ${b.link.href}` : b.text;
    case "eyebrow": return b.text;
    case "title": return b.text;
    case "button": return `${b.label}: ${b.href}`;
    case "link": return "";
    case "code": return b.code;
    case "image": return "";
    case "quote": return b.rows.map((r) => `  ${r.who}: ${r.text}`).join("\n");
    case "card": return [b.meta, `  ${b.text}`, b.href ? `  ${b.href}` : ""].filter(Boolean).join("\n");
    case "box": return b.text;
    case "file": return `Attached: ${b.name} (${b.meta})`;
    case "list": return b.items.map((x) => `- ${x}`).join("\n");
    case "mono": return b.text;
    case "divider": return "";
  }
}

/** The whole email. `preheader` is the grey line inbox lists show after the subject. */
export function renderMail(brand: MailBrand, blocks: Block[], opts: { preheader?: string; footer?: Block[] } = {}) {
  const all = [...blocks, ...(opts.footer?.length ? [{ t: "divider" } as Block, ...opts.footer] : [])];
  const rows = all.map((b) => `<tr><td style="padding:0 0 18px">${blockHtml(b, brand)}</td></tr>`).join("");
  const logo = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="padding:0 12px 0 0;vertical-align:middle"><div style="width:12px;height:12px;border-radius:6px;background:${brand.accent}"></div></td>
    <td style="vertical-align:middle"><img src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" height="24" style="display:block;height:24px;width:auto;border:0"></td></tr></table>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title></title></head>
<body style="margin:0;padding:0;background:${C.bg}">
${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${esc(opts.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${C.bg};border:1px solid ${C.edge};border-radius:16px">
<tr><td style="padding:36px 40px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:0 0 18px">${logo}</td></tr>
${rows}
</table></td></tr></table></td></tr></table></body></html>`;
  const text = all.map(blockText).filter((s, i, a) => s !== "" || (i > 0 && a[i - 1] !== "")).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return { html, text };
}

/** Client emails end "— WranglerPortal" (and the unsubscribe line); other businesses also say "Powered by". */
export function clientFooter(brand: MailBrand, unsubscribe?: { what: string; href: string }): Block[] {
  return [
    { t: "small", text: "— WranglerPortal" },
    ...(unsubscribe ? [{ t: "small", text: `Stop emails about ${unsubscribe.what}:`, link: { label: "unsubscribe", href: unsubscribe.href } } as Block] : []),
    ...(!brand.isDefault ? [{ t: "small", text: "Powered by WranglerPortal" } as Block] : []),
  ];
}

/** The brand for one business, read inside a query or mutation. */
export async function mailBrandOf(ctx: QueryCtx, businessId: Id<"businesses"> | null | undefined): Promise<MailBrand> {
  const c = await businessContact(ctx, businessId ?? null);
  const b = c.businessId ? await ctx.db.get(c.businessId) : await defaultBusiness(ctx);
  const logoUrl = b?.logoFileId ? await ctx.storage.getUrl(b.logoFileId) : null;
  return brandFrom(b ? { ...b, legalName: b.legalName ?? c.legalName } : { name: c.name, legalName: c.legalName }, { ownerEmail: c.ownerEmail, logoUrl, isDefault: c.isDefault });
}
