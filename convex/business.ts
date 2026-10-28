// Wrangler Portal, Phase 0.5d step 1 (Oct 28). Internal only: run by hand through the "Convex run" workflow.
// Its output is counts only (the repo and its CI logs are public).
import { internalQuery } from "./_generated/server";
import { internalMutation } from "./lib/functions";
import { ensureDefaultBusiness, ensureMembership } from "./lib/business";
import { allowedEmails } from "./lib/owners";

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
      if (u.role === "client" && (await ensureMembership(ctx, businessId, email, "client", u._id))) clientsAdded++;
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
