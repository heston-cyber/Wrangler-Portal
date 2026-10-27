"use node";
// B4 (Oct 27): a builder draft rendered to its PDF on the backend, with the same renderer the page uses
// (src/builder/pdf.tsx, @react-pdf/renderer), so Claude can take a draft to signing through the connector without a
// browser. The style's Google fonts are fetched first if they aren't stored yet.
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const renderBuild = internalAction({
  args: { buildId: v.id("wsBuilds") },
  handler: async (ctx, { buildId }): Promise<Id<"_storage">> => {
    let inp = await ctx.runQuery(internal.builder.renderInputs, { buildId });
    if (!inp) throw new Error("That draft doesn't exist.");
    const missing = [inp.d.style.fonts.heading, inp.d.style.fonts.body].filter((f) => f.source === "google" && !inp!.fonts.some((x) => x.family === f.family));
    if (missing.length) {
      for (const f of new Set(missing.map((x) => x.family))) await ctx.runAction(internal.builder.ensureGoogleFontInternal, { family: f }).catch(() => null);
      inp = (await ctx.runQuery(internal.builder.renderInputs, { buildId }))!;
    }
    const React = await import("react");
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { DocPdf } = await import("../src/builder/pdf");
    const el = React.createElement(DocPdf, { d: inp.d, assets: { fonts: inp.fonts, files: inp.files }, label: inp.label });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = await renderToBuffer(el as any);
    return ctx.storage.store(new Blob([new Uint8Array(buf)], { type: "application/pdf" }));
  },
});
