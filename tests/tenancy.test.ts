// Wrangler Portal, Phase 0.5d step 2 (Oct 28): every table is classified; new records get their business; the
// tagging migration fills in existing records once and leaves Wrangler Sign's audit trail alone.
import { convexTest } from "convex-test";
import { beforeAll, expect, test } from "vitest";
import { anyApi } from "convex/server";
import { readFileSync } from "node:fs";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { BUSINESS_TABLES, GLOBAL_TABLES, INHERITED_TABLES } from "../convex/lib/tenancy";
import { appendEvent, eventsOf, verifyChain } from "../convex/lib/wsAudit";

const modules = import.meta.glob("../convex/**/*.ts");
const api = anyApi;
const internal = anyApi;

beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });

test("every table is classified once, and every business table has a businessId field", () => {
  const src = readFileSync("convex/schema.ts", "utf8");
  const tables = [...src.matchAll(/^ {2}(\w+): defineTable\(\{/gm)].map((m) => m[1]);
  const classified = [...BUSINESS_TABLES, ...GLOBAL_TABLES, ...INHERITED_TABLES];
  expect([...classified].sort()).toEqual([...tables].sort());
  expect(new Set(classified).size).toBe(classified.length);
  for (const t of BUSINESS_TABLES) {
    const block = src.slice(src.indexOf(`  ${t}: defineTable({`)).split(/\n {2}\w+: defineTable\(/)[0];
    expect(block, t).toContain('businessId: v.optional(v.id("businesses"))');
  }
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    const sess = `${owner}|${await ctx.db.insert("authSessions", { userId: owner, expirationTime: Date.now() + 3_600_000 })}`;
    return { owner, sess };
  });
  return { t, ids };
}

test("a record made through the app gets the default business, even before bootstrap ran", async () => {
  const { t, ids } = await setup();
  const me = t.withIdentity({ subject: ids.sess });
  const projectId = await me.mutation(api.library.createProject, { name: "Harbor Coffee Launch", client: "Harbor Coffee" });
  const { inviteId } = await me.mutation(api.clients.invite, { email: "maya@harbor.example" });
  const got = await t.run(async (ctx) => ({
    biz: (await ctx.db.query("businesses").collect()).map((b) => b._id),
    project: await ctx.db.get(projectId as Id<"projects">),
    invite: await ctx.db.get(inviteId as Id<"invites">),
  }));
  expect(got.biz).toHaveLength(1);
  expect(got.project?.businessId).toBe(got.biz[0]);
  expect(got.invite?.businessId).toBe(got.biz[0]);
});

test("tagAll tags existing records once, counts them, and never touches the audit trail", async () => {
  const { t } = await setup();
  const ids = await t.run(async (ctx) => {
    const p = await ctx.db.insert("projects", { name: "Old", createdAt: 1 });
    const vid = await ctx.db.insert("videos", { projectId: p, title: "Old cut", createdAt: 1, updatedAt: 1 });
    const doc = await ctx.db.insert("wsDocuments", { number: 1, title: "Old contract", status: "draft", currentVersion: 1, createdAt: 1, updatedAt: 1 });
    await appendEvent(ctx as never, doc as Id<"wsDocuments">, { kind: "created", actor: "heston" });
    await appendEvent(ctx as never, doc as Id<"wsDocuments">, { kind: "approved", actor: "heston" });
    return { p, vid, doc };
  });
  const before = await t.run(async (ctx) => (await eventsOf(ctx, ids.doc as Id<"wsDocuments">)).map((e) => ({ ...e })));
  const r = await t.action(internal.migrations.tagAll, {});
  expect(r.tables.projects).toEqual({ seen: 1, patched: 1 });
  expect(r.tables.videos).toEqual({ seen: 1, patched: 1 });
  expect(r.tables.wsDocuments).toEqual({ seen: 1, patched: 1 });
  expect(r.tables.wsEvents).toBeUndefined();
  expect(r.after).toMatchObject({ rows: 3, missing: 0, ok: true });
  const again = await t.action(internal.migrations.tagAll, {});
  expect(Object.values(again.tables).reduce((n: number, x) => n + (x as { patched: number }).patched, 0)).toBe(0);
  const after = await t.run(async (ctx) => ({
    events: await eventsOf(ctx, ids.doc as Id<"wsDocuments">),
    project: await ctx.db.get(ids.p as Id<"projects">),
  }));
  expect(after.events).toEqual(before);                       // byte-for-byte the same audit entries
  expect(await verifyChain(after.events)).toEqual({ ok: true, count: 2 });
  expect(after.project).toMatchObject({ name: "Old", createdAt: 1 }); // nothing else on the row changed
});
