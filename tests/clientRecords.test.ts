// Wrangler Portal, Phase 0.5d step 5 (Oct 28): every client a project or share names has a record, and projects and
// shares link to it by id. What the pages show doesn't change.
import { convexTest } from "convex-test";
import { beforeAll, expect, test } from "vitest";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
const api = anyApi;
const internal = anyApi;
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; process.env.SITE_URL = "https://app.wranglerportal.com"; });

async function setup() {
  const t = convexTest(schema, modules);
  const sub = await t.run(async (ctx) => {
    const u = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston" });
    return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
  });
  return { t, me: t.withIdentity({ subject: sub }) };
}
const get = (t: Awaited<ReturnType<typeof setup>>["t"], id: string) => t.run(async (ctx) => ctx.db.get(id as never)) as Promise<Record<string, unknown> | null>;

test("a project's client gets a record; another project with the same client (any case) links to the same one", async () => {
  const { t, me } = await setup();
  const p1 = await me.mutation(api.library.createProject, { name: "Launch", client: "Harbor Coffee" });
  const p2 = await me.mutation(api.library.createProject, { name: "Holiday", client: "harbor coffee " });
  const a = await get(t, p1), b = await get(t, p2);
  expect(a?.clientId).toBeTruthy();
  expect(b?.clientId).toBe(a?.clientId);
  const c = await get(t, a!.clientId as string);
  expect(c).toMatchObject({ name: "Harbor Coffee", fromProjects: true });
  // The page's "made with New client" list is unchanged: records made from projects aren't in it.
  const o = await me.query(api.library.overview, {});
  expect(o.clients).toEqual([]);
  expect(o.projects.map((p: { client: string }) => p.client).sort()).toEqual(["Harbor Coffee", "harbor coffee"]);
});

test("changing a project's client moves its link; clearing it removes the link", async () => {
  const { t, me } = await setup();
  const p = await me.mutation(api.library.createProject, { name: "Promo", client: "Prairie Fitness" });
  const first = (await get(t, p))!.clientId;
  await me.mutation(api.library.renameProject, { projectId: p, name: "Promo", client: "Prairie Gym" });
  const moved = await get(t, p);
  expect(moved?.clientId).not.toBe(first);
  expect((await get(t, moved!.clientId as string))?.name).toBe("Prairie Gym");
  await me.mutation(api.library.renameProject, { projectId: p, name: "Promo", client: "" });
  expect((await get(t, p))?.clientId).toBeUndefined();
});

test("a client share links to the client's record", async () => {
  const { t, me } = await setup();
  await me.mutation(api.library.createProject, { name: "Launch", client: "Harbor Coffee" });
  const s = await me.mutation(api.shares.create, { target: { kind: "client", client: "Harbor Coffee" }, access: "view", who: "link", allVersions: true, downloads: false, emailNewVersions: false });
  const shareId = (s as { shareId?: string; _id?: string }).shareId ?? (s as { _id?: string })._id;
  const row = await t.run(async (ctx) => (await ctx.db.query("shares").collect())[0]);
  void shareId;
  const proj = await t.run(async (ctx) => (await ctx.db.query("projects").collect())[0]);
  expect(row.clientId).toBe(proj.clientId);
});

test("New client still refuses a client that's on a project, and takes over a record left from a removed one", async () => {
  const { t, me } = await setup();
  const p = await me.mutation(api.library.createProject, { name: "Launch", client: "Harbor Coffee" });
  await expect(me.mutation(api.library.createClient, { name: "Harbor Coffee" })).rejects.toThrow(/already a client/);
  await me.mutation(api.library.deleteProject, { projectId: p });
  await me.mutation(api.library.createClient, { name: "Harbor Coffee" });
  const rows = await t.run(async (ctx) => ctx.db.query("clients").collect());
  expect(rows.map((r) => [r.name, !!r.fromProjects])).toEqual([["Harbor Coffee", false]]);
  expect((await me.query(api.library.overview, {})).clients).toEqual(["Harbor Coffee"]);
});

test("linkClients links projects and shares made before step 5; running it again changes nothing", async () => {
  const { t } = await setup();
  await t.run(async (ctx) => {
    const owner = (await ctx.db.query("users").first())!._id;
    const p = await ctx.db.insert("projects", { name: "Old", client: "Floor Trader", createdAt: 0 });
    await ctx.db.insert("projects", { name: "Older", client: "floor trader", createdAt: 0 });
    await ctx.db.insert("projects", { name: "No client", createdAt: 0 });
    await ctx.db.insert("shares", { token: "tok", kind: "client", client: "Floor Trader", access: "view", who: "link", allVersions: true, downloads: false, emailNewVersions: false, createdAt: 0, createdBy: owner });
    void p;
  });
  const r = await t.action(internal.migrations.linkClients, {});
  expect(r.projects).toEqual({ seen: 3, linked: 2 });
  expect(r.shares).toEqual({ seen: 1, linked: 1 });
  expect(r.after).toMatchObject({ clients: 1, linked: 3, unlinked: 0, mismatched: 0, ok: true });
  const again = await t.action(internal.migrations.linkClients, {});
  expect([again.projects.linked, again.shares.linked]).toEqual([0, 0]);
});

test("two businesses with the same client name get separate records", async () => {
  const { t, me } = await setup();
  const ids = await t.run(async (ctx) => {
    const b = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const boss = await ctx.db.insert("users", { email: "boss@otherfilms.example", name: "Boss" });
    await ctx.db.insert("memberships", { businessId: b, email: "boss@otherfilms.example", userId: boss, role: "owner", createdAt: 1 });
    return { sub: `${boss}|${await ctx.db.insert("authSessions", { userId: boss, expirationTime: Date.now() + 3_600_000 })}` };
  });
  const boss = t.withIdentity({ subject: ids.sub });
  const pa = await me.mutation(api.library.createProject, { name: "A", client: "Harbor Coffee" });
  const pb = await boss.mutation(api.library.createProject, { name: "B", client: "Harbor Coffee" });
  const a = await get(t, pa), b = await get(t, pb);
  expect(a?.clientId).toBeTruthy(); expect(b?.clientId).toBeTruthy();
  expect(a?.clientId).not.toBe(b?.clientId);
  expect((await get(t, b!.clientId as string))?.businessId).toBe(b?.businessId);
});
