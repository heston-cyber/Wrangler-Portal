// Emails (client side C4, Oct 23), all through Resend from review@wranglerportal.com, reply-to Heston:
//   newVersion   a version became playable → each person on an invited share covering it (switch per share)
//   replyToNote  Heston replied to a client's note (or showed a hidden reply) → the note's author (client accounts)
//   ownerAlert   clients or guests left notes → one email to Heston per sitting, 10 minutes after the last note
// Every client email carries an unsubscribe link for that kind; each email is logged by key so it goes out once.
// Bodies name the video and its project only, never other clients; links carry the share token, never a key.
import { internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { requireSignedIn } from "./lib/access";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { allowedEmails } from "./auth";
import { frameTc } from "./lib/frames";
import { randomToken } from "./lib/hash";
import { businessInScope, defaultBusiness } from "./lib/business";
import { REPLY_TO, SITE, sendEmail } from "./lib/email";
import { clientKey, sameBusiness, shareCovers, shareState } from "./lib/shareAccess";
import { emailThumbUrl } from "./lib/media";
import { mailBrandOf } from "./lib/mail";
import { type Mail, newVersionMail, noteMail, ownerAlertMail, portalInviteMail, replyMail } from "./lib/mails";

export const ALERT_DELAY_MS = 10 * 60_000;
export const NEW_VERSION_DELAY_MS = 60_000;
type Kind = "versions" | "replies" | "notes";
const projectLabel = (p: { name: string; jobNumber?: string } | null) => (p ? (p.jobNumber ? `${p.jobNumber} ${p.name}` : p.name) : "");

/** Where Heston's own alerts go: ALERT_EMAIL, else the first owner email, else the reply-to address. */
export const alertEmail = () => process.env.ALERT_EMAIL || allowedEmails()[0] || REPLY_TO();

// ---------- preferences and the log ----------

/** Step 6: a person has one prefs row per business; pick the one for the business this call acts for (the default
 *  business when it acts for none), never another business's. */
async function prefsRow(ctx: QueryCtx | MutationCtx, email: string) {
  const rows = await ctx.db.query("emailPrefs").withIndex("by_email", (q) => q.eq("email", email)).collect();
  const def = (await defaultBusiness(ctx))?._id ?? null;
  const biz = businessInScope(ctx) ?? def;
  return rows.find((r) => (r.businessId ?? def) === biz) ?? null;
}

async function prefsFor(ctx: MutationCtx, email: string) {
  const row = await prefsRow(ctx, email);
  if (row) return row;
  const id = await ctx.db.insert("emailPrefs", { email, key: randomToken(18), updatedAt: Date.now() });
  return (await ctx.db.get(id))!;
}

/** Who may still get which kinds; makes the prefs row (and its unsubscribe key) on first use. */
export const recipients = internalMutation({
  args: { emails: v.array(v.string()), kind: v.union(v.literal("versions"), v.literal("replies"), v.literal("notes")) },
  handler: async (ctx, { emails, kind }) => {
    const out: Array<{ email: string; key: string }> = [];
    for (const e of [...new Set(emails.map((x) => x.trim().toLowerCase()).filter(Boolean))]) {
      const p = await prefsFor(ctx, e);
      // Notes stop only when the client has switched everything off (Settings › "Email me when something new arrives").
      if (kind === "versions" ? p.versionsOff : kind === "replies" ? p.repliesOff : notesOff(p)) continue;
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
async function deliver(ctx: { runMutation: (ref: any, args: any) => Promise<any> }, key: string, kind: string, to: string, m: Mail, unsubscribe?: string, replyTo?: string | null): Promise<boolean> {
  if (!(await ctx.runMutation(internal.emails.claim, { key, kind, to }))) return false;
  try {
    const id = await sendEmail({ from: m.from, to, subject: m.subject, text: m.text, html: m.html, tag: kind, unsubscribe, replyTo });
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
    return { title: vid.title, number: ver.number, description: ver.description ?? null, project: projectLabel(project), videoId: vid._id, people, businessId: vid.businessId ?? null, thumbUrl: await emailThumbUrl(ver), brand: await mailBrandOf(ctx, vid.businessId) };
  },
});


export const newVersion = internalAction({
  args: { versionId: v.id("versions") },
  handler: async (ctx, { versionId }): Promise<{ sent: number }> => {
    try { await ctx.runMutation(internal.inbox.onVersionReady, { versionId }); } catch (e) { console.error("inbox", String((e as Error).message).slice(0, 120)); } // Phase 1: the Inbox (never blocks the email)
    const d = await ctx.runQuery(internal.emails.newVersionData, { versionId });
    if (!d || !d.people.length) return { sent: 0 };
    const ok: Array<{ email: string; key: string }> = await ctx.runMutation(internal.emails.recipients, { emails: d.people.map((p: { email: string }) => p.email), kind: "versions" });
    let sent = 0;
    for (const r of ok) {
      const p = d.people.find((x: { email: string }) => x.email === r.email)!;
      const m = newVersionMail(d.brand, { ...d, name: p.name, link: `${SITE()}/s/${p.token}/v/${d.videoId}?version=${d.number}`, unsub: unsubUrl(r.key, "versions") });
      if (await deliver(ctx, `version:${versionId}:${r.email}`, "versions", r.email, m, unsubUrl(r.key, "versions"), d.brand.replyTo)) { sent++; await ctx.runMutation(internal.emails.markInboxEmailed, { key: `version:${versionId}`, email: r.email }); }
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
      title: vid.title, number: ver.number, project: projectLabel(project), brand: await mailBrandOf(ctx, vid.businessId),
      link: share && !shareState(share) ? `${SITE()}/s/${share.token}/v/${vid._id}?version=${ver.number}&note=${n._id}` : `${SITE()}/`,
    };
  },
});


export const replyToNote = internalAction({
  args: { replyId: v.id("replies") },
  handler: async (ctx, { replyId }): Promise<{ sent: number }> => {
    try { await ctx.runMutation(internal.inbox.onReply, { replyId }); } catch (e) { console.error("inbox", String((e as Error).message).slice(0, 120)); } // Phase 1: the Inbox (never blocks the email)
    const d = await ctx.runQuery(internal.emails.replyData, { replyId });
    if (!d) return { sent: 0 };
    const ok: Array<{ email: string; key: string }> = await ctx.runMutation(internal.emails.recipients, { emails: [d.to], kind: "replies" });
    if (!ok.length) return { sent: 0 };
    const m = replyMail(d.brand, { ...d, unsub: unsubUrl(ok[0].key, "replies") });
    const sent = await deliver(ctx, `reply:${replyId}`, "replies", d.to, m, unsubUrl(ok[0].key, "replies"), d.brand.replyTo);
    if (sent) await ctx.runMutation(internal.emails.markInboxEmailed, { key: `reply:${replyId}`, email: d.to });
    return { sent: sent ? 1 : 0 };
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
    return { title: vid.title, project: projectLabel(project), newest, videoId, noteIds: notes.map((n) => n._id), rows, brand: await mailBrandOf(ctx, vid.businessId) };
  },
});

export const markAlerted = internalMutation({
  args: { noteIds: v.array(v.id("notes")) },
  handler: async (ctx, { noteIds }) => { const now = Date.now(); for (const id of noteIds) if (await ctx.db.get(id)) await ctx.db.patch(id, { alertedAt: now }); },
});


// Runs 10 minutes after each client/guest note. If a newer note landed in the meantime, a later run handles the batch.
export const ownerAlert = internalAction({
  args: { videoId: v.id("videos") },
  handler: async (ctx, { videoId }): Promise<{ sent: number; reason?: string; notes?: number }> => {
    const d = await ctx.runQuery(internal.emails.alertData, { videoId });
    if (!d) return { sent: 0, reason: "nothing new" };
    if (Date.now() - d.newest < ALERT_DELAY_MS - 5_000) return { sent: 0, reason: "still writing" };
    const m = ownerAlertMail(d.brand, d);
    // Phase 0.5d step 4: the owner of this video's business (Wrangler keeps ALERT_EMAIL if it's set).
    const biz = await ctx.runQuery(internal.business.contact, {});
    const to = (biz.isDefault && process.env.ALERT_EMAIL) || biz.ownerEmail;
    const ok = await deliver(ctx, `alert:${videoId}:${d.noteIds[d.noteIds.length - 1]}`, "alert", to, m, undefined, null);
    if (ok) await ctx.runMutation(internal.emails.markAlerted, { noteIds: d.noteIds });
    return { sent: ok ? 1 : 0, notes: d.noteIds.length };
  },
});

// ---------- unsubscribe (the link in every client email) ----------

export const setOff = internalMutation({
  args: { key: v.string(), kind: v.union(v.literal("versions"), v.literal("replies"), v.literal("notes")), off: v.boolean() },
  handler: async (ctx, { key, kind, off }) => {
    const row = await ctx.db.query("emailPrefs").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!row) return null;
    await ctx.db.patch(row._id, { ...(kind === "versions" ? { versionsOff: off } : kind === "replies" ? { repliesOff: off } : { notesOff: off }), updatedAt: Date.now() });
    return row.email;
  },
});

// The unsubscribe pages (P1 / Client / Unsubscribe: Ask, Done, Bad link): one glass card on the portal's dark page.
const ICONS = {
  mail: '<path d="M3 6h18v12H3z M3 6l9 7 9-7" fill="none" stroke="#FF0000" stroke-width="1.5" stroke-linejoin="round"/>',
  check: '<circle cx="12" cy="12" r="9" fill="none" stroke="#FF0000" stroke-width="1.5"/><path d="M8 12.5l2.7 2.7L16.5 9.5" fill="none" stroke="#FF0000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  alert: '<path d="M12 3l10 18H2z" fill="none" stroke="#FF0000" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 10v5M12 18v.01" stroke="#FF0000" stroke-width="1.5" stroke-linecap="round"/>',
};
const page = (title: string, body: string, icon: keyof typeof ICONS = "mail") => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · WranglerPortal</title>
<body style="margin:0;min-height:100vh;display:flex;flex-direction:column;background:#030104 radial-gradient(120% 70% at 50% -10%,rgba(160,10,0,.55),rgba(3,1,4,0) 70%);color:#F4F1E9;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif">
<header style="padding:22px 40px;display:flex;align-items:center;gap:12px"><span style="width:12px;height:12px;border-radius:6px;background:#FF0000;box-shadow:0 0 10px rgba(255,0,0,.6)"></span><img src="${SITE()}/brand/wp-logo-email.png" alt="WranglerPortal" height="24" style="height:24px"></header>
<main style="flex:1;display:flex;align-items:center;justify-content:center;padding:24px 16px">
<div style="width:100%;max-width:520px;box-sizing:border-box;padding:36px 32px 32px;border-radius:28px;border:1px solid rgba(244,241,233,.75);background:rgba(3,1,4,.34);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);display:flex;flex-direction:column;gap:16px;align-items:flex-start">
<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" style="filter:drop-shadow(0 0 2px rgba(255,0,0,.45))">${ICONS[icon]}</svg>
<h1 style="margin:0;font:600 24px/26.88px 'Industry','Saira',-apple-system,Helvetica,Arial,sans-serif;letter-spacing:-.24px">${title}</h1>
<div style="margin:0;color:rgba(244,241,233,.78)">${body}</div></div></main>
<footer style="padding:18px;text-align:center;font-size:13px;color:rgba(244,241,233,.55)">WranglerPortal</footer></body></html>`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// GET shows a button (mail scanners follow links; they don't press buttons); POST does it.
export const stop = httpAction(async (ctx, req) => {
  const u = new URL(req.url);
  const key = u.searchParams.get("k") ?? "", t = u.searchParams.get("t");
  const kind: Kind | null = t === "versions" || t === "replies" || t === "notes" ? t : null;
  const html = (s: string, b: string, status = 200, icon: keyof typeof ICONS = "mail") => new Response(page(s, b, icon), { status, headers: { "content-type": "text/html; charset=utf-8" } });
  if (!key || !kind || key.length > 64) return html("That link isn't right.", "Use the link at the bottom of the email, whole.", 400, "alert");
  const what = kind === "versions" ? "new versions" : kind === "replies" ? "replies to your notes" : "notes";
  if (req.method !== "POST") {
    return html(`Stop emails about ${what}?`, `<form method="post" action="${esc(u.pathname)}?k=${encodeURIComponent(key)}&amp;t=${kind}" style="margin:0"><button style="font:400 15px/15px 'Industry','Saira',-apple-system,Helvetica,Arial,sans-serif;background:#FF0000;color:#F4F1E9;border:0;border-radius:12px;height:44px;padding:0 20px;cursor:pointer;box-shadow:0 0 3px rgba(255,0,0,.65),0 0 9px rgba(255,0,0,.45),0 0 20px rgba(255,0,0,.25)">Yes, stop them</button></form><span style="display:block;margin-top:16px;font-size:13px;color:rgba(244,241,233,.55)">Emails you ask for yourself (sign-in codes) still arrive.</span>`);
  }
  const email = await ctx.runMutation(internal.emails.setOff, { key, kind, off: true });
  if (!email) return html("That link isn't right.", "Use the link at the bottom of the email, whole.", 404, "alert");
  return html(`Done. No more emails about ${what}.`, `${esc(email)} won't get them any more. Changed your mind? Reply to any WranglerPortal email.`, 200, "check");
});

/** For Settings › Clients: each invited person's choices. */
export async function prefsByEmail(ctx: QueryCtx, emails: string[]) {
  const out = new Map<string, { versionsOff: boolean; repliesOff: boolean }>();
  for (const e of emails) {
    const p = await prefsRow(ctx, e);
    if (p) out.set(e, { versionsOff: !!p.versionsOff, repliesOff: !!p.repliesOff });
  }
  return out;
}

/** Notes stop when asked for directly, or (rows from before notes had their own switch) when both others are off. */
const notesOff = (p: { versionsOff?: boolean; repliesOff?: boolean; notesOff?: boolean }) => p.notesOff ?? (!!p.versionsOff && !!p.repliesOff);

// ---------- the client's own choice (Settings › "Email me when something new arrives", Phase 1) ----------
// One switch for the client: off stops both kinds (new versions and replies); on turns both back on.

export const myPrefs = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    const rows = await myPrefRows(ctx, me.email);
    return { on: !(rows.length && rows.every((p) => p.versionsOff && p.repliesOff && notesOff(p))) };
  },
});

export const setMine = mutation({
  args: { on: v.boolean() },
  handler: async (ctx, { on }) => {
    const me = await requireSignedIn(ctx);
    // Review (Oct 29): a client of several businesses has one prefs row per business; the switch sets all of them.
    const now = Date.now();
    const have = await myPrefRows(ctx, me.email);
    for (const biz of await clientBusinesses(ctx, me.email)) {
      const row = have.find((r) => String(r.businessId ?? "") === biz);
      if (row) await ctx.db.patch(row._id, { versionsOff: !on, repliesOff: !on, notesOff: !on, updatedAt: now });
      else await ctx.db.insert("emailPrefs", { businessId: biz as Doc<"businesses">["_id"], email: me.email, key: randomToken(18), versionsOff: !on, repliesOff: !on, notesOff: !on, updatedAt: now });
    }
    return null;
  },
});

/** The businesses this person is a client of (a live invite), as ids. */
async function clientBusinesses(ctx: QueryCtx | MutationCtx, email: string) {
  const def = (await defaultBusiness(ctx))?._id ?? null;
  const out = new Set<string>();
  for (const i of await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()) if (!i.revokedAt && (i.businessId ?? def)) out.add(String(i.businessId ?? def));
  return [...out];
}
/** This person's prefs rows in those businesses (an untagged row counts as the default business's). */
async function myPrefRows(ctx: QueryCtx | MutationCtx, email: string) {
  const def = (await defaultBusiness(ctx))?._id ?? null;
  const mine = new Set(await clientBusinesses(ctx, email));
  return (await ctx.db.query("emailPrefs").withIndex("by_email", (q) => q.eq("email", email)).collect())
    .map((r) => ({ ...r, businessId: (r.businessId ?? def ?? undefined) as typeof r.businessId }))
    .filter((r) => mine.has(String(r.businessId ?? "")));
}

// ---------- a note from the business (Inbox alert layout, from updates@) ----------

export const noteEmailData = internalQuery({
  args: { noteId: v.id("inboxNotes") },
  handler: async (ctx, { noteId }) => {
    const n = await ctx.db.get(noteId);
    if (!n || n.status !== "sent" || n.emailThem === false) return null;
    const items = await ctx.db.query("inboxItems").withIndex("by_note", (q) => q.eq("noteId", noteId)).collect();
    return { title: n.title, text: n.text, link: n.link ?? null, linkLabel: n.linkLabel ?? null, emails: items.map((i) => i.email), brand: await mailBrandOf(ctx, n.businessId) };
  },
});

export const noteEmails = internalAction({
  args: { noteId: v.id("inboxNotes") },
  handler: async (ctx, { noteId }): Promise<{ sent: number }> => {
    const d = await ctx.runQuery(internal.emails.noteEmailData, { noteId });
    if (!d || !d.emails.length) return { sent: 0 };
    const ok: Array<{ email: string; key: string }> = await ctx.runMutation(internal.emails.recipients, { emails: d.emails, kind: "notes" });
    let sent = 0;
    for (const r of ok) {
      const m = noteMail(d.brand, { ...d, unsub: unsubUrl(r.key, "notes") });
      if (await deliver(ctx, `note:${noteId}:${r.email}`, "notes", r.email, m, unsubUrl(r.key, "notes"), d.brand.replyTo)) { sent++; await ctx.runMutation(internal.emails.markInboxEmailed, { key: `note:${noteId}`, email: r.email }); }
    }
    return { sent };
  },
});

// ---------- "Invite to the portal" from the client page ----------

export const portalInviteData = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const inv = (await ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", email)).collect()).find((i) => !i.revokedAt);
    if (!inv) return null;
    const person = (await ctx.db.query("clientPeople").withIndex("by_email", (q) => q.eq("email", email)).collect()).find((p) => !p.removedAt);
    return { name: person?.name ?? inv.name ?? null, hasAccount: !!inv.acceptedAt, brand: await mailBrandOf(ctx, inv.businessId ?? null) };
  },
});

export const portalInvite = internalAction({
  args: { email: v.string(), sendKey: v.string() },
  handler: async (ctx, { email, sendKey }): Promise<{ sent: boolean }> => {
    const d = await ctx.runQuery(internal.emails.portalInviteData, { email });
    if (!d) return { sent: false };
    const m = portalInviteMail(d.brand, { name: d.name, email, hasAccount: d.hasAccount });
    return { sent: await deliver(ctx, `portal-invite:${email}:${sendKey}`, "invite", email, m, undefined, d.brand.replyTo) };
  },
});

/** The one-email switch (Phase 1 step 5): the Inbox item for the same event notes that its email went out. */
export const markInboxEmailed = internalMutation({
  args: { key: v.string(), email: v.string() },
  handler: async (ctx, { key, email }) => {
    const item = await ctx.db.query("inboxItems").withIndex("by_key", (q) => q.eq("key", `${key}:${email.toLowerCase()}`)).first();
    if (item && !item.emailedAt) await ctx.db.patch(item._id, { emailedAt: Date.now() });
    return null;
  },
});
