// Playback problem log and the "file failed" mark (Oct 21): owner-only, capped, and the mark reaches every device.
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston" });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    const strangerId = await ctx.db.insert("users", { email: "someone@else.com" });
    const strangerSession = await ctx.db.insert("authSessions", { userId: strangerId, expirationTime: Date.now() + 3_600_000 });
    const projectId = await ctx.db.insert("projects", { name: "4MLC", createdAt: Date.now() });
    const videoId = await ctx.db.insert("videos", { projectId, title: "4MLC_26", createdAt: Date.now(), updatedAt: Date.now() });
    const versionId = await ctx.db.insert("versions", { videoId, number: 1, status: "ready", bunnyGuid: "g1", fileName: "a.mp4", startTimecode: "01:00:00:00", mp4Heights: [360, 1080], createdAt: Date.now() });
    return { userId, sessionId, strangerId, strangerSession, versionId, videoId };
  });
  return {
    t, ...ids,
    me: t.withIdentity({ subject: `${ids.userId}|${ids.sessionId}` }),
    stranger: t.withIdentity({ subject: `${ids.strangerId}|${ids.strangerSession}` }),
  };
}

describe("playback log", () => {
  test("logs for the owner only, caps an hour at 300, and the CI view has no names", async () => {
    const { t, me, stranger, versionId } = await setup();
    await me.mutation(api.player.log, { versionId, kind: "error", code: 3, msg: "PIPELINE_ERROR_DECODE".repeat(40), t: 13.5466, src: "file", ua: "UA" });
    await expect(stranger.mutation(api.player.log, { versionId, kind: "error" })).rejects.toThrow(/Not allowed/);
    await expect(t.mutation(api.player.log, { versionId, kind: "error" })).rejects.toThrow(/Sign in/);
    const rows = await t.query(internal.player.recent, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "error", code: 3, t: 13.55, src: "file", ua: "UA", version: versionId.slice(-6) });
    expect(rows[0].msg!.length).toBe(300);
    for (let i = 0; i < 305; i++) await me.mutation(api.player.log, { versionId, kind: "stall" });
    expect(await t.run(async (ctx) => (await ctx.db.query("playerLogs").collect()).length)).toBe(301);
  });

  test("a failed 1080p file marks the version for every device, owner only", async () => {
    const { me, stranger, versionId, videoId } = await setup();
    await expect(stranger.mutation(api.player.fileFailed, { versionId })).rejects.toThrow(/Not allowed/);
    expect((await me.query(api.library.video, { videoId })).versions[0].streamOnly).toBe(false);
    await me.mutation(api.player.fileFailed, { versionId });
    expect((await me.query(api.library.video, { videoId })).versions[0].streamOnly).toBe(true);
  });
});
