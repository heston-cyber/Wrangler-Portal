// Picture quality choice (Heston, Nov 4, approved): "360p is not listed, but it's used for scrubbing. 1080p is the
// default playback res unless changed. If the file uploaded is 1080p it plays at 1080p with no 4K version. If a 4K file
// is uploaded, a 1080p version is made via Bunny to be used as the default, but the 4K file plays straight away …
// once the 1080p file is made it switches over to that as the default with the option still in settings to play the
// 4K cut." Only new uploads; versions made before play exactly as before. Bunny is pretend throughout.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { answeringHeights } from "../convex/uploads";
import { copySize, hiLabel, isBig } from "../convex/lib/quality";
import { versionMedia } from "../convex/lib/media";
import { defaultQuality, noticeText, qualityOptions, switchTo, type QualityInfo } from "../src/modules/review/player/quality";

const modules = import.meta.glob("../convex/**/*.ts");
const STREAM = "vz-3ba0610b-f90.b-cdn.net";
const SCRUB = "vz-scrub.b-cdn.net";
const STILLS = "wrangler-review-stills.b-cdn.net";
const KEYS = ["BUNNY_STREAM_TOKEN_KEY", "BUNNY_SCRUB_TOKEN_KEY", "BUNNY_STILLS_TOKEN_KEY"] as const;

// The pretend Bunny: what each library says about a video, and which MP4 copies answer on the CDN.
let bunny: Record<string, { status: number; encodeProgress?: number; availableResolutions: string; width?: number; height?: number; storageSize?: number }> = {};
let answering = new Set<string>(); // "<cdn>/<guid>/<height>"
let cdnAsks: string[] = [];
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.BUNNY_STREAM_LIBRARY_ID = "785477";
  process.env.BUNNY_STREAM_API_KEY = "bunny-test";
  process.env.BUNNY_STILLS_CDN = STILLS;
  process.env.BUNNY_SCRUB_LIBRARY_ID = "900001";
  process.env.BUNNY_SCRUB_API_KEY = "scrub-test";
  process.env.BUNNY_SCRUB_CDN = SCRUB;
  delete process.env.BUNNY_STREAM_CDN;
});
beforeEach(() => {
  bunny = {}; answering = new Set(); cdnAsks = [];
  for (const k of KEYS) delete process.env[k];
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const lib = /^https:\/\/video\.bunnycdn\.com\/library\/(\d+)\/videos\/([\w-]+)$/.exec(url);
    if (lib) { const b = bunny[lib[2]]; return b ? json({ guid: lib[2], hasMP4Fallback: true, framerate: 23.976, length: 30, ...b }) : json({}, 404); }
    const cdn = /^https:\/\/([^/]+)\/([\w-]+)\/play_(\d+)p\.mp4/.exec(url);
    if (cdn) { cdnAsks.push(url); return answering.has(`${cdn[1]}/${cdn[2]}/${cdn[3]}`) ? new Response(new Uint8Array(2), { status: 206 }) : new Response("", { status: 404 }); }
    return new Response("{}", { status: 500 });
  });
});
afterEach(() => { vi.unstubAllGlobals(); for (const k of KEYS) delete process.env[k]; });

type VersionFields = Partial<Doc<"versions">>;
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const a = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    await ctx.db.insert("memberships", { businessId: a, email: "heston@wranglerproductions.com", userId: owner, role: "owner", createdAt: 0 });
    const maya = await ctx.db.insert("users", { email: "maya@harbor.example", name: "Maya", role: "client" });
    await ctx.db.insert("memberships", { businessId: a, email: "maya@harbor.example", userId: maya, role: "client", createdAt: 0 });
    const b = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const boss = await ctx.db.insert("users", { email: "boss@otherfilms.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: b, email: "boss@otherfilms.example", userId: boss, role: "owner", createdAt: 1 });
    const now = Date.now();
    const project = await ctx.db.insert("projects", { businessId: a, name: "Launch", createdAt: now } as never);
    const video = await ctx.db.insert("videos", { businessId: a, projectId: project, title: "Harbor 30", createdAt: now, updatedAt: now } as never);
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    return { a, video, heston: await sess(owner), maya: await sess(maya), boss: await sess(boss) };
  });
  let n = 0;
  const add = (f: VersionFields) => t.run(async (ctx) => ctx.db.insert("versions", {
    businessId: ids.a, videoId: ids.video, number: ++n, status: "ready", bunnyGuid: "", fileName: `v${n}.mp4`, startTimecode: "01:00:00:00",
    createdAt: Date.now() + n, frameCount: 720, fpsNum: 24000, fpsDen: 1001, ...f,
  } as never) as Promise<Id<"versions">>);
  const me = t.withIdentity({ subject: ids.heston });
  const page = async (who = me, share?: { token: string; guestName?: string; guestKey?: string }) => (await who.query(api.library.video, { videoId: ids.video, ...(share ? { share } : {}) }))!;
  const media = async (id: Id<"versions">, who = me, share?: { token: string; guestName?: string; guestKey?: string }) => (await page(who, share)).versions.find((v) => v._id === id)!.media;
  return { t, ids, me, add, page, media, maya: t.withIdentity({ subject: ids.maya }), boss: t.withIdentity({ subject: ids.boss }) };
}
const render = (name: string, w: number, h: number, extra: VersionFields = {}): VersionFields => ({
  source: "file", qualityMenu: true, width: w, height: h, storagePath: `review/x/abc123/${name}`, fileUrl: `https://${STILLS}/review/x/abc123/${name}`, fileName: name, ...extra,
});
const ids = (q: QualityInfo | null) => qualityOptions(q).map((o) => o.id);

describe("Q1 a 1080p upload plays 1080p, with no 4K and no notice", () => {
  test("converted (Bunny Stream) and preset render alike", async () => {
    const w = await setup();
    const up = await w.add({ qualityMenu: true, bunnyGuid: "g1080", width: 1920, height: 1080, mp4Heights: [360, 1080] });
    const q = (await w.media(up)).quality!;
    expect(q).toEqual({ q1080: `https://${STREAM}/g1080/play_1080p.mp4`, q4k: null, hi: null, big: false });
    expect(qualityOptions(q).map((o) => o.label)).toEqual(["1080p"]);
    expect(defaultQuality(qualityOptions(q), "4k")).toBe("1080"); // a remembered 4K choice can't pick what isn't there
    expect(noticeText(qualityOptions(q))).toBeNull();

    // A 1080p preset render plays as rendered; its scrub copy is 360p only and nothing waits for a 1080p copy.
    const r = await w.add(render("00001_Harbor_v2.mp4", 1920, 1080, { scrubGuid: "s1080", scrubStatus: "pending" }));
    bunny.s1080 = { status: 3, availableResolutions: "360p,1080p" };
    answering.add(`${SCRUB}/s1080/360`);
    expect((await w.t.action(internal.reviewFiles.pollScrub, { versionId: r })).result).toBe("scrub copy ready");
    expect(cdnAsks.some((u) => u.includes("play_1080p"))).toBe(false);
    const rq = (await w.media(r)).quality!;
    expect(rq).toEqual({ q1080: `https://${STILLS}/review/x/abc123/00001_Harbor_v2.mp4`, q4k: null, hi: null, big: false });
    expect(ids(rq)).toEqual(["1080"]);
  });
});

describe("Q2 a 4K preset render", () => {
  test("plays 4K straight away; 1080p becomes the default once the scrub library's copy answers", async () => {
    const w = await setup();
    const v = await w.add(render("00001_Harbor_v3.mp4", 3840, 2160, { scrubGuid: "s4k", scrubStatus: "pending", fileSize: 4_000_000_000 }));
    let q = (await w.media(v)).quality!;
    expect(q).toEqual({ q1080: null, q4k: `https://${STILLS}/review/x/abc123/00001_Harbor_v3.mp4`, hi: { width: 3840, height: 2160 }, big: true });
    expect(qualityOptions(q).map((o) => o.label)).toEqual(["4K (2160p)"]);
    expect(defaultQuality(qualityOptions(q), null)).toBe("4k");

    // The 360p copy lands first: dragging works, and the poll keeps going for the 1080p copy.
    bunny.s4k = { status: 4, availableResolutions: "360p", storageSize: 50_000_000 };
    answering.add(`${SCRUB}/s4k/360`);
    expect((await w.t.action(internal.reviewFiles.pollScrub, { versionId: v })).result).toBe("waiting for the 1080p copy");
    let row = (await w.t.run((ctx) => ctx.db.get(v)))!;
    expect([row.scrubStatus, row.scrubHeights]).toEqual(["ready", [360]]);
    expect(ids((await w.media(v)).quality)).toEqual(["4k"]);
    expect(await w.t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).map((s) => s.name))).toContain("reviewFiles:pollScrub");

    // Bunny lists 1080p before the file answers: still waiting.
    bunny.s4k = { status: 4, availableResolutions: "360p,1080p" };
    expect((await w.t.action(internal.reviewFiles.pollScrub, { versionId: v })).result).toBe("waiting for the 1080p copy");
    expect(ids((await w.media(v)).quality)).toEqual(["4k"]);

    // Now it answers: 1080p is offered and is the default; 4K stays in the menu.
    bunny.s4k = { status: 3, availableResolutions: "360p,1080p", storageSize: 400_000_000 };
    answering.add(`${SCRUB}/s4k/1080`);
    expect((await w.t.action(internal.reviewFiles.pollScrub, { versionId: v })).result).toBe("1080p copy ready");
    row = (await w.t.run((ctx) => ctx.db.get(v)))!;
    expect([row.scrubHeights, row.storageBytes]).toEqual([[360, 1080], 4_400_000_000]);
    q = (await w.media(v)).quality!;
    expect(q.q1080).toBe(`https://${SCRUB}/s4k/play_1080p.mp4`);
    const opts = qualityOptions(q);
    expect(opts.map((o) => o.label)).toEqual(["1080p", "4K (2160p)"]);
    expect(defaultQuality(opts, null)).toBe("1080");
    expect(defaultQuality(opts, "4k")).toBe("4k"); // the viewer's own choice wins
    expect(noticeText(opts)).toBe("Playing in 1080p for faster loading. Choose 4K in ⚙ to watch the full-resolution cut.");
    // A poll after that has nothing to do.
    expect((await w.t.action(internal.reviewFiles.pollScrub, { versionId: v })).result).toBe("nothing to do");
  });

  test("a scrub library that isn't set to make 1080p: the render keeps playing at full size, and the poll stops", async () => {
    const w = await setup();
    const v = await w.add(render("00001_Harbor_v4.mp4", 3840, 1600, { scrubGuid: "s-no", scrubStatus: "pending" }));
    bunny["s-no"] = { status: 3, availableResolutions: "360p" };
    answering.add(`${SCRUB}/s-no/360`);
    expect((await w.t.action(internal.reviewFiles.pollScrub, { versionId: v })).result).toBe("scrub copy ready (no 1080p copy)");
    const q = (await w.media(v)).quality!;
    expect(qualityOptions(q).map((o) => [o.id, o.label])).toEqual([["4k", "4K (1600p)"]]); // a 3840×1600 render: its real height
  });
});

describe("Q3 a converted 4K upload (Bunny Stream)", () => {
  test("offers 1080p first and 4K once the taller MP4 copy answers; the checks keep going until then", async () => {
    const w = await setup();
    const v = await w.add({ qualityMenu: true, bunnyGuid: "g4k", width: 3840, height: 2160, mp4Heights: [360, 1080] });
    let q = (await w.media(v)).quality!;
    expect(q).toEqual({ q1080: `https://${STREAM}/g4k/play_1080p.mp4`, q4k: null, hi: null, big: true });
    expect(ids(q)).toEqual(["1080"]);

    // Bunny lists 2160p but is still encoding (4 = some resolutions done) and the file doesn't answer yet: checked again,
    // past the usual 3 minutes.
    bunny.g4k = { status: 4, encodeProgress: 100, availableResolutions: "360p,1080p,2160p", width: 3840, height: 2160 };
    answering.add(`${STREAM}/g4k/360`); answering.add(`${STREAM}/g4k/1080`);
    await w.t.action(internal.uploads.stageCheck, { versionId: v, attempt: 30 });
    const next = async () => (await w.t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.name === "uploads:stageCheck").map((s) => s.args[0] as { attempt: number; doneAt?: number })));
    expect((await next()).map((x) => x.attempt)).toContain(31);
    expect(ids((await w.media(v)).quality)).toEqual(["1080"]);

    // Finished, and the 2160p copy answers: 4K joins the menu, 1080p stays the default.
    bunny.g4k = { ...bunny.g4k, status: 3 };
    answering.add(`${STREAM}/g4k/2160`);
    await w.t.action(internal.uploads.stageCheck, { versionId: v, attempt: 31 });
    expect((await w.t.run((ctx) => ctx.db.get(v)))!.mp4Heights).toEqual([360, 1080, 2160]);
    q = (await w.media(v)).quality!;
    expect(q.q4k).toBe(`https://${STREAM}/g4k/play_2160p.mp4`);
    expect(qualityOptions(q).map((o) => o.label)).toEqual(["1080p", "4K (2160p)"]);
    expect(defaultQuality(qualityOptions(q), null)).toBe("1080");
  });

  test("Bunny finished but its 2160p MP4 never answers (Bunny's MP4 copies stop at 1080p): 1080p only, and the checks stop", async () => {
    const w = await setup();
    const v = await w.add({ qualityMenu: true, bunnyGuid: "g4n", width: 3840, height: 2160, mp4Heights: [360, 1080] });
    bunny.g4n = { status: 3, encodeProgress: 100, availableResolutions: "360p,1080p,2160p", width: 3840, height: 2160 };
    answering.add(`${STREAM}/g4n/360`); answering.add(`${STREAM}/g4n/1080`);
    await w.t.action(internal.uploads.stageCheck, { versionId: v, attempt: 40, doneAt: 22 }); // 18 checks since it finished
    const sched = await w.t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.name === "uploads:stageCheck"));
    expect(sched).toHaveLength(0);
    expect(ids((await w.media(v)).quality)).toEqual(["1080"]);
  });

  test("Bunny names copies by height: a 3840×1600 source's '2160p' copy is listed as 4K with its real size", async () => {
    answering.add(`${STREAM}/gw/360`); answering.add(`${STREAM}/gw/1080`); answering.add(`${STREAM}/gw/2160`);
    expect(await answeringHeights("gw", { availableResolutions: "360p,1080p,2160p", hasMP4Fallback: true })).toEqual([360, 1080, 2160]);
    expect(await answeringHeights("gw", { availableResolutions: "360p,1080p,1440p", hasMP4Fallback: true })).toEqual([360, 1080]); // 1440 asked, not there
    expect(cdnAsks.some((u) => u.includes("/gw/play_1440p.mp4"))).toBe(true);
    expect(copySize(2160, { width: 3840, height: 1600 })).toEqual({ width: 3840, height: 1600 });
    expect(copySize(2160, { width: 4096, height: 2160 })).toEqual({ width: 3840, height: 2025 });
    expect(copySize(1440, {})).toEqual({ width: 2560, height: 1440 });
    expect(hiLabel({ width: 3840, height: 1600 })).toEqual({ label: "4K (1600p)", short: "4K" });
    expect(hiLabel({ width: 2560, height: 1440 })).toEqual({ label: "1440p", short: "1440p" });
    expect(hiLabel({ width: 2048, height: 858 })).toEqual({ label: "Full size (2048×858)", short: "Full size" });
    expect([isBig(1920, 1080), isBig(2048, 858), isBig(1080, 1920), isBig(1920, 1081)]).toEqual([false, true, true, true]);
  });
});

describe("Q4 every quality link is signed for its one file (review fix H1)", () => {
  test("with the zones' keys set, no token_path anywhere in the choice", async () => {
    const w = await setup();
    for (const k of KEYS) process.env[k] = "test-key";
    const r = await w.add(render("00001_Harbor_v5.mp4", 3840, 2160, { scrubGuid: "s5", scrubStatus: "ready", scrubHeights: [360, 1080] }));
    const s = await w.add({ qualityMenu: true, bunnyGuid: "g5", width: 3840, height: 2160, mp4Heights: [360, 1080, 2160] });
    for (const id of [r, s]) {
      const q = (await w.media(id)).quality!;
      for (const u of [q.q1080, q.q4k]) {
        expect(u).toMatch(/\?token=HS256-[\w-]+&expires=\d+$/);
        expect(u).not.toContain("token_path");
      }
    }
    expect((await w.media(r)).quality!.q1080).toMatch(new RegExp(`^https://${SCRUB}/s5/play_1080p\\.mp4\\?token=`));
    expect((await w.media(s)).quality!.q4k).toMatch(new RegExp(`^https://${STREAM}/g5/play_2160p\\.mp4\\?token=`));
  });
});

describe("Q5 who sees what", () => {
  test("clients and guests get the same choices through a share; another business gets nothing", async () => {
    const w = await setup();
    const v = await w.add(render("00001_Harbor_v6.mp4", 3840, 2160, { scrubGuid: "s6", scrubStatus: "ready", scrubHeights: [360, 1080] }));
    const mine = (await w.media(v)).quality;
    const link = (await w.me.mutation(api.shares.create, { target: { kind: "video", videoId: w.ids.video }, access: "comment", who: "link", allVersions: true, downloads: false, emailNewVersions: false })).token;
    const guest = { token: link, guestKey: "gk-pat", guestName: "Pat" };
    expect((await w.media(v, w.t as never, guest)).quality).toEqual(mine);
    const invited = (await w.me.mutation(api.shares.create, { target: { kind: "video", videoId: w.ids.video }, access: "comment", who: "invited", emails: ["maya@harbor.example"], allVersions: true, downloads: false, emailNewVersions: false })).token;
    const client = await w.page(w.maya as never, { token: invited });
    expect(client.viewer.kind).toBe("client");
    expect(client.versions.find((x) => x._id === v)!.media.quality).toEqual(mine);
    expect(ids(mine)).toEqual(["1080", "4k"]);
    // Another business's owner, and nobody at all, get nothing.
    const other = await w.boss.query(api.library.video, { videoId: w.ids.video }).catch(() => null);
    expect(other).toBeNull();
    await expect(w.t.query(api.library.video, { videoId: w.ids.video })).rejects.toThrow();
  });
});

describe("Q6 versions made before Nov 4 are untouched", () => {
  test("no quality choice, the same links as before, and the scrub poll stops at 360p as it always did", async () => {
    const w = await setup();
    const oldRender = await w.add({ ...render("00001_Harbor_v1.mp4", 3840, 2160, { scrubGuid: "s-old", scrubStatus: "pending" }), qualityMenu: undefined });
    const oldUpload = await w.add({ bunnyGuid: "g-old", width: 3840, height: 2160, mp4Heights: [360, 1080] });
    bunny["s-old"] = { status: 3, availableResolutions: "360p,1080p" };
    answering.add(`${SCRUB}/s-old/360`); answering.add(`${SCRUB}/s-old/1080`);
    expect((await w.t.action(internal.reviewFiles.pollScrub, { versionId: oldRender })).result).toBe("scrub copy ready");
    expect(cdnAsks.some((u) => u.includes("play_1080p"))).toBe(false);
    const row = (await w.t.run((ctx) => ctx.db.get(oldRender)))!;
    expect([row.scrubStatus, row.scrubHeights, row.qualityMenu]).toEqual(["ready", undefined, undefined]);
    for (const id of [oldRender, oldUpload]) {
      const m = await w.media(id);
      expect(m.quality).toBeNull();
      expect(qualityOptions(m.quality)).toEqual([]);
      const doc = (await w.t.run((ctx) => ctx.db.get(id)))!;
      const { quality, ...rest } = await versionMedia(doc);
      expect(quality).toBeNull();
      expect({ ...m, quality: undefined }).toEqual({ ...rest, quality: undefined });
    }
    // The old links themselves: the render with its own folder's token path rule, the copies and the stream as before.
    const m = await w.media(oldUpload);
    expect(Object.keys(m.mp4).map(Number)).toEqual([360, 1080]);
    expect(m.hls).toBe(`https://${STREAM}/g-old/playlist.m3u8`);
    expect((await w.media(oldRender)).file).toBe(`https://${STILLS}/review/x/abc123/00001_Harbor_v1.mp4`);
    for (const k of KEYS) process.env[k] = "test-key";
    expect((await w.media(oldRender)).file).toContain("token_path=%2Freview%2Fx%2Fabc123%2F"); // signed the old way (its own folder)
    expect((await w.media(oldRender)).scrub!.mp4).toContain("token_path=%2Fs-old%2F");
    for (const k of KEYS) delete process.env[k];
    // Stream checks after "ready" stop after 3 minutes as before, even for a big old version.
    bunny["g-old"] = { status: 4, encodeProgress: 100, availableResolutions: "360p,1080p,2160p" };
    await w.t.action(internal.uploads.stageCheck, { versionId: oldUpload, attempt: 18 });
    expect(await w.t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.name === "uploads:stageCheck"))).toHaveLength(0);
  });

  test("new versions are marked: browser uploads and both kinds of drop-folder import", async () => {
    const w = await setup();
    const r = await w.t.mutation(internal.library.insertVersion, { videoId: w.ids.video, bunnyGuid: "g-new", fileName: "x.mov" });
    expect((await w.t.run((ctx) => ctx.db.get(r.versionId)))!.qualityMenu).toBe(true);
    const fileId = await w.t.run((ctx) => ctx.db.insert("dropFiles", { pathLower: "/a/x.mp4", pathDisplay: "/A/x.mp4", rev: "r", size: 1, status: "waiting", firstSeenAt: 0, lastChangeAt: 0, checks: 0 } as never));
    const a = await w.t.mutation(internal.dropbox.addVersion, { fileId, videoId: w.ids.video, bunnyGuid: "g-dbx", fileName: "x.mov", fileSize: 1, dropboxPath: "/a/x.mov" });
    const b = await w.t.mutation(internal.dropbox.addFileVersion, { fileId, videoId: w.ids.video, fileName: "y.mp4", fileSize: 1, dropboxPath: "/a/y.mp4", frames: 10, fpsNum: 24000, fpsDen: 1001, width: 3840, height: 2160, seconds: 1 });
    for (const id of [a.versionId, b.versionId]) expect((await w.t.run((ctx) => ctx.db.get(id)))!.qualityMenu).toBe(true);
  });
});

describe("Q7 the player's choice (src/modules/review/player/quality.ts)", () => {
  const both: QualityInfo = { q1080: "https://x/1080.mp4", q4k: "https://x/4k.mp4", hi: { width: 3840, height: 2160 }, big: true };
  const only4k: QualityInfo = { ...both, q1080: null };
  const opts = qualityOptions(both), early = qualityOptions(only4k);
  test("the default takes over only while paused at the very start, and never over the viewer's own choice", () => {
    expect(switchTo({ options: opts, current: "4k", pref: null, chose: false, playing: false, frame: 0 })).toBe("1080"); // on open, or paused at the start
    expect(switchTo({ options: opts, current: "4k", pref: null, chose: false, playing: true, frame: 0 })).toBeNull(); // never mid-play
    expect(switchTo({ options: opts, current: "4k", pref: null, chose: false, playing: false, frame: 120 })).toBeNull(); // paused mid-way
    expect(switchTo({ options: opts, current: "4k", pref: "4k", chose: false, playing: false, frame: 0 })).toBeNull(); // remembered 4K
    expect(switchTo({ options: opts, current: "4k", pref: "1080", chose: true, playing: false, frame: 0 })).toBeNull(); // picked this visit
    expect(switchTo({ options: early, current: "4k", pref: null, chose: false, playing: false, frame: 0 })).toBeNull();
    // Opened before anything was ready (the old way played): the choice takes over at the start only.
    expect(switchTo({ options: opts, current: null, pref: null, chose: false, playing: true, frame: 10 })).toBeNull();
    expect(switchTo({ options: opts, current: null, pref: null, chose: false, playing: false, frame: 0 })).toBe("1080");
  });
  test("menu order, labels and the notice", () => {
    expect(opts.map((o) => [o.id, o.label, o.url])).toEqual([["1080", "1080p", "https://x/1080.mp4"], ["4k", "4K (2160p)", "https://x/4k.mp4"]]);
    expect(qualityOptions(null)).toEqual([]);
    expect(noticeText(early)).toBeNull(); // playing the 4K: nothing to say
    expect(noticeText(qualityOptions({ ...both, hi: { width: 2560, height: 1440 } }))).toBe("Playing in 1080p for faster loading. Choose 1440p in ⚙ to watch the full-resolution cut.");
  });
});
