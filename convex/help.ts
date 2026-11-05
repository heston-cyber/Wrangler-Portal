// Phase 5d step 4 (Nov 4, Q59, Q83): Help, a small wiki. Wrangler's starter guides (lib/helpGuides.ts) are what every
// business starts from. The owner edits one in the page editor (kept as a "guide" template of that business, nothing
// else changes) and can reset it to Wrangler's. The owner reads every guide; a client reads the ones for clients; a
// vendor reads the ones for vendors (for the business they're working for). Nobody else reads anything.
import { mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe, viewerOf } from "./lib/access";
import { asVendor } from "./vendorPortal";
import { GUIDES, forAudience, guideOf, guidePage } from "./lib/helpGuides";
import { DEFAULT_STYLE, pageOf, textOf, type Page, type PNode } from "./lib/wsBuilder";
import { defaultStyle } from "./builder";

type Ctx = QueryCtx | MutationCtx;
type Side = "owner" | "client" | "vendor";

/** Who is reading, and for which business. A vendor names the business they work for; it must be theirs. */
async function reader(ctx: Ctx, businessId?: Id<"businesses">): Promise<{ side: Side; biz: Id<"businesses"> | null }> {
  const me = await viewerOf(ctx);
  if (me.kind === "owner" || me.kind === "client") return { side: me.kind, biz: me.businessId };
  if (me.kind === "vendor") { const v2 = await asVendor(ctx, businessId); return { side: "vendor", biz: v2.biz }; }
  throw new ConvexError("Sign in first.");
}

async function overrides(ctx: Ctx, biz: Id<"businesses"> | null) {
  const rows = (await ctx.db.query("wsTemplates").collect()).filter((t) => t.kind === "guide" && t.guideSlug && (t.businessId ?? null) === biz);
  return new Map<string, Doc<"wsTemplates">>(rows.map((t) => [t.guideSlug!, t]));
}

const flat = (page: Page) => (page.content as PNode[]).map((n) => textOf(n)).join(" ").replace(/\s+/g, " ").trim();

/** The guides this person can read, with a search (title, summary and text). */
export const list = query({
  args: { businessId: v.optional(v.id("businesses")), q: v.optional(v.string()) },
  handler: async (ctx, { businessId, q }) => {
    const { side, biz } = await reader(ctx, businessId);
    const over = await overrides(ctx, biz);
    const words = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
    const out = [];
    for (const g of GUIDES) {
      if (!forAudience(side, g)) continue;
      const o = over.get(g.slug);
      const title = o?.name || g.title, summary = o ? o.description ?? "" : g.summary;
      if (words.length) {
        const hay = `${title} ${summary} ${flat(o ? pageOf(o.blocks) : guidePage(g))}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
      }
      out.push({ slug: g.slug, title, summary, audience: g.audience, edited: side === "owner" && !!o });
    }
    return out;
  },
});

/** One guide as a page to read. Null when it isn't one this person can read. */
export const guide = query({
  args: { slug: v.string(), businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, { slug, businessId }) => {
    const { side, biz } = await reader(ctx, businessId);
    const g = guideOf(slug);
    if (!g || !forAudience(side, g)) return null;
    const o = (await overrides(ctx, biz)).get(slug);
    const page = o ? pageOf(o.blocks) : guidePage(g);
    // Never hand a reader more than text, lists and headings: the editor's other blocks (parties, signatures, items,
    // call-sheet blocks) mean nothing in a guide and are left out.
    const keep = (page.content as PNode[]).filter((n) => ["paragraph", "bulletList", "orderedList", "section"].includes(n.type));
    const all = await overrides(ctx, biz);
    const related = GUIDES.filter((x) => x.slug !== slug && forAudience(side, x)).map((x) => ({ slug: x.slug, title: all.get(x.slug)?.name || x.title })).slice(0, 4);
    return { slug, title: o?.name || g.title, summary: o ? o.description ?? "" : g.summary, page: { type: "doc", content: keep } as Page, edited: side === "owner" && !!o, mine: side === "owner", related };
  },
});

/** Owner: open a guide to edit. The first time, this business gets its own copy of Wrangler's. */
export const edit = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    await requireMe(ctx);
    const g = guideOf(slug);
    if (!g) throw new ConvexError("That guide isn't here.");
    const v0 = await viewerOf(ctx);
    const biz = v0.kind === "owner" ? v0.businessId : null;
    const have = (await overrides(ctx, biz)).get(slug);
    if (have) return have._id;
    const now = Date.now();
    return await ctx.db.insert("wsTemplates", {
      name: g.title, description: g.summary, kind: "guide", guideSlug: slug, blocks: guidePage(g), fields: { project: "", custom: [] },
      style: (await defaultStyle(ctx as QueryCtx)) ?? DEFAULT_STYLE, createdAt: now, updatedAt: now,
    });
  },
});

/** Owner: back to Wrangler's version of a guide. */
export const reset = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    await requireMe(ctx);
    const v0 = await viewerOf(ctx);
    const biz = v0.kind === "owner" ? v0.businessId : null;
    const have = (await overrides(ctx, biz)).get(slug);
    if (have) await ctx.db.delete(have._id);
  },
});
