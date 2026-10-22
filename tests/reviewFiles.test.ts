// Phase R3 (Oct 22): render-to-review. Register names decide the video; a review export is stored and played as it
// is (Bunny Storage), anything else goes to Bunny Stream; a 360p scrub copy follows.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { checkReviewExport } from "../convex/lib/mp4";
import { registerName } from "../convex/lib/dropboxPath";

// Bunny Storage uploads go through node:https (streamed). Pretend to be Bunny: count the bytes, answer 201.
const putLog: Array<{ path: string; bytes: number; length: string | undefined }> = [];
vi.mock("node:https", () => {
  const request = (opts: { path: string; headers: Record<string, string> }, cb: (res: EventEmitter & { statusCode: number; resume: () => void }) => void) => {
    let bytes = 0;
    const req = new Writable({
      write(chunk, _enc, done) { bytes += chunk.length; done(); },
      final(done) {
        putLog.push({ path: opts.path, bytes, length: opts.headers["content-length"] });
        done();
        setImmediate(() => { const res = Object.assign(new EventEmitter(), { statusCode: 201, resume: () => {} }); cb(res); res.emit("end"); });
      },
    });
    return req;
  };
  return { default: { request }, request };
});

const modules = import.meta.glob("../convex/**/*.ts");
const fx = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));
const reader = (b: Uint8Array) => async (s: number, e: number) => b.subarray(s, Math.min(e + 1, b.length));

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.DROPBOX_APP_KEY = "test-key";
  process.env.DROPBOX_APP_SECRET = "test-secret";
  process.env.BUNNY_STREAM_LIBRARY_ID = "785477";
  process.env.BUNNY_STREAM_API_KEY = "bunny-test";
  process.env.BUNNY_STORAGE_PASSWORD = "storage-test";
  process.env.BUNNY_STORAGE_HOST = "ny.storage.bunnycdn.com";
  process.env.BUNNY_STORAGE_ZONE = "wrangler-review-stills";
  process.env.BUNNY_STILLS_CDN = "wrangler-review-stills.b-cdn.net";
  process.env.BUNNY_SCRUB_LIBRARY_ID = "900001";
  process.env.BUNNY_SCRUB_API_KEY = "scrub-test";
  process.env.BUNNY_SCRUB_CDN = "vz-scrub.b-cdn.net";
  process.env.ELEVENLABS_API_KEY = "el-test";
});
afterEach(() => { vi.unstubAllGlobals(); putLog.length = 0; });

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston" });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    const projectId = await ctx.db.insert("projects", { name: "Spirit Days", jobNumber: "26122", createdAt: 0 });
    const videoId = await ctx.db.insert("videos", { projectId, title: "Spirit Intro", number: 1, shortTitle: "SpiritIntro", createdAt: 0, updatedAt: 0 });
    await ctx.db.insert("counters", { key: "videoNumber", value: 1 });
    return { userId, sessionId, videoId };
  });
  await t.mutation(internal.dropbox.saveConnection, { accountId: "dbid:x", email: "heston@wranglerproductions.com", refreshToken: "RT", accessToken: "AT", accessExpiresAt: Date.now() + 3_600_000, cursor: "c0" });
  const me = t.withIdentity({ subject: `${ids.userId}|${ids.sessionId}` });
  return { t, me, videoId: ids.videoId };
}

async function drop(t: ReturnType<typeof convexTest>, name: string, size: number) {
  await t.mutation(internal.dropbox.recordFiles, { files: [{ pathLower: `/renders/${name.toLowerCase()}`, pathDisplay: `/Renders/${name}`, rev: "r1", size }] });
  return (await t.run((ctx) => ctx.db.query("dropFiles").order("desc").first()))!._id;
}

// A pretend Dropbox, Bunny Stream, scrub library, CDN and ElevenLabs.
function fakeServices(file: Uint8Array) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (() => { try { return JSON.parse(init!.body as string); } catch { return init!.body; } })() : init?.body;
    calls.push({ url, method, body });
    const range = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("range") ?? "");
    if (url === "https://api.dropboxapi.com/oauth2/token") return json({ access_token: "at", expires_in: 14400 });
    if (url.endsWith("/files/get_metadata")) return json({ ".tag": "file", rev: "r1", size: file.length });
    if (url.endsWith("/files/get_temporary_link")) return json({ link: "https://dl.example/file" });
    if (url.endsWith("/sharing/create_shared_link_with_settings")) return json({ url: "https://www.dropbox.com/scl/fi/abc/x.mp4?rlkey=xyz&dl=0" });
    if (url.endsWith("/sharing/revoke_shared_link")) return json(null);
    if (url === "https://dl.example/file") {
      const s = +range![1], e = Math.min(+range![2], file.length - 1);
      return s >= file.length ? new Response(null, { status: 416 }) : new Response(file.slice(s, e + 1), { status: 206 });
    }
    if (url === "https://content.dropboxapi.com/2/files/download") return new Response(file, { status: 200, headers: { "content-length": String(file.length) } });
    if (url.startsWith("https://wrangler-review-stills.b-cdn.net/review/")) return new Response(file.slice(0, 2), { status: 206 });
    if (url.startsWith("https://ny.storage.bunnycdn.com/") && method === "DELETE") return new Response(null, { status: 200 });
    if (url.includes("/library/900001/videos/fetch")) return json({ id: "scrub-guid", success: true });
    if (url.includes("/library/900001/videos/scrub-guid") && method === "GET") return json({ status: 4, availableResolutions: "360p", storageSize: 5_000_000 });
    if (url.includes("/library/900001/videos/scrub-guid") && method === "DELETE") return json({ success: true });
    if (url === "https://vz-scrub.b-cdn.net/scrub-guid/play_360p.mp4") return new Response(new Uint8Array(2), { status: 206 });
    if (url.includes("video.bunnycdn.com/library/785477/videos/fetch")) return json({ id: "stream-guid", success: true });
    if (url.includes("video.bunnycdn.com/library/785477/videos/stream-guid")) return json({ success: true });
    if (url === "https://api.elevenlabs.io/v1/speech-to-text") return json({ language_code: "eng", words: [{ text: "Hello", start: 0.5, end: 0.9, type: "word", speaker_id: "speaker_0" }] });
    return json({ error_summary: `unexpected ${method} ${url}` }, 500);
  });
  return calls;
}

const scheduled = (t: ReturnType<typeof convexTest>) => t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).map((s) => s.name));

describe("what a review export is", () => {
  test("H.264 + AAC with the index at the front passes, with its exact frame count; anything else says why", async () => {
    const good = fx("moov-start-long-audio.mp4");
    expect(await checkReviewExport(reader(good), good.length)).toMatchObject({ ok: true, frames: 49, fpsNum: 24000, fpsDen: 1001, width: 64, height: 36, audio: "aac" });
    const end = fx("moov-end-long-audio.mp4");
    expect(await checkReviewExport(reader(end), end.length)).toMatchObject({ ok: false, reason: expect.stringMatching(/index is at the end/) });
    const hevc = fx("hevc-start.mp4");
    expect(await checkReviewExport(reader(hevc), hevc.length)).toMatchObject({ ok: false, reason: expect.stringMatching(/H\.265|HEVC|hvc1/i) });
  });
  test("register names", () => {
    expect(registerName("00001_LCArizona_v4.mp4")).toEqual({ number: 1, shortTitle: "LCArizona", version: 4 });
    expect(registerName("00012_Spirit-Intro_V10.mov")).toEqual({ number: 12, shortTitle: "Spirit-Intro", version: 10 });
    expect(registerName("00003_Teaser.mp4")).toEqual({ number: 3, shortTitle: "Teaser", version: null });
    expect(registerName("0001_Short_v1.mp4")).toBeNull();
    expect(registerName("SpiritIntro_v4.mp4")).toBeNull();
    expect(registerName("00001 LCArizona v4.mp4")).toBeNull();
  });
});

describe("names decide, nothing is guessed", () => {
  test("not a register name, an unknown number, and a version already on the site are flagged with what to do", async () => {
    const { t, me, videoId } = await setup();
    const file = fx("moov-start-long-audio.mp4");
    const calls = fakeServices(file);
    const a = await drop(t, "Spirit Intro final.mp4", file.length);
    expect((await t.action(internal.dropbox.importFile, { fileId: a })).result).toBe("flagged: not a register name");
    const b = await drop(t, "00042_Mystery_v1.mp4", file.length);
    expect((await t.action(internal.dropbox.importFile, { fileId: b })).result).toBe("flagged: unknown number");
    await t.run(async (ctx) => { await ctx.db.insert("versions", { videoId, number: 1, status: "ready", bunnyGuid: "g1", fileName: "00001_SpiritIntro_v1.mp4", startTimecode: "01:00:00:00", createdAt: 0 } as never); });
    const c = await drop(t, "00001_SpiritIntro_v1.mp4", file.length);
    expect((await t.action(internal.dropbox.importFile, { fileId: c })).result).toBe("flagged: version taken");
    const rows = await t.run(async (ctx) => Promise.all([a, b, c].map((id) => ctx.db.get(id))));
    expect(rows.map((r) => r!.status)).toEqual(["flagged", "flagged", "flagged"]);
    expect(rows[0]!.reason).toMatch(/Not a register name/);
    expect(rows[1]!.reason).toMatch(/no video 00042 in the register/);
    expect(rows[2]!.reason).toMatch(/Rename it 00001_SpiritIntro_v2\.mp4/);
    // Nothing was shared, sent to Bunny or stored.
    expect(calls.some((c) => /sharing|bunnycdn|storage/.test(c.url))).toBe(false);
    expect(putLog).toHaveLength(0);
    // The Register page lists them; Try again re-checks one; renaming it in Dropbox takes it off the list.
    expect((await me.query(api.dropbox.flagged, {})).map((f) => f.path)).toEqual(["/Renders/00001_SpiritIntro_v1.mp4", "/Renders/00042_Mystery_v1.mp4", "/Renders/Spirit Intro final.mp4"]);
    expect(await me.mutation(api.dropbox.retryFlagged, { fileId: b })).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(b)))!.status).toBe("waiting");
    await t.mutation(internal.dropbox.recordRemoved, { pathsLower: ["/renders/spirit intro final.mp4"] });
    expect((await t.run((ctx) => ctx.db.get(a)))).toMatchObject({ status: "skipped", reason: "Renamed or removed in Dropbox." });
    expect((await me.query(api.dropbox.flagged, {})).map((f) => f.path)).toEqual(["/Renders/00001_SpiritIntro_v1.mp4"]);
  });
});

describe("a review export", () => {
  test("is copied into Bunny Storage as it is, plays from there, and then gets its transcript, waveform, Slack note and scrub copy", async () => {
    const { t, me, videoId } = await setup();
    const file = fx("moov-start-long-audio.mp4");
    const calls = fakeServices(file);
    const fileId = await drop(t, "00001_SpiritIntro_v3.mp4", file.length);
    expect((await t.action(internal.dropbox.importFile, { fileId })).result).toBe("copying a review export");
    // No share link and nothing sent to Bunny Stream.
    expect(calls.some((c) => c.url.includes("sharing") || c.url.includes("library/785477"))).toBe(false);
    let ver = (await t.run((ctx) => ctx.db.query("versions").first()))!;
    expect([ver.number, ver.source, ver.status, ver.bunnyGuid, ver.frameCount, ver.frameCountFrom, ver.fpsNum, ver.fpsDen, ver.width, ver.height]).toEqual([3, "file", "processing", "", 49, "file", 24000, 1001, 64, 36]);
    expect(ver.storagePath).toMatch(new RegExp(`^review/${videoId}/[0-9a-f]{16}/00001_SpiritIntro_v3\\.mp4$`));
    expect(await scheduled(t)).toContain("reviewFiles:copy");

    expect((await t.action(internal.reviewFiles.copy, { versionId: ver._id, dropboxPath: "/renders/00001_spiritintro_v3.mp4", size: file.length, attempt: 0 })).result).toMatch(/^copied/);
    // (convex-test also runs the copy the import scheduled; a second run finds it done and does nothing.)
    expect(putLog.length).toBeGreaterThanOrEqual(1);
    for (const p of putLog) expect(p).toEqual({ path: `/wrangler-review-stills/${ver.storagePath}`, bytes: file.length, length: String(file.length) });
    expect((await t.action(internal.reviewFiles.copy, { versionId: ver._id, dropboxPath: "/x", size: file.length, attempt: 0 })).result).toBe("already copied");
    ver = (await t.run((ctx) => ctx.db.get(ver._id)))!;
    expect([ver.status, ver.fileUrl, ver.storageBytes]).toEqual(["ready", `https://wrangler-review-stills.b-cdn.net/${ver.storagePath}`, file.length]);
    const names = await scheduled(t);
    for (const n of ["slack:versionReady", "transcribe:run", "waveform:run", "reviewFiles:startScrub"]) expect(names).toContain(n);

    // The page gets the file to play; no scrub copy or thumbnail yet.
    let v = (await me.query(api.library.video, { videoId }))!.versions[0];
    expect([v.source, v.fileUrl, v.scrub, v.thumbUrl]).toEqual(["file", ver.fileUrl, null, null]);

    // The scrub library fetches the stored render by URL and makes its 360p copy.
    expect((await t.action(internal.reviewFiles.startScrub, { versionId: ver._id })).result).toMatch(/^(scrub copy started|already has one)$/);
    expect((await t.action(internal.reviewFiles.startScrub, { versionId: ver._id })).result).toBe("already has one");
    expect(calls.find((c) => c.url.includes("/library/900001/videos/fetch"))!.body.url).toBe(ver.fileUrl);
    expect((await t.action(internal.reviewFiles.pollScrub, { versionId: ver._id })).result).toBe("scrub copy ready");
    v = (await me.query(api.library.video, { videoId }))!.versions[0];
    expect(v.scrub).toEqual({ mp4: "https://vz-scrub.b-cdn.net/scrub-guid/play_360p.mp4", hls: "https://vz-scrub.b-cdn.net/scrub-guid/playlist.m3u8" });
    expect([v.scrubStatus, v.thumbUrl, v.storageBytes]).toEqual(["ready", "https://vz-scrub.b-cdn.net/scrub-guid/thumbnail.jpg", file.length + 5_000_000]);
    const ov = await me.query(api.library.overview, {});
    expect(ov.videos[0].latest).toMatchObject({ isFile: true, thumbUrl: "https://vz-scrub.b-cdn.net/scrub-guid/thumbnail.jpg" });

    // ElevenLabs reads the render by URL; nothing is downloaded here.
    const before = calls.length;
    expect((await t.action(internal.transcribe.run, { versionId: ver._id, attempt: 0 })).result).toBe("done: 1 words");
    const stt = calls.slice(before).filter((c) => c.url.includes("elevenlabs"));
    expect(stt.length).toBeGreaterThanOrEqual(1); // (plus the run the copy scheduled, which convex-test also runs)
    for (const c of stt) expect([(c.body as FormData).get("source_url"), (c.body as FormData).get("file")]).toEqual([ver.fileUrl, null]);
    expect(calls.slice(before).some((c) => c.url.startsWith("https://wrangler-review-stills.b-cdn.net/") && !/Range/.test(""))).toBe(false);

    // Deleting the version removes the stored render and the scrub copy.
    await me.mutation(api.library.deleteVersion, { versionId: ver._id });
    const cleanup = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.name.includes("cleanup")).map((s) => (s.args[0] as { bunnyGuid: string | null }).bunnyGuid));
    expect(cleanup.sort()).toEqual([`scrub:scrub-guid`, `storage:${ver.storagePath}`].sort());
    for (const g of cleanup) await t.action(internal.stills.cleanup, { bunnyGuid: g, stillUrls: [] });
    // (convex-test runs the scheduled cleanups too, so each DELETE may appear twice.)
    expect([...new Set(calls.filter((c) => c.method === "DELETE").map((c) => c.url))].sort()).toEqual([
      `https://ny.storage.bunnycdn.com/wrangler-review-stills/${ver.storagePath}`,
      "https://video.bunnycdn.com/library/900001/videos/scrub-guid",
    ].sort());
  }, 30_000);

  test("cleanup never deletes outside review/ in the storage zone", async () => {
    const { t } = await setup();
    const calls = fakeServices(new Uint8Array(1));
    expect(await t.action(internal.stills.cleanup, { bunnyGuid: "storage:stills/2026/10/a.jpg", stillUrls: [] })).toMatchObject({ video: "kept" });
    expect(await t.action(internal.stills.cleanup, { bunnyGuid: "storage:review/../stills/a.jpg", stillUrls: [] })).toMatchObject({ video: "kept" });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  test("a .mov, or an MP4 with its index at the end, goes to Bunny Stream with the version number from its name", async () => {
    const { t } = await setup();
    const file = fx("moov-end-long-audio.mp4");
    const calls = fakeServices(file);
    const fileId = await drop(t, "00001_SpiritIntro_v2.mp4", file.length);
    expect((await t.action(internal.dropbox.importFile, { fileId })).result).toBe("imported");
    expect(calls.some((c) => c.url.includes("library/785477/videos/fetch"))).toBe(true);
    const ver = (await t.run((ctx) => ctx.db.query("versions").first()))!;
    expect([ver.number, ver.source ?? "stream", ver.bunnyGuid]).toEqual([2, "stream", "stream-guid"]);
    expect((await t.run((ctx) => ctx.db.get(fileId)))!.reason).toMatch(/Converted by Bunny \(not a review export: The index is at the end/);
    expect(putLog).toHaveLength(0);
  }, 20_000);

  test("a copy that keeps failing marks the version failed with the reason; earlier tries are retried", async () => {
    const { t } = await setup();
    const file = fx("moov-start-long-audio.mp4");
    fakeServices(file);
    const fileId = await drop(t, "00001_SpiritIntro_v1.mp4", file.length);
    await t.action(internal.dropbox.importFile, { fileId });
    const ver = (await t.run((ctx) => ctx.db.query("versions").first()))!;
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 503 }));
    expect((await t.action(internal.reviewFiles.copy, { versionId: ver._id, dropboxPath: "/x", size: file.length, attempt: 0 })).result).toMatch(/^retrying: Dropbox download 503/);
    expect((await t.action(internal.reviewFiles.copy, { versionId: ver._id, dropboxPath: "/x", size: file.length, attempt: 2 })).result).toMatch(/^failed/);
    expect((await t.run((ctx) => ctx.db.get(ver._id)))).toMatchObject({ status: "failed", error: expect.stringMatching(/Couldn't copy the render/) });
  });
});
