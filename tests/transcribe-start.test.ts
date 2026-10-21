// @vitest-environment node
// Transcripts start the moment a version is ready (no fixed 1-minute wait). While Bunny's MP4 copy isn't there yet they
// check again shortly without using up a try, and if the exact frame count isn't saved yet they count the copy's frames.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
// 49 frames at 23.976 (about 2.04 s), index at the end of the file.
const fixture = new Uint8Array(readFileSync(new URL("./fixtures/moov-end-long-audio.mp4", import.meta.url)));

beforeAll(() => { process.env.ELEVENLABS_API_KEY = "test-key"; });
afterEach(() => vi.unstubAllGlobals());

async function readyVersion(frameCount?: number) {
  const t = convexTest(schema, modules);
  const versionId = await t.run(async (ctx) => {
    const projectId = await ctx.db.insert("projects", { name: "26122 Spirit Days", createdAt: Date.now() });
    const videoId = await ctx.db.insert("videos", { projectId, title: "Spirit days intro", createdAt: Date.now(), updatedAt: Date.now() });
    return await ctx.db.insert("versions", {
      videoId, number: 1, status: "ready", bunnyGuid: "guid-1", fileName: "intro.mp4", startTimecode: "01:00:00:00",
      fpsNum: 24000, fpsDen: 1001, mp4Heights: [360, 1080], createdAt: Date.now(), readyAt: Date.now(),
      ...(frameCount ? { frameCount, frameCountFrom: "file" as const } : {}),
    });
  });
  return { t, versionId };
}

const transcriptRow = (t: ReturnType<typeof convexTest>, versionId: string) =>
  t.run(async (ctx) => ctx.db.query("transcripts").collect()).then((rows) => rows.find((r) => r.versionId === versionId)!);

describe("transcript start", () => {
  test("Bunny's MP4 copy isn't made yet: waits 15 s and checks again, without counting a try", async () => {
    const { t, versionId } = await readyVersion();
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      seen.push(url);
      return new Response("", { status: 404 });
    });
    const r = await t.action(internal.transcribe.run, { versionId, attempt: 0 });
    expect(r.result).toBe("waiting for MP4 (not made yet)");
    expect(seen).toEqual(["https://vz-3ba0610b-f90.b-cdn.net/guid-1/play_360p.mp4"]);
    const row = await transcriptRow(t, versionId);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);
    const next = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(next.filter((s) => s.name.includes("transcribe")).length).toBe(1);
    const gap = next[0].scheduledTime - Date.now();
    expect(gap).toBeGreaterThan(10_000);
    expect(gap).toBeLessThanOrEqual(15_000);
  });

  test("no exact frame count saved yet: counts the downloaded copy's frames and keeps words inside the last one", async () => {
    const { t, versionId } = await readyVersion();
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("play_360p.mp4")) return new Response(fixture, { status: 200 });
      if (url.includes("elevenlabs")) {
        return new Response(JSON.stringify({
          language_code: "eng",
          words: [
            { text: "Spirit", start: 0.5, end: 0.9, type: "word", speaker_id: "speaker_0" },
            { text: "days.", start: 1.9, end: 9.0, type: "word", speaker_id: "speaker_0" }, // runs past the end
          ],
        }), { status: 200 });
      }
      return new Response("", { status: 500 });
    });
    const r = await t.action(internal.transcribe.run, { versionId, attempt: 0 });
    expect(r.result).toBe("done: 2 words");
    const row = await transcriptRow(t, versionId);
    expect(row.status).toBe("done");
    const file = await t.run(async (ctx) => JSON.parse(await (await ctx.storage.get(row.storageId!))!.text()));
    expect(file.frameCount).toBe(49);
    expect(file.words[1][2]).toBe(48); // clamped to the last frame
  });

  test("exact frame count already saved: uses it", async () => {
    const { t, versionId } = await readyVersion(40);
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("play_360p.mp4")) return new Response(fixture, { status: 200 });
      return new Response(JSON.stringify({ words: [{ text: "end", start: 1.9, end: 9.0, type: "word" }] }), { status: 200 });
    });
    await t.action(internal.transcribe.run, { versionId, attempt: 0 });
    const row = await transcriptRow(t, versionId);
    const file = await t.run(async (ctx) => JSON.parse(await (await ctx.storage.get(row.storageId!))!.text()));
    expect(file.frameCount).toBe(40);
    expect(file.words[0][1]).toBe(39);
  });

  test("a ready version schedules its transcript straight away", async () => {
    const src = readFileSync(new URL("../convex/uploads.ts", import.meta.url), "utf8");
    expect(src).toMatch(/runAfter\(0, internal\.transcribe\.run/);
    expect(src).not.toMatch(/runAfter\(60_000, internal\.transcribe\.run/);
  });
});
