// R2b: Approve final, account settings, and Bunny storage per version.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com,emily@example.com";
  process.env.BUNNY_STREAM_LIBRARY_ID = "1"; process.env.BUNNY_STREAM_API_KEY = "test";
});
afterEach(() => { vi.unstubAllGlobals(); });

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston" });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    const otherId = await ctx.db.insert("users", { email: "emily@example.com", name: "Emily" });
    const otherSession = await ctx.db.insert("authSessions", { userId: otherId, expirationTime: Date.now() + 3_600_000 });
    const projectId = await ctx.db.insert("projects", { name: "Harbor Coffee Launch", createdAt: Date.now() });
    const videoId = await ctx.db.insert("videos", { projectId, title: "Brand Film", number: 1, shortTitle: "BrandFilm", createdAt: 1000, updatedAt: 1000 });
    const ver: Record<number, any> = {};
    for (const n of [1, 2, 3, 4]) {
      ver[n] = await ctx.db.insert("versions", {
        videoId, number: n, status: n === 4 ? "processing" : "ready", bunnyGuid: `g${n}`, fileName: `v${n}.mp4`, startTimecode: "01:00:00:00",
        createdAt: 1000 + n, storageBytes: n * 100_000_000, ...(n === 2 ? { dropboxPath: "/P/V/v2.mp4" } : {}),
      });
    }
    const noteOn = async (n: number, text: string) => {
      const noteId = await ctx.db.insert("notes", { versionId: ver[n], videoId, kind: "frame", inFrame: 10, text, status: "open", authorName: "Heston", createdAt: Date.now(), updatedAt: Date.now() } as any);
      await ctx.db.insert("replies", { noteId, text: "ok", authorName: "Claude", createdAt: Date.now() });
      return noteId;
    };
    const n1 = await noteOn(1, "old note"), n3 = await noteOn(3, "keep me");
    await ctx.db.insert("transcripts", { versionId: ver[2], status: "done", attempts: 1, updatedAt: Date.now() });
    return { userId, sessionId, otherId, otherSession, projectId, videoId, ver, n1, n3 };
  });
  return {
    t, ...ids,
    me: t.withIdentity({ subject: `${ids.userId}|${ids.sessionId}` }),
    other: t.withIdentity({ subject: `${ids.otherId}|${ids.otherSession}` }),
  };
}

describe("approve final", () => {
  test("keeps one version and deletes everything of the others; a new version reopens it", async () => {
    const { t, me, videoId, ver, n3 } = await setup();
    await expect(me.mutation(api.library.approveFinal, { videoId, keep: 4 })).rejects.toThrow(/isn't ready/);
    await expect(me.mutation(api.library.approveFinal, { videoId, keep: 9 })).rejects.toThrow(/no v9/);
    await expect(t.mutation(api.library.approveFinal, { videoId, keep: 3 })).rejects.toThrow(/Sign in/);

    const r = await me.mutation(api.library.approveFinal, { videoId, keep: 3 });
    expect(r).toEqual({ kept: 3, deleted: [1, 2, 4], freedBytes: 700_000_000 });
    const left = await t.run(async (ctx) => ({
      versions: (await ctx.db.query("versions").collect()).map((x) => x.number),
      notes: (await ctx.db.query("notes").collect()).map((x) => x._id),
      replies: (await ctx.db.query("replies").collect()).length,
      transcripts: (await ctx.db.query("transcripts").collect()).length,
      video: await ctx.db.get(videoId),
      cleanups: (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.name.includes("stills")).length,
    }));
    expect(left.versions).toEqual([3]);
    expect(left.notes).toEqual([n3]);
    expect(left.replies).toBe(1);
    expect(left.transcripts).toBe(0);
    expect(left.video!.final).toMatchObject({ version: 3 });
    expect(left.cleanups).toBeGreaterThanOrEqual(3); // one Bunny delete per removed version
    expect(await t.run((ctx) => ctx.db.get(ver[3]))).toMatchObject({ number: 3, status: "ready" });

    const ov = await me.query(api.library.overview, {});
    expect(ov.videos[0]).toMatchObject({ final: { version: 3 }, storageBytes: 300_000_000, source: "Browser", number: 1 });
    const reg = await me.query(api.register.list, {});
    expect(reg.rows[0]).toMatchObject({ status: "Final v3", final: { version: 3 } });

    // a browser upload of a new version clears the badge
    await t.mutation(internal.library.insertVersion, { videoId, bunnyGuid: "g5", fileName: "v5.mp4" });
    expect((await t.run((ctx) => ctx.db.get(videoId)))!.final).toBeUndefined();
  });

  test("a single version just gets the badge; clearing it deletes nothing", async () => {
    const { t, me, videoId } = await setup();
    await t.run(async (ctx) => { for (const x of await ctx.db.query("versions").collect()) if (x.number !== 1) await ctx.db.delete(x._id); });
    expect(await me.mutation(api.library.approveFinal, { videoId, keep: 1 })).toEqual({ kept: 1, deleted: [], freedBytes: 0 });
    await me.mutation(api.library.clearFinal, { videoId });
    expect((await t.run((ctx) => ctx.db.get(videoId)))!.final).toBeUndefined();
    expect(await t.run(async (ctx) => (await ctx.db.query("versions").collect()).length)).toBe(1);
  });
});

describe("account settings", () => {
  test("each person has their own; only known settings are kept", async () => {
    const { me, other } = await setup();
    expect(await me.query(api.prefs.mine, {})).toEqual({});
    await me.mutation(api.prefs.set, { key: "details", value: { fields: ["number", "storage"] } });
    await me.mutation(api.prefs.set, { key: "approveFinal", value: true });
    await me.mutation(api.prefs.set, { key: "details", value: { fields: ["number", "length"] } });
    expect(await me.query(api.prefs.mine, {})).toEqual({ details: { fields: ["number", "length"] }, approveFinal: true });
    expect(await other.query(api.prefs.mine, {})).toEqual({});
    await expect(me.mutation(api.prefs.set, { key: "theme", value: "dark" })).rejects.toThrow(/Unknown setting/);
  });
});

describe("bunny storage", () => {
  test("refresh reads storageSize for ready versions that are due", async () => {
    const { t, ver } = await setup();
    await t.run(async (ctx) => { await ctx.db.patch(ver[1], { storageCheckedAt: Date.now() }); });
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      const guid = url.split("/").pop();
      return new Response(JSON.stringify({ guid, status: 4, storageSize: 42_000_000 }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const r = await t.action(internal.uploads.refreshStorage, {});
    expect(r).toEqual({ checked: 2, updated: 2, failed: 0 }); // v2 and v3 (v1 is fresh, v4 isn't ready)
    expect((await t.run((ctx) => ctx.db.get(ver[2])))!.storageBytes).toBe(42_000_000);
    expect((await t.run((ctx) => ctx.db.get(ver[1])))!.storageBytes).toBe(100_000_000);
  });
});
