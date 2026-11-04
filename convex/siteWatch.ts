// Phase 5c (Nov 3): Site watch. Checks the portal for problems, keeps one row per problem, and lets the scheduled
// site-watch agent (docs/SITE-WATCH.md) read them and record what it did.
// D128 (Heston, Nov 3): it finds, fixes on a watch/… branch and reports; nothing goes live without Heston's "go"; it
// runs on its own schedule. D151 (Nov 4): an urgent problem is emailed once to the portal's support address
// (support@wranglerproductions.com), never to a business; it can email again only after it closes and comes back.
//
// What it keeps: counts, function names, email kinds, and (for jobs and emails) error text with addresses, names in
// "Name <address>", link tokens and keys masked. Records left failed are counted only: their own error text (which
// can carry a client's name) is never copied (review M1). Only the portal's admins (ALLOWED_EMAILS) can read it;
// another business's owner can't. The agent never sees error text from the app's own checks.
//
// Who owns what (review M3): the app owns email:, job: and stored: problems (it finds and clears them); the agent owns
// tests:, page: and build: problems. The agent may only put a fix up for (non-urgent) problems or hand them to Heston.
import { internalAction, internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Doc, TableNames } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireMe } from "./lib/access";
import { allowedEmails } from "./lib/owners";
import { PORTAL_FROM, SITE, SUPPORT, sendEmail } from "./lib/email";

const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 30; // Q47 (Heston, Nov 3): each run's list is kept 30 days, then cleared
const OPEN = ["found", "fix_ready", "needs_you"] as const;
const APP_AREAS = ["email", "job", "stored"];

/** Mask first, then cut (review L4): addresses (plain, %40 and "Name <address>"), keys and link tokens. */
export function clean(text: string | undefined | null, max = 240) {
  return String(text ?? "")
    .replace(/"?[A-Za-z][^"<>@,;:\n]{0,60}"?\s*<[^<>\s]+@[^<>\s]+>/g, "…@…")
    .replace(/[A-Z0-9._%+-]+(?:@|%40)[A-Z0-9.-]+\.[A-Z]{2,}/gi, "…@…")
    .replace(/\b(sk|rk|pk|re|whsec|acct|in|pi|cus|sub|ch|py|po|tok)_[A-Za-z0-9_]{6,}/g, "$1_…")
    // Link tokens are 22–24 characters (randomToken): any 16+ run with a digit, - or _, or mixed case.
    .replace(/[A-Za-z0-9_-]{16,}/g, (m) => (/[0-9_-]/.test(m) || (/[a-z]/.test(m) && /[A-Z]/.test(m)) ? "…" : m))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Money and signing can't wait for the next look: shown first, and emailed to the support address (D151). */
export const isUrgent = (key: string, count: number) =>
  /invoice|stripe|payment|payout|subscription|renew|webhook|wsDocuments|signDone|signing|to_sign|signed|paid|receipt|refund|overdue|past_due|uncollectible/i.test(key) || count >= 10;

async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const me = await requireMe(ctx);
  if (!allowedEmails().includes(me.email.toLowerCase())) throw new ConvexError("Not allowed.");
  return me;
}

type Seen = { key: string; area: string; title: string; detail?: string; count: number; hits?: number; lastAt?: number };
const urgentFor = (r: Doc<"siteWatchFindings"> | null, key: string, count: number) => r?.status === "needs_you" || isUrgent(key, count); // review L2

/** One event (an email that didn't send): adds to the count. A new one after "done" opens it again. */
export async function noteEvent(ctx: MutationCtx, s: Omit<Seen, "count">) {
  await noteEventRow(ctx, s);
  await syncAlert(ctx, s.key);
}
async function noteEventRow(ctx: MutationCtx, s: Omit<Seen, "count">) {
  const now = Date.now();
  const r = await ctx.db.query("siteWatchFindings").withIndex("by_key", (q) => q.eq("key", s.key)).unique();
  const detail = s.detail ? { detail: clean(s.detail) } : {};
  if (!r) {
    await ctx.db.insert("siteWatchFindings", { key: s.key, area: s.area, title: s.title, ...detail, count: 1, firstAt: now, lastAt: now, status: "found", urgent: isUrgent(s.key, 1), updatedAt: now });
    return;
  }
  const back = r.status === "cleared" || r.status === "fixed";
  const count = back ? 1 : r.count + 1;
  await ctx.db.patch(r._id, { title: s.title, ...detail, count, lastAt: now, status: back ? "found" : r.status, urgent: urgentFor(r, s.key, count), doneAt: undefined, doneCount: undefined, quietAt: undefined, ...(back ? { alertedAt: undefined } : {}), updatedAt: now });
}

/**
 * A state (rows failed now, or jobs failed in the last day): sets the count. Zero closes it, except a fix waiting
 * for Heston, which stays open as "quiet" until he marks it done (review M3). After "done", it opens again only
 * when it gets worse or fails again later (review L1).
 */
async function noteState(ctx: MutationCtx, s: Seen): Promise<"found" | "cleared" | null> {
  const out = await noteStateRow(ctx, s);
  await syncAlert(ctx, s.key);
  return out;
}
async function noteStateRow(ctx: MutationCtx, s: Seen): Promise<"found" | "cleared" | null> {
  const now = Date.now();
  const r = await ctx.db.query("siteWatchFindings").withIndex("by_key", (q) => q.eq("key", s.key)).unique();
  const detail = s.detail ? { detail: clean(s.detail) } : {};
  const hits = s.hits !== undefined ? { hits: s.count ? s.hits : 0 } : {};
  if (s.count === 0) {
    if (!r) return null;
    if (r.status === "fix_ready") { if (!r.quietAt) await ctx.db.patch(r._id, { count: 0, ...hits, quietAt: now, updatedAt: now }); return null; }
    if (r.status === "found" || r.status === "needs_you") { await ctx.db.patch(r._id, { status: "cleared", count: 0, ...hits, doneAt: undefined, doneCount: undefined, updatedAt: now }); return "cleared"; }
    if (r.doneAt || r.count) await ctx.db.patch(r._id, { count: 0, ...hits, doneAt: undefined, doneCount: undefined, updatedAt: now }); // truly gone: forget "done"
    return null;
  }
  if (!r) {
    await ctx.db.insert("siteWatchFindings", { key: s.key, area: s.area, title: s.title, ...detail, count: s.count, ...hits, firstAt: now, lastAt: s.lastAt ?? now, status: "found", urgent: isUrgent(s.key, s.count), updatedAt: now });
    return "found";
  }
  const closed = r.status === "cleared" || r.status === "fixed";
  const worse = !r.doneAt || s.count > (r.doneCount ?? 0) || (s.lastAt !== undefined && s.lastAt > r.doneAt);
  const back = closed && worse;
  if (closed && !back) { await ctx.db.patch(r._id, { count: s.count, ...hits, updatedAt: now }); return null; }
  await ctx.db.patch(r._id, {
    title: s.title, ...detail, count: s.count, ...hits, lastAt: s.lastAt ?? (back || s.count !== r.count ? now : r.lastAt),
    status: back ? "found" : r.status, urgent: urgentFor(back ? null : r, s.key, s.count), quietAt: undefined,
    ...(back ? { doneAt: undefined, doneCount: undefined, alertedAt: undefined } : {}), updatedAt: now,
  });
  return back ? "found" : null;
}

// ---------- the urgent email (D151) ----------

/**
 * After every write: an open, urgent problem not yet emailed gets one email to the portal's support address. A closed
 * one forgets it was emailed, so if it comes back it's emailed again. Never to a business, never with client data
 * (titles are the app's own; detail and note are already masked by clean()).
 */
async function syncAlert(ctx: MutationCtx, key: string) {
  const r = await ctx.db.query("siteWatchFindings").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (!r) return;
  if (!(OPEN as readonly string[]).includes(r.status)) { if (r.alertedAt) await ctx.db.patch(r._id, { alertedAt: undefined }); return; }
  if (!r.urgent || r.alertedAt) return;
  const at = Date.now();
  await ctx.db.patch(r._id, { alertedAt: at });
  await ctx.scheduler.runAfter(0, internal.siteWatch.urgentMail, { findingId: r._id, at });
}

export const urgentData = internalQuery({
  args: { findingId: v.id("siteWatchFindings"), at: v.number() },
  handler: async (ctx, { findingId, at }) => {
    const r = await ctx.db.get(findingId);
    if (!r || r.alertedAt !== at || !r.urgent) return null; // closed (or re-sent) in the meantime
    return { key: r.key, area: r.area, title: r.title, detail: r.detail ?? null, note: r.note ?? null, count: r.count, hits: r.hits ?? null, status: r.status, firstAt: r.firstAt };
  },
});

/** The email didn't go: forget it was sent, so the next look (or write) tries again. */
export const alertFailed = internalMutation({
  args: { findingId: v.id("siteWatchFindings"), at: v.number() },
  handler: async (ctx, { findingId, at }) => {
    const r = await ctx.db.get(findingId);
    if (r && r.alertedAt === at) await ctx.db.patch(r._id, { alertedAt: undefined });
  },
});

export function urgentMailText(d: { title: string; area: string; detail: string | null; note: string | null; count: number; hits: number | null; status: string }) {
  const lines = [
    `Site watch found an urgent problem on Wrangler Portal.`,
    ``,
    d.title,
    `Area: ${d.area} · ${d.count === 1 ? "seen once" : `count ${d.count}`}${d.hits ? ` · ${d.hits} ${d.hits === 1 ? "business" : "businesses"} affected` : ""}`,
    ...(d.detail ? [`Detail: ${d.detail}`] : []),
    ...(d.status === "needs_you" && d.note ? [`The site-watch agent: ${d.note}`] : []),
    ``,
    `Money and signing problems aren't fixed on their own: they wait for you. Open the portal: ${SITE()}`,
    ``,
    `You get one email per problem. Another comes only if it's closed and then happens again.`,
  ];
  return { subject: `Site watch: urgent · ${d.title}`.slice(0, 140), text: lines.join("\n") };
}

export const urgentMail = internalAction({
  args: { findingId: v.id("siteWatchFindings"), at: v.number() },
  handler: async (ctx, { findingId, at }): Promise<"sent" | "held" | "gone" | "already"> => {
    const d = await ctx.runQuery(internal.siteWatch.urgentData, { findingId, at });
    if (!d) return "gone";
    const to = SUPPORT();
    const key = `site-watch-urgent:${findingId}:${at}`;
    if (!(await ctx.runMutation(internal.emails.claim, { key, kind: "site_watch_urgent", to }))) return "already";
    const m = urgentMailText(d);
    try {
      const id = await sendEmail({ from: PORTAL_FROM(), to, subject: m.subject, text: m.text, tag: "site_watch_urgent", replyTo: null });
      await ctx.runMutation(internal.emails.sent, { key, resendId: id || "sent" });
      return id === "held" ? "held" : "sent";
    } catch (e) {
      await ctx.runMutation(internal.siteWatch.alertFailed, { findingId, at });
      await ctx.runMutation(internal.emails.unclaim, { key, error: String((e as Error)?.message ?? e).slice(0, 2000) });
      return "gone";
    }
  },
});

// ---------- the app's own look (paged, so it can't outgrow Convex's read limits: review M2) ----------

type Check = { table: TableNames; title: string; bad: (d: Record<string, unknown>) => boolean; page?: number };
const CHECKS: Record<string, Check> = {
  "versions.failed": { table: "versions", title: "Video versions that failed to process", bad: (d) => d.status === "failed" },
  "versions.copyError": { table: "versions", title: "Video versions whose Dropbox copy failed", bad: (d) => !!d.copyError },
  "transcripts.failed": { table: "transcripts", title: "Transcripts that failed", bad: (d) => d.status === "failed" },
  "waveforms.failed": { table: "waveforms", title: "Waveforms that failed", bad: (d) => d.status === "failed", page: 25 }, // rows carry peaks
  "dropbox.lastError": { table: "dropbox", title: "Dropbox connections with an error (Review)", bad: (d) => !!d.lastError },
  "wsDropbox.lastError": { table: "wsDropbox", title: "Dropbox connections with an error (Sign)", bad: (d) => !!d.lastError },
  "wsDocuments.finishError": { table: "wsDocuments", title: "Signed copies that couldn't be made", bad: (d) => !!d.finishError },
  "wsDocuments.invoiceFailed": { table: "wsDocuments", title: "Signed contracts whose Stripe invoice draft failed", bad: (d) => (d.invoice as { status?: string } | undefined)?.status === "failed" },
  "wsDocuments.copiesFailed": { table: "wsDocuments", title: "Signed contracts whose copies didn't all send", bad: (d) => { const s = (d.copies as { status?: string } | undefined)?.status; return s === "failed" || s === "partial"; } },
  "wsDocuments.archiveFailed": { table: "wsDocuments", title: "Signed contracts not archived to Dropbox", bad: (d) => (d.archive as { status?: string } | undefined)?.status === "failed" },
  "invoices.sendError": { table: "invoices", title: "Invoices that failed to send", bad: (d) => !!d.sendError && d.status === "draft" },
  "calendars.lastError": { table: "calendars", title: "Google Calendar connections with an error", bad: (d) => !!d.lastError },
  "testimonials.saveError": { table: "testimonials", title: "Testimonials not saved to Dropbox", bad: (d) => !!d.saveError && !d.savedAt },
  "fileUploads.failed": { table: "fileUploads", title: "Client uploads that failed", bad: (d) => d.status === "failed" },
};

/** One page of one check: how many rows are failed, and which businesses (as opaque ids, never shown). */
export const scan = internalQuery({
  args: { check: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { check, cursor }) => {
    const c = CHECKS[check];
    if (!c) throw new Error(`unknown check ${check}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await (ctx.db.query(c.table) as any).paginate({ cursor, numItems: c.page ?? 200 });
    const bad = (page.page as Record<string, unknown>[]).filter(c.bad);
    return { count: bad.length, biz: [...new Set(bad.map((d) => String(d.businessId ?? "none")))], cursor: page.continueCursor as string, done: page.isDone as boolean };
  },
});

/** Scheduled jobs that failed in the last day, grouped by function (only the last two days of jobs are read). */
export const failedJobs = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const failed = new Map<string, { n: number; err?: string; last: number }>();
    const recent = await ctx.db.system.query("_scheduled_functions").withIndex("by_creation_time", (q) => q.gt("_creationTime", now - 2 * DAY)).collect();
    for (const j of recent) {
      if (j.state.kind !== "failed" || j.scheduledTime < now - DAY) continue;
      const name = String(j.name).replace(/\.js:/, ".").replace(/:/, ".").slice(0, 100);
      const f = failed.get(name) ?? { n: 0, last: 0 };
      f.n++;
      f.last = Math.max(f.last, j.completedTime ?? j.scheduledTime);
      f.err ??= (j.state as { error?: string }).error;
      failed.set(name, f);
    }
    return [...failed.entries()].map(([name, f]) => ({ name, n: f.n, last: f.last, ...(f.err ? { err: clean(f.err) } : {}) }));
  },
});

const seenV = v.object({ key: v.string(), area: v.string(), title: v.string(), detail: v.optional(v.string()), count: v.number(), hits: v.optional(v.number()), lastAt: v.optional(v.number()) });

/** Writes one look's results: the stored checks, the jobs, quiet emails, one run row. */
export const apply = internalMutation({
  args: { stored: v.array(seenV), jobs: v.array(seenV) },
  handler: async (ctx, { stored, jobs }): Promise<{ found: number; cleared: number; open: number }> => {
    const now = Date.now();
    let found = 0, cleared = 0;
    const tally = (r: "found" | "cleared" | null) => { if (r === "found") found++; if (r === "cleared") cleared++; };
    for (const s of stored) tally(await noteState(ctx, s));
    for (const s of jobs) tally(await noteState(ctx, s));
    const seen = new Set(jobs.map((j) => j.key));
    for (const st of OPEN) {
      for (const r of await ctx.db.query("siteWatchFindings").withIndex("by_status", (q) => q.eq("status", st)).collect()) {
        if (r.area === "job" && !seen.has(r.key)) tally(await noteState(ctx, { key: r.key, area: r.area, title: r.title, count: 0 }));
        // Emails: no new failure in 7 days closes it (a fix waiting for Heston stays).
        if (r.area === "email" && r.status !== "fix_ready" && r.lastAt < now - 7 * DAY) { await ctx.db.patch(r._id, { status: "cleared", updatedAt: now }); await syncAlert(ctx, r.key); cleared++; }
      }
    }
    // The look worked: a "check failed" problem from an earlier day closes.
    tally(await noteState(ctx, { key: "job:siteWatch.check", area: "job", title: "Site watch's own daily look failed", count: 0 }));
    const snap = await snapshot(ctx);
    await ctx.db.insert("siteWatchRuns", { at: now, by: "app", found, cleared, open: snap });
    await prune(ctx, now);
    return { found, cleared, open: snap.length };
  },
});

/** What's open right now, for a run's row (Q47). */
async function snapshot(ctx: MutationCtx) {
  const rows: Doc<"siteWatchFindings">[] = [];
  for (const st of OPEN) rows.push(...(await ctx.db.query("siteWatchFindings").withIndex("by_status", (q) => q.eq("status", st)).collect()));
  rows.sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || b.lastAt - a.lastAt);
  return rows.slice(0, 100).map((r) => ({ key: r.key, area: r.area, title: r.title, status: r.status, urgent: !!r.urgent, count: r.count }));
}

/** Runs older than 30 days are cleared (Q47); never more than 500 kept. */
async function prune(ctx: MutationCtx, now: number) {
  for (const r of await ctx.db.query("siteWatchRuns").withIndex("by_at", (q) => q.lt("at", now - KEEP_DAYS * DAY)).take(200)) await ctx.db.delete(r._id);
  for (const r of (await ctx.db.query("siteWatchRuns").withIndex("by_at").order("desc").take(560)).slice(500)) await ctx.db.delete(r._id);
}

/** The look itself failed: that's a problem too (review M2), so a broken watcher is never silent. */
export const checkFailed = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await noteState(ctx, { key: "job:siteWatch.check", area: "job", title: "Site watch's own daily look failed", detail: error, count: 1, lastAt: Date.now() });
  },
});

/** The "Run the checks" switch (Settings › Site watch). */
export const isPaused = internalQuery({
  args: {},
  handler: async (ctx) => !!(await ctx.db.query("siteWatchSettings").first())?.paused,
});

/** The daily look (cron, 8 am Central) and the agent's first step. Off (paused) it does nothing. */
export const check = internalAction({
  args: {},
  handler: async (ctx): Promise<{ found: number; cleared: number; open: number } | { failed: true } | { paused: true }> => {
    if (await ctx.runQuery(internal.siteWatch.isPaused, {})) return { paused: true };
    try {
      const stored: Seen[] = [];
      for (const [key, c] of Object.entries(CHECKS)) {
        let cursor: string | null = null, count = 0, done = false;
        const biz = new Set<string>();
        for (let i = 0; !done && i < 1000; i++) {
          const p: { count: number; biz: string[]; cursor: string; done: boolean } = await ctx.runQuery(internal.siteWatch.scan, { check: key, cursor });
          count += p.count; p.biz.forEach((b) => biz.add(b)); cursor = p.cursor; done = p.done;
        }
        stored.push({ key: `stored:${key}`, area: "stored", title: c.title, count, hits: biz.size });
      }
      const jobs = (await ctx.runQuery(internal.siteWatch.failedJobs, {})).map((j: { name: string; n: number; last: number; err?: string }) =>
        ({ key: `job:${j.name}`, area: "job", title: `Background job failed: ${j.name}`, count: j.n, lastAt: j.last, ...(j.err ? { detail: j.err } : {}) }));
      return await ctx.runMutation(internal.siteWatch.apply, { stored, jobs });
    } catch (e) {
      await ctx.runMutation(internal.siteWatch.checkFailed, { error: String((e as Error)?.message ?? e).slice(0, 2000) });
      return { failed: true };
    }
  },
});

/** An email that didn't send (scheduled by emails.unclaim, so a problem here never blocks the retry: review L3). */
export const emailFailed = internalMutation({
  args: { kind: v.string(), error: v.optional(v.string()) },
  handler: async (ctx, { kind, error }) => {
    const k = kind.replace(/[^a-z0-9_.-]/gi, "").slice(0, 60) || "email";
    await noteEvent(ctx, { key: `email:${k}`, area: "email", title: `Email didn't send: ${k}`, ...(error ? { detail: error } : {}) });
  },
});

// ---------- the portal's admins ----------

const view = (r: Doc<"siteWatchFindings">, withDetail = true) => ({
  _id: r._id, key: r.key, area: r.area, title: r.title, detail: withDetail ? r.detail ?? null : null, count: r.count, hits: r.hits ?? null,
  firstAt: r.firstAt, lastAt: r.lastAt, status: r.status, urgent: !!r.urgent, branch: r.branch ?? null, commit: r.commit ?? null,
  note: r.note ?? null, quiet: !!r.quietAt, quietAt: r.quietAt ?? null, fixedAt: r.status === "fixed" || r.status === "cleared" ? r.doneAt ?? r.updatedAt : null,
});

/** Settings › Site watch (screen waits for the design chat): open problems first, urgent first, then the last runs. */
export const report = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows: Doc<"siteWatchFindings">[] = [];
    for (const st of OPEN) rows.push(...(await ctx.db.query("siteWatchFindings").withIndex("by_status", (q) => q.eq("status", st)).collect()));
    rows.sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || b.lastAt - a.lastAt);
    const recent = (await ctx.db.query("siteWatchFindings").order("desc").take(50)).filter((r) => r.status === "fixed" || r.status === "cleared");
    const runs = await ctx.db.query("siteWatchRuns").withIndex("by_at", (q) => q.gte("at", Date.now() - KEEP_DAYS * DAY)).order("desc").take(60);
    const paused = !!(await ctx.db.query("siteWatchSettings").first())?.paused;
    return { paused, support: SUPPORT(), open: rows.map((r) => view(r)), recent: recent.map((r) => view(r)), runs: runs.map((r) => ({ _id: r._id, at: r.at, by: r.by, found: r.found, cleared: r.cleared, summary: r.summary ?? null, open: r.open?.length ?? null })) };
  },
});

/** One problem's page. Error text only for the agent's own problems (tests, pages, builds), never the app's (review M1). */
export const finding = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const fid = ctx.db.normalizeId("siteWatchFindings", id);
    const r = fid ? await ctx.db.get(fid) : null;
    return r ? view(r, !APP_AREAS.includes(r.area)) : null;
  },
});

/** "Run the checks" on or off. */
export const setPaused = mutation({
  args: { paused: v.boolean() },
  handler: async (ctx, { paused }) => {
    await requireAdmin(ctx);
    const row = await ctx.db.query("siteWatchSettings").first();
    if (row) await ctx.db.patch(row._id, { paused, updatedAt: Date.now() });
    else await ctx.db.insert("siteWatchSettings", { paused, updatedAt: Date.now() });
    return null;
  },
});

/** A history row: what was open at that run (Q47). Gone after 30 days. */
export const run = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const rid = ctx.db.normalizeId("siteWatchRuns", id);
    const r = rid ? await ctx.db.get(rid) : null;
    if (!r || r.at < Date.now() - KEEP_DAYS * DAY) return null;
    return { at: r.at, by: r.by, found: r.found, cleared: r.cleared, summary: r.summary ?? null, open: r.open ?? [] };
  },
});

/** For the Dashboard row (screen waits for the design chat): how many open, how many urgent. Null for anyone else. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMe(ctx).catch(() => null);
    if (!me || !allowedEmails().includes(me.email.toLowerCase())) return null;
    let open = 0, urgent = 0, fixReady = 0;
    for (const st of OPEN) for (const r of await ctx.db.query("siteWatchFindings").withIndex("by_status", (q) => q.eq("status", st)).collect()) { open++; if (r.urgent || r.status === "needs_you") urgent++; else if (r.status === "fix_ready") fixReady++; }
    const last = await ctx.db.query("siteWatchRuns").withIndex("by_at").order("desc").first();
    return { open, urgent, fixReady, checkedAt: last?.at ?? null }; // Q45 (Heston, Nov 3): the Dashboard hides the row when open is 0
  },
});

/** Heston dealt with it (a fix he merged, or not a problem): closed until it gets worse or happens again (review L1). */
export const markDone = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const fid = ctx.db.normalizeId("siteWatchFindings", id);
    const r = fid ? await ctx.db.get(fid) : null;
    if (!r) return null;
    const now = Date.now();
    await ctx.db.patch(r._id, { status: r.status === "fix_ready" ? "fixed" : "cleared", doneAt: now, doneCount: r.count, quietAt: undefined, updatedAt: now });
    await syncAlert(ctx, r.key);
    return null;
  },
});

// ---------- the site-watch agent (only through POST /site-watch, below) ----------

const KEY = /^(email|job|stored|tests|page|build):[A-Za-z0-9_.:/-]{1,120}$/;
const AGENT_KEY = /^(tests|page|build):[A-Za-z0-9_.:/-]{1,120}$/;
const BRANCH = /^watch\/[a-z0-9][a-z0-9-]{0,60}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

/** What's open, for the agent. Error text only for its own problems (tests, pages, builds), never the app's (M1). */
export const agentOpen = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows: Doc<"siteWatchFindings">[] = [];
    for (const st of OPEN) rows.push(...(await ctx.db.query("siteWatchFindings").withIndex("by_status", (q) => q.eq("status", st)).collect()));
    return rows.map((r) => view(r, !APP_AREAS.includes(r.area)));
  },
});

/** A problem the agent found itself: failing tests or type checks, a page with errors on desktop or phone. */
export const agentFound = internalMutation({
  args: { key: v.string(), title: v.string(), detail: v.optional(v.string()), count: v.optional(v.number()) },
  handler: async (ctx, a) => {
    if (!AGENT_KEY.test(a.key)) throw new ConvexError("The agent records only tests:, page: and build: problems (e.g. tests:footage, page:/projects:phone).");
    await noteState(ctx, { key: a.key, area: a.key.split(":")[0], title: clean(a.title, 140), ...(a.detail ? { detail: a.detail } : {}), count: Math.max(1, Math.min(Math.floor(a.count ?? 1), 10_000)), lastAt: Date.now() });
    return null;
  },
});

/** The agent's own check passes again on main: its problem closes (a fix it put up counts as fixed: main has it). */
export const agentClear = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    if (!AGENT_KEY.test(key)) throw new ConvexError("The app's own problems (email, job, stored) close themselves, or Heston marks them done.");
    const r = await ctx.db.query("siteWatchFindings").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!r || r.status === "cleared" || r.status === "fixed") return false;
    await ctx.db.patch(r._id, { status: r.status === "fix_ready" ? "fixed" : "cleared", count: 0, quietAt: undefined, updatedAt: Date.now() });
    await syncAlert(ctx, key);
    return true;
  },
});

/**
 * The agent pushed a fix to a watch/… branch at this commit. D128: never main. Heston's "go" refers to that exact commit
 * (review H1). Money, signing and anything urgent can't be fixed on its own: those go to Heston (review M3).
 */
export const agentFixReady = internalMutation({
  args: { key: v.string(), branch: v.string(), commit: v.string(), note: v.string() },
  handler: async (ctx, { key, branch, commit, note }) => {
    if (!BRANCH.test(branch)) throw new ConvexError("Fixes go on a branch named watch/<short-name> (lower case, digits and dashes), never main.");
    if (!COMMIT.test(commit)) throw new ConvexError("Give the fix's commit (its hash).");
    const r = await ctx.db.query("siteWatchFindings").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!r) throw new ConvexError("No such problem.");
    if (r.urgent || isUrgent(key, r.count) || r.status === "needs_you") throw new ConvexError("This one is Heston's (money, signing or urgent): use needsYou.");
    await ctx.db.patch(r._id, { status: "fix_ready", branch, commit, note: clean(note, 400), quietAt: undefined, updatedAt: Date.now() });
    return null;
  },
});

/** The agent can't fix it safely (money, signing, access, data, or two tries failed): Heston decides. */
export const agentNeedsYou = internalMutation({
  args: { key: v.string(), note: v.string() },
  handler: async (ctx, { key, note }) => {
    if (!KEY.test(key)) throw new ConvexError("No such problem.");
    const r = await ctx.db.query("siteWatchFindings").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!r) throw new ConvexError("No such problem.");
    await ctx.db.patch(r._id, { status: "needs_you", note: clean(note, 400), urgent: true, updatedAt: Date.now() });
    await syncAlert(ctx, key);
    return null;
  },
});

/** One line per agent run, for the report's history. */
export const agentRun = internalMutation({
  args: { found: v.number(), cleared: v.number(), summary: v.string() },
  handler: async (ctx, a) => {
    const now = Date.now();
    await ctx.db.insert("siteWatchRuns", { at: now, by: "agent", found: Math.max(0, Math.floor(a.found) || 0), cleared: Math.max(0, Math.floor(a.cleared) || 0), summary: clean(a.summary, 600), open: await snapshot(ctx) });
    await prune(ctx, now);
    return null;
  },
});

// ---------- the agent's door: POST /site-watch (Authorization: Bearer <SITE_WATCH_KEY>) ----------
// Least power: the agent reads and updates Site watch's own list and nothing else. A Convex deploy key would also
// let it deploy to live, which D128 doesn't allow. SITE_WATCH_KEY is set by Heston in the Convex dashboard and in the
// agent's environment settings, never in chat or the repo. Unset (or under 32 characters) = shut.

async function sha(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function keyOk(given: string | null) {
  const want = (process.env.SITE_WATCH_KEY ?? "").trim(); // review L6: a pasted newline doesn't lock it silently
  if (want.length < 32 || !given) return false;
  const [a, b] = [await sha(given.trim()), await sha(want)]; // same length either way
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const agentHttp = httpAction(async (ctx, req) => {
  const auth = req.headers.get("authorization") ?? "";
  if (!(await keyOk(auth.startsWith("Bearer ") ? auth.slice(7) : null))) return json({ error: "Not allowed." }, 401);
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return json({ error: "Send JSON." }, 400); }
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  try {
    switch (body.action) {
      case "check": return json(await ctx.runAction(internal.siteWatch.check, {}));
      case "open": return json(await ctx.runQuery(internal.siteWatch.agentOpen, {}));
      case "found": return json(await ctx.runMutation(internal.siteWatch.agentFound, { key: s("key"), title: s("title"), ...(s("detail") ? { detail: s("detail") } : {}), ...(typeof body.count === "number" ? { count: body.count } : {}) }));
      case "clear": return json(await ctx.runMutation(internal.siteWatch.agentClear, { key: s("key") }));
      case "fixReady": return json(await ctx.runMutation(internal.siteWatch.agentFixReady, { key: s("key"), branch: s("branch"), commit: s("commit"), note: s("note") }));
      case "needsYou": return json(await ctx.runMutation(internal.siteWatch.agentNeedsYou, { key: s("key"), note: s("note") }));
      case "run": return json(await ctx.runMutation(internal.siteWatch.agentRun, { found: Number(body.found) || 0, cleared: Number(body.cleared) || 0, summary: s("summary") }));
      default: return json({ error: "Unknown action. Use check, open, found, clear, fixReady, needsYou or run." }, 400);
    }
  } catch (e) {
    return json({ error: clean((e as { data?: string }).data ?? (e as Error).message, 200) }, 400);
  }
});
