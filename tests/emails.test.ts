// Client side C4 (Oct 23): emails. Each kind goes out once to the right people with the right link; the owner's
// alert gathers a sitting into one email and ignores the owner's own notes; unsubscribe is respected; nothing goes
// to guests, to people on switched-off or expired shares, or when the share's switch is off.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { alertText } from "../convex/emails";

const modules = import.meta.glob("../convex/**/*.ts");
const SITE_URL = "https://review.wranglerportal.com", CONVEX_SITE = "https://handsome-hummingbird-11.convex.site";

beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = SITE_URL;
  process.env.CONVEX_SITE_URL = CONVEX_SITE;
  delete process.env.ALERT_EMAIL;
});
afterEach(() => vi.unstubAllGlobals());

type Mail = { to: string; subject: string; text: string; tag: string };
function stubResend() {
  const mails: Mail[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text, tag: b.tags?.[0]?.value }); return new Response(JSON.stringify({ id: "em_" + mails.length }), { status: 200 }); }
    return new Response("{}", { status: 500 });
  });
  return mails;
}

async function setup() {
  const t = convexTest(schema, modules);
  const mails = stubResend();
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    const maya = await ctx.db.insert("users", { email: "maya@harbor.example", name: "Maya Chen", role: "client" });
    const dan = await ctx.db.insert("users", { email: "dan@harbor.example", name: "Dan", role: "client" });
    await ctx.db.insert("invites", { email: "maya@harbor.example", createdAt: 0, acceptedAt: 0, userId: maya });
    await ctx.db.insert("invites", { email: "dan@harbor.example", createdAt: 0, acceptedAt: 0, userId: dan });
    await ctx.db.insert("invites", { email: "new@harbor.example", createdAt: 0 }); // invited, no account yet
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const now = Date.now();
    const launch = await ctx.db.insert("projects", { name: "Launch", jobNumber: "26201", client: "Harbor Coffee", createdAt: now });
    const brand = await ctx.db.insert("videos", { projectId: launch, title: "Brand Film", createdAt: now, updatedAt: now });
    const v1 = await ctx.db.insert("versions", { videoId: brand, number: 1, status: "ready", bunnyGuid: "g1", fileName: "b1.mp4", startTimecode: "01:00:00:00", createdAt: now, frameCount: 100, mp4Heights: [1080] } as never);
    const v2 = await ctx.db.insert("versions", { videoId: brand, number: 2, status: "processing", bunnyGuid: "g2", fileName: "b2.mp4", startTimecode: "01:00:00:00", createdAt: now + 1, description: "Tighter open, new music." } as never);
    return { owner, maya, dan, launch, brand, v1, v2, ownerSub: await sess(owner), mayaSub: await sess(maya), danSub: await sess(dan) };
  });
  const me = t.withIdentity({ subject: ids.ownerSub });
  const maya = t.withIdentity({ subject: ids.mayaSub });
  const dan = t.withIdentity({ subject: ids.danSub });
  const base = { allVersions: true, downloads: false, emailNewVersions: true };
  return { t, ids, me, maya, dan, mails, base };
}
const flush = async (t: ReturnType<typeof convexTest>) => { vi.useFakeTimers(); await t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };

describe("new version", () => {
  test("goes once to each person on an invited share that wants it, with the share link; not to link shares, off shares, or switched-off shares", async () => {
    const { t, ids, me, mails, base } = await setup();
    // An invited share on the project (Maya + a person without an account yet) and one on the client (Maya again, Dan).
    await me.mutation(api.shares.create, { target: { kind: "project", projectId: ids.launch }, ...base, access: "comment", who: "invited", emails: ["maya@harbor.example", "new@harbor.example"] });
    const clientShare = await me.mutation(api.shares.create, { target: { kind: "client", client: "Harbor Coffee" }, ...base, access: "view", who: "invited", emails: ["maya@harbor.example", "dan@harbor.example"] });
    // Noise that must not get an email: a link share, an invited share with the switch off, an off share, an expired share.
    await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, access: "comment", who: "link" });
    await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, emailNewVersions: false, access: "comment", who: "invited", emails: ["quiet@harbor.example"] });
    const off = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, access: "comment", who: "invited", emails: ["gone@harbor.example"] });
    await me.mutation(api.shares.setOff, { shareId: off.shareId, off: true });
    const exp = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, access: "comment", who: "invited", emails: ["late@harbor.example"] });
    await t.run(async (ctx) => ctx.db.patch(exp.shareId, { expiresAt: Date.now() - 1 }));
    await flush(t); // the invite emails
    mails.length = 0;
    // v2 becomes ready.
    await t.run(async (ctx) => ctx.db.patch(ids.v2, { status: "ready", mp4Heights: [1080] }));
    const r = await t.action(internal.emails.newVersion, { versionId: ids.v2 });
    expect(r.sent).toBe(3);
    expect(mails.map((m) => m.to).sort()).toEqual(["dan@harbor.example", "maya@harbor.example", "new@harbor.example"]);
    const toMaya = mails.find((m) => m.to === "maya@harbor.example")!;
    expect(toMaya.subject).toBe("Brand Film v2 is ready to review");
    expect(toMaya.text).toContain("Hi Maya,");
    expect(toMaya.text).toContain("What changed: Tighter open, new music.");
    expect(toMaya.text).toMatch(new RegExp(`${SITE_URL}/s/[\\w-]+/v/${ids.brand}\\?version=2`));
    expect(toMaya.text).toMatch(new RegExp(`${CONVEX_SITE}/email/stop\\?k=[\\w-]+&t=versions`));
    expect(toMaya.tag).toBe("versions");
    const toDan = mails.find((m) => m.to === "dan@harbor.example")!;
    expect(toDan.text).toContain(`/s/${clientShare.token}/v/`);
    // Running again (a retry, a second "ready") sends nothing more.
    expect((await t.action(internal.emails.newVersion, { versionId: ids.v2 })).sent).toBe(0);
    expect(mails).toHaveLength(3);
    // A version that isn't ready sends nothing.
    await t.run(async (ctx) => ctx.db.patch(ids.v2, { status: "processing" }));
    expect((await t.action(internal.emails.newVersion, { versionId: ids.v2 })).sent).toBe(0);
  });

  test("unsubscribe: the link stops that kind for that address, and Settings › Clients shows it", async () => {
    const { t, ids, me, mails, base } = await setup();
    await me.mutation(api.shares.create, { target: { kind: "project", projectId: ids.launch }, ...base, access: "comment", who: "invited", emails: ["maya@harbor.example"] });
    await flush(t); mails.length = 0;
    await t.run(async (ctx) => ctx.db.patch(ids.v2, { status: "ready", mp4Heights: [1080] }));
    await t.action(internal.emails.newVersion, { versionId: ids.v2 });
    const key = /email\/stop\?k=([\w-]+)&t=versions/.exec(mails[0].text)![1];
    const bad = await t.fetch(`/email/stop?k=nope&t=versions`);
    expect(bad.status).toBe(404);
    const res = await t.fetch(`/email/stop?k=${key}&t=versions`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("No more emails about new versions");
    // Another version: Maya gets nothing; replies are a separate switch and still arrive.
    const v3 = await t.run(async (ctx) => ctx.db.insert("versions", { videoId: ids.brand, number: 3, status: "ready", bunnyGuid: "g3", fileName: "b3.mp4", startTimecode: "01:00:00:00", createdAt: Date.now(), mp4Heights: [1080] } as never));
    expect((await t.action(internal.emails.newVersion, { versionId: v3 })).sent).toBe(0);
    const inv = (await me.query(api.clients.listInvites, {})).find((i) => i.email === "maya@harbor.example")!;
    expect(inv.emails).toEqual({ versionsOff: true, repliesOff: false });
  });
});

describe("replies", () => {
  test("Heston's reply to a client's note emails the client once; not for guests, hidden replies, or their own replies", async () => {
    const { t, ids, me, maya, mails, base } = await setup();
    const share = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, access: "comment", who: "invited", emails: ["maya@harbor.example"] });
    const link = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, access: "comment", who: "link" });
    await flush(t); mails.length = 0;
    const noteId = await maya.mutation(api.notes.create, { versionId: ids.v1, kind: "frame", inFrame: 48, text: "Can this hold longer?", share: { token: share.token } });
    const guestNote = await t.mutation(api.notes.create, { versionId: ids.v1, kind: "general", text: "guest says hi", share: { token: link.token, guestKey: "g1", guestName: "Pat" } });
    // Maya replying to her own note: no email. Heston replying: one email with the note and reply, linking to the note on her share.
    await maya.mutation(api.notes.reply, { noteId, text: "adding context", share: { token: share.token } });
    await me.mutation(api.notes.reply, { noteId, text: "Yes, 8 more frames in v3." });
    await me.mutation(api.notes.reply, { noteId: guestNote, text: "Thanks Pat." });
    await flush(t);
    expect(mails.map((m) => [m.to, m.tag])).toEqual([["maya@harbor.example", "replies"]]);
    expect(mails[0].subject).toBe("Heston replied on Brand Film");
    expect(mails[0].text).toContain("at 01:00:02:00:");
    expect(mails[0].text).toContain("You: Can this hold longer?");
    expect(mails[0].text).toContain("Heston: Yes, 8 more frames in v3.");
    expect(mails[0].text).toContain(`${SITE_URL}/s/${share.token}/v/${ids.brand}?version=1&note=${noteId}`);
    expect(mails[0].text).toMatch(/email\/stop\?k=[\w-]+&t=replies/);
    // Claude's hidden reply: nothing until Heston shows it; then once.
    const claudeReply = await t.run(async (ctx) => ctx.db.insert("replies", { noteId, text: "Done in the grade.", authorName: "Claude", createdAt: Date.now(), hidden: true }));
    await t.action(internal.emails.replyToNote, { replyId: claudeReply });
    expect(mails).toHaveLength(1);
    await me.mutation(api.notes.setReplyHidden, { replyId: claudeReply, hidden: false });
    await flush(t);
    expect(mails).toHaveLength(2);
    expect(mails[1].text).toContain("Claude: Done in the grade.");
    await me.mutation(api.notes.setReplyHidden, { replyId: claudeReply, hidden: true });
    await me.mutation(api.notes.setReplyHidden, { replyId: claudeReply, hidden: false });
    await flush(t);
    expect(mails).toHaveLength(2); // still once
  });
});

describe("Heston's alert", () => {
  test("one email per sitting, 10 minutes after the last client or guest note; the owner's own notes don't count", async () => {
    const { t, ids, me, maya, mails, base } = await setup();
    const share = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, access: "comment", who: "invited", emails: ["maya@harbor.example"] });
    const link = await me.mutation(api.shares.create, { target: { kind: "video", videoId: ids.brand }, ...base, access: "comment", who: "link" });
    await flush(t); mails.length = 0;
    const a = await maya.mutation(api.notes.create, { versionId: ids.v1, kind: "frame", inFrame: 10, text: "first", share: { token: share.token } });
    const b = await t.mutation(api.notes.create, { versionId: ids.v1, kind: "range", inFrame: 20, outFrame: 44, text: "", drawing: { shapes: [{ t: "box" }] }, share: { token: link.token, guestKey: "g", guestName: "Pat" } });
    await me.mutation(api.notes.create, { versionId: ids.v1, kind: "general", text: "my own note" });
    // Too soon: the newest note is seconds old, so the run that fires waits for a later one.
    expect((await t.action(internal.emails.ownerAlert, { videoId: ids.brand })).reason).toBe("still writing");
    expect(mails).toHaveLength(0);
    // Time passes (the notes are now 11 minutes old).
    await t.run(async (ctx) => { for (const id of [a, b]) await ctx.db.patch(id, { createdAt: Date.now() - 11 * 60_000 }); });
    const r = await t.action(internal.emails.ownerAlert, { videoId: ids.brand });
    expect(r).toMatchObject({ sent: 1, notes: 2 });
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("heston@wranglerproductions.com");
    expect(mails[0].subject).toBe("2 new notes on Brand Film from Maya Chen and 1 more");
    expect(mails[0].text).toContain("v1 · 01:00:00:10 · Maya Chen");
    expect(mails[0].text).toContain("v1 · 01:00:00:20 → 01:00:01:20 · Pat (guest) · drawing");
    expect(mails[0].text).toContain(`${SITE_URL}/v/${ids.brand}?version=1&note=${a}`);
    expect(mails[0].text).not.toContain("my own note");
    // Nothing left to send; a later note starts a new sitting.
    expect((await t.action(internal.emails.ownerAlert, { videoId: ids.brand })).reason).toBe("nothing new");
    const c = await maya.mutation(api.notes.create, { versionId: ids.v1, kind: "general", text: "one more", share: { token: share.token } });
    await t.run(async (ctx) => ctx.db.patch(c, { createdAt: Date.now() - 11 * 60_000 }));
    expect((await t.action(internal.emails.ownerAlert, { videoId: ids.brand })).sent).toBe(1);
    expect(mails[1].subject).toBe("1 new note on Brand Film from Maya Chen");
    // ALERT_EMAIL overrides where it goes.
    process.env.ALERT_EMAIL = "alerts@wranglerproductions.com";
    const d = await maya.mutation(api.notes.create, { versionId: ids.v1, kind: "general", text: "again", share: { token: share.token } });
    await t.run(async (ctx) => ctx.db.patch(d, { createdAt: Date.now() - 11 * 60_000 }));
    await t.action(internal.emails.ownerAlert, { videoId: ids.brand });
    expect(mails[2].to).toBe("alerts@wranglerproductions.com");
    delete process.env.ALERT_EMAIL;
  });

  test("the alert text reads well", () => {
    const m = alertText({ title: "Spot", project: "26201 Launch", rows: [{ version: 2, author: "Maya Chen", text: "Louder", drawing: false, voice: true, when: "01:00:05:00", link: "https://x/1" }] });
    expect(m.subject).toBe("1 new note on Spot from Maya Chen");
    expect(m.text.split("\n")[0]).toBe('1 new note from Maya Chen on "Spot" (26201 Launch).');
    expect(m.text).toContain("v2 · 01:00:05:00 · Maya Chen · voice");
  });
});
