// Turning a PDF into an editable builder page (B4, Oct 27). wsNode.extractLines reads each line of text with its
// position, size and boldness (pdf.js); this file decides what each line is: a title, heading, strong line, body
// paragraph (wrapped lines joined back up), caption, bullet or numbered item, and groups each heading with the text
// under it into a section. Repeating headers and footers and page numbers are dropped; {{markers}} become a
// signature block and initialled sections. It's a best guess: the result opens in the builder to check and fix.
import { line, section, type LineAttrs, type PNode, type Page, type TextSize } from "./wsBuilder";

export type PdfLine = { page: number; y: number; x0: number; x1: number; text: string; size: number; bold: boolean; italic: boolean; pageWidth: number; pageHeight: number };
export type ImportResult = { page: Page; notes: string[]; stats: { pages: number; lines: number; paragraphs: number; sections: number; markers: number } };

const MARKER = /\{\{\s*(sign|initials|name|date|title)\s*:\s*([a-z0-9_-]+)\s*\}\}/gi;
const BULLET = /^([•●○◦▪■▫‣⁃–—\-*])\s+/;
const NUMBERED = /^((?:\d{1,2}|[a-z]|[ivx]{1,4})[.)])\s+/i;

function mode(values: number[], weights: number[]): number {
  const m = new Map<number, number>();
  values.forEach((v, i) => m.set(v, (m.get(v) ?? 0) + weights[i]));
  let best = values[0] ?? 0, w = -1;
  for (const [v, c] of m) if (c > w) { best = v; w = c; }
  return best;
}

export function pdfLinesToPage(input: PdfLine[]): ImportResult {
  const notes: string[] = [];
  const pages = new Set(input.map((l) => l.page)).size;
  // Reading order: page by page, top to bottom (pdf y runs up), then left to right.
  let lines = input.filter((l) => l.text.trim()).map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x0 - b.x0);
  if (!lines.length) return { page: { type: "doc", content: [line("")] }, notes: ["No text was found in this PDF (it may be a scan)."], stats: { pages, lines: 0, paragraphs: 0, sections: 0, markers: 0 } };

  // Headers, footers and page numbers: text that repeats near the same height on most pages, or "Page 2 of 5".
  const key = (l: PdfLine) => `${l.text.replace(/\d+/g, "#").toLowerCase()}@${Math.round(l.y / 12)}`;
  if (pages > 1) {
    const seen = new Map<string, Set<number>>();
    for (const l of lines) { const k = key(l); if (!seen.has(k)) seen.set(k, new Set()); seen.get(k)!.add(l.page); }
    const before = lines.length;
    lines = lines.filter((l) => (seen.get(key(l))!.size < Math.max(2, Math.ceil(pages * 0.6)) || l.text.length > 120));
    if (lines.length < before) notes.push(`Left out ${before - lines.length} repeating header/footer lines.`);
  }
  lines = lines.filter((l) => !/^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(l.text) || (l.y > l.pageHeight * 0.1 && l.y < l.pageHeight * 0.9));

  // Signature markers: kept out of the text, turned into a signature block (and initials on their section).
  let markers = 0;
  const signers = new Set<string>();
  const initialsAt = new Set<number>(); // line index that carried an initials marker
  lines = lines.map((l, i) => {
    let t = l.text;
    for (const m of t.matchAll(MARKER)) {
      markers++;
      const kind = m[1].toLowerCase(), who = m[2].toLowerCase() === "owner" ? "heston" : m[2].toLowerCase();
      if (kind === "initials") initialsAt.add(i); else signers.add(who);
    }
    t = t.replace(MARKER, "").replace(/\s{2,}/g, " ").trim();
    return { ...l, text: t };
  });

  const round = (n: number) => Math.round(n * 2) / 2;
  const body = mode(lines.map((l) => round(l.size)), lines.map((l) => l.text.length)) || 10;
  const left = mode(lines.map((l) => Math.round(l.x0)), lines.map((l) => l.text.length));
  const rightOf = new Map<number, number>();
  for (const p of new Set(lines.map((l) => l.page))) {
    const xs = lines.filter((l) => l.page === p).map((l) => l.x1).sort((a, b) => a - b);
    rightOf.set(p, xs[Math.floor(xs.length * 0.9)] ?? xs[xs.length - 1] ?? 0);
  }

  type Item = { style: TextSize; text: string; attrs: LineAttrs; list?: "bullet" | "ordered"; indent: number; initials: boolean; src: PdfLine };
  const items: Item[] = [];
  let titled = false;
  lines.forEach((l, idx) => {
    // A line that was only an initials marker initials the text above it.
    if (!l.text) { if (initialsAt.has(idx) && items.length) items[items.length - 1].initials = true; return; }
    const ratio = l.size / body;
    const caps = l.text.length <= 70 && /[A-Z]/.test(l.text) && l.text === l.text.toUpperCase() && /[A-Z]{3}/.test(l.text);
    const short = l.text.length <= 90;
    let style: TextSize = "body";
    if (ratio >= 1.6 && !titled) { style = "title"; titled = true; }
    else if (ratio >= 1.6) style = "heading";
    else if (ratio >= 1.25) style = l.bold ? "heading" : "subtitle";
    else if (ratio >= 1.08 && short) style = "heading";
    else if ((l.bold || caps) && short && !/[.,;]$/.test(l.text) && ratio > 0.9) style = "heading";
    else if (l.bold && ratio > 0.9) style = "strong";
    else if (ratio <= 0.88) style = "caption";
    let text = l.text, list: Item["list"];
    if (style === "body" || style === "strong" || style === "caption") {
      if (BULLET.test(text)) { list = "bullet"; text = text.replace(BULLET, ""); }
      else if (NUMBERED.test(text) && text.length > 4) { list = "ordered"; text = text.replace(NUMBERED, ""); }
    }
    // Centred: well clear of the left margin and balanced around the page's middle.
    const mid = (l.x0 + l.x1) / 2, centre = l.pageWidth / 2;
    const attrs: LineAttrs = {};
    if (l.x0 > left + 24 && Math.abs(mid - centre) < l.pageWidth * 0.04 && l.x1 - l.x0 < l.pageWidth * 0.7) attrs.align = "center";
    items.push({ style, text, attrs, list, indent: Math.max(0, Math.round((l.x0 - left) / 18)), initials: initialsAt.has(idx), src: l });
  });

  // Join wrapped lines back into paragraphs: same style, close below, and the line above ran to the right edge (or
  // didn't end a sentence).
  type Para = Item & { lines: number };
  const paras: Para[] = [];
  for (const it of items) {
    const prev = paras[paras.length - 1];
    if (prev && !it.list && prev.style === it.style && it.style !== "title" && it.style !== "heading" && it.style !== "subtitle" && !it.attrs.align && !prev.attrs.align) {
      const p = prev.src;
      const samePage = p.page === it.src.page;
      const gap = samePage ? p.y - it.src.y : Infinity;
      const full = p.x1 >= (rightOf.get(p.page) ?? 0) - body * 2.5;
      const nextPageTop = !samePage && it.src.page === p.page + 1 && it.src.y > it.src.pageHeight * 0.75;
      // A line after a sentence's end starts a new paragraph when it's short (a one-line paragraph, or a label).
      const ended = /[.:;!?)"”]$/.test(prev.text);
      const nextShort = it.src.x1 < (rightOf.get(it.src.page) ?? 0) - it.src.pageWidth * 0.2;
      const continues = (samePage && gap > 0 && gap <= it.src.size * 1.75 && (!ended || (full && !nextShort))) || (nextPageTop && full && !ended);
      const isListCont = !!prev.list && it.indent >= 1 && samePage && gap <= it.src.size * 1.75;
      if (continues || isListCont) {
        prev.text = /[a-z]-$/.test(prev.text) && /^[a-z]/.test(it.text) ? prev.text.slice(0, -1) + it.text : `${prev.text} ${it.text}`;
        prev.src = { ...it.src, x0: prev.src.x0 };
        prev.lines++;
        prev.initials = prev.initials || it.initials;
        continue;
      }
    }
    paras.push({ ...it, lines: 1 });
  }

  // Nodes, with lists gathered and each heading's text grouped into a section.
  const nodeOf = (p: Para): PNode => ({ type: "paragraph", attrs: { size: p.style, ...p.attrs }, ...(p.text ? { content: [{ type: "text", text: p.text }] } : {}) });
  const top: PNode[] = [];
  let sec: PNode | null = null;
  let sectionCount = 0;
  const push = (n: PNode) => (sec ? sec.content!.push(n) : top.push(n));
  let list: { node: PNode; ordered: boolean } | null = null;
  for (const p of paras) {
    if (p.style === "heading") {
      list = null;
      if (sec) top.push(sec);
      sec = section([nodeOf(p)], { initials: p.initials }); sectionCount++;
      continue;
    }
    if (p.style === "title" || p.style === "subtitle") { list = null; if (sec) { top.push(sec); sec = null; } top.push(nodeOf(p)); continue; }
    if (sec && p.initials) sec.attrs = { ...sec.attrs, initials: true };
    if (p.list) {
      const ordered = p.list === "ordered";
      const li: PNode = { type: "listItem", content: [nodeOf({ ...p, style: p.style })] };
      if (list && list.ordered === ordered) list.node.content!.push(li);
      else { list = { node: { type: ordered ? "orderedList" : "bulletList", content: [li] }, ordered }; push(list.node); }
      continue;
    }
    list = null;
    push(nodeOf(p));
  }
  if (sec) top.push(sec);
  if (signers.size) {
    const order = ["heston", ...[...signers].filter((s) => s !== "heston").sort()].filter((s) => signers.has(s));
    top.push(line("Signatures", { size: "heading" }), { type: "signatures", attrs: { signers: order, showTitle: true, showDate: true } });
    notes.push(`Found signature markers for ${order.join(", ")}: they're a signature block at the end now.`);
  }
  if (!titled && top[0]?.type === "paragraph") notes.push("No title stood out by size; the first line may need Ctrl+1.");
  return { page: { type: "doc", content: top.length ? top : [line("")] }, notes, stats: { pages, lines: input.length, paragraphs: paras.length, sections: sectionCount, markers } };
}
