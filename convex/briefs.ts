// Phase 4 (Nov 2): the kickoff brief, option B (Heston: "Use the option B for the briefing").
//   - Each business keeps its own short set of client-friendly questions (Settings › Kickoff brief), starting from
//     lib/kickoff.ts. No file questions: files come through file requests.
//   - The owner sends it from the project's Requests and brief card. The project's portal people get an Inbox item and
//     email 33 (742:2668). The questions are copied into the brief when it's sent.
//   - The client answers it step by step (740:1671), saving as they go; Review sends it back (740:2074). They can
//     change it afterwards. The owner gets an email each time it comes back (switchable), sees the answers on the card,
//     and can start an estimate from them.
import { focusBusiness, internalAction, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe, requireSignedIn } from "./lib/access";
import { businessContact, businessInScope } from "./lib/business";
import { businessOf, postToInbox } from "./lib/inbox";
import { myProjects, portalPeople } from "./projects";
import { label } from "./lib/bookingRows";
import { mailBrandOf } from "./lib/mail";
import { briefMail, ownerBriefMail } from "./lib/mails";
import { deliverOnce } from "./invoiceReminders";
import { SITE } from "./lib/site";
import { KICKOFF_BRIEF } from "./lib/kickoff";
import { answerList, cleanQuestionnaire, type Answers, type Question, type Questionnaire } from "./lib/questionnaire";

type Ctx = QueryCtx | MutationCtx;
const REMIND_GAP = 20 * 3_600_000;       // one reminder a day at most
const QUIET_CHANGES = 10 * 60_000;       // changes sent back: one owner email, 10 minutes after the last

async function ownerBiz(ctx: Ctx) {
  const me = await requireMe(ctx);
  const id = businessInScope(ctx);
  const b = id ? await ctx.db.get(id) : null;
  if (!b) throw new ConvexError("Not allowed.");
  return { me, b };
}
const setOf = (b: Doc<"businesses"> | null): Questionnaire => (b?.kickoff as Questionnaire | undefined) ?? KICKOFF_BRIEF;
/** "Project, brand, dates" */
export const coversOf = (qn: Questionnaire) => { const t = qn.steps.map((s) => s.title.toLowerCase()).join(", "); return t.charAt(0).toUpperCase() + t.slice(1); };
const questionsIn = (qn: Questionnaire) => qn.steps.reduce((n, s) => n + s.questions.length, 0);

// ---------- answers ----------

const str = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : undefined);
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
/** Only the brief's own questions, each in its own shape and size. */
export function cleanAnswers(qn: Questionnaire, raw: unknown): Answers {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Answers = {};
  for (const s of qn.steps) for (const qq of s.questions) {
    const x = a[qq.id];
    if (x === undefined || x === null || x === "") continue;
    let val: unknown;
    switch (qq.type) {
      case "short": val = str(x, 500); break;
      case "select": { const w = str(x, 120); val = w !== undefined && (qq.other || (qq.options ?? []).includes(w)) ? w : undefined; break; }
      case "long": val = str(x, 4000); break;
      case "multi": val = Array.isArray(x) ? [...new Set(x.map((w) => str(w, 80)).filter((w): w is string => !!w && !!w.trim() && (!!qq.other || (qq.options ?? []).includes(w))))].slice(0, 30) : undefined; break;
      case "link": val = qq.multiple ? (Array.isArray(x) ? x.map((u) => str(u, 500)).filter((u): u is string => u !== undefined).slice(0, 20) : undefined) : str(x, 500); break;
      case "colors": val = Array.isArray(x) ? x.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)).map((c) => c.toUpperCase()).slice(0, 12) : undefined; break;
      case "date": val = isDay(x) ? x : undefined; break;
      case "daterange": { const r = x as { start?: unknown; end?: unknown }; val = r && typeof r === "object" && isDay(r.start) ? { start: r.start, ...(isDay(r.end) && r.end >= r.start ? { end: r.end } : {}) } : undefined; break; }
      case "money": case "number": val = typeof x === "number" && Number.isFinite(x) && x >= 0 && x < 1e12 ? x : undefined; break;
      default: val = undefined;
    }
    if (val !== undefined && !(Array.isArray(val) && !val.length)) out[qq.id] = val;
  }
  if (JSON.stringify(out).length > 40_000) throw new ConvexError("Those answers are too long.");
  return out;
}
const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.some((x) => (typeof x === "string" ? x.trim() : x)))
  || (typeof v === "object" && !Array.isArray(v) && !(v as { start?: string }).start);
export const missing = (qn: Questionnaire, a: Answers): Question[] => qn.steps.flatMap((s) => s.questions.filter((qq) => qq.required && blank(a[qq.id])));

// ---------- Settings › Kickoff brief ----------

export const settings = query({
  args: {},
  handler: async (ctx) => {
    const { b } = await ownerBiz(ctx);
    return { questionnaire: setOf(b), custom: !!b.kickoff, wrangler: KICKOFF_BRIEF, covers: coversOf(setOf(b)), questions: questionsIn(setOf(b)) };
  },
});
export const saveSettings = mutation({
  args: { questionnaire: v.any() },
  handler: async (ctx, a) => {
    const { b } = await ownerBiz(ctx);
    if (JSON.stringify(a.questionnaire ?? null).length > 60_000) throw new ConvexError("That brief is too long.");
    let qn: Questionnaire;
    try { qn = cleanQuestionnaire(a.questionnaire, "kickoff"); } catch (e) { throw new ConvexError((e as Error).message); }
    if (!questionsIn(qn)) throw new ConvexError("A brief needs at least one question.");
    for (const s of qn.steps) for (const qq of s.questions) {
      if (qq.required && (qq.type === "select" || qq.type === "multi") && !(qq.options ?? []).some((o) => o.trim()) && !qq.other) throw new ConvexError(`"${qq.label}" is required but has nothing to pick. Add options, or allow "Other".`);
    }
    await ctx.db.patch(b._id, { kickoff: qn });
    return null;
  },
});
export const resetSettings = mutation({
  args: {},
  handler: async (ctx) => {
    const { b } = await ownerBiz(ctx);
    await ctx.db.patch(b._id, { kickoff: undefined });
    return null;
  },
});

// ---------- the owner, on the project ----------

async function nameOf(ctx: Ctx, email: string | undefined) {
  if (!email) return null;
  return (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).first())?.name?.trim() || email;
}
async function ownedProject(ctx: Ctx, projectId: string) {
  const id = ctx.db.normalizeId("projects", projectId);
  const p = id ? await ctx.db.get(id) : null;
  if (!p) throw new ConvexError("This project doesn't exist any more.");
  return p;
}

export const forProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("projects", projectId);
    const p = id ? await ctx.db.get(id) : null;
    if (!p) return null;
    const r = await ctx.db.query("briefs").withIndex("by_project", (q) => q.eq("projectId", p._id)).first();
    const people = (await portalPeople(ctx, p)).length;
    if (!r) return { brief: null, people };
    const qn = r.questions as Questionnaire;
    return {
      people,
      brief: {
        _id: r._id, status: r.status, sentAt: r.sentAt, remindedAt: r.remindedAt ?? null, startedAt: r.startedAt ?? null, submittedAt: r.submittedAt ?? null,
        by: await nameOf(ctx, r.submittedBy), updatedBy: await nameOf(ctx, r.updatedBy), submits: r.submits, updatedAt: r.updatedAt,
        answers: answerList(qn, r.answers as Answers), questions: questionsIn(qn),
        remindAt: (r.remindedAt ?? r.sentAt) + REMIND_GAP + 1, // a query doesn't re-run as time passes: the page compares
      },
    };
  },
});

export const send = mutation({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const { b } = await ownerBiz(ctx);
    const p = await ownedProject(ctx, projectId);
    if (await ctx.db.query("briefs").withIndex("by_project", (q) => q.eq("projectId", p._id)).first()) throw new ConvexError("The kickoff brief has already gone to this project.");
    const people = await portalPeople(ctx, p);
    if (!people.length) throw new ConvexError("Nobody at the client can open this project in the portal yet. Share the project with them first.");
    const qn = setOf(b);
    const now = Date.now();
    const briefId = await ctx.db.insert("briefs", {
      projectId: p._id, questions: qn, answers: {}, step: 0, status: "sent", sentAt: now, submits: 0,
      history: [{ at: now, text: "Sent" }], createdAt: now, updatedAt: now,
    });
    const biz = await businessOf(ctx, p);
    for (const person of people) {
      await postToInbox(ctx, { businessId: biz!, clientId: p.clientId, email: person.email, kind: "brief", title: `Kickoff brief: ${label(p)}`,
        text: `About 10 minutes. ${coversOf(qn)}.`, link: `/briefs/${briefId}`, linkLabel: "Start", source: { module: "schedule", id: briefId }, key: `brief:${briefId}` });
    }
    await ctx.scheduler.runAfter(0, internal.briefs.mail, { briefId, kind: "sent", emails: people.map((x) => x.email) });
    return { briefId, told: people.length };
  },
});

export const remind = mutation({
  args: { briefId: v.id("briefs") },
  handler: async (ctx, { briefId }) => {
    await requireMe(ctx);
    const r = await ctx.db.get(briefId);
    if (!r) throw new ConvexError("That brief isn't here any more.");
    if (r.status !== "sent") throw new ConvexError("They've already sent it back.");
    if (Date.now() - (r.remindedAt ?? r.sentAt) <= REMIND_GAP) throw new ConvexError("They had an email about it today. Try again tomorrow.");
    const p = await ctx.db.get(r.projectId);
    const people = p ? await portalPeople(ctx, p) : [];
    if (!people.length) throw new ConvexError("Nobody at the client can open this project in the portal now.");
    const now = Date.now();
    await ctx.db.patch(briefId, { remindedAt: now, updatedAt: now, history: [...r.history, { at: now, text: "Reminded" }] });
    await ctx.scheduler.runAfter(0, internal.briefs.mail, { briefId, kind: "reminder", emails: people.map((x) => x.email), at: now });
    return { told: people.length };
  },
});

/** New estimate › from the brief: the project's name and the answers as the scope summary. */
export const forEstimate = query({
  args: { briefId: v.string() },
  handler: async (ctx, { briefId }) => {
    await requireMe(ctx);
    const id = ctx.db.normalizeId("briefs", briefId);
    const r = id ? await ctx.db.get(id) : null;
    if (!r) return null;
    const p = await ctx.db.get(r.projectId);
    if (!p) return null;
    const lines = answerList(r.questions as Questionnaire, r.answers as Answers).flatMap((s) => s.answers.map((a) => `${a.question} ${a.answer}`));
    return { projectId: p._id, clientId: p.clientId ?? null, title: p.name, scope: `From the kickoff brief:\n${lines.join("\n")}`.slice(0, 4000) };
  },
});

// ---------- the client ----------

async function clientBrief(ctx: Ctx, briefId: string) {
  const me = await requireSignedIn(ctx);
  if (me.kind !== "client") return null;
  const id = ctx.db.normalizeId("briefs", briefId);
  const r = id ? await ctx.db.get(id) : null;
  if (!r) return null;
  // A client of more than one business acts for this brief's (so what it schedules, like the owner's email, has a home).
  focusBusiness(ctx, r.businessId);
  const row = (await myProjects(ctx as QueryCtx, me.email)).get(r.projectId);
  if (!row) return null;
  const b = row.project.businessId ? await ctx.db.get(row.project.businessId) : null;
  if (b?.modules?.projects === false) return null;
  return { me, r, p: row.project, b };
}

export const forClientProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return null;
    const id = ctx.db.normalizeId("projects", projectId);
    if (!id || !(await myProjects(ctx, me.email)).has(id)) return null;
    const r = await ctx.db.query("briefs").withIndex("by_project", (q) => q.eq("projectId", id)).first();
    return r ? { _id: r._id, status: r.status, started: !!r.startedAt, submittedAt: r.submittedAt ?? null } : null;
  },
});

export const page = query({
  args: { briefId: v.string() },
  handler: async (ctx, { briefId }) => {
    const c = await clientBrief(ctx, briefId);
    if (!c) return null;
    const contact = await businessContact(ctx, c.p.businessId ?? null);
    const qn = c.r.questions as Questionnaire;
    return {
      _id: c.r._id, questions: qn, answers: c.r.answers as Answers, step: c.r.step, status: c.r.status, submittedAt: c.r.submittedAt ?? null,
      by: await nameOf(ctx, c.r.submittedBy), updatedBy: await nameOf(ctx, c.r.updatedBy), updatedAt: c.r.updatedAt,
      project: { _id: c.p._id, label: label(c.p) }, business: c.b?.name ?? contact.name, owner: c.b?.ownerName?.trim() || contact.name, me: c.me.name ?? null,
    };
  },
});

/** The answers a page changed since its last save, laid over what's saved (two people answering at once don't
 *  overwrite each other's questions). A cleared answer comes as "" or null. */
function merged(qn: Questionnaire, saved: unknown, changes: unknown): Answers {
  const c = (changes && typeof changes === "object" ? changes : {}) as Record<string, unknown>;
  return cleanAnswers(qn, { ...(saved as Answers), ...c });
}

export const save = mutation({
  args: { briefId: v.string(), changes: v.any(), step: v.number() },
  handler: async (ctx, a) => {
    const c = await clientBrief(ctx, a.briefId);
    if (!c) throw new ConvexError("This brief isn't here any more.");
    // Once it's back, changes wait for Send changes (submit), which checks the required answers and tells the owner.
    if (c.r.status !== "sent") throw new ConvexError("It's been sent back. Open it again to change it.");
    const qn = c.r.questions as Questionnaire;
    const answers = merged(qn, c.r.answers, a.changes);
    const now = Date.now();
    await ctx.db.patch(c.r._id, {
      answers, step: Math.max(0, Math.min(qn.steps.length, Math.floor(a.step) || 0)), updatedAt: now, updatedBy: c.me.email,
      ...(!c.r.startedAt && Object.keys(answers).length ? { startedAt: now, history: [...c.r.history, { at: now, text: `Started by ${c.me.email}` }] } : {}),
    });
    return now;
  },
});

export const submit = mutation({
  args: { briefId: v.string(), changes: v.any() },
  handler: async (ctx, a) => {
    const c = await clientBrief(ctx, a.briefId);
    if (!c) throw new ConvexError("This brief isn't here any more.");
    const qn = c.r.questions as Questionnaire;
    const answers = merged(qn, c.r.answers, a.changes);
    const gaps = missing(qn, answers);
    if (gaps.length) throw new ConvexError(`Answer "${gaps[0].label.replace(/\?$/, "")}" first.`);
    const now = Date.now();
    const changed = c.r.status === "submitted";
    const submits = c.r.submits + 1;
    await ctx.db.patch(c.r._id, {
      answers, status: "submitted", step: qn.steps.length, submits, updatedAt: now, updatedBy: c.me.email,
      ...(changed ? {} : { submittedAt: now, submittedBy: c.me.email }), startedAt: c.r.startedAt ?? now,
      history: [...c.r.history, { at: now, text: `${changed ? "Changed" : "Sent back"} by ${c.me.email}` }],
    });
    // The first time it comes back, the owner hears now. Changes after: one email 10 minutes after the last one, with
    // the answers as they ended up (an earlier run sees a later submit and stands down).
    await ctx.scheduler.runAfter(changed ? QUIET_CHANGES : 0, internal.briefs.mailOwner, { briefId: c.r._id, n: submits });
    return { changed };
  },
});

// ---------- emails ----------

export const mailData = internalQuery({
  args: { briefId: v.id("briefs") },
  handler: async (ctx, { briefId }) => {
    const r = await ctx.db.get(briefId);
    if (!r) return null;
    const p = await ctx.db.get(r.projectId);
    if (!p) return null;
    const biz = await businessOf(ctx, p);
    const qn = r.questions as Questionnaire;
    return {
      r, project: label(p), projectId: p._id, biz, brand: await mailBrandOf(ctx, biz), owner: (await businessContact(ctx, biz)).ownerEmail, covers: coversOf(qn),
      answers: answerList(qn, r.answers as Answers).flatMap((s) => s.answers), by: await nameOf(ctx, r.updatedBy ?? r.submittedBy),
    };
  },
});
export const mail = internalAction({
  args: { briefId: v.id("briefs"), kind: v.union(v.literal("sent"), v.literal("reminder")), emails: v.array(v.string()), at: v.optional(v.number()) },
  handler: async (ctx, { briefId, kind, emails, at }) => {
    const d = await ctx.runQuery(internal.briefs.mailData, { briefId });
    if (!d || (kind === "reminder" && d.r.status !== "sent")) return 0;
    let sent = 0;
    for (const email of emails) {
      const m = briefMail(d.brand, { kind, name: await ctx.runQuery(internal.shoots.nameOf, { email }), project: d.project, covers: d.covers, started: !!d.r.startedAt, link: `${SITE()}/briefs/${briefId}` });
      try {
        if ((await deliverOnce(ctx, `brief-${kind}:${briefId}:${at ?? 0}:${email.toLowerCase()}`, "brief", email, m, d.brand.replyTo, d.biz)) === "sent") sent++;
        if (kind === "sent") await ctx.runMutation(internal.emails.markInboxEmailed, { key: `brief:${briefId}`, email });
      } catch (e) { console.error("brief email", String((e as Error).message).slice(0, 120)); }
    }
    return sent;
  },
});
export const mailOwner = internalAction({
  args: { briefId: v.id("briefs"), n: v.number() },
  handler: async (ctx, { briefId, n }) => {
    const d = await ctx.runQuery(internal.briefs.mailData, { briefId });
    if (!d?.owner || d.r.submits !== n) return;
    await deliverOnce(ctx, `brief-answered:${briefId}:${n}`, "brief_answered", d.owner, ownerBriefMail(d.brand, {
      who: d.by ?? "The client", project: d.project, changed: n > 1, answers: d.answers, link: `${SITE()}/projects/${d.projectId}`,
    }), d.brand.replyTo, d.biz);
  },
});
