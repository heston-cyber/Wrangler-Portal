"use node";
// Wrangler Sign (S4): finding {{sign:client}}-style markers on the backend, for documents Claude uploads through the
// connector (the site's own upload finds them in the browser). Same code as the page (lib/wsMarkers.ts), with
// pdf.js running in Node.
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { scanMarkers, type ScanResult } from "./lib/wsMarkers";

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
