// Phase 5e step 1 (Nov 5): team members. Heston invites Riley as a Producer (email 46); Riley joins with a password and
// the 6-digit code; the switches decide what she can call; the owner-only team pages stay the owner's; another business
// can't reach Heston's team; invites expire after 14 days; taking someone off the team signs them out.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";

const api = anyApi;
beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://x.convex.site";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
  const { generateKeyPairSync } = await import("node:crypto");
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.JWT_PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...pair.publicKey.export({ format: "jwk" }) }] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
type Sent = { to: string; subject: string; text: string };
const stub = (mails: Sent[]) => vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response(JSON.stringify({ id: "em" }), { status: 200 }); }
  return new Response("{}", { status: 500 });
}));
const settle = async (w: W) => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };
const RILEY = "riley@chen.example";
const PW = "longenoughpassword";
const tokenIn = (m: Sent) => /\/team\/join\/([A-Za-z0-9_-]+)/.exec(m.text)![1];
const codeIn = (m: Sent) => /\b(\d{6})\b/.exec(m.text)![1];

/** Riley joins as `role`: invite, email 46, sign-up, the code. Returns her session. */
async function join(w: W, mails: Sent[], email = RILEY, role: "producer" | "editor" | "bookkeeper" = "producer") {
  const r = await w.heston.mutation(api.team.invite, { email, name: "Riley Chen", role });
  if (r.error === "pending") await w.heston.mutation(api.team.resendInvite, { inviteId: r.inviteId });
  else expect(r).toMatchObject({ ok: true });
  await settle(w);
  const invite = mails.filter((m) => m.to === email).pop()!;
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email, password: PW, name: "Riley Chen" } });
  const code = codeIn(mails.filter((m) => m.to === email).pop()!);
  const done = await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email, code } }) as { tokens?: unknown };
  expect(done.tokens).toBeTruthy();
  const sub = await w.t.run(async (ctx) => {
    const u = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).unique())!;
    return `${u._id}|${await ctx.db.insert("authSessions", { userId: u._id, expirationTime: Date.now() + 3_600_000 })}`;
  });
  return { as: w.t.withIdentity({ subject: sub }), invite, userId: sub.split("|")[0] as Id<"users"> };
}

describe("Phase 5e · team members", () => {
  test("T5e.1 invite, email 46, Join page, sign-up with the code; the role's switches decide what she can call", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    // Nobody can make an account before the invite.
    await expect(w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email: RILEY, password: PW } })).rejects.toThrow(/hasn't been invited/);
    await w.heston.mutation(api.team.invite, { email: "Riley@Chen.example", name: "Riley Chen", role: "producer" });
    await settle(w);
    const m46 = mails.find((m) => m.to === RILEY)!;
    expect(m46.subject).toBe("Heston invited you to join Wrangler Productions on the portal");
    expect(m46.text).toContain("Your role: Producer");
    expect(m46.text).toContain("https://app.wranglerportal.com/team/join/");
    // The Join page answers for the token only, with the email; never the hash.
    const page = await w.t.query(api.team.joinPage, { token: tokenIn(m46) });
    expect(page).toMatchObject({ state: "open", business: "Wrangler Productions", role: "Producer", email: RILEY, invitedBy: "Heston" });
    expect(await w.t.query(api.team.joinPage, { token: "x".repeat(32) })).toEqual({ state: "missing" });
    // Sign-up makes the login, but no membership until the code proves the email.
    await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email: RILEY, password: PW, name: "Riley Chen" } });
    const before = await w.t.run((ctx) => ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", RILEY)).collect());
    expect(before).toEqual([]);
    const code = codeIn(mails.filter((m) => m.to === RILEY).pop()!);
    await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: RILEY, code } });
    const after = await w.t.run((ctx) => ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", RILEY)).collect());
    expect(after).toMatchObject([{ role: "team", teamRole: "producer", businessId: w.A }]);
    expect(await w.t.query(api.team.joinPage, { token: tokenIn(m46) })).toMatchObject({ state: "joined" });

    const sub = await w.t.run(async (ctx) => {
      const u = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", RILEY)).unique())!;
      expect(u.role).toBe("team");
      return `${u._id}|${await ctx.db.insert("authSessions", { userId: u._id, expirationTime: Date.now() + 3_600_000 })}`;
    });
    const riley = w.t.withIdentity({ subject: sub });
    expect(await riley.query(api.users.me, {})).toMatchObject({ role: "team", allowed: false, team: { role: "producer", perms: { projects: true, review: true, payments: false, value: false } } });
    // A switch that's on opens the functions that name it; the team pages and unlabelled functions stay the owner's.
    expect(await riley.query(api.team.projectPeople, { projectId: w.p })).toMatchObject({ people: [], canAssign: false });
    await expect(riley.query(api.team.page, {})).rejects.toThrow(/Not allowed/);
    await expect(riley.mutation(api.team.invite, { email: "x@example.com", role: "editor" })).rejects.toThrow(/Not allowed/);
    await expect(riley.query(api.inbox.mine, {})).rejects.toThrow(/Not allowed/); // a client's page
    // Turning the switch off (for the role) closes it at once.
    await w.heston.mutation(api.team.setRolePerm, { role: "producer", perm: "projects", on: false });
    await expect(riley.query(api.team.projectPeople, { projectId: w.p })).rejects.toThrow(/Not allowed/);
  }, 30_000);

  test("T5e.2 who can be invited; another business can't reach this team", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    expect(await w.heston.mutation(api.team.invite, { email: "heston@wranglerproductions.com", role: "producer" })).toEqual({ error: "owner" });
    expect(await w.heston.mutation(api.team.invite, { email: "maya@harbor.example", role: "producer" })).toEqual({ error: "otherLogin" }); // a client login
    await expect(w.heston.mutation(api.team.invite, { email: "not an email", role: "producer" })).rejects.toThrow(/valid email/);
    const first = await w.heston.mutation(api.team.invite, { email: RILEY, role: "producer" });
    expect(await w.heston.mutation(api.team.invite, { email: RILEY, role: "editor" })).toMatchObject({ error: "pending", inviteId: first.inviteId });
    // Other Films' owner can't see Heston's invite (so can invite her too), and can't resend, cancel or change Heston's.
    const theirs = await w.boss.mutation(api.team.invite, { email: RILEY, role: "producer" });
    expect(theirs).toMatchObject({ ok: true });
    expect((await w.boss.query(api.team.page, {})).invites.map((i: { inviteId: string }) => i.inviteId)).toEqual([theirs.inviteId]);
    expect((await w.heston.query(api.team.page, {})).invites.map((i: { inviteId: string }) => i.inviteId)).toEqual([first.inviteId]);
    await expect(w.boss.mutation(api.team.cancelInvite, { inviteId: first.inviteId })).rejects.toThrow();
    await expect(w.boss.mutation(api.team.resendInvite, { inviteId: first.inviteId })).rejects.toThrow();
    // She joins Heston's team (the first invite); Other Films' invite is never accepted while she's on a team.
    await w.t.run(async (ctx) => { await ctx.db.patch(theirs.inviteId, { createdAt: Date.now() + 1 }); });
    const { userId } = await join(w, mails);
    expect(await w.t.run((ctx) => ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", RILEY)).collect())).toMatchObject([{ businessId: w.A, role: "team" }]);
    expect((await w.boss.query(api.team.page, {})).members).toEqual([]);
    const mid = (await w.heston.query(api.team.page, {})).members[0].membershipId as Id<"memberships">;
    expect(await w.heston.mutation(api.team.invite, { email: RILEY, role: "editor" })).toEqual({ error: "already" });
    for (const f of [() => w.boss.query(api.team.member, { membershipId: mid }), () => w.boss.mutation(api.team.remove, { membershipId: mid }),
      () => w.boss.mutation(api.team.setRole, { membershipId: mid, role: "bookkeeper" }), () => w.boss.mutation(api.team.setPerm, { membershipId: mid, perm: "payments", on: true }),
      () => w.boss.mutation(api.team.assign, { projectId: w.p, userIds: [userId] })]) await expect(f()).rejects.toThrow();
    // Heston can't assign someone who isn't on his team, and the boss can't be assigned here.
    const bossId = (await w.t.run((ctx) => ctx.db.query("users").withIndex("email", (q) => q.eq("email", "boss@other.example")).unique()))!._id;
    await expect(w.heston.mutation(api.team.assign, { projectId: w.p, userIds: [bossId] })).rejects.toThrow(/Only people on your team/);
  }, 30_000);

  test("T5e.3 switches: roles apply to everyone in them, a member can differ, project value stays locked for Producer and Editor", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    await join(w, mails);
    const mid = (await w.heston.query(api.team.page, {})).members[0].membershipId as Id<"memberships">;
    await expect(w.heston.mutation(api.team.setPerm, { membershipId: mid, perm: "value", on: true })).rejects.toThrow(/owner and the Bookkeeper/);
    await expect(w.heston.mutation(api.team.setRolePerm, { role: "editor", perm: "value", on: true })).rejects.toThrow(/owner and the Bookkeeper/);
    await w.heston.mutation(api.team.setPerm, { membershipId: mid, perm: "payments", on: true });
    expect(await w.heston.query(api.team.member, { membershipId: mid })).toMatchObject({ perms: { payments: true }, matchesRole: false });
    await w.heston.mutation(api.team.resetToRole, { membershipId: mid });
    expect(await w.heston.query(api.team.member, { membershipId: mid })).toMatchObject({ perms: { payments: false }, matchesRole: true });
    await w.heston.mutation(api.team.setRolePerm, { role: "producer", perm: "settings", on: true });
    expect((await w.heston.query(api.team.member, { membershipId: mid })).perms.settings).toBe(true);
    // A new role swaps in that role's switches; the Bookkeeper sees what a project is worth.
    await w.heston.mutation(api.team.setRole, { membershipId: mid, role: "bookkeeper" });
    expect(await w.heston.query(api.team.member, { membershipId: mid })).toMatchObject({ role: "bookkeeper", perms: { value: true, payments: true, projects: false } });
    await w.heston.mutation(api.team.resetRoles, {});
    expect((await w.heston.query(api.team.page, {})).roles.producer.settings).toBe(false);
  }, 30_000);

  test("T5e.4 invites last 14 days; a resend replaces the link; a cancelled invite stops working", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const r = await w.heston.mutation(api.team.invite, { email: RILEY, role: "editor" });
    await settle(w);
    const first = tokenIn(mails.pop()!);
    await w.heston.mutation(api.team.resendInvite, { inviteId: r.inviteId });
    await settle(w);
    const second = tokenIn(mails.pop()!);
    expect(await w.t.query(api.team.joinPage, { token: first })).toEqual({ state: "missing" });
    expect(await w.t.query(api.team.joinPage, { token: second })).toMatchObject({ state: "open", role: "Editor" });
    // 14 days on: expired, and sign-up is refused.
    await w.t.run(async (ctx) => { await ctx.db.patch(r.inviteId, { expiresAt: Date.now() - 1 }); });
    expect(await w.t.query(api.team.joinPage, { token: second })).toMatchObject({ state: "expired" });
    await expect(w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email: RILEY, password: PW } })).rejects.toThrow(/hasn't been invited/);
    expect((await w.heston.query(api.team.page, {})).invites).toMatchObject([{ email: RILEY, expired: true }]);
    // Resend opens it again for 14 days; cancel closes it.
    await w.heston.mutation(api.team.resendInvite, { inviteId: r.inviteId });
    await settle(w);
    const third = tokenIn(mails.pop()!);
    expect(await w.t.query(api.team.joinPage, { token: third })).toMatchObject({ state: "open" });
    await w.heston.mutation(api.team.cancelInvite, { inviteId: r.inviteId });
    expect(await w.t.query(api.team.joinPage, { token: third })).toEqual({ state: "missing" });
    expect((await w.heston.query(api.team.page, {})).invites).toEqual([]);
  }, 30_000);

  test("T5e.5 an Editor sees only assigned projects; taking someone off the team signs them out", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const ed = await join(w, mails, RILEY, "editor");
    await expect(ed.as.query(api.team.projectPeople, { projectId: w.p })).rejects.toThrow(/Not allowed/);
    await w.heston.mutation(api.team.assign, { projectId: w.p, userIds: [ed.userId] });
    expect(await ed.as.query(api.team.projectPeople, { projectId: w.p })).toMatchObject({ people: [{ name: "Riley Chen", role: "editor" }] });
    expect(await w.heston.query(api.team.projectPeople, { projectId: w.p })).toMatchObject({ canAssign: true, candidates: [{ userId: ed.userId }] });
    const mid = (await w.heston.query(api.team.page, {})).members[0].membershipId as Id<"memberships">;
    expect((await w.heston.query(api.team.page, {})).members[0]).toMatchObject({ assigned: 1, role: "editor" });
    await w.heston.mutation(api.team.remove, { membershipId: mid });
    const sessions = await w.t.run((ctx) => ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", ed.userId)).collect());
    expect(sessions).toEqual([]);
    // Even with a session somehow left, the login is nobody now, and the assignment is gone.
    const sub = await w.t.run(async (ctx) => `${ed.userId}|${await ctx.db.insert("authSessions", { userId: ed.userId, expirationTime: Date.now() + 3_600_000 })}`);
    const after = w.t.withIdentity({ subject: sub });
    expect(await after.query(api.users.me, {})).toMatchObject({ role: null, team: null });
    await expect(after.query(api.team.projectPeople, { projectId: w.p })).rejects.toThrow(/Not allowed/);
    expect((await w.heston.query(api.team.projectPeople, { projectId: w.p })).people).toEqual([]);
  }, 30_000);

  test("T5e.6 Review: an Editor works only on assigned projects; a Producer on every project; nobody else on the team", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const ids = await w.t.run(async (ctx) => {
      const other = await ctx.db.insert("projects", { businessId: w.A, name: "Other job", createdAt: 1 });
      const mk = async (projectId: Id<"projects">, title: string) => {
        const videoId = await ctx.db.insert("videos", { businessId: w.A, projectId, title, createdAt: 0, updatedAt: 0 });
        const versionId = await ctx.db.insert("versions", { businessId: w.A, videoId, number: 1, status: "ready", bunnyGuid: "g", fileName: "a.mp4", startTimecode: "01:00:00:00", createdAt: 0 } as never);
        return { videoId, versionId };
      };
      return { other, mine: await mk(w.p, "Launch cut"), theirs: await mk(other, "Other cut") };
    });
    const ed = await join(w, mails, RILEY, "editor");
    await w.heston.mutation(api.team.assign, { projectId: w.p, userIds: [ed.userId] });
    const ov = await ed.as.query(api.library.overview, {});
    expect(ov.projects.map((p: { name: string }) => p.name)).toEqual(["Launch"]);
    expect(ov.videos.map((v: { title: string }) => v.title)).toEqual(["Launch cut"]);
    expect(ov.clients).toEqual([]);
    expect((await ed.as.query(api.library.video, { videoId: ids.mine.videoId }))?.video?.title ?? "seen").toBeTruthy();
    await ed.as.mutation(api.notes.create, { versionId: ids.mine.versionId, kind: "general", text: "Trim the open" });
    await expect(ed.as.query(api.library.video, { videoId: ids.theirs.videoId })).rejects.toThrow(/Not allowed/);
    await expect(ed.as.mutation(api.notes.create, { versionId: ids.theirs.versionId, kind: "general", text: "x" })).rejects.toThrow(/Not allowed/);
    await expect(ed.as.mutation(api.library.renameVideo, { videoId: ids.theirs.videoId, title: "x" })).rejects.toThrow(/Not allowed/);
    await expect(ed.as.mutation(api.library.createVideo, { projectId: ids.other, title: "x" })).rejects.toThrow(/Not allowed/);
    await expect(ed.as.mutation(api.library.createProject, { name: "Mine now" })).rejects.toThrow(/Not allowed/);
    await ed.as.mutation(api.library.createVideo, { projectId: w.p, title: "Teaser" });
    // Owner-only still: deleting, and Approve final.
    await expect(ed.as.mutation(api.library.deleteVideo, { videoId: ids.mine.videoId })).rejects.toThrow(/Not allowed/);
    await expect(ed.as.mutation(api.library.approveFinal, { videoId: ids.mine.videoId, keep: 1 })).rejects.toThrow(/Not allowed/);
    // The owner sees the Editor's note under her own name.
    const notes = await w.heston.query(api.notes.forVersion, { versionId: ids.mine.versionId });
    expect(JSON.stringify(notes)).toContain("Riley Chen");
    // With Review switched off for her, the assigned project closes too.
    const mid = (await w.heston.query(api.team.page, {})).members[0].membershipId as Id<"memberships">;
    await w.heston.mutation(api.team.setPerm, { membershipId: mid, perm: "review", on: false });
    await expect(ed.as.query(api.library.video, { videoId: ids.mine.videoId })).rejects.toThrow(/Not allowed/);
    await expect(ed.as.query(api.library.overview, {})).rejects.toThrow(/Not allowed/);
  }, 30_000);

  test("T5e.7 money: a Producer sees no invoices, pipeline or Stripe; a Bookkeeper sees Payments but not shoots, Review or clients", async () => {
    const w = await world();
    const mails: Sent[] = [];
    stub(mails);
    const pr = await join(w, mails, RILEY, "producer");
    await expect(pr.as.query(api.invoices.list, {})).rejects.toThrow(/Not allowed/);
    await expect(pr.as.query(api.invoices.forProject, { projectId: w.p })).rejects.toThrow(/Not allowed/);
    await expect(pr.as.query(api.crm.board, {})).rejects.toThrow(/Not allowed/); // the pipeline is what jobs are worth
    await expect(pr.as.query(api.payments.settings, {})).rejects.toThrow(/Not allowed/);
    await expect(pr.as.mutation(api.payments.disconnect, {})).rejects.toThrow(/Not allowed/);
    expect(await pr.as.query(api.projects.page, { projectId: w.p })).toMatchObject({ name: "Launch" });
    // Even with Clients on, the pipeline needs "See what a project is worth", which a Producer can't have.
    const bk = await join(w, mails, "bea@books.example", "bookkeeper");
    expect(Array.isArray(await bk.as.query(api.invoices.list, {}))).toBe(true);
    await expect(bk.as.query(api.crm.board, {})).rejects.toThrow(/Not allowed/); // Clients is off for a Bookkeeper
    await expect(bk.as.query(api.projects.page, { projectId: w.p })).rejects.toThrow(/Not allowed/);
    await expect(bk.as.query(api.library.overview, {})).rejects.toThrow(/Not allowed/);
    await expect(bk.as.query(api.clients.directory, {})).rejects.toThrow(/Not allowed/);
    const bkm = (await w.heston.query(api.team.page, {})).members.find((m: { email: string }) => m.email === "bea@books.example").membershipId;
    await w.heston.mutation(api.team.setPerm, { membershipId: bkm, perm: "clients", on: true });
    expect(await bk.as.query(api.crm.board, {})).toBeTruthy();
    // Signing as Heston, sending and voiding stay the owner's whatever the switches say.
    const all = (await w.heston.query(api.team.page, {})).members.find((m: { email: string }) => m.email === RILEY).membershipId;
    for (const p of ["docs", "settings", "payments"]) await w.heston.mutation(api.team.setPerm, { membershipId: all, perm: p, on: true });
    await expect(pr.as.query(api.sign.ownerSignature, {})).rejects.toThrow(/Not allowed/);
    await expect(pr.as.action(api.payments.connect, {})).rejects.toThrow(/Not allowed/);
    await expect(pr.as.query(api.team.page, {})).rejects.toThrow(/Not allowed/);
  }, 30_000);
});
