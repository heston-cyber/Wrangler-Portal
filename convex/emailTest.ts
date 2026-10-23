// Client side T-C0.2 (Oct 23): does an email from review@wranglerportal.com through Resend land in the inbox?
// Env: RESEND_API_KEY (pasted into the Convex dashboard by Heston), EMAIL_FROM (default below).
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export const send = internalAction({
  args: { to: v.array(v.string()), kind: v.union(v.literal("code"), v.literal("reset")) },
  handler: async (_ctx, { to, kind }) => {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { configured: false };
    const from = process.env.EMAIL_FROM || "Wrangler Review <review@wranglerportal.com>";
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const subject = kind === "code" ? `${code} is your Wrangler Review code` : "Reset your Wrangler Review password";
    const text = kind === "code"
      ? `Your sign-in code is ${code}. It works for 10 minutes.\n\nIf you didn't ask for it, ignore this email.\n\nWrangler Review · review.wranglerportal.com`
      : `Someone asked to reset the password for this email on Wrangler Review. Your reset code is ${code}. It works for 10 minutes.\n\nIf that wasn't you, ignore this email and nothing changes.\n\nWrangler Review · review.wranglerportal.com`;
    const out: Array<{ to: string; status: number; id?: string; error?: string }> = [];
    for (const addr of to) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [addr], subject, text, headers: { "X-Entity-Ref-ID": `test-${Date.now()}` } }),
      });
      const j = await r.json().catch(() => ({})) as { id?: string; message?: string };
      out.push({ to: addr.replace(/^(.).*@/, "$1…@"), status: r.status, id: j.id ? j.id.slice(0, 8) : undefined, error: r.ok ? undefined : (j.message || "").slice(0, 120) });
    }
    return { configured: true, from, kind, sent: out };
  },
});

// ---------- C4 live run (Oct 23): each email kind, for real, to a test address ----------
// Makes a test video in the "Tests" project (the public frame-test clip in the stills zone, so it plays), an invited
// comment share to the address (→ the invite email), fires the new-version email, leaves a note as a test client
// account for that address, replies as Heston (→ the reply email), and runs the owner alert (→ Heston's alert).
// Everything is tagged so `liveCleanup` removes it. Returns counts and statuses only.
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { reviewStorage } from "./lib/reviewStorage";
import { allowedEmails } from "./auth";
import { randomToken } from "./lib/hash";
import { removeVideoAndFiles } from "./library";

const TAG = "C4 Email Test";
const PATH = "review/_emailtest/frametest_23976_h264.mp4";

export const liveSeed = internalMutation({
  args: { to: v.string(), fileUrl: v.string() },
  handler: async (ctx, { to, fileUrl }) => {
    const email = to.trim().toLowerCase();
    if (allowedEmails().includes(email)) throw new Error("Use a non-owner address.");
    const p = (await ctx.db.query("projects").withIndex("by_name", (q) => q.eq("name", "Tests")).first()) ?? null;
    const projectId = p?._id ?? (await ctx.db.insert("projects", { name: "Tests", createdAt: Date.now() }));
    const now = Date.now();
    const videoId = await ctx.db.insert("videos", { projectId, title: TAG, createdAt: now, updatedAt: now });
    const versionId = await ctx.db.insert("versions", {
      videoId, number: 1, status: "ready", bunnyGuid: "", source: "file", storagePath: PATH, fileUrl, fileName: "frametest_23976_h264.mp4", startTimecode: "01:00:00:00",
      fpsNum: 24000, fpsDen: 1001, frameCount: 480, frameCountFrom: "file", width: 1920, height: 1080, createdAt: now, readyAt: now, description: "Test cut for the email run.",
    });
    // A client account for the address (if there isn't one), so the reply email has someone to go to.
    let user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).first();
    const madeUser = !user;
    if (!user) { const id = await ctx.db.insert("users", { email, name: "Test Client", role: "client", emailVerificationTime: now }); user = (await ctx.db.get(id))!; }
    let invite = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()).find((i) => !i.revokedAt);
    const madeInvite = !invite;
    if (!invite) { const id = await ctx.db.insert("invites", { email, name: "Test Client", createdAt: now, acceptedAt: now, userId: user._id }); invite = (await ctx.db.get(id))!; }
    return { videoId, versionId, userId: user._id, madeUser, madeInvite, inviteId: invite._id };
  },
});

export const liveNote = internalMutation({
  args: { videoId: v.id("videos"), versionId: v.id("versions"), userId: v.id("users"), shareId: v.id("shares") },
  handler: async (ctx, a) => {
    const now = Date.now() - 11 * 60_000; // old enough for the alert to go straight out
    const noteId = await ctx.db.insert("notes", { versionId: a.versionId, videoId: a.videoId, kind: "frame", inFrame: 120, text: "Test note from the client: can this shot hold a beat longer?", status: "open", authorName: "Test Client", authorId: a.userId, visibility: "shared", shareId: a.shareId, createdAt: now, updatedAt: now });
    const replyId = await ctx.db.insert("replies", { noteId, text: "Yes — 8 more frames in the next cut. (Test reply.)", authorName: "Heston", createdAt: Date.now() });
    return { noteId, replyId };
  },
});

export const liveRun = internalAction({
  args: { to: v.string() },
  handler: async (ctx, { to }): Promise<unknown> => {
    const z = reviewStorage();
    if (!z) return { configured: false };
    const src = await fetch("https://review.wranglerportal.com/lab/frametest_23976_h264.mp4");
    if (!src.ok) return { fetch: src.status };
    const put = await fetch(`https://${z.host}/${z.zone}/${PATH}`, { method: "PUT", headers: { AccessKey: z.password, "content-type": "video/mp4" }, body: new Uint8Array(await src.arrayBuffer()) });
    if (!put.ok) return { write: put.status };
    const fileUrl = `https://${process.env.BUNNY_REVIEW_CDN || process.env.BUNNY_STILLS_CDN}/${PATH}`;
    const seed: any = await ctx.runMutation(internal.emailTest.liveSeed, { to, fileUrl });
    const share: any = await ctx.runMutation(internal.emailTest.liveShare, { videoId: seed.videoId, to, userId: seed.userId });
    // 1. the invite email went out from the share (scheduled); 2. new version; 3. a note + Heston's reply; 4. the alert.
    const nv: any = await ctx.runAction(internal.emails.newVersion, { versionId: seed.versionId });
    const note: any = await ctx.runMutation(internal.emailTest.liveNote, { videoId: seed.videoId, versionId: seed.versionId, userId: seed.userId, shareId: share.shareId });
    const rp: any = await ctx.runAction(internal.emails.replyToNote, { replyId: note.replyId });
    const al: any = await ctx.runAction(internal.emails.ownerAlert, { videoId: seed.videoId });
    return { to: to.replace(/^(.).*@/, "$1…@"), madeUser: seed.madeUser, madeInvite: seed.madeInvite, invite: "scheduled", newVersion: nv, reply: rp, alert: al, shareToken: share.token.slice(0, 4) + "…" };
  },
});

export const liveShare = internalMutation({
  args: { videoId: v.id("videos"), to: v.string(), userId: v.id("users") },
  handler: async (ctx, { videoId, to, userId }) => {
    const owner = (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", allowedEmails()[0])).first())!;
    const token = randomToken(16);
    const shareId = await ctx.db.insert("shares", { token, kind: "video", videoId, access: "comment", who: "invited", allVersions: true, downloads: true, emailNewVersions: true, createdAt: Date.now(), createdBy: owner._id });
    await ctx.db.insert("shareMembers", { shareId, email: to.trim().toLowerCase(), addedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.shares.sendInviteEmail, { shareId, email: to.trim().toLowerCase() });
    void userId;
    return { shareId, token };
  },
});

export const liveState = internalQuery({
  args: {},
  handler: async (ctx) => {
    const vids = (await ctx.db.query("videos").collect()).filter((x) => x.title === TAG);
    const log = (await ctx.db.query("emailLog").withIndex("by_at").order("desc").take(20)).map((l) => ({ kind: l.kind, to: l.to.replace(/^(.).*@/, "$1…@"), at: l.at, sent: !!l.resendId }));
    return { testVideos: vids.length, log };
  },
});

export const liveCleanup = internalAction({
  args: { to: v.string(), removeUser: v.optional(v.boolean()) },
  handler: async (ctx, { to, removeUser }): Promise<unknown> => {
    const r: any = await ctx.runMutation(internal.emailTest.liveCleanupDb, { to, removeUser: !!removeUser });
    const z = reviewStorage();
    if (z) await fetch(`https://${z.host}/${z.zone}/${PATH}`, { method: "DELETE", headers: { AccessKey: z.password } }).catch(() => null);
    return r;
  },
});

export const liveCleanupDb = internalMutation({
  args: { to: v.string(), removeUser: v.boolean() },
  handler: async (ctx, { to, removeUser }) => {
    const email = to.trim().toLowerCase();
    let videos = 0, shares = 0;
    for (const vid of (await ctx.db.query("videos").collect()).filter((x) => x.title === TAG)) {
      for (const s of (await ctx.db.query("shares").collect()).filter((s) => s.videoId === vid._id)) {
        for (const m of await ctx.db.query("shareMembers").withIndex("by_share", (q) => q.eq("shareId", s._id)).collect()) await ctx.db.delete(m._id);
        for (const a of await ctx.db.query("shareActivity").withIndex("by_share", (q) => q.eq("shareId", s._id)).collect()) await ctx.db.delete(a._id);
        await ctx.db.delete(s._id); shares++;
      }
      await removeVideoAndFiles(ctx, vid._id); videos++;
    }
    let users = 0;
    if (removeUser) {
      for (const u of await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).collect()) {
        if (u.name === "Test Client") { await ctx.db.delete(u._id); users++; }
      }
      for (const i of await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()) if (i.name === "Test Client") await ctx.db.delete(i._id);
    }
    return { videos, shares, users };
  },
});

// Where did the last emails get to? Asks Resend for each one's latest event (sent / delivered / bounced / complained).
export const resendStatus = internalAction({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { configured: false };
    const rows: any = await ctx.runQuery(internal.emailTest.recentLog, {});
    const out = [];
    for (const r of rows) {
      if (!r.resendId || r.resendId === "sent") { out.push({ kind: r.kind, to: r.to, status: "no id" }); continue; }
      const res = await fetch(`https://api.resend.com/emails/${r.resendId}`, { headers: { Authorization: `Bearer ${key}` } });
      const j = await res.json().catch(() => ({})) as { last_event?: string; created_at?: string; from?: string };
      out.push({ kind: r.kind, to: r.to, http: res.status, lastEvent: j.last_event ?? null, created: j.created_at ?? null, from: j.from ?? null });
    }
    return out;
  },
});

export const recentLog = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("emailLog").withIndex("by_at").order("desc").take(8)).map((l) => ({ kind: l.kind, to: l.to.replace(/^(.).*@/, "$1…@"), resendId: l.resendId ?? null })),
});

// Did the last share invites go out? Masked addresses, times only.
export const recentInvites = internalQuery({
  args: {},
  handler: async (ctx) => {
    const members = (await ctx.db.query("shareMembers").collect()).sort((a, b) => b.addedAt - a.addedAt).slice(0, 5);
    return members.map((m) => ({ to: m.email.replace(/^(.).*@/, "$1…@"), addedAgoMin: Math.round((Date.now() - m.addedAt) / 60000), emailed: m.emailedAt ? `${Math.round((Date.now() - m.emailedAt) / 60000)} min ago` : "NOT SENT" }));
  },
});
