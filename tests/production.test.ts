// Phase 5b step 1 (Nov 3): Production › Overview and Shoots. T5b.1: the counts match the real shoots and edits;
// T5b.5 (part): only this business's.
import { convexTest } from "convex-test";
import { beforeAll, expect, test } from "vitest";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { todayCentral } from "../convex/lib/bookings";
import { addDays } from "../convex/footage";

const modules = import.meta.glob("../convex/**/*.ts");
const api = anyApi;

beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });

async function setup() {
  const t = convexTest(schema, modules);
  const today = todayCentral();
  const ids = await t.run(async (ctx) => {
    const a = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    await ctx.db.insert("memberships", { businessId: a, email: "heston@wranglerproductions.com", userId: owner, role: "owner", createdAt: 0 });
    const b = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const boss = await ctx.db.insert("users", { email: "boss@otherfilms.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: b, email: "boss@otherfilms.example", userId: boss, role: "owner", createdAt: 1 });
    const harbor = await ctx.db.insert("clients", { businessId: a, name: "Harbor Coffee", createdAt: 0 } as never);
    const launch = await ctx.db.insert("projects", { businessId: a, name: "Launch", jobNumber: "26127", clientId: harbor, stage: "production", keyDates: [{ label: "Cut 2 due", date: addDays(today, 3) }], createdAt: 0 });
    await ctx.db.insert("projects", { businessId: a, name: "Spirit Days", stage: "polish", nextStep: "client reviewing", createdAt: 0 });
    await ctx.db.insert("projects", { businessId: a, name: "Early", stage: "discovery", createdAt: 0 });
    const shoot = (businessId: Id<"businesses">, projectId: Id<"projects">, date: string, status: "scheduled" | "cancelled" = "scheduled") =>
      ctx.db.insert("shoots", { businessId, projectId, date, call: "07:30", location: "Studio B", prepare: [], crew: [], status, history: [], createdAt: 0, updatedAt: 0 });
    await shoot(a, launch, today);
    await shoot(a, launch, addDays(today, 2));
    await shoot(a, launch, addDays(today, 10));
    await shoot(a, launch, addDays(today, 1), "cancelled");
    await shoot(a, launch, addDays(today, -5));
    const other = await ctx.db.insert("projects", { businessId: b, name: "Theirs", stage: "production", createdAt: 0 });
    await shoot(b, other, today);
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    return { heston: await sess(owner), boss: await sess(boss) };
  });
  return { t, today, heston: t.withIdentity({ subject: ids.heston }), boss: t.withIdentity({ subject: ids.boss }) };
}

test("T5b.1 the Overview counts the real shoots and edits (cancelled and past left out), and This week lists them in order", async () => {
  const w = await setup();
  const o = await w.heston.query(api.production.overview, {});
  expect(o.tiles).toMatchObject({ today: 1, week: 2, edits: 2 });
  expect(o.tiles.todayFirst).toMatchObject({ client: "Harbor Coffee", date: w.today });
  expect(o.shootsTotal).toBe(3);
  expect(o.shoots.map((s: { date: string }) => s.date)).toEqual([w.today, addDays(w.today, 2), addDays(w.today, 10)]);
  expect(o.edits.map((e: { label: string }) => e.label)).toEqual(["26127 Launch", "Spirit Days"]); // soonest date first
  expect(o.edits[1]).toMatchObject({ stage: "polish", nextStep: "client reviewing" });
  expect(o.week.map((x: { text: string }) => x.text)).toEqual(["Harbor Coffee shoot", "Harbor Coffee shoot", "Launch · Cut 2 due"]);
  expect(o.calendar).toBeNull();
});

test("T5b.1 Shoots: upcoming and past; T5b.5 another business's owner sees only their own", async () => {
  const w = await setup();
  const s = await w.heston.query(api.production.shoots, {});
  expect(s.upcoming).toHaveLength(3);
  expect(s.past).toHaveLength(1);
  expect(s.pastTotal).toBe(1);
  const theirs = await w.boss.query(api.production.overview, {});
  expect(theirs.tiles).toMatchObject({ today: 1, week: 1, edits: 1 });
  expect(theirs.shoots.every((x: { project: string }) => x.project === "Theirs")).toBe(true);
  expect((await w.boss.query(api.production.projectsForShoot, {})).map((p: { label: string }) => p.label)).toEqual(["Theirs"]);
});
