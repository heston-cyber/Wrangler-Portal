// The shared fixtures of the access matrix (moved here from access.test.ts in Phase 0.5d step 3, so the
// two-business isolation test can run the very same function list and arguments).
import { convexTest } from "convex-test";
import { anyApi } from "convex/server";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const modules = import.meta.glob("../convex/**/*.ts");

export type Ids = { requestId: Id<"wsRequests">; buildId: Id<"wsBuilds">; templateId: Id<"wsTemplates">; clauseId: Id<"wsClauses">; styleId: Id<"wsStyles">; docId: Id<"wsDocuments">; wsVersionId: Id<"wsVersions">; projectId: Id<"projects">; videoId: Id<"videos">; shareId: Id<"shares">; replyId: Id<"replies">; versionId: Id<"versions">; noteId: Id<"notes">; fileId: Id<"dropFiles">; inviteId: Id<"invites">; keyId: Id<"connectorKeys">; storageId: Id<"_storage"> };

// Minimal valid arguments for each function, so the access check (not argument validation) is what refuses.
export function argsFor(ids: Ids): Record<string, Record<string, unknown>> {
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
    "sign.requestsFor": { documentId: ids.docId }, "sign.setHidden": { documentId: ids.docId, hidden: true }, "sign.pendingRequests": {}, "sign.decideRequest": { requestId: ids.requestId, confirm: false },
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
export function publicFunctions(): Array<{ key: string; ref: any }> {
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

export async function setup() {
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
export async function call(t: ReturnType<typeof convexTest>, ref: any, args: Record<string, unknown>, kind: string) {
  const path = `${ref[Symbol.for("functionName")] ?? ""}`;
  void path;
  // convex-test picks the runner by the registered function's kind; try each.
  try { return await (t as any).query(ref, args); } catch (e) { if (!/not a query|is a (mutation|action)/i.test(String(e))) throw e; }
  try { return await (t as any).mutation(ref, args); } catch (e) { if (!/not a mutation|is an? (query|action)/i.test(String(e))) throw e; }
  return await (t as any).action(ref, args);
  void kind;
}

