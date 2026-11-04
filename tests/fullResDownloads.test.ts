// D152 (Heston, Nov 4): "clients should be able to download the full res from the review site". Download gives the
// render itself (file versions, unchanged) or, for a converted version, the original as uploaded (Bunny keeps it:
// "Keep original files" on), never the 1080p copy. Who may download doesn't change.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
const STREAM = "vz-3ba0610b-f90.b-cdn.net";

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.BUNNY_STILLS_CDN = "wrangler-review-stills.b-cdn.net";
  delete process.env.BUNNY_STREAM_CDN;
});
beforeEach(() => { delete process.env.BUNNY_STREAM_TOKEN_KEY; vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 })); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.BUNNY_STREAM_TOKEN_KEY; });

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    await ctx.db.insert("memberships", { businessId: a, email: "heston@wranglerproductions.com", userId: owner, role: "owner", createdAt: 0 });
    const b = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const boss = await ctx.db.insert("users", { email: "boss@otherfilms.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: b, email: "boss@otherfilms.example", userId: boss, role: "owner", createdAt: 1 });
    const now = Date.now();
    const project = await ctx.db.insert("projects", { businessId: a, name: "Launch", createdAt: now } as never);
    const video = await ctx.db.insert("videos", { businessId: a, projectId: project, title: "4MLC_26", createdAt: now, updatedAt: now } as never);
    // v1: converted (a ProRes master uploaded in the browser): Bunny made 360p and 1080p copies and kept the original.
    const v1 = await ctx.db.insert("versions", { businessId: a, videoId: video, number: 1, status: "ready", bunnyGuid: "guid-1", fileName: "4MLC_26_v1.mov", fileSize: 21_000_000_000, startTimecode: "01:00:00:00", createdAt: now, frameCount: 100, mp4Heights: [360, 1080] } as never);
    // v2: a preset render from the drop folder: it plays (and downloads) as rendered.
    const v2 = await ctx.db.insert("versions", { businessId: a, videoId: video, number: 2, status: "ready", bunnyGuid: "", source: "file", storagePath: "review/x/abc/4MLC_26_v2.mp4", fileUrl: "https://wrangler-review-stills.b-cdn.net/review/x/abc/4MLC_26_v2.mp4", fileName: "4MLC_26_v2.mp4", fileSize: 3_200_000_000, startTimecode: "01:00:00:00", createdAt: now + 1, frameCount: 100 } as never);
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    return { video, v1, v2, heston: await sess(owner), boss: await sess(boss) };
  });
  const me = t.withIdentity({ subject: ids.heston });
  const boss = t.withIdentity({ subject: ids.boss });
  const share = async (downloads: boolean) => (await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.video }, access: "comment", who: "link", allVersions: true, downloads, emailNewVersions: false })).token;
  return { t, ids, me, boss, share };
}
const guest = (token: string) => ({ token, guestKey: "gk-pat", guestName: "Pat" });

test("D152.1 a converted version downloads its original as uploaded (not the 1080p copy); a preset render downloads itself", async () => {
  const w = await setup();
  const token = await w.share(true);
  const vid = (await w.t.query(api.library.video, { videoId: w.ids.video, share: guest(token) }))!;
  const v1 = vid.versions.find((v) => v.number === 1)!;
  const v2 = vid.versions.find((v) => v.number === 2)!;
  expect(v1.download).toEqual({ url: `https://${STREAM}/guid-1/original`, ext: "mov", bytes: 21_000_000_000 });
  expect(v1.download!.url).not.toContain("1080p");
  expect(v2.download).toEqual({ url: "https://wrangler-review-stills.b-cdn.net/review/x/abc/4MLC_26_v2.mp4", ext: "mp4", bytes: 3_200_000_000 });
  // The share page's list and "Download all" use the same files, named as uploaded.
  const open = await w.t.query(api.shares.open, { token });
  expect(JSON.stringify(open)).toContain(`https://${STREAM}/guid-1/original`);
  expect(JSON.stringify(open)).toContain("4MLC_26_v1.mov");
  expect(JSON.stringify(open)).not.toContain("play_1080p.mp4\",\"name");
});

test("D152.2 the original's link is signed like the rest of the video's folder once the zone has a key", async () => {
  const w = await setup();
  process.env.BUNNY_STREAM_TOKEN_KEY = "test-key";
  const token = await w.share(true);
  const v1 = (await w.t.query(api.library.video, { videoId: w.ids.video, share: guest(token) }))!.versions.find((v) => v.number === 1)!;
  expect(v1.download!.url).toMatch(new RegExp(`^https://${STREAM}/bcdn_token=[^/]+/guid-1/original$|^https://${STREAM}/guid-1/original\\?token=`));
});

test("D152.3 downloads off: no file link at all (video page and share page); the owner always gets it", async () => {
  const w = await setup();
  const token = await w.share(false);
  const vid = (await w.t.query(api.library.video, { videoId: w.ids.video, share: guest(token) }))!;
  expect(vid.downloads).toBe(false);
  expect(vid.versions.every((v) => v.download === null)).toBe(true);
  expect(JSON.stringify(await w.t.query(api.shares.open, { token }))).not.toContain("/original");
  const mine = (await w.me.query(api.library.video, { videoId: w.ids.video }))!;
  expect(mine.versions.find((v) => v.number === 1)!.download!.url).toBe(`https://${STREAM}/guid-1/original`);
});

test("D152.4 an off or expired share, or another business's owner, gets no file", async () => {
  const w = await setup();
  const token = await w.share(true);
  const shareRow = await w.t.run(async (ctx) => (await ctx.db.query("shares").collect()).find((s) => s.token === token)!);
  await w.me.mutation(api.shares.setOff, { shareId: shareRow._id, off: true });
  expect(await w.t.query(api.library.video, { videoId: w.ids.video, share: guest(token) }).catch(() => null)).toBeNull();
  expect(JSON.stringify(await w.t.query(api.shares.open, { token }))).not.toContain("/original");
  const t2 = await w.share(true);
  await w.t.run(async (ctx) => { const s = (await ctx.db.query("shares").collect()).find((x) => x.token === t2)!; await ctx.db.patch(s._id, { expiresAt: Date.now() - 1 }); });
  expect(await w.t.query(api.library.video, { videoId: w.ids.video, share: guest(t2) }).catch(() => null)).toBeNull();
  expect(JSON.stringify(await w.t.query(api.shares.open, { token: t2 }))).not.toContain("/original");
  expect(await w.boss.query(api.library.video, { videoId: w.ids.video }).catch(() => null)).toBeNull();
});

test("D152.5 a final file that's a converted version downloads its original, named with its own extension", async () => {
  const w = await setup();
  const r = await w.t.query(internal.projects.versionFileUrl, { versionId: w.ids.v1, until: Date.now() + 3_600_000 });
  expect(r).toEqual({ file: `https://${STREAM}/guid-1/original`, name: "4MLC_26_v1.mov" });
  const r2 = await w.t.query(internal.projects.versionFileUrl, { versionId: w.ids.v2, until: Date.now() + 3_600_000 });
  expect(r2).toEqual({ file: "https://wrangler-review-stills.b-cdn.net/review/x/abc/4MLC_26_v2.mp4", name: "4MLC_26_v2.mp4" });
});
