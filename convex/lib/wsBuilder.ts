// Wrangler Sign doc builder (B2–B3, Oct 27): the shape of a built document, shared by the page, the PDF renderer
// and the backend. A document is a list of blocks, the fill-in fields, the client signers and a style.
//
// Fill-in fields are written in text as {client.name}, {project}, {total} … (single braces). Signature markers, which
// the renderer adds itself, use double braces ({{sign:client}}), so the two never mix.

// ---------- text ----------

// Rich text is Tiptap's JSON (paragraphs, bullet and numbered lists, hard breaks; bold, italic, underline).
export type RichMark = { type: "bold" | "italic" | "underline" | string };
export type RichNode = { type: string; text?: string; marks?: RichMark[]; content?: RichNode[]; attrs?: Record<string, unknown> };
export type Rich = { type: "doc"; content: RichNode[] };

export const rich = (...paras: string[]): Rich => ({ type: "doc", content: paras.map((p) => (p ? { type: "paragraph", content: [{ type: "text", text: p }] } : { type: "paragraph" })) });
export const bullets = (items: string[]): RichNode => ({ type: "bulletList", content: items.map((t) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] })) });

// ---------- the page (E1, Oct 27: one Craft-style editor) ----------
//
// A page is Tiptap/ProseMirror JSON. Every line is its own block (a paragraph with a text style: title, subtitle,
// heading, strong, body or caption, plus alignment, colour, a decoration and a font). Lines can sit in bullet or
// numbered lists, and in containers ("section": a clause, or a card), which hold lines and the special blocks. The
// special blocks (parties, line items, payment, signatures, divider, page break, space) are atoms with settings.
// Older documents were a list of blocks (V1Block, below); pageOf() converts them when they're opened.

export type TextSize = "title" | "subtitle" | "heading" | "strong" | "body" | "caption";
export const TEXT_SIZES: Array<{ key: TextSize; label: string; hint: string }> = [
  { key: "title", label: "Title", hint: "H1" }, { key: "subtitle", label: "Subtitle", hint: "H2" }, { key: "heading", label: "Heading", hint: "H3" },
  { key: "strong", label: "Strong", hint: "Bolded" }, { key: "body", label: "Body", hint: "Regular text size" }, { key: "caption", label: "Caption", hint: "Fine print" },
];
export type Fmt = {
  align?: "left" | "center" | "right" | "justify";
  color?: string;                       // a hex colour, or "accent"
  deco?: "none" | "focus" | "block";    // Craft's decorations: a line at the left, or a tinted panel
  font?: "heading" | "body";            // which of the style's two fonts
};
export type LineAttrs = { size?: TextSize; align?: Fmt["align"] | null; color?: string | null; deco?: "focus" | "block" | null; font?: "heading" | "body" | null };
export type ItemRow = { id: string; description: string; qty: number; rate: number };
export type SectionAttrs = { look?: "plain" | "card"; initials?: boolean; clauseId?: string | null };
export type PNode = RichNode;
export type Page = { type: "doc"; content: PNode[] };

export const ATOMS = ["parties", "items", "payment", "signatures", "divider", "pagebreak", "spacer"] as const;
export type AtomType = (typeof ATOMS)[number];
export const isAtom = (t: string): t is AtomType => (ATOMS as readonly string[]).includes(t);

/** What the Insert panel adds. */
export type InsertKind = "title" | "heading" | "text" | "section" | "card" | AtomType;
export const INSERT_LABEL: Record<InsertKind, string> = {
  title: "Title", heading: "Heading", text: "Text", section: "Section", card: "Card", parties: "Parties", items: "Line items",
  payment: "Payment schedule", signatures: "Signatures", divider: "Divider", pagebreak: "Page break", spacer: "Space",
};
export const BLOCK_LABEL = INSERT_LABEL;

export const line = (text: string, attrs: LineAttrs = {}): PNode => ({ type: "paragraph", attrs: { size: "body", ...attrs }, ...(text ? { content: [{ type: "text", text }] } : {}) });
export const bulletList = (items: string[], ordered = false): PNode => ({ type: ordered ? "orderedList" : "bulletList", content: items.map((t) => ({ type: "listItem", content: [line(t)] })) });
export const section = (content: PNode[], attrs: SectionAttrs = {}): PNode => ({ type: "section", attrs: { look: "plain", initials: false, clauseId: null, ...attrs }, content });
export const atom = (type: AtomType, attrs: Record<string, unknown> = {}): PNode => ({ type, attrs });
export const emptyPage = (): Page => ({ type: "doc", content: [line("")] });

export function newNodes(kind: InsertKind): PNode[] {
  switch (kind) {
    case "title": return [line("Title", { size: "title" })];
    case "heading": return [line("Heading", { size: "heading" })];
    case "text": return [line("")];
    case "section": return [section([line("Section title", { size: "heading" }), line("")])];
    case "card": return [section([line("")], { look: "card" })];
    case "parties": return [line("Parties", { size: "heading" }), atom("parties")];
    case "items": return [line("Services & pricing", { size: "heading" }), atom("items", { rows: [{ id: newId(), description: "", qty: 1, rate: 0 }] })];
    case "payment": return [section([line("Payment", { size: "heading" }), line("A {deposit.percent} deposit of {deposit} is due on signing. The balance of {balance} is due on delivery."), atom("payment", { depositPct: 25, invoiceDeposit: true, initials: false })])];
    case "signatures": return [line("Signatures", { size: "heading" }), atom("signatures", { signers: ["heston", "client"], showTitle: true, showDate: true })];
    case "divider": return [atom("divider")];
    case "pagebreak": return [atom("pagebreak")];
    case "spacer": return [atom("spacer", { size: 18 })];
  }
}

/** Visit every node (depth first), with its parent. */
export function walk(n: PNode, fn: (node: PNode, parent: PNode | null) => void, parent: PNode | null = null) {
  fn(n, parent);
  for (const c of n.content ?? []) walk(c, fn, n);
}
export function nodesOf(page: Page, type: string): PNode[] {
  const out: PNode[] = [];
  walk(page as PNode, (n) => { if (n.type === type) out.push(n); });
  return out;
}
/** The text of a node, lines separated by newlines. */
export function textOf(n: PNode | undefined): string {
  if (!n) return "";
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  const inner = (n.content ?? []).map(textOf);
  return n.type === "paragraph" ? inner.join("") : inner.filter((x) => x !== "").join("\n");
}
export const plainText = (r: Rich | PNode | undefined) => textOf(r as PNode);
/** A container's title: its first line. */
export const sectionTitle = (sec: PNode) => textOf((sec.content ?? []).find((c) => c.type === "paragraph"));

/** A clause from the library as a container: its title line, then its wording. */
export function clauseSection(c: { _id?: string; title: string; body: unknown; initials: boolean }): PNode {
  const body = ((c.body as Rich)?.content ?? []).map((n) => (n.type === "paragraph" ? { ...n, attrs: { size: "body", ...(n.attrs ?? {}) } } : n));
  return section([line(c.title, { size: "heading" }), ...(body.length ? body : [line("")])], { initials: c.initials, clauseId: c._id ?? null });
}
/** A container as a library clause: the first line is the title, the lines and lists after it the wording. */
export function sectionClause(sec: PNode): { title: string; body: Rich; initials: boolean } {
  const kids = sec.content ?? [];
  const first = kids.findIndex((c) => c.type === "paragraph");
  const rest = kids.filter((c, i) => i !== first && (c.type === "paragraph" || c.type === "bulletList" || c.type === "orderedList"));
  return { title: textOf(kids[first]).trim() || "Clause", body: { type: "doc", content: rest.length ? rest : [line("")] }, initials: !!sec.attrs?.initials };
}

// ---------- older documents (B2's list of blocks) ----------

export type V1Block =
  | { id: string; type: "heading"; text: string; size: TextSize; fmt?: Fmt }
  | { id: string; type: "text"; rich: Rich; size?: TextSize; fmt?: Fmt }
  | { id: string; type: "parties"; title?: string; fmt?: Fmt }
  | { id: string; type: "items"; title?: string; rows: ItemRow[]; fmt?: Fmt }
  | { id: string; type: "payment"; title?: string; depositPct: number; terms: Rich; invoiceDeposit: boolean; initials?: boolean; fmt?: Fmt }
  | { id: string; type: "clause"; title: string; rich: Rich; initials: boolean; clauseId?: string; fmt?: Fmt }
  | { id: string; type: "signatures"; title?: string; signers: string[]; showTitle: boolean; showDate: boolean; fmt?: Fmt }
  | { id: string; type: "divider" }
  | { id: string; type: "pagebreak" }
  | { id: string; type: "spacer"; size: number };

const fmtAttrs = (f?: Fmt): LineAttrs => ({ ...(f?.align && f.align !== "left" ? { align: f.align } : {}), ...(f?.color ? { color: f.color } : {}), ...(f?.font ? { font: f.font } : {}) });
function styled(r: Rich, size: TextSize, f?: Fmt): PNode[] {
  const fix = (n: PNode): PNode => n.type === "paragraph" ? { ...n, attrs: { size, ...fmtAttrs(f), ...(f?.deco && f.deco !== "none" ? { deco: f.deco } : {}) } } : { ...n, ...(n.content ? { content: n.content.map(fix) } : {}) };
  return (r.content ?? []).map(fix);
}
/** B2's blocks as a page. */
export function migrate(blocks: V1Block[]): Page {
  const out: PNode[] = [];
  const title = (t: string | undefined, f?: Fmt) => (t ? [line(t, { size: "heading", ...fmtAttrs(f) })] : []);
  for (const b of blocks) {
    switch (b.type) {
      case "heading": out.push(line(b.text, { size: b.size, ...fmtAttrs(b.fmt), ...(b.fmt?.deco && b.fmt.deco !== "none" ? { deco: b.fmt.deco } : {}) })); break;
      case "text": out.push(...styled(b.rich, b.size ?? "body", b.fmt)); break;
      case "parties": out.push(...title(b.title, b.fmt), atom("parties")); break;
      case "items": out.push(...title(b.title, b.fmt), atom("items", { rows: b.rows })); break;
      case "payment": out.push(section([...title(b.title, b.fmt), ...styled(b.terms, "body", b.fmt ? { ...b.fmt, deco: undefined } : undefined), atom("payment", { depositPct: b.depositPct, invoiceDeposit: b.invoiceDeposit, initials: !!b.initials })], { look: b.fmt?.deco === "block" ? "card" : "plain" })); break;
      case "clause": out.push(section([...title(b.title || "Clause", b.fmt), ...styled(b.rich, "body", b.fmt ? { ...b.fmt, deco: undefined } : undefined)], { initials: b.initials, clauseId: b.clauseId ?? null, look: b.fmt?.deco === "block" ? "card" : "plain" })); break;
      case "signatures": out.push(...title(b.title, b.fmt), atom("signatures", { signers: b.signers, showTitle: b.showTitle, showDate: b.showDate })); break;
      case "divider": case "pagebreak": out.push(atom(b.type)); break;
      case "spacer": out.push(atom("spacer", { size: b.size })); break;
    }
  }
  return { type: "doc", content: out.length ? out : [line("")] };
}
/** Whatever is stored (a page, or B2's blocks) as a page. */
export function pageOf(stored: unknown): Page {
  if (Array.isArray(stored)) return migrate(stored as V1Block[]);
  if (stored && typeof stored === "object" && (stored as Page).type === "doc" && Array.isArray((stored as Page).content)) return stored as Page;
  return emptyPage();
}

// ---------- fields and signers ----------

export type Business = { name: string; legalName: string; contact: string; title: string; email: string; phone: string; address: string };
export type Fields = {
  business: Business;
  client: { name: string; company: string; email: string; phone: string; address: string };
  project: string;
  date: string;                          // ISO date (yyyy-mm-dd) the document is dated
  custom: Array<{ key: string; label: string; value: string }>;
};
// Extra client signers beyond the main client (client2, client3 …). The main client signs as "client".
export type ExtraSigner = { key: string; name: string; email: string; title: string };

export const DEFAULT_BUSINESS: Business = {
  name: "Wrangler Productions", legalName: "Hill Creative LLC", contact: "Heston Hill", title: "Founder",
  email: "heston@wranglerproductions.com", phone: "", address: "Oklahoma City, OK",
};
export function emptyFields(business: Business = DEFAULT_BUSINESS, today = new Date()): Fields {
  const d = today.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // yyyy-mm-dd
  return { business, client: { name: "", company: "", email: "", phone: "", address: "" }, project: "", date: d, custom: [] };
}

export const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const longDate = (iso: string) => {
  const t = Date.parse(`${iso}T12:00:00Z`);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
};

/** Totals from the line items and the payment block (the deposit is what the Stripe draft is for). */
export function totals(page: Page) {
  const rows = nodesOf(page, "items").flatMap((n) => (n.attrs?.rows as ItemRow[] | undefined) ?? []);
  const total = Math.round(rows.reduce((t, r) => t + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0) * 100) / 100;
  const pay = nodesOf(page, "payment")[0];
  const pct = pay ? Math.min(100, Math.max(0, Number(pay.attrs?.depositPct) || 0)) : 0;
  const deposit = Math.round(total * pct) / 100;
  return { total, depositPct: pct, deposit, balance: Math.round((total - deposit) * 100) / 100, invoiceDeposit: !!pay?.attrs?.invoiceDeposit && deposit > 0 };
}

/** Every fill-in field, by the name used in braces. */
export function fieldValues(f: Fields, page: Page): Record<string, string> {
  const t = totals(page);
  const v: Record<string, string> = {
    "business.name": f.business.name, "business.legal": f.business.legalName, "business.contact": f.business.contact, "business.title": f.business.title,
    "business.email": f.business.email, "business.phone": f.business.phone, "business.address": f.business.address,
    "client.name": f.client.name, "client.company": f.client.company, "client.email": f.client.email, "client.phone": f.client.phone, "client.address": f.client.address,
    project: f.project, date: longDate(f.date), total: money(t.total), deposit: money(t.deposit), balance: money(t.balance),
    "deposit.percent": `${t.depositPct}%`, "balance.percent": `${100 - t.depositPct}%`,
  };
  for (const c of f.custom) if (c.key) v[c.key] = c.value;
  return v;
}
export const FIELD_HELP: Array<{ key: string; label: string }> = [
  { key: "client.name", label: "Client name" }, { key: "client.company", label: "Client company" }, { key: "client.email", label: "Client email" },
  { key: "project", label: "Project" }, { key: "date", label: "Date" }, { key: "total", label: "Total" }, { key: "deposit", label: "Deposit" },
  { key: "balance", label: "Balance" }, { key: "deposit.percent", label: "Deposit %" }, { key: "business.name", label: "Your business" },
];

/** {client.name} → its value. Unknown names stay as written, so a typo shows on the page instead of vanishing. */
export function fill(text: string, values: Record<string, string>, blankAs = "_____"): string {
  return text.replace(/(?<!\{)\{([a-z][a-z0-9_.]{0,40})\}(?!\})/gi, (m, k: string) => (k in values ? values[k] || blankAs : m));
}

/** Fields named in the text that have no value yet (shown in the builder before it goes to signing). */
export function missingFields(page: Page, f: Fields): string[] {
  const values = fieldValues(f, page);
  const found = new Set<string>();
  walk(page as PNode, (n) => {
    if (n.type === "text") for (const m of (n.text ?? "").matchAll(/(?<!\{)\{([a-z][a-z0-9_.]{0,40})\}(?!\})/gi)) if (!values[m[1]]) found.add(m[1]);
    if (n.type === "items") for (const r of (n.attrs?.rows as ItemRow[] | undefined) ?? []) for (const m of r.description.matchAll(/(?<!\{)\{([a-z][a-z0-9_.]{0,40})\}(?!\})/gi)) if (!values[m[1]]) found.add(m[1]);
  });
  return [...found];
}

// ---------- style ----------

export type FontRef = { family: string; source: "builtin" | "google" | "custom" };
export type Style = {
  name: string;
  backdrop: string;           // around the page: in the builder, and behind the pages on the signing page (not in the PDF)
  backdropImage?: { fileId: string } | null; // an image instead of the colour
  page: string;               // the page colour
  text: string;
  heading: string;
  accent: string;
  muted: string;
  fonts: { heading: FontRef; body: FontRef };
  baseSize: number;           // body text size, pt
  pageSize: "LETTER" | "A4";
  margin: number;             // pt
  separator: "line" | "thick" | "dots" | "none";
  logo?: { fileId: string; width: number; align: "left" | "center" | "right" } | null;
  cover?: { fileId: string; height: number } | null;
  footer: boolean;            // page numbers and the document number at the bottom
};

// The four "Default / Serif / Mono / Rounded" choices, like Craft's, are these Google fonts (fetched once, then stored).
export const BUILTIN_FONTS: Record<string, string> = { Default: "Inter", Serif: "Lora", Mono: "JetBrains Mono", Rounded: "Nunito" };

const base: Omit<Style, "name"> = {
  backdrop: "#e9e7e2", page: "#ffffff", text: "#1d1d1f", heading: "#111111", accent: "#d60000", muted: "#6b6862",
  fonts: { heading: { family: "Inter", source: "google" }, body: { family: "Inter", source: "google" } },
  baseSize: 10.5, pageSize: "LETTER", margin: 60, separator: "line", logo: null, cover: null, footer: true,
};
export const PRESET_STYLES: Style[] = [
  { ...base, name: "Wrangler" },
  { ...base, name: "Classic", accent: "#1f3a5f", heading: "#1f3a5f", fonts: { heading: { family: "Lora", source: "google" }, body: { family: "Lora", source: "google" } }, separator: "thick" },
  { ...base, name: "Sand", backdrop: "#d9cbb3", page: "#fbf6ec", text: "#3a3128", heading: "#2b231c", accent: "#a5662f", muted: "#857766", fonts: { heading: { family: "Lora", source: "google" }, body: { family: "Inter", source: "google" } } },
  { ...base, name: "Mono", backdrop: "#d4d4d4", accent: "#111111", heading: "#111111", fonts: { heading: { family: "JetBrains Mono", source: "google" }, body: { family: "Inter", source: "google" } }, separator: "dots" },
  { ...base, name: "Night", backdrop: "#0b0b0d", page: "#16161a", text: "#e9e6df", heading: "#ffffff", accent: "#ff3b30", muted: "#9a968e", fonts: { heading: { family: "Nunito", source: "google" }, body: { family: "Nunito", source: "google" } } },
];
export const DEFAULT_STYLE: Style = PRESET_STYLES[0];

export const PAGE_PT = { LETTER: { w: 612, h: 792 }, A4: { w: 595.28, h: 841.89 } } as const;

// ---------- the whole thing ----------

export type BuildDoc = { title: string; page: Page; fields: Fields; signers: ExtraSigner[]; style: Style };

export const newId = () => `k${Math.random().toString(36).slice(2, 9)}`;

/** Who signs: the keys used by the signature blocks and initialled containers ("heston", "client", "client2" …). */
export function signerKeys(page: Page): string[] {
  const keys = new Set<string>();
  for (const n of nodesOf(page, "signatures")) for (const k of (n.attrs?.signers as string[] | undefined) ?? []) keys.add(k);
  if (nodesOf(page, "section").some((n) => n.attrs?.initials) || nodesOf(page, "payment").some((n) => n.attrs?.initials)) keys.add("client");
  return [...keys];
}

/** Problems that stop "Continue to signing" (the rest of the checks happen at approval, as for any document). */
export function buildProblems(d: BuildDoc): string[] {
  const out: string[] = [];
  if (!d.title.trim()) out.push("Give the document a title.");
  if (!textOf(d.page as PNode).trim() && !(d.page.content ?? []).some((n) => isAtom(n.type))) out.push("Add some content.");
  const keys = signerKeys(d.page);
  if (!nodesOf(d.page, "signatures").length) out.push("Add a signature block.");
  if (keys.includes("client")) {
    if (!d.fields.client.name.trim()) out.push("Enter the client's name (Details).");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.fields.client.email.trim())) out.push("Enter the client's email (Details).");
  }
  for (const k of keys.filter((k) => k !== "client" && k !== "heston")) {
    const s = d.signers.find((x) => x.key === k);
    if (!s || !s.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim())) out.push(`Enter the name and email for ${k} (Details).`);
  }
  // A "PICK ONE:" note (the starter's two revisions clauses) must be resolved first.
  const pick = (n: PNode, where: string) => { if (/\bPICK ONE:/.test(textOf(n))) out.push(`Resolve the "PICK ONE" note${where ? ` in "${where}"` : ""}.`); };
  for (const n of d.page.content ?? []) pick(n, n.type === "section" ? sectionTitle(n) : "");
  const miss = missingFields(d.page, d.fields);
  if (miss.length) out.push(`Fill in: ${miss.map((m) => `{${m}}`).join(", ")}.`);
  const t = totals(d.page);
  if (nodesOf(d.page, "payment").length && t.total <= 0) out.push("The payment schedule needs line items with a total.");
  return out;
}

/** Size guard for anything stored (blocks are JSON, kept small). */
export const MAX_BUILD_JSON = 400_000;
