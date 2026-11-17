// 5l round 2: what a board's items are, and the checks every save goes through (server and the board share them).
import { ConvexError } from "convex/values";

// Nov 17 (Heston): rectangles ("box"), circles ("ellipse"), arrows and lines, with stroke, background, width, style,
// sloppiness, edges and opacity, as in the canvas style panel.
export type CanvasType = "note" | "box" | "ellipse" | "arrow" | "line" | "text" | "pen" | "image" | "pdf" | "file" | "link" | "table" | "frame";
export type CanvasItem = {
  id: string; type: CanvasType; x: number; y: number; w: number; h: number; z: number;
  locked?: boolean;
  color?: string;            // note paper, text and pen colour, box border
  fill?: string | null;      // box fill (null: none)
  border?: "none" | "thin" | "thick";
  text?: string;             // note, text, box label, frame title, link title
  size?: "S" | "M" | "L" | "XL"; weight?: "regular" | "bold";
  points?: number[];         // pen: x,y pairs relative to the item
  stroke?: number;           // stroke width (pen, shapes, lines)
  dash?: "solid" | "dashed" | "dotted";
  rough?: 0 | 1 | 2;         // sloppiness: clean, a little rough, very rough
  round?: boolean;           // rectangle edges
  opacity?: number;          // 0–100
  seed?: number;             // keeps a rough shape's look the same on every draw
  fileId?: string; name?: string; mime?: string; bytes?: number; page?: number; // image, pdf, file
  url?: string; site?: string; // link
  rows?: string[][];         // table cells
};

export const CANVAS_LIMITS = { bytes: 25 * 1024 * 1024, files: 200, items: 2000 } as const;
export const BOARD = { w: 4000, h: 3000 } as const; // the board's edge (Q137: "Board on the page background with its edge visible")
const TYPES = new Set<CanvasType>(["note", "box", "ellipse", "arrow", "line", "text", "pen", "image", "pdf", "file", "link", "table", "frame"]);
const HEX = /^#[0-9a-f]{6}$/i;
const num = (n: unknown, lo: number, hi: number, d = 0) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);
const str = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : undefined);

/** A save's items, checked: known kinds, on the board, sane sizes, text capped, files only this board's own. */
export function cleanItems(raw: unknown, files: Set<string>): CanvasItem[] {
  if (!Array.isArray(raw)) throw new ConvexError("That board isn't in the right shape.");
  if (raw.length > CANVAS_LIMITS.items) throw new ConvexError(`A board holds up to ${CANVAS_LIMITS.items} things.`);
  if (JSON.stringify(raw).length > 900_000) throw new ConvexError("That board is too big to save. Remove some pen strokes or tables.");
  const seen = new Set<string>();
  const out: CanvasItem[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object" || !TYPES.has(r.type as CanvasType)) continue;
    const id = str(r.id, 40);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const fileId = str(r.fileId, 64);
    if (fileId && !files.has(fileId)) continue; // a file from somewhere else is never shown
    if ((r.type === "image" || r.type === "pdf" || r.type === "file") && !fileId) continue;
    const it: CanvasItem = { id, type: r.type as CanvasType, x: num(r.x, -200, BOARD.w), y: num(r.y, -200, BOARD.h), w: num(r.w, 4, BOARD.w, 160), h: num(r.h, 4, BOARD.h, 120), z: num(r.z, -1e6, 1e6) };
    if (r.locked === true) it.locked = true;
    if (typeof r.color === "string" && HEX.test(r.color)) it.color = r.color;
    if (r.fill === null || (typeof r.fill === "string" && HEX.test(r.fill))) it.fill = r.fill as string | null;
    if (r.border === "none" || r.border === "thin" || r.border === "thick") it.border = r.border;
    const text = str(r.text, 4000); if (text !== undefined) it.text = text;
    if (["S", "M", "L", "XL"].includes(r.size as string)) it.size = r.size as CanvasItem["size"];
    if (r.weight === "bold" || r.weight === "regular") it.weight = r.weight;
    if (Array.isArray(r.points)) it.points = (r.points as unknown[]).slice(0, 4000).map((n) => Math.round(num(n, -BOARD.w, BOARD.w) * 10) / 10);
    if (r.stroke !== undefined) it.stroke = num(r.stroke, 1, 40, 3);
    if (r.dash === "solid" || r.dash === "dashed" || r.dash === "dotted") it.dash = r.dash;
    if (r.rough === 0 || r.rough === 1 || r.rough === 2) it.rough = r.rough;
    if (typeof r.round === "boolean") it.round = r.round;
    if (r.opacity !== undefined) it.opacity = Math.round(num(r.opacity, 0, 100, 100));
    if (r.seed !== undefined) it.seed = Math.round(num(r.seed, 1, 2 ** 31 - 1, 1));
    if ((r.type === "arrow" || r.type === "line") && (it.points?.length ?? 0) < 4) continue;
    if (fileId) { it.fileId = fileId; it.name = str(r.name, 140) ?? "File"; it.mime = str(r.mime, 100) ?? ""; it.bytes = num(r.bytes, 0, CANVAS_LIMITS.bytes); if (r.page !== undefined) it.page = Math.round(num(r.page, 1, 999, 1)); }
    if (r.type === "link") { const u = str(r.url, 500) ?? ""; if (!/^https?:\/\//i.test(u)) continue; it.url = u; it.site = str(r.site, 80) ?? ""; }
    if (Array.isArray(r.rows)) it.rows = (r.rows as unknown[]).slice(0, 40).map((row) => (Array.isArray(row) ? row.slice(0, 20).map((c) => str(c, 500) ?? "") : []));
    out.push(it);
  }
  return out;
}

/** Q137 (a): 25 MB a file (D90's limit), and no programs, scripts or web pages. Returns why, or null. */
const REFUSED = /\.(exe|msi|bat|cmd|com|scr|pif|ps1|vbs|vbe|js|jse|wsf|wsh|jar|apk|app|dmg|pkg|deb|rpm|sh|bash|zsh|command|cpl|dll|sys|lnk|reg|hta|html?|xhtml|svgz?|php|py|rb|pl)$/i;
export function refusedFile(name: string, type: string, size: number): string | null {
  if (size > CANVAS_LIMITS.bytes) return `Too big: files can be up to 25 MB (this one is ${Math.ceil(size / 1024 / 1024)} MB). Link to big files instead.`;
  if (REFUSED.test(name.trim()) || /(x-msdownload|x-msdos|x-executable|x-sh|javascript|html|x-apple-diskimage|java-archive|svg)/i.test(type)) return "This kind of file isn't allowed.";
  return null;
}

let n = 0;
const nid = () => `m${Date.now().toString(36)}${(n++).toString(36)}`;
/** The Mood board layout (Q137 e): frames Look, Colour, Type, Words, References, each a normal canvas item. */
export function moodBoard(): CanvasItem[] {
  const f = (text: string, x: number, y: number, w: number, h: number, z: number): CanvasItem => ({ id: nid(), type: "frame", text, x, y, w, h, z });
  const note = (text: string, x: number, y: number, z: number): CanvasItem => ({ id: nid(), type: "note", text, x, y, w: 200, h: 120, z, color: "#FFF4B8" });
  return [
    f("Look", 120, 120, 900, 620, 1), f("Colour", 1060, 120, 520, 300, 2), f("Type", 1060, 440, 520, 300, 3), f("Words", 1620, 120, 420, 620, 4), f("References", 120, 780, 1920, 420, 5),
    note("Drop photos here: light, places, faces, frames you love.", 160, 180, 6),
    { id: nid(), type: "text", text: "Add colours as boxes: pick them from the photos.", x: 1100, y: 180, w: 420, h: 60, z: 7, size: "S" },
    { id: nid(), type: "text", text: "Headline font · Body font", x: 1100, y: 500, w: 420, h: 60, z: 8, size: "M", weight: "bold" },
    note("Tone words: warm, honest, bright…", 1660, 180, 9),
    note("Links, films and PDFs to watch or read.", 160, 840, 10),
  ];
}
