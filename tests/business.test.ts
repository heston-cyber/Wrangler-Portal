// Wrangler Portal, Phase 0.5d step 1 (Oct 28): the default business and memberships.
import { convexTest } from "convex-test";
import { beforeAll, expect, test } from "vitest";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { viewerOf } from "../convex/lib/access";
import { DEFAULT_SLUG } from "../convex/lib/business";

const modules = import.meta.glob("../convex/**/*.ts");
const internal = anyApi;

beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    const maya = await ctx.db.insert("users", { email: "maya@harbor.example", name: "Maya", role: "client" });
    const stranger = await ctx.db.insert("users", { email: "who@example.com", name: "Who" });
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    return { owner, maya, stranger, ownerSub: await sess(owner), mayaSub: await sess(maya), strangerSub: await sess(stranger) };
  });
  return { t, ids };
}

test("bootstrap makes Wrangler, the owner's membership and existing clients' memberships, once", async () => {
  const { t } = await setup();
  const first = await t.mutation(internal.business.bootstrap, {});
  expect(first).toEqual({ businessMade: true, ownersAdded: 1, clientsAdded: 1, usersSeen: 3 });
  const again = await t.mutation(internal.business.bootstrap, {});
  expect(again).toEqual({ businessMade: false, ownersAdded: 0, clientsAdded: 0, usersSeen: 3 });
  const state = await t.run(async (ctx) => ({
    biz: await ctx.db.query("businesses").collect(),
    ms: await ctx.db.query("memberships").collect(),
  }));
  expect(state.biz.map((b) => [b.slug, b.name, b.legalName])).toEqual([[DEFAULT_SLUG, "Wrangler Productions", "Wrangler Productions, a DBA of Hill Creative LLC"]]);
  expect(state.ms.map((m) => [m.email, m.role]).sort()).toEqual([["heston@wranglerproductions.com", "owner"], ["maya@harbor.example", "client"]]);
  // The stranger (no role, not invited) gets nothing.
  expect(state.ms.some((m) => m.email === "who@example.com")).toBe(false);
  expect(await t.query(internal.business.selfTest, {})).toEqual({ businesses: 1, owners: 1, clients: 1, accountsWithout: 0, ok: true });
});

test("viewerOf carries the business; roles and refusals are unchanged", async () => {
  const { t, ids } = await setup();
  // Before bootstrap there's no business yet: roles still work, businessId is null.
  const pre = await t.withIdentity({ subject: ids.ownerSub }).run((ctx) => viewerOf(ctx));
  expect(pre).toMatchObject({ kind: "owner", businessId: null });
  await t.mutation(internal.business.bootstrap, {});
  const biz = await t.run(async (ctx) => (await ctx.db.query("businesses").first())!._id);
  expect(await t.withIdentity({ subject: ids.ownerSub }).run((ctx) => viewerOf(ctx))).toMatchObject({ kind: "owner", businessId: biz });
  expect(await t.withIdentity({ subject: ids.mayaSub }).run((ctx) => viewerOf(ctx))).toMatchObject({ kind: "client", businessId: biz });
  expect(await t.withIdentity({ subject: ids.strangerSub }).run((ctx) => viewerOf(ctx))).toEqual({ kind: "nobody" });
  expect(await t.run((ctx) => viewerOf(ctx))).toEqual({ kind: "nobody" });
});

test("a revoked membership is ignored", async () => {
  const { t, ids } = await setup();
  await t.mutation(internal.business.bootstrap, {});
  await t.run(async (ctx) => {
    const m = (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", "maya@harbor.example")).first())!;
    await ctx.db.patch(m._id, { revokedAt: Date.now() });
  });
  // Maya is still a client by role (invites decide access to shares, as before); her business falls back to the default.
  const v = await t.withIdentity({ subject: ids.mayaSub }).run((ctx) => viewerOf(ctx));
  expect(v).toMatchObject({ kind: "client" });
  expect(await t.query(internal.business.selfTest, {})).toMatchObject({ clients: 0, accountsWithout: 1, ok: false });
});
