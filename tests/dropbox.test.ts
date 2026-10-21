// Phase 2: the Dropbox drop folder and cut transcripts.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { directLink, pickProject, placeFor, projectMatches, splitJob } from "../convex/lib/dropboxPath";
import { buildTranscript, secondsToFrame, toFrameWords, toSegments } from "../convex/lib/transcript";
import { dropboxSignatureOk } from "../convex/dropbox";

const modules = import.meta.glob("../convex/**/*.ts");
const FPS = { num: 24000, den: 1001 };

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.DROPBOX_APP_KEY = "test-key";
  process.env.DROPBOX_APP_SECRET = "test-secret";
  process.env.BUNNY_STREAM_LIBRARY_ID = "785477";
  process.env.BUNNY_STREAM_API_KEY = "bunny-test";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function setup() {
  const t = convexTest(schema, modules);
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston" });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    return { userId, sessionId };
  });
  const me = t.withIdentity({ subject: `${userId}|${sessionId}` });
  return { t, me };
}

describe("drop folder rule", () => {
  test("<Project>/<Video>/file is a render; anything else is explained or ignored", () => {
    expect(placeFor("/26122 Spirit Days/Spirit Intro/SpiritIntro_v4.mov")).toMatchObject({ ok: true, project: "26122 Spirit Days", video: "Spirit Intro", fileName: "SpiritIntro_v4.mov", checkIndex: true });
    expect(placeFor("/26122 Spirit Days/Spirit Intro/clip.mxf")).toMatchObject({ ok: true, checkIndex: false });
    expect(placeFor("/loose.mp4")).toMatchObject({ ok: false });
    expect(placeFor("/ICG/26122 Spirit Days/Spirit Intro/v5.mov")).toMatchObject({ ok: true, client: "ICG", project: "26122 Spirit Days", video: "Spirit Intro", fileName: "v5.mov" });
    expect(placeFor("/26122 Spirit Days/Spirit Intro/v5.mov")).not.toHaveProperty("client");
    expect(placeFor("/A/B/C/D/too-deep.mp4")).toMatchObject({ ok: false });
    expect(placeFor("/A/B/notes.txt")).toMatchObject({ ok: false, ignore: true });
    expect(placeFor("/A/B/.DS_Store")).toMatchObject({ ok: false, ignore: true });
    expect(placeFor("/A/B/render.mp4.part")).toMatchObject({ ok: false, ignore: true });
  });
  test("job numbers, project matching and direct links", () => {
    expect(splitJob("26122 Spirit Days")).toEqual({ jobNumber: "26122", name: "Spirit Days" });
    expect(splitJob("26122_Spirit Days")).toEqual({ jobNumber: "26122", name: "Spirit Days" });
    expect(splitJob("ICG")).toEqual({ name: "ICG" });
    const p = { name: "Spirit Days", jobNumber: "26122" };
    expect(["Spirit Days", "spirit days", "26122 Spirit Days", "26122_Spirit_Days", "26122"].every((f) => projectMatches(f, p))).toBe(true);
    expect(projectMatches("Spirit", p)).toBe(false);
    expect(directLink("https://www.dropbox.com/scl/fi/abc/a.mp4?rlkey=xyz&dl=0")).toBe("https://www.dropbox.com/scl/fi/abc/a.mp4?rlkey=xyz&dl=1");
  });
  test("webhook signatures are checked", async () => {
    const body = JSON.stringify({ list_folder: { accounts: ["dbid:x"] } });
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body)))).map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await dropboxSignatureOk(body, sig, "test-secret")).toBe(true);
    expect(await dropboxSignatureOk(body + " ", sig, "test-secret")).toBe(false);
    expect(await dropboxSignatureOk(body, null, "test-secret")).toBe(false);
  });
});

describe("transcripts", () => {
  test("seconds become frames of the version (23.976)", () => {
    expect(secondsToFrame(0, FPS)).toBe(0);
    expect(secondsToFrame(1, FPS)).toBe(23); // 1 s = 23.976 frames → still on frame 23
    expect(secondsToFrame(1001 / 24000, FPS)).toBe(1); // exactly one frame in
    const { words, speakers } = toFrameWords([
      { text: "Hello", start: 0.5, end: 0.9, type: "word", speaker_id: "speaker_0" },
      { text: " ", start: 0.9, end: 1.0, type: "spacing", speaker_id: "speaker_0" },
      { text: "there.", start: 1.0, end: 1.4, type: "word", speaker_id: "speaker_1" },
    ], FPS, 3149);
    expect(speakers).toEqual(["speaker_0", "speaker_1"]);
    expect(words).toEqual([["Hello", 11, 21, 0], ["there.", 23, 33, 1]]);
  });
  test("lines break on speaker, pauses and sentence ends", () => {
    const w = (text: string, a: number, b: number, sp = 0): [string, number, number, number] => [text, a, b, sp];
    const segs = toSegments([
      w("One", 0, 5), w("two", 6, 10), w("three", 11, 15), w("four", 16, 20), w("five", 21, 25), w("six.", 26, 30),
      w("New", 31, 35), w("line", 36, 40),
      w("after", 80, 85), w("a", 86, 88), w("pause", 89, 95),
      w("Other", 96, 100, 1), w("voice", 101, 105, 1),
    ], FPS);
    expect(segs.map((s) => [s.speaker, s.in, s.out, s.text])).toEqual([
      [0, 0, 30, "One two three four five six."],
      [0, 31, 40, "New line"],
      [0, 80, 95, "after a pause"],
      [1, 96, 105, "Other voice"],
    ]);
  });
  test("words are clamped to the last frame", () => {
    const f = buildTranscript({ language_code: "eng", words: [{ text: "end", start: 200, end: 201, type: "word" }] }, FPS, 100);
    expect(f.words[0]).toEqual(["end", 99, 99, 0]);
  });
});

describe("noticing files", () => {
  test("baseline files are left alone; new renders wait; same revision is ignored; a new revision is a new render", async () => {
    const { t } = await setup();
    const f = (path: string, rev: string) => ({ pathLower: path.toLowerCase(), pathDisplay: path, rev, size: 1000 });
    await t.mutation(internal.dropbox.recordFiles, { files: [f("/P/V/old.mp4", "r0")], baseline: true });
    expect(await t.mutation(internal.dropbox.recordFiles, { files: [f("/P/V/new.mp4", "r1"), f("/P/V/notes.txt", "x"), f("/loose.mp4", "r9")] })).toBe(1);
    expect(await t.mutation(internal.dropbox.recordFiles, { files: [f("/P/V/new.mp4", "r1")] })).toBe(0);
    const rows = await t.run((ctx) => ctx.db.query("dropFiles").collect());
    expect(rows.map((r) => [r.pathDisplay, r.status]).sort()).toEqual([["/P/V/new.mp4", "waiting"], ["/P/V/old.mp4", "existing"], ["/loose.mp4", "skipped"]]);
    // Still waiting and the file changes again: same row, clock restarts.
    await t.mutation(internal.dropbox.recordFiles, { files: [f("/P/V/new.mp4", "r2")] });
    let same = await t.run((ctx) => ctx.db.query("dropFiles").withIndex("by_path", (q) => q.eq("pathLower", "/p/v/new.mp4")).collect());
    expect(same.map((r) => r.rev)).toEqual(["r2"]);
    // Imported, then re-rendered under the same name: a second row (the next version).
    await t.run(async (ctx) => { await ctx.db.patch(same[0]._id, { status: "imported" }); });
    await t.mutation(internal.dropbox.recordFiles, { files: [f("/P/V/new.mp4", "r3")] });
    same = await t.run((ctx) => ctx.db.query("dropFiles").withIndex("by_path", (q) => q.eq("pathLower", "/p/v/new.mp4")).collect());
    expect(same.map((r) => [r.rev, r.status]).sort()).toEqual([["r2", "imported"], ["r3", "waiting"]]);
  });

  test("a file must sit still for a minute before it's looked at", async () => {
    const { t } = await setup();
    await t.mutation(internal.dropbox.recordFiles, { files: [{ pathLower: "/p/v/a.mp4", pathDisplay: "/P/V/a.mp4", rev: "r1", size: 1 }] });
    expect(await t.query(internal.dropbox.dueFiles, { now: Date.now() + 30_000 })).toHaveLength(0);
    expect(await t.query(internal.dropbox.dueFiles, { now: Date.now() + 61_000 })).toHaveLength(1);
  });

  test("a client folder files the project under that client, and keeps same-named projects of other clients apart", () => {
    const ps = [
      { name: "Social", client: "ICG" },
      { name: "Social", client: "Floor Trader" },
      { name: "Spirit Days", jobNumber: "26122" },
    ];
    expect(pickProject(ps, "Social", "floor trader")).toEqual({ project: ps[1], setClient: false });
    expect(pickProject(ps, "26122 Spirit Days", "ICG")).toEqual({ project: ps[2], setClient: true });
    expect(pickProject(ps, "Social", "UTT")).toBeNull();
    expect(pickProject(ps, "Spirit Days")).toEqual({ project: ps[2], setClient: false });
  });

  test("folders find the existing project and video, or make them", async () => {
    const { t, me } = await setup();
    const projectId = await me.mutation(api.library.createProject, { name: "Spirit Days", jobNumber: "26122" });
    const videoId = await me.mutation(api.library.createVideo, { projectId, title: "Spirit Intro" });
    const a = await t.mutation(internal.dropbox.findOrCreateTarget, { project: "26122 Spirit Days", video: "spirit intro" });
    expect(a).toEqual({ projectId, videoId });
    const b = await t.mutation(internal.dropbox.findOrCreateTarget, { project: "26130 Floor Trader", video: "Backrooms Teaser" });
    const made = await t.run(async (ctx) => ({ p: await ctx.db.get(b.projectId), v: await ctx.db.get(b.videoId) }));
    expect([made.p?.name, made.p?.jobNumber, made.v?.title]).toEqual(["Floor Trader", "26130", "Backrooms Teaser"]);
    // With a client folder: the existing Spirit Days project gets filed under ICG; a new one is made with its client.
    const c = await t.mutation(internal.dropbox.findOrCreateTarget, { client: "ICG", project: "26122 Spirit Days", video: "Spirit Intro" });
    expect(c).toEqual({ projectId, videoId });
    expect((await t.run((ctx) => ctx.db.get(projectId)))!.client).toBe("ICG");
    const d = await t.mutation(internal.dropbox.findOrCreateTarget, { client: "Hill Creative", project: "Wrangler Reel", video: "Cut A" });
    expect((await t.run((ctx) => ctx.db.get(d.projectId)))!.client).toBe("Hill Creative");
    // Setting a client by hand, and clearing it.
    await me.mutation(api.library.renameProject, { projectId, name: "Spirit Days", jobNumber: "26122", client: "ICG Ministries" });
    expect((await t.run((ctx) => ctx.db.get(projectId)))!.client).toBe("ICG Ministries");
    await me.mutation(api.library.renameProject, { projectId, name: "Spirit Days", jobNumber: "26122" });
    expect((await t.run((ctx) => ctx.db.get(projectId)))!.client).toBe("ICG Ministries");
    await me.mutation(api.library.renameProject, { projectId, name: "Spirit Days", jobNumber: "26122", client: "" });
    expect((await t.run((ctx) => ctx.db.get(projectId)))!.client).toBeUndefined();
  });
});

// A pretend Dropbox + Bunny, enough for one import.
function fakeServices(file: Uint8Array, opts: { rev?: string; revs?: Record<string, string>; fetchId?: string } = {}) {
  const calls: Array<{ url: string; body: any }> = [];
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === "string" ? (() => { try { return JSON.parse(init!.body as string); } catch { return init!.body; } })() : init?.body;
    calls.push({ url, body });
    if (url === "https://api.dropboxapi.com/oauth2/token") return json({ access_token: "at", expires_in: 14400 });
    if (url.endsWith("/files/get_metadata")) return json({ ".tag": "file", rev: opts.revs?.[body.path] ?? opts.rev ?? "r1", size: file.length });
    if (url.endsWith("/files/get_temporary_link")) return json({ link: "https://dl.example/file" });
    if (url.endsWith("/sharing/create_shared_link_with_settings")) return json({ url: "https://www.dropbox.com/scl/fi/abc/V1.mp4?rlkey=xyz&dl=0" });
    if (url.endsWith("/sharing/revoke_shared_link")) return json(null);
    if (url === "https://dl.example/file") {
      const m = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get("range") ?? "");
      const s = +m![1], e = Math.min(+m![2], file.length - 1);
      if (s >= file.length) return new Response(null, { status: 416 });
      return new Response(file.slice(s, e + 1), { status: 206 });
    }
    if (url.includes("video.bunnycdn.com") && url.endsWith("/videos/fetch")) return json(opts.fetchId ? { id: opts.fetchId, success: true, statusCode: 200 } : { success: true, statusCode: 200 });
    if (url.includes("video.bunnycdn.com") && url.includes("search=")) {
      const tag = decodeURIComponent(/search=([^&]+)/.exec(url)![1]);
      return json({ items: [{ guid: "guid-from-dropbox", title: tag }] });
    }
    if (url.includes("video.bunnycdn.com/library/785477/videos/guid-")) return json({ success: true });
    return json({ error_summary: `unexpected ${url}` }, 500);
  });
  return calls;
}

describe("importing a render", () => {
  const fixture = new Uint8Array(readFileSync(join(__dirname, "fixtures", "moov-end-long-audio.mp4")));

  async function connectedWithFile(t: ReturnType<typeof convexTest>, size: number) {
    await t.mutation(internal.dropbox.saveConnection, { accountId: "dbid:x", email: "heston@wranglerproductions.com", refreshToken: "SECRET-RT", accessToken: "SECRET-AT", accessExpiresAt: Date.now() + 3_600_000, cursor: "c0" });
    await t.mutation(internal.dropbox.recordFiles, { files: [{ pathLower: "/26122 spirit days/spirit intro/v1.mp4", pathDisplay: "/26122 Spirit Days/Spirit Intro/V1.mp4", rev: "r1", size }] });
    return (await t.run((ctx) => ctx.db.query("dropFiles").first()))!._id;
  }

  test("a finished file becomes v1, Bunny gets a direct link, and the link is deleted once Bunny has it", async () => {
    const { t, me } = await setup();
    const fileId = await connectedWithFile(t, fixture.length);
    const calls = fakeServices(fixture);
    const res = await t.action(internal.dropbox.importFile, { fileId });
    expect(res.result).toBe("imported");
    const fetchCall = calls.find((c) => c.url.endsWith("/videos/fetch"))!;
    expect(fetchCall.body.url).toBe("https://www.dropbox.com/scl/fi/abc/V1.mp4?rlkey=xyz&dl=1");
    const state = await t.run(async (ctx) => {
      const f = (await ctx.db.get(fileId))!;
      const ver = (await ctx.db.get(f.versionId!))!;
      const vid = (await ctx.db.get(ver.videoId))!;
      const proj = (await ctx.db.get(vid.projectId))!;
      return { f, ver, vid, proj };
    });
    expect([state.f.status, state.ver.number, state.ver.bunnyGuid, state.ver.uploaderName, state.ver.dropboxPath, state.ver.status]).toEqual(["imported", 1, "guid-from-dropbox", "Dropbox", "/26122 Spirit Days/Spirit Intro/V1.mp4", "processing"]);
    expect([state.proj.name, state.proj.jobNumber, state.vid.title]).toEqual(["Spirit Days", "26122", "Spirit Intro"]);
    const ov = await me.query(api.library.overview, {});
    expect(ov.videos.map((x: { title: string }) => x.title)).toContain("Spirit Intro");

    await t.action(internal.dropbox.revokeForVersion, { versionId: state.ver._id });
    expect(calls.filter((c) => c.url.endsWith("/sharing/revoke_shared_link")).map((c) => c.body.url)).toEqual(["https://www.dropbox.com/scl/fi/abc/V1.mp4?rlkey=xyz&dl=0"]);
    expect((await t.run((ctx) => ctx.db.get(fileId)))!.linkRevokedAt).toBeTypeOf("number");
    // Running it again does nothing more.
    await t.action(internal.dropbox.revokeForVersion, { versionId: state.ver._id });
    expect(calls.filter((c) => c.url.endsWith("/sharing/revoke_shared_link"))).toHaveLength(1);
  }, 20_000);

  test("when Bunny returns the new video's id, it's used straight away (no search)", async () => {
    const { t } = await setup();
    const fileId = await connectedWithFile(t, fixture.length);
    const calls = fakeServices(fixture, { fetchId: "guid-direct" });
    expect((await t.action(internal.dropbox.importFile, { fileId })).result).toBe("imported");
    expect(calls.some((c) => c.url.includes("search="))).toBe(false);
    const ver = await t.run(async (ctx) => ctx.db.get((await ctx.db.get(fileId))!.versionId!));
    expect(ver!.bunnyGuid).toBe("guid-direct");
  });

  test("a file that's still being written waits, and nothing is shared", async () => {
    const { t } = await setup();
    const part = fixture.slice(0, Math.floor(fixture.length / 2));
    const fileId = await connectedWithFile(t, part.length);
    const calls = fakeServices(part);
    expect((await t.action(internal.dropbox.importFile, { fileId })).result).toBe("not finished yet");
    const f = (await t.run((ctx) => ctx.db.get(fileId)))!;
    expect([f.status, f.checks]).toEqual(["waiting", 1]);
    expect(calls.some((c) => c.url.includes("sharing") || c.url.includes("bunnycdn"))).toBe(false);
  });

  test("a file removed before it's imported is skipped, not failed; deleting folders skips what was waiting in them", async () => {
    const { t } = await setup();
    const fileId = await connectedWithFile(t, fixture.length);
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/files/get_metadata")) return new Response(JSON.stringify({ error_summary: "path/not_found/.." }), { status: 409 });
      return new Response("{}", { status: 500 });
    });
    expect((await t.action(internal.dropbox.importFile, { fileId })).result).toBe("removed before import");
    expect((await t.run((ctx) => ctx.db.get(fileId)))!.status).toBe("skipped");
    await t.mutation(internal.dropbox.recordFiles, { files: [{ pathLower: "/p/v/x.mp4", pathDisplay: "/P/V/x.mp4", rev: "a", size: 1 }] });
    await t.mutation(internal.dropbox.recordRemoved, { pathsLower: ["/p"] });
    const row = await t.run((ctx) => ctx.db.query("dropFiles").withIndex("by_path", (q) => q.eq("pathLower", "/p/v/x.mp4")).first());
    expect([row!.status, row!.reason]).toEqual(["skipped", "Removed from Dropbox before it was imported."]);
  });

  test("a file that changed since it was seen goes back to waiting", async () => {
    const { t } = await setup();
    const fileId = await connectedWithFile(t, fixture.length);
    fakeServices(fixture, { rev: "r2" });
    expect((await t.action(internal.dropbox.importFile, { fileId })).result).toMatch(/changed/);
    expect((await t.run((ctx) => ctx.db.get(fileId)))!.rev).toBe("r2");
  });

  test("the second render in the same folder is v2 of the same video", async () => {
    const { t } = await setup();
    const first = await connectedWithFile(t, fixture.length);
    fakeServices(fixture, { revs: { "/26122 spirit days/spirit intro/v2.mp4": "s1" } });
    await t.action(internal.dropbox.importFile, { fileId: first });
    await t.mutation(internal.dropbox.recordFiles, { files: [{ pathLower: "/26122 spirit days/spirit intro/v2.mp4", pathDisplay: "/26122 Spirit Days/Spirit Intro/V2.mp4", rev: "s1", size: fixture.length }] });
    const second = (await t.run((ctx) => ctx.db.query("dropFiles").withIndex("by_path", (q) => q.eq("pathLower", "/26122 spirit days/spirit intro/v2.mp4")).first()))!._id;
    await t.action(internal.dropbox.importFile, { fileId: second });
    const nums = await t.run(async (ctx) => (await ctx.db.query("versions").collect()).map((x) => [x.number, x.fileName]));
    expect(nums).toEqual([[1, "V1.mp4"], [2, "V2.mp4"]]);
  }, 30_000);

  test("settings show the connection and recent drops, never tokens", async () => {
    const { t, me } = await setup();
    await connectedWithFile(t, 10);
    const s = await me.query(api.dropbox.status, {});
    expect(s).toMatchObject({ configured: true, connected: true, email: "heston@wranglerproductions.com" });
    expect(s.recent[0]).toMatchObject({ path: "/26122 Spirit Days/Spirit Intro/V1.mp4", status: "waiting" });
    expect(JSON.stringify(s)).not.toMatch(/SECRET|refreshToken|accessToken|cursor/);
  });
});

describe("webhook", () => {
  test("answers Dropbox's check, and refuses unsigned notifications", async () => {
    const { t } = await setup();
    const g = await t.fetch("/dropbox/webhook?challenge=abc123", { method: "GET" });
    expect([g.status, await g.text(), g.headers.get("x-content-type-options")]).toEqual([200, "abc123", "nosniff"]);
    expect((await t.fetch("/dropbox/webhook", { method: "POST", body: "{}" })).status).toBe(403);
  });
});

describe("get_transcript", () => {
  test("returns lines in a range with frames and timecodes, and words when asked", async () => {
    const { t, me } = await setup();
    const projectId = await me.mutation(api.library.createProject, { name: "Spirit Days", jobNumber: "26122" });
    const videoId = await me.mutation(api.library.createVideo, { projectId, title: "Spirit Intro" });
    const { versionId } = await t.mutation(internal.library.insertVersion, { videoId, bunnyGuid: "g", fileName: "x.mp4" });
    await t.run(async (ctx) => { await ctx.db.patch(versionId, { status: "ready", fpsNum: 24000, fpsDen: 1001, frameCount: 3149 }); });
    const file = buildTranscript({ language_code: "eng", words: [
      { text: "Welcome", start: 1.0, end: 1.4, type: "word", speaker_id: "speaker_0" },
      { text: "to", start: 1.45, end: 1.55, type: "word", speaker_id: "speaker_0" },
      { text: "Spirit", start: 1.6, end: 2.0, type: "word", speaker_id: "speaker_0" },
      { text: "Days.", start: 2.05, end: 2.5, type: "word", speaker_id: "speaker_0" },
      { text: "Later", start: 60, end: 60.5, type: "word", speaker_id: "speaker_1" },
    ] }, FPS, 3149);
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([JSON.stringify(file)], { type: "application/json" }));
      await ctx.db.insert("transcripts", { versionId, status: "done", storageId, attempts: 1, updatedAt: Date.now(), wordCount: 5, segmentCount: 2 });
    });
    const { key } = await me.action(api.connector.createKey, {});
    const call = async (args: Record<string, unknown>) => {
      const r = await t.fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_transcript", arguments: args } }) });
      return (await r.json()).result;
    };
    const all = await call({ video: "spirit intro" });
    expect(all.structuredContent.segments.map((s: any) => [s.speaker, s.in_timecode, s.text])).toEqual([["Speaker 1", "01:00:00:23", "Welcome to Spirit Days."], ["Speaker 2", "01:00:59:22", "Later"]]);
    const part = await call({ video: "spirit intro", from_timecode: "01:00:00:00", to_timecode: "01:00:10:00", include_words: true });
    expect(part.structuredContent.segments).toHaveLength(1);
    expect(part.structuredContent.words.map((w: any) => [w.text, w.in_frame])).toEqual([["Welcome", 23], ["to", 34], ["Spirit", 38], ["Days.", 49]]);
    const tooWide = await call({ video: "spirit intro", include_words: true });
    expect(tooWide.structuredContent.words_note).toMatch(/2 minutes/);
    // A version with no transcript says so plainly.
    await t.run(async (ctx) => { const r = await ctx.db.query("transcripts").first(); await ctx.db.patch(r!._id, { status: "running" }); });
    expect((await call({ video: "spirit intro" })).structuredContent.note).toMatch(/still being made/);
  });
});

describe("deleting a version", () => {
  test("notes, replies and transcript go; other versions keep their numbers; shared Bunny videos and stills are kept", async () => {
    const { t, me } = await setup();
    const projectId = await me.mutation(api.library.createProject, { name: "P" });
    const videoId = await me.mutation(api.library.createVideo, { projectId, title: "V" });
    const v1 = (await t.mutation(internal.library.insertVersion, { videoId, bunnyGuid: "g1", fileName: "a.mp4" })).versionId;
    const v2 = (await t.mutation(internal.library.insertVersion, { videoId, bunnyGuid: "g2", fileName: "b.mp4" })).versionId;
    const v3 = (await t.mutation(internal.library.insertVersion, { videoId, bunnyGuid: "g2", fileName: "copy.mp4" })).versionId; // shares g2
    const n = await me.mutation(api.notes.create, { versionId: v2, kind: "frame", inFrame: 5, text: "x", still: "https://cdn.example/stills/a.jpg" });
    await me.mutation(api.notes.create, { versionId: v3, kind: "frame", inFrame: 5, text: "copy", still: "https://cdn.example/stills/a.jpg" });
    await me.mutation(api.notes.reply, { noteId: n as never, text: "r" });
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["{}"]));
      await ctx.db.insert("transcripts", { versionId: v2, status: "done", storageId, attempts: 1, updatedAt: 0 });
    });
    expect(await me.mutation(api.library.deleteVersion, { versionId: v2 })).toEqual({ deleted: 2 });
    const left = await t.run(async (ctx) => ({
      versions: (await ctx.db.query("versions").collect()).map((x) => x.number),
      notes: (await ctx.db.query("notes").collect()).map((x) => x.text),
      replies: (await ctx.db.query("replies").collect()).length,
      transcripts: (await ctx.db.query("transcripts").collect()).length,
      cleanup: (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.name.includes("cleanup")).map((s) => s.args[0]),
    }));
    expect(left).toEqual({ versions: [1, 3], notes: ["copy"], replies: 0, transcripts: 0, cleanup: [{ bunnyGuid: null, stillUrls: [] }] });
    // Deleting the last one using g2 does remove the Bunny video. Numbers carry on from the highest left, so the next one is v2.
    await me.mutation(api.library.deleteVersion, { versionId: v3 });
    const sched = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.name.includes("cleanup")).map((s) => s.args[0]));
    expect(sched[1]).toEqual({ bunnyGuid: "g2", stillUrls: ["https://cdn.example/stills/a.jpg"] });
    expect((await t.mutation(internal.library.insertVersion, { videoId, bunnyGuid: "g4", fileName: "d.mp4" })).number).toBe(2);
    void v1;
  });
});

describe("voice notes", () => {
  test("a voice note keeps its recording, words and pointing stills; deleting it removes the recording", async () => {
    const { t, me } = await setup();
    const projectId = await me.mutation(api.library.createProject, { name: "P" });
    const videoId = await me.mutation(api.library.createVideo, { projectId, title: "V" });
    const { versionId } = await t.mutation(internal.library.insertVersion, { videoId, bunnyGuid: "g", fileName: "a.mp4" });
    await t.run(async (ctx) => { await ctx.db.patch(versionId, { status: "ready", fpsNum: 24000, fpsDen: 1001, frameCount: 3149 }); });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["fake audio"], { type: "audio/webm" })));
    const voice = {
      storageId, mime: "audio/webm;codecs=opus", durationMs: 4200, language: "eng", played: true,
      words: [{ t: "Make", f: 400, s: 10, e: 200 }, { t: "this", f: 401, s: 210, e: 400 }, { t: "brighter.", f: 450, s: 2100, e: 2600 }],
      pointers: [{ word: "this", i: 1, f: 401, s: 210, still: "https://cdn.example/stills/p.jpg" }],
    };
    const noteId = await me.mutation(api.notes.create, { versionId, kind: "range", inFrame: 400, outFrame: 450, text: "Make this brighter.", voice });
    const [n] = await me.query(api.notes.forVersion, { versionId });
    expect(n.voice?.words.map((w: { t: string }) => w.t)).toEqual(["Make", "this", "brighter."]);
    expect(n.voiceUrl).toBeTypeOf("string");
    // Voice alone is enough to post.
    const s2 = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
    await me.mutation(api.notes.create, { versionId, kind: "frame", inFrame: 10, text: "", voice: { ...voice, storageId: s2, pointers: [] } });
    // The connector sees the transcript and the pointing word with its timecode and still.
    const { key } = await me.action(api.connector.createKey, {});
    const r = await t.fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_notes", arguments: { video: "V" } } }) });
    const notes = (await r.json()).result.structuredContent.notes;
    const vn = notes.find((x: { note_id: string }) => x.note_id === noteId);
    expect(vn.voice).toMatchObject({ seconds: 4.2, played_while_talking: true, said: "Make this brighter.", pointing_words: [{ word: "this", frame: 401, timecode: "01:00:16:17", has_still: true }] });
    expect(vn.has_images).toBe(true);
    // Deleting the note deletes the recording; a discarded draft's recording goes too (but not one a note uses).
    await me.mutation(api.notes.remove, { noteId });
    expect(await t.run((ctx) => ctx.db.system.get(storageId))).toBeNull();
    await me.mutation(api.notes.discardVoice, { storageId: s2 });
    expect(await t.run((ctx) => ctx.db.system.get(s2))).not.toBeNull();
    const s3 = await t.run((ctx) => ctx.storage.store(new Blob(["y"])));
    await me.mutation(api.notes.discardVoice, { storageId: s3 });
    expect(await t.run((ctx) => ctx.db.system.get(s3))).toBeNull();
  });
});
