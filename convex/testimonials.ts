// Phase 5 (Nov 3): the testimonial request (frames S5 · Phase 5: the client's form 742:3479 and Thanks 742:3833, the
// owner's Clients › Testimonials 743:1991, email 35). Decisions: D34 the two questions as drawn; D99 the list lives under
// Clients; D139 the request is an Inbox note the owner sends from the composer ("Ask for a testimonial"), with no page of
// its own; D141 answers are collected for Heston's vault, NOT published: each one is saved as a Markdown note in the
// business's Dropbox app folder (Apps/Wrangler Review/Testimonials/), to be filed into the vault later.
//
//   - Only someone who received the request (an Inbox item for that note) can open the form, once per person.
//   - "You can use my words and name on your website" is kept with the answer; private ones are saved too, marked so.
//   - The owner hears by email and a Dashboard alert, until they mark it read.
import { focusBusiness, internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe, requireSignedIn } from "./lib/access";
import { businessContact } from "./lib/business";
import { businessOf } from "./lib/inbox";
import { label } from "./lib/bookingRows";
import { mailBrandOf } from "./lib/mail";
import { ownerTestimonialMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { SITE } from "./lib/site";
import { forBusiness } from "./lib/functions";

class DropboxError extends Error { constructor(public status: number, msg: string) { super(msg); } }

type Ctx = QueryCtx | MutationCtx;
export const QUESTIONS = { working: "What was it like working with us?", film: "What did the film do for you?" } as const; // D34
const MAX = 2000;
const tidy = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX);

// ---------- the composer (owner) ----------

/** The client's projects, for "Ask for a testimonial" in the composer (delivered ones first). */
export const projectsFor = query({
  args: { clientId: v.string() },
  handler: async (ctx, { clientId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("clients", clientId);
    if (!id || !(await ctx.db.get(id))) return [];
    const rows = (await ctx.db.query("projects").collect()).filter((p) => p.clientId === id);
    const out = [];
    for (const p of rows) {
      const asked = (await ctx.db.query("inboxNotes").withIndex("by_client", (q) => q.eq("clientId", id)).collect()).some((n) => n.status === "sent" && n.testimonialProjectId === p._id);
      out.push({ _id: p._id, label: label(p), delivered: !!p.deliveryUnlockedAt, asked, updatedAt: p.updatedAt ?? p.createdAt });
    }
    return out.sort((a, b) => Number(b.delivered) - Number(a.delivered) || b.updatedAt - a.updatedAt);
  },
});

/** The note's link to the form, and what the button says. */
export const askLink = (noteId: Id<"inboxNotes">) => ({ link: `/words/${noteId}`, linkLabel: "Share a few words" });

// ---------- the client ----------

async function clientAsk(ctx: Ctx, noteId: string) {
  const me = await requireSignedIn(ctx);
  if (me.kind !== "client") return null;
  const id = ctx.db.normalizeId("inboxNotes", noteId);
  const n = id ? await ctx.db.get(id) : null;
  if (!n || n.status !== "sent" || !n.testimonialProjectId) return null;
  focusBusiness(ctx, n.businessId); // a client of two businesses acts for this note's
  // Only someone the request was sent to (their own Inbox item for this note) can answer it.
  const got = await ctx.db.query("inboxItems").withIndex("by_key", (q) => q.eq("key", `note:${n._id}:${me.email}`)).first();
  if (!got) return null;
  const p = await ctx.db.get(n.testimonialProjectId);
  if (!p) return null;
  const client = await ctx.db.get(n.clientId);
  const b = n.businessId ? await ctx.db.get(n.businessId) : null;
  const mine = await ctx.db.query("testimonials").withIndex("by_note_email", (q) => q.eq("noteId", n._id).eq("email", me.email)).first();
  return { me, n, p, client, b, mine };
}

/** The form (or, once sent, what they wrote). */
export const ask = query({
  args: { noteId: v.string() },
  handler: async (ctx, { noteId }) => {
    const c = await clientAsk(ctx, noteId);
    if (!c) return null;
    const contact = await businessContact(ctx, c.n.businessId ?? null);
    return {
      project: { _id: c.p._id, label: label(c.p) }, business: c.b?.name ?? contact.name, owner: c.b?.ownerName?.trim() || contact.name,
      name: c.me.name?.trim() || null, company: c.client?.name ?? null, questions: QUESTIONS,
      sent: c.mine ? { working: c.mine.working, film: c.mine.film, permission: c.mine.permission, at: c.mine.createdAt } : null,
    };
  },
});

export const send = mutation({
  args: { noteId: v.string(), working: v.string(), film: v.string(), permission: v.boolean() },
  handler: async (ctx, a) => {
    const c = await clientAsk(ctx, a.noteId);
    if (!c) throw new ConvexError("This isn't here any more.");
    if (c.mine) throw new ConvexError("You've already sent it. Reply to the email to change it.");
    const working = tidy(a.working), film = tidy(a.film);
    if (!working && !film) throw new ConvexError("Answer at least one of the questions.");
    const now = Date.now();
    const name = c.me.name?.trim() || c.me.email;
    const id = await ctx.db.insert("testimonials", {
      noteId: c.n._id, projectId: c.p._id, ...(c.n.clientId ? { clientId: c.n.clientId } : {}), email: c.me.email, name,
      ...(c.client?.name ? { company: c.client.name } : {}), working, film, permission: a.permission, createdAt: now, updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.testimonials.saveToDropbox, { testimonialId: id });
    await ctx.scheduler.runAfter(0, internal.testimonials.mailOwner, { testimonialId: id });
    return { testimonialId: id };
  },
});

// ---------- Clients › Testimonials (owner) ----------

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const rows = await ctx.db.query("testimonials").withIndex("by_created").order("desc").take(500);
    const out = [];
    for (const t of rows) {
      const p = await ctx.db.get(t.projectId);
      out.push({
        _id: t._id, name: t.name, company: t.company ?? null, email: t.email, project: p ? label(p) : "A project", projectId: t.projectId,
        working: t.working, film: t.film, permission: t.permission, read: !!t.readAt, createdAt: t.createdAt,
        saved: t.savedAt ? { path: t.dropboxPath ?? null, at: t.savedAt } : null, saveError: t.saveError ?? null,
      });
    }
    return out;
  },
});

export const markRead = mutation({
  args: { testimonialId: v.id("testimonials") },
  handler: async (ctx, { testimonialId }) => {
    await requireMe(ctx);
    const t = await ctx.db.get(testimonialId);
    if (!t) throw new ConvexError("That testimonial isn't here.");
    if (!t.readAt) await ctx.db.patch(t._id, { readAt: Date.now(), updatedAt: Date.now() });
    return null;
  },
});

/** Try saving the note to Dropbox again (after connecting Dropbox, say). */
export const saveAgain = mutation({
  args: { testimonialId: v.id("testimonials") },
  handler: async (ctx, { testimonialId }) => {
    await requireMe(ctx);
    const t = await ctx.db.get(testimonialId);
    if (!t) throw new ConvexError("That testimonial isn't here.");
    if (t.savedAt) return { already: true };
    await ctx.db.patch(t._id, { saveError: undefined, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.testimonials.saveToDropbox, { testimonialId });
    return { already: false };
  },
});

/** Dashboard alerts (home.needs): testimonials not read yet. */
export async function testimonialNeeds(ctx: QueryCtx) {
  const out: Array<{ kind: "testimonial"; at: number; testimonialId: Id<"testimonials">; who: string; project: string }> = [];
  for (const t of await ctx.db.query("testimonials").withIndex("by_created").order("desc").take(200)) {
    if (t.readAt) continue;
    const p = await ctx.db.get(t.projectId);
    out.push({ kind: "testimonial", at: t.createdAt, testimonialId: t._id, who: t.company ? `${t.name}, ${t.company}` : t.name, project: p ? label(p) : "A project" });
  }
  return out;
}

// ---------- the vault note (D141) ----------

const day = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const safe = (s: string, max = 60) => s.replace(/[\\/:*?"<>|\u0000-\u001f#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim() || "Untitled";
const yamlStr = (s: string) => JSON.stringify(s);

/** The Markdown note: frontmatter for the vault, then the two answers. */
export function testimonialNote(t: Pick<Doc<"testimonials">, "name" | "company" | "email" | "working" | "film" | "permission" | "createdAt">, project: string, business: string) {
  const who = t.company ? `${t.name}, ${t.company}` : t.name;
  const quote = (s: string) => (s ? s.split("\n").map((l) => `> ${l}`).join("\n") : "> (no answer)");
  return [
    "---",
    "type: testimonial",
    `date: ${day(t.createdAt)}`,
    `name: ${yamlStr(t.name)}`,
    ...(t.company ? [`company: ${yamlStr(t.company)}`] : []),
    `email: ${yamlStr(t.email)}`,
    `project: ${yamlStr(project)}`,
    `business: ${yamlStr(business)}`,
    `permission: ${t.permission ? "yes" : "no"}`,
    "source: Wrangler Portal",
    "tags:",
    "  - testimonial",
    "---",
    `# ${who} · ${project}`,
    "",
    `**${QUESTIONS.working}**`,
    quote(t.working),
    "",
    `**${QUESTIONS.film}**`,
    quote(t.film),
    "",
    t.permission
      ? `Permission: yes. ${t.name} said: "You can use my words and name on your website." Shown as "${who}".`
      : "Permission: no. Private: keep it for yourself; don't use it publicly.",
    "",
  ].join("\n");
}

export const noteData = internalQuery({
  args: { testimonialId: v.id("testimonials") },
  handler: async (ctx, { testimonialId }) => {
    const t = await ctx.db.get(testimonialId);
    if (!t) return null;
    const p = await ctx.db.get(t.projectId);
    const biz = await businessOf(ctx, t);
    return { t, project: p ? label(p) : "A project", biz, business: (await businessContact(ctx, biz)).name };
  },
});

export const recordSave = internalMutation({
  args: { testimonialId: v.id("testimonials"), path: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const t = await ctx.db.get(a.testimonialId);
    if (!t) return;
    const now = Date.now();
    await ctx.db.patch(t._id, a.path ? { dropboxPath: a.path, savedAt: now, saveError: undefined, updatedAt: now } : { saveError: (a.error ?? "Couldn't save it.").slice(0, 200), updatedAt: now });
  },
});

const headerJson = (x: unknown) => JSON.stringify(x).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** Writes the note into the business's Dropbox app folder, under Testimonials/ (the render watcher ignores .md files). */
export const saveToDropbox = internalAction({
  args: { testimonialId: v.id("testimonials") },
  handler: async (ctx, { testimonialId }) => {
    const d = await ctx.runQuery(internal.testimonials.noteData, { testimonialId });
    if (!d || d.t.savedAt) return;
    let token: string;
    try { token = await forBusiness(ctx, d.biz).runAction(internal.dropbox.freshToken, {}); }
    catch { await ctx.runMutation(internal.testimonials.recordSave, { testimonialId, error: "Dropbox isn't connected. Connect it in Settings › Dropbox drop folder, then Save again." }); return; }
    const path = `/Testimonials/${day(d.t.createdAt)} ${safe(d.t.name, 40)} - ${safe(d.project)}.md`;
    try {
      const r = await fetch("https://content.dropboxapi.com/2/files/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/octet-stream", "Dropbox-API-Arg": headerJson({ path, mode: "add", autorename: true, mute: true }) },
        body: new TextEncoder().encode(testimonialNote(d.t, d.project, d.business)),
      });
      const text = await r.text();
      if (r.status !== 200) throw new DropboxError(r.status, text.slice(0, 160));
      const saved = (JSON.parse(text) as { path_display?: string }).path_display ?? path;
      await ctx.runMutation(internal.testimonials.recordSave, { testimonialId, path: saved });
    } catch (e) {
      const msg = e instanceof DropboxError && (e.status === 401 || e.status === 403) ? "Dropbox refused it. Reconnect Dropbox in Settings, then Save again." : "Couldn't save it to Dropbox. Try Save again.";
      await ctx.runMutation(internal.testimonials.recordSave, { testimonialId, error: msg });
    }
  },
});

// ---------- the owner's email ----------

export const mailOwner = internalAction({
  args: { testimonialId: v.id("testimonials") },
  handler: async (ctx, { testimonialId }) => {
    const d = await ctx.runQuery(internal.testimonials.noteData, { testimonialId });
    if (!d) return;
    const owner = (await ctx.runQuery(internal.testimonials.ownerOf, { testimonialId }));
    if (!owner) return;
    await deliverOnce(ctx, `testimonial:${testimonialId}`, "testimonial", owner.email, ownerTestimonialMail(owner.brand, {
      who: d.t.name, company: d.t.company ?? null, project: d.project, working: d.t.working, film: d.t.film, permission: d.t.permission, link: `${SITE()}/clients/testimonials`,
    }), owner.brand.replyTo, d.biz);
  },
});
export const ownerOf = internalQuery({
  args: { testimonialId: v.id("testimonials") },
  handler: async (ctx, { testimonialId }) => {
    const t = await ctx.db.get(testimonialId);
    if (!t) return null;
    const biz = await businessOf(ctx, t);
    return { email: (await businessContact(ctx, biz)).ownerEmail, brand: await mailBrandOf(ctx, biz) };
  },
});
