// Phase 7 step 2 (D109, D111, D113, D114; Heston, Nov 18: "Approved"): a new business's setup, frames 750:916–750:2099
// and the Home checklist 751:1096. Steps (after the sign-in, step 1): 2 the business and its look, 3 email, 4 pricing,
// 5 connections, 6 the first client. Every step can be finished later (D111); the Home checklist shows what's left until
// it's all done or hidden. Wrangler (the default business) never sees any of it (D114). The owner only: a team member
// doesn't set up the business.
import { v, ConvexError } from "convex/values";
import { inviteCap } from "./lib/rate";
import { mutation, query } from "./lib/functions";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { businessInScope, defaultBusiness } from "./lib/business";
import { ratesOf } from "./crm";
import { EMPTY_RATES, ratesProblems, type Rates } from "./lib/estimate";
import { ensureInvite } from "./clients";
import { audit } from "./lib/audit";

const STEPS = ["business", "email", "pricing", "connections", "client"] as const;
type StepKey = (typeof STEPS)[number];
const stepArg = v.union(v.literal("business"), v.literal("email"), v.literal("pricing"), v.literal("connections"), v.literal("client"));

async function mine(ctx: QueryCtx | MutationCtx) {
  const me = await requireMe(ctx); // the owner only
  const id = businessInScope(ctx);
  const b = id ? await ctx.db.get(id) : null;
  if (!b) throw new ConvexError("Not allowed.");
  const def = await defaultBusiness(ctx);
  return { me, b, isDefault: def?._id === b._id };
}

const dollars = (c: number | undefined) => (c && c > 0 ? Math.round(c) / 100 : null);

/** Where setup is. null for Wrangler (it never sets up) and for anyone but the owner. */
export const state = query({
  args: {},
  handler: async (ctx) => {
    let m;
    try { m = await mine(ctx); } catch { return null; }
    const { b, isDefault, me } = m;
    if (isDefault) return null;
    const s = b.setup ?? { step: 0 };
    const r = await ratesOf(ctx, b);
    const kind = (id: string) => r.kinds.find((k) => k.id === id && k.unit === "hour");
    const connections = {
      stripe: b.stripe?.status === "connected",
      dropbox: !!(await ctx.db.query("dropbox").first()),
      // 8f review M1: the one connector's live keys (the old Review keys can't be made or used any more).
      claude: (await ctx.db.query("portalKeys").collect()).some((k) => !k.revokedAt && !!k.madeBy && (!k.expiresAt || k.expiresAt > Date.now())),
      calendar: !!(await ctx.db.query("calendars").first()),
    };
    const done = { business: !!s.business, email: !!s.email, pricing: !!s.pricing, connections: !!s.connections, client: !!s.client };
    return {
      business: b.name, first: (me.name || "").split(" ")[0] || null, step: s.step, hidden: !!s.hidden, finished: !!b.setupDoneAt, done,
      rates: { hourly: dollars(r.defaults?.hourlyCents), daily: dollars(r.defaults?.dailyCents), shooting: dollars(kind("shooting")?.clientCents), editing: dollars(kind("editing")?.clientCents) },
      connections,
    };
  },
});

async function mark(ctx: MutationCtx, b: Doc<"businesses">, key: StepKey | null, step: number) {
  const now = Date.now();
  const s = { ...(b.setup ?? { step: 0 }), step: Math.max(0, Math.min(STEPS.length, Math.round(step))) };
  if (key) s[key] = s[key] ?? now;
  const all = STEPS.every((k) => (s as Record<string, unknown>)[k]);
  await ctx.db.patch(b._id, { setup: s, ...(all && !b.setupDoneAt ? { setupDoneAt: now } : {}) });
}

/** A step's Continue (it's done) or Finish later / Back (where they are). */
export const step = mutation({
  args: { done: v.optional(stepArg), at: v.number() },
  handler: async (ctx, a) => {
    const { b, isDefault } = await mine(ctx);
    if (isDefault) return null;
    await mark(ctx, b, a.done ?? null, a.at);
    return null;
  },
});

/** Step 4 (750:1649): the four rates; the rest stays in Settings › Pricing. Blank leaves a rate as it is. */
export const saveRates = mutation({
  args: { hourly: v.optional(v.number()), daily: v.optional(v.number()), shooting: v.optional(v.number()), editing: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const { b, isDefault } = await mine(ctx);
    if (isDefault) throw new ConvexError("Change Wrangler's rates in Settings › Pricing.");
    for (const x of [a.hourly, a.daily, a.shooting, a.editing]) if (x !== undefined && !(x >= 0 && x <= 1_000_000)) throw new ConvexError("Rates are $0 or more.");
    const cents = (x: number) => Math.round(x * 100);
    const r: Rates = JSON.parse(JSON.stringify(b.estimateRates ?? EMPTY_RATES));
    if (a.hourly !== undefined || a.daily !== undefined) r.defaults = { hourlyCents: a.hourly !== undefined ? cents(a.hourly) : r.defaults?.hourlyCents ?? 0, dailyCents: a.daily !== undefined ? cents(a.daily) : r.defaults?.dailyCents ?? 0 };
    for (const [id, name, x] of [["shooting", "Shooting", a.shooting], ["editing", "Editing", a.editing]] as const) {
      if (x === undefined) continue;
      const k = r.kinds.find((y) => y.id === id);
      if (k) { k.clientCents = cents(x); k.unit = "hour"; } else r.kinds.push({ id, name, unit: "hour", clientCents: cents(x) });
    }
    const problems = ratesProblems(r);
    if (problems.length) throw new ConvexError(problems[0]);
    await ctx.db.patch(b._id, { estimateRates: r });
    await audit(ctx, { kind: "settings", text: "set rates in setup", where: "Setup", link: "/settings/rates" });
    await mark(ctx, (await ctx.db.get(b._id))!, "pricing", 4);
    return null;
  },
});

/** Step 6 (750:2099): the first client: a company, a person on it who signs, and their portal invite (email 03b). */
export const firstClient = mutation({
  args: { company: v.string(), name: v.string(), email: v.string() },
  handler: async (ctx, a) => {
    const { b, isDefault } = await mine(ctx);
    if (isDefault) throw new ConvexError("Invite clients from Clients › Companies.");
    const company = a.company.replace(/\s+/g, " ").trim().slice(0, 80), name = a.name.replace(/\s+/g, " ").trim().slice(0, 60);
    if (company.length < 2) throw new ConvexError("Type the company's name.");
    const existing = (await ctx.db.query("clients").collect()).find((c) => c.name.toLowerCase() === company.toLowerCase());
    const clientId = existing?._id ?? await ctx.db.insert("clients", { name: company, createdAt: Date.now() });
    const r = await ensureInvite(ctx, a.email, name || undefined); // checks the address
    const people = await ctx.db.query("clientPeople").withIndex("by_client", (q) => q.eq("clientId", clientId)).collect();
    const same = people.find((p) => p.email === r.email);
    if (same) { if (same.removedAt) await ctx.db.patch(same._id, { removedAt: undefined }); }
    else await ctx.db.insert("clientPeople", { clientId, email: r.email, role: "signer", createdAt: Date.now(), ...(name ? { name } : {}) });
    await audit(ctx, { kind: "sent", text: `sent a portal invite to ${name || r.email}`, where: "Setup", link: `/clients/${clientId}` });
    await inviteCap(ctx, b._id, r.email); // Phase 7 reviews (M4)
    await ctx.scheduler.runAfter(0, internal.emails.portalInvite, { email: r.email, sendKey: String(Math.floor(Date.now() / 60_000)) });
    await mark(ctx, b, "client", 5);
    return { clientId };
  },
});

/** The Home checklist's Hide (it can be shown again from Settings › Business). */
export const hide = mutation({
  args: { hidden: v.boolean() },
  handler: async (ctx, { hidden }) => {
    const { b, isDefault } = await mine(ctx);
    if (isDefault) return null;
    await ctx.db.patch(b._id, { setup: { ...(b.setup ?? { step: 0 }), hidden } });
    return null;
  },
});
