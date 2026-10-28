// Wrangler Portal, Phase 0.5d step 4 (Oct 28): settings and background work per business — Claude's connector keys,
// the register's numbers, Dropbox, and who a business's documents and emails come from.
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { businessContact } from "../convex/lib/business";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });

const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", legalName: "Wrangler Productions, a DBA of Hill Creative LLC", createdAt: 0 });
    const b = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", legalName: "Other Films LLC", createdAt: 1 });
    const heston = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston" });
    const boss = await ctx.db.insert("users", { email: "boss@otherfilms.example", name: "Boss" });
    await ctx.db.insert("memberships", { businessId: a, email: "heston@wranglerproductions.com", userId: heston, role: "owner", createdAt: 0 });
    await ctx.db.insert("memberships", { businessId: b, email: "boss@otherfilms.example", userId: boss, role: "owner", createdAt: 1 });
    const sess = async (u: Id<"users">) => `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
    return { a, b, hestonSub: await sess(heston), bossSub: await sess(boss) };
  });
  return { t, ...ids, heston: t.withIdentity({ subject: ids.hestonSub }), boss: t.withIdentity({ subject: ids.bossSub }) };
}

const findVideos = async (t: ReturnType<typeof convexTest>, key: string) => {
  const res = await t.fetch("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "find_videos" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "find_videos", arguments: {}, _meta: META } }),
  });
  return JSON.stringify(await res.json());
};

describe("per business", () => {
  test("each business's Claude connector key sees only that business's videos", async () => {
    const { t, heston, boss } = await setup();
    const pa = await heston.mutation(api.library.createProject, { name: "Spirit Airlines" });
    await heston.mutation(api.library.createVideo, { projectId: pa, title: "Spirit Intro" });
    const pb = await boss.mutation(api.library.createProject, { name: "Other Project" });
    await boss.mutation(api.library.createVideo, { projectId: pb, title: "Other Cut" });
    const { key: ka } = await heston.action(api.connector.createKey, {});
    const { key: kb } = await boss.action(api.connector.createKey, {});
    const seenA = await findVideos(t, ka), seenB = await findVideos(t, kb);
    expect(seenA).toContain("Spirit Intro"); expect(seenA).not.toContain("Other Cut");
    expect(seenB).toContain("Other Cut"); expect(seenB).not.toContain("Spirit Intro");
    // Each owner lists only their own keys.
    expect(await heston.query(api.connector.listKeys, {})).toHaveLength(1);
    expect(await boss.query(api.connector.listKeys, {})).toHaveLength(1);
  });

  test("Wrangler Sign's connector key lists only that business's documents", async () => {
    const { t, a, b, heston, boss } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("wsDocuments", { businessId: a, number: 1, title: "Wrangler Contract", status: "draft", currentVersion: 1, createdAt: 0, updatedAt: 0 });
      await ctx.db.insert("wsDocuments", { businessId: b, number: 1, title: "Other Contract", status: "draft", currentVersion: 1, createdAt: 0, updatedAt: 0 });
    });
    const { key: ka } = await heston.action(api.wsConnector.createKey, {});
    const { key: kb } = await boss.action(api.wsConnector.createKey, {});
    const list = async (key: string) => JSON.stringify(await (await t.fetch("/ws-mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "list_documents" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_documents", arguments: {}, _meta: META } }),
    })).json());
    const la = await list(ka), lb = await list(kb);
    expect(la).toContain("Wrangler Contract"); expect(la).not.toContain("Other Contract");
    expect(lb).toContain("Other Contract"); expect(lb).not.toContain("Wrangler Contract");
  });

  test("the video register numbers each business from 00001", async () => {
    const { heston, boss } = await setup();
    const a1 = await heston.mutation(api.register.newVideo, { title: "One", shortTitle: "One", projectName: "P" });
    const a2 = await heston.mutation(api.register.newVideo, { title: "Two", shortTitle: "Two", projectName: "P" });
    const b1 = await boss.mutation(api.register.newVideo, { title: "First", shortTitle: "First", projectName: "Q" });
    const num = (r: unknown) => JSON.stringify(r).match(/"number":(\d+)/)?.[1];
    expect([num(a1), num(a2), num(b1)]).toEqual(["1", "2", "1"]);
  });

  test("a business's documents and emails come from its own name and owner", async () => {
    const { t, a, b } = await setup();
    const got = await t.run(async (ctx) => ({ a: await businessContact(ctx, a), b: await businessContact(ctx, b) }));
    expect(got.a).toMatchObject({ isDefault: true, legalName: "Wrangler Productions, a DBA of Hill Creative LLC", ownerEmail: "heston@wranglerproductions.com" });
    expect(got.b).toMatchObject({ isDefault: false, legalName: "Other Films LLC", ownerEmail: "boss@otherfilms.example" });
    // From an action acting for a business.
    expect(await t.query(internal.business.contact, { asBusiness: b })).toMatchObject({ legalName: "Other Films LLC" });
  });

  test("Dropbox: the minute job finds every connected business; each sees only its own connection", async () => {
    const { t, a, b } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("dropbox", { businessId: a, accountId: "acct-a", refreshToken: "ra", connectedAt: 0 } as never);
      await ctx.db.insert("dropbox", { businessId: b, accountId: "acct-b", refreshToken: "rb", connectedAt: 0 } as never);
    });
    const bizs = await t.query(internal.dropbox.connectedBusinesses, {});
    expect([...bizs].sort()).toEqual([a, b].sort());
    expect((await t.query(internal.dropbox.getConnection, { asBusiness: b }))?.accountId).toBe("acct-b");
    expect((await t.query(internal.dropbox.getConnection, { asBusiness: a }))?.accountId).toBe("acct-a");
  });
});
