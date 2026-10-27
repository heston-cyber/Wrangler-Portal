// Wrangler Sign: find {{kind:signer}} markers in a PDF (Phase S1, Oct 27; proved in S0).
// Works with any pdf.js build (browser or Node) passed in, so the site and the tests share one implementation.
// Boxes come back in fractions of the page as displayed (after /Rotate), top-left origin: the same space the
// placement screen and convex/lib/wsPdf.ts use.
//
// How: the page's drawing operations are replayed (text matrix, font size, character and word spacing, each glyph's
// own width) to get every character's exact position, so a marker's box starts on its first brace and the white
// cover hides exactly the marker. pdf.js's plain text extraction only gives whole runs ("CLIENT: {{sign:client}}"),
// and sharing a run's width out by guesswork left a brace showing on serif fonts; that's kept only as a fallback.
import type { Kind, Rect } from "../../convex/lib/wsLayout";

export const MARKER_RE = /\{\{\s*(sign|signature|initials|initial|name|date|title)\s*:\s*([a-z0-9_-]{1,24})\s*\}\}/gi;
const KIND: Record<string, Kind> = { sign: "sign", signature: "sign", initials: "initials", initial: "initials", name: "name", date: "date", title: "title" };

// Box size by kind, in points (fixed so a tiny or huge marker font doesn't make an unusable box).
export const DEFAULT_SIZE: Record<Kind, { w: number; h: number }> = {
  sign: { w: 180, h: 30 }, initials: { w: 56, h: 20 }, name: { w: 160, h: 16 }, date: { w: 110, h: 16 }, title: { w: 140, h: 16 },
};

// check: the text runs sideways on screen (a rotated page), so the box is only near the marker; look at it.
export type FoundMarker = { kind: Kind; signer: string; text: string; box: Rect; cover: Rect; check?: boolean };
export type ScanResult = { pages: number; textPages: number; markers: FoundMarker[]; method: "glyphs" | "runs" | "mixed" };

type M6 = number[];
type Util = { transform: (a: M6, b: M6) => M6 };
// One character as displayed: left and right edge, baseline, font height, and whether it runs sideways.
type Ch = { c: string; x0: number; x1: number; y: number; h: number; vertical: boolean };

const mul = (a: M6, b: M6): M6 => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const apply = (m: M6, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const I: M6 = [1, 0, 0, 1, 0, 0];
// pdf.js passes matrices either as six numbers or as one (typed) array.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mat = (a: any): M6 | null => { const v = a && a.length === 6 ? a : a?.[0]; if (!v) return null; const m = Array.from(v as ArrayLike<number>).map(Number); return m.length === 6 && m.every(Number.isFinite) ? m : null; };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function glyphsOf(page: any, pdfjs: { OPS: Record<string, number> }, vpm: M6): Promise<Ch[]> {
  const OPS = pdfjs.OPS;
  const ops = await page.getOperatorList();
  const fonts = new Map<string, { fontMatrix?: M6; vertical?: boolean }>();
  const fontOf = async (name: string) => {
    if (!fonts.has(name)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f = await new Promise<any>((ok) => { try { page.commonObjs.get(name, ok); } catch { ok(null); } });
      fonts.set(name, f ?? {});
    }
    return fonts.get(name)!;
  };
  const out: Ch[] = [];
  type St = { ctm: M6; tm: M6; tlm: M6; x: number; y: number; lineX: number; lineY: number; size: number; dir: number; fm: M6; vertical: boolean; cs: number; ws: number; hs: number; lead: number; rise: number };
  let st: St = { ctm: I, tm: I, tlm: I, x: 0, y: 0, lineX: 0, lineY: 0, size: 0, dir: 1, fm: [0.001, 0, 0, 0.001, 0, 0], vertical: false, cs: 0, ws: 0, hs: 1, lead: 0, rise: 0 };
  const stack: St[] = [];
  const moveText = (dx: number, dy: number) => { st.lineX += dx; st.lineY += dy; st.x = st.lineX; st.y = st.lineY; };
  for (let k = 0; k < ops.fnArray.length; k++) {
    const fn = ops.fnArray[k], a = ops.argsArray[k];
    switch (fn) {
      case OPS.save: stack.push({ ...st }); break;
      case OPS.restore: st = stack.pop() ?? st; break;
      case OPS.transform: { const t = mat(a); if (t) st.ctm = mul(st.ctm, t); break; }
      case OPS.paintFormXObjectBegin: { stack.push({ ...st }); const t = mat(a?.[0] ? [a[0]] : null); if (t) st.ctm = mul(st.ctm, t); break; }
      case OPS.paintFormXObjectEnd: st = stack.pop() ?? st; break;
      case OPS.beginText: st.tm = I; st.tlm = I; st.x = st.y = st.lineX = st.lineY = 0; break;
      case OPS.setFont: {
        const f = await fontOf(a[0]);
        let size = a[1];
        st.dir = size < 0 ? -1 : 1; size = Math.abs(size);
        st.size = size; st.fm = f.fontMatrix ?? [0.001, 0, 0, 0.001, 0, 0]; st.vertical = !!f.vertical;
        break;
      }
      case OPS.setTextMatrix: { const t = mat(a); if (t) { st.tm = t; st.tlm = t; } st.x = st.y = st.lineX = st.lineY = 0; break; }
      case OPS.moveText: moveText(a[0], a[1]); break;
      case OPS.setLeadingMoveText: st.lead = a[1]; moveText(a[0], a[1]); break;
      case OPS.nextLine: moveText(0, st.lead); break;
      case OPS.setLeading: st.lead = -a[0]; break;
      case OPS.setCharSpacing: st.cs = a[0]; break;
      case OPS.setWordSpacing: st.ws = a[0]; break;
      case OPS.setHScale: st.hs = a[0] / 100; break;
      case OPS.setTextRise: st.rise = a[0]; break;
      case OPS.showText: {
        const glyphs = a[0] as Array<number | { unicode?: string; width?: number; isSpace?: boolean } | null>;
        if (!st.size) break;
        const scale = st.size * st.fm[0];
        // text space → displayed page
        const m = mul(vpm, mul(st.ctm, st.tm));
        const h = Math.hypot(...[m[2], m[3]].map((n) => n * st.size)) || st.size;
        let x = 0;
        for (const g of glyphs) {
          if (g === null || g === undefined) continue;
          if (typeof g === "number") { x += (st.dir * g * st.size) / 1000; continue; }
          const spacing = (g.isSpace ? st.ws : 0) + st.cs;
          const w = (g.width ?? 0) * scale + spacing * st.dir;
          const p0 = apply(m, st.x + x * st.hs, st.y + st.rise), p1 = apply(m, st.x + (x + (g.width ?? 0) * scale) * st.hs, st.y + st.rise);
          const vertical = st.vertical || Math.abs(p1[1] - p0[1]) > Math.abs(p1[0] - p0[0]);
          for (const c of [...(g.unicode ?? "")]) out.push({ c, x0: Math.min(p0[0], p1[0]), x1: Math.max(p0[0], p1[0]), y: p0[1], h, vertical });
          x += w;
        }
        st.x += x * st.hs;
        break;
      }
      default: break;
    }
  }
  return out;
}

function markersFromChars(chars: Ch[], page: number, W: number, H: number): FoundMarker[] {
  const found: FoundMarker[] = [];
  const flat = chars.filter((c) => !c.vertical);
  const lines: Ch[][] = [];
  for (const c of flat) {
    const line = lines.find((l) => Math.abs(l[0].y - c.y) < Math.max(1.5, c.h * 0.3));
    if (line) line.push(c); else lines.push([c]);
  }
  for (const line of lines) {
    line.sort((a, b) => a.x0 - b.x0);
    let text = "";
    const at: Ch[] = []; // at[i] = the character behind text[i]
    for (const c of line) {
      const prev = at[at.length - 1];
      if (prev && c.x0 - prev.x1 > prev.h * 0.22 && text[text.length - 1] !== " " && c.c !== " ") { text += " "; at.push({ ...prev, c: " ", x0: prev.x1, x1: c.x0 }); }
      text += c.c; at.push(c);
    }
    for (const m of text.matchAll(MARKER_RE)) {
      const a = m.index!, b = a + m[0].length - 1;
      const first = at[a], last = at[b];
      found.push(place(m, page, W, H, first.x0, last.x1, first.y, first.h));
    }
  }
  // Sideways text (a rotated page): read in order of the run, flag the box for a look.
  const vert = chars.filter((c) => c.vertical);
  if (vert.length) {
    const text = vert.map((c) => c.c).join("");
    for (const m of text.matchAll(MARKER_RE)) {
      const c = vert[m.index!];
      const kind = KIND[m[1].toLowerCase()], size = DEFAULT_SIZE[kind];
      const bw = Math.min(size.w, W * 0.6), bh = size.h;
      const box: Rect = { page, x: clamp(c.x0 / W, 0, 1 - bw / W), y: clamp(c.y / H, 0, 1 - bh / H), w: bw / W, h: bh / H };
      found.push({ kind, signer: m[2].toLowerCase(), text: m[0], box, cover: { ...box, w: 0.004, h: 0.004 }, check: true });
    }
  }
  return found;
}

function place(m: RegExpMatchArray, page: number, W: number, H: number, x0: number, x1: number, baseline: number, fontH: number): FoundMarker {
  const kind = KIND[m[1].toLowerCase()];
  const size = DEFAULT_SIZE[kind];
  const bw = Math.min(size.w, W * 0.6), bh = Math.max(size.h, fontH * 1.3);
  // The box starts on the marker's first brace; its bottom sits just under the baseline (descender depth).
  const bottom = baseline + fontH * 0.25;
  const box: Rect = { page, x: clamp(x0 / W, 0, 1 - bw / W), y: clamp((bottom - bh) / H, 0, 1 - bh / H), w: bw / W, h: bh / H };
  // The cover hides exactly the marker (half a point either side), top of the tallest glyph to under the baseline.
  const cover: Rect = { page, x: clamp((x0 - 0.5) / W, 0, 1), y: clamp((baseline - fontH * 0.92) / H, 0, 1), w: Math.min(1, (x1 - x0 + 1) / W), h: Math.min(1, (fontH * 1.17) / H) };
  return { kind, signer: m[2].toLowerCase(), text: m[0], box, cover };
}

// ---------- fallback: pdf.js text runs ----------
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const cw = (ch: string) => { const c = ch.charCodeAt(0); return c >= 32 && c <= 126 ? HELV[c - 32] : 556; };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function charsFromRuns(page: any, util: Util, vp: { transform: M6 }): Promise<Ch[]> {
  const tc = await page.getTextContent();
  const out: Ch[] = [];
  for (const it of tc.items as Array<{ str?: string; transform?: number[]; width?: number }>) {
    if (typeof it.str !== "string" || !it.str.length || !it.transform) continue;
    const m = util.transform(vp.transform, it.transform);
    const vertical = Math.abs(m[1]) > Math.abs(m[0]);
    const scale = Math.hypot(m[0], m[1]) / Math.max(1e-6, Math.hypot(it.transform[0], it.transform[1]));
    const w = (it.width ?? 0) * scale, h = Math.hypot(m[2], m[3]);
    const total = [...it.str].reduce((s, c) => s + cw(c), 0) || 1;
    let acc = 0;
    for (const c of [...it.str]) {
      const x0 = m[4] + (w * acc) / total; acc += cw(c);
      out.push({ c, x0: vertical ? m[4] : x0, x1: vertical ? m[4] : m[4] + (w * acc) / total, y: vertical ? m[5] + (w * acc) / total : m[5], h, vertical });
    }
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function scanMarkers(pdf: any, pdfjs: { Util: Util; OPS: Record<string, number> }): Promise<ScanResult> {
  const markers: FoundMarker[] = [];
  let textPages = 0, glyphPages = 0, runPages = 0;
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    let chars: Ch[] = [];
    try { chars = await glyphsOf(page, pdfjs, vp.transform); } catch { chars = []; }
    const runs = await charsFromRuns(page, pdfjs.Util, vp);
    const hasText = runs.some((c) => c.c.trim()) || chars.some((c) => c.c.trim());
    if (hasText) textPages++;
    // Use the exact positions when the replay saw the same text pdf.js extracted; otherwise the runs.
    const exact = chars.filter((c) => c.c.trim()).length >= runs.filter((c) => c.c.trim()).length * 0.9 && chars.length > 0;
    if (hasText) { if (exact) glyphPages++; else runPages++; }
    markers.push(...markersFromChars(exact ? chars : runs, i, vp.width, vp.height));
  }
  return { pages: pdf.numPages, textPages, markers, method: runPages && glyphPages ? "mixed" : runPages ? "runs" : "glyphs" };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));
