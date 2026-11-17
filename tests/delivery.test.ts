// 5n Delivery (Nov 17).
//   T-DL.1 one delivery per project; files only from the project's own Dropbox folder or cuts; the client sees only what's
//          published; Publish starts the term (Settings) and can tell the client; arrange and shoot tags
//   T-DL.2 the term: reminders 30 and 7 days before, once each; it ends (the client sees nothing; nothing is deleted);
//          renewal answer recorded; the owner marks it renewed
//   T-DL.3 a client's share link: only what was shared, off any time; another client or business gets nothing
import { describe, expect, test } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";

const api = anyApi;
type W = Awaited<ReturnType<typeof world>>;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const plus = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

async function setup() {
  const w = await world();
  await w.t.run(async (ctx) => {
    await ctx.db.patch(w.p, { dropboxFolder: "/Projects/26127 Launch" });
    const owner = (await ctx.db.query("users").first())!._id;
    const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: owner });
    await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: "maya@harbor.example", addedAt: 0 });
  });
  const deliveryId = await w.heston.mutation(api.delivery.ensure, { projectId: w.p });
  const g = await w.heston.query(api.delivery.get, { projectId: w.p });
  return { w, deliveryId, videos: g.delivery.items[0]._id as Id<"deliveryItems"> };
}
const inbox = (w: W) => w.t.run((ctx) => ctx.db.query("inboxItems").collect());

describe("delivery", () => {
  test("T-DL.1 files, publish, what the client sees", async () => {
    const { w, deliveryId, videos } = await setup();
    expect(await w.heston.mutation(api.delivery.ensure, { projectId: w.p })).toBe(deliveryId); // one per project
    await expect(w.heston.mutation(api.delivery.addFiles, { itemId: videos, files: [{ kind: "dropbox", path: "/Other client/secret.mp4", name: "secret.mp4" }] })).rejects.toThrow(/this project's Dropbox folder/);
    await expect(w.heston.mutation(api.delivery.addFiles, { itemId: videos, files: [{ kind: "dropbox", path: "/projects/26127 launch/still.jpg", name: "still.jpg" }] })).rejects.toThrow(/isn't a video/);
    await w.heston.mutation(api.delivery.addFiles, { itemId: videos, files: [{ kind: "dropbox", path: "/Projects/26127 Launch/Hero.mp4", name: "Hero.mp4", size: 900 }, { kind: "dropbox", path: "/Projects/26127 Launch/Teaser.mp4", name: "Teaser.mp4" }] });
    const album = await w.heston.mutation(api.delivery.addAlbum, { deliveryId, title: "Day 1 stills" });
    await w.heston.mutation(api.delivery.addFiles, { itemId: album, files: [{ kind: "dropbox", path: "/projects/26127 launch/a.jpg", name: "a.jpg" }, { kind: "dropbox", path: "/projects/26127 launch/b.jpg", name: "b.jpg" }] });
    // A draft: the client sees nothing.
    expect(await w.maya.query(api.delivery.forClient, {})).toEqual([]);
    // Publish, telling the client: the term starts (2 years by default).
    const r = await w.heston.mutation(api.delivery.publish, { deliveryId, tell: true });
    expect(r).toMatchObject({ told: 1, fresh: 4 });
    expect((await inbox(w)).filter((i) => i.email === "maya@harbor.example").map((i) => i.title)).toEqual(["Your files are ready in Delivery"]);
    const mine = await w.maya.query(api.delivery.forClient, {});
    expect(mine[0].keptUntil).toBe(`${Number(today().slice(0, 4)) + 2}${today().slice(4)}`.replace("-02-29", "-02-28"));
    expect(mine[0].items.map((i: { title: string; assets: unknown[] }) => [i.title, i.assets.length])).toEqual([["Video", 2], ["Day 1 stills", 2]]);
    // Changes wait for Publish changes; the client still sees the published ones only.
    const g = await w.heston.query(api.delivery.get, { projectId: w.p });
    const teaser = g.delivery.items[0].assets[1]._id;
    await w.heston.mutation(api.delivery.editAsset, { assetId: teaser, before: g.delivery.items[0].assets[0]._id });
    await w.heston.mutation(api.delivery.addFiles, { itemId: album, files: [{ kind: "dropbox", path: "/projects/26127 launch/c.jpg", name: "c.jpg" }] });
    const g2 = await w.heston.query(api.delivery.get, { projectId: w.p });
    expect(g2.delivery.changed).toBe(true);
    expect(g2.delivery.items[0].assets.map((x: { name: string }) => x.name)).toEqual(["Teaser.mp4", "Hero.mp4"]);
    expect((await w.maya.query(api.delivery.forClient, {}))[0].items[1].assets).toHaveLength(2);
    // Someone who can't open the project sees nothing; another business's owner gets nothing.
    expect(await w.sam.query(api.delivery.forClient, {})).toEqual([]);
    expect((await w.boss.query(api.delivery.list, {})).deliveries).toEqual([]);
    await expect(w.boss.mutation(api.delivery.publish, { deliveryId, tell: false })).rejects.toThrow();
    // A file's link: the client can't reach an unpublished one.
    const unpublished = g2.delivery.items[1].assets.find((x: { name: string }) => x.name === "c.jpg")._id;
    await expect(w.maya.action(api.delivery.assetUrl, { assetId: unpublished })).rejects.toThrow(/isn't available/);
  });

  test("T-DL.2 the term, reminders, the end, renewal", async () => {
    const { w, deliveryId, videos } = await setup();
    await w.heston.mutation(api.delivery.addFiles, { itemId: videos, files: [{ kind: "dropbox", path: "/projects/26127 launch/hero.mp4", name: "Hero.mp4" }] });
    await w.heston.mutation(api.delivery.publish, { deliveryId, tell: false });
    await w.heston.mutation(api.delivery.setTerm, { deliveryId, keptUntil: plus(today(), 20) });
    await w.t.mutation(anyApi.delivery.runDue, {});
    await w.t.mutation(anyApi.delivery.runDue, {});
    expect((await inbox(w)).filter((i) => i.email === "maya@harbor.example").map((i) => i.title)).toEqual(["Your Delivery files: 30 days left"]); // once
    // 30 days left: the client is offered a renewal (on in Settings by default) and answers.
    const offer = (await w.maya.query(api.delivery.forClient, {}))[0].offer;
    expect(offer).toMatchObject({ priceCents: 15000 });
    await w.maya.mutation(api.delivery.clientAnswer, { deliveryId, keep: true });
    expect((await w.heston.query(api.delivery.get, { projectId: w.p })).delivery.renewal).toMatchObject({ status: "kept", by: "Maya Brooks" });
    // Nothing was charged; the owner marks it renewed once the invoice is sent.
    expect(await w.t.run((ctx) => ctx.db.query("invoices").collect())).toEqual([]);
    await w.heston.mutation(api.delivery.renewed, { deliveryId });
    expect((await w.heston.query(api.delivery.get, { projectId: w.p })).delivery.keptUntil).toBe(plus(today(), 20).replace(/^(\d{4})/, (y) => String(Number(y) + 1)));
    // Past the date: it ends; the client sees nothing; the files are still listed for the owner.
    await w.heston.mutation(api.delivery.setTerm, { deliveryId, keptUntil: plus(today(), -1) });
    await w.t.mutation(anyApi.delivery.runDue, {});
    expect(await w.maya.query(api.delivery.forClient, {})).toEqual([]);
    const ended = await w.heston.query(api.delivery.get, { projectId: w.p });
    expect(ended.delivery.state).toBe("ended");
    expect(ended.delivery.items[0].assets).toHaveLength(1);
    // Review M1: 5 days left gets the 7-day note, not the 30-day one; Review M3: no answer outside the question.
    await w.heston.mutation(api.delivery.setTerm, { deliveryId, keptUntil: plus(today(), 5) });
    await w.t.run(async (ctx) => { for (const i of await ctx.db.query("inboxItems").collect()) await ctx.db.delete(i._id); });
    await w.t.mutation(anyApi.delivery.runDue, {});
    expect((await inbox(w)).filter((i) => i.email === "maya@harbor.example").map((i) => i.title)).toEqual(["Your Delivery files leave in 7 days"]);
    await w.heston.mutation(api.delivery.setTerm, { deliveryId, keptUntil: plus(today(), 300) });
    await expect(w.maya.mutation(api.delivery.clientAnswer, { deliveryId, keep: false })).rejects.toThrow(/nothing to answer/);
    // A later date brings it back.
    await w.heston.mutation(api.delivery.setTerm, { deliveryId, keptUntil: plus(today(), 200) });
    expect((await w.maya.query(api.delivery.forClient, {}))).toHaveLength(1);
  });

  test("T-DL.3 a client's share link", async () => {
    const { w, deliveryId, videos } = await setup();
    await w.heston.mutation(api.delivery.addFiles, { itemId: videos, files: [{ kind: "dropbox", path: "/projects/26127 launch/hero.mp4", name: "Hero.mp4" }] });
    const album = await w.heston.mutation(api.delivery.addAlbum, { deliveryId, title: "Stills" });
    await w.heston.mutation(api.delivery.addFiles, { itemId: album, files: [{ kind: "dropbox", path: "/projects/26127 launch/a.jpg", name: "a.jpg" }] });
    await expect(w.maya.mutation(api.delivery.makeLink, { deliveryId, downloads: true })).rejects.toThrow(/isn't available/); // not published yet
    await w.heston.mutation(api.delivery.publish, { deliveryId, tell: false });
    const one = await w.maya.mutation(api.delivery.makeLink, { deliveryId, itemId: album, downloads: false });
    const s = await w.t.query(api.delivery.shared, { token: one.token });
    expect(s).toMatchObject({ by: "Harbor Coffee", business: "Wrangler Productions", downloads: false });
    expect(s.items.map((i: { title: string }) => i.title)).toEqual(["Stills"]);
    // The link can't reach a file outside what was shared.
    const hero = (await w.heston.query(api.delivery.get, { projectId: w.p })).delivery.items[0].assets[0]._id;
    await expect(w.t.action(api.delivery.assetUrl, { assetId: hero, token: one.token })).rejects.toThrow(/isn't available/);
    // Review H1: a link stops when its maker loses the project (their share ends).
    const three = await w.maya.mutation(api.delivery.makeLink, { deliveryId, downloads: true });
    expect(await w.t.query(api.delivery.shared, { token: three.token })).not.toBeNull();
    const sm = await w.t.run((ctx) => ctx.db.query("shareMembers").collect());
    await w.t.run((ctx) => ctx.db.delete(sm[0]._id));
    expect(await w.t.query(api.delivery.shared, { token: three.token })).toBeNull();
    await w.t.run((ctx) => ctx.db.insert("shareMembers", { businessId: w.A, shareId: sm[0].shareId, email: "maya@harbor.example", addedAt: 0 }));
    // Someone else can't turn it off; Maya can.
    const linkId = (await w.maya.query(api.delivery.forClient, {}))[0].links[0]._id;
    await expect(w.sam.mutation(api.delivery.setLink, { linkId, on: false })).rejects.toThrow(/isn't yours/);
    await w.maya.mutation(api.delivery.setLink, { linkId, on: false });
    expect(await w.t.query(api.delivery.shared, { token: one.token })).toBeNull();
    // Moving the project to another client turns the old client's links off.
    const two = await w.maya.mutation(api.delivery.makeLink, { deliveryId, downloads: true });
    const northline = await w.t.run((ctx) => ctx.db.insert("clients", { businessId: w.A, name: "Northline", createdAt: 0 }));
    await w.heston.mutation(api.homes.moveProject, { projectId: w.p, clientId: northline });
    expect(await w.t.query(api.delivery.shared, { token: two.token })).toBeNull();
    // Review H1: Maya can't turn it back on now the project is Northline's.
    const twoId = (await w.t.run((ctx) => ctx.db.query("deliveryLinks").withIndex("by_token", (q) => q.eq("token", two.token)).first()))!._id;
    await expect(w.maya.mutation(api.delivery.setLink, { linkId: twoId, on: true })).rejects.toThrow(/isn't available/);
    expect(await w.t.query(api.delivery.shared, { token: two.token })).toBeNull();
  });
});
