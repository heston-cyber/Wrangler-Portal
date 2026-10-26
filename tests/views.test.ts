// C9 (Oct 26): views. The player's heartbeat makes one row per sitting; the owner sees counts and how far each
// person got; a share's activity list says what was watched. Owners' own sittings never count.
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; process.env.RESEND_API_KEY = "re_test"; });

async function setup() {
  const t = convexTest(schema, modules);
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    const client = await ctx.db.insert("users", { email: "c@example.com", name: "Casey", role: "client" });
    await ctx.db.insert("invites", { email: "c@example.com", createdAt: 0, acceptedAt: 0, userId: client });
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", { name: "Safety", client: "Cedar Gate", createdAt: now });
    const videoId = await ctx.db.insert("videos", { projectId, title: "CG Safety Video", createdAt: now, updatedAt: now });
    const v1 = await ctx.db.insert("versions", { videoId, number: 1, status: "ready", bunnyGuid: "g1", fileName: "a1.mp4", startTimecode: "01:00:00:00", createdAt: now, mp4Heights: [1080] } as never);
    const v2 = await ctx.db.insert("versions", { videoId, number: 2, status: "ready", bunnyGuid: "g2", fileName: "a2.mp4", startTimecode: "01:00:00:00", createdAt: now + 1, mp4Heights: [1080] } as never);
    return { videoId, v1, v2, ownerSub: await sess(owner), clientSub: await sess(client) };
  });
  const me = t.withIdentity({ subject: ids.ownerSub });
  const client = t.withIdentity({ subject: ids.clientSub });
  const base = { allVersions: true, downloads: false, emailNewVersions: false };
  const link = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.videoId }, ...base, access: "comment", who: "link" });
  const view = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.videoId }, ...base, access: "view", who: "link" });
  const latestOnly = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.videoId }, ...base, allVersions: false, access: "comment", who: "link" });
  const invited = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.videoId }, ...base, access: "comment", who: "invited", emails: ["c@example.com"] });
  const pat = { token: link.token, guestKey: "gk-pat", guestName: "Pat" };
  return { t, me, client, ids, link, view, latestOnly, invited, pat };
}
const S = "sess0000000000001";

describe("the heartbeat", () => {
  test("a guest's beats make one sitting that grows; near the end counts as watched to the end", async () => {
    const { t, me, ids, pat } = await setup();
    await t.mutation(api.views.beat, { versionId: ids.v2, session: S, watchedSec: 10, posSec: 10, lengthSec: 171, share: pat });
    await t.mutation(api.views.beat, { versionId: ids.v2, session: S, watchedSec: 9.5, posSec: 48, lengthSec: 171, share: pat });
    let d = await me.query(api.views.forVideo, { videoId: ids.videoId });
    expect(d).toMatchObject({ views: 1, people: 1, completed: 0, last: { who: "Pat (guest)" } });
    expect(d.rows[0]).toMatchObject({ who: "Pat (guest)", kind: "guest", version: 2, watchedSec: 20, maxSec: 48, lengthSec: 171, completed: false });
    // Jumped back and watched some more, then reached the end.
    await t.mutation(api.views.beat, { versionId: ids.v2, session: S, watchedSec: 5, posSec: 20, lengthSec: 171, share: pat });
    await t.mutation(api.views.beat, { versionId: ids.v2, session: S, watchedSec: 120, posSec: 169, lengthSec: 171, share: pat });
    d = await me.query(api.views.forVideo, { videoId: ids.videoId });
    expect(d.rows[0]).toMatchObject({ watchedSec: 145, maxSec: 169, completed: true });
    expect(d.completed).toBe(1);
    expect(d.byVersion).toEqual({ 1: { views: 0, people: 0 }, 2: { views: 1, people: 1 } });
  });

  test("a new session is a new sitting; the same person twice is one person", async () => {
    const { t, me, ids, pat } = await setup();
    await t.mutation(api.views.beat, { versionId: ids.v2, session: S, watchedSec: 3, posSec: 3, lengthSec: 171, share: pat });
    await t.mutation(api.views.beat, { versionId: ids.v1, session: "sess0000000000002", watchedSec: 3, posSec: 3, lengthSec: 171, share: pat });
    const d = await me.query(api.views.forVideo, { videoId: ids.videoId });
    expect(d).toMatchObject({ views: 2, people: 1 });
    expect(d.rows.map((r) => r.version)).toEqual([1, 2]); // newest first
  });

  test("the owner's own sittings are stored but never counted; only the owner may read the counts", async () => {
    const { t, me, client, ids, pat } = await setup();
    await me.mutation(api.views.beat, { versionId: ids.v2, session: S, watchedSec: 30, posSec: 30, lengthSec: 171 });
    expect(await me.query(api.views.forVideo, { videoId: ids.videoId })).toMatchObject({ views: 0, people: 0, last: null });
    await expect(client.query(api.views.forVideo, { videoId: ids.videoId })).rejects.toThrow(/Not allowed/);
    await expect(t.query(api.views.forVideo, { videoId: ids.videoId })).rejects.toThrow(/Sign in first/);
    void pat;
  });

  test("a view-only link may report; an invited client reports as a client; no share means no beat", async () => {
    const { t, me, client, ids, view, invited } = await setup();
    await t.mutation(api.views.beat, { versionId: ids.v2, session: S, watchedSec: 2, posSec: 2, lengthSec: 171, share: { token: view.token, guestKey: "gk-v", guestName: "Viewer" } });
    await client.mutation(api.views.beat, { versionId: ids.v2, session: "sess0000000000003", watchedSec: 2, posSec: 2, lengthSec: 171, share: { token: invited.token } });
    const d = await me.query(api.views.forVideo, { videoId: ids.videoId });
    expect(d.rows.map((r) => [r.who, r.kind]).sort()).toEqual([["Casey", "client"], ["Viewer (guest)", "guest"]]);
    await expect(t.mutation(api.views.beat, { versionId: ids.v2, session: S, watchedSec: 2, posSec: 2, lengthSec: 171 })).rejects.toThrow(/Sign in first/);
    await expect(client.mutation(api.views.beat, { versionId: ids.v2, session: S, watchedSec: 2, posSec: 2, lengthSec: 171 })).rejects.toThrow(/Not allowed/);
  });

  test("a version the share doesn't show can't be reported on; bad sessions are refused; one beat caps at two minutes", async () => {
    const { t, me, ids, latestOnly } = await setup();
    const share = { token: latestOnly.token, guestKey: "gk-l", guestName: "Lee" };
    await expect(t.mutation(api.views.beat, { versionId: ids.v1, session: S, watchedSec: 2, posSec: 2, lengthSec: 171, share })).rejects.toThrow(/Not allowed/);
    await expect(t.mutation(api.views.beat, { versionId: ids.v2, session: "x", watchedSec: 2, posSec: 2, lengthSec: 171, share })).rejects.toThrow(/Bad session/);
    await t.mutation(api.views.beat, { versionId: ids.v2, session: S, watchedSec: 9999, posSec: 2, lengthSec: 171, share });
    expect((await me.query(api.views.forVideo, { videoId: ids.videoId })).rows[0].watchedSec).toBe(120);
  });

  test("the share's activity list says what was watched", async () => {
    const { t, me, ids, link, pat } = await setup();
    await t.mutation(api.shares.touch, { token: link.token, kind: "opened", guestName: "Pat", guestKey: "gk-pat" });
    await t.mutation(api.views.beat, { versionId: ids.v2, session: S, watchedSec: 40, posSec: 48, lengthSec: 171, share: pat });
    const rows = await me.query(api.shares.activity, { shareId: link.shareId });
    const watched = rows.find((r) => r.kind === "watched");
    expect(watched).toMatchObject({ who: "Pat (guest)", videoTitle: "CG Safety Video", watch: { version: 2, watchedSec: 40, maxSec: 48, lengthSec: 171, completed: false } });
    expect(rows.some((r) => r.kind === "opened")).toBe(true);
  });
});
