// Client side C1 (Oct 23): the access matrix. Every public function the site has is called as nobody, as a
// stranger with an account, and as an invited client. All of them must be refused, except the few that are meant
// to answer (listed in OPEN / SIGNED_IN below). The list of functions is read from the generated API, so a new
// function can't slip through without being classified here.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const modules = import.meta.glob("../convex/**/*.ts");

beforeAll(async () => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.DROPBOX_APP_KEY = "test-key";
  process.env.DROPBOX_APP_SECRET = "test-secret";
  process.env.BUNNY_STREAM_LIBRARY_ID = "785477";
  process.env.BUNNY_STREAM_API_KEY = "bunny-test";
  process.env.RESEND_API_KEY = "re_test";
  process.env.SITE_URL = "https://review.wranglerportal.com";
  process.env.CONVEX_SITE_URL = "https://handsome-hummingbird-11.convex.site";
  // Convex Auth mints a JWT once a code is accepted; a throwaway RSA pair made here, never a real key.
  const { generateKeyPairSync } = await import("node:crypto");
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.JWT_PRIVATE_KEY = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwk = pair.publicKey.export({ format: "jwk" });
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...jwk }] });
});
afterEach(() => vi.unstubAllGlobals());

// Functions anyone may call, and why.
const OPEN: Record<string, string> = {
  "users.me": "returns the caller's own identity, or null",
  "phase0.saveRun": "lab test log: append-only, capped, holds no client data",
  "shares.open": "a share link: answers by the share's own gate (off/expired/passcode/invited), tested in shares.test.ts",
  "shares.touch": "records an open on a share link: same gate; a missing token records nothing",
  "shares.unlock": "the passcode box on a share link: rate-limited; a missing token answers 'missing'",
  "clients.canSignUp": "the sign-up page's pre-check: says only whether an email is invited",
  "prefs.mine": "the owner's display settings: the video page asks whoever is looking; anyone but the owner gets {}",
};
// Functions with their own gate (a key in the arguments): refused with the wrong key, whoever calls.
const KEYED = new Set(["r1results.report"]);
// Functions any signed-in account may call (owner or client), never a stranger.
const SIGNED_IN = new Set(["users.setName", "clients.account", "shares.mine"]);

type Ids = { requestId: Id<"wsRequests">; buildId: Id<"wsBuilds">; templateId: Id<"wsTemplates">; clauseId: Id<"wsClauses">; styleId: Id<"wsStyles">; docId: Id<"wsDocuments">; wsVersionId: Id<"wsVersions">; projectId: Id<"projects">; videoId: Id<"videos">; shareId: Id<"shares">; replyId: Id<"replies">; versionId: Id<"versions">; noteId: Id<"notes">; fileId: Id<"dropFiles">; inviteId: Id<"invites">; keyId: Id<"connectorKeys">; storageId: Id<"_storage"> };

// Minimal valid arguments for each function, so the access check (not argument validation) is what refuses.
function argsFor(ids: Ids): Record<string, Record<string, unknown>> {
  return {
    "activity.feed": {},
    "clients.invite": { email: "x@example.com" }, "clients.canSignUp": { email: "x@example.com" }, "clients.revokeInvite": { inviteId: ids.inviteId }, "clients.listInvites": {}, "clients.account": {},
    "connector.createKey": {}, "connector.listKeys": {}, "connector.revokeKey": { keyId: ids.keyId },
    "dropbox.status": {}, "dropbox.flagged": {}, "dropbox.retryFlagged": { fileId: ids.fileId }, "dropbox.registerFlagged": { fileId: ids.fileId }, "dropbox.authUrl": {}, "dropbox.disconnect": {}, "dropbox.syncNow": {},
    "library.projectNames": {}, "library.overview": {}, "library.createClient": { name: "X" }, "library.markOpened": { videoId: ids.videoId },
    "library.renameProject": { projectId: ids.projectId, name: "X" }, "library.setVersionDescription": { versionId: ids.versionId, description: "x" },
    "library.createProject": { name: "X" }, "library.createVideo": { projectId: ids.projectId, title: "X" }, "library.renameVideo": { videoId: ids.videoId, title: "X" },
    "library.video": { videoId: ids.videoId }, "library.setStartTimecode": { versionId: ids.versionId, startTimecode: "01:00:00:00" },
    "library.reportFrameCount": { versionId: ids.versionId, frameCount: 10 }, "library.deleteVersion": { versionId: ids.versionId }, "library.deleteProject": { projectId: ids.projectId }, "library.setPoster": { versionId: ids.versionId, url: "https://wrangler-review-stills.b-cdn.net/stills/2026/10/a.jpg" }, "views.forVideo": { videoId: ids.videoId }, "views.beat": { versionId: ids.versionId, session: "abcdefgh12345678", watchedSec: 1, posSec: 1, lengthSec: 10 }, "library.deleteVideo": { videoId: ids.videoId }, "library.deleteVideos": { videoIds: [ids.videoId] },
    "library.deleteClient": { client: "X", typed: "X" }, "library.approveFinal": { videoId: ids.videoId, keep: 1 }, "library.clearFinal": { videoId: ids.videoId },
    "notes.forVersion": { versionId: ids.versionId }, "notes.create": { versionId: ids.versionId, kind: "general", text: "x" }, "notes.editText": { noteId: ids.noteId, text: "y" },
    "notes.setStatus": { noteId: ids.noteId, status: "done" }, "notes.setVisibility": { noteId: ids.noteId, visibility: "shared" }, "notes.setReplyHidden": { replyId: ids.replyId, hidden: false }, "notes.remove": { noteId: ids.noteId }, "notes.reply": { noteId: ids.noteId, text: "r" },
    "notes.voiceUploadUrl": {}, "notes.discardVoice": { storageId: ids.storageId },
    "phase0.saveRun": { label: "l", device: "d", browser: "b", source: "s", engine: "e", pass: true, userAgent: "ua", results: {}, misses: [] }, "phase0.listRuns": {},
    "player.log": { versionId: ids.versionId, kind: "error" }, "player.fileFailed": { versionId: ids.versionId },
    "prefs.mine": {}, "prefs.set": { key: "details", value: [] },
    "r1results.report": { k: "wrong", device: "d", rows: "r" },
    "shares.create": { target: { kind: "video", videoId: ids.videoId }, access: "view", who: "link", allVersions: true, downloads: false, emailNewVersions: false },
    "shares.update": { shareId: ids.shareId, access: "comment" }, "shares.setOff": { shareId: ids.shareId, off: true }, "shares.remove": { shareId: ids.shareId },
    "shares.addMember": { shareId: ids.shareId, email: "x@example.com" }, "shares.removeMember": { shareId: ids.shareId, email: "x@example.com" }, "shares.resendInvite": { shareId: ids.shareId, email: "x@example.com" },
    "shares.list": {}, "shares.forTarget": { target: { kind: "video", videoId: ids.videoId } }, "shares.coveringVideo": { videoId: ids.videoId }, "shares.activity": { shareId: ids.shareId },
    "shares.open": { token: "nope" }, "shares.touch": { token: "nope", kind: "opened" }, "shares.unlock": { token: "nope", passcode: "x" }, "shares.mine": {},
    "register.list": {}, "register.nextName": { videoId: ids.videoId }, "register.newVideo": { title: "X", shortTitle: "X", projectName: "P" }, "register.setShortTitle": { videoId: ids.videoId, shortTitle: "X" },
    "register.addToRegister": { videoId: ids.videoId, shortTitle: "X" }, "register.makeSheetKey": {}, "register.sheetKey": {}, "register.removeSheetKey": {},
    "stills.upload": { dataBase64: "AA==", contentType: "image/jpeg" },
    "transcribe.voiceWords": { storageId: ids.storageId, mime: "audio/webm" },
    "transcripts.retry": { versionId: ids.versionId }, "transcripts.forVersion": { versionId: ids.versionId },
    "uploads.startUpload": { videoId: ids.videoId, fileName: "a.mp4", fileSize: 1 }, "uploads.uploadFinished": { versionId: ids.versionId }, "uploads.uploadFailed": { versionId: ids.versionId, error: "x" },
    "users.me": {}, "users.setName": { name: "N" },
    "waveforms.forVersion": { versionId: ids.versionId },
    "sign.list": {}, "sign.get": { documentId: ids.docId }, "sign.ownerSignature": {}, "sign.uploadUrl": {},
    "sign.create": { storageId: ids.storageId, fileName: "a.pdf" }, "sign.replaceFile": { documentId: ids.docId, storageId: ids.storageId, fileName: "a.pdf" },
    "sign.saveLayout": { versionId: ids.wsVersionId, title: "T", signers: [], boxes: [], signingOrder: "any", payment: null },
    "sign.approve": { versionId: ids.wsVersionId }, "sign.revise": { documentId: ids.docId }, "sign.remove": { documentId: ids.docId },
    "sign.adoptSignature": { name: "N", title: "T", method: "typed", signatureStorageId: ids.storageId, initialsStorageId: ids.storageId },
    "sign.preview": { versionId: ids.wsVersionId },
    "sign.send": { versionId: ids.wsVersionId }, "sign.voidDocument": { documentId: ids.docId }, "sign.resend": { documentId: ids.docId, signerKey: "client" },
    "sign.extendExpiry": { documentId: ids.docId, days: 7 },
    "sign.requestsFor": { documentId: ids.docId }, "sign.pendingRequests": {}, "sign.decideRequest": { requestId: ids.requestId, confirm: false },
    "signDone.retry": { documentId: ids.docId, step: "copies" }, "signDone.downloadAudit": { documentId: ids.docId },
    "wsArchive.status": {}, "wsArchive.authUrl": {}, "wsArchive.disconnect": {},
    "builder.getProfile": {}, "builder.saveProfile": { business: { name: "", legalName: "", contact: "", title: "", email: "", phone: "", address: "" } },
    "builder.listBuilds": {}, "builder.getBuild": { buildId: ids.buildId }, "builder.createBuild": {}, "builder.saveBuild": { buildId: ids.buildId, title: "T", blocks: [], fields: {}, signers: [], style: {} },
    "builder.deleteBuild": { buildId: ids.buildId }, "builder.toSigning": { buildId: ids.buildId, storageId: ids.storageId },
    "builder.listTemplates": {}, "builder.getTemplate": { templateId: ids.templateId }, "builder.saveAsTemplate": { name: "N", title: "T", blocks: [], fields: {}, signers: [], style: {} },
    "builder.updateTemplate": { templateId: ids.templateId, name: "N", blocks: [], fields: {}, style: {} }, "builder.duplicateTemplate": { templateId: ids.templateId }, "builder.deleteTemplate": { templateId: ids.templateId }, "builder.ensureStarter": {},
    "builder.listClauses": {}, "builder.saveClause": { title: "C", body: {}, initials: false }, "builder.duplicateClause": { clauseId: ids.clauseId }, "builder.deleteClause": { clauseId: ids.clauseId },
    "builder.listStyles": {}, "builder.saveStyle": { name: "S", style: {} }, "builder.setDefaultStyle": { styleId: ids.styleId }, "builder.deleteStyle": { styleId: ids.styleId },
    "builder.uploadUrl": {}, "builder.fileUrls": { ids: [ids.storageId] }, "builder.checkImage": { storageId: ids.storageId },
    "builder.listFonts": {}, "builder.addFont": { storageId: ids.storageId, family: "F", weight: 400, italic: false, fileName: "f.ttf", source: "upload" }, "builder.deleteFont": { family: "F" }, "builder.ensureGoogleFont": { family: "Lora" }, "builder.importPdf": { storageId: ids.storageId },
    "wsConnector.createKey": {}, "wsConnector.listKeys": {}, "wsConnector.revokeKey": { keyId: ids.wsKeyId },
  };
}

// Every public function in convex/*.ts (read from the source, since the generated `api` is a proxy with no keys).
function publicFunctions(): Array<{ key: string; ref: any }> {
  const dir = join(__dirname, "..", "convex");
  const out: Array<{ key: string; ref: any }> = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts")).sort()) {
    const mod = file.slice(0, -3);
    if (mod === "auth") continue; // Convex Auth's own signIn/signOut, exercised in the sign-up tests
    const src = readFileSync(join(dir, file), "utf8");
    for (const m of src.matchAll(/^export const (\w+) = (query|mutation|action)\(/gm)) out.push({ key: `${mod}.${m[1]}`, ref: (anyApi as any)[mod][m[1]] });
  }
  return out;
}

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    const stranger = await ctx.db.insert("users", { email: "nobody@example.com", name: "Nobody" });
    const client = await ctx.db.insert("users", { email: "client@example.com", name: "Client", role: "client" });
    const sess = async (userId: Id<"users">) => `${userId}|${await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })}`;
    const projectId = await ctx.db.insert("projects", { name: "P", createdAt: 0 });
    const videoId = await ctx.db.insert("videos", { projectId, title: "V", createdAt: 0, updatedAt: 0 });
    const versionId = await ctx.db.insert("versions", { videoId, number: 1, status: "ready", bunnyGuid: "g", fileName: "a.mp4", startTimecode: "01:00:00:00", createdAt: 0 } as never);
    const noteId = await ctx.db.insert("notes", { versionId, videoId, kind: "general", text: "n", status: "open", authorName: "Heston", createdAt: 0, updatedAt: 0 } as never);
    const replyId = await ctx.db.insert("replies", { noteId, text: "r", authorName: "Claude", createdAt: 0, hidden: true });
    const fileId = await ctx.db.insert("dropFiles", { pathLower: "/x.mp4", pathDisplay: "/x.mp4", rev: "r", size: 1, status: "flagged", firstSeenAt: 0, lastChangeAt: 0, checks: 0 } as never);
    const inviteId = await ctx.db.insert("invites", { email: "client@example.com", createdAt: 0, acceptedAt: 0, userId: client });
    const keyId = await ctx.db.insert("connectorKeys", { hash: "h", prefix: "wr_x", label: "k", createdAt: 0 } as never);
    const shareId = await ctx.db.insert("shares", { token: "tok", kind: "video", videoId, access: "view", who: "link", allVersions: true, downloads: false, emailNewVersions: false, createdAt: 0, createdBy: owner });
    const storageId = await ctx.storage.store(new Blob(["x"]));
    const docId = await ctx.db.insert("wsDocuments", { number: 1, title: "D", status: "draft", currentVersion: 1, createdAt: 0, updatedAt: 0 });
    const wsKeyId = await ctx.db.insert("wsConnectorKeys", { hash: "x", prefix: "ws_x", label: "t", createdAt: 0 });
    const wsVersionId = await ctx.db.insert("wsVersions", { documentId: docId, number: 1, fileId: storageId, fileName: "a.pdf", fileSha256: "0", fileBytes: 1, pages: [{ width: 612, height: 792, rotate: 0 }], signers: [], boxes: [], signingOrder: "any", createdAt: 0, updatedAt: 0 });
    const requestId = await ctx.db.insert("wsRequests", { documentId: docId, what: "approve", versionNumber: 1, said: "x", status: "pending", createdAt: Date.now() });
    const buildId = await ctx.db.insert("wsBuilds", { title: "B", blocks: [], fields: {}, style: {}, signers: [], createdAt: 0, updatedAt: 0 });
    const templateId = await ctx.db.insert("wsTemplates", { name: "T", blocks: [], fields: {}, style: {}, createdAt: 0, updatedAt: 0 });
    const clauseId = await ctx.db.insert("wsClauses", { title: "C", body: {}, initials: false, createdAt: 0, updatedAt: 0 });
    const styleId = await ctx.db.insert("wsStyles", { name: "S", style: {}, isDefault: false, createdAt: 0, updatedAt: 0 });
    return { requestId, buildId, templateId, clauseId, styleId, docId, wsVersionId, wsKeyId, projectId, videoId, versionId, noteId, fileId, inviteId, keyId, storageId, shareId, replyId, ownerSub: await sess(owner), strangerSub: await sess(stranger), clientSub: await sess(client) };
  });
  return { t, ids };
}

// Call a function of any kind the way the page would.
async function call(t: ReturnType<typeof convexTest>, ref: any, args: Record<string, unknown>, kind: string) {
  const path = `${ref[Symbol.for("functionName")] ?? ""}`;
  void path;
  // convex-test picks the runner by the registered function's kind; try each.
  try { return await (t as any).query(ref, args); } catch (e) { if (!/not a query|is a (mutation|action)/i.test(String(e))) throw e; }
  try { return await (t as any).mutation(ref, args); } catch (e) { if (!/not a mutation|is an? (query|action)/i.test(String(e))) throw e; }
  return await (t as any).action(ref, args);
  void kind;
}

const denied = (e: unknown) => /Sign in first|Not allowed/.test(String((e as Error).message ?? e));

describe("access matrix", () => {
  test("every public function is classified", async () => {
    const { ids } = await setup();
    const table = argsFor(ids);
    const missing = publicFunctions().map((f) => f.key).filter((k) => !(k in table));
    expect(missing).toEqual([]);
  });

  for (const who of ["nobody", "stranger", "client"] as const) {
    test(`${who}: every function refuses, except the ones meant to answer`, async () => {
      const { t, ids } = await setup();
      vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 })); // nothing external may be reached
      const as = who === "nobody" ? t : t.withIdentity({ subject: who === "stranger" ? ids.strangerSub : ids.clientSub });
      const table = argsFor(ids);
      const results: Record<string, string> = {};
      for (const f of publicFunctions()) {
        const allowed = f.key in OPEN || (who === "client" && SIGNED_IN.has(f.key));
        if (KEYED.has(f.key)) { await expect(call(as, f.ref, table[f.key], "")).rejects.toThrow(/Not allowed/); results[f.key] = "denied (own key)"; continue; }
        try {
          await call(as, f.ref, table[f.key], "");
          results[f.key] = allowed ? "answered (expected)" : "ANSWERED";
        } catch (e) {
          if (denied(e)) results[f.key] = allowed ? `DENIED: ${(e as Error).message}` : "denied";
          else results[f.key] = allowed ? "answered (expected, other error)" : `OTHER: ${String((e as Error).message).slice(0, 80)}`;
        }
      }
      const bad = Object.entries(results).filter(([, r]) => /^(ANSWERED|DENIED|OTHER)/.test(r));
      expect(bad).toEqual([]);
      // r1results.report with a wrong key is refused by its own check, with a different message.
      expect(results["users.me"]).toMatch(/answered/);
    });
  }

  test("the owner is not refused", async () => {
    const { t, ids } = await setup();
    const me = t.withIdentity({ subject: ids.ownerSub });
    expect(await me.query(api.library.overview, {})).toBeTruthy();
    expect((await me.query(api.users.me, {}))?.role).toBe("owner");
    expect(await me.query(api.clients.listInvites, {})).toHaveLength(1);
  });

  test("a client sees their own identity and account, and nothing else", async () => {
    const { t, ids } = await setup();
    const c = t.withIdentity({ subject: ids.clientSub });
    expect((await c.query(api.users.me, {}))).toMatchObject({ role: "client", allowed: false });
    expect(await c.query(api.clients.account, {})).toMatchObject({ kind: "client", email: "client@example.com" });
    await c.mutation(api.users.setName, { name: "Casey" });
    expect((await c.query(api.clients.account, {})).name).toBe("Casey");
    await expect(c.query(api.library.overview, {})).rejects.toThrow(/Not allowed/);
    // The video page asks for the owner's display settings whoever is looking: a client (or a guest) gets {} back.
    expect(await c.query(api.prefs.mine, {})).toEqual({});
    expect(await t.query(api.prefs.mine, {})).toEqual({});
    await expect(c.mutation(api.prefs.set, { key: "details", value: [] })).rejects.toThrow(/Not allowed/);
  });
});

describe("who may make an account", () => {
  const signUp = (t: ReturnType<typeof convexTest>, email: string) =>
    t.action(api.auth.signIn, { provider: "password", params: { flow: "signUp", email, password: "longenoughpassword" } });

  test("an owner email and an invited email can; anyone else is refused; a code email goes out through Resend", async () => {
    const { t, ids } = await setup();
    const sent: string[] = [];
    const mails: Array<{ to: string; subject: string; text: string; from: string }> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); sent.push(b.to[0]); mails.push({ to: b.to[0], subject: b.subject, text: b.text, from: b.from }); return new Response(JSON.stringify({ id: "em_1" }), { status: 200 }); }
      return new Response("{}", { status: 500 });
    });
    const lastCode = () => /\b(\d{6})\b/.exec(mails[mails.length - 1].text)![1];
    await expect(signUp(t, "intruder@example.com")).rejects.toThrow(/hasn't been invited/);
    await t.withIdentity({ subject: ids.ownerSub }).mutation(api.clients.invite, { email: "New.Client@Example.com", name: "New Client" });
    const r = await signUp(t, "new.client@example.com") as { tokens?: unknown; started?: boolean };
    expect(r.tokens ?? null).toBeNull(); // no session yet: a code is needed first
    expect(sent).toEqual(["new.client@example.com"]);
    const user = await t.run(async (ctx) => (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", "new.client@example.com")).unique()));
    expect(user).toMatchObject({ role: "client", name: "New Client" });
    const inv = await t.run(async (ctx) => (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", "new.client@example.com")).unique()));
    expect(inv?.acceptedAt).toBeTypeOf("number");
    expect(mails[0]).toMatchObject({ from: "Wrangler Review <review@wranglerportal.com>" });
    expect(mails[0].subject).toMatch(/^\d{6} is your Wrangler Review code$/);
    // A wrong code is refused; the emailed one signs them in.
    await expect(t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: "new.client@example.com", code: "000000" } })).rejects.toThrow();
    const done = await t.action(api.auth.signIn, { provider: "password", params: { flow: "email-verification", email: "new.client@example.com", code: lastCode() } }) as { tokens?: unknown };
    expect(done.tokens).toBeTruthy();
    // Password reset: a code by email, then a new password that signs in; the old one no longer does.
    await t.action(api.auth.signIn, { provider: "password", params: { flow: "reset", email: "new.client@example.com" } });
    expect(mails[mails.length - 1].subject).toBe("Reset your Wrangler Review password");
    const reset = await t.action(api.auth.signIn, { provider: "password", params: { flow: "reset-verification", email: "new.client@example.com", code: lastCode(), newPassword: "anotherlongpassword" } }) as { tokens?: unknown };
    expect(reset.tokens).toBeTruthy();
    await expect(t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", email: "new.client@example.com", password: "longenoughpassword" } })).rejects.toThrow();
    const back = await t.action(api.auth.signIn, { provider: "password", params: { flow: "signIn", email: "new.client@example.com", password: "anotherlongpassword" } }) as { tokens?: unknown };
    expect(back.tokens).toBeTruthy();
    // A revoked invite can't be used.
    await t.withIdentity({ subject: ids.ownerSub }).mutation(api.clients.revokeInvite, { inviteId: ids.inviteId });
    await t.run(async (ctx) => { for (const u of await ctx.db.query("users").collect()) if (u.email === "client@example.com") await ctx.db.delete(u._id); });
    await expect(signUp(t, "client@example.com")).rejects.toThrow(/hasn't been invited/);
    // An owner's email is fine, and the owner can't be "invited".
    const o = await signUp(t, "heston@wranglerproductions.com").catch((e: Error) => e);
    expect(o instanceof Error ? o.message : "ok").not.toMatch(/hasn't been invited/);
    await expect(t.withIdentity({ subject: ids.ownerSub }).mutation(api.clients.invite, { email: "heston@wranglerproductions.com" })).rejects.toThrow(/owner/);
  }, 30_000);
});
