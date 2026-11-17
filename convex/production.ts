// Phase 5b step 1 (Nov 3): Production › Overview and Shoots (approved frames 760:637, 763:519, 763:1067, 763:1713,
// 763:2708; phone 769:6647, 771:8608, 771:8851). Live shoots and edits at a glance. Call sheets (step 3) and the synced
// calendar (step 5) join this page as they're built. The owner's own business only (the business guard).
import { query } from "./lib/functions";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { projectClosed } from "./lib/guests";
import { requireMe, requireAll } from "./lib/access";
import { todayCentral } from "./lib/bookings";
import { label } from "./lib/bookingRows";
import { roundsFor } from "./lib/rounds";
import { addDays } from "./footage";

type Shoot = Doc<"shoots">;

/** `withShots`: include each shoot's shot list counts (only for a caller with Shoots and call sheets; review L7). */
/** Nov 16 (review L7): the shoots switch, as requireAll(ctx, "shoots") would decide it. */
const canShots = (me: { team?: { role: string; perms: { shoots?: boolean } } }) => !me.team || (!!me.team.perms.shoots && me.team.role !== "editor");
export async function shootRows(ctx: QueryCtx, shoots: Shoot[], withShots = false) {
  const projects = new Map<string, Doc<"projects"> | null>();
  const clients = new Map<string, string | null>();
  const out = [];
  for (const s of shoots) {
    const pk = String(s.projectId ?? "");
    if (!projects.has(pk)) projects.set(pk, s.projectId ? await ctx.db.get(s.projectId) : null);
    const p = projects.get(pk) ?? null;
    if (s.projectId && !p) continue; // its project is gone
    // D205: a shoot on its own has no project or client ("On its own").
    const ck = String(p?.clientId ?? "");
    if (!clients.has(ck)) clients.set(ck, p?.clientId ? (await ctx.db.get(p.clientId))?.name ?? null : null);
    // Phase 5b step 3: its call sheet, if it has one (NO CALL SHEET · DRAFT · SENT · N OF M OPENED).
    const cs = await ctx.db.query("callSheets").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).first();
    const sentTo = cs ? cs.recipients.filter((r) => r.sentAt) : []; // step 4: guests it went to count too
    // Nov 16: its shot list (D179: one per shoot day), with how many shots are done.
    const sl = !withShots ? null : await ctx.db.query("shotLists").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).first();
    const shots = sl ? await ctx.db.query("shots").withIndex("by_list", (q) => q.eq("listId", sl._id)).collect() : [];
    out.push({
      _id: s._id, projectId: p?._id ?? null, project: p?.name ?? "On its own", label: p ? label(p) : "Shoot on its own", client: clients.get(ck) ?? null,
      shotList: sl ? { _id: sl._id, total: shots.length, done: shots.filter((x) => x.done).length } : null,
      date: s.date, call: s.call, location: s.location, crew: s.crew.length, confirmed: !!s.confirmed, moved: !!s.moved,
      sheet: cs ? { _id: cs._id, state: cs.status === "sent" ? "sent" as const : "draft" as const, built: !!cs.buildId, opened: sentTo.filter((r) => r.openedAt).length, of: sentTo.length, people: cs.recipients.filter((r) => r.on).length } : null,
    });
  }
  return out;
}

export const scheduled = async (ctx: QueryCtx) => (await ctx.db.query("shoots").withIndex("by_date").collect()).filter((s) => s.status === "scheduled");

/** Projects in Production or Polish: the latest round and what's next. */
export async function liveEdits(ctx: QueryCtx, today: string) {
  const out = [];
  for (const p of await ctx.db.query("projects").collect()) {
    if (p.stage !== "production" && p.stage !== "polish") continue;
    let round = 0;
    for (const vid of await ctx.db.query("videos").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()) {
      const last = (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", vid._id)).collect()).reduce((m, x) => Math.max(m, x.number), 0);
      round = Math.max(round, last);
    }
    const r = await roundsFor(ctx, p);
    const next = (p.keyDates ?? []).filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    out.push({ _id: p._id, label: label(p), stage: p.stage, round: r.off || !round ? null : round, nextStep: p.nextStep ?? null, next, updatedAt: p.updatedAt ?? p.createdAt });
  }
  // Soonest date first, then the most recently touched.
  return out.sort((a, b) => (a.next?.date ?? "9999").localeCompare(b.next?.date ?? "9999") || b.updatedAt - a.updatedAt);
}

/** Production › Overview. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "production");
    const today = todayCentral();
    const weekEnd = addDays(today, 6);
    const upcoming = (await scheduled(ctx)).filter((s) => s.date >= today);
    const todays = upcoming.filter((s) => s.date === today);
    const week = upcoming.filter((s) => s.date <= weekEnd);
    const edits = await liveEdits(ctx, today);
    // This week: shoots and the projects' key dates, in date order.
    const rows = await shootRows(ctx, week);
    const items: Array<{ date: string; text: string; projectId: string | null; kind: "shoot" | "date" }> = rows.map((s) => ({ date: s.date, text: `${s.client ?? s.project} shoot`, projectId: s.projectId, kind: "shoot" as const }));
    for (const p of await ctx.db.query("projects").collect()) {
      for (const d of p.keyDates ?? []) if (d.date >= today && d.date <= weekEnd && !/^shoot$/i.test(d.label.trim())) items.push({ date: d.date, text: `${p.name} · ${d.label}`, projectId: p._id, kind: "date" });
    }
    items.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "shoot" ? -1 : 1));
    const cal = await ctx.db.query("calendars").first();
    // Phase 5b step 3: the Call sheets tile and card.
    const sheets = await ctx.db.query("callSheets").collect();
    const withSheet = new Set(sheets.map((c) => String(c.shootId)));
    const sentWeek = sheets.filter((c) => c.sentAt && c.sentAt >= Date.now() - 7 * 86_400_000).length;
    const templates = (await ctx.db.query("wsTemplates").collect()).filter((t) => t.kind === "callsheet").length;
    return {
      today,
      tiles: { today: todays.length, todayFirst: todays[0] ? (await shootRows(ctx, [todays[0]]))[0] ?? null : null, week: week.length, weekNoSheet: week.filter((s) => !withSheet.has(String(s._id))).length, edits: edits.length },
      callSheets: { notSent: sheets.filter((c) => c.status === "draft").length, sentWeek, templates },
      shoots: (await shootRows(ctx, upcoming.slice(0, 5))),
      shootsTotal: upcoming.length,
      edits: edits.slice(0, 6),
      week: items.slice(0, 8),
      calendar: cal ? { email: cal.email, calendar: cal.calendarName ?? null, error: !!cal.lastError, lastSyncedAt: cal.lastSyncedAt ?? null, disconnected: !!cal.disconnectedAt } : null,
    };
  },
});

/** Production › Shoots: every shoot, upcoming first; the page filters Upcoming · Today · Past. */
export const shoots = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireAll(ctx, "production");
    const shots = canShots(me);
    const today = todayCentral();
    const all = await scheduled(ctx);
    const upcoming = all.filter((s) => s.date >= today);
    const past = all.filter((s) => s.date < today).reverse().slice(0, 100);
    const up = await shootRows(ctx, upcoming, shots);
    return { today, upcoming: up, past: await shootRows(ctx, past, shots), pastTotal: all.length - upcoming.length, needsSheet: up.filter((s) => s.sheet?.state !== "sent").length };
  },
});

/** New shoot: the projects to pick from (not closed), newest first. */
export const projectsForShoot = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "production");
    const out = [];
    for (const p of await ctx.db.query("projects").order("desc").take(300)) {
      if (projectClosed(p)) continue;
      out.push({ _id: p._id, label: label(p), client: p.clientId ? (await ctx.db.get(p.clientId))?.name ?? null : null });
    }
    return out;
  },
});
