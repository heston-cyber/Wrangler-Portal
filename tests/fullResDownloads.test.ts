// D152 (Heston, Nov 4): "clients should be able to download the full res from the review site". Review fix H1 (Nov 4,
// Heston chose "Dropbox originals"): a Stream video's player token covers its whole folder, so the full-resolution file
// never comes from there. Download gives the render itself (preset renders) or the master from Dropbox (converted
// versions the drop folder found), with a link made per click after a check; browser uploads give the MP4 copy.
// No link of any kind is sent with a page; a viewer whose share has downloads off gets nothing.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
const STREAM = "vz-3ba0610b-f90.b-cdn.net";

let dropboxCalls: Array<{ url: string; body: unknown }> = [];
let masterGone = false;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.BUNNY_STILLS_CDN = "wrangler-review-stills.b-cdn.net";
  process.env.DROPBOX_APP_KEY = "test-key";
  process.env.DROPBOX_APP_SECRET = "test-secret";
  delete process.env.BUNNY_STREAM_CDN;
});
beforeEach(() => {
  delete process.env.BUNNY_STREAM_TOKEN_KEY;
  dropboxCalls = []; masterGone = false;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.dropboxapi.com/oauth2/token") return json({ access_token: "at", expires_in: 14400 });
    if (url.endsWith("/files/get_temporary_link")) {
      dropboxCalls.push({ url, body: JSON.parse(String(init?.body)) });
      return masterGone ? json({ error_summary: "path/not_found/" }, 409) : json({ link: "https://dl.dropboxusercontent.com/master.mov" });
    }
    return new Response("{}", { status: 500 });
  });
});
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
    // v1: a ProRes master the drop folder found and Bunny converted (copies 360p, 1080p).
    const v1 = await ctx.db.insert("versions", { businessId: a, videoId: video, number: 1, status: "ready", bunnyGuid: "guid-1", fileName: "4MLC_26_v1.mov", fileSize: 21_000_000_000, dropboxPath: "/apps/wrangler review/launch/4mlc_26_v1.mov", startTimecode: "01:00:00:00", createdAt: now, frameCount: 100, mp4Heights: [360, 1080] } as never);
    // v2: a preset render: it plays (and downloads) as rendered.
    const v2 = await ctx.db.insert("versions", { businessId: a, videoId: video, number: 2, status: "ready", bunnyGuid: "", source: "file", storagePath: "review/x/abc/4MLC_26_v2.mp4", fileUrl: "https://wrangler-review-stills.b-cdn.net/review/x/abc/4MLC_26_v2.mp4", fileName: "4MLC_26_v2.mp4", fileSize: 3_200_000_000, startTimecode: "01:00:00:00", createdAt: now + 1, frameCount: 100 } as never);
    // v3: uploaded in the browser (no Dropbox master): the 1080p copy.
    const v3 = await ctx.db.insert("versions", { businessId: a, videoId: video, number: 3, status: "ready", bunnyGuid: "guid-3", fileName: "upload.mov", fileSize: 9_000_000_000, startTimecode: "01:00:00:00", createdAt: now + 2, frameCount: 100, mp4Heights: [360, 1080] } as never);
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    return { video, v1, v2, v3, heston: await sess(owner), boss: await sess(boss) };
  });
  await t.mutation(internal.dropbox.saveConnection, { accountId: "dbid:x", email: "heston@wranglerproductions.com", refreshToken: "RT", accessToken: "AT", accessExpiresAt: Date.now() + 3_600_000, cursor: "c0" });
  const me = t.withIdentity({ subject: ids.heston });
  const boss = t.withIdentity({ subject: ids.boss });
  const share = async (downloads: boolean, allVersions = true) => (await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.video }, access: "comment", who: "link", allVersions, downloads, emailNewVersions: false })).token;
  return { t, ids, me, boss, share };
}
const guest = (token: string) => ({ token, guestKey: "gk-pat", guestName: "Pat" });

test("D152.1 the page says what Download gives (type, size, a name from the title) and carries no link", async () => {
  const w = await setup();
  const token = await w.share(true);
  const vid = (await w.t.query(api.library.video, { videoId: w.ids.video, share: guest(token) }))!;
  const by = (n: number) => vid.versions.find((v) => v.number === n)!.download;
  expect(by(1)).toEqual({ ext: "mov", bytes: 21_000_000_000, name: "4MLC_26_v1.mov" });
  expect(by(2)).toEqual({ ext: "mp4", bytes: 3_200_000_000, name: "4MLC_26_v2.mp4" });
  expect(by(3)).toEqual({ ext: "mp4", bytes: null, name: "4MLC_26_v3.mp4" }); // the upload's own name is never shown (L2)
  const open = JSON.stringify(await w.t.query(api.shares.open, { token }));
  expect(open).not.toContain("/original");
  expect(open).not.toContain("upload.mov");
  expect(open).not.toContain("dropbox");
});

test("D152.2 Download: the master from Dropbox (4-hour link, made per click), the render itself, or the copy", async () => {
  const w = await setup();
  const share = guest(await w.share(true));
  expect(await w.t.action(api.library.downloadLink, { versionId: w.ids.v1, share })).toEqual({ url: "https://dl.dropboxusercontent.com/master.mov", name: "4MLC_26_v1.mov", fallback: false });
  expect(dropboxCalls[0].body).toEqual({ path: "/apps/wrangler review/launch/4mlc_26_v1.mov" });
  expect(await w.t.action(api.library.downloadLink, { versionId: w.ids.v2, share })).toMatchObject({ url: "https://wrangler-review-stills.b-cdn.net/review/x/abc/4MLC_26_v2.mp4", fallback: false });
  expect(await w.t.action(api.library.downloadLink, { versionId: w.ids.v3, share })).toMatchObject({ url: `https://${STREAM}/guid-3/play_1080p.mp4`, name: "4MLC_26_v3.mp4" });
  // The master has left Dropbox: the largest copy instead, and the answer says so.
  masterGone = true;
  expect(await w.t.action(api.library.downloadLink, { versionId: w.ids.v1, share })).toEqual({ url: `https://${STREAM}/guid-1/play_1080p.mp4`, name: "4MLC_26_v1.mp4", fallback: true });
  // The owner gets the upload's own name.
  masterGone = false;
  expect((await w.me.action(api.library.downloadLink, { versionId: w.ids.v1 })).name).toBe("4MLC_26_v1.mov");
});

test("D152.3 review fix H1: no Stream link a viewer holds reaches beyond its one file (only the playlist is folder-wide)", async () => {
  const w = await setup();
  process.env.BUNNY_STREAM_TOKEN_KEY = "test-key";
  const token = await w.share(false);
  const vid = (await w.t.query(api.library.video, { videoId: w.ids.video, share: guest(token) }))!;
  const v3 = vid.versions.find((v) => v.number === 3)!;
  for (const u of [v3.media.mp4[360], v3.media.mp4[1080], v3.media.thumb, v3.thumbUrl]) expect(u).not.toContain("token_path");
  expect(v3.media.hls).toContain("token_path=%2Fguid-3%2F"); // the stream needs its folder; /original is blocked at Bunny
  expect(JSON.stringify(await w.t.query(api.shares.open, { token }))).not.toContain("token_path");
  // The Download copy is signed for that file alone.
  const mine = await w.me.action(api.library.downloadLink, { versionId: w.ids.v3 });
  expect(mine.url).toMatch(new RegExp(`^https://${STREAM}/guid-3/play_1080p\\.mp4\\?token=HS256-[\\w-]+&expires=\\d+$`));
});

test("D152.4 downloads off, a version the share doesn't show, an off or expired share, or another business: no link", async () => {
  const w = await setup();
  const off = guest(await w.share(false));
  expect((await w.t.query(api.library.video, { videoId: w.ids.video, share: off }))!.versions.every((v) => v.download === null)).toBe(true);
  await expect(w.t.action(api.library.downloadLink, { versionId: w.ids.v1, share: off })).rejects.toThrow(/Downloads aren't on/);
  const latest = guest(await w.share(true, false)); // latest only: v3
  await expect(w.t.action(api.library.downloadLink, { versionId: w.ids.v1, share: latest })).rejects.toThrow();
  const t2 = await w.share(true);
  const row = await w.t.run(async (ctx) => (await ctx.db.query("shares").collect()).find((s) => s.token === t2)!);
  await w.me.mutation(api.shares.setOff, { shareId: row._id, off: true });
  await expect(w.t.action(api.library.downloadLink, { versionId: w.ids.v1, share: guest(t2) })).rejects.toThrow();
  const t3 = await w.share(true);
  await w.t.run(async (ctx) => { const s = (await ctx.db.query("shares").collect()).find((x) => x.token === t3)!; await ctx.db.patch(s._id, { expiresAt: Date.now() - 1 }); });
  await expect(w.t.action(api.library.downloadLink, { versionId: w.ids.v1, share: guest(t3) })).rejects.toThrow();
  await expect(w.boss.action(api.library.downloadLink, { versionId: w.ids.v1 })).rejects.toThrow();
  await expect(w.t.action(api.library.downloadLink, { versionId: w.ids.v1 })).rejects.toThrow();
  expect(dropboxCalls).toHaveLength(0); // nobody refused ever reached Dropbox
});

test("D152.5 final files: the same file; a Bunny link ends with the delivery window (review fix L1)", async () => {
  const w = await setup();
  process.env.BUNNY_STREAM_TOKEN_KEY = "test-key";
  const until = Math.floor(Date.now() / 1000) + 1800;
  const { resolveDownload } = await import("../convex/library");
  const r = await w.t.run(async (ctx) => resolveDownload(ctx as never, w.ids.v3, "final.mp4", until));
  expect(r.url).toContain(`&expires=${until}`);
  expect(await w.t.query(internal.projects.versionExt, { versionId: w.ids.v1 })).toBe("mov");
  expect(await w.t.query(internal.projects.versionExt, { versionId: w.ids.v2 })).toBe("mp4");
});
