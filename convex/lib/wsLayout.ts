// Wrangler Sign: the rules a document's layout must follow (Phase S1, Oct 27). Pure functions, shared by the
// backend and the tests (and safe to import in the site).
export const OWNER_KEY = "heston";
export const KINDS = ["sign", "initials", "name", "date", "title"] as const;
export type Kind = (typeof KINDS)[number];
export type Rect = { page: number; x: number; y: number; w: number; h: number };
export type LayoutBox = Rect & { id: string; signer: string; kind: Kind; cover?: Rect; fromMarker?: boolean };
export type LayoutSigner = { key: string; name: string; email: string; title?: string; order: number };
export type Payment = { amountCents: number; description: string };
export type PageSize = { width: number; height: number; rotate: number };

export const KEY_RE = /^[a-z0-9_-]{1,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MAX_BOXES = 400;
export const MAX_SIGNERS = 10;
export const MAX_AMOUNT_CENTS = 10_000_000; // $100,000

function rectProblem(r: Rect, pages: number, what: string): string | null {
  if (!Number.isInteger(r.page) || r.page < 0 || r.page >= pages) return `${what} is on a page that doesn't exist`;
  for (const n of [r.x, r.y, r.w, r.h]) if (!Number.isFinite(n)) return `${what} has a bad position`;
  if (r.w < 0.004 || r.h < 0.004) return `${what} is too small`;
  if (r.x < -0.001 || r.y < -0.001 || r.x + r.w > 1.001 || r.y + r.h > 1.001) return `${what} runs off the page`;
  return null;
}

/** Problems that make a layout unsavable at all (shape and bounds). */
export function shapeProblems(l: { signers: LayoutSigner[]; boxes: LayoutBox[]; pages: number }): string[] {
  const out: string[] = [];
  if (l.signers.length > MAX_SIGNERS) out.push(`At most ${MAX_SIGNERS} signers.`);
  if (l.boxes.length > MAX_BOXES) out.push(`At most ${MAX_BOXES} boxes.`);
  const keys = new Set<string>();
  for (const s of l.signers) {
    if (!KEY_RE.test(s.key)) out.push(`Signer key "${s.key}" can only use a–z, 0–9, - and _.`);
    if (keys.has(s.key)) out.push(`Two signers share the key "${s.key}".`);
    keys.add(s.key);
    if (s.name.length > 120 || s.email.length > 200 || (s.title ?? "").length > 120) out.push(`Signer "${s.key}" has a field that's too long.`);
    if (!Number.isInteger(s.order) || s.order < 1 || s.order > MAX_SIGNERS) out.push(`Signer "${s.key}" has a bad order.`);
  }
  const ids = new Set<string>();
  for (const b of l.boxes) {
    if (!b.id || b.id.length > 40 || ids.has(b.id)) out.push("A box has a missing or repeated id.");
    ids.add(b.id);
    if (!keys.has(b.signer)) out.push(`A box belongs to "${b.signer}", who isn't a signer.`);
    if (!(KINDS as readonly string[]).includes(b.kind)) out.push("A box has an unknown kind.");
    const p = rectProblem(b, l.pages, `A ${b.kind} box`);
    if (p) out.push(p + ".");
    if (b.cover) {
      const c = rectProblem(b.cover, l.pages, "A marker cover");
      if (c) out.push(c + ".");
      if (b.cover.page !== b.page) out.push("A marker cover is on a different page from its box.");
    }
  }
  return [...new Set(out)];
}

/** Everything that must be true before a version can be approved (on top of the shape rules). */
export function approvalProblems(l: { signers: LayoutSigner[]; boxes: LayoutBox[]; pages: number; payment?: Payment | null; ownerSignatureAdopted: boolean }): string[] {
  const out = shapeProblems(l);
  const clients = l.signers.filter((s) => s.key !== OWNER_KEY);
  if (!clients.length) out.push("Add at least one client signer.");
  for (const s of clients) {
    if (!s.name.trim()) out.push(`Signer "${s.key}" needs a name.`);
    if (!EMAIL_RE.test(s.email.trim())) out.push(`Signer "${s.key}" needs a valid email.`);
  }
  for (const s of l.signers) {
    if (!l.boxes.some((b) => b.signer === s.key && b.kind === "sign")) out.push(`${s.key === OWNER_KEY ? "You need" : `${s.name || s.key} needs`} a signature box.`);
  }
  if (l.signers.some((s) => s.key === OWNER_KEY) && !l.ownerSignatureAdopted) out.push("Adopt your signature first (Contracts › Your signature).");
  if (l.payment) {
    if (!Number.isInteger(l.payment.amountCents) || l.payment.amountCents <= 0 || l.payment.amountCents > MAX_AMOUNT_CENTS) out.push("The invoice amount must be between $0.01 and $100,000.");
    if (!l.payment.description.trim() || l.payment.description.length > 200) out.push("The invoice needs a short description.");
  }
  return [...new Set(out)];
}

/** The text the lock hash covers. Same layout → same text, whatever order things were added in. */
export function lockText(v: { documentNumber: number; versionNumber: number; title: string; fileSha256: string; pages: PageSize[]; signers: LayoutSigner[]; boxes: LayoutBox[]; signingOrder: string; payment?: Payment | null }): string {
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  const rect = (b: Rect) => ({ page: b.page, x: r(b.x), y: r(b.y), w: r(b.w), h: r(b.h) });
  return JSON.stringify({
    documentNumber: v.documentNumber, versionNumber: v.versionNumber, title: v.title, fileSha256: v.fileSha256,
    pages: v.pages.map((p) => ({ width: r(p.width), height: r(p.height), rotate: p.rotate })),
    signers: [...v.signers].sort((a, b) => a.key.localeCompare(b.key)).map((s) => ({ key: s.key, name: s.name, email: s.email.toLowerCase(), title: s.title ?? "", order: s.order })),
    boxes: [...v.boxes].sort((a, b) => a.id.localeCompare(b.id)).map((b) => ({ id: b.id, signer: b.signer, kind: b.kind, ...rect(b), cover: b.cover ? rect(b.cover) : null })),
    signingOrder: v.signingOrder,
    payment: v.payment ? { amountCents: v.payment.amountCents, description: v.payment.description } : null,
  });
}

export const docLabel = (n: number) => `WS-${String(n).padStart(5, "0")}`;
