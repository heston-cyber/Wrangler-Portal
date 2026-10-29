// Wrangler Portal, Phase 0.5d step 1 (Oct 28). Internal only: run by hand through the "Convex run" workflow.
// Its output is counts only (the repo and its CI logs are public).
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { requireMe, requireSignedIn } from "./lib/access";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { businessContact, businessInScope, defaultBusiness, ensureDefaultBusiness, ensureMembership, syncClientMemberships } from "./lib/business";
import { allowedEmails } from "./lib/owners";
import { textOn } from "./lib/color";
import { mailBrandOf } from "./lib/mail";

/** Makes the default business, the owners' memberships, and a client membership for every existing client account. */
export const bootstrap = internalMutation({
  args: {},
  handler: async (ctx) => {
    const { businessId, made, ownersAdded } = await ensureDefaultBusiness(ctx);
    let clientsAdded = 0, usersSeen = 0;
    const owners = new Set(allowedEmails());
    for await (const u of ctx.db.query("users")) {
      usersSeen++;
      const email = (u.email ?? "").toLowerCase();
      if (!email || owners.has(email)) continue;
      // Step 6: a client's memberships come from their invites (each in its own business), never all to the default.
      // An account with no invite at all (made before invites existed) stays the default business's, as before.
      if (u.role !== "client") continue;
      const invited = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()).length > 0;
      if (invited) clientsAdded += await syncClientMemberships(ctx, email, u._id);
      else if (await ensureMembership(ctx, businessId, email, "client", u._id)) clientsAdded++;
    }
    return { businessMade: made, ownersAdded, clientsAdded, usersSeen };
  },
});

/** Counts only: businesses, memberships by role, and accounts without a membership. */
export const selfTest = internalQuery({
  args: {},
  handler: async (ctx) => {
    const businesses = (await ctx.db.query("businesses").collect()).length;
    const ms = await ctx.db.query("memberships").collect();
    const live = ms.filter((m) => !m.revokedAt);
    const withMembership = new Set(live.map((m) => m.email));
    const owners = new Set(allowedEmails());
    let accountsWithout = 0;
    for await (const u of ctx.db.query("users")) {
      const e = (u.email ?? "").toLowerCase();
      if (e && (owners.has(e) || u.role === "client") && !withMembership.has(e)) accountsWithout++;
    }
    return { businesses, owners: live.filter((m) => m.role === "owner").length, clients: live.filter((m) => m.role === "client").length, accountsWithout, ok: businesses >= 1 && accountsWithout === 0 };
  },
});

/** For actions: who the business they act for is (name, legal name, owner's email). */
export const contact = internalQuery({
  args: {},
  handler: async (ctx) => businessContact(ctx, businessInScope(ctx)),
});

/** Step 6: is this the default business (Wrangler)? Shared integrations (one Stripe key, one Slack webhook) serve only it until each business has its own. Untagged counts as default. */
export const isDefault = internalQuery({
  args: { businessId: v.optional(v.union(v.id("businesses"), v.null())) },
  handler: async (ctx, { businessId }) => {
    if (!businessId) return true;
    return (await defaultBusiness(ctx))?._id === businessId;
  },
});

// ---------- Phase 1 (Oct 29): Business settings ----------
// The owner's business only (from their scope: an owner sees exactly one business). The businesses table is
// global, so these check the business explicitly rather than relying on the row guard.

const HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_MODULES = { review: true, docs: true, payments: false };

function ownBusiness(ctx: unknown): Id<"businesses"> {
  const id = businessInScope(ctx);
  if (!id) throw new ConvexError("Not allowed.");
  return id;
}

async function settingsOf(ctx: QueryCtx, b: Doc<"businesses">) {
  const c = await businessContact(ctx, b._id);
  return {
    name: b.name, legalName: b.legalName ?? null, ownerName: b.ownerName ?? null, emailFromName: b.emailFromName ?? null,
    replyTo: b.replyTo ?? null, ownerEmail: c.ownerEmail, accent: b.accent ?? null, background: b.background ?? null,
    logoUrl: b.logoFileId ? await ctx.storage.getUrl(b.logoFileId) : null,
    logoLightUrl: b.logoLightFileId ? await ctx.storage.getUrl(b.logoLightFileId) : null, modules: b.modules ?? DEFAULT_MODULES,
    // Settings shows a small warning when no text colour reaches 4.5:1 on the accent (Heston, Oct 29).
    accentCheck: b.accent ? (({ ratio, ok }) => ({ ratio: Math.round(ratio * 100) / 100, ok }))(textOn(b.accent)) : null,
  };
}

/** Settings › Business: the owner's own business. */
export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const b = await ctx.db.get(ownBusiness(ctx));
    if (!b) throw new ConvexError("Not allowed.");
    return await settingsOf(ctx, b);
  },
});

export const updateSettings = mutation({
  args: {
    name: v.optional(v.string()), legalName: v.optional(v.union(v.string(), v.null())), ownerName: v.optional(v.union(v.string(), v.null())),
    emailFromName: v.optional(v.union(v.string(), v.null())), replyTo: v.optional(v.union(v.string(), v.null())),
    accent: v.optional(v.union(v.string(), v.null())), background: v.optional(v.union(v.string(), v.null())),
    modules: v.optional(v.object({ review: v.boolean(), docs: v.boolean(), payments: v.boolean() })),
  },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const id = ownBusiness(ctx);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    const text = (k: string, val: string | null | undefined, max: number, required = false) => {
      if (val === undefined) return;
      const s = (val ?? "").trim().replace(/\s+/g, " ");
      if (!s) { if (required) throw new ConvexError("The business name can't be empty."); patch[k] = undefined; return; }
      if (s.length > max) throw new ConvexError(`Keep it under ${max} characters.`);
      patch[k] = s;
    };
    text("name", a.name, 80, true);
    text("legalName", a.legalName, 160);
    text("ownerName", a.ownerName, 80);
    text("emailFromName", a.emailFromName, 80);
    if (a.replyTo !== undefined) {
      const e = (a.replyTo ?? "").trim().toLowerCase();
      if (e && !EMAIL.test(e)) throw new ConvexError("Enter a valid reply-to email.");
      patch.replyTo = e || undefined;
    }
    for (const k of ["accent", "background"] as const) {
      if (a[k] === undefined) continue;
      const c = (a[k] ?? "").trim();
      if (c && !HEX.test(c)) throw new ConvexError("Colours are written like #A1B2C3.");
      patch[k] = c ? c.toUpperCase() : undefined;
    }
    if (a.modules) patch.modules = a.modules;
    await ctx.db.patch(id, patch as never);
    return null;
  },
});

export const logoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => { await requireMe(ctx); ownBusiness(ctx); return await ctx.storage.generateUploadUrl(); },
});

/** The logo for dark backgrounds (the portal), or with which: "light", the one for light backgrounds (emails, PDFs). */
export const setLogo = mutation({
  args: { storageId: v.union(v.id("_storage"), v.null()), which: v.optional(v.union(v.literal("dark"), v.literal("light"))) },
  handler: async (ctx, { storageId, which }) => {
    await requireMe(ctx);
    const id = ownBusiness(ctx);
    const b = await ctx.db.get(id);
    if (!b) throw new ConvexError("Not allowed.");
    if (storageId) {
      const meta = await ctx.db.system.get(storageId);
      if (!meta || !/^image\/(png|jpeg|svg\+xml|webp)$/.test(meta.contentType ?? "") || meta.size > 1_000_000) {
        throw new ConvexError("Use a PNG, JPG, SVG or WebP image under 1 MB.");
      }
    }
    const field = which === "light" ? "logoLightFileId" : "logoFileId";
    const old = b[field];
    if (old && old !== storageId) await ctx.storage.delete(old);
    await ctx.db.patch(id, { [field]: storageId ?? undefined, updatedAt: Date.now() });
    return null;
  },
});

/** The look of each business the caller belongs to (its client side wears it). Owner: their own; client: each one. */
export const brand = query({
  args: {},
  handler: async (ctx) => {
    await requireSignedIn(ctx);
    const scope = (ctx as { scope?: { isOwner: boolean; owner: Id<"businesses"> | null; members: Set<string> } }).scope;
    const ids = scope?.isOwner ? [scope.owner] : [...(scope?.members ?? [])];
    const out = [];
    for (const id of ids) {
      const b = id ? await ctx.db.get(id as Id<"businesses">) : null;
      if (!b) continue;
      out.push({ businessId: b._id, name: b.name, accent: b.accent ?? null, background: b.background ?? null, logoUrl: b.logoFileId ? await ctx.storage.getUrl(b.logoFileId) : null, modules: b.modules ?? DEFAULT_MODULES });
    }
    return out;
  },
});

/** Phase 1 step 5: the business's look for its emails (the business in scope, else the one named, else the default). */
export const mailBrand = internalQuery({
  args: { businessId: v.optional(v.union(v.id("businesses"), v.null())) },
  handler: async (ctx, { businessId }) => mailBrandOf(ctx, businessId ?? businessInScope(ctx)),
});
