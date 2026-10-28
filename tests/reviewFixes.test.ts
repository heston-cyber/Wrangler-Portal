// Wrangler Portal, Phase 0.5d step 6 (Oct 28): one test per finding of the independent security review. Each one
// failed before the fix. Two businesses: A (Wrangler, the default) and B (another creator).
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

const api = anyApi;
const internal = anyApi;
const modules = import.meta.glob("../convex/**/*.ts");

beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://x.convex.site";
  process.env.BUNNY_STREAM_LIBRARY_ID = "785477";
  process.env.BUNNY_STREAM_API_KEY = "bunny-test";
  const { generateKeyPairSync } = await import("node:crypto");
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.JWT_PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...pair.publicKey.export({ format: "jwk" }) }] });
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.SLACK_WEBHOOK_URL; });

const okFetch = () => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 })));

async function world() {
  const t = convexTest(schema, modules);
  const w = await t.run(async (ctx) => {
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const A = await ctx.db.insert("businesses", { slug: "wrangler", name: "Wrangler Productions", createdAt: 0 });
    const B = await ctx.db.insert("businesses", { slug: "other", name: "Other Films", createdAt: 1 });
    const heston = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    await ctx.db.insert("memberships", { businessId: A, email: "heston@wranglerproductions.com", userId: heston, role: "owner", createdAt: 0 });
    const boss = await ctx.db.insert("users", { email: "boss@other.example", name: "Boss", role: "owner" });
    await ctx.db.insert("memberships", { businessId: B, email: "boss@other.example", userId: boss, role: "owner", createdAt: 1 });
    const mk = async (biz: Id<"businesses">, title: string) => {
      const p = await ctx.db.insert("projects", { businessId: biz, name: `${title} project`, client: "Acme", createdAt: 0 });
      const vid = await ctx.db.insert("videos", { businessId: biz, projectId: p, title, createdAt: 0, updatedAt: 0 });
      const ver = await ctx.db.insert("versions", { businessId: biz, videoId: vid, number: 1, status: "ready", bunnyGuid: `g-${title}`, fileName: "x.mp4", startTimecode: "01:00:00:00", createdAt: 0 } as never);
      const note = await ctx.db.insert("notes", { businessId: biz, versionId: ver, videoId: vid, kind: "general", text: `${title} note`, status: "open", authorName: "Owner", visibility: "shared", createdAt: 0, updatedAt: 0 } as never);
      return { p, vid, ver, note };
    };
    const a = await mk(A, "A SECRET CUT");
    const b = await mk(B, "B PRIVATE CUT");
    return { A, B, heston, boss, a, b, hestonSub: await sess(heston), bossSub: await sess(boss) };
  });
  return { t, ...w };
}

/** A signed-in client account with these memberships (and an invite in each). */
async function client(t: ReturnType<typeof convexTest>, email: string, bizs: Id<"businesses">[]) {
  return t.run(async (ctx) => {
    const u = await ctx.db.insert("users", { email, role: "client" });
    for (const b of bizs) {
      await ctx.db.insert("memberships", { businessId: b, email, userId: u, role: "client", createdAt: 2 });
      await ctx.db.insert("invites", { businessId: b, email, createdAt: 2, userId: u, acceptedAt: 2 });
    }
    return `${u}|${await ctx.db.insert("authSessions", { userId: u, expirationTime: Date.now() + 3_600_000 })}`;
  });
}

const share = (target: unknown, who: "link" | "invited" = "link") =>
  ({ target, access: "comment", who, allVersions: true, downloads: true, emailNewVersions: false, ...(who === "invited" ? { emails: [] } : {}) });

test("finding 1: a client share only covers its own business, whoever opens it", async () => {
  const w = await world();
  okFetch();
  const boss = w.t.withIdentity({ subject: w.bossSub });
  const heston = w.t.withIdentity({ subject: w.hestonSub });
  // B's client-wide link share for "Acme"; A has a client "Acme" too.
  const sh = await boss.mutation(api.shares.create, share({ kind: "client", client: "Acme" }));
  const aClient = w.t.withIdentity({ subject: await client(w.t, "maya@acme.example", [w.A]) });
  for (const who of [w.t, aClient]) {
    const open = JSON.stringify(await who.query(api.shares.open, { token: sh.token }));
    expect(open).toContain("B PRIVATE CUT");
    expect(open).not.toContain("A SECRET CUT");
  }
  // A's version through B's token: no notes, no writing.
  const notes = await aClient.query(api.notes.forVersion, { versionId: w.a.ver, share: { token: sh.token } }).catch(() => null);
  expect(JSON.stringify(notes ?? "")).not.toContain("A SECRET CUT note");
  await expect(aClient.mutation(api.notes.create, { versionId: w.a.ver, kind: "general", text: "INJECTED", share: { token: sh.token } })).rejects.toThrow();
  expect(JSON.stringify(await heston.query(api.notes.forVersion, { versionId: w.a.ver }))).not.toContain("INJECTED");

  // A's own invited client share for "Acme": only A's Acme, never B's.
  const ash = await heston.mutation(api.shares.create, share({ kind: "client", client: "Acme" }, "invited"));
  await heston.mutation(api.shares.addMember, { shareId: ash.shareId, email: "maya@acme.example" });
  const open = JSON.stringify(await aClient.query(api.shares.open, { token: ash.token }));
  expect(open).toContain("A SECRET CUT");
  expect(open).not.toContain("B PRIVATE CUT");
  const mine = JSON.stringify(await aClient.query(api.shares.mine, {}));
  expect(mine).not.toContain("B PRIVATE CUT");
});

test("finding 2: a new client account joins the business that invited it, not Wrangler", async () => {
  const w = await world();
  okFetch();
  const boss = w.t.withIdentity({ subject: w.bossSub });
  await boss.mutation(api.clients.invite, { email: "puppet@evil.example" });
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email: "puppet@evil.example", password: "longenoughpassword" } });
  const ms = await w.t.run(async (ctx) => (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", "puppet@evil.example")).collect()));
  expect(ms.map((m) => [m.role, m.businessId])).toEqual([["client", w.B]]);

  // Someone who already has an account (a client of A) invited by B becomes a client of B too.
  await client(w.t, "both@acme.example", [w.A]);
  await boss.mutation(api.clients.invite, { email: "both@acme.example" });
  const both = await w.t.run(async (ctx) => (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", "both@acme.example")).collect()));
  expect(both.map((m) => m.businessId).sort()).toEqual([w.A, w.B].sort());

  // Another business's owner can't be invited as a client.
  await expect(boss.mutation(api.clients.invite, { email: "heston@wranglerproductions.com" })).rejects.toThrow();
  await expect(w.t.withIdentity({ subject: w.hestonSub }).mutation(api.clients.invite, { email: "boss@other.example" })).rejects.toThrow();
});

test("finding 3: another business's contract never uses Wrangler's Stripe", async () => {
  const w = await world();
  expect(await w.t.query(internal.business.isDefault, { businessId: w.A })).toBe(true);
  expect(await w.t.query(internal.business.isDefault, { businessId: w.B })).toBe(false);
  expect(await w.t.query(internal.business.isDefault, { businessId: null })).toBe(true);
});

test("finding 4: another business's versions and notes never post to Wrangler's Slack", async () => {
  const w = await world();
  process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.example/x";
  const f = vi.fn(async () => new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", f);
  await w.t.action(internal.slack.versionReady, { versionId: w.b.ver });
  await w.t.action(internal.slack.versionReady, { versionId: w.b.ver, asBusiness: w.B });
  expect(f).not.toHaveBeenCalled();
  await w.t.action(internal.slack.versionReady, { versionId: w.a.ver });
  expect(f).toHaveBeenCalledTimes(1);
});

test("findings 5 and 7: what a client writes and schedules through a share belongs to the share's business", async () => {
  const w = await world();
  okFetch();
  const boss = w.t.withIdentity({ subject: w.bossSub });
  const sh = await boss.mutation(api.shares.create, share({ kind: "project", projectId: w.b.p }));
  // A client of A only, and a client of both A and B: neither stamps or schedules for A on B's share.
  for (const [email, bizs] of [["onlya@acme.example", [w.A]], ["both@acme.example", [w.A, w.B]]] as const) {
    const c = w.t.withIdentity({ subject: await client(w.t, email, [...bizs]) });
    const id = await c.mutation(api.notes.create, { versionId: w.b.ver, kind: "general", text: `from ${email}`, share: { token: sh.token } });
    const row = await w.t.run(async (ctx) => ctx.db.get(id as Id<"notes">));
    expect(row?.businessId).toBe(w.B);
  }
  const jobs = await w.t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
  const carried = jobs.map((j) => (j.args[0] as { asBusiness?: string })?.asBusiness);
  expect(carried.length).toBeGreaterThan(0);
  expect(carried.every((b) => b === w.B)).toBe(true);
  // Nothing landed in A.
  const inA = await w.t.run(async (ctx) => (await ctx.db.query("notes").collect()).filter((n) => n.businessId === w.A).length);
  expect(inA).toBe(1);
});

test("finding 6: a guest's upload check acts for the share's business", async () => {
  const w = await world();
  okFetch();
  const boss = w.t.withIdentity({ subject: w.bossSub });
  const sh = await boss.mutation(api.shares.create, share({ kind: "client", client: "Acme" }));
  // With no identity (as the upload actions call it): B's token covers B's version, not A's.
  expect(await w.t.mutation(internal.shares.assertCanComment, { versionId: w.b.ver, share: { token: sh.token, guestName: "G" } })).toBe(w.B);
  await expect(w.t.mutation(internal.shares.assertCanComment, { versionId: w.a.ver, share: { token: sh.token, guestName: "G" } })).rejects.toThrow();
  // The recording's row then belongs to B.
  const storageId = await w.t.run(async (ctx) => ctx.storage.store(new Blob(["x"], { type: "audio/webm" })));
  await w.t.mutation(internal.notes.registerVoice, { storageId, versionId: w.b.ver, asBusiness: w.B });
  const row = await w.t.run(async (ctx) => (await ctx.db.query("voiceUploads").collect())[0]);
  expect(row?.businessId).toBe(w.B);
});

// ---------- second review (Oct 28) ----------

test("second review 1: a browser upload's pipeline acts for its business; new-version emails stay in it", async () => {
  const w = await world();
  okFetch();
  const boss = w.t.withIdentity({ subject: w.bossSub });
  const heston = w.t.withIdentity({ subject: w.hestonSub });
  // Wrangler's invited "Acme" share, wanting new-version emails.
  const ash = await heston.mutation(api.shares.create, { ...share({ kind: "client", client: "Acme" }, "invited"), emailNewVersions: true });
  await heston.mutation(api.shares.addMember, { shareId: ash.shareId, email: "maya@acme.example" });
  // B's owner finishes a browser upload: the poll job carries B.
  await boss.action(api.uploads.uploadFinished, { versionId: w.b.ver });
  const jobs = await w.t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
  const poll = jobs.find((j) => j.name.includes("poll"));
  expect((poll?.args[0] as { asBusiness?: string })?.asBusiness).toBe(w.B);
  // Whoever asks, B's new version never reaches Wrangler's client.
  for (const args of [{ versionId: w.b.ver }, { versionId: w.b.ver, asBusiness: w.B }]) {
    const d = await w.t.query(internal.emails.newVersionData, args);
    expect(JSON.stringify(d?.people ?? [])).not.toContain("maya@acme.example");
  }
  expect(JSON.stringify((await w.t.query(internal.emails.newVersionData, { versionId: w.a.ver }))?.people)).toContain("maya@acme.example");
});

test("second review 2: Shared with me lists only shares from businesses that still invite you; revoking ends the membership", async () => {
  const w = await world();
  okFetch();
  const boss = w.t.withIdentity({ subject: w.bossSub });
  const heston = w.t.withIdentity({ subject: w.hestonSub });
  const c = w.t.withIdentity({ subject: await client(w.t, "both@acme.example", [w.A, w.B]) });
  const bsh = await boss.mutation(api.shares.create, share({ kind: "project", projectId: w.b.p }, "invited"));
  await boss.mutation(api.shares.addMember, { shareId: bsh.shareId, email: "both@acme.example" });
  const ash = await heston.mutation(api.shares.create, share({ kind: "project", projectId: w.a.p }, "invited"));
  await heston.mutation(api.shares.addMember, { shareId: ash.shareId, email: "both@acme.example" });
  expect(JSON.stringify(await c.query(api.shares.mine, {}))).toContain("B PRIVATE CUT");
  const inv = await w.t.run(async (ctx) => (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", "both@acme.example")).collect()).find((i) => i.businessId === w.B)!._id);
  await boss.mutation(api.clients.revokeInvite, { inviteId: inv });
  const mine = JSON.stringify(await c.query(api.shares.mine, {}));
  expect(mine).not.toContain("B PRIVATE CUT");
  expect(mine).toContain("A SECRET CUT");
  const live = await w.t.run(async (ctx) => (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", "both@acme.example")).collect()).filter((m) => !m.revokedAt).map((m) => m.businessId));
  expect(live).toEqual([w.A]);
});

test("second review 3: a signed-in client's stills and voice notes on another business's share belong to it", async () => {
  const w = await world();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "x", language_code: "en", words: [{ text: "hi", start: 0, end: 0.5, type: "word" }] }), { status: 200 })));
  process.env.ELEVENLABS_API_KEY = "el-test";
  const boss = w.t.withIdentity({ subject: w.bossSub });
  const sh = await boss.mutation(api.shares.create, share({ kind: "project", projectId: w.b.p }));
  for (const [email, bizs] of [["onlya@acme.example", [w.A]], ["both@acme.example", [w.A, w.B]]] as const) {
    const c = w.t.withIdentity({ subject: await client(w.t, email, [...bizs]) });
    const ref = { token: sh.token, guestName: "C" };
    await c.action(api.stills.upload, { dataBase64: "AAAA", contentType: "image/jpeg", versionId: w.b.ver, share: ref });
    const storageId = await w.t.run(async (ctx) => ctx.storage.store(new Blob(["x"], { type: "audio/webm" })));
    await c.action(api.transcribe.voiceWords, { storageId, mime: "audio/webm", versionId: w.b.ver, share: ref });
    await c.mutation(api.notes.create, { versionId: w.b.ver, kind: "general", text: "", share: ref, voice: { storageId, mime: "audio/webm", durationMs: 500, played: true, words: [], pointers: [] } });
  }
  const tags = await w.t.run(async (ctx) => [...(await ctx.db.query("stillFiles").collect()), ...(await ctx.db.query("voiceUploads").collect())].map((r) => r.businessId));
  expect(tags.length).toBe(4);
  expect(tags.every((b) => b === w.B)).toBe(true);
  delete process.env.ELEVENLABS_API_KEY;
});

test("second review 4: re-running bootstrap never makes another business's client a Wrangler client", async () => {
  const w = await world();
  okFetch();
  await w.t.withIdentity({ subject: w.bossSub }).mutation(api.clients.invite, { email: "puppet@evil.example" });
  await w.t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email: "puppet@evil.example", password: "longenoughpassword" } });
  await w.t.mutation(internal.business.bootstrap, {});
  const ms = await w.t.run(async (ctx) => (await ctx.db.query("memberships").withIndex("by_email", (q) => q.eq("email", "puppet@evil.example")).collect()).map((m) => m.businessId));
  expect(ms).toEqual([w.B]);
});
