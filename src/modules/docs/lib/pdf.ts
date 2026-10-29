// pdf.js in the browser, loaded only on Wrangler Sign pages (it's large). The legacy build so older iPhones work.
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { scanMarkers, type ScanResult } from "./markers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfJs = any;
let lib: Promise<PdfJs> | null = null;

export function pdfjs(): Promise<PdfJs> {
  if (!lib) {
    lib = import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl;
      return m;
    });
  }
  return lib;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PdfDoc = any;

export async function openPdf(src: string | Uint8Array): Promise<PdfDoc> {
  const m = await pdfjs();
  const task = m.getDocument(typeof src === "string" ? { url: src, isEvalSupported: false } : { data: src, isEvalSupported: false });
  return task.promise;
}

export async function findMarkers(doc: PdfDoc): Promise<ScanResult> {
  const m = await pdfjs();
  return scanMarkers(doc, m);
}

/** Draw one page into a canvas at a CSS width, sharp on high-DPI screens. Returns the CSS height. */
export async function renderPage(doc: PdfDoc, index: number, canvas: HTMLCanvasElement, cssWidth: number): Promise<number> {
  const page = await doc.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = (cssWidth / base.width) * dpr;
  const vp = page.getViewport({ scale });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${(cssWidth * base.height) / base.width}px`;
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  return (cssWidth * base.height) / base.width;
}
