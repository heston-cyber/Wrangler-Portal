// The Shoot page (D203, 5i; frames 1056-28129 desktop Overview, 1055-27995 phone): one shoot day with its tabs
// Overview · Call sheet · Shot list · Gear · Releases · Locations. This is the page's Overview data: when and where,
// crew and client confirmations, what to prepare, and each tab's count.
import { query } from "./lib/functions";
import { v } from "convex/values";
import { requireAll, seesValue } from "./lib/access";
import { label } from "./lib/bookingRows";

export const get = query({
  args: { shootId: v.string() },
  handler: async (ctx, { shootId }) => {
    const me = await requireAll(ctx, "shoots");
    const id = ctx.db.normalizeId("shoots", shootId);
    const s = id ? await ctx.db.get(id) : null;
    if (!s) return null;
    const p = s.projectId ? await ctx.db.get(s.projectId) : null;
    const client = p?.clientId ? await ctx.db.get(p.clientId) : null;
    // Day N of its project's shoots, by date.
    const days = p ? (await ctx.db.query("shoots").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).filter((x) => x.status === "scheduled").sort((a, b) => a.date.localeCompare(b.date) || a.call.localeCompare(b.call)) : [];
    const day = days.findIndex((x) => x._id === s._id) + 1;
    const crew = [];
    for (const c of s.crew) {
      const k = c.bookingId ? await ctx.db.get(c.bookingId) : null;
      crew.push({ name: c.name, role: c.role, owner: !!c.owner, bookingId: c.bookingId ?? null, state: c.owner ? "you" : !k ? "listed" : k.status === "accepted" ? "confirmed" : k.status === "offered" ? "waiting" : k.status });
    }
    const cs = await ctx.db.query("callSheets").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).first();
    const sentTo = cs ? cs.recipients.filter((r) => r.sentAt) : [];
    const list = await ctx.db.query("shotLists").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).first();
    const shots = list ? await ctx.db.query("shots").withIndex("by_list", (q) => q.eq("listId", list._id)).collect() : [];
    // Releases (5i): signed, and shots marked "Release needed" not covered by a signed one. Only for Docs.
    let releases: { signed: number; missing: number; missingShots: number[] } | null = null;
    try {
      await requireAll(ctx, "docs");
      const rows = await ctx.db.query("releases").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).collect();
      const covered = new Set<string>();
      let signed = 0;
      for (const r of rows) { const d = r.documentId ? await ctx.db.get(r.documentId) : null; if (d?.status === "completed") { signed++; for (const x of r.shotIds) covered.add(x); } }
      const miss = shots.filter((x) => x.releaseNeeded && !covered.has(x._id));
      releases = { signed, missing: miss.length, missingShots: miss.map((x) => x.number) };
    } catch { releases = null; }
    const packing = await ctx.db.query("packLists").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).first();
    const lines = packing ? await ctx.db.query("packLines").withIndex("by_list", (q) => q.eq("listId", packing._id)).collect() : [];
    const places = await ctx.db.query("placeLinks").withIndex("by_shoot", (q) => q.eq("shootId", s._id)).collect();
    return {
      _id: s._id, date: s.date, call: s.call, wrap: s.wrap ?? null, location: s.location, parking: s.parking ?? null, prepare: s.prepare, status: s.status,
      project: p ? { _id: p._id, label: label(p), name: p.name } : null, client: client ? { _id: client._id, name: client.name } : null,
      day: day || null, days: days.length, calendar: !!s.calendar,
      confirmed: s.confirmed ? { name: s.confirmed.name, at: s.confirmed.at } : null, askConfirm: s.clientHold ? { from: s.clientHold.from ?? null } : null,
      crew,
      sheet: cs ? { _id: cs._id, state: cs.status === "sent" ? "sent" as const : "draft" as const, sentAt: cs.sent?.at ?? null, opened: sentTo.filter((r) => r.openedAt).length, of: sentTo.length } : null,
      shotList: list ? { _id: list._id, total: shots.length, done: shots.filter((x) => x.done).length } : null,
      releases,
      gear: packing ? { _id: packing._id, total: lines.reduce((n, l) => n + l.qty, 0), loaded: lines.reduce((n, l) => n + (l.loaded ? l.qty : 0), 0), back: lines.reduce((n, l) => n + (l.back ? l.qty : 0), 0) } : null,
      places: places.length,
      value: seesValue(me),
    };
  },
});
