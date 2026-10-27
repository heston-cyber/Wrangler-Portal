"use node";
// Wrangler Sign (S4): finding {{sign:client}}-style markers on the backend, for documents Claude uploads through the
// connector (the site's own upload finds them in the browser). Same code as the page (lib/wsMarkers.ts), with
// pdf.js running in Node.
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { scanMarkers, type ScanResult } from "./lib/wsMarkers";
import type { PdfLine } from "./lib/wsPdfImport";

export const findMarkers = internalAction({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<ScanResult> => {
    const blob = await ctx.storage.get(storageId);
    if (!blob) throw new Error("The PDF is missing.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
    try { return JSON.parse(JSON.stringify(await scanMarkers(await task.promise, pdfjs))) as ScanResult; } finally { await task.destroy?.(); }
  },
});

// B4 (Oct 27): every line of text in a PDF with its position, size and boldness, for turning a PDF into an editable
// builder page (lib/wsPdfImport.ts decides what each line is).
export const extractLines = internalAction({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }): Promise<PdfLine[]> => {
    const blob = await ctx.storage.get(storageId);
    if (!blob) throw new Error("The PDF is missing.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
    try {
      const doc = await task.promise;
      const out: PdfLine[] = [];
      for (let p = 1; p <= Math.min(doc.numPages, 80); p++) {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        // The fonts' real names ("ABCDEF+Arial-BoldMT") say which text is bold or italic.
        await page.getOperatorList();
        const fontName = (id: string): string => {
          try { if (page.commonObjs.has(id)) { const f = page.commonObjs.get(id); return `${f?.name ?? ""} ${f?.loadedName ?? ""} ${f?.bold ? "bold" : ""} ${f?.italic ? "italic" : ""}`; } } catch { /* not loaded */ }
          return `${tc.styles?.[id]?.fontFamily ?? ""}`;
        };
        type Run = { x: number; y: number; w: number; size: number; text: string; bold: boolean; italic: boolean };
        const runs: Run[] = [];
        for (const it of tc.items as Array<{ str: string; transform: number[]; width: number; height: number; fontName: string }>) {
          if (!it.str) continue;
          const [a, b, , d, e, f] = it.transform;
          const size = Math.abs(it.height) || Math.hypot(a, b) || Math.abs(d);
          const name = fontName(it.fontName);
          runs.push({ x: e, y: f, w: it.width, size, text: it.str, bold: /bold|black|heavy|semibold|demi/i.test(name), italic: /italic|oblique/i.test(name) });
        }
        // Runs on (nearly) the same baseline make a line; a wide gap within a line becomes a space.
        runs.sort((r1, r2) => r2.y - r1.y || r1.x - r2.x);
        const groups: Run[][] = [];
        for (const r of runs) {
          const g = groups[groups.length - 1];
          if (g && Math.abs(g[0].y - r.y) <= Math.max(2, r.size * 0.35)) g.push(r); else groups.push([r]);
        }
        for (const g of groups) {
          g.sort((r1, r2) => r1.x - r2.x);
          let text = "", end = -Infinity;
          for (const r of g) {
            if (text && r.x - end > r.size * 0.2 && !/\s$/.test(text) && !/^\s/.test(r.text)) text += " ";
            text += r.text; end = r.x + r.w;
          }
          const chars = g.reduce((n, r) => n + r.text.trim().length, 0) || 1;
          const boldChars = g.filter((r) => r.bold).reduce((n, r) => n + r.text.trim().length, 0);
          const italChars = g.filter((r) => r.italic).reduce((n, r) => n + r.text.trim().length, 0);
          const sizes = g.map((r) => r.size).sort((s1, s2) => s1 - s2);
          out.push({ page: p, y: g[0].y, x0: g[0].x, x1: end, text, size: sizes[Math.floor(sizes.length / 2)], bold: boldChars / chars > 0.6, italic: italChars / chars > 0.6, pageWidth: vp.width, pageHeight: vp.height });
        }
        page.cleanup?.();
      }
      return out;
    } finally { await task.destroy?.(); }
  },
});
