// Phase 5c (Nov 3): Site watch. Checks the portal for problems, keeps one row per problem, and lets the scheduled
// site-watch agent (docs/site-watch-agent.md) read them and record what it did.
// D128 (Heston, Nov 3): it finds, fixes on the preview and reports; nothing goes live without Heston's "go"; it runs
// on its own schedule. Alerts wait for the support address (Master Plan § 4b): no email from here yet.
//
// What it may see: counts, function names, email kinds and error text with addresses masked. Never a client's
// records, names or files. Only the portal's admins (ALLOWED_EMAILS) can read it; another business's owner can't.
import { internalMutation, internalQuery, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireMe } from "./lib/access";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { allowedEmails } from "./lib/owners";

const DAY = 24 * 60 * 60 * 1000;
const OPEN = ["found", "fix_ready", "needs_you"] as const;

/** Error text without email addresses or long secrets-looking strings, kept short. */
export function clean(text: string | undefined | null, max = 240) {
  return String(text ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "…@…")
    .replace(/\b(sk|rk|pk|re|whsec|acct|in|pi|cus)_[A-Za-z0-9_]{6,}/g, "$1_…")
    .replace(/[A-Za-z0-9_-]{32,}/g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Money, signing and payouts can't wait for the next look: shown first (and emailed once the support address exists). */
export const isUrgent = (key: string, count: number) => /invoice|stripe|payment|payout|sign|webhook|wsDocuments/i.test(key) || count >= 10;

async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const me = await requireMe(ctx);
  if (!allowedEmails().includes(me.email.toLowerCase())) throw new ConvexError("Not allowed.");
  return me;
}

type Seen = { key: string; area: string; title: string; detail?: string; count: number; hits?: number };

/** One event (an email that didn't send, a job that failed): adds to the problem's count. */
export async function noteEvent(ctx: MutationCtx, s: Omit<Seen, "count">, n = 1) {
  const now = Date.now();
  const r = await ctx.db.query("siteWatchFindings").withIndex("by_key", (q) => q.eq("key", s.key)).unique();
  if (!r) {
    await ctx.db.insert("siteWatchFindings", { key: s.key, area: s.area, title: s.title, ...(s.detail ? { detail: clean(s.detail) } : {}), count: n, ...(s.hits !== undefined ? { hits: s.hits } : {}), firstAt: now, lastAt: now, status: "found", urgent: isUrgent(s.key, n), updatedAt: now });
    return;
  }
  const count = r.status === "cleared" || r.status === "fixed" ? n : r.count + n;
  const status = r.status === "cleared" || r.status === "fixed" ? "found" : r.status; // it came back
  await ctx.db.patch(r._id, { title: s.title, ...(s.detail ? { detail: clean(s.detail) } : {}), count, ...(s.hits !== undefined ? { hits: s.hits } : {}), lastAt: now, status, urgent: isUrgent(s.key, count), updatedAt: now });
}

/** A state check (rows in a failed state now): sets the count, or clears it when nothing is left. */
async function noteState(ctx: MutationCtx, s: Seen): Promise<"found" | "cleared" | null> {
  const now = Date.now();
  const r = await ctx.db.query("siteWatchFindings").withIndex("by_key", (q) => q.eq("key", s.key)).unique();
  if (s.count === 0) {
    if (r && r.status !== "cleared" && r.status !== "fixed") {
      await ctx.db.patch(r._id, { status: r.status === "fix_ready" ? "fixed" : "cleared", count: 0, updatedAt: now });
      return "cleared";
    }
    return null;
  }
  if (!r) {
    await ctx.db.insert("siteWatchFindings", { key: s.key, area: s.area, title: s.title, ...(s.detail ? { detail: clean(s.detail) } : {}), count: s.count, ...(s.hits !== undefined ? { hits: s.hits } : {}), firstAt: now, lastAt: now, status: "found", urgent: isUrgent(s.key, s.count), updatedAt: now });
    return "found";
  }
  const back = r.status === "cleared" || r.status === "fixed";
  await ctx.db.patch(r._id, { title: s.title, ...(s.detail ? { detail: clean(s.detail) } : {}), count: s.count, ...(s.hits !== undefined ? { hits: s.hits } : {}), lastAt: back || s.count !== r.count ? now : r.lastAt, status: back ? "found" : r.status, urgent: isUrgent(s.key, s.count), updatedAt: now });
  return back ? "found" : null;
}

const hitsOf = (rows: { businessId?: unknown }[]) => new Set(rows.map((r) => String(r.businessId ?? "none"))).size;
const firstError = (rows: Record<string, unknown>[], field: string) => clean(rows.map((r) => r[field] as string | undefined).find(Boolean));

/** What the app can see for itself: rows left in a failed state. Each is one check, cleared when it reaches zero. */
async function storedChecks(ctx: MutationCtx): Promise<Seen[]> {
  const out: Seen[] = [];
  const add = (key: string, title: string, rows: Record<string, unknown>[], field?: string) =>
    out.push({ key: `stored:${key}`, area: "stored", title, count: rows.length, hits: hitsOf(rows), ...(field && rows.length ? { detail: firstError(rows, field) } : {}) });
  const versions = await ctx.db.query("versions").collect();
  add("versions.failed", "Video versions that failed to process", versions.filter((x) => x.status === "failed"), "error");
  add("versions.copyError", "Video versions whose Dropbox copy failed", versions.filter((x) => !!x.copyError), "copyError");
  add("transcripts.failed", "Transcripts that failed", (await ctx.db.query("transcripts").collect()).filter((x) => x.status === "failed"), "error");
  add("waveforms.failed", "Waveforms that failed", (await ctx.db.query("waveforms").collect()).filter((x) => x.status === "failed"), "error");
  add("dropbox.lastError", "Dropbox connections with an error (Review)", (await ctx.db.query("dropbox").collect()).filter((x) => !!x.lastError), "lastError");
  add("wsDropbox.lastError", "Dropbox connections with an error (Sign)", (await ctx.db.query("wsDropbox").collect()).filter((x) => !!x.lastError), "lastError");
  add("wsDocuments.finishError", "Signed copies that couldn't be made", (await ctx.db.query("wsDocuments").collect()).filter((x) => !!x.finishError), "finishError");
  add("invoices.sendError", "Invoices that failed to send", (await ctx.db.query("invoices").collect()).filter((x) => !!x.sendError && x.status === "draft"), "sendError");
  add("calendars.lastError", "Google Calendar connections with an error", (await ctx.db.query("calendars").collect()).filter((x) => !!x.lastError), "lastError");
  add("testimonials.saveError", "Testimonials not saved to Dropbox", (await ctx.db.query("testimonials").collect()).filter((x) => !!x.saveError && !x.savedAt), "saveError");
  add("fileUploads.failed", "Client uploads that failed", (await ctx.db.query("fileUploads").collect()).filter((x) => x.status === "failed"));
  return out;
}

/** Scheduled jobs (emails, webhooks' follow-ups, renders) that failed in the last day, grouped by function. */
async function jobChecks(ctx: MutationCtx, now: number): Promise<Seen[]> {
  const failed = new Map<string, { n: number; err?: string }>();
  for (const j of await ctx.db.system.query("_scheduled_functions").collect()) {
    if (j.state.kind !== "failed" || j.scheduledTime < now - DAY) continue;
    const name = String(j.name).replace(/\.js:/, ".").replace(/:/, ".");
    const f = failed.get(name) ?? { n: 0 };
    f.n++;
    f.err ??= (j.state as { error?: string }).error;
    failed.set(name, f);
  }
  return [...failed.entries()].map(([name, f]) => ({ key: `job:${name}`, area: "job", title: `Background job failed: ${name}`, count: f.n, ...(f.err ? { detail: f.err } : {}) }));
}

/** The daily look (cron) and the agent's first step. Writes one run row. */
export const check = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ found: number; cleared: number; open: number }> => {
    const now = Date.now();
    let found = 0, cleared = 0;
    for (const s of await storedChecks(ctx)) { const r = await noteState(ctx, s); if (r === "found") found++; if (r === "cleared") cleared++; }
    // Jobs: a function with no failures in the last day clears.
    const jobs = await jobChecks(ctx, now);
    const seen = new Set(jobs.map((j) => j.key));
    for (const s of jobs) { const r = await noteState(ctx, s); if (r === "found") found++; }
    for (const st of OPEN) {
      for (const r of await ctx.db.query("siteWatchFindings").withIndex("by_status", (q) => q.eq("status", st)).collect()) {
        if (r.area === "job" && !seen.has(r.key)) { if (await noteState(ctx, { key: r.key, area: r.area, title: r.title, count: 0 })) cleared++; }
        // Emails: no new failure in 7 days clears it.
        if (r.area === "email" && r.lastAt < now - 7 * DAY) { await ctx.db.patch(r._id, { status: r.status === "fix_ready" ? "fixed" : "cleared", updatedAt: now }); cleared++; }
      }
    }
    let open = 0;
    for (const st of OPEN) open += (await ctx.db.query("siteWatchFindings").withIndex("by_status", (q) => q.eq("status", st)).collect()).length;
    await ctx.db.insert("siteWatchRuns", { at: now, by: "app", found, cleared });
    // Keep the last 200 runs.
    const old = await ctx.db.query("siteWatchRuns").withIndex("by_at").order("desc").collect();
    for (const r of old.slice(200)) await ctx.db.delete(r._id);
    return { found, cleared, open };
  },
});

/** Called where an email failed to send (emails.unclaim): one more for that kind of email. */
export const emailFailed = internalMutation({
  args: { kind: v.string(), error: v.optional(v.string()) },
  handler: async (ctx, { kind, error }) => {
    const k = kind.replace(/[^a-z0-9_.-]/gi, "").slice(0, 60) || "email";
    await noteEvent(ctx, { key: `email:${k}`, area: "email", title: `Email didn't send: ${k}`, ...(error ? { detail: error } : {}) });
  },
});

// ---------- the portal's admins ----------

const view = (r: Doc<"siteWatchFindings">) => ({
  _id: r._id, key: r.key, area: r.area, title: r.title, detail: r.detail ?? null, count: r.count, hits: r.hits ?? null,
  firstAt: r.firstAt, lastAt: r.lastAt, status: r.status, urgent: !!r.urgent, branch: r.branch ?? null, note: r.note ?? null,
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
    const runs = await ctx.db.query("siteWatchRuns").withIndex("by_at").order("desc").take(10);
    return { open: rows.map(view), recent: recent.map(view), runs: runs.map((r) => ({ at: r.at, by: r.by, found: r.found, cleared: r.cleared, summary: r.summary ?? null })) };
  },
});

/** For the Dashboard row (screen waits for the design chat): how many open, how many urgent. Null for anyone else. */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMe(ctx).catch(() => null);
    if (!me || !allowedEmails().includes(me.email.toLowerCase())) return null;
    let open = 0, urgent = 0;
    for (const st of OPEN) for (const r of await ctx.db.query("siteWatchFindings").withIndex("by_status", (q) => q.eq("status", st)).collect()) { open++; if (r.urgent) urgent++; }
    return { open, urgent };
  },
});

/** The owner dealt with it (or it isn't a problem): out of the open list until it happens again. */
export const markDone = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const fid = ctx.db.normalizeId("siteWatchFindings", id);
    const r = fid ? await ctx.db.get(fid) : null;
    if (!r) return null;
    await ctx.db.patch(r._id, { status: "cleared", updatedAt: Date.now() });
    return null;
  },
});

// ---------- the site-watch agent (runs with the deploy key: `npx convex run siteWatch:agent…`) ----------

const KEY = /^(email|job|stored|tests|page|build):[A-Za-z0-9_.:/-]{1,120}$/;
const BRANCH = /^watch\/[a-z0-9][a-z0-9-]{2,60}$/;

/** What's open, for the agent: no client data in here, only what the report shows. */
export const agentOpen = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows: Doc<"siteWatchFindings">[] = [];
    for (const st of OPEN) rows.push(...(await ctx.db.query("siteWatchFindings").withIndex("by_status", (q) => q.eq("status", st)).collect()));
    return rows.map(view);
  },
});

/** A problem the agent found itself: failing tests or type checks, a page with errors on desktop or phone. */
export const agentFound = internalMutation({
  args: { key: v.string(), title: v.string(), detail: v.optional(v.string()), count: v.optional(v.number()) },
  handler: async (ctx, a) => {
    if (!KEY.test(a.key)) throw new ConvexError("Use a key like tests:footage or page:/projects (phone).");
    await noteState(ctx, { key: a.key, area: a.key.split(":")[0], title: clean(a.title, 140), ...(a.detail ? { detail: a.detail } : {}), count: Math.max(1, Math.min(a.count ?? 1, 10_000)) });
  },
});

/** The agent's own check passed: that problem is cleared (or fixed, if its fix was waiting). */
export const agentClear = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const r = await ctx.db.query("siteWatchFindings").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!r || r.status === "cleared" || r.status === "fixed") return false;
    await ctx.db.patch(r._id, { status: r.status === "fix_ready" ? "fixed" : "cleared", count: 0, updatedAt: Date.now() });
    return true;
  },
});

/**
 * The agent made a fix on a watch/… branch and it's on the preview. D128: never main. The branch name is checked here
 * too, so a report can never say a fix is "on the preview" from main.
 */
export const agentFixReady = internalMutation({
  args: { key: v.string(), branch: v.string(), note: v.string() },
  handler: async (ctx, { key, branch, note }) => {
    if (!BRANCH.test(branch)) throw new ConvexError("Fixes go on a watch/… branch, never main.");
    const r = await ctx.db.query("siteWatchFindings").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!r) throw new ConvexError("No such problem.");
    await ctx.db.patch(r._id, { status: "fix_ready", branch, note: clean(note, 400), updatedAt: Date.now() });
  },
});

/** The agent couldn't fix it safely (money, signing, access, data, or two tries failed): Heston decides. */
export const agentNeedsYou = internalMutation({
  args: { key: v.string(), note: v.string() },
  handler: async (ctx, { key, note }) => {
    const r = await ctx.db.query("siteWatchFindings").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (!r) throw new ConvexError("No such problem.");
    await ctx.db.patch(r._id, { status: "needs_you", note: clean(note, 400), urgent: true, updatedAt: Date.now() });
  },
});

/** One line per agent run, for the report's history. */
export const agentRun = internalMutation({
  args: { found: v.number(), cleared: v.number(), summary: v.string() },
  handler: async (ctx, a) => {
    await ctx.db.insert("siteWatchRuns", { at: Date.now(), by: "agent", found: Math.max(0, a.found), cleared: Math.max(0, a.cleared), summary: clean(a.summary, 600) });
  },
});

// ---------- the agent's door: POST /site-watch (Authorization: Bearer <SITE_WATCH_KEY>) ----------
// Least power (read-back, Nov 3): the agent reads and updates Site watch's own list and nothing else. A Convex deploy
// key would also let it deploy to live, which D128 doesn't allow. SITE_WATCH_KEY is set by Heston in the Convex
// dashboard and in the agent's environment settings, never in chat or the repo. Unset (or under 32 characters) = shut.

async function sha(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function keyOk(given: string | null) {
  const want = process.env.SITE_WATCH_KEY ?? "";
  if (want.length < 32 || !given) return false;
  const [a, b] = [await sha(given), await sha(want)]; // same length either way
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const agentHttp = httpAction(async (ctx, req) => {
  const auth = req.headers.get("authorization") ?? "";
  if (!(await keyOk(auth.startsWith("Bearer ") ? auth.slice(7).trim() : null))) return json({ error: "Not allowed." }, 401);
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return json({ error: "Send JSON." }, 400); }
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  try {
    switch (body.action) {
      case "check": return json(await ctx.runMutation(internal.siteWatch.check, {}));
      case "open": return json(await ctx.runQuery(internal.siteWatch.agentOpen, {}));
      case "found": return json(await ctx.runMutation(internal.siteWatch.agentFound, { key: s("key"), title: s("title"), ...(s("detail") ? { detail: s("detail") } : {}), ...(typeof body.count === "number" ? { count: body.count } : {}) }) ?? null);
      case "clear": return json(await ctx.runMutation(internal.siteWatch.agentClear, { key: s("key") }));
      case "fixReady": return json(await ctx.runMutation(internal.siteWatch.agentFixReady, { key: s("key"), branch: s("branch"), note: s("note") }) ?? null);
      case "needsYou": return json(await ctx.runMutation(internal.siteWatch.agentNeedsYou, { key: s("key"), note: s("note") }) ?? null);
      case "run": return json(await ctx.runMutation(internal.siteWatch.agentRun, { found: Number(body.found) || 0, cleared: Number(body.cleared) || 0, summary: s("summary") }) ?? null);
      default: return json({ error: "Unknown action. Use check, open, found, clear, fixReady, needsYou or run." }, 400);
    }
  } catch (e) {
    return json({ error: clean((e as { data?: string }).data ?? (e as Error).message, 200) }, 400);
  }
});
