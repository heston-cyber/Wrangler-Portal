// Phase 8d (Heston, Nov 19: "approved"): a creative doc's or briefing's text, read and written as page markdown, so
// Claude can write a treatment, a script or a shoot brief. The site's builder edits the same page. Nothing here sends:
// a creative doc's share link and a briefing's links show the copy made when they were shared (Share again or
// "Update the link" on the site puts a new one live).
import { v, ConvexError } from "convex/values";
import { mutation, query } from "./lib/functions";
import { requireAll } from "./lib/access";
import { pageFromMarkdown, pageToMarkdown, PAGE_MARKDOWN_GUIDE } from "./lib/wsPageMd";
import { pageOf } from "./lib/wsBuilder";
import { writeBuildPage } from "./builder";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

const which = { creativeDocId: v.optional(v.id("creativeDocs")), briefingId: v.optional(v.id("briefings")) };

async function buildOf(ctx: QueryCtx, a: { creativeDocId?: Id<"creativeDocs">; briefingId?: Id<"briefings"> }) {
  if (!!a.creativeDocId === !!a.briefingId) throw new ConvexError("Pass creativeDocId or briefingId.");
  if (a.creativeDocId) {
    await requireAll(ctx, "projects"); // a creative doc needs Projects (Heston, Nov 17, Q4)
    const d = await ctx.db.get(a.creativeDocId);
    if (!d) throw new ConvexError("That creative doc isn't here.");
    return { buildId: d.buildId, what: "creative doc" };
  }
  await requireAll(ctx, "docs"); // a briefing's page, as in the builder
  const b = await ctx.db.get(a.briefingId!);
  if (!b) throw new ConvexError("That briefing isn't here.");
  return { buildId: b.buildId, what: "briefing" };
}

export const get = query({
  args: which,
  handler: async (ctx, a) => {
    const { buildId, what } = await buildOf(ctx, a);
    const b = await ctx.db.get(buildId);
    if (!b) throw new ConvexError(`That ${what}'s page isn't here.`);
    return { what, title: b.title, markdown: pageToMarkdown(pageOf(b.blocks)), how_to_write: PAGE_MARKDOWN_GUIDE };
  },
});

export const write = mutation({
  args: { ...which, title: v.optional(v.string()), markdown: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { buildId, what } = await buildOf(ctx, a);
    if (a.markdown !== undefined && a.markdown.length > 200_000) throw new ConvexError("That's too long for one page.");
    await writeBuildPage(ctx, buildId, a.title, a.markdown !== undefined ? pageFromMarkdown(a.markdown) : undefined);
    return { written: what };
  },
});
