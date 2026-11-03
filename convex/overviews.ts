// Phase 5b step 2 (Nov 3): the tool overviews: Clients 767:4392, Review 767:5211, Docs 767:5964, Proposals 767:6705,
// Vendors 767:7477. One owner-only query each; only numbers the portal really has. Rows with no data behind them in
// the frames (call-sheet templates, the questionnaire's last-changed day, the raw-footage keep days) are left out.
// The business guard limits every table below to the owner's own business.
import { query } from "./lib/functions";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMe } from "./lib/access";
import { businessInScope } from "./lib/business";
import { todayCentral, bookingState } from "./lib/bookings";
import { label } from "./lib/bookingRows";
import { docLabel, OWNER_KEY } from "./lib/wsLayout";
import { docClient } from "./home";
import { addDays } from "./footage";
import { STAGES, STAGE_NAME } from "./crm";
import { WRANGLER_QUESTIONNAIRE, type Questionnaire } from "./lib/questionnaire";

const DAY = 86_400_000;
const month = (t: number) => todayCentral(t).slice(0, 7);

/** Clients › Overview. */
export const clients = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const today = todayCentral();
    const weekEnd = addDays(today, 6);
    const projects = await ctx.db.query("projects").collect();
    const live = new Set(projects.filter((p) => p.clientId && p.stage !== "delivery").map((p) => String(p.clientId)));
    const deals = (await ctx.db.query("deals").collect()).filter((d) => !d.closedAt);
    const leads = deals.filter((d) => d.stage === "lead");
    const fus = (await ctx.db.query("followUps").collect()).filter((f) => !f.doneAt && !f.draft);
    const dueNow = fus.filter((f) => f.due <= today).sort((a, b) => a.due.localeCompare(b.due));
    const testimonials = (await ctx.db.query("testimonials").collect()).filter((t) => !t.readAt).sort((a, b) => b.createdAt - a.createdAt);
    const names = new Map<string, string>();
    const nameOf = async (id: Id<"clients"> | undefined) => {
      if (!id) return null;
      if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? "");
      return names.get(id) || null;
    };
    const needs: Array<{ kind: "followup" | "lead" | "testimonial"; id: string; title: string; meta: string; at: number; clientId: Id<"clients"> | null; overdue?: boolean }> = [];
    for (const f of dueNow.slice(0, 3)) needs.push({ kind: "followup", id: f._id, title: `Follow up · ${f.who}`, meta: f.about, at: Date.parse(`${f.due}T12:00:00Z`), clientId: f.clientId ?? null, overdue: f.due < today });
    for (const d of leads.sort((a, b) => b.createdAt - a.createdAt).slice(0, 3)) needs.push({ kind: "lead", id: d._id, title: `New lead · ${d.lead?.company ?? d.lead?.name ?? d.title}`, meta: d.lead?.message?.slice(0, 80) ?? d.title, at: d.createdAt, clientId: null });
    for (const t of testimonials.slice(0, 3)) {
      const p = await ctx.db.get(t.projectId);
      needs.push({ kind: "testimonial", id: t._id, title: `Testimonial · ${t.company ?? t.name}`, meta: p ? label(p) : "A testimonial", at: t.createdAt, clientId: null });
    }
    const needsTotal = dueNow.length + leads.length + testimonials.length;

    // Recently active: each client's latest view, note or approval from the client's side.
    const byClient = new Map<string, { clientId: Id<"clients">; name: string; what: string; at: number }>();
    const videoClient = new Map<string, Id<"clients"> | null>();
    const clientOfVideo = async (id: Id<"videos">) => {
      if (!videoClient.has(id)) { const v = await ctx.db.get(id); const p = v ? await ctx.db.get(v.projectId) : null; videoClient.set(id, p?.clientId ?? null); }
      return videoClient.get(id) ?? null;
    };
    const note = async (videoId: Id<"videos">, what: string, at: number) => {
      const cid = await clientOfVideo(videoId);
      if (!cid) return;
      const cur = byClient.get(cid);
      if (cur && cur.at >= at) return;
      const name = await nameOf(cid);
      if (name) byClient.set(cid, { clientId: cid, name, what, at });
    };
    for (const w of await ctx.db.query("views").order("desc").take(200)) if (w.kind === "client") await note(w.videoId, "Opened a cut", w.lastAt);
    for (const n of await ctx.db.query("notes").order("desc").take(200)) if (n.authorKind === "client") await note(n.videoId, "Left notes", n.createdAt);
    for (const a of await ctx.db.query("clientApprovals").withIndex("by_at").order("desc").take(100)) await note(a.videoId, `Approved v${a.versionNumber}`, a.at);
    const recent = [...byClient.values()].sort((a, b) => b.at - a.at).slice(0, 4);

    const open = deals.filter((d) => d.stage !== "delivered" && d.stage !== "paid");
    return {
      today,
      tiles: { active: live.size, leads: leads.length, followUps: fus.filter((f) => f.due <= weekEnd).length, testimonials: testimonials.length },
      empty: (await ctx.db.query("clients").first()) === null && deals.length === 0 && fus.length === 0,
      needs, needsTotal,
      recent,
      pipeline: STAGES.filter((s) => s !== "delivered" && s !== "paid").map((s) => ({ key: s, name: STAGE_NAME[s], n: open.filter((d) => d.stage === s).length })),
      followUps: { today: fus.filter((f) => f.due <= today).length, week: fus.filter((f) => f.due > today && f.due <= weekEnd).length, later: fus.filter((f) => f.due > weekEnd).length },
    };
  },
});

/** Review › Overview. */
export const review = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMe(ctx);
    const now = Date.now();
    const thisMonth = month(now);
    const projects = await ctx.db.query("projects").collect();
    const videos = await ctx.db.query("videos").collect();
    const projectOf = new Map(projects.map((p) => [String(p._id), p]));
    const latest = async (videoId: Id<"videos">) => (await ctx.db.query("versions").withIndex("by_video", (q) => q.eq("videoId", videoId)).collect()).filter((x) => x.status === "ready").reduce<Doc<"versions"> | null>((m, x) => (!m || x.number > m.number ? x : m), null);
    const titleOf = (v: Doc<"videos">) => (v.number ? `${String(v.number).padStart(5, "0")} ${v.title}` : projectOf.get(String(v.projectId))?.jobNumber ? `${projectOf.get(String(v.projectId))!.jobNumber} ${v.title}` : v.title);

    // New notes: open notes from clients and guests with no reply yet, one row per person per version.
    const groups = new Map<string, { who: string; count: number; videoId: Id<"videos">; video: string; version: number; at: number }>();
    for (const n of (await ctx.db.query("notes").order("desc").take(1000)).filter((x) => x.status === "open" && x.authorKind !== "owner" && (x.shareId || x.authorKind === "client" || x.authorKind === "guest"))) {
      if ((await ctx.db.query("replies").withIndex("by_note", (q) => q.eq("noteId", n._id)).collect()).some((r) => !r.hidden)) continue;
      const k = `${n.authorName}|${n.versionId}`;
      const g = groups.get(k);
      if (g) { g.count++; continue; }
      const vid = videos.find((v) => v._id === n.videoId);
      const ver = await ctx.db.get(n.versionId);
      if (!vid || !ver) continue;
      groups.set(k, { who: n.authorName, count: 1, videoId: vid._id, video: titleOf(vid), version: ver.number, at: n.createdAt });
    }
    const noteRows = [...groups.values()].sort((a, b) => b.at - a.at);

    // Waiting on clients: a cut shared by a live link or invitation (to the video or its project), not approved yet.
    const waiting: Array<{ videoId: Id<"videos">; video: string; version: number; sentAt: number; opens: number }> = [];
    const seen = new Set<string>();
    for (const s of await ctx.db.query("shares").collect()) {
      if (s.offAt || (s.expiresAt && s.expiresAt < now) || (s.kind !== "video" && s.kind !== "project")) continue;
      const vids = s.kind === "video" ? videos.filter((v) => v._id === s.videoId) : videos.filter((v) => v.projectId === s.projectId);
      for (const v of vids) {
        if (v.final || seen.has(v._id)) continue;
        const ver = await latest(v._id);
        if (!ver) continue;
        seen.add(v._id);
        waiting.push({ videoId: v._id, video: titleOf(v), version: ver.number, sentAt: Math.max(s.createdAt, ver.createdAt), opens: s.openCount ?? 0 });
      }
    }
    waiting.sort((a, b) => b.sentAt - a.sentAt);

    const inProgress = projects.filter((p) => p.stage === "production" || p.stage === "polish");
    const delivered = projects.filter((p) => p.deliveryUnlockedAt && month(p.deliveryUnlockedAt) === thisMonth);

    // Last opened: this owner's own recent videos.
    const lastOpened: Array<{ videoId: Id<"videos">; title: string; at: number }> = [];
    for (const o of await ctx.db.query("opens").withIndex("by_user", (q) => q.eq("userId", me.userId)).order("desc").take(40)) {
      if (lastOpened.length >= 3 || lastOpened.some((x) => x.videoId === o.videoId)) continue;
      const v = videos.find((x) => x._id === o.videoId);
      if (v) lastOpened.push({ videoId: v._id, title: v.title, at: o.openedAt });
    }
    return {
      now,
      empty: videos.length === 0 && projects.length === 0,
      tiles: { waiting: waiting.length, notes: noteRows.reduce((t, g) => t + g.count, 0), inProgress: inProgress.length, delivered: delivered.length },
      notes: noteRows.slice(0, 3), notesGroups: noteRows.length,
      waiting: waiting.slice(0, 3), waitingTotal: waiting.length,
      lastOpened, delivered: delivered.length,
    };
  },
});

/** Docs › Overview. */
export const docs = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const now = Date.now();
    const thisMonth = month(now);
    const all = (await ctx.db.query("wsDocuments").collect()).filter((d) => !d.hiddenAt && d.status !== "voided");
    const sent = all.filter((d) => d.status === "sent" && !(d.expiresAt && d.expiresAt < now)).sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
    const rows = [];
    for (const d of sent) {
      const sig = (await ctx.db.query("wsSignings").withIndex("by_document", (q) => q.eq("documentId", d._id)).collect()).filter((s) => s.versionNumber === d.sentVersion && s.signerKey !== OWNER_KEY);
      const waiting = sig.filter((s) => s.status === "sent");
      rows.push({
        _id: d._id, label: docLabel(d.number), title: d.title, client: await docClient(ctx, sig.map((s) => s.email)), sentAt: d.sentAt ?? d.updatedAt,
        opened: sig.some((s) => !!s.openedAt), signed: sig.filter((s) => s.status === "signed").length, of: sig.length,
        // The Remind button's target: the signer whose turn it is (the same call Home's Remind makes).
        remind: waiting[0] ? { signerKey: waiting[0].signerKey, name: waiting[0].name } : null,
      });
    }
    const done = all.filter((d) => d.status === "completed").sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    const templates = await ctx.db.query("wsTemplates").collect();
    const sig = (await ctx.db.query("wsOwnerSignatures").withIndex("by_adopted").order("desc").take(5)).find((s) => !s.replacedAt) ?? null;
    return {
      empty: all.length === 0 && templates.length === 0,
      tiles: { toSign: rows.length, signed: done.filter((d) => d.completedAt && month(d.completedAt) === thisMonth).length, drafts: all.filter((d) => d.status === "draft" || d.status === "approved").length, templates: templates.filter((t) => !t.kind).length },
      waiting: rows.slice(0, 3),
      signed: done.slice(0, 3).map((d) => ({ _id: d._id, title: d.title, at: d.completedAt ?? d.updatedAt })),
      templates: { contracts: templates.filter((t) => !t.kind).length },
      signature: sig ? { adopted: true, method: sig.method } : { adopted: false, method: null },
    };
  },
});

/** Proposals › Overview. */
export const proposals = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const now = Date.now();
    const year = todayCentral(now).slice(0, 4);
    const all = await ctx.db.query("proposals").withIndex("by_updated").order("desc").take(500);
    const live = all.filter((p) => p.status !== "void");
    const build = async (p: Doc<"proposals">) => (await ctx.db.get(p.buildId))?.title ?? "Proposal";
    const who = (p: Doc<"proposals">) => p.contact?.company || p.contact?.name || "A client";
    const answered = (p: Doc<"proposals">) => p.response?.kind;
    const out = live.filter((p) => !p.response && p.status === "sent");
    const accepted = live.filter((p) => answered(p) === "accepted" && !p.asked?.contract);
    const drafts = live.filter((p) => p.status === "draft" || p.status === "waiting" || p.status === "ready");
    const declinedYear = live.filter((p) => answered(p) === "declined" && todayCentral(p.response!.at).slice(0, 4) === year);
    const views = (p: Doc<"proposals">) => p.history.filter((h) => h.kind === "viewed").length;
    // Sent and opened, but quiet for three days.
    const quiet = out.filter((p) => p.viewedAt && (p.sentAt ?? 0) < now - 3 * DAY);
    const needs = [
      ...(await Promise.all(accepted.map(async (p) => ({ _id: p._id, kind: "accepted" as const, title: `Accepted · ${who(p)}`, meta: `Accepted ${todayCentral(p.response!.at).slice(5)} · make it a contract?`, at: p.response!.at, views: 0, project: await build(p) })))),
      ...(await Promise.all(quiet.map(async (p) => ({ _id: p._id, kind: "viewed" as const, title: `Viewed · ${who(p)}`, meta: `Opened ${views(p) || 1} ${views(p) === 1 || !views(p) ? "time" : "times"} · no answer`, at: p.viewedAt!, views: views(p), project: await build(p) })))),
    ];
    const biz = await ctx.db.get(businessInScope(ctx)!);
    const q = ((biz?.questionnaire as Questionnaire | undefined) ?? WRANGLER_QUESTIONNAIRE).steps.length;
    return {
      empty: live.length === 0,
      tiles: { out: out.length, accepted: accepted.length, drafts: drafts.length, declined: declinedYear.length },
      needs: needs.slice(0, 3), needsTotal: needs.length,
      out: await Promise.all(out.slice(0, 3).map(async (p) => ({ _id: p._id, title: `${await build(p)} · ${who(p)}`, sentAt: p.sentAt ?? p.updatedAt, viewed: !!p.viewedAt }))),
      outTotal: out.length,
      templates: (await ctx.db.query("wsTemplates").collect()).filter((t) => t.kind === "proposal").length,
      steps: q,
    };
  },
});

/** Vendors › Overview. */
export const vendors = query({
  args: {},
  handler: async (ctx) => {
    await requireMe(ctx);
    const today = todayCentral();
    const weekEnd = addDays(today, 6);
    const thisMonth = today.slice(0, 7);
    const vendorRows = (await ctx.db.query("vendors").collect()).filter((v) => !v.archivedAt);
    const vendorOf = new Map(vendorRows.map((v) => [String(v._id), v]));
    const bookings = (await ctx.db.query("vendorBookings").collect()).filter((b) => b.status === "offered" || b.status === "accepted");
    const projects = new Map<string, Doc<"projects"> | null>();
    const proj = async (id: Id<"projects">) => { if (!projects.has(id)) projects.set(id, await ctx.db.get(id)); return projects.get(id) ?? null; };
    const inWeek = bookings.filter((b) => b.end >= today && b.start <= weekEnd && bookingState(b, today) !== "done");
    const waiting = bookings.filter((b) => b.status === "offered" && b.end >= today).sort((a, b) => a.start.localeCompare(b.start));
    const invoices = await ctx.db.query("vendorInvoices").collect();
    const toApprove = invoices.filter((i) => i.status === "sent");
    const toPay = invoices.filter((i) => i.status === "approved");
    const paidMonth = invoices.filter((i) => i.status === "paid" && (i.paidOn ?? (i.paidAt ? todayCentral(i.paidAt) : "")).slice(0, 7) === thisMonth);
    const booked = new Set(bookings.map((b) => String(b.vendorId)));
    const noW9 = vendorRows.filter((v) => !v.w9 && booked.has(String(v._id)));
    const briefings = (await ctx.db.query("briefings").collect()).filter((b) => b.status === "sent");

    const needs: Array<{ kind: "waiting" | "invoice" | "w9"; id: string; vendor: string; role: string | null; meta: string; at: number }> = [];
    for (const b of waiting.slice(0, 3)) {
      const p = await proj(b.projectId);
      needs.push({ kind: "waiting", id: b._id, vendor: vendorOf.get(b.vendorId)?.name ?? "A vendor", role: b.role, meta: `Booking for ${shortDay(b.start)}${p ? ` · ${p.name}` : ""} · not accepted yet`, at: b.offeredAt });
    }
    for (const i of toApprove.slice(0, 3)) {
      const p = await proj(i.projectId);
      needs.push({ kind: "invoice", id: i._id, vendor: (await ctx.db.get(i.vendorId))?.name ?? "A vendor", role: null, meta: `Invoice ${i.number}${p ? ` · ${p.name}` : ""}`, at: i.sentAt ?? i.updatedAt });
    }
    for (const v of noW9.slice(0, 3)) needs.push({ kind: "w9", id: v._id, vendor: v.name, role: v.roles[0] ?? null, meta: "No W-9 on file", at: v.updatedAt });
    const needsTotal = waiting.length + toApprove.length + noW9.length;

    // Bookings this week: one row per day and project, with who's on it.
    const groups = new Map<string, { date: string; projectId: Id<"projects">; people: string[] }>();
    for (const b of inWeek.sort((x, y) => x.start.localeCompare(y.start))) {
      const k = `${b.start < today ? today : b.start}|${b.projectId}`;
      const g = groups.get(k) ?? { date: b.start < today ? today : b.start, projectId: b.projectId, people: [] };
      const n = vendorOf.get(b.vendorId)?.name;
      if (n && !g.people.includes(n)) g.people.push(n);
      groups.set(k, g);
    }
    const week = [];
    for (const g of groups.values()) { const p = await proj(g.projectId); week.push({ date: g.date, projectId: g.projectId, project: p?.name ?? "A project", people: g.people }); }
    return {
      today,
      empty: vendorRows.length === 0,
      tiles: { booked: inWeek.length, shoots: new Set(inWeek.map((b) => String(b.projectId))).size, waiting: waiting.length, invoices: toApprove.length + toPay.length, w9: noW9.length },
      needs: needs.slice(0, 3).sort((a, b) => a.at - b.at), needsTotal,
      week: week.slice(0, 4), weekTotal: week.length,
      briefings: { sent: briefings.length, notOpened: briefings.filter((b) => !b.readAt).length },
      payments: { toApprove: toApprove.length, toPay: toPay.length, paidMonth: paidMonth.length },
    };
  },
});

const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
