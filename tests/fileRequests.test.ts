// Phase 4 · file requests. T4.4: an upload lands in the request's folder in Dropbox (small files straight there, big
// ones in 8 MB pieces through the portal), whatever the size up to 2 GB. T4.5: an upload can't be reused, pointed at
// another request or project, or sent by someone who can't open the project. Plus emails 31 and 32, the owner's
// note, and the render watcher ignoring File requests/. Dropbox is faked.
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { anyApi } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { world } from "./payHarness";
import { todayCentral } from "../convex/lib/bookings";
import { placeFor } from "../convex/lib/dropboxPath";
import { CHUNK, DIRECT_MAX, safeName } from "../convex/fileRequests";

const api = anyApi;
beforeAll(() => {
  process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com";
  process.env.SITE_URL = "https://app.wranglerportal.com";
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_ONLY_TO = "";
  process.env.DROPBOX_APP_KEY = "k"; process.env.DROPBOX_APP_SECRET = "s";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

type W = Awaited<ReturnType<typeof world>>;
type Sent = { to: string; subject: string; text: string };
const day = (n: number) => { const d = new Date(`${todayCentral()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** A fake Dropbox (temporary upload links, upload sessions, metadata) and Resend. */
function fake() {
  const s = { mails: [] as Sent[], files: new Map<string, number>(), sessions: new Map<string, number>(), links: [] as Array<{ path: string }>, calls: [] as string[], finishFails: 0, finishCommits: false };
  const add = (path: string, size: number) => { let p = path; let n = 1; while ([...s.files.keys()].some((k) => k.toLowerCase() === p.toLowerCase())) p = path.replace(/(\.[^./]+)?$/, ` (${n++})$1`); s.files.set(p, size); return p; };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
    if (url === "https://api.resend.com/emails") { const b = JSON.parse(String(init?.body)); s.mails.push({ to: b.to[0], subject: b.subject, text: b.text }); return ok({ id: "em" }); }
    if (url === "https://api.dropboxapi.com/oauth2/token") return ok({ access_token: "at", expires_in: 14400 });
    const h = (init?.headers ?? {}) as Record<string, string>;
    s.calls.push(url.replace(/^https:\/\/[^/]+\/2/, ""));
    if (url === "https://api.dropboxapi.com/2/files/get_temporary_upload_link") { const b = JSON.parse(String(init?.body)); expect(b.commit_info.autorename).toBe(false); s.links.push({ path: b.commit_info.path }); return ok({ link: `https://content.dropboxapi.com/apitul/1/link${s.links.length}` }); }
    if (url === "https://api.dropboxapi.com/2/files/list_folder") { const b = JSON.parse(String(init?.body)); const kids = [...s.files.keys()].filter((k) => k.toLowerCase().startsWith(`${b.path.toLowerCase()}/`)); return kids.length ? ok({ entries: kids.map((k) => ({ ".tag": "file", name: k.split("/").pop() })), has_more: false }) : new Response(JSON.stringify({ error_summary: "path/not_found/" }), { status: 409 }); }
    if (url === "https://api.dropboxapi.com/2/files/get_metadata") { const b = JSON.parse(String(init?.body)); const size = s.files.get(b.path); return size === undefined ? new Response(JSON.stringify({ error_summary: "path/not_found/" }), { status: 409 }) : ok({ ".tag": "file", path_display: b.path, name: b.path.split("/").pop(), size }); }
    const arg = h["Dropbox-API-Arg"] ? JSON.parse(h["Dropbox-API-Arg"]) : null;
    const len = (init?.body as ArrayBuffer | undefined)?.byteLength ?? 0;
    if (url.endsWith("/files/upload_session/start")) { const id = `sess${s.sessions.size + 1}`; s.sessions.set(id, len); return ok({ session_id: id }); }
    if (url.endsWith("/files/upload_session/append_v2")) {
      const have = s.sessions.get(arg.cursor.session_id)!;
      if (have !== arg.cursor.offset) return new Response(JSON.stringify({ error_summary: "incorrect_offset/", error: { ".tag": "incorrect_offset", correct_offset: have } }), { status: 409 });
      s.sessions.set(arg.cursor.session_id, have + len); return ok(null);
    }
    if (url.endsWith("/files/upload_session/finish")) {
      const have = s.sessions.get(arg.cursor.session_id)!;
      if (have !== arg.cursor.offset) return new Response(JSON.stringify({ error_summary: "incorrect_offset/" }), { status: 409 });
      if (s.finishFails > 0) { s.finishFails--; if (s.finishCommits) { add(arg.commit.path, have); s.finishCommits = false; } return new Response("{}", { status: 503 }); }
      if (s.files.has(arg.commit.path)) return new Response(JSON.stringify({ error_summary: "path/conflict/" }), { status: 409 });
      const p = add(arg.commit.path, have); return ok({ path_display: p, name: p.split("/").pop(), size: have });
    }
    return new Response("{}", { status: 500 });
  }));
  return s;
}
const settle = async (w: W) => { vi.useFakeTimers(); await w.t.finishAllScheduledFunctions(vi.runAllTimers); vi.useRealTimers(); };

async function setup(w: W) {
  await w.t.run(async (ctx) => {
    const owner = (await ctx.db.query("users").first())!._id;
    const s = await ctx.db.insert("shares", { businessId: w.A, token: "tok-proj-1", kind: "project", projectId: w.p, access: "comment", who: "invited", allVersions: true, downloads: false, emailNewVersions: true, createdAt: 0, createdBy: owner });
    await ctx.db.insert("shareMembers", { businessId: w.A, shareId: s, email: "maya@harbor.example", addedAt: 0 });
    await ctx.db.insert("dropbox", { businessId: w.A, accountId: "dbid", email: "heston@x.com", refreshToken: "rt", accessToken: "at", accessExpiresAt: Date.now() + 3_600_000, connectedAt: 0 });
  });
}
const ask = (w: W, more: Record<string, unknown> = {}) => w.heston.mutation(api.fileRequests.create, { projectId: w.p, title: "Upload your logo and brand guide", details: "Your logo (SVG or PNG) and the brand guide.", due: day(5), remind: true, ...more }) as Promise<{ requestId: Id<"fileRequests">; told: number; folder: string }>;

/** What the browser does for a big file: every piece, in order, to /upload/chunk; then an empty post at the end until
 *  the portal says it's saved (retrying a 502 like the page does). */
async function sendPieces(w: W, token: string, size: number) {
  let offset = 0, res: Record<string, unknown> = {}, tries = 0;
  for (;;) {
    const len = Math.max(0, Math.min(CHUNK, size - offset));
    const r = await w.t.fetch(`/upload/chunk?t=${token}&o=${offset}`, { method: "POST", body: new Uint8Array(len) });
    res = await r.json() as Record<string, unknown>;
    if (r.status === 200 && res.done) return res;
    if ((r.status === 200 || r.status === 409) && typeof res.offset === "number") { offset = res.offset; continue; }
    if (r.status === 502 && ++tries <= 4) continue;
    throw new Error(`${r.status} ${JSON.stringify(res)}`);
  }
}

describe("file requests", () => {
  test("ask → Inbox and email 31 → files land in the request's folder (small and big) → the owner hears once", async () => {
    const w = await world();
    const s = fake();
    await setup(w);
    const { requestId, told, folder } = await ask(w);
    expect(told).toBe(1);
    expect(folder).toBe("/File requests/Harbor Coffee/26127 Launch/Logo and brand guide");
    const item = await w.t.run(async (ctx) => (await ctx.db.query("inboxItems").collect()).find((i) => i.kind === "files"));
    expect(item).toMatchObject({ email: "maya@harbor.example", title: "Files requested: logo and brand guide", link: `/requests/${requestId}` });
    await settle(w);
    const m31 = s.mails.find((m) => m.subject === "Heston asked for files: Logo and brand guide" || m.subject.endsWith("asked for files: Logo and brand guide"))!;
    expect(m31.to).toBe("maya@harbor.example");
    expect(m31.text).toContain("up to 2 GB a file");
    expect(m31.text).toContain(`https://app.wranglerportal.com/requests/${requestId}`);

    // A small file: a one-time Dropbox link, then the portal checks Dropbox has all of it.
    const small = await w.maya.action(api.fileRequests.start, { requestId, name: "harbor-logo.svg", size: 52_000 });
    expect(small).toMatchObject({ mode: "direct", url: expect.stringMatching(/^https:\/\/content\.dropboxapi\.com\//) });
    expect(s.links[0].path).toBe(`${folder}/harbor-logo.svg`);
    await expect(w.maya.action(api.fileRequests.finishDirect, { uploadId: small.uploadId })).rejects.toThrow(/doesn't have the file yet/);
    s.files.set(`${folder}/harbor-logo.svg`, 52_000); // the browser's upload arrived (Dropbox answers only a content hash)
    expect(await w.maya.action(api.fileRequests.finishDirect, { uploadId: small.uploadId })).toEqual({ name: "harbor-logo.svg" });
    expect(await w.maya.action(api.fileRequests.finishDirect, { uploadId: small.uploadId })).toEqual({ name: "harbor-logo.svg" }); // once
    // The same name again gets its own: "harbor-logo (2).svg"; a file of the wrong size isn't recorded.
    const again = await w.maya.action(api.fileRequests.start, { requestId, name: "harbor-logo.svg", size: 10 });
    expect(s.links[1].path).toBe(`${folder}/harbor-logo (2).svg`);
    s.files.set(`${folder}/harbor-logo (2).svg`, 140_000_000);
    await expect(w.maya.action(api.fileRequests.finishDirect, { uploadId: again.uploadId })).rejects.toThrow(/isn't the size/);

    // A big file: pieces of 8 MB through the portal; the last one finishes it in Dropbox.
    const size = DIRECT_MAX + CHUNK + 1234;
    const big = await w.maya.action(api.fileRequests.start, { requestId, name: "B-roll / menu: boards?.mov", size });
    expect(big).toMatchObject({ mode: "chunks", chunk: CHUNK });
    // A piece out of order is told where to pick up; a wrong-sized piece is refused.
    expect((await w.t.fetch(`/upload/chunk?t=${big.token}&o=${CHUNK}`, { method: "POST", body: new Uint8Array(CHUNK) })).status).toBe(409);
    expect((await w.t.fetch(`/upload/chunk?t=${big.token}&o=0`, { method: "POST", body: new Uint8Array(100) })).status).toBe(400);
    // Committing fails twice (once after Dropbox actually saved it): the retries find it, and it's recorded once.
    s.finishFails = 2; s.finishCommits = true;
    expect(await sendPieces(w, big.token, size)).toEqual({ done: true, name: "B-roll menu boards.mov" });
    expect(s.files.get(`${folder}/B-roll menu boards.mov`)).toBe(size);
    // A lost reply to the last piece: asking again says it's done.
    expect(await (await w.t.fetch(`/upload/chunk?t=${big.token}&o=0`, { method: "POST", body: new Uint8Array(CHUNK) })).json()).toEqual({ done: true, name: "B-roll menu boards.mov" });

    const page = await w.maya.query(api.fileRequests.page, { requestId });
    expect(page.files.map((f: { name: string }) => f.name)).toEqual(["harbor-logo.svg", "B-roll menu boards.mov"]);
    expect((await w.heston.query(api.fileRequests.forProject, { projectId: w.p })).requests[0].files).toHaveLength(2);
    await settle(w);
    // The owner's note waits 10 minutes after each file; only the run for the last file sends (one email a sitting).
    const runs = await w.t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((j) => j.name === "fileRequests:mailOwner").map((j) => j.args[0] as { requestId: string; at: number }));
    expect(runs).toHaveLength(2);
    for (const r of runs) await w.t.action(anyApi.fileRequests.mailOwner, { requestId: r.requestId, at: r.at });
    const owner = s.mails.filter((m) => m.to === "heston@wranglerproductions.com");
    expect(owner.map((m) => m.subject)).toEqual(["Maya Brooks uploaded 2 files: Logo and brand guide"]);
    expect(owner[0].text).toContain("Apps › Wrangler Review › File requests › Harbor Coffee › 26127 Launch › Logo and brand guide");
  });

  test("T4.5 uploads can't be reused, moved or sent by others; size and status checks", async () => {
    const w = await world();
    fake();
    await setup(w);
    const { requestId } = await ask(w);
    await expect(w.jo.action(api.fileRequests.start, { requestId, name: "x.pdf", size: 10 })).rejects.toThrow(/isn't here/);
    expect(await w.jo.query(api.fileRequests.page, { requestId })).toBeNull();
    await expect(w.boss.action(api.fileRequests.start, { requestId, name: "x.pdf", size: 10 })).rejects.toThrow();
    await expect(w.maya.action(api.fileRequests.start, { requestId, name: "huge.mov", size: 2 * 1024 ** 3 + 1 })).rejects.toThrow(/over 2 GB/);
    await expect(w.maya.action(api.fileRequests.start, { requestId, name: "empty.txt", size: 0 })).rejects.toThrow(/empty/);
    const up = await w.maya.action(api.fileRequests.start, { requestId, name: "x.pdf", size: 10 });
    await expect(w.jo.action(api.fileRequests.finishDirect, { uploadId: up.uploadId })).rejects.toThrow(/isn't open/);
    // A closed request takes nothing more; reopened, it does.
    await w.heston.mutation(api.fileRequests.setStatus, { requestId, status: "closed" });
    await expect(w.maya.action(api.fileRequests.start, { requestId, name: "y.pdf", size: 10 })).rejects.toThrow(/closed this request/);
    const big = await w.t.run(async (ctx) => (await ctx.db.query("fileUploads").collect()).length);
    expect(big).toBe(1);
    await w.heston.mutation(api.fileRequests.setStatus, { requestId, status: "open" });
    await w.maya.action(api.fileRequests.start, { requestId, name: "y.pdf", size: 10 });
    // Cancelled: gone from the client, and an upload already on its way isn't recorded.
    const late = await w.maya.action(api.fileRequests.start, { requestId, name: "late.pdf", size: 10 });
    await w.heston.mutation(api.fileRequests.setStatus, { requestId, status: "cancelled" });
    await expect(w.maya.action(api.fileRequests.finishDirect, { uploadId: late.uploadId })).rejects.toThrow(/isn't open/);
    expect(await w.maya.query(api.fileRequests.page, { requestId })).toBeNull();
    expect(await w.maya.query(api.fileRequests.forClientProject, { projectId: w.p })).toEqual([]);
    // Owner side: other businesses and clients are refused.
    expect(await w.boss.query(api.fileRequests.forProject, { projectId: w.p })).toBeNull();
    await expect(w.maya.mutation(api.fileRequests.create, { projectId: w.p, title: "x", due: day(2), remind: false })).rejects.toThrow(/Not allowed/);
    // Ask checks.
    await expect(ask(w, { due: day(-1) })).rejects.toThrow(/passed/);
    await expect(ask(w, { title: "  " })).rejects.toThrow(/Say what you need/);
  });

  test("email 32 the day before, only when nothing's uploaded and it was ticked; the watcher ignores File requests/", async () => {
    const w = await world();
    const s = fake();
    await setup(w);
    const a = await ask(w, { due: day(1) });
    const b = await ask(w, { due: day(1), title: "Send the music references", remind: false });
    // Two requests with the same folder name get their own folders.
    expect((await ask(w, { due: day(9), folderName: "Music references" })).folder).toBe("/File requests/Harbor Coffee/26127 Launch/Music references 2");
    expect(b.folder).toBe("/File requests/Harbor Coffee/26127 Launch/Music references");
    // Not within hours of email 31: asked yesterday.
    expect(await w.t.action(anyApi.fileRequests.remindDue, {})).toBe(0);
    await w.t.run(async (ctx) => { for (const r of await ctx.db.query("fileRequests").collect()) await ctx.db.patch(r._id, { createdAt: Date.now() - 86_400_000 }); });
    vi.useFakeTimers({ now: new Date(`${todayCentral()}T16:00:00Z`) }); // 10 AM Central
    const n = await w.t.action(anyApi.fileRequests.remindDue, {});
    vi.useRealTimers();
    expect(n).toBe(1);
    await settle(w);
    const m32 = s.mails.filter((m) => m.subject === "Reminder: files due tomorrow for 26127 Launch");
    expect(m32).toHaveLength(1);
    expect(m32[0].text).toContain("Nothing yet");
    vi.useFakeTimers({ now: new Date(`${todayCentral()}T17:00:00Z`) });
    expect(await w.t.action(anyApi.fileRequests.remindDue, {})).toBe(0); // once
    vi.useRealTimers();
    expect((await w.heston.query(api.fileRequests.forProject, { projectId: w.p })).requests.find((r: { _id: string }) => r._id === a.requestId)).toBeTruthy();
    expect(placeFor("/File requests/Harbor Coffee/26127 Launch/Logo/clip.mov")).toMatchObject({ ok: false, ignore: true });
    expect(placeFor("/Clients/Harbor Coffee/26127 Launch/00001_Harbor_v1.mp4")).toMatchObject({ ok: true });
    expect(safeName(' a/b:c*?"<>| . ')).toBe("a b c");
  });
});
