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
export function plainText(r: Rich | undefined): string {
  const walk = (n: RichNode): string => (n.text ?? "") + (n.content ?? []).map(walk).join(n.type === "doc" || n.type.endsWith("List") ? "\n" : "");
  return r ? walk(r as RichNode) : "";
}

// ---------- blocks ----------

export type TextSize = "title" | "subtitle" | "heading" | "strong" | "body" | "caption";
export type Fmt = {
  align?: "left" | "center" | "right" | "justify";
  color?: string;                       // a hex colour, or "accent"
  deco?: "none" | "focus" | "block";    // Craft's decorations: a line at the left, or a tinted panel
  font?: "heading" | "body";            // which of the style's two fonts
};

export type ItemRow = { id: string; description: string; qty: number; rate: number };
export type Block =
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
export type BlockType = Block["type"];

export const BLOCK_LABEL: Record<BlockType, string> = {
  heading: "Heading", text: "Text", parties: "Parties", items: "Line items", payment: "Payment schedule", clause: "Clause",
  signatures: "Signatures", divider: "Divider", pagebreak: "Page break", spacer: "Space",
};

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
export function totals(blocks: Block[]) {
  const items = blocks.filter((b): b is Extract<Block, { type: "items" }> => b.type === "items");
  const total = Math.round(items.reduce((s, b) => s + b.rows.reduce((t, r) => t + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0), 0) * 100) / 100;
  const pay = blocks.find((b): b is Extract<Block, { type: "payment" }> => b.type === "payment");
  const pct = pay ? Math.min(100, Math.max(0, pay.depositPct)) : 0;
  const deposit = Math.round(total * pct) / 100;
  return { total, depositPct: pct, deposit, balance: Math.round((total - deposit) * 100) / 100, invoiceDeposit: !!pay?.invoiceDeposit && deposit > 0 };
}

/** Every fill-in field, by the name used in braces. */
export function fieldValues(f: Fields, blocks: Block[]): Record<string, string> {
  const t = totals(blocks);
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
export function missingFields(blocks: Block[], f: Fields): string[] {
  const values = fieldValues(f, blocks);
  const found = new Set<string>();
  const scan = (s: string) => { for (const m of s.matchAll(/(?<!\{)\{([a-z][a-z0-9_.]{0,40})\}(?!\})/gi)) if (!values[m[1]]) found.add(m[1]); };
  for (const b of blocks) {
    if (b.type === "heading") scan(b.text);
    if (b.type === "text" || b.type === "clause") { scan(plainText(b.rich)); if (b.type === "clause") scan(b.title); }
    if (b.type === "payment") scan(plainText(b.terms));
  }
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

export type BuildDoc = { title: string; blocks: Block[]; fields: Fields; signers: ExtraSigner[]; style: Style };

export const newId = () => `k${Math.random().toString(36).slice(2, 9)}`;

export function newBlock(type: BlockType): Block {
  const id = newId();
  switch (type) {
    case "heading": return { id, type, text: "Heading", size: "heading" };
    case "text": return { id, type, rich: rich("") };
    case "parties": return { id, type, title: "Parties" };
    case "items": return { id, type, title: "Services & pricing", rows: [{ id: newId(), description: "", qty: 1, rate: 0 }] };
    case "payment": return { id, type, title: "Payment", depositPct: 25, invoiceDeposit: true, terms: rich("A {deposit.percent} deposit of {deposit} is due on signing. The balance of {balance} is due on delivery.") };
    case "clause": return { id, type, title: "Clause", rich: rich(""), initials: false };
    case "signatures": return { id, type, title: "Signatures", signers: ["heston", "client"], showTitle: true, showDate: true };
    case "divider": return { id, type };
    case "pagebreak": return { id, type };
    case "spacer": return { id, type, size: 18 };
  }
}

/** Who signs: the keys used by the signature blocks and initialled clauses ("heston", "client", "client2" …). */
export function signerKeys(blocks: Block[]): string[] {
  const keys = new Set<string>();
  for (const b of blocks) if (b.type === "signatures") for (const k of b.signers) keys.add(k);
  if (blocks.some((b) => (b.type === "clause" || b.type === "payment") && b.initials)) keys.add("client");
  return [...keys];
}

/** Problems that stop "Continue to signing" (the rest of the checks happen at approval, as for any document). */
export function buildProblems(d: BuildDoc): string[] {
  const out: string[] = [];
  if (!d.title.trim()) out.push("Give the document a title.");
  if (!d.blocks.length) out.push("Add some content.");
  const keys = signerKeys(d.blocks);
  if (!d.blocks.some((b) => b.type === "signatures")) out.push("Add a signature block.");
  if (keys.includes("client")) {
    if (!d.fields.client.name.trim()) out.push("Enter the client's name (Details).");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.fields.client.email.trim())) out.push("Enter the client's email (Details).");
  }
  for (const k of keys.filter((k) => k !== "client" && k !== "heston")) {
    const s = d.signers.find((x) => x.key === k);
    if (!s || !s.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim())) out.push(`Enter the name and email for ${k} (Details).`);
  }
  for (const b of d.blocks) {
    const t = b.type === "text" || b.type === "clause" ? plainText(b.rich) : b.type === "payment" ? plainText(b.terms) : b.type === "heading" ? b.text : "";
    if (/\bPICK ONE:/.test(t)) out.push(`Resolve the "PICK ONE" note${b.type === "clause" ? ` in "${b.title}"` : ""}.`);
  }
  const miss = missingFields(d.blocks, d.fields);
  if (miss.length) out.push(`Fill in: ${miss.map((m) => `{${m}}`).join(", ")}.`);
  const t = totals(d.blocks);
  if (d.blocks.some((b) => b.type === "payment") && t.total <= 0) out.push("The payment schedule needs line items with a total.");
  return out;
}

/** Size guard for anything stored (blocks are JSON, kept small). */
export const MAX_BUILD_JSON = 400_000;
