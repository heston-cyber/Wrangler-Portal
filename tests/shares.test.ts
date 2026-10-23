// Client side C2 (Oct 23): shares. Every combination of what's shared (client / project / video), access (view /
// comment) and who (anyone with the link / invited emails) shows exactly what it should and nothing more; a video
// added later under a shared client or project is covered; switching a share off, an expiry date and a passcode
// refuse at once; the invite email goes out with the link; the owner's list and activity are right.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://review.wranglerportal.com";
});
afterEach(() => vi.unstubAllGlobals());

type Mail = { to: string; subject: string; text: string };
function stubResend(mails: Mail[]) {
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
    return new Response("{}", { status: 500 });
  });
}

// Two clients, three projects, five videos. Harbor Coffee: Launch (Brand Film v1+v2 ready, Teaser v1 ready, Empty: no
// versions), Harbor Coffee: Holiday (Spot v1 ready). Prairie Fitness: Promo (Promo v1 ready).
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    const maya = await ctx.db.insert("users", { email: "maya@harbor.example", name: "Maya", role: "client" });
    const dan = await ctx.db.insert("users", { email: "dan@prairie.example", name: "Dan", role: "client" });
    const stranger = await ctx.db.insert("users", { email: "who@example.com", name: "Who" });
    await ctx.db.insert("invites", { email: "maya@harbor.example", createdAt: 0, acceptedAt: 0, userId: maya });
    await ctx.db.insert("invites", { email: "dan@prairie.example", createdAt: 0, acceptedAt: 0, userId: dan });
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const now = Date.now();
    const launch = await ctx.db.insert("projects", { name: "Harbor Coffee Launch", jobNumber: "26201", client: "Harbor Coffee", createdAt: now });
    const holiday = await ctx.db.insert("projects", { name: "Holiday", client: "Harbor Coffee", createdAt: now });
    const promo = await ctx.db.insert("projects", { name: "Promo", client: "Prairie Fitness", createdAt: now });
    const video = async (projectId: Id<"projects">, title: string, versions: number[]) => {
      const id = await ctx.db.insert("videos", { projectId, title, createdAt: now, updatedAt: now });
      for (const n of versions) await ctx.db.insert("versions", { videoId: id, number: n, status: "ready", bunnyGuid: `g-${title}-${n}`, fileName: `${title}_v${n}.mp4`, startTimecode: "01:00:00:00", createdAt: now + n, frameCount: 100, mp4Heights: [360, 1080], fileSize: 5_000_000 } as never);
      return id;
    };
    const brand = await video(launch, "Brand Film", [1, 2]);
    const teaser = await video(launch, "Teaser", [1]);
    const empty = await video(launch, "Empty", []);
    const spot = await video(holiday, "Spot", [1]);
    const prairie = await video(promo, "Promo", [1]);
    return { owner, launch, holiday, promo, brand, teaser, empty, spot, prairie, ownerSub: await sess(owner), mayaSub: await sess(maya), danSub: await sess(dan), strangerSub: await sess(stranger) };
  });
  const me = t.withIdentity({ subject: ids.ownerSub });
  const maya = t.withIdentity({ subject: ids.mayaSub });
  const dan = t.withIdentity({ subject: ids.danSub });
  const stranger = t.withIdentity({ subject: ids.strangerSub });
  return { t, ids, me, maya, dan, stranger };
}

type T = Awaited<ReturnType<typeof setup>>["t"];
const base = { access: "view" as const, who: "link" as const, allVersions: true, downloads: false, emailNewVersions: false };
const titles = (r: { state: string; videos?: Array<{ title: string }> }) => (r.state === "ok" ? r.videos!.map((v) => v.title).sort() : r.state);

describe("what each combination shows", () => {
  const targets = (ids: Awaited<ReturnType<typeof setup>>["ids"]) => ({
    client: { target: { kind: "client" as const, client: "Harbor Coffee" }, expect: ["Brand Film", "Spot", "Teaser"] },
    project: { target: { kind: "project" as const, projectId: ids.launch }, expect: ["Brand Film", "Teaser"] },
    video: { target: { kind: "video" as const, videoId: ids.brand }, expect: ["Brand Film"] },
  });
  for (const kind of ["client", "project", "video"] as const) for (const access of ["view", "comment"] as const) for (const who of ["link", "invited"] as const) {
    test(`${kind} × ${access} × ${who}`, async () => {
      const { t, ids, me, maya, dan, stranger } = await setup();
      stubResend([]);
      const tg = targets(ids)[kind];
      const r = await me.mutation(api.shares.create, { target: tg.target, ...base, access, who, emails: who === "invited" ? ["maya@harbor.example"] : [] });
      expect(r.url).toBe(`https://review.wranglerportal.com/s/${r.token}`);
      // The owner always sees what a client will see.
      const asOwner = await me.query(api.shares.open, { token: r.token });
      expect(titles(asOwner)).toEqual(tg.expect);
      expect(asOwner).toMatchObject({ state: "ok", access, who, kind });
      // Everyone else, by the share's rule.
      const asNobody = await t.query(api.shares.open, { token: r.token });
      const asMaya = await maya.query(api.shares.open, { token: r.token });
      const asDan = await dan.query(api.shares.open, { token: r.token });
      const asStranger = await stranger.query(api.shares.open, { token: r.token });
      if (who === "link") {
        for (const x of [asNobody, asMaya, asDan, asStranger]) expect(titles(x)).toEqual(tg.expect);
        expect(asNobody).toMatchObject({ guest: true, viewer: null });
        expect(asMaya).toMatchObject({ guest: false, viewer: { kind: "client", email: "maya@harbor.example" } });
      } else {
        expect(titles(asMaya)).toEqual(tg.expect);
        expect(asNobody.state).toBe("signin");
        expect(asDan.state).toBe("notInvited");
        expect(asStranger.state).toBe("signin");
      }
      // Never anything outside the share: the other client's video, or the video with no ready version.
      for (const x of [asOwner, asMaya]) if (x.state === "ok") { expect(x.videos.map((v) => v.title)).not.toContain("Promo"); expect(x.videos.map((v) => v.title)).not.toContain("Empty"); }
      // A video added later under a shared client or project is covered; under another project it isn't.
      await t.run(async (ctx) => {
        await ctx.db.insert("versions", { videoId: ids.empty, number: 1, status: "ready", bunnyGuid: "g-e", fileName: "e.mp4", startTimecode: "01:00:00:00", createdAt: 1 } as never);
        const n = await ctx.db.insert("videos", { projectId: ids.holiday, title: "New Holiday Cut", createdAt: 2, updatedAt: 2 });
        await ctx.db.insert("versions", { videoId: n, number: 1, status: "ready", bunnyGuid: "g-n", fileName: "n.mp4", startTimecode: "01:00:00:00", createdAt: 2 } as never);
        const o = await ctx.db.insert("videos", { projectId: ids.promo, title: "Other Client Cut", createdAt: 3, updatedAt: 3 });
        await ctx.db.insert("versions", { videoId: o, number: 1, status: "ready", bunnyGuid: "g-o", fileName: "o.mp4", startTimecode: "01:00:00:00", createdAt: 3 } as never);
      });
      const later = await me.query(api.shares.open, { token: r.token });
      const want = kind === "client" ? ["Brand Film", "Empty", "New Holiday Cut", "Spot", "Teaser"] : kind === "project" ? ["Brand Film", "Empty", "Teaser"] : ["Brand Film"];
      expect(titles(later)).toEqual(want);
    });
  }
});

describe("the gate", () => {
  test("switching a share off refuses at once, on again restores it; delete removes everything", async () => {
    const { t, ids, me, maya } = await setup();
    stubResend([]);
    const r = await me.mutation(api.shares.create, { target: { kind: "project", projectId: ids.launch }, ...base });
    expect((await t.query(api.shares.open, { token: r.token })).state).toBe("ok");
    await me.mutation(api.shares.setOff, { shareId: r.shareId, off: true });
    expect(await t.query(api.shares.open, { token: r.token })).toMatchObject({ state: "off", label: "26201 Harbor Coffee Launch" });
    expect((await maya.query(api.shares.open, { token: r.token })).state).toBe("off");
    expect((await me.query(api.shares.open, { token: r.token })).state).toBe("off"); // the owner sees it's off too
    expect((await t.mutation(api.shares.touch, { token: r.token, kind: "opened" })).recorded).toBe(false);
    await me.mutation(api.shares.setOff, { shareId: r.shareId, off: false });
    expect((await t.query(api.shares.open, { token: r.token })).state).toBe("ok");
    await t.mutation(api.shares.touch, { token: r.token, kind: "opened", guestName: "Pat" });
    await me.mutation(api.shares.remove, { shareId: r.shareId });
    expect((await t.query(api.shares.open, { token: r.token })).state).toBe("missing");
    expect(await me.query(api.shares.list, {})).toHaveLength(0);
    await t.run(async (ctx) => { expect(await ctx.db.query("shareActivity").collect()).toHaveLength(0); expect(await ctx.db.query("shareMembers").collect()).toHaveLength(0); });
  });

  test("an expiry date: refused in the past at creation, respected once it passes", async () => {
    const { t, ids, me } = await setup();
    await expect(me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, expiresAt: Date.now() - 1 })).rejects.toThrow(/already in the past/);
    const r = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, expiresAt: Date.now() + 60_000 });
    expect((await t.query(api.shares.open, { token: r.token })).state).toBe("ok");
    await expect(me.mutation(api.shares.update, { shareId: r.shareId, expiresAt: Date.now() - 1 })).rejects.toThrow(/already in the past/);
    await t.run(async (ctx) => ctx.db.patch(r.shareId, { expiresAt: Date.now() - 1 })); // time passes
    expect((await t.query(api.shares.open, { token: r.token })).state).toBe("expired");
    expect((await me.query(api.shares.list, {}))[0]).toMatchObject({ state: "expired" });
    await me.mutation(api.shares.update, { shareId: r.shareId, expiresAt: null });
    expect((await t.query(api.shares.open, { token: r.token })).state).toBe("ok");
  });

  test("a passcode on a link share: asked for, wrong one refused, right one opens; owners skip it; invited shares refuse one", async () => {
    const { t, ids, me, maya } = await setup();
    stubResend([]);
    await expect(me.mutation(api.shares.create, { target: { kind: "client", client: "Harbor Coffee" }, ...base, passcode: "short" })).rejects.toThrow(/at least 8/);
    const r = await me.mutation(api.shares.create, { target: { kind: "client", client: "Harbor Coffee" }, ...base, passcode: " coffee-2026 " });
    expect((await t.query(api.shares.open, { token: r.token })).state).toBe("passcode");
    // The passcode itself never opens the share: only the proof that `unlock` hands out, and unlock is rate-limited.
    expect((await t.query(api.shares.open, { token: r.token, passcode: "coffee-2026" })).state).toBe("wrongPasscode");
    expect(await t.mutation(api.shares.unlock, { token: r.token, passcode: "wrong" })).toEqual({ state: "wrong" });
    const ok = await t.mutation(api.shares.unlock, { token: r.token, passcode: "coffee-2026" });
    expect(ok.state).toBe("ok");
    const proof = (ok as { proof: string }).proof;
    expect(titles(await t.query(api.shares.open, { token: r.token, passcode: proof }))).toEqual(["Brand Film", "Spot", "Teaser"]);
    // Five wrong tries lock it for a minute; the right one is refused while locked.
    for (let i = 0; i < 4; i++) expect((await t.mutation(api.shares.unlock, { token: r.token, passcode: "nope" })).state).toBe("wrong");
    expect(await t.mutation(api.shares.unlock, { token: r.token, passcode: "nope" })).toEqual({ state: "locked", seconds: 60 });
    expect((await t.mutation(api.shares.unlock, { token: r.token, passcode: "coffee-2026" })).state).toBe("locked");
    await t.run(async (ctx) => ctx.db.patch(r.shareId, { passLockedUntil: Date.now() - 1 }));
    expect((await t.mutation(api.shares.unlock, { token: r.token, passcode: "coffee-2026" })).state).toBe("ok");
    expect(await t.mutation(api.shares.unlock, { token: "nope", passcode: "x" })).toEqual({ state: "missing" });
    expect((await maya.query(api.shares.open, { token: r.token })).state).toBe("passcode"); // a client is a link visitor here
    expect((await me.query(api.shares.open, { token: r.token })).state).toBe("ok");
    expect((await me.query(api.shares.list, {}))[0]).toMatchObject({ hasPasscode: true });
    await me.mutation(api.shares.update, { shareId: r.shareId, passcode: null });
    expect((await t.query(api.shares.open, { token: r.token })).state).toBe("ok");
    const inv = await me.mutation(api.shares.create, { target: { kind: "client", client: "Harbor Coffee" }, ...base, who: "invited", passcode: "ignored" });
    expect((await me.query(api.shares.list, {})).find((s) => s._id === inv.shareId)).toMatchObject({ hasPasscode: false });
    await expect(me.mutation(api.shares.update, { shareId: inv.shareId, passcode: "x" })).rejects.toThrow(/sign-in is the lock/);
  });

  test("invited shares: members in, a revoked invite out, members can be removed", async () => {
    const { ids, me, maya, dan } = await setup();
    stubResend([]);
    const r = await me.mutation(api.shares.create, { target: { kind: "project", projectId: ids.launch }, ...base, who: "invited", emails: ["Maya@Harbor.example"] });
    expect(r.added).toEqual(["maya@harbor.example"]);
    expect((await maya.query(api.shares.open, { token: r.token })).state).toBe("ok");
    expect((await dan.query(api.shares.open, { token: r.token })).state).toBe("notInvited");
    await me.mutation(api.shares.addMember, { shareId: r.shareId, email: "dan@prairie.example" });
    expect((await dan.query(api.shares.open, { token: r.token })).state).toBe("ok");
    // Heston removes Maya's invite in Settings › Clients: her account stays, but the share closes to her.
    const invites = await me.query(api.clients.listInvites, {});
    await me.mutation(api.clients.revokeInvite, { inviteId: invites.find((i) => i.email === "maya@harbor.example")!._id });
    expect((await maya.query(api.shares.open, { token: r.token })).state).toBe("notInvited");
    await me.mutation(api.shares.removeMember, { shareId: r.shareId, email: "dan@prairie.example" });
    expect((await dan.query(api.shares.open, { token: r.token })).state).toBe("notInvited");
    expect((await me.query(api.shares.list, {}))[0].people.map((p) => p.email)).toEqual(["maya@harbor.example"]);
    await expect(me.mutation(api.shares.addMember, { shareId: r.shareId, email: "heston@wranglerproductions.com" })).rejects.toThrow(/owner/);
  });

  test("only the latest version unless Show all versions is on", async () => {
    const { t, ids, me } = await setup();
    // Show all versions applies to comment links; a view-only link is always the latest version (Heston, Oct 23).
    const all = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, access: "comment", allVersions: true });
    const latest = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, access: "comment", allVersions: false });
    const viewAll = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, access: "view", allVersions: true });
    const va = await t.query(api.shares.open, { token: viewAll.token });
    expect(va.state === "ok" && va.videos[0].versions.map((v) => v.number)).toEqual([2]);
    const a = await t.query(api.shares.open, { token: all.token });
    const l = await t.query(api.shares.open, { token: latest.token });
    expect(a.state === "ok" && a.videos[0].versions.map((v) => v.number)).toEqual([1, 2]);
    expect(l.state === "ok" && l.videos[0].versions.map((v) => v.number)).toEqual([2]);
    await me.mutation(api.shares.update, { shareId: latest.shareId, allVersions: true, access: "comment", downloads: true });
    const l2 = await t.query(api.shares.open, { token: latest.token });
    expect(l2).toMatchObject({ access: "comment", downloads: true });
    // With downloads on, each version names the file to save; without, nothing.
    expect(l2.state === "ok" && l2.videos[0].versions[1].download).toMatchObject({ name: "Brand Film_v2.mp4" });
    expect(a.state === "ok" && a.videos[0].versions[0].download).toBeNull();
    expect(l2.state === "ok" && l2.videos[0].versions.length).toBe(2);
  });

  test("a bad target or a missing token", async () => {
    const { t, ids, me } = await setup();
    await expect(me.mutation(api.shares.create, { target: { kind: "client", client: "Nobody Inc" }, ...base })).rejects.toThrow(/doesn't exist/);
    await expect(me.mutation(api.shares.create, { target: { kind: "project" }, ...base })).rejects.toThrow(/doesn't exist/);
    expect(await t.query(api.shares.open, { token: "nope" })).toEqual({ state: "missing", label: null });
    void ids;
  });
});

describe("the owner's side", () => {
  test("the invite email goes out once per person with the link; the list shows who has an account", async () => {
    const { t, ids, me } = await setup();
    const mails: Mail[] = [];
    stubResend(mails);
    const r = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, access: "comment", who: "invited", emails: ["maya@harbor.example", "new.person@example.com"] });
    vi.useFakeTimers();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    expect(mails.map((m) => m.to).sort()).toEqual(["maya@harbor.example", "new.person@example.com"]);
    const toMaya = mails.find((m) => m.to === "maya@harbor.example")!;
    expect(toMaya.subject).toBe('"Brand Film" — shared with you on Wrangler Review');
    expect(toMaya.text).toContain(`https://review.wranglerportal.com/s/${r.token}`);
    expect(toMaya.text).toContain("you can leave notes");
    expect(toMaya.text).toContain("Sign in with your Wrangler Review account");
    expect(mails.find((m) => m.to === "new.person@example.com")!.text).toContain("you'll create your account");
    // The new person is now invited (Settings › Clients shows them) and can make an account.
    expect((await me.query(api.clients.listInvites, {})).map((i) => i.email)).toContain("new.person@example.com");
    const s = (await me.query(api.shares.list, {}))[0];
    expect(s.people).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: "maya@harbor.example", hasAccount: true, name: "Maya" }),
      expect.objectContaining({ email: "new.person@example.com", hasAccount: false }),
    ]));
    expect(s.people.every((p) => typeof p.emailedAt === "number")).toBe(true);
    // Adding the same email again sends nothing new.
    await me.mutation(api.shares.addMember, { shareId: r.shareId, email: "maya@harbor.example" });
    vi.useFakeTimers();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    expect(mails).toHaveLength(2);
  });

  test("activity: opens and views are recorded once per half hour per person; owner opens don't count as a client's", async () => {
    const { t, ids, me, maya } = await setup();
    stubResend([]);
    const r = await me.mutation(api.shares.create, { target: { kind: "project", projectId: ids.launch }, ...base });
    expect((await t.mutation(api.shares.touch, { token: r.token, kind: "opened", guestName: "Pat" })).recorded).toBe(true);
    expect((await t.mutation(api.shares.touch, { token: r.token, kind: "opened", guestName: "Pat" })).state).toBe("recent");
    expect((await t.mutation(api.shares.touch, { token: r.token, kind: "viewed", videoId: ids.brand, guestName: "Pat" })).recorded).toBe(true);
    expect((await t.mutation(api.shares.touch, { token: r.token, kind: "viewed", videoId: ids.prairie, guestName: "Pat" })).state).toBe("notCovered");
    expect((await maya.mutation(api.shares.touch, { token: r.token, kind: "opened" })).recorded).toBe(true);
    expect((await me.mutation(api.shares.touch, { token: r.token, kind: "opened" })).recorded).toBe(true);
    const s = (await me.query(api.shares.list, {}))[0];
    expect(s.openCount).toBe(2);
    expect(s.lastOpenedAt).toBeTypeOf("number");
    const act = await me.query(api.shares.activity, { shareId: r.shareId });
    expect(act.map((a) => [a.kind, a.who, a.videoTitle])).toEqual([
      ["opened", "Heston (owner)", null], ["opened", "Maya · maya@harbor.example", null], ["viewed", "Pat (guest)", "Brand Film"], ["opened", "Pat (guest)", null],
    ]);
    const feed = await me.query(api.activity.feed, {});
    expect(feed.filter((e) => e.type === "share").map((e) => e.type === "share" && e.share.label)).toEqual(["26201 Harbor Coffee Launch", "26201 Harbor Coffee Launch", "26201 Harbor Coffee Launch", "26201 Harbor Coffee Launch"]);
  });

  test("forTarget and coveringVideo", async () => {
    const { ids, me } = await setup();
    const c = await me.mutation(api.shares.create, { target: { kind: "client", client: "Harbor Coffee" }, ...base });
    const p = await me.mutation(api.shares.create, { target: { kind: "project", projectId: ids.launch }, ...base });
    const vv = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base });
    await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.prairie }, ...base });
    expect((await me.query(api.shares.forTarget, { target: { kind: "project", projectId: ids.launch } })).map((s) => s._id)).toEqual([p.shareId]);
    expect((await me.query(api.shares.coveringVideo, { videoId: ids.brand })).map((s) => s._id).sort()).toEqual([c.shareId, p.shareId, vv.shareId].sort());
    expect((await me.query(api.shares.coveringVideo, { videoId: ids.spot })).map((s) => s._id)).toEqual([c.shareId]);
    expect((await me.query(api.shares.list, {})).map((s) => s.label)).toEqual(["Promo", "Brand Film", "26201 Harbor Coffee Launch", "Harbor Coffee"]);
  });
});

void internal;
