// Phase 2 Part A (Oct 29): the project hub, revision rounds (each version is a round, 2 by default), the watermark
// switch and the final files. Two businesses: A (Wrangler, the default) and B.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const api = anyApi;
const modules = import.meta.glob("../convex/**/*.ts");

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://x.convex.site";
});
afterEach(() => vi.unstubAllGlobals());

async function world() {
  const t = convexTest(schema, modules);
  const w = await t.run(async (ctx) => {
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const A = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    const B = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const heston = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    await ctx.db.insert("memberships", { businessId: A, email: "heston@wranglerproductions.com", userId: heston, role: "owner", createdAt: 0 });
    const boss = await ctx.db.insert("users", { email: "boss@other.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: B, email: "boss@other.example", userId: boss, role: "owner", createdAt: 1 });
    const harbor = await ctx.db.insert("clients", { businessId: A, name: "Harbor Coffee", createdAt: 0 });
    const maya = await ctx.db.insert("users", { email: "maya@harbor.example", name: "Maya Brooks", role: "client" });
    await ctx.db.insert("memberships", { businessId: A, email: "maya@harbor.example", userId: maya, role: "client", createdAt: 0 });
    await ctx.db.insert("invites", { businessId: A, email: "maya@harbor.example", createdAt: 0, acceptedAt: 1, userId: maya });
    const dan = await ctx.db.insert("users", { email: "dan@harbor.example", name: "Dan", role: "client" });
    await ctx.db.insert("memberships", { businessId: A, email: "dan@harbor.example", userId: dan, role: "client", createdAt: 0 });
    await ctx.db.insert("invites", { businessId: A, email: "dan@harbor.example", createdAt: 0, acceptedAt: 1, userId: dan });
    await ctx.db.insert("clientPeople", { businessId: A, clientId: harbor, email: "maya@harbor.example", role: "signer", createdAt: 0 });
    await ctx.db.insert("clientPeople", { businessId: A, clientId: harbor, email: "sam@harbor.example", role: "contact", createdAt: 0 });
    const p = await ctx.db.insert("projects", { businessId: A, name: "Launch", jobNumber: "26127", client: "Harbor Coffee", clientId: harbor, createdAt: 0 });
    const other = await ctx.db.insert("projects", { businessId: A, name: "Other job", client: "Harbor Coffee", clientId: harbor, createdAt: 0 });
    const vid = await ctx.db.insert("videos", { businessId: A, projectId: p, title: "Harbor 30s", createdAt: 0, updatedAt: 0 });
    const ver = await ctx.db.insert("versions", { businessId: A, videoId: vid, number: 2, status: "ready", bunnyGuid: "g", fileName: "x.mp4", startTimecode: "01:00:00:00", createdAt: 0, mp4Heights: [720] } as never);
    // Maya is on an invited share of the project; Dan isn't on any.
    const share = await ctx.db.insert("shares", { businessId: A, token: "tok-proj-00000000001", kind: "project", projectId: p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: false, createdAt: 0, createdBy: heston } as never);
    await ctx.db.insert("shareMembers", { businessId: A, shareId: share, email: "maya@harbor.example", addedAt: 0 });
    return { A, B, harbor, p, other, vid, ver, hestonSub: await sess(heston), bossSub: await sess(boss), mayaSub: await sess(maya), danSub: await sess(dan) };
  });
  return { t, ...w, heston: t.withIdentity({ subject: w.hestonSub }), boss: t.withIdentity({ subject: w.bossSub }), mayaC: t.withIdentity({ subject: w.mayaSub }), danC: t.withIdentity({ subject: w.danSub }) };
}

describe("project page and stage", () => {
  test("the page shows stage, rounds and cuts; moving the stage posts to people with portal access only", async () => {
    const w = await world();
    const pg = await w.heston.query(api.projects.page, { projectId: w.p });
    expect(pg).toMatchObject({ label: "26127 Launch", stage: "discovery", rounds: { included: 2, from: "business" } });
    expect(pg.videos[0].round).toMatchObject({ round: 2, included: 2, state: "last", label: "Round 2 of 2" });
    expect(await w.boss.query(api.projects.page, { projectId: w.p })).toBeNull();
    expect(await w.heston.query(api.projects.page, { projectId: "nonsense" })).toBeNull();

    expect(await w.heston.mutation(api.projects.setStage, { projectId: w.p, stage: "polish", post: true, note: "Notes by Friday" })).toEqual({ posted: 1 });
    const items = await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).map((i) => [i.email, i.kind, i.title, i.text]));
    expect(items).toEqual([["maya@harbor.example", "stage", "Stage moved to Polish", "Notes by Friday"]]);
    expect(await w.heston.mutation(api.projects.setStage, { projectId: w.p, stage: "delivery", post: false })).toEqual({ posted: 0 });
    expect((await w.heston.query(api.projects.page, { projectId: w.p })).stage).toBe("delivery");
    await expect(w.boss.mutation(api.projects.setStage, { projectId: w.p, stage: "strategy", post: false })).rejects.toThrow();
  });

  test("next step and key dates are checked and sorted", async () => {
    const w = await world();
    await w.heston.mutation(api.projects.setNextStep, { projectId: w.p, text: "  Notes on   v2 by Nov 4 " });
    await w.heston.mutation(api.projects.setKeyDates, { projectId: w.p, dates: [{ label: "Final due", date: "2026-11-07" }, { label: "Shoot", date: "2026-10-14" }, { label: "", date: "" }] });
    const pg = await w.heston.query(api.projects.page, { projectId: w.p });
    expect(pg.nextStep).toBe("Notes on v2 by Nov 4");
    expect(pg.keyDates).toEqual([{ label: "Shoot", date: "2026-10-14" }, { label: "Final due", date: "2026-11-07" }]);
    await expect(w.heston.mutation(api.projects.setKeyDates, { projectId: w.p, dates: [{ label: "Shoot", date: "soon" }] })).rejects.toThrow(/Pick a date/);
  });
});

describe("revision rounds", () => {
  test("business default 2, then the client's, then the project's; a version past them needs a change order", async () => {
    const w = await world();
    let nr = await w.heston.query(api.projects.nextRound, { videoId: w.vid });
    expect(nr).toMatchObject({ next: 3, included: 2, over: true });
    await w.heston.mutation(api.clients.setSettings, { clientId: w.harbor, rounds: 3 });
    nr = await w.heston.query(api.projects.nextRound, { videoId: w.vid });
    expect(nr).toMatchObject({ next: 3, included: 3, over: false });
    expect((await w.heston.query(api.projects.page, { projectId: w.p })).rounds).toMatchObject({ included: 3, from: "client" });
    await w.heston.mutation(api.projects.setRounds, { projectId: w.p, rounds: 1 });
    const pg = await w.heston.query(api.projects.page, { projectId: w.p });
    expect(pg.rounds).toMatchObject({ included: 1, from: "project" });
    expect(pg.videos[0].round).toMatchObject({ state: "over", label: "Round 2 · change order" });
    await w.heston.mutation(api.projects.setRounds, { projectId: w.p, rounds: null });
    expect((await w.heston.query(api.projects.page, { projectId: w.p })).rounds.from).toBe("client");
    await w.heston.mutation(api.business.updateSettings, { roundsDefault: 4 });
    await w.heston.mutation(api.clients.setSettings, { clientId: w.harbor, rounds: null });
    expect((await w.heston.query(api.projects.page, { projectId: w.p })).rounds).toMatchObject({ included: 4, from: "business" });
    // The video page knows the rounds too.
    expect((await w.heston.query(api.library.video, { videoId: w.vid })).roundsIncluded).toBe(4);
  });
});

describe("watermark", () => {
  test("clients see the watermark unless it's off for their client; the owner never does", async () => {
    const w = await world();
    const share = { token: "tok-proj-00000000001" };
    const asMaya = await w.mayaC.query(api.library.video, { videoId: w.vid, share });
    expect(asMaya.watermark).toMatchObject({ corner: "br", size: "small", opacity: 0.35 });
    expect((await w.heston.query(api.library.video, { videoId: w.vid })).watermark).toBeNull();
    await w.heston.mutation(api.business.updateSettings, { watermark: { corner: "tl", size: "large", opacity: 0.25 } });
    expect((await w.mayaC.query(api.library.video, { videoId: w.vid, share })).watermark).toMatchObject({ corner: "tl", size: "large", opacity: 0.25 });
    await w.heston.mutation(api.clients.setSettings, { clientId: w.harbor, watermarkOff: true });
    expect((await w.mayaC.query(api.library.video, { videoId: w.vid, share })).watermark).toBeNull();
    await expect(w.boss.mutation(api.clients.setSettings, { clientId: w.harbor, watermarkOff: false })).rejects.toThrow();
  });
});

describe("the client's projects and final files", () => {
  test("a client sees only projects their share invites cover; files stay locked until unlocked, then until the links expire", async () => {
    const w = await world();
    const mine = await w.mayaC.query(api.projects.mine, {});
    expect(mine.map((p: { label: string }) => p.label)).toEqual(["26127 Launch"]);
    expect(await w.danC.query(api.projects.mine, {})).toEqual([]);
    expect(await w.danC.query(api.projects.forClient, { projectId: w.p })).toBeNull();
    expect(await w.mayaC.query(api.projects.forClient, { projectId: w.other })).toBeNull();

    // No files yet: unlocking is refused.
    await expect(w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true })).rejects.toThrow(/final files first/);
    await w.heston.mutation(api.projects.addDeliveryFile, { projectId: w.p, file: { kind: "version", versionId: w.ver } });
    await w.heston.mutation(api.projects.addDeliveryFile, { projectId: w.p, file: { kind: "dropbox", path: "/Clients/Harbor/Final/Harbor_30s_FINAL.mov", name: "Harbor_30s_FINAL.mov", size: 4_200_000_000 } });
    await expect(w.heston.mutation(api.projects.addDeliveryFile, { projectId: w.p, file: { kind: "dropbox", path: "relative/path.mov", name: "x" } })).rejects.toThrow(/Dropbox path/);
    let c = await w.mayaC.query(api.projects.forClient, { projectId: w.p });
    expect(c.delivery).toMatchObject({ open: false, files: [], count: 2 });
    const fileId = (await w.heston.query(api.projects.page, { projectId: w.p })).delivery.files[0]._id;
    await expect(w.mayaC.query(anyApi.projects.canDownload, { fileId })).rejects.toThrow();

    expect(await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: true })).toEqual({ posted: 1 });
    c = await w.mayaC.query(api.projects.forClient, { projectId: w.p });
    expect(c.delivery.open).toBe(true);
    expect(c.delivery.files.map((f: { name: string }) => f.name)).toEqual(["Harbor30s_v2.mp4", "Harbor_30s_FINAL.mov"]);
    const inbox = await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).map((i) => [i.email, i.kind, i.title]));
    expect(inbox).toEqual([["maya@harbor.example", "final_files", "Final files ready"]]);

    // The links expire after the set number of days.
    await w.t.run(async (ctx) => { await ctx.db.patch(w.p, { deliveryUnlockedAt: Date.now() - 8 * 86_400_000 }); });
    c = await w.mayaC.query(api.projects.forClient, { projectId: w.p });
    expect(c.delivery).toMatchObject({ open: false, expired: true, files: [] });
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, linkDays: 30 });
    expect((await w.mayaC.query(api.projects.forClient, { projectId: w.p })).delivery.open).toBe(true);
    // Locking again closes them.
    await w.heston.mutation(api.projects.setDelivery, { projectId: w.p, unlocked: false });
    expect((await w.mayaC.query(api.projects.forClient, { projectId: w.p })).delivery.open).toBe(false);
    // Another business can't touch the files.
    await expect(w.boss.mutation(api.projects.removeDeliveryFile, { fileId })).resolves.toBeNull();
    expect((await w.heston.query(api.projects.page, { projectId: w.p })).delivery.files).toHaveLength(2);
    // With project pages switched off (Settings › Business), the client sees none.
    await w.heston.mutation(api.business.updateSettings, { modules: { review: true, docs: true, payments: false, projects: false } });
    expect(await w.mayaC.query(api.projects.mine, {})).toEqual([]);
    expect(await w.mayaC.query(api.projects.forClient, { projectId: w.p })).toBeNull();
  });

  test("a share of one video doesn't open its project; stage news goes only to the people a project share covers", async () => {
    const w = await world();
    // Dan gets a view-only share of the one video: he sees no project page and hears nothing about the project.
    await w.t.run(async (ctx) => {
      const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-video-0000000001", kind: "video", videoId: w.vid, access: "view", who: "invited", allVersions: true, downloads: false, emailNewVersions: false, createdAt: 0, createdBy: (await ctx.db.query("users").first())!._id } as never);
      await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: "dan@harbor.example", addedAt: 0 });
    });
    expect(await w.danC.query(api.projects.mine, {})).toEqual([]);
    expect(await w.danC.query(api.projects.forClient, { projectId: w.p })).toBeNull();
    // Maya's share covers only Launch: moving the other Harbor job posts to nobody.
    expect(await w.heston.mutation(api.projects.setStage, { projectId: w.other, stage: "polish", post: true })).toEqual({ posted: 0 });
    expect(await w.heston.mutation(api.projects.setStage, { projectId: w.p, stage: "polish", post: true })).toEqual({ posted: 1 });
    const to = await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).map((i) => i.email));
    expect(to).toEqual(["maya@harbor.example"]);
  });
});
