// Emails (client side C4, Oct 23), all through Resend from review@wranglerportal.com, reply-to Heston:
//   newVersion   a version became playable → each person on an invited share covering it (switch per share)
//   replyToNote  Heston replied to a client's note (or showed a hidden reply) → the note's author (client accounts)
//   ownerAlert   clients or guests left notes → one email to Heston per sitting, 10 minutes after the last note
// Every client email carries an unsubscribe link for that kind; each email is logged by key so it goes out once.
// Bodies name the video and its project only, never other clients; links carry the share token, never a key.
import { internalAction, internalMutation, internalQuery } from "./lib/functions";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { allowedEmails } from "./auth";
import { frameTc } from "./lib/frames";
import { randomToken } from "./lib/hash";
import { REPLY_TO, SITE, sendEmail } from "./lib/email";
import { clientKey, sameBusiness, shareCovers, shareState } from "./lib/shareAccess";

export const ALERT_DELAY_MS = 10 * 60_000;
export const NEW_VERSION_DELAY_MS = 60_000;
type Kind = "versions" | "replies";
const projectLabel = (p: { name: string; jobNumber?: string } | null) => (p ? (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name) : "");

/** Where Heston's own alerts go: ALERT_EMAIL, else the first owner email, else the reply-to address. */
export const alertEmail = () => process.env.ALERT_EMAIL || allowedEmails()[0] || REPLY_TO();

// ---------- preferences and the log ----------

async function prefsFor(ctx: MutationCtx, email: string) {
  const row = await ctx.db.query("emailPrefs").withIndex("by_email", (q) => q.eq("email", email)).first(); // one per business; the caller's scope picks it
  if (row) return row;
  const id = await ctx.db.insert("emailPrefs", { email, key: randomToken(18), updatedAt: Date.now() });
  return (await ctx.db.get(id))!;
}

/** Who may still get which kinds; makes the prefs row (and its unsubscribe key) on first use. */
export const recipients = internalMutation({
  args: { emails: v.array(v.string()), kind: v.union(v.literal("versions"), v.literal("replies")) },
  handler: async (ctx, { emails, kind }) => {
    const out: Array<{ email: string; key: string }> = [];
    for (const e of [...new Set(emails.map((x) => x.trim().toLowerCase()).filter(Boolean))]) {
      const p = await prefsFor(ctx, e);
      if (kind === "versions" ? p.versionsOff : p.repliesOff) continue;
      out.push({ email: e, key: p.key });
    }
    return out;
  },
});

/** Claims a send: true the first time a key is seen, false after (so nothing goes out twice). */
export const claim = internalMutation({
  args: { key: v.string(), kind: v.string(), to: v.string() },
  handler: async (ctx, a) => {
    if (await ctx.db.query("emailLog").withIndex("by_key", (q) => q.eq("key", a.key)).unique()) return false;
    await ctx.db.insert("emailLog", { key: a.key, kind: a.kind, to: a.to, at: Date.now() });
    return true;
  },
});

export const sent = internalMutation({
  args: { key: v.string(), resendId: v.string() },
  handler: async (ctx, { key, resendId }) => {
    const row = await ctx.db.query("emailLog").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row) await ctx.db.patch(row._id, { resendId });
  },
});

export const unclaim = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const row = await ctx.db.query("emailLog").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row && !row.resendId) await ctx.db.delete(row._id);
  },
});

export const unsubUrl = (key: string, kind: Kind) => `${process.env.CONVEX_SITE_URL ?? ""}/email/stop?k=${encodeURIComponent(key)}&t=${kind}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deliver(ctx: { runMutation: (ref: any, args: any) => Promise<any> }, key: string, kind: string, to: string, subject: string, text: string, unsubscribe?: string): Promise<boolean> {
  if (!(await ctx.runMutation(internal.emails.claim, { key, kind, to }))) return false;
  try {
    const id = await sendEmail({ to, subject, text, tag: kind, unsubscribe });
    await ctx.runMutation(internal.emails.sent, { key, resendId: id || "sent" });
    return true;
  } catch (e) {
    await ctx.runMutation(internal.emails.unclaim, { key }); // let a retry try again
    throw e;
  }
}

// ---------- new version ----------

export const newVersionData = internalQuery({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }) => {
    const ver = await ctx.db.get(versionId);
    if (!ver || ver.status !== "ready") return null;
    const vid = await ctx.db.get(ver.videoId);
    if (!vid) return null;
    const project = await ctx.db.get(vid.projectId);
    // Invited shares that cover this video, are on, and want these emails.
    const shares = (await ctx.db.query("shares").collect()).filter((s) => s.who === "invited" && s.emailNewVersions && !shareState(s) && shareCovers(s, vid, project));
    const people: Array<{ email: string; token: string; name: string | null }> = [];
    for (const s of shares) {
      for (const m of await ctx.db.query("shareMembers").withIndex("by_share", (q) => q.eq("shareId", s._id)).collect()) {
        if (people.some((p) => p.email === m.email)) continue; // one email per person even if several shares cover it
        const invite = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", m.email)).collect()).find((i) => !i.revokedAt && sameBusiness(s, i));
        if (!invite) continue;
        const user = invite.userId ? await ctx.db.get(invite.userId) : null;
        people.push({ email: m.email, token: s.token, name: user?.name ?? invite.name ?? null });
      }
    }
    return { title: vid.title, number: ver.number, description: ver.description ?? null, project: projectLabel(project), videoId: vid._id, people };
  },
});

export function newVersionText(d: { title: string; number: number; description: string | null; project: string; name: string | null; link: string; unsub: string }) {
  const lines = [
    d.name ? `Hi ${d.name.split(" ")[0]},` : "Hi,",
    ``,
    `A new cut of "${d.title}" is ready to review on Wrangler Review: version ${d.number}${d.project ? ` (${d.project})` : ""}.`,
    ...(d.description ? [``, `What changed: ${d.description}`] : []),
    ``,
    `Watch it here:`,
    d.link,
    ``,
    `Reply to this email if anything doesn't work.`,
    ``,
    `— Wrangler Review`,
    ``,
    `Stop emails about new versions: ${d.unsub}`,
  ];
  return { subject: `${d.title} v${d.number} is ready to review`, text: lines.join("\n") };
}

export const newVersion = internalAction({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }): Promise<{ sent: number }> => {
    const d = await ctx.runQuery(internal.emails.newVersionData, { versionId });
    if (!d || !d.people.length) return { sent: 0 };
    const ok: Array<{ email: string; key: string }> = await ctx.runMutation(internal.emails.recipients, { emails: d.people.map((p: { email: string }) => p.email), kind: "versions" });
    let sent = 0;
    for (const r of ok) {
      const p = d.people.find((x: { email: string }) => x.email === r.email)!;
      const m = newVersionText({ ...d, name: p.name, link: `${SITE()}/s/${p.token}/v/${d.videoId}?version=${d.number}`, unsub: unsubUrl(r.key, "versions") });
      if (await deliver(ctx, `version:${versionId}:${r.email}`, "versions", r.email, m.subject, m.text, unsubUrl(r.key, "versions"))) sent++;
    }
    return { sent };
  },
});

// ---------- a reply to a client's note ----------

export const replyData = internalQuery({
  args: { replyId: v.id("replies") },
  handler: async (ctx, { replyId }) => {
    const r = await ctx.db.get(replyId);
    if (!r || r.hidden) return null;
    const n = await ctx.db.get(r.noteId);
    if (!n || n.visibility !== "shared" || !n.authorId) return null; // guests have no email; private notes have no client
    const author = await ctx.db.get(n.authorId);
    if (!author?.email || author.role !== "client") return null;
    if (r.authorId && r.authorId === n.authorId) return null; // their own reply
    const ver = await ctx.db.get(n.versionId);
    const vid = ver ? await ctx.db.get(ver.videoId) : null;
    if (!ver || !vid) return null;
    const project = await ctx.db.get(vid.projectId);
    const share = n.shareId ? await ctx.db.get(n.shareId) : null;
    const fps = { num: ver.fpsNum ?? 24000, den: ver.fpsDen ?? 1001 };
    const when = n.kind === "general" ? "the whole video" : n.kind === "range" ? `${frameTc(n.inFrame!, ver.startTimecode, fps)} → ${frameTc(n.outFrame!, ver.startTimecode, fps)}` : frameTc(n.inFrame!, ver.startTimecode, fps);
    return {
      to: author.email.toLowerCase(), name: author.name ?? null, replyAuthor: r.authorName, replyText: r.text, noteText: n.text, when,
      title: vid.title, number: ver.number, project: projectLabel(project),
      link: share && !shareState(share) ? `${SITE()}/s/${share.token}/v/${vid._id}?version=${ver.number}&note=${n._id}` : `${SITE()}/`,
    };
  },
});

export function replyText(d: { name: string | null; replyAuthor: string; replyText: string; noteText: string; when: string; title: string; number: number; project: string; link: string; unsub: string }) {
  const lines = [
    d.name ? `Hi ${d.name.split(" ")[0]},` : "Hi,",
    ``,
    `${d.replyAuthor} replied to your note on "${d.title}" v${d.number}${d.project ? ` (${d.project})` : ""}, at ${d.when}:`,
    ``,
    `  You: ${d.noteText || "(drawing)"}`,
    `  ${d.replyAuthor}: ${d.replyText}`,
    ``,
    `See it here:`,
    d.link,
    ``,
    `— Wrangler Review`,
    ``,
    `Stop emails about replies: ${d.unsub}`,
  ];
  return { subject: `${d.replyAuthor} replied on ${d.title}`, text: lines.join("\n") };
}

export const replyToNote = internalAction({
  args: { replyId: v.id("replies") },
  handler: async (ctx, { replyId }): Promise<{ sent: number }> => {
    const d = await ctx.runQuery(internal.emails.replyData, { replyId });
    if (!d) return { sent: 0 };
    const ok: Array<{ email: string; key: string }> = await ctx.runMutation(internal.emails.recipients, { emails: [d.to], kind: "replies" });
    if (!ok.length) return { sent: 0 };
    const m = replyText({ ...d, unsub: unsubUrl(ok[0].key, "replies") });
    return { sent: (await deliver(ctx, `reply:${replyId}`, "replies", d.to, m.subject, m.text, unsubUrl(ok[0].key, "replies"))) ? 1 : 0 };
  },
});

// ---------- Heston's alert ----------

export const alertData = internalQuery({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }) => {
    const notes = (await ctx.db.query("notes").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect())
      .filter((n) => n.shareId && !n.alertedAt).sort((a, b) => a.createdAt - b.createdAt);
    if (!notes.length) return null;
    const newest = Math.max(...notes.map((n) => n.createdAt));
    const vid = await ctx.db.get(videoId);
    if (!vid) return null;
    const project = await ctx.db.get(vid.projectId);
    const versions = new Map<string, Doc<"versions">>();
    const rows = [];
    for (const n of notes) {
      let ver = versions.get(n.versionId);
      if (!ver) { const x = await ctx.db.get(n.versionId); if (!x) continue; versions.set(n.versionId, x); ver = x; }
      const fps = { num: ver.fpsNum ?? 24000, den: ver.fpsDen ?? 1001 };
      rows.push({
        id: n._id, version: ver.number, author: n.authorName, text: n.text, drawing: !!n.drawing, voice: !!n.voice,
        when: n.kind === "general" ? "Whole video" : n.kind === "range" ? `${frameTc(n.inFrame!, ver.startTimecode, fps)} → ${frameTc(n.outFrame!, ver.startTimecode, fps)}` : frameTc(n.inFrame!, ver.startTimecode, fps),
        link: `${SITE()}/v/${videoId}?version=${ver.number}&note=${n._id}`,
      });
    }
    return { title: vid.title, project: projectLabel(project), newest, videoId, noteIds: notes.map((n) => n._id), rows };
  },
});

export const markAlerted = internalMutation({
  args: { noteIds: v.array(v.id("notes")) },
  handler: async (ctx, { noteIds }) => { const now = Date.now(); for (const id of noteIds) if (await ctx.db.get(id)) await ctx.db.patch(id, { alertedAt: now }); },
});

export function alertText(d: { title: string; project: string; rows: Array<{ version: number; author: string; text: string; drawing: boolean; voice: boolean; when: string; link: string }> }) {
  const who = [...new Set(d.rows.map((r) => r.author))];
  const lines = [
    `${d.rows.length} new ${d.rows.length === 1 ? "note" : "notes"} from ${who.join(", ")} on "${d.title}"${d.project ? ` (${d.project})` : ""}.`,
    ``,
    ...d.rows.flatMap((r) => [
      `v${r.version} · ${r.when} · ${r.author}${r.drawing ? " · drawing" : ""}${r.voice ? " · voice" : ""}`,
      `  ${r.text || "(no words)"}`,
      `  ${r.link}`,
      ``,
    ]),
    `— Wrangler Review`,
  ];
  return { subject: `${d.rows.length} new ${d.rows.length === 1 ? "note" : "notes"} on ${d.title} from ${who[0]}${who.length > 1 ? ` and ${who.length - 1} more` : ""}`, text: lines.join("\n") };
}

// Runs 10 minutes after each client/guest note. If a newer note landed in the meantime, a later run handles the batch.
export const ownerAlert = internalAction({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }): Promise<{ sent: number; reason?: string; notes?: number }> => {
    const d = await ctx.runQuery(internal.emails.alertData, { videoId });
    if (!d) return { sent: 0, reason: "nothing new" };
    if (Date.now() - d.newest < ALERT_DELAY_MS - 5_000) return { sent: 0, reason: "still writing" };
    const m = alertText(d);
    // Phase 0.5d step 4: the owner of this video's business (Wrangler keeps ALERT_EMAIL if it's set).
    const biz = await ctx.runQuery(internal.business.contact, {});
    const to = (biz.isDefault && process.env.ALERT_EMAIL) || biz.ownerEmail;
    const ok = await deliver(ctx, `alert:${videoId}:${d.noteIds[d.noteIds.length - 1]}`, "alert", to, m.subject, m.text);
    if (ok) await ctx.runMutation(internal.emails.markAlerted, { noteIds: d.noteIds });
    return { sent: ok ? 1 : 0, notes: d.noteIds.length };
  },
});

// ---------- unsubscribe (the link in every client email) ----------

export const setOff = internalMutation({
  args: { key: v.string(), kind: v.union(v.literal("versions"), v.literal("replies")), off: v.boolean() },
  handler: async (ctx, { key, kind, off }) => {
    const row = await ctx.db.query("emailPrefs").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!row) return null;
    await ctx.db.patch(row._id, { ...(kind === "versions" ? { versionsOff: off } : { repliesOff: off }), updatedAt: Date.now() });
    return row.email;
  },
});

const page = (title: string, body: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="margin:0;background:#030104;color:#f3efe8;font:16px/1.5 -apple-system,Helvetica,Arial,sans-serif"><div style="max-width:440px;margin:0 auto;padding:56px 24px">
<div style="font:600 11px/1 Helvetica,Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#ff1a0e;margin-bottom:14px">Wrangler Review</div>
<h1 style="font-size:24px;margin:0 0 12px">${title}</h1><p style="margin:0;color:#b8b2aa">${body}</p></div></body>`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// GET shows a button (mail scanners follow links; they don't press buttons); POST does it.
export const stop = httpAction(async (ctx, req) => {
  const u = new URL(req.url);
  const key = u.searchParams.get("k") ?? "", t = u.searchParams.get("t");
  const kind: Kind | null = t === "versions" || t === "replies" ? t : null;
  const html = (s: string, b: string, status = 200) => new Response(page(s, b), { status, headers: { "content-type": "text/html; charset=utf-8" } });
  if (!key || !kind || key.length > 64) return html("That link isn't right.", "Use the link at the bottom of the email, whole.", 400);
  const what = kind === "versions" ? "new versions" : "replies to your notes";
  if (req.method !== "POST") {
    return html(`Stop emails about ${what}?`, `<form method="post" action="${esc(u.pathname)}?k=${encodeURIComponent(key)}&amp;t=${kind}" style="margin-top:18px"><button style="font:600 14px Helvetica,Arial,sans-serif;background:#ff1a0e;color:#fff;border:0;border-radius:999px;padding:12px 22px;cursor:pointer">Yes, stop them</button></form><span style="display:block;margin-top:14px;font-size:13px">Emails you ask for yourself (sign-in codes) still arrive.</span>`);
  }
  const email = await ctx.runMutation(internal.emails.setOff, { key, kind, off: true });
  if (!email) return html("That link isn't right.", "Use the link at the bottom of the email, whole.", 404);
  return html(`Done. No more emails about ${what}.`, `${esc(email)} won't get them any more. Changed your mind? Reply to any Wrangler Review email.`);
});

/** For Settings › Clients: each invited person's choices. */
export async function prefsByEmail(ctx: QueryCtx, emails: string[]) {
  const out = new Map<string, { versionsOff: boolean; repliesOff: boolean }>();
  for (const e of emails) {
    const p = await ctx.db.query("emailPrefs").withIndex("by_email", (q) => q.eq("email", e)).first();
    if (p) out.set(e, { versionsOff: !!p.versionsOff, repliesOff: !!p.repliesOff });
  }
  return out;
}
