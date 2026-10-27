// "Page markdown" (B4, Oct 27): the builder's page as plain text, so Claude can read, write and edit documents through
// the connector. One source line is one line on the page (blank lines just separate):
//
//   # Title            ## Subtitle        ### Heading        #### Strong line    ~ Caption (fine print)
//   Body text, with **bold**, *italic*, __underline__ and ~~strike~~, and fill-in fields like {client.name}.
//   - bullet   (two spaces in per level)      1. numbered
//   A line can end with settings: {: align=center color=accent deco=focus font=heading}
//   (align: left|center|right|justify · color: accent or #hex · deco: focus|block · font: heading|body)
//   \                  an empty line
//
//   :::section initials        a container (a clause; "initials" asks the client to initial it)
//   ### Payment terms
//   The deposit is due on signing.
//   :::                        (":::card" is a tinted container)
//
//   [[parties]]  [[divider]]  [[pagebreak]]  [[space 18]]
//   [[items]] followed by rows: | Video production | 1 | 4800 |
//   [[payment deposit=25 invoice=yes initials=yes]]
//   [[signatures heston client title=yes date=yes]]
import { line, newId, section, type ItemRow, type LineAttrs, type PNode, type Page, type RichMark, type TextSize } from "./wsBuilder";

const PREFIX: Array<[RegExp, TextSize]> = [[/^####\s+/, "strong"], [/^###\s+/, "heading"], [/^##\s+/, "subtitle"], [/^#\s+/, "title"], [/^~\s+/, "caption"]];
const PREFIX_OF: Record<TextSize, string> = { title: "# ", subtitle: "## ", heading: "### ", strong: "#### ", body: "", caption: "~ " };

// ---------- inline: marks ----------

const MARK_RE = /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*|__(?=\S)([\s\S]+?)(?<=\S)__|~~(?=\S)([\s\S]+?)(?<=\S)~~|(?<![*\\])\*(?=[^\s*])([\s\S]+?)(?<=[^\s\\])\*(?!\*)/;
const MARK_OF = ["bold", "underline", "strike", "italic"];
function inline(s: string, marks: RichMark[] = []): PNode[] {
  const out: PNode[] = [];
  let rest = s;
  while (rest) {
    const m = MARK_RE.exec(rest);
    if (!m) { out.push(textNode(rest, marks)); break; }
    if (m.index) out.push(textNode(rest.slice(0, m.index), marks));
    const k = [1, 2, 3, 4].find((i) => m[i] !== undefined)!;
    out.push(...inline(m[k], [...marks, { type: MARK_OF[k - 1] }]));
    rest = rest.slice(m.index + m[0].length);
  }
  return out.filter((n) => n.text);
}
const textNode = (t: string, marks: RichMark[]): PNode => ({ type: "text", text: t.replace(/\\([*_~\\])/g, "$1"), ...(marks.length ? { marks } : {}) });

function inlineOut(nodes: PNode[] | undefined): string {
  const esc = (t: string) => t.replace(/([*\\]|__|~~)/g, (x) => (x.length === 2 ? `\\${x[0]}\\${x[1]}` : `\\${x}`));
  // Neighbouring runs with the same marks are written as one.
  const runs: Array<{ text: string; marks: string[] }> = [];
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") { runs.push({ text: " ", marks: [] }); continue; }
    if (n.type !== "text") continue;
    const marks = (n.marks ?? []).map((x) => x.type).filter((t) => MARK_OF.includes(t)).sort();
    const last = runs[runs.length - 1];
    if (last && last.marks.join() === marks.join()) last.text += n.text ?? "";
    else runs.push({ text: n.text ?? "", marks });
  }
  const wrap: Record<string, string> = { bold: "**", italic: "*", underline: "__", strike: "~~" };
  return runs.map((r) => {
    let t = esc(r.text);
    // Spaces stay outside the markers (markdown won't close a mark after a space).
    const lead = t.match(/^\s*/)![0], trail = t.match(/\s*$/)![0];
    t = t.trim();
    if (!t) return r.text;
    for (const mk of ["strike", "underline", "italic", "bold"]) if (r.marks.includes(mk)) t = `${wrap[mk]}${t}${wrap[mk]}`;
    return lead + t + trail;
  }).join("");
}

// ---------- lines ----------

function settings(s: string): { text: string; attrs: LineAttrs } {
  const m = /\s*\{:\s*([^}]*)\}\s*$/.exec(s);
  if (!m) return { text: s, attrs: {} };
  const attrs: LineAttrs = {};
  for (const kv of m[1].trim().split(/\s+/)) {
    const [k, v] = kv.split("=");
    if (!v) continue;
    if (k === "align" && ["left", "center", "right", "justify"].includes(v)) attrs.align = v === "left" ? null : (v as LineAttrs["align"]);
    if (k === "color" && (v === "accent" || /^#[0-9a-f]{3,8}$/i.test(v))) attrs.color = v;
    if (k === "deco" && (v === "focus" || v === "block")) attrs.deco = v;
    if (k === "font" && (v === "heading" || v === "body")) attrs.font = v;
  }
  return { text: s.slice(0, m.index), attrs };
}
function settingsOut(a: Record<string, unknown> | undefined): string {
  if (!a) return "";
  const parts = [a.align && a.align !== "left" ? `align=${a.align}` : "", a.color ? `color=${a.color}` : "", a.deco ? `deco=${a.deco}` : "", a.font ? `font=${a.font}` : ""].filter(Boolean);
  return parts.length ? ` {: ${parts.join(" ")}}` : "";
}

function lineFrom(src: string): PNode {
  let size: TextSize = "body", s = src;
  for (const [re, z] of PREFIX) if (re.test(s)) { size = z; s = s.replace(re, ""); break; }
  const { text, attrs } = settings(s);
  const t = text === "\\" ? "" : text;
  return { type: "paragraph", attrs: { size, ...attrs }, ...(t ? { content: inline(t) } : {}) };
}

// ---------- special blocks ----------

const yes = (v: string | undefined, def: boolean) => (v === undefined ? def : /^(yes|true|on|1)$/i.test(v));
function atomFrom(src: string, rows: string[]): PNode | null {
  const m = /^\[\[\s*(\w+)\s*([^\]]*)\]\]\s*$/.exec(src);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const words = m[2].trim().split(/\s+/).filter(Boolean);
  const kv: Record<string, string> = {};
  const bare: string[] = [];
  for (const w of words) { const [k, v] = w.split("="); if (v !== undefined) kv[k.toLowerCase()] = v; else bare.push(k.toLowerCase()); }
  switch (name) {
    case "parties": return { type: "parties", attrs: {} };
    case "divider": return { type: "divider", attrs: {} };
    case "pagebreak": case "page": return { type: "pagebreak", attrs: {} };
    case "space": case "spacer": return { type: "spacer", attrs: { size: Math.max(4, Math.min(200, Number(bare[0] ?? kv.size) || 18)) } };
    case "items": {
      const parsed: ItemRow[] = rows.map((r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()))
        .filter((c) => c.length && !/^(description|item)$/i.test(c[0]) && !/^-{3,}$/.test(c[0]))
        .map((c) => ({ id: newId(), description: c[0] ?? "", qty: Number((c[1] ?? "1").replace(/[^0-9.]/g, "")) || 0, rate: Number((c[2] ?? "0").replace(/[^0-9.]/g, "")) || 0 }));
      return { type: "items", attrs: { rows: parsed.length ? parsed : [{ id: newId(), description: "", qty: 1, rate: 0 }] } };
    }
    case "payment": return { type: "payment", attrs: { depositPct: Math.max(0, Math.min(100, Number(kv.deposit ?? 25) || 0)), invoiceDeposit: yes(kv.invoice, true), initials: yes(kv.initials, false) } };
    case "signatures": {
      const signers = bare.filter((w) => w === "heston" || /^client\d*$/.test(w));
      return { type: "signatures", attrs: { signers: signers.length ? signers : ["heston", "client"], showTitle: yes(kv.title, true), showDate: yes(kv.date, true) } };
    }
    default: return null;
  }
}
function atomOut(n: PNode): string[] {
  const a = n.attrs ?? {};
  switch (n.type) {
    case "parties": case "divider": case "pagebreak": return [`[[${n.type}]]`];
    case "spacer": return [`[[space ${Number(a.size) || 18}]]`];
    case "items": return ["[[items]]", ...((a.rows as ItemRow[]) ?? []).map((r) => `| ${r.description.replace(/\|/g, "/")} | ${r.qty} | ${r.rate} |`)];
    case "payment": return [`[[payment deposit=${Number(a.depositPct) || 0} invoice=${a.invoiceDeposit ? "yes" : "no"} initials=${a.initials ? "yes" : "no"}]]`];
    case "signatures": return [`[[signatures ${((a.signers as string[]) ?? []).join(" ")} title=${a.showTitle === false ? "no" : "yes"} date=${a.showDate === false ? "no" : "yes"}]]`];
    default: return [];
  }
}

// ---------- the whole page ----------

/** Page markdown → a page. Unknown [[blocks]] and stray ::: are kept as text, so nothing is lost silently. */
export function pageFromMarkdown(md: string): Page {
  const src = md.replace(/\r\n?/g, "\n").split("\n");
  const top: PNode[] = [];
  let into: PNode[] = top;
  let sec: PNode | null = null;
  // Lists: a stack of (indent, list node).
  let lists: Array<{ indent: number; node: PNode }> = [];
  const endLists = () => { lists = []; };
  for (let i = 0; i < src.length; i++) {
    const raw = src[i];
    if (!raw.trim()) { endLists(); continue; }
    const t = raw.trim();
    const open = /^:::\s*(section|card|clause)\b(.*)$/i.exec(t);
    if (open && !sec) {
      endLists();
      const flags = open[2].toLowerCase();
      sec = section([], { look: open[1].toLowerCase() === "card" ? "card" : "plain", initials: /\binitials\b/.test(flags) });
      into = sec.content!;
      continue;
    }
    if (/^:::\s*$/.test(t) && sec) {
      endLists();
      if (!sec.content!.length) sec.content!.push(line(""));
      top.push(sec); sec = null; into = top;
      continue;
    }
    if (/^\[\[/.test(t)) {
      const rows: string[] = [];
      if (/^\[\[\s*items\b/i.test(t)) while (i + 1 < src.length && /^\s*\|/.test(src[i + 1])) rows.push(src[++i]);
      const a = atomFrom(t, rows);
      if (a) { endLists(); into.push(a); continue; }
    }
    const li = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(raw);
    if (li && !/^\s*\*\*/.test(raw.slice(li[1].length))) {
      const indent = Math.floor(li[1].replace(/\t/g, "  ").length / 2);
      const ordered = /\d/.test(li[2]);
      const item: PNode = { type: "listItem", content: [lineFrom(li[3])] };
      while (lists.length && lists[lists.length - 1].indent > indent) lists.pop();
      const cur = lists[lists.length - 1];
      if (cur && cur.indent === indent && (cur.node.type === "orderedList") === ordered) { cur.node.content!.push(item); continue; }
      if (cur && cur.indent < indent) {
        // A nested list goes inside the last item of the list above.
        const parentItem = cur.node.content![cur.node.content!.length - 1];
        const nl: PNode = { type: ordered ? "orderedList" : "bulletList", content: [item] };
        parentItem.content!.push(nl);
        lists.push({ indent, node: nl });
        continue;
      }
      const nl: PNode = { type: ordered ? "orderedList" : "bulletList", content: [item] };
      while (lists.length && lists[lists.length - 1].indent >= indent) lists.pop();
      into.push(nl);
      lists.push({ indent, node: nl });
      continue;
    }
    endLists();
    into.push(lineFrom(t));
  }
  if (sec) { if (!sec.content!.length) sec.content!.push(line("")); top.push(sec); }
  return { type: "doc", content: top.length ? top : [line("")] };
}

/** A page → page markdown (what get_draft returns, for Claude to read and edit). */
export function pageToMarkdown(page: Page): string {
  const out: string[] = [];
  const lineOut = (n: PNode) => {
    const a = n.attrs ?? {};
    const text = inlineOut(n.content);
    return `${PREFIX_OF[(a.size as TextSize) ?? "body"] ?? ""}${text || (a.size && a.size !== "body" ? "" : "\\")}${settingsOut(a)}`;
  };
  const list = (n: PNode, depth: number) => {
    (n.content ?? []).forEach((li, i) => {
      const [first, ...rest] = li.content ?? [];
      out.push(`${"  ".repeat(depth)}${n.type === "orderedList" ? `${i + 1}.` : "-"} ${first ? lineOut(first) : ""}`);
      for (const r of rest) if (r.type === "bulletList" || r.type === "orderedList") list(r, depth + 1); else if (r.type === "paragraph") out.push(`${"  ".repeat(depth + 1)}- ${lineOut(r)}`);
    });
  };
  const block = (n: PNode) => {
    if (n.type === "paragraph") out.push(lineOut(n));
    else if (n.type === "bulletList" || n.type === "orderedList") { list(n, 0); out.push(""); }
    else if (n.type === "section") {
      const a = n.attrs ?? {};
      out.push("", `:::${a.look === "card" ? "card" : "section"}${a.initials ? " initials" : ""}`);
      for (const c of n.content ?? []) block(c);
      if (out[out.length - 1] === "") out.pop();
      out.push(":::", "");
    } else out.push(...atomOut(n));
  };
  for (const n of page.content ?? []) block(n);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** A short guide to the format, for the connector's tool descriptions. */
export const PAGE_MARKDOWN_GUIDE = "Page markdown: one line per line on the page. # Title, ## Subtitle, ### Heading, #### Strong line, ~ Caption (fine print), plain text is Body; **bold**, *italic*, __underline__, ~~strike~~ inside lines; \"- \" bullets and \"1. \" numbers (2 spaces per level); a line can end with {: align=center color=accent deco=focus font=heading}; a line with just \\ is an empty line. Containers: \":::section\" (a clause; \":::section initials\" asks the client to initial it) or \":::card\", ended by \":::\". Special blocks on their own line: [[parties]], [[items]] followed by rows \"| description | qty | rate |\", [[payment deposit=25 invoice=yes initials=no]], [[signatures heston client title=yes date=yes]] (client2… for more clients), [[divider]], [[pagebreak]], [[space 18]]. Fill-in fields: {client.name}, {client.company}, {project}, {date}, {total}, {deposit}, {balance}, {deposit.percent}, {balance.percent}, {business.name}, and custom ones.";
