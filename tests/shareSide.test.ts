// Client side C3 (Oct 23): what a share lets someone do on a video, and what it never does. Every review-page
// function is called through a view link, a comment link, an invited client, a client from another share, an off
// link and an expired link. Then note visibility (private / shared, hidden replies), clients and guests editing only
// their own open notes, latest-only shares, and signed media links once a zone has a key.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://review.wranglerportal.com";
  process.env.BUNNY_STILLS_CDN = "wrangler-review-stills.b-cdn.net";
  process.env.BUNNY_SCRUB_CDN = "vz-scrub.b-cdn.net";
});
beforeEach(() => { delete process.env.BUNNY_STREAM_TOKEN_KEY; delete process.env.BUNNY_STILLS_TOKEN_KEY; delete process.env.BUNNY_SCRUB_TOKEN_KEY; });
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const t = convexTest(schema, modules);
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    const maya = await ctx.db.insert("users", { email: "maya@harbor.example", name: "Maya", role: "client" });
    const dan = await ctx.db.insert("users", { email: "dan@prairie.example", name: "Dan", role: "client" });
    await ctx.db.insert("invites", { email: "maya@harbor.example", createdAt: 0, acceptedAt: 0, userId: maya });
    await ctx.db.insert("invites", { email: "dan@prairie.example", createdAt: 0, acceptedAt: 0, userId: dan });
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const now = Date.now();
    const launch = await ctx.db.insert("projects", { name: "Launch", jobNumber: "26201", client: "Harbor Coffee", createdAt: now });
    const other = await ctx.db.insert("projects", { name: "Other", client: "Prairie Fitness", createdAt: now });
    const brand = await ctx.db.insert("videos", { projectId: launch, title: "Brand Film", createdAt: now, updatedAt: now });
    const v1 = await ctx.db.insert("versions", { videoId: brand, number: 1, status: "ready", bunnyGuid: "guid-1", fileName: "b1.mp4", startTimecode: "01:00:00:00", createdAt: now, frameCount: 100, mp4Heights: [360, 1080] } as never);
    const v2 = await ctx.db.insert("versions", { videoId: brand, number: 2, status: "ready", bunnyGuid: "", source: "file", storagePath: "review/x/abc/b2.mp4", fileUrl: "https://wrangler-review-stills.b-cdn.net/review/x/abc/b2.mp4", scrubGuid: "scrub-2", scrubStatus: "ready", fileName: "b2.mp4", startTimecode: "01:00:00:00", createdAt: now + 1, frameCount: 100 } as never);
    const v3 = await ctx.db.insert("versions", { videoId: brand, number: 3, status: "processing", bunnyGuid: "guid-3", fileName: "b3.mp4", startTimecode: "01:00:00:00", createdAt: now + 2 } as never);
    const otherVid = await ctx.db.insert("videos", { projectId: other, title: "Promo", createdAt: now, updatedAt: now });
    const ov = await ctx.db.insert("versions", { videoId: otherVid, number: 1, status: "ready", bunnyGuid: "guid-o", fileName: "o.mp4", startTimecode: "01:00:00:00", createdAt: now, frameCount: 10 } as never);
    // Heston's notes: one private (default), one shared; a Claude reply (hidden) and a Heston reply on the shared one.
    const priv = await ctx.db.insert("notes", { versionId: v2, videoId: brand, kind: "general", text: "private thought", status: "open", authorName: "Heston", authorId: owner, createdAt: now, updatedAt: now } as never);
    const shared = await ctx.db.insert("notes", { versionId: v2, videoId: brand, kind: "frame", inFrame: 10, text: "shared with client", status: "open", authorName: "Heston", authorId: owner, visibility: "shared", still: "https://wrangler-review-stills.b-cdn.net/stills/2026/10/a.jpg", createdAt: now, updatedAt: now } as never);
    await ctx.db.insert("replies", { noteId: shared, text: "Claude's private reply", authorName: "Claude", createdAt: now, hidden: true });
    await ctx.db.insert("replies", { noteId: shared, text: "Heston's reply", authorName: "Heston", authorId: owner, createdAt: now + 1 });
    await ctx.db.insert("transcripts", { versionId: v2, status: "done", wordCount: 3, attempts: 1, updatedAt: now });
    await ctx.db.insert("waveforms", { versionId: v2, status: "done", rate: 20, seconds: 4, peaks: new Uint8Array([1, 2, 3]).buffer, attempts: 1, updatedAt: now });
    return { owner, launch, other, brand, v1, v2, v3, otherVid, ov, priv, shared, ownerSub: await sess(owner), mayaSub: await sess(maya), danSub: await sess(dan) };
  });
  const me = t.withIdentity({ subject: ids.ownerSub });
  const maya = t.withIdentity({ subject: ids.mayaSub });
  const dan = t.withIdentity({ subject: ids.danSub });
  const base = { allVersions: true, downloads: false, emailNewVersions: false };
  const viewLink = await me.mutation(api.shares.create, { target: { kind: "project", projectId: ids.launch }, ...base, access: "view", who: "link" });
  const commentLink = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, access: "comment", who: "link" });
  const invited = await me.mutation(api.shares.create, { target: { kind: "client", client: "Harbor Coffee" }, ...base, access: "comment", who: "invited", emails: ["maya@harbor.example"] });
  const offLink = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, access: "comment", who: "link" });
  await me.mutation(api.shares.setOff, { shareId: offLink.shareId, off: true });
  const expired = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, access: "comment", who: "link", expiresAt: Date.now() + 60_000 });
  await t.run(async (ctx) => ctx.db.patch(expired.shareId, { expiresAt: Date.now() - 1 }));
  const latestOnly = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, allVersions: false, downloads: true, emailNewVersions: false, access: "comment", who: "link" });
  return { t, ids, me, maya, dan, viewLink, commentLink, invited, offLink, expired, latestOnly };
}
type S = Awaited<ReturnType<typeof setup>>;
const guest = (token: string, name = "Pat") => ({ token, guestKey: "gk-" + name, guestName: name });

describe("who may do what on a video through a share", () => {
  test("a view link: watch, transcript and waveform; no notes, never write", async () => {
    const { t, ids, viewLink } = await setup();
    const share = guest(viewLink.token);
    const vid = await t.query(api.library.video, { videoId: ids.brand, share });
    expect(vid).toMatchObject({ can: "view", viewer: { kind: "guest", name: "Pat" }, downloads: false, nextFileName: null, shortTitle: null });
    expect(vid!.versions.map((v) => v.number)).toEqual([1, 2]); // the processing v3 isn't shown
    expect(vid!.versions[0].dropboxPath).toBeNull();
    // A view link shows no notes at all (Heston, Oct 23): just the video.
    expect(await t.query(api.notes.forVersion, { versionId: ids.v2, share })).toEqual([]);
    expect(vid!.versions.find((v) => v.number === 2)!.noteCount).toBe(0);
    expect((await t.query(api.transcripts.forVersion, { versionId: ids.v2, share }))?.status).toBe("done");
    expect((await t.query(api.waveforms.forVersion, { versionId: ids.v2, share }))?.status).toBe("done");
    await t.mutation(api.player.log, { versionId: ids.v2, kind: "stall", share });
    await t.mutation(api.library.reportFrameCount, { versionId: ids.v2, frameCount: 101, share });
    await expect(t.mutation(api.notes.create, { versionId: ids.v2, kind: "general", text: "hi", share })).rejects.toThrow(/view only/);
    await expect(t.mutation(api.notes.reply, { noteId: ids.shared, text: "hi", share })).rejects.toThrow(/view only/);
    await expect(t.mutation(api.notes.voiceUploadUrl, { versionId: ids.v2, share })).rejects.toThrow(/view only/);
    // The other client's video is outside the share.
    await expect(t.query(api.library.video, { videoId: ids.otherVid, share })).rejects.toThrow(/Not allowed/);
    await expect(t.query(api.notes.forVersion, { versionId: ids.ov, share })).rejects.toThrow(/Not allowed/);
    // Owner-only things stay owner-only even with a share in hand.
    await expect(t.mutation(api.notes.setStatus, { noteId: ids.shared, status: "done" })).rejects.toThrow(/Sign in first/);
    await expect(t.mutation(api.notes.setVisibility, { noteId: ids.shared, visibility: "private" })).rejects.toThrow(/Sign in first/);
    await expect(t.query(api.library.overview, {})).rejects.toThrow(/Sign in first/);
  });

  test("a comment link: shared notes and visible replies, never the private ones", async () => {
    const { t, ids, commentLink } = await setup();
    const share = guest(commentLink.token);
    const notes = await t.query(api.notes.forVersion, { versionId: ids.v2, share });
    expect(notes.map((n) => n.text)).toEqual(["shared with client"]);
    expect(notes[0].replies.map((r) => r.text)).toEqual(["Heston's reply"]); // Claude's hidden reply stays hidden
    expect(notes[0].mine).toBe(false);
  });

  test("a comment link: a guest with a name leaves, edits and deletes their own open notes; not others'", async () => {
    const { t, ids, me, commentLink } = await setup();
    const share = guest(commentLink.token);
    await expect(t.mutation(api.notes.create, { versionId: ids.v2, kind: "general", text: "no name", share: { token: commentLink.token } })).rejects.toThrow(/Add your name/);
    const noteId = await t.mutation(api.notes.create, { versionId: ids.v2, kind: "frame", inFrame: 5, text: "guest note", share });
    const notes = await t.query(api.notes.forVersion, { versionId: ids.v2, share });
    const mine = notes.find((n) => n._id === noteId)!;
    expect(mine).toMatchObject({ authorName: "Pat (guest)", visibility: "shared", mine: true });
    await t.mutation(api.notes.editText, { noteId, text: "guest note, edited", share });
    await t.mutation(api.notes.reply, { noteId: ids.shared, text: "guest reply", share });
    // Another guest (another browser) can see it but can't change it.
    const other = guest(commentLink.token, "Sam");
    expect((await t.query(api.notes.forVersion, { versionId: ids.v2, share: other })).find((n) => n._id === noteId)!.mine).toBe(false);
    await expect(t.mutation(api.notes.editText, { noteId, text: "x", share: other })).rejects.toThrow(/own notes/);
    await expect(t.mutation(api.notes.remove, { noteId, share: other })).rejects.toThrow(/own notes/);
    await expect(t.mutation(api.notes.editText, { noteId: ids.shared, text: "x", share })).rejects.toThrow(/own notes/);
    await expect(t.mutation(api.notes.editText, { noteId: ids.priv, text: "x", share })).rejects.toThrow(/Not allowed/); // can't even see it
    // Once Heston marks it done, the guest can't change or delete it; Heston sees everything, incl. share activity.
    await me.mutation(api.notes.setStatus, { noteId, status: "done" });
    await expect(t.mutation(api.notes.editText, { noteId, text: "x", share })).rejects.toThrow(/marked done/);
    await expect(t.mutation(api.notes.remove, { noteId, share })).rejects.toThrow(/marked done/);
    const owner = await me.query(api.notes.forVersion, { versionId: ids.v2 });
    expect(owner.map((n) => n.text).sort()).toEqual(["guest note, edited", "private thought", "shared with client"]);
    expect(owner.find((n) => n._id === ids.shared)!.replies.map((r) => r.text)).toEqual(["Claude's private reply", "Heston's reply", "guest reply"]);
    const act = await me.query(api.shares.activity, { shareId: commentLink.shareId });
    expect(act.map((a) => [a.kind, a.who])).toEqual([["note", "Pat (guest)"]]);
    // A guest who still owns an open note can delete it.
    const n2 = await t.mutation(api.notes.create, { versionId: ids.v2, kind: "general", text: "oops", share });
    await t.mutation(api.notes.remove, { noteId: n2, share });
    expect((await me.query(api.notes.forVersion, { versionId: ids.v2 })).some((n) => n._id === n2)).toBe(false);
  });

  test("an invited share: the member comments as themselves; another client and a signed-out visitor are refused", async () => {
    const { t, ids, maya, dan, invited } = await setup();
    const share = { token: invited.token };
    const vid = await maya.query(api.library.video, { videoId: ids.brand, share });
    expect(vid).toMatchObject({ can: "comment", viewer: { kind: "client", name: "Maya" } });
    const noteId = await maya.mutation(api.notes.create, { versionId: ids.v2, kind: "general", text: "maya's note", share });
    const n = (await maya.query(api.notes.forVersion, { versionId: ids.v2, share })).find((x) => x._id === noteId)!;
    expect(n).toMatchObject({ authorName: "Maya", mine: true, visibility: "shared" });
    await expect(dan.query(api.library.video, { videoId: ids.brand, share })).rejects.toThrow(/Not allowed/);
    await expect(t.query(api.library.video, { videoId: ids.brand, share })).rejects.toThrow(/Sign in first/);
    await expect(dan.mutation(api.notes.editText, { noteId, text: "x", share })).rejects.toThrow(/Not allowed/);
    // Maya's "Shared with me" lists it.
    const mine = await maya.query(api.shares.mine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ label: "Harbor Coffee", access: "comment" });
    expect(mine[0].videos.map((v) => [v.title, v.latest, v.versions])).toEqual([["Brand Film", 2, 2]]);
    expect(await dan.query(api.shares.mine, {})).toEqual([]);
  });

  test("off and expired links refuse everything; so does a missing share argument", async () => {
    const { t, ids, offLink, expired } = await setup();
    for (const tok of [offLink.token, expired.token, "nope"]) {
      const share = guest(tok);
      await expect(t.query(api.library.video, { videoId: ids.brand, share })).rejects.toThrow(/Not allowed/);
      await expect(t.query(api.notes.forVersion, { versionId: ids.v2, share })).rejects.toThrow(/Not allowed/);
      await expect(t.mutation(api.notes.create, { versionId: ids.v2, kind: "general", text: "x", share })).rejects.toThrow(/Not allowed/);
      await expect(t.query(api.transcripts.forVersion, { versionId: ids.v2, share })).rejects.toThrow(/Not allowed/);
    }
    await expect(t.query(api.library.video, { videoId: ids.brand })).rejects.toThrow(/Sign in first/);
  });

  test("latest only: the earlier version is invisible through that share, and downloads follow the share", async () => {
    const { t, ids, latestOnly } = await setup();
    const share = guest(latestOnly.token);
    const vid = await t.query(api.library.video, { videoId: ids.brand, share });
    expect(vid!.versions.map((v) => v.number)).toEqual([2]);
    expect(vid!.downloads).toBe(true);
    await expect(t.query(api.notes.forVersion, { versionId: ids.v1, share })).rejects.toThrow(/Not allowed/);
    await expect(t.mutation(api.notes.create, { versionId: ids.v1, kind: "general", text: "x", share })).rejects.toThrow(/Not allowed/);
    expect(await t.query(api.notes.forVersion, { versionId: ids.v2, share })).toHaveLength(1);
  });

  test("the owner's Shared switch and hidden replies", async () => {
    const { t, ids, me, commentLink } = await setup();
    const share = guest(commentLink.token);
    await me.mutation(api.notes.setVisibility, { noteId: ids.priv, visibility: "shared" });
    expect((await t.query(api.notes.forVersion, { versionId: ids.v2, share })).map((n) => n.text).sort()).toEqual(["private thought", "shared with client"]);
    await me.mutation(api.notes.setVisibility, { noteId: ids.shared, visibility: "private" });
    expect((await t.query(api.notes.forVersion, { versionId: ids.v2, share })).map((n) => n.text)).toEqual(["private thought"]);
    const claude = (await me.query(api.notes.forVersion, { versionId: ids.v2 })).find((n) => n._id === ids.shared)!.replies.find((r) => r.authorName === "Claude")!;
    await me.mutation(api.notes.setVisibility, { noteId: ids.shared, visibility: "shared" });
    await me.mutation(api.notes.setReplyHidden, { replyId: claude._id, hidden: false });
    expect((await t.query(api.notes.forVersion, { versionId: ids.v2, share })).find((n) => n._id === ids.shared)!.replies.map((r) => r.text)).toEqual(["Claude's private reply", "Heston's reply"]);
    // A note Heston leaves with the note-box switch on is shared from the start; without it, private.
    const a = await me.mutation(api.notes.create, { versionId: ids.v2, kind: "general", text: "for the client", shared: true });
    const b = await me.mutation(api.notes.create, { versionId: ids.v2, kind: "general", text: "for me" });
    const seen = (await t.query(api.notes.forVersion, { versionId: ids.v2, share })).map((n) => n._id);
    expect(seen).toContain(a); expect(seen).not.toContain(b);
  });
});

describe("signed media", () => {
  test("without keys the links are plain; with keys every link to that zone carries a token and the owner's side too", async () => {
    const { t, ids, me, commentLink, viewLink } = await setup();
    const share = guest(commentLink.token);
    const plain = await t.query(api.library.video, { videoId: ids.brand, share });
    const v1 = plain!.versions.find((v) => v.number === 1)!, v2 = plain!.versions.find((v) => v.number === 2)!;
    expect(v1.media.hls).toBe("https://vz-3ba0610b-f90.b-cdn.net/guid-1/playlist.m3u8");
    expect(v1.media.mp4[1080]).toBe("https://vz-3ba0610b-f90.b-cdn.net/guid-1/play_1080p.mp4");
    expect(v2.media.file).toBe("https://wrangler-review-stills.b-cdn.net/review/x/abc/b2.mp4");
    expect(v2.media.scrub?.hls).toBe("https://vz-scrub.b-cdn.net/scrub-2/playlist.m3u8");
    const n = (await t.query(api.notes.forVersion, { versionId: ids.v2, share }))[0];
    expect(n.still).toBe("https://wrangler-review-stills.b-cdn.net/stills/2026/10/a.jpg");

    process.env.BUNNY_STREAM_TOKEN_KEY = "stream-key";
    process.env.BUNNY_STILLS_TOKEN_KEY = "stills-key";
    process.env.BUNNY_SCRUB_TOKEN_KEY = "scrub-key";
    const signed = await me.query(api.library.video, { videoId: ids.brand });
    const s1 = signed!.versions.find((v) => v.number === 1)!, s2 = signed!.versions.find((v) => v.number === 2)!;
    expect(s1.media.hls).toMatch(/^https:\/\/vz-3ba0610b-f90\.b-cdn\.net\/bcdn_token=HS256-[\w-]+&token_path=%2Fguid-1%2F&expires=\d+\/guid-1\/playlist\.m3u8$/);
    expect(s1.media.mp4[360]).toMatch(/\/guid-1\/play_360p\.mp4\?token=HS256-[\w-]+&token_path=%2Fguid-1%2F&expires=\d+$/);
    expect(s1.media.thumb).toMatch(/\/guid-1\/thumbnail\.jpg\?token=/);
    expect(s2.media.file).toMatch(/\/review\/x\/abc\/b2\.mp4\?token=HS256-[\w-]+&token_path=%2Freview%2Fx%2Fabc%2F&expires=\d+$/);
    expect(s2.media.scrub?.hls).toMatch(/^https:\/\/vz-scrub\.b-cdn\.net\/bcdn_token=/);
    expect(s2.media.scrub?.mp4).toMatch(/play_360p\.mp4\?token=/);
    expect(s2.fileUrl).toBe(s2.media.file);
    expect(s2.thumbUrl).toMatch(/scrub-2\/thumbnail\.jpg\?token=/);
    const sn = (await me.query(api.notes.forVersion, { versionId: ids.v2 })).find((x) => x._id === ids.shared)!;
    expect(sn.still).toMatch(/^https:\/\/wrangler-review-stills\.b-cdn\.net\/stills\/2026\/10\/a\.jpg\?token=HS256-[\w-]+&expires=\d+$/);
    // Same URL on a second read (the expiry is rounded), so a re-run query doesn't reload the player.
    const again = await me.query(api.library.video, { videoId: ids.brand });
    expect(again!.versions.find((v) => v.number === 1)!.media.hls).toBe(s1.media.hls);
    // The overview and the activity feed sign thumbnails too; the share's open list as well.
    expect((await me.query(api.library.overview, {})).videos.find((v) => v._id === ids.brand)!.latest!.thumbUrl).toMatch(/\?token=/);
    expect((await t.query(api.shares.open, { token: viewLink.token }) as { videos: Array<{ versions: Array<{ thumbUrl: string | null }> }> }).videos[0].versions[0].thumbUrl).toMatch(/\?token=/);
  });
});
