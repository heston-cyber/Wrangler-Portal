// C8 (Oct 26): link previews. What /og/s/<token> says for each kind of link, and who may set a version's poster.
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://review.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  process.env.BUNNY_STILLS_CDN = "wrangler-review-stills.b-cdn.net";
});

async function setup() {
  const t = convexTest(schema, modules);
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    const client = await ctx.db.insert("users", { email: "c@example.com", name: "Casey", role: "client" });
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", { name: "Safety", jobNumber: "26300", client: "Cedar Gate", createdAt: now });
    const a = await ctx.db.insert("videos", { projectId, title: "CG Safety Video", createdAt: now, updatedAt: now });
    const b = await ctx.db.insert("videos", { projectId, title: "Second Cut", createdAt: now, updatedAt: now + 1 });
    const av1 = await ctx.db.insert("versions", { videoId: a, number: 1, status: "ready", bunnyGuid: "guid-a1", fileName: "a1.mp4", startTimecode: "01:00:00:00", createdAt: now, mp4Heights: [1080] } as never);
    const av2 = await ctx.db.insert("versions", { videoId: a, number: 2, status: "ready", bunnyGuid: "guid-a2", fileName: "a2.mp4", startTimecode: "01:00:00:00", createdAt: now + 1, mp4Heights: [1080], posterUrl: "https://wrangler-review-stills.b-cdn.net/stills/2026/10/poster-a2.jpg" } as never);
    await ctx.db.insert("versions", { videoId: a, number: 3, status: "processing", bunnyGuid: "guid-a3", fileName: "a3.mp4", startTimecode: "01:00:00:00", createdAt: now + 2 } as never);
    await ctx.db.insert("versions", { videoId: b, number: 1, status: "ready", bunnyGuid: "guid-b1", fileName: "b1.mp4", startTimecode: "01:00:00:00", createdAt: now } as never);
    return { projectId, a, b, av1, av2, ownerSub: await sess(owner), clientSub: await sess(client) };
  });
  const me = t.withIdentity({ subject: ids.ownerSub });
  const base = { allVersions: true, downloads: true, emailNewVersions: false };
  const open = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.a }, ...base, access: "comment", who: "link" });
  const project = await me.mutation(api.shares.create, { target: { kind: "project", projectId: ids.projectId }, ...base, access: "view", who: "link" });
  const pass = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.a }, ...base, access: "comment", who: "link", passcode: "coffeecup" });
  const invited = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.a }, ...base, access: "comment", who: "invited", emails: ["c@example.com"] });
  const off = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.a }, ...base, access: "comment", who: "link" });
  await me.mutation(api.shares.setOff, { shareId: off.shareId, off: true });
  const og = (token: string, videoId?: string) => t.query(internal.og.forShare, { token, videoId });
  return { t, me, ids, og, open, project, pass, invited, off, client: t.withIdentity({ subject: ids.clientSub }) };
}

describe("what a link preview says", () => {
  test("an open video link: the title, and the latest ready version's poster as the picture", async () => {
    const { og, open } = await setup();
    const d = await og(open.token);
    expect(d).toMatchObject({ state: "ok", title: "CG Safety Video", siteName: "Wrangler Review", imageIsFrame: true, url: `https://review.wranglerportal.com/s/${open.token}` });
    expect(d.image).toBe(`https://example.convex.site/og/s/${open.token}/image.jpg`); // proxied, never the signed link
    expect(d.frameUrl).toMatch(/^https:\/\/wrangler-review-stills\.b-cdn\.net\/stills\/2026\/10\/poster-a2\.jpg/); // v2's poster, not v3 (processing)
  });

  test("a project link: the project's label and a count; a video inside it by ?v=", async () => {
    const { og, project, ids } = await setup();
    const d = await og(project.token);
    expect(d.title).toBe("26300 Safety");
    expect(d.description).toBe("2 videos to review from Wrangler Productions.");
    expect(d.imageIsFrame).toBe(true); // the most recently updated video's picture
    const one = await og(project.token, ids.a);
    expect(one.title).toBe("CG Safety Video");
    expect(one.url).toBe(`https://review.wranglerportal.com/s/${project.token}/v/${ids.a}`);
    expect(one.image).toContain(`?v=${ids.a}`);
  });

  test("a passcode or invited link: the title, but the generic card instead of a frame", async () => {
    const { og, pass, invited } = await setup();
    for (const s of [pass, invited]) {
      const d = await og(s.token);
      expect(d).toMatchObject({ state: "ok", title: "CG Safety Video", imageIsFrame: false, image: "https://review.wranglerportal.com/brand/og-default.png", frameUrl: null });
    }
  });

  test("off, expired and unknown links: the generic card and no title", async () => {
    const { t, og, off, open } = await setup();
    expect(await og(off.token)).toMatchObject({ state: "off", title: "Wrangler Review", imageIsFrame: false });
    await t.run(async (ctx) => ctx.db.patch(open.shareId, { expiresAt: Date.now() - 1 }));
    expect(await og(open.token)).toMatchObject({ state: "expired", title: "Wrangler Review" });
    expect(await og("nottherexxxxxxxx")).toMatchObject({ state: "missing", title: "Wrangler Review" });
  });

  test("without a poster the picture falls back to Bunny's thumbnail", async () => {
    const { t, og, open, ids } = await setup();
    await t.run(async (ctx) => ctx.db.patch(ids.av2, { posterUrl: undefined }));
    const d = await og(open.token);
    expect(d.imageIsFrame).toBe(true);
    expect(d.frameUrl).toContain("/guid-a2/thumbnail.jpg");
  });
});

describe("setting a version's poster", () => {
  test("the owner may, with one of our stills; a client may not; outside pictures are refused", async () => {
    const { t, me, client, ids } = await setup();
    const ok = "https://wrangler-review-stills.b-cdn.net/stills/2026/10/new.jpg";
    await me.mutation(api.library.setPoster, { versionId: ids.av1, url: ok });
    expect((await t.run((ctx) => ctx.db.get(ids.av1)))?.posterUrl).toBe(ok);
    await expect(me.mutation(api.library.setPoster, { versionId: ids.av1, url: "https://evil.example/x.jpg" })).rejects.toThrow(/isn't one of ours/);
    await expect(client.mutation(api.library.setPoster, { versionId: ids.av1, url: ok })).rejects.toThrow(/Not allowed/);
    // The video page tells the owner which versions still need one.
    const v = await me.query(api.library.video, { videoId: ids.a });
    expect(v!.versions.map((x) => [x.number, x.needsPoster])).toEqual([[1, false], [2, false], [3, false]]); // v3 isn't ready yet
  });
});
