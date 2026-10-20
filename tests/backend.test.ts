// Backend rules: only the allowed account gets in; notes keep exact frames; ranges must make sense.
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });

async function setup() {
  const t = convexTest(schema, modules);
  const heston = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston" });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    return { userId, sessionId };
  });
  const stranger = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "someone@else.com" });
    const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 });
    return { userId, sessionId };
  });
  const as = (u: { userId: string; sessionId: string }) => t.withIdentity({ subject: `${u.userId}|${u.sessionId}` });
  return { t, me: as(heston), other: as(stranger) };
}

describe("access", () => {
  test("signed-out and not-allowed people get nothing", async () => {
    const { t, other } = await setup();
    await expect(t.query(api.library.home, {})).rejects.toThrow(/Sign in/);
    await expect(other.query(api.library.home, {})).rejects.toThrow(/Not allowed/);
    const who = await other.query(api.users.me, {});
    expect(who?.allowed).toBe(false);
  });
});

describe("notes", () => {
  async function withVersion() {
    const s = await setup();
    const projectId = await s.me.mutation(api.library.createProject, { name: "Floor Trader Backrooms", jobNumber: "26127" });
    const videoId = await s.me.mutation(api.library.createVideo, { projectId, title: "Backrooms Teaser" });
    const { versionId } = await s.t.mutation(internal.library.insertVersion, { videoId, bunnyGuid: "test-guid", fileName: "teaser.mov" });
    return { ...s, videoId, versionId };
  }

  test("frame, range and whole-video notes keep exact frames", async () => {
    const { me, versionId } = await withVersion();
    await me.mutation(api.notes.create, { versionId, kind: "frame", inFrame: 100, text: "Logo too small" });
    await me.mutation(api.notes.create, { versionId, kind: "range", inFrame: 300, outFrame: 359, text: "Tighten this" });
    await me.mutation(api.notes.create, { versionId, kind: "general", inFrame: 5, text: "Music a touch loud" });
    const notes = await me.query(api.notes.forVersion, { versionId });
    expect(notes.map((n) => [n.kind, n.inFrame, n.outFrame ?? null])).toEqual([
      ["general", undefined, null],
      ["frame", 100, null],
      ["range", 300, 359],
    ]);
    expect(notes.every((n) => n.status === "open" && n.authorName === "Heston")).toBe(true);
  });

  test("bad ranges and empty notes are refused", async () => {
    const { me, versionId } = await withVersion();
    await expect(me.mutation(api.notes.create, { versionId, kind: "range", inFrame: 50, outFrame: 10, text: "x" })).rejects.toThrow(/ends before/);
    await expect(me.mutation(api.notes.create, { versionId, kind: "frame", text: "x" })).rejects.toThrow(/needs a frame/);
    await expect(me.mutation(api.notes.create, { versionId, kind: "frame", inFrame: 1.5, text: "x" })).rejects.toThrow(/needs a frame/);
    await expect(me.mutation(api.notes.create, { versionId, kind: "frame", inFrame: 3, text: "   " })).rejects.toThrow(/Write a note/);
  });

  test("done, replies and delete", async () => {
    const { me, versionId } = await withVersion();
    const id = await me.mutation(api.notes.create, { versionId, kind: "frame", inFrame: 12, text: "Color pop" });
    await me.mutation(api.notes.reply, { noteId: id, text: "Fixed in v2" });
    await me.mutation(api.notes.setStatus, { noteId: id, status: "done" });
    let [n] = await me.query(api.notes.forVersion, { versionId });
    expect(n.status).toBe("done");
    expect(n.replies.map((r) => r.text)).toEqual(["Fixed in v2"]);
    await me.mutation(api.notes.remove, { noteId: id });
    expect(await me.query(api.notes.forVersion, { versionId })).toEqual([]);
  });

  test("versions number up and the start timecode is checked", async () => {
    const { t, me, videoId, versionId } = await withVersion();
    const v2 = await t.mutation(internal.library.insertVersion, { videoId, bunnyGuid: "g2", fileName: "teaser_v2.mov" });
    expect(v2.number).toBe(2);
    await expect(me.mutation(api.library.setStartTimecode, { versionId, startTimecode: "1:00" })).rejects.toThrow(/HH:MM:SS:FF/);
    await me.mutation(api.library.setStartTimecode, { versionId, startTimecode: "00:59:58:00" });
    const vid = await me.query(api.library.video, { videoId });
    expect(vid!.versions.map((x) => [x.number, x.startTimecode])).toEqual([[1, "00:59:58:00"], [2, "01:00:00:00"]]);
  });
});
