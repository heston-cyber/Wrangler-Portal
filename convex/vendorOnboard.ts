// Phase 7 step 4 (D108, D111, D94, D100, D101; Heston, Nov 18: "Approved", then "Onward"): a new vendor's onboarding,
// frames 749:540 (1 Welcome and sign-in), 749:676 (2 Profile), 749:898 (3 W-9), 749:1039 (4 Payment method), 749:1187
// (5 the tour) and 749:1319 (a vendor already on WranglerPortal). Every step can be finished later; the Getting started
// card on their Home shows what's left.
//
// Three kinds, per business (each business keeps its own vendor record, so each has its own onboarding):
// - "full": their first business (where they made their login): Profile, W-9, Payment method, tour.
// - "short" (D94): a business they joined after their first: only that business's W-9 and how they like to be paid. Their
//   profile isn't copied from the other business (each business sees only what's shared with it); they can add to this
//   business's copy in Settings.
// - "existing": a vendor who joined before Phase 7 (their invite has no end date, D134): only the tour, once (as D114 does
//   for clients).
//
// Who may call: a vendor login working for that business (asVendor, the same check as every vendor-side call). The W-9 is
// uploaded through vendorPortal.w9UploadUrl and vendorPortal.setW9, unchanged (reviewed in 5e and Phase 6).
import { v, ConvexError } from "convex/values";
import { mutation, query } from "./lib/functions";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { asVendor, vendorBusinessIds } from "./vendorPortal";
import { PAY_METHODS, accountIn, looksLikeAccount } from "./lib/bookings";
import { ownerNames } from "./auth";
import { audit } from "./lib/audit";

type Ctx = QueryCtx | MutationCtx;
type Kind = "full" | "short" | "existing";
const plain = (s: string | undefined, max: number) => (s ?? "").replace(/[\u0000-\u001f\u007f<>{}]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const STEPS: Record<Kind, number> = { full: 4, short: 2, existing: 0 }; // full: profile, W-9, payment, tour; short: W-9, payment
/** The roles the Profile offers (749:676), beside any the business or the vendor already gave. */
const VENDOR_ROLES = ["Shooter", "Editor", "Colourist", "Drone pilot", "Sound"];

/** The vendor's record in one of their businesses, and which onboarding it gets. */
async function me(ctx: Ctx, businessId: Id<"businesses"> | undefined) {
  const ids = await vendorBusinessIds(ctx); // a vendor login, or refused
  const m = await asVendor(ctx, businessId);
  const kind: Kind = ids.indexOf(m.biz) > 0 ? "short" : m.vendor.inviteExpiresAt === undefined ? "existing" : "full";
  return { ...m, kind };
}

export const state = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, { businessId }) => {
    const { user, biz, vendor: x, kind } = await me(ctx, businessId);
    const b = await ctx.db.get(biz);
    const o = x.onboard ?? { step: 0 };
    const rate = x.rates[0] ? { cents: x.rates[0].cents, unit: x.rates[0].unit } : null;
    return {
      businessId: biz, business: b?.name ?? "The business", kind, signedInAs: user.name?.trim() || x.name,
      step: o.step, started: !!x.onboard,
      done: { profile: kind !== "full" || !!o.profile, w9: !!x.w9, pay: !!x.payMethod, tour: kind === "short" || !!o.tour },
      tourSkipped: !!o.tourSkipped,
      profile: { name: x.name, businessName: x.businessName ?? "", roles: x.roles, rate, basedIn: x.basedIn ?? "", gear: (x.gear ?? []).join(", "), portfolio: x.portfolio ?? "" },
      roleChoices: [...new Set([...VENDOR_ROLES, ...x.roles])],
      w9: x.w9 ? { name: x.w9.name, uploadedAt: x.w9.uploadedAt } : null,
      pay: x.payMethod ? { method: x.payMethod.method, note: x.payMethod.note ?? "" } : null,
      methods: PAY_METHODS,
    };
  },
});

async function mark(ctx: MutationCtx, x: Doc<"vendors">, kind: Kind, at: number, extra: { profile?: boolean; tour?: boolean; tourSkipped?: boolean } = {}) {
  const prev = x.onboard ?? { step: 0 };
  const o = { ...prev, step: Math.max(0, Math.min(STEPS[kind], Math.round(Number.isFinite(at) ? at : 0))) };
  if (extra.profile) o.profile = prev.profile ?? Date.now();
  if (extra.tour) o.tour = prev.tour ?? Date.now();
  if (extra.tourSkipped !== undefined) o.tourSkipped = extra.tourSkipped;
  await ctx.db.patch(x._id, { onboard: o });
}

/** Continue, Back or Finish later: where they are (the step they'll come back to). */
export const step = mutation({
  args: { businessId: v.id("businesses"), at: v.number() },
  handler: async (ctx, { businessId, at }) => {
    const { vendor, kind } = await me(ctx, businessId);
    await mark(ctx, vendor, kind, at);
    return null;
  },
});

/** The tour finished, or skipped (it can be taken again any time from the Home card). */
export const tour = mutation({
  args: { businessId: v.id("businesses"), skipped: v.boolean() },
  handler: async (ctx, { businessId, skipped }) => {
    const { vendor, kind } = await me(ctx, businessId);
    await mark(ctx, vendor, kind, STEPS[kind], skipped ? { tourSkipped: true } : { tour: true, tourSkipped: false });
    return null;
  },
});

/** 749:676 Profile: name, business name, roles, their rate, where they're based, gear and portfolio, on this business's
 *  record (pre-filled with what the business typed in Add vendor). Their name is also their login's name. */
export const profile = mutation({
  args: {
    businessId: v.id("businesses"), name: v.string(), businessName: v.optional(v.string()), roles: v.array(v.string()),
    rateCents: v.optional(v.number()), rateUnit: v.optional(v.union(v.literal("day"), v.literal("hour"))),
    basedIn: v.optional(v.string()), gear: v.optional(v.string()), portfolio: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const { user, vendor: x, kind } = await me(ctx, a.businessId);
    if (kind !== "full") throw new ConvexError("Your details for this business are in Settings."); // reviews: no Profile step in the short or tour-only flows
    const name = plain(a.name, 60);
    if (name.length < 2) throw new ConvexError("Add your name.");
    // Reviews (Phase 7, M3): the same guard as users.setName: nobody else may take the owner's name.
    if (ownerNames().has(name.toLowerCase())) throw new ConvexError("That name is taken.");
    const roles = [...new Set(a.roles.map((r) => plain(r, 40)).filter(Boolean))].slice(0, 12);
    // Reviews (Phase 7, M3): no account, routing, card or tax ID numbers in any of their text (D101's check).
    const bad = accountIn({ Name: name, "Business name": a.businessName, Roles: roles.join(", "), "Based in": a.basedIn, Gear: a.gear, Portfolio: a.portfolio });
    if (bad) throw new ConvexError(`${bad}: leave out account, routing and tax ID numbers. The business asks for those directly.`);
    let rates = x.rates;
    let rateNote: string | null = null;
    if (a.rateCents !== undefined) {
      const cents = Math.round(a.rateCents), unit = a.rateUnit ?? x.rates[0]?.unit ?? "hour";
      if (!Number.isFinite(cents) || cents < 0 || cents > 10_000_000) throw new ConvexError("Check your rate.");
      const cur = x.rates[0];
      if (!cur || cur.cents !== cents || cur.unit !== unit) {
        // Reviews (Phase 7, M2): "Your rate" is part of a new vendor's own onboarding only (Heston, Nov 18: they may set
        // it there); afterwards the business sets rates. It changes the one rate the form shows, never the others, and the
        // change is in the owner's Activity. Bookings keep the rate agreed on them.
        const done = !!x.onboard?.profile && !!x.w9 && !!x.payMethod && (!!x.onboard?.tour || !!x.onboard?.tourSkipped);
        if (kind !== "full" || done) throw new ConvexError("Your rate is set with the business. Ask them to change it.");
        rates = [{ role: cur?.role ?? roles[0] ?? "Rate", unit, cents }, ...x.rates.slice(1)];
        rateNote = `${cur ? `$${(cur.cents / 100).toFixed(2)} / ${cur.unit}` : "no rate"} to $${(cents / 100).toFixed(2)} / ${unit}`;
      }
    }
    const gear = a.gear === undefined ? x.gear : [...new Set(a.gear.split(/[,\n]/).map((g) => plain(g, 40)).filter(Boolean))].slice(0, 30);
    await ctx.db.patch(x._id, {
      name, businessName: plain(a.businessName, 120) || undefined, roles, rates, basedIn: plain(a.basedIn, 80) || undefined,
      gear: gear && gear.length ? gear : undefined, portfolio: plain(a.portfolio, 300) || undefined, updatedAt: Date.now(),
    });
    if (kind === "full") await ctx.db.patch(user._id, { name }); // their login's name (the switcher, "signed in as")
    if (rateNote) await audit(ctx, { kind: "settings", text: `${name} set their ${rates[0].role} rate in onboarding: ${rateNote}`, where: "Vendors", link: `/vendors/${x._id}` });
    await mark(ctx, (await ctx.db.get(x._id))!, kind, 1, { profile: true });
    return null;
  },
});

/** 749:1039 Payment method: the method and a note only, never bank numbers (D101). */
export const payMethod = mutation({
  args: { businessId: v.id("businesses"), method: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { vendor: x } = await me(ctx, a.businessId);
    if (!PAY_METHODS.includes(a.method)) throw new ConvexError("Pick how you get paid.");
    const note = plain(a.note, 300);
    // D101: a long run of digits looks like an account or routing number: refused (as Settings does).
    if (looksLikeAccount(note)) throw new ConvexError("Leave out account and routing numbers. Say how you like to be paid; the business asks for the rest.");
    await ctx.db.patch(x._id, { payMethod: { method: a.method, ...(note ? { note } : {}) }, updatedAt: Date.now() });
    return null;
  },
});
