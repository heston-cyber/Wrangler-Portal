// Shares (client side C2, Oct 23): the Share button on a client, a project or a video makes a link that lets
// someone outside see it. Owner functions make and manage shares; `open` and `touch` are what a share link
// calls (anyone, gated by lib/shareAccess). Share links look like review.wranglerportal.com/s/<token>.
import { internalAction } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { viewsForShare } from "./views";
import { requireMe, requireSignedIn } from "./lib/access";
import { accessToVersion, limitKey, shareArg } from "./lib/viewer";
import { bump } from "./lib/rate";
import { ensureInvite } from "./clients";
import { randomToken } from "./lib/hash";
import { SITE, sendEmail } from "./lib/email";
import { downloadFor, signedThumbUrl } from "./lib/media";
import { clientKey, coveredProjects, coveredVideos, gateShare, labelOf, MIN_PASSCODE, passProof, passcodeHash, shareState, showsAllVersions, type Share } from "./lib/shareAccess";

const target = v.object({ kind: v.union(v.literal("client"), v.literal("project"), v.literal("video")), client: v.optional(v.string()), projectId: v.optional(v.id("projects")), videoId: v.optional(v.id("videos")) });
const settings = { access: v.union(v.literal("view"), v.literal("comment")), allVersions: v.boolean(), downloads: v.boolean(), emailNewVersions: v.boolean(), expiresAt: v.optional(v.number()), passcode: v.optional(v.string()) };

const MAX_PASSCODE = 60;
const cleanPass = (p: string | undefined) => {
  const s = (p ?? "").trim();
  if (s.length > MAX_PASSCODE) throw new ConvexError("Keep the passcode under 60 characters.");
  if (s && s.length < MIN_PASSCODE) throw new ConvexError(`Use at least ${MIN_PASSCODE} characters for the passcode.`);
  return s;
};

/** Checks the target exists and returns the share's target fields. */
async function targetFields(ctx: QueryCtx | MutationCtx, t: { kind: "client" | "project" | "video"; client?: string; projectId?: Id<"projects">; videoId?: Id<"videos"> }) {
  if (t.kind === "client") {
    const name = clientKey(t.client);
    if (!name) throw new ConvexError("Which client?");
    const onProjects = (await ctx.db.query("projects").collect()).some((p) => clientKey(p.client) === name);
    const made = await ctx.db.query("clients").withIndex("by_name", (q) => q.eq("name", name)).first();
    if (!onProjects && !made) throw new ConvexError("That client doesn't exist.");
    return { kind: "client" as const, client: name };
  }
  if (t.kind === "project") {
    if (!t.projectId || !(await ctx.db.get(t.projectId))) throw new ConvexError("That project doesn't exist.");
    return { kind: "project" as const, projectId: t.projectId };
  }
  if (!t.videoId || !(await ctx.db.get(t.videoId))) throw new ConvexError("That video doesn't exist.");
  return { kind: "video" as const, videoId: t.videoId };
}

async function membersOf(ctx: QueryCtx | MutationCtx, shareId: Id<"shares">) {
  return await ctx.db.query("shareMembers").withIndex("by_share", (q) => q.eq("shareId", shareId)).collect();
}

async function publicShare(ctx: QueryCtx | MutationCtx, s: Share) {
  const l = await labelOf(ctx, s);
  const members = s.who === "invited" ? await membersOf(ctx, s._id) : [];
  const people = [];
  for (const m of members) {
    const invite = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", m.email)).collect()).find((i) => !i.revokedAt);
    const user = invite?.userId ? await ctx.db.get(invite.userId) : null;
    people.push({ email: m.email, name: user?.name ?? invite?.name ?? null, hasAccount: invite?.acceptedAt !== undefined, invited: !!invite, emailedAt: m.emailedAt ?? null });
  }
  const now = Date.now();
  return {
    _id: s._id, token: s.token, url: `${SITE()}/s/${s.token}`, kind: s.kind, client: s.client ?? null, projectId: s.projectId ?? null, videoId: s.videoId ?? null,
    label: l.label, sub: l.sub, gone: l.gone,
    access: s.access, who: s.who, allVersions: s.allVersions, downloads: s.downloads, emailNewVersions: s.emailNewVersions,
    expiresAt: s.expiresAt ?? null, hasPasscode: !!s.passcodeHash, createdAt: s.createdAt, offAt: s.offAt ?? null,
    state: (shareState(s, now) ?? "on") as "on" | "off" | "expired",
    lastOpenedAt: s.lastOpenedAt ?? null, openCount: s.openCount ?? 0, people,
  };
}
export type PublicShare = Awaited<ReturnType<typeof publicShare>>;

// ---------- owner ----------

export const create = mutation({
  args: { target, ...settings, who: v.union(v.literal("link"), v.literal("invited")), emails: v.optional(v.array(v.string())) },
  handler: async (ctx, a) => {
    const me = await requireMe(ctx);
    const t = await targetFields(ctx, a.target);
    const pass = a.who === "link" ? cleanPass(a.passcode) : "";
    if (a.expiresAt !== undefined && a.expiresAt <= Date.now()) throw new ConvexError("The expiry date is already in the past.");
    let token = randomToken(16);
    while (await ctx.db.query("shares").withIndex("by_token", (q) => q.eq("token", token)).unique()) token = randomToken(16);
    const shareId = await ctx.db.insert("shares", {
      token, ...t, access: a.access, who: a.who, allVersions: a.allVersions, downloads: a.downloads, emailNewVersions: a.emailNewVersions,
      ...(a.expiresAt !== undefined ? { expiresAt: a.expiresAt } : {}), ...(pass ? { passcodeHash: await passcodeHash(token, pass) } : {}),
      createdAt: Date.now(), createdBy: me.userId,
    });
    const added: string[] = [];
    if (a.who === "invited") for (const e of a.emails ?? []) if (e.trim()) added.push(await addPerson(ctx, shareId, e));
    return { shareId, token, url: `${SITE()}/s/${token}`, added };
  },
});

async function addPerson(ctx: MutationCtx, shareId: Id<"shares">, rawEmail: string, name?: string) {
  const { email } = await ensureInvite(ctx, rawEmail, name);
  const members = await membersOf(ctx, shareId);
  if (!members.some((m) => m.email === email)) {
    await ctx.db.insert("shareMembers", { shareId, email, addedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.shares.sendInviteEmail, { shareId, email });
  }
  return email;
}

export const update = mutation({
  args: { shareId: v.id("shares"), access: v.optional(settings.access), allVersions: v.optional(v.boolean()), downloads: v.optional(v.boolean()), emailNewVersions: v.optional(v.boolean()),
    expiresAt: v.optional(v.union(v.number(), v.null())), passcode: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const s = await ctx.db.get(a.shareId);
    if (!s) throw new ConvexError("That share is gone.");
    const patch: Partial<Doc<"shares">> = {};
    if (a.access !== undefined) patch.access = a.access;
    if (a.allVersions !== undefined) patch.allVersions = a.allVersions;
    if (a.downloads !== undefined) patch.downloads = a.downloads;
    if (a.emailNewVersions !== undefined) patch.emailNewVersions = a.emailNewVersions;
    if (a.expiresAt !== undefined) {
      if (a.expiresAt !== null && a.expiresAt <= Date.now()) throw new ConvexError("The expiry date is already in the past.");
      patch.expiresAt = a.expiresAt ?? undefined;
    }
    if (a.passcode !== undefined) {
      if (s.who === "invited" && a.passcode) throw new ConvexError("Invited shares don't take a passcode; the sign-in is the lock.");
      const pass = a.passcode === null ? "" : cleanPass(a.passcode);
      patch.passcodeHash = pass ? await passcodeHash(s.token, pass) : undefined;
    }
    await ctx.db.patch(a.shareId, patch);
  },
});

export const setOff = mutation({
  args: { shareId: v.id("shares"), off: v.boolean() },
  handler: async (ctx, { shareId, off }) => {
    await requireMe(ctx);
    const s = await ctx.db.get(shareId);
    if (!s) throw new ConvexError("That share is gone.");
    await ctx.db.patch(shareId, { offAt: off ? Date.now() : undefined });
  },
});

export const remove = mutation({
  args: { shareId: v.id("shares") },
  handler: async (ctx, { shareId }) => {
    await requireMe(ctx);
    if (!(await ctx.db.get(shareId))) return;
    for (const m of await membersOf(ctx, shareId)) await ctx.db.delete(m._id);
    for (const a of await ctx.db.query("shareActivity").withIndex("by_share", (q) => q.eq("shareId", shareId)).collect()) await ctx.db.delete(a._id);
    await ctx.db.delete(shareId);
  },
});

export const addMember = mutation({
  args: { shareId: v.id("shares"), email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const s = await ctx.db.get(a.shareId);
    if (!s) throw new ConvexError("That share is gone.");
    if (s.who !== "invited") throw new ConvexError("This share is open to anyone with the link; there's no list to add to.");
    return { email: await addPerson(ctx, a.shareId, a.email, a.name) };
  },
});

// Send a person's invite email again (owner; at most once a minute per person).
export const resendInvite = mutation({
  args: { shareId: v.id("shares"), email: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const email = a.email.trim().toLowerCase();
    const m = (await membersOf(ctx, a.shareId)).find((x) => x.email === email);
    if (!m) throw new ConvexError("That person isn't on this share.");
    if (m.emailedAt && Date.now() - m.emailedAt < 60_000) throw new ConvexError("Sent less than a minute ago; give it a moment.");
    await ctx.scheduler.runAfter(0, internal.shares.sendInviteEmail, { shareId: a.shareId, email });
  },
});

export const removeMember = mutation({
  args: { shareId: v.id("shares"), email: v.string() },
  handler: async (ctx, a) => {
    await requireMe(ctx);
    const email = a.email.trim().toLowerCase();
    for (const m of await membersOf(ctx, a.shareId)) if (m.email === email) await ctx.db.delete(m._id);
  },
});

// Settings › Shares: every share, newest first.
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const rows = await ctx.db.query("shares").collect();
    const out = [];
    for (const s of rows.sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime)) out.push(await publicShare(ctx, s));
    return out;
  },
});

// The shares on one client, project or video (the Share dialog shows what already exists).
export const forTarget = query({
  args: { target },
  handler: async (ctx, { target: t }) => {
    await requireMe(ctx);
    const rows = (await ctx.db.query("shares").collect()).filter((s) =>
      t.kind === "client" ? s.kind === "client" && clientKey(s.client) === clientKey(t.client)
        : t.kind === "project" ? s.kind === "project" && s.projectId === t.projectId
          : s.kind === "video" && s.videoId === t.videoId);
    const out = [];
    for (const s of rows.sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime)) out.push(await publicShare(ctx, s));
    return out;
  },
});

// Every share that covers a video, however it was made (the video page shows "Shared" when any does).
export const coveringVideo = query({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    await requireMe(ctx);
    const vid = await ctx.db.get(videoId);
    if (!vid) return [];
    const p = await ctx.db.get(vid.projectId);
    const rows = (await ctx.db.query("shares").collect()).filter((s) =>
      (s.kind === "video" && s.videoId === videoId) || (s.kind === "project" && s.projectId === vid.projectId) || (s.kind === "client" && !!p && clientKey(s.client) === clientKey(p.client)));
    const out = [];
    for (const s of rows.sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime)) out.push(await publicShare(ctx, s));
    return out;
  },
});

export const activity = query({
  args: { shareId: v.id("shares"), limit: v.optional(v.number()) },
  handler: async (ctx, { shareId, limit }) => {
    await requireMe(ctx);
    const n = Math.min(limit ?? 50, 200);
    const rows = await ctx.db.query("shareActivity").withIndex("by_share", (q) => q.eq("shareId", shareId)).order("desc").take(n);
    const out: Array<{ _id: string; kind: "opened" | "viewed" | "note" | "watched"; who: string; at: number; videoId: Id<"videos"> | null; videoTitle: string | null; noteId: Id<"notes"> | null; watch?: { version: number; watchedSec: number; maxSec: number; lengthSec: number; completed: boolean } }> = [];
    for (const r of rows) {
      const vid = r.videoId ? await ctx.db.get(r.videoId) : null;
      out.push({ _id: r._id, kind: r.kind, who: r.who, at: r.at, videoId: r.videoId ?? null, videoTitle: vid?.title ?? null, noteId: r.noteId ?? null });
    }
    // C9: what they watched, from the player's heartbeat (one line per sitting, placed by when it was last seen).
    for (const w of await viewsForShare(ctx, shareId, n)) {
      out.push({ _id: `w:${w.videoId}:${w.startedAt}`, kind: "watched", who: w.who, at: w.lastAt, videoId: w.videoId, videoTitle: w.videoTitle, noteId: null, watch: { version: w.version, watchedSec: w.watchedSec, maxSec: w.maxSec, lengthSec: w.lengthSec, completed: w.completed } });
    }
    return out.sort((a, b) => b.at - a.at).slice(0, n);
  },
});

// ---------- the share link (anyone; gated) ----------


// What a share link shows. The answer depends on who's asking and the share's state; nothing outside the share
// is ever returned. Streams and signed links come with C3; this returns the structure and the metadata.
export const open = query({
  args: { token: v.string(), passcode: v.optional(v.string()) },
  handler: async (ctx, { token, passcode }) => {
    const g = await gateShare(ctx, token, passcode);
    if (!g.ok) return { state: g.reason, label: g.share && (g.reason === "off" || g.reason === "expired") ? (await labelOf(ctx, g.share)).label : null };
    const s = g.share;
    const projects = await coveredProjects(ctx, s);
    const videos = await coveredVideos(ctx, s);
    const outVideos = [];
    for (const vid of videos) {
      const all = (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()).filter((x) => x.status === "ready").sort((a, b) => a.number - b.number);
      const shown = showsAllVersions(s) ? all : all.slice(-1);
      if (!shown.length) continue; // nothing playable yet: a client doesn't see an empty video
      outVideos.push({
        _id: vid._id, title: vid.title, number: vid.number ?? null, projectId: vid.projectId, updatedAt: vid.updatedAt,
        versions: await Promise.all(shown.map(async (x) => ({
          _id: x._id, number: x.number, frameCount: x.frameCount ?? null, fpsNum: x.fpsNum ?? 24000, fpsDen: x.fpsDen ?? 1001, startTimecode: x.startTimecode,
          width: x.width ?? null, height: x.height ?? null, createdAt: x.createdAt, description: x.description ?? null, thumbUrl: await signedThumbUrl(x),
          // C3: the file to download (the render, or the best MP4 copy), when the share allows downloads.
          download: s.downloads ? await downloadFor(x) : null,
        }))),
      });
    }
    const l = await labelOf(ctx, s);
    return {
      state: "ok" as const, token: s.token, kind: s.kind, label: l.label, sub: l.sub, access: s.access, who: s.who, allVersions: s.allVersions, downloads: s.downloads,
      expiresAt: s.expiresAt ?? null, guest: g.guest, viewer: g.viewer.kind === "nobody" ? null : { kind: g.viewer.kind, name: g.viewer.name, email: g.viewer.email },
      client: s.kind === "client" ? s.client ?? null : (projects[0]?.client ?? null),
      projects: projects.map((p) => ({ _id: p._id, name: p.name, jobNumber: p.jobNumber ?? null, client: p.client ?? null })),
      videos: outVideos,
    };
  },
});

// The passcode box on a link share. Five wrong tries lock the share for a minute, doubling each time (an hour at
// most); the page keeps the proof it gets back, never the passcode (security review, Oct 23).
export const unlock = mutation({
  args: { token: v.string(), passcode: v.string() },
  handler: async (ctx, { token, passcode }) => {
    const s = await ctx.db.query("shares").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (!s || shareState(s)) return { state: "missing" as const };
    if (!s.passcodeHash) return { state: "none" as const };
    const now = Date.now();
    if (s.passLockedUntil && s.passLockedUntil > now) return { state: "locked" as const, seconds: Math.ceil((s.passLockedUntil - now) / 1000) };
    if ((await passcodeHash(token, passcode.trim())) !== s.passcodeHash) {
      const fails = (s.passFails ?? 0) + 1;
      const lock = fails >= 5 ? Math.min(60, 2 ** (fails - 5)) * 60_000 : 0;
      await ctx.db.patch(s._id, { passFails: fails, ...(lock ? { passLockedUntil: now + lock } : {}) });
      return lock ? { state: "locked" as const, seconds: lock / 1000 } : { state: "wrong" as const };
    }
    if (s.passFails) await ctx.db.patch(s._id, { passFails: 0, passLockedUntil: undefined });
    return { state: "ok" as const, proof: await passProof(token, s.passcodeHash) };
  },
});

// Records an open or a view on a share (the link page calls it). Same gate as `open`; one row per person, kind and
// video per half hour, so a page that refreshes doesn't pile up rows.
export const touch = mutation({
  args: { token: v.string(), passcode: v.optional(v.string()), kind: v.union(v.literal("opened"), v.literal("viewed")), videoId: v.optional(v.id("videos")), guestName: v.optional(v.string()), guestKey: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const g = await gateShare(ctx, a.token, a.passcode);
    if (!g.ok) return { recorded: false, state: g.reason };
    const s = g.share;
    if (a.videoId && !(await coveredVideos(ctx, s)).some((x) => x._id === a.videoId)) return { recorded: false, state: "notCovered" };
    const viewer = g.viewer;
    const who = viewer.kind === "owner" ? "Heston (owner)" : viewer.kind === "client" ? `${viewer.name} · ${viewer.email}` : `${(a.guestName ?? "").trim().slice(0, 60) || "Someone"} (guest)`;
    // One row per person, kind and video per half hour; guests are told apart by their browser key, not the name they type.
    const whoKey = viewer.kind === "nobody" ? `g:${(a.guestKey ?? "").slice(0, 80)}` : viewer.kind === "client" ? `u:${viewer.userId}` : "owner";
    const now = Date.now();
    const recent = await ctx.db.query("shareActivity").withIndex("by_share", (q) => q.eq("shareId", s._id).gt("at", now - 30 * 60_000)).take(500);
    if (recent.length >= 500) return { recorded: false, state: "busy" };
    if (recent.some((r) => r.kind === a.kind && (r.whoKey ?? r.who) === (r.whoKey ? whoKey : who) && (r.videoId ?? null) === (a.videoId ?? null))) return { recorded: false, state: "recent" };
    await ctx.db.insert("shareActivity", { shareId: s._id, kind: a.kind, who, whoKey, ...(a.videoId ? { videoId: a.videoId } : {}), at: now });
    if (viewer.kind !== "owner" && a.kind === "opened") await ctx.db.patch(s._id, { lastOpenedAt: now, openCount: (s.openCount ?? 0) + 1 });
    return { recorded: true, state: "ok" };
  },
});

// Shared with me (C3): everything an invited client can open, grouped by client and project. Owners get nothing
// here (their side is the whole library).
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return [];
    const invite = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", me.email)).collect()).find((i) => !i.revokedAt);
    if (!invite) return [];
    const members = await ctx.db.query("shareMembers").withIndex("by_email", (q) => q.eq("email", me.email)).collect();
    const out = [];
    for (const m of members) {
      const s = await ctx.db.get(m.shareId);
      if (!s || shareState(s)) continue;
      const l = await labelOf(ctx, s);
      const projects = await coveredProjects(ctx, s);
      const videos = [];
      for (const vid of await coveredVideos(ctx, s)) {
        const ready = (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()).filter((x) => x.status === "ready").sort((a, b) => b.number - a.number);
        if (!ready.length) continue;
        const p = projects.find((x) => x._id === vid.projectId);
        videos.push({ _id: vid._id, title: vid.title, number: vid.number ?? null, projectId: vid.projectId, project: p ? projectLabelOf(p) : null, client: p?.client ?? null, updatedAt: vid.updatedAt, latest: ready[0].number, versions: showsAllVersions(s) ? ready.length : 1, thumbUrl: await signedThumbUrl(ready[0]) });
      }
      out.push({ token: s.token, kind: s.kind, label: l.label, sub: l.sub, access: s.access, client: s.kind === "client" ? s.client ?? null : (projects[0]?.client ?? null), createdAt: s.createdAt, videos: videos.sort((a, b) => b.updatedAt - a.updatedAt) });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  },
});
const projectLabelOf = (p: { name: string; jobNumber?: string }) => (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name);

// For actions (stills, voice transcription): may this caller comment on this version? Throws if not.
export const assertCanComment = internalMutation({
  args: { versionId: v.id("versions"), share: shareArg, count: v.optional(v.union(v.literal("stills"), v.literal("voice"))) },
  handler: async (ctx, { versionId, share, count }) => {
    const { access } = await accessToVersion(ctx, versionId, share, "comment");
    if (count && access.kind !== "owner") await bump(ctx, count, limitKey(access));
    return true;
  },
});

// ---------- the invite email ----------

export const inviteEmailData = internalQuery({
  args: { shareId: v.id("shares"), email: v.string() },
  handler: async (ctx, { shareId, email }) => {
    const s = await ctx.db.get(shareId);
    if (!s || shareState(s)) return null;
    const member = (await membersOf(ctx, shareId)).find((m) => m.email === email);
    if (!member) return null;
    const invite = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()).find((i) => !i.revokedAt);
    if (!invite) return null;
    const l = await labelOf(ctx, s);
    const videos = await coveredVideos(ctx, s);
    const user = invite.userId ? await ctx.db.get(invite.userId) : null;
    return { token: s.token, kind: s.kind, label: l.label, sub: l.sub, access: s.access, hasAccount: invite.acceptedAt !== undefined, name: user?.name ?? invite.name ?? null, videoCount: videos.length, memberId: member._id };
  },
});

export const markEmailed = internalMutation({
  args: { memberId: v.id("shareMembers") },
  handler: async (ctx, { memberId }) => { if (await ctx.db.get(memberId)) await ctx.db.patch(memberId, { emailedAt: Date.now() }); },
});

export function inviteEmailText(d: { token: string; kind: string; label: string; sub: string | null; access: string; hasAccount: boolean; name: string | null; videoCount: number }) {
  const what = d.kind === "client" ? `everything for ${d.label}` : d.kind === "project" ? `the project ${d.label}` : `the video "${d.label}"${d.sub ? ` (${d.sub})` : ""}`;
  const link = `${SITE()}/s/${d.token}`;
  const lines = [
    `${d.name ? `Hi ${d.name.split(" ")[0]},` : "Hi,"}`,
    ``,
    `Heston at Wrangler Productions shared ${what} with you on Wrangler Review${d.access === "comment" ? ", and you can leave notes on it" : ""}.`,
    ``,
    `Open it here:`,
    link,
    ``,
    d.hasAccount ? `Sign in with your Wrangler Review account to see it.` : `It's for this email address only. The first time, you'll create your account (a password, then a six-digit code we send you); after that, just sign in.`,
    ``,
    `Reply to this email if anything doesn't work.`,
    ``,
    `— Wrangler Review`,
  ];
  return { subject: `Heston shared ${d.label} with you on Wrangler Review`, text: lines.join("\n"), link };
}

export const sendInviteEmail = internalAction({
  args: { shareId: v.id("shares"), email: v.string() },
  handler: async (ctx, { shareId, email }) => {
    const d = await ctx.runQuery(internal.shares.inviteEmailData, { shareId, email });
    if (!d) return { sent: false };
    const m = inviteEmailText(d);
    await sendEmail({ to: email, subject: m.subject, text: m.text, tag: "share-invite" });
    await ctx.runMutation(internal.shares.markEmailed, { memberId: d.memberId });
    return { sent: true };
  },
});

// Used by C3/C4: is this viewer allowed to see this video through any share? (Owners see everything.)
export async function sharesCovering(ctx: QueryCtx | MutationCtx, videoId: Id<"videos">): Promise<Share[]> {
  const vid = await ctx.db.get(videoId);
  if (!vid) return [];
  const p = await ctx.db.get(vid.projectId);
  return (await ctx.db.query("shares").collect()).filter((s) => !shareState(s) &&
    ((s.kind === "video" && s.videoId === videoId) || (s.kind === "project" && s.projectId === vid.projectId) || (s.kind === "client" && !!p && clientKey(s.client) === clientKey(p.client))));
}
