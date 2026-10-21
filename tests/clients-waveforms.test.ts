// "New client" (an empty client) and the waveform rows the timeline reads.
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });

async function setup() {
  const t = convexTest(schema, modules);
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston" });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    return { userId, sessionId };
  });
  return { t, me: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}

describe("new client", () => {
  test("an empty client is listed, can't be made twice, and deletes on its own", async () => {
    const { t, me } = await setup();
    await me.mutation(api.library.createProject, { name: "Spirit Days", jobNumber: "26122", client: "ICG" });
    expect(await me.mutation(api.library.createClient, { name: "  Floor Trader " })).toBe("Floor Trader");
    expect((await me.query(api.library.overview, {})).clients).toEqual(["Floor Trader"]);
    await expect(me.mutation(api.library.createClient, { name: "floor trader" })).rejects.toThrow(/already a client/);
    await expect(me.mutation(api.library.createClient, { name: "icg" })).rejects.toThrow(/already a client/);
    await expect(me.mutation(api.library.createClient, { name: "   " })).rejects.toThrow(/name/);
    // A project filed under it doesn't remove it; deleting the client takes both.
    await me.mutation(api.library.createProject, { name: "Backrooms", client: "Floor Trader" });
    expect(await me.mutation(api.library.deleteClient, { client: "Floor Trader", typed: "Floor Trader" })).toEqual({ projects: 1, videos: 0 });
    expect((await me.query(api.library.overview, {})).clients).toEqual([]);
    // An empty one deletes too.
    await me.mutation(api.library.createClient, { name: "UTT" });
    expect(await me.mutation(api.library.deleteClient, { client: "UTT", typed: "UTT" })).toEqual({ projects: 0, videos: 0 });
    await expect(me.mutation(api.library.deleteClient, { client: "Nobody", typed: "Nobody" })).rejects.toThrow(/no client/);
    expect(await t.run(async (ctx) => (await ctx.db.query("projects").collect()).map((p) => p.name))).toEqual(["Spirit Days"]);
  });
});

describe("waveforms", () => {
  test("stored peaks come back to the page; deleting the version removes them; backfill finds the rest", async () => {
    const { t, me } = await setup();
    const { v1, v2 } = await t.run(async (ctx) => {
      const projectId = await ctx.db.insert("projects", { name: "P", createdAt: 0 });
      const videoId = await ctx.db.insert("videos", { projectId, title: "V", createdAt: 0, updatedAt: 0 });
      const mk = (n: number) => ctx.db.insert("versions", { videoId, number: n, bunnyGuid: `g${n}`, fileName: "a.mp4", status: "ready", createdAt: 0, mp4Heights: [360], startTimecode: "01:00:00:00" } as never);
      return { v1: await mk(1), v2: await mk(2) };
    });
    expect(await me.query(api.waveforms.forVersion, { versionId: v1 })).toBeNull();
    await t.mutation(internal.waveforms.begin, { versionId: v1 });
    expect((await me.query(api.waveforms.forVersion, { versionId: v1 }))?.status).toBe("running");
    const peaks = Uint8Array.from([0, 10, 255, 30]);
    await t.mutation(internal.waveforms.finish, { versionId: v1, rate: 20, seconds: 0.2, peaks: peaks.buffer });
    const w = await me.query(api.waveforms.forVersion, { versionId: v1 });
    expect(w?.status).toBe("done");
    expect([...new Uint8Array(w!.peaks!)]).toEqual([0, 10, 255, 30]);
    // Backfill schedules only the version without one.
    expect(await t.mutation(internal.waveforms.backfill, {})).toEqual({ scheduled: 1 });
    expect((await me.query(api.waveforms.forVersion, { versionId: v2 }))?.status).toBe("pending");
    await me.mutation(api.library.deleteVersion, { versionId: v1 });
    expect(await t.run(async (ctx) => (await ctx.db.query("waveforms").collect()).length)).toBe(1);
  });
});
