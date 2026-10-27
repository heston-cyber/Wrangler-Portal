// Wrangler Sign — PDF handling (Phase S0, Oct 26). Runs in the default Convex runtime and in the browser: no Node APIs.
//
// The uploaded PDF is never redrawn. Signing stamps go on a copy:
//   - boxes are given the way the placement screen sees the page: a page index plus fractions (0..1) of the page as
//     DISPLAYED (top-left origin, after the page's /Rotate and inside its crop box);
//   - each stamp is a PNG (signature, initials — drawn or typed, rendered by the signing page) or a line of text
//     (name, title, date) in Helvetica, so the backend needs no font files;
//   - a marker's own text (e.g. "{{sign:client}}") is painted over in white first (Stamp.cover);
//   - images sit on the box's bottom edge (the signature line); text sits on a baseline just above it;
//   - an audit certificate page is appended at the end.
import { PDFDocument, PDFPage, StandardFonts, degrees, rgb, EncryptedPDFError } from "@cantoo/pdf-lib";

export type Box = { page: number; x: number; y: number; w: number; h: number };
// `cover`: an area painted white first (the marker's own text, e.g. "{{sign:client}}"), separate from where the
// stamp is drawn, so nothing around the marker gets clipped.
export type Stamp =
  | { box: Box; kind: "image"; png: Uint8Array; cover?: Box }
  | { box: Box; kind: "text"; text: string; cover?: Box };

export type PageInfo = { width: number; height: number; rotate: number };
export type Inspection =
  | { ok: true; pages: PageInfo[]; hasForm: boolean; producer?: string }
  | { ok: false; reason: "encrypted" | "unreadable"; detail?: string };

// Fixed dates so the same input always gives the same bytes (T-S0.2).
const FIXED = new Date(Date.UTC(2000, 0, 1));

const rot = (p: PDFPage) => (((p.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;

function displayed(p: PDFPage): PageInfo {
  const c = p.getCropBox();
  const r = rot(p);
  return r % 180 === 0 ? { width: c.width, height: c.height, rotate: r } : { width: c.height, height: c.width, rotate: r };
}

/** A displayed point (dx, dy from the top-left, in points) → PDF user space. */
function toUser(p: PDFPage, dx: number, dy: number): { x: number; y: number } {
  const c = p.getCropBox();
  const cw = c.width, ch = c.height;
  let u: number, v: number;
  switch (rot(p)) {
    case 0: u = dx; v = ch - dy; break;
    case 90: u = dy; v = dx; break;
    case 180: u = cw - dx; v = dy; break;
    default: u = cw - dy; v = ch - dx; break; // 270
  }
  return { x: c.x + u, y: c.y + v };
}

export async function inspect(bytes: Uint8Array): Promise<Inspection> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (e instanceof EncryptedPDFError || /encrypt/i.test(String(e))) return { ok: false, reason: "encrypted" };
    return { ok: false, reason: "unreadable", detail: String(e).slice(0, 160) };
  }
  if (doc.isEncrypted) return { ok: false, reason: "encrypted" };
  let hasForm = false;
  try { hasForm = doc.getForm().getFields().length > 0; } catch { /* no form */ }
  return { ok: true, pages: doc.getPages().map(displayed), hasForm, producer: doc.getProducer() };
}

/** Stamp onto a copy of the PDF and append the certificate. Returns the new bytes. */
export async function stamp(original: Uint8Array, stamps: Stamp[], certificate: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original, { updateMetadata: false });
  if (doc.isEncrypted) throw new Error("This PDF is protected with a password. Export it again without protection.");
  // Form fields stay editable in viewers; flatten them so nothing on a signed copy can be typed over.
  try { const f = doc.getForm(); if (f.getFields().length) f.flatten(); } catch { /* no form */ }
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  // Helvetica covers Western European text only; anything else (an emoji in a title, Cyrillic in a name) would make
  // pdf-lib throw, so it's swapped for "?" rather than failing the whole signed copy.
  const charset = new Set(helv.getCharacterSet());
  const safe = (t: string) => [...t.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')].map((ch) => (charset.has(ch.codePointAt(0)!) ? ch : "?")).join("");
  const pages = doc.getPages();
  const ink = rgb(0.07, 0.12, 0.35);

  for (const s of stamps) {
    const p = pages[s.box.page];
    if (!p) throw new Error(`No page ${s.box.page + 1}`);
    const d = displayed(p);
    const bw = s.box.w * d.width, bh = s.box.h * d.height;
    const dx = s.box.x * d.width, dyBottom = (s.box.y + s.box.h) * d.height; // the box's displayed bottom-left
    const angle = degrees(d.rotate); // draw upright as displayed
    if (s.cover) {
      if (s.cover.page !== s.box.page) throw new Error("A cover must be on the stamp's page");
      const co = toUser(p, s.cover.x * d.width, (s.cover.y + s.cover.h) * d.height);
      p.drawRectangle({ x: co.x, y: co.y, width: s.cover.w * d.width, height: s.cover.h * d.height, rotate: angle, color: rgb(1, 1, 1) });
    }
    if (s.kind === "image") {
      const img = await doc.embedPng(s.png);
      const k = Math.min(bw / img.width, bh / img.height);
      const w = img.width * k, h = img.height * k;
      // Left-aligned and sitting on the box's bottom edge (the signature line), then mapped to user space.
      const o2 = toUser(p, dx, dyBottom);
      p.drawImage(img, { x: o2.x, y: o2.y, width: w, height: h, rotate: angle });
    } else {
      // On a baseline a quarter of the type size above the box's bottom, where a marker's own text sat.
      const size = Math.max(6, Math.min(11, bh * 0.72));
      const o2 = toUser(p, dx + 1, dyBottom - size * 0.25);
      p.drawText(safe(s.text), { x: o2.x, y: o2.y, size, font: helv, color: ink, rotate: angle });
    }
  }

  // The certificate: plain text pages at the end, Letter size.
  const W = 612, H = 792, M = 54, size = 9, lead = 12.5;
  const wrap = (line: string, indent = 0): string[] => {
    const out: string[] = []; let cur = "";
    const fits = (t: string) => helv.widthOfTextAtSize(t, size) <= W - 2 * M - indent;
    const words: string[] = [];
    for (const w of line.split(" ")) {
      // A word wider than the line (a long browser string) is broken into pieces that fit.
      let rest = w;
      while (!fits(rest)) { let n = rest.length - 1; while (n > 1 && !fits(rest.slice(0, n))) n--; words.push(rest.slice(0, n)); rest = rest.slice(n); }
      words.push(rest);
    }
    for (const word of words) {
      const t = cur ? `${cur} ${word}` : word;
      if (!fits(t) && cur) { out.push(cur); cur = word; } else cur = t;
    }
    out.push(cur);
    return out;
  };
  let page = doc.addPage([W, H]);
  let y = H - M;
  // "# Heading" and "## Subheading" lines are drawn in bold; everything else in the body size.
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const raw of certificate) {
    const h = /^(#{1,2}) (.*)$/.exec(raw);
    if (h) {
      const hs = h[1] === "#" ? 13 : 10;
      if (y < M + 3 * lead) { page = doc.addPage([W, H]); y = H - M; }
      if (h[1] === "##" && y < H - M) y -= 4;
      page.drawText(safe(h[2]), { x: M, y, size: hs, font: bold, color: rgb(0.05, 0.05, 0.05) });
      y -= hs + 5;
      continue;
    }
    // A line starting with four spaces is indented (an event's detail under the event).
    const indent = raw.startsWith("    ") ? 14 : 0;
    for (const line of raw === "" ? [""] : wrap(safe(raw.trim()), indent)) {
      if (y < M) { page = doc.addPage([W, H]); y = H - M; }
      page.drawText(line, { x: M + indent, y, size, font: helv, color: indent ? rgb(0.3, 0.3, 0.3) : rgb(0.1, 0.1, 0.1) });
      y -= raw === "" ? lead / 2 : lead;
    }
  }
  // Page numbers on the certificate pages ("Certificate 1 of 2"), so a missing page is obvious.
  const certPages = doc.getPages().slice(pages.length);
  certPages.forEach((cp, i) => cp.drawText(`Wrangler Sign certificate · page ${i + 1} of ${certPages.length}`, { x: M, y: 30, size: 8, font: helv, color: rgb(0.45, 0.45, 0.45) }));

  doc.setModificationDate(FIXED);
  return doc.save({ useObjectStreams: false });
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)); // copy: a plain ArrayBuffer for Web Crypto
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
