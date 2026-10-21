// @vitest-environment node
// Oct 21 measurement ("option 2"): each check while Bunny converts logs what changed, and an MP4 copy is only asked
// for once Bunny lists that size (and not again once it has answered).
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => { process.env.BUNNY_STREAM_LIBRARY_ID = "1"; process.env.BUNNY_STREAM_API_KEY = "test"; });
afterEach(() => vi.unstubAllGlobals());

describe("converting stages", () => {
  test("logs only changes, checks MP4s only once listed, and reports seconds from the first check", async () => {
    const t = convexTest(schema, modules);
    const versionId = await t.run(async (ctx) => {
      const projectId = await ctx.db.insert("projects", { name: "Tests", createdAt: Date.now() });
      const videoId = await ctx.db.insert("videos", { projectId, title: "Stage test", createdAt: Date.now(), updatedAt: Date.now() });
      return await ctx.db.insert("versions", { videoId, number: 1, status: "processing", bunnyGuid: "g1", fileName: "a.mp4", startTimecode: "01:00:00:00", pollCount: 0, createdAt: Date.now() });
    });
    let bunny = { status: 2, encodeProgress: 40, availableResolutions: "360p" };
    const live = new Set<number>();
    const heads: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://video.bunnycdn.com/library/1/videos/g1")) {
        return new Response(JSON.stringify({ guid: "g1", title: "a", framerate: 23.976, width: 1920, height: 1080, length: 120, hasMP4Fallback: true, ...bunny }), { status: 200 });
      }
      if (init?.method === "HEAD") {
        heads.push(url.split("/").pop()!);
        const h = Number(/play_(\d+)p/.exec(url)?.[1]);
        return new Response(null, { status: live.has(h) ? 200 : 404 });
      }
      return new Response("", { status: 404 });
    });
    const poll = () => t.action(internal.uploads.poll, { versionId });

    await poll();                                            // 360p listed, its MP4 not there yet
    await poll();                                            // nothing changed: no new entry
    live.add(360); bunny = { ...bunny, encodeProgress: 70 };
    await poll();                                            // 360p MP4 answers
    live.add(1080); bunny = { status: 3, encodeProgress: 100, availableResolutions: "360p,1080p" };
    await poll();                                            // ready, 1080p MP4 answers

    const ver = await t.run(async (ctx) => ctx.db.get(versionId));
    expect(ver!.status).toBe("ready");
    expect(ver!.stages!.map((s) => [s.s, s.p, s.res, s.mp4])).toEqual([
      [2, 40, "360p", []],
      [2, 70, "360p", [360]],
      [3, 100, "360p,1080p", [360, 1080]],
    ]);
    // 360p asked for on checks 1–3, then not again once it answered; 1080p only once listed.
    expect(heads.filter((h) => h === "play_360p.mp4").length).toBe(3);
    expect(heads.filter((h) => h === "play_1080p.mp4").length).toBe(1);

    const rows = await t.query(internal.uploads.stageTimes, {});
    expect(rows[0].stages.length).toBe(3);
    expect(rows[0].stages[0][0]).toBe(0);
    expect(rows[0].stages[2].slice(1)).toEqual([3, 100, "360p,1080p", "360/1080"]);
    expect(rows[0].readySec).not.toBeNull();

    // After ready, a follow-up check is scheduled; once everything listed answers and Bunny says finished, it stops.
    await t.action(internal.uploads.stageCheck, { versionId, attempt: 0 });
    const followUps = await t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.name.includes("stageCheck") && s.state.kind === "pending"));
    expect(followUps.length).toBe(1); // only the one poll scheduled at ready; the manual check didn't add another
  });
});
