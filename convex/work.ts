// 5m Work (D197–D200; Design Log "Handoff ready: Work" rounds 1 and 2): tasks, to-do lists and task templates.
// A task lives in Work and shows on its project's page (D197); it can be on a client, project, shoot day or lead, or on
// nothing yet (Attach/Move, D204). Statuses To do / In progress / Waiting / Done; priorities High / Normal / Low.
// "Who sees it": only the team, the client (the people who can open its project, or its client's people) or one vendor
// (D199): theirs show in their portal with a Done button, and they can only press Done. Simple repeats (D200): every
// day, week or month, or again after it's done. Todoist: a one-time import, assigned to whoever imports (D198).
// Owner and team with Projects; a team member's own tasks (My tasks) need no switch beyond being on the team.
import { action } from "./_generated/server";
import { internalMutation, mutation, query } from "./lib/functions";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireAll, requireMe, requireSignedIn } from "./lib/access";
import { PERMS } from "./lib/perms";
import { businessInScope } from "./lib/business";
import { label } from "./lib/bookingRows";
import { todayCentral } from "./lib/bookings";
import { homeChip } from "./creative";
import { placeOf, peopleAt, clientMayOpen } from "./lib/placed";
import { asVendor } from "./vendorPortal";
import { myProjects } from "./projects";

type Ctx = QueryCtx | MutationCtx;
const statusArg = v.union(v.literal("todo"), v.literal("doing"), v.literal("waiting"), v.literal("done"));
const prioArg = v.union(v.literal("high"), v.literal("normal"), v.literal("low"));
const audArg = v.union(v.literal("team"), v.literal("client"), v.literal("vendor"));
const homeArg = v.optional(v.union(v.null(), v.object({ type: v.union(v.literal("client"), v.literal("project"), v.literal("shoot"), v.literal("lead")), id: v.string() })));
const repeatArg = v.optional(v.union(v.null(), v.object({ every: v.union(v.literal("day"), v.literal("week"), v.literal("month")), after: v.boolean() })));
const personArg = v.optional(v.union(v.null(), v.object({ email: v.string(), name: v.optional(v.string()) })));
const tidy = (s: string | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAGE: Record<string, "pre" | "prin" | "post" | "delivery"> = { discovery: "pre", strategy: "pre", production: "prin", polish: "post", delivery: "delivery" };
type HomeIn = { type: "client" | "project" | "shoot" | "lead"; id: string } | null | undefined;

/** Any owner or team member (their own tasks). */
const anyTeam = (ctx: Ctx) => requireMe(ctx, PERMS);
const who = (me: { name?: string | null; email: string }) => me.name?.trim() || me.email;

async function homeFields(ctx: MutationCtx, h: HomeIn) {
  if (!h) return {};
  const table = { client: "clients", project: "projects", shoot: "shoots", lead: "deals" }[h.type] as "clients";
  const id = ctx.db.normalizeId(table, h.id);
  if (!id || !(await ctx.db.get(id))) throw new ConvexError("That home isn't here any more.");
  if (h.type === "client" || h.type === "lead") await requireAll(ctx, "clients");
  if (h.type === "shoot") await requireAll(ctx, "shoots");
  return { [{ client: "clientId", project: "projectId", shoot: "shootId", lead: "dealId" }[h.type]]: id } as { clientId?: Id<"clients">; projectId?: Id<"projects">; shootId?: Id<"shoots">; dealId?: Id<"deals"> };
}
async function taskOf(ctx: Ctx, taskId: string) {
  const id = ctx.db.normalizeId("tasks", taskId);
  const t = id ? await ctx.db.get(id) : null;
  if (!t) throw new ConvexError("That task isn't here any more.");
  return t;
}
/** The project a task is on (through its shoot day too). */
async function projectOfTask(ctx: Ctx, t: { projectId?: Id<"projects">; shootId?: Id<"shoots"> }) {
  if (t.projectId) return await ctx.db.get(t.projectId);
  const s = t.shootId ? await ctx.db.get(t.shootId) : null;
  return s?.projectId ? await ctx.db.get(s.projectId) : null;
}

async function row(ctx: Ctx, t: Doc<"tasks">, subs?: Doc<"tasks">[]) {
  const p = await projectOfTask(ctx, t);
  const vendor = t.vendorId ? await ctx.db.get(t.vendorId) : null;
  const kids = subs ?? (await ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentId", t._id)).collect());
  return {
    _id: t._id, title: t.title, status: t.status, priority: t.priority, due: t.due ?? null, assignee: t.assignee ?? null, audience: t.audience, vendor: vendor ? { _id: vendor._id, name: vendor.name } : null,
    repeat: t.repeat ?? null, home: await homeChip(ctx, t), project: p ? { _id: p._id, label: label(p), stage: STAGE[p.stage ?? "discovery"] } : null,
    subtasks: { done: kids.filter((k) => k.status === "done").length, total: kids.length }, checklist: { done: (t.checklist ?? []).filter((c) => c.done).length, total: (t.checklist ?? []).length },
    doneAt: t.doneAt ?? null, doneBy: t.doneBy ?? null, order: t.order, createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}
export type TaskRow = Awaited<ReturnType<typeof row>>;

// ---------- reading ----------

/** My tasks: everything given to me, from every project, shoot and client (done ones for 7 days). */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await anyTeam(ctx);
    const email = me.email.toLowerCase();
    const weekAgo = Date.now() - 7 * 86_400_000;
    const out = [];
    for (const t of await ctx.db.query("tasks").withIndex("by_assignee", (q) => q.eq("assigneeEmail", email)).collect())
      if (!t.parentId && (t.status !== "done" || (t.doneAt ?? 0) > weekAgo)) out.push(await row(ctx, t));
    return { today: todayCentral(), tasks: out };
  },
});

/** All tasks: every top-level task in the business (done ones for 30 days), for Table, List, Board and Calendar. */
export const all = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "projects");
    const old = Date.now() - 30 * 86_400_000;
    const out = [];
    for (const t of await ctx.db.query("tasks").collect()) if (!t.parentId && (t.status !== "done" || (t.doneAt ?? 0) > old)) out.push(await row(ctx, t));
    return { today: todayCentral(), tasks: out.sort((a, b) => a.order - b.order) };
  },
});

export const forProject = query({
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    await requireAll(ctx, "projects");
    const id = ctx.db.normalizeId("projects", projectId);
    if (!id) return null;
    const shoots = new Set((await ctx.db.query("shoots").withIndex("by_project", (q) => q.eq("projectId", id)).collect()).map((s) => String(s._id)));
    const out = [];
    for (const t of await ctx.db.query("tasks").collect()) if (!t.parentId && (t.projectId === id || (t.shootId && shoots.has(String(t.shootId))))) out.push(await row(ctx, t));
    return out.sort((a, b) => a.order - b.order);
  },
});

/** A task open in the side panel: everything, with its subtasks and who it can go to. */
export const get = query({
  args: { taskId: v.string() },
  handler: async (ctx, { taskId }) => {
    await anyTeam(ctx);
    const id = ctx.db.normalizeId("tasks", taskId);
    const t = id ? await ctx.db.get(id) : null;
    if (!t) return null;
    await mayOpen(ctx, t);
    const subs = await ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentId", t._id)).collect();
    return { ...(await row(ctx, t, subs)), notes: t.notes ?? "", checklist: t.checklist ?? [], parentId: t.parentId ?? null, subs: await Promise.all(subs.sort((a, b) => a.order - b.order).map((s) => row(ctx, s, []))) };
  },
});

/** A team member without Projects opens only tasks given to them. */
async function mayOpen(ctx: Ctx, t: Doc<"tasks">) {
  try { await requireAll(ctx, "projects"); return; } catch { /* their own only */ }
  const me = await anyTeam(ctx);
  const root = t.parentId ? await ctx.db.get(t.parentId) : t;
  if ((root?.assigneeEmail ?? "") !== me.email.toLowerCase() && t.assigneeEmail !== me.email.toLowerCase()) throw new ConvexError("Not allowed.");
}

/** Who a task can go to: the owner and team; for the client, the people who can open its project; for a vendor, the
 *  vendors booked on its project (or any vendor). */
export const people = query({
  args: { taskId: v.optional(v.string()), projectId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const team: Array<{ email: string; name: string }> = [];
    const biz = businessInScope(ctx);
    for (const m of biz ? await ctx.db.query("memberships").collect() : []) {
      if (m.revokedAt || (m.role !== "owner" && m.role !== "team") || m.businessId !== biz) continue;
      const u = m.userId ? await ctx.db.get(m.userId) : null;
      if (!team.some((x) => x.email === m.email)) team.push({ email: m.email, name: u?.name?.trim() || m.email });
    }
    const tid = a.taskId ? ctx.db.normalizeId("tasks", a.taskId) : null;
    const t = tid ? await ctx.db.get(tid) : null;
    const pid = a.projectId ? ctx.db.normalizeId("projects", a.projectId) : null;
    const p = pid ? await ctx.db.get(pid) : t ? await projectOfTask(ctx, t) : null;
    const w = await placeOf(ctx, { projectId: p?._id, clientId: p ? undefined : t?.clientId });
    const client = w ? (await peopleAt(ctx, w)).map((x) => ({ email: x.email })) : [];
    const booked = p ? new Set((await ctx.db.query("vendorBookings").withIndex("by_project", (q) => q.eq("projectId", p._id)).collect()).filter((k) => k.status === "accepted" || k.status === "offered").map((k) => String(k.vendorId))) : new Set<string>();
    const vendors = (await ctx.db.query("vendors").collect()).filter((x) => !x.archivedAt).map((x) => ({ _id: x._id, name: x.name, email: x.email, booked: booked.has(String(x._id)) })).sort((a2, b) => Number(b.booked) - Number(a2.booked) || a2.name.localeCompare(b.name));
    return { team, client, vendors };
  },
});

// ---------- writing ----------

async function nextOrder(ctx: MutationCtx) { const last = await ctx.db.query("tasks").withIndex("by_order").order("desc").first(); return (last?.order ?? 0) + 1; }

export const create = mutation({
  args: { title: v.string(), home: homeArg, due: v.optional(v.string()), priority: v.optional(prioArg), status: v.optional(statusArg), assignee: personArg, audience: v.optional(audArg), vendorId: v.optional(v.id("vendors")), parentId: v.optional(v.id("tasks")), mine: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    // Quick add on My tasks (mine: true) is anyone's; everything else is Projects'.
    const me = a.mine && !a.home && !a.parentId ? await anyTeam(ctx) : await requireAll(ctx, "projects");
    const title = tidy(a.title, 300);
    if (!title) throw new ConvexError("Name the task.");
    if (a.due && !DAY.test(a.due)) throw new ConvexError("Pick a due date.");
    const parent = a.parentId ? await ctx.db.get(a.parentId) : null;
    if (a.parentId && !parent) throw new ConvexError("That task isn't here any more.");
    const home = parent ? { ...(parent.clientId ? { clientId: parent.clientId } : {}), ...(parent.projectId ? { projectId: parent.projectId } : {}), ...(parent.shootId ? { shootId: parent.shootId } : {}), ...(parent.dealId ? { dealId: parent.dealId } : {}) } : await homeFields(ctx, a.home);
    // Review M1: quick add is for yourself and the team only; anything for a client or vendor needs Projects.
    if (a.mine && !a.home && !a.parentId && (a.audience && a.audience !== "team" || a.vendorId)) throw new ConvexError("Tasks for a client or vendor are made in All tasks.");
    if (a.vendorId) await liveVendor(ctx, a.vendorId);
    const assignee = a.mine ? { email: me.email.toLowerCase(), name: who(me) } : a.assignee ? { email: tidy(a.assignee.email, 200).toLowerCase(), ...(a.assignee.name ? { name: tidy(a.assignee.name, 80) } : {}) } : undefined;
    const now = Date.now();
    const id = await ctx.db.insert("tasks", {
      title, status: a.status ?? "todo", priority: a.priority ?? "normal", ...(a.due ? { due: a.due } : {}), ...home, audience: a.audience ?? "team",
      ...(assignee ? { assignee, assigneeEmail: assignee.email } : {}), ...(a.vendorId ? { vendorId: a.vendorId } : {}), ...(parent ? { parentId: parent._id } : {}),
      order: await nextOrder(ctx), createdBy: who(me), createdAt: now, updatedAt: now,
    });
    await checkAudience(ctx, (await ctx.db.get(id))!);
    return id;
  },
});

async function liveVendor(ctx: Ctx, id: Id<"vendors">) {
  const v2 = await ctx.db.get(id);
  if (!v2 || v2.archivedAt) throw new ConvexError("That vendor isn't on your list.");
}
/** A task for the client needs a project or client to be seen; one for a vendor needs the vendor. */
async function checkAudience(ctx: MutationCtx, t: Doc<"tasks">) {
  if (t.audience === "vendor" && !t.vendorId) throw new ConvexError("Pick the vendor who sees it.");
  if (t.audience === "client" && !(await projectOfTask(ctx, t)) && !t.clientId) throw new ConvexError("Attach it to a project or a client first: that's whose portal it shows in.");
}

export const update = mutation({
  args: {
    taskId: v.string(), title: v.optional(v.string()), notes: v.optional(v.string()), status: v.optional(statusArg), priority: v.optional(prioArg), due: v.optional(v.union(v.string(), v.null())),
    assignee: personArg, audience: v.optional(audArg), vendorId: v.optional(v.union(v.id("vendors"), v.null())), repeat: repeatArg,
    checklist: v.optional(v.array(v.object({ id: v.string(), text: v.string(), done: v.boolean() }))),
  },
  handler: async (ctx, a) => {
    const t = await taskOf(ctx, a.taskId);
    let me;
    try { me = await requireAll(ctx, "projects"); } catch {
      // Someone without Projects may change their own task's status, notes and checklist only.
      me = await anyTeam(ctx);
      if (t.assigneeEmail !== me.email.toLowerCase() || a.title !== undefined || a.assignee !== undefined || a.audience !== undefined || a.vendorId !== undefined || a.due !== undefined || a.priority !== undefined || a.repeat !== undefined) throw new ConvexError("Not allowed.");
    }
    const p: Partial<Doc<"tasks">> = { updatedAt: Date.now() };
    if (a.title !== undefined) { const x = tidy(a.title, 300); if (!x) throw new ConvexError("Name the task."); p.title = x; }
    if (a.notes !== undefined) p.notes = a.notes.slice(0, 10_000);
    if (a.priority) p.priority = a.priority;
    if (a.due !== undefined) { if (a.due && !DAY.test(a.due)) throw new ConvexError("Pick a due date."); p.due = a.due ?? undefined; }
    if (a.assignee !== undefined) { p.assignee = a.assignee ? { email: tidy(a.assignee.email, 200).toLowerCase(), ...(a.assignee.name ? { name: tidy(a.assignee.name, 80) } : {}) } : undefined; p.assigneeEmail = p.assignee?.email; }
    if (a.audience) p.audience = a.audience;
    if (a.vendorId) await liveVendor(ctx, a.vendorId);
    if (a.vendorId !== undefined) p.vendorId = a.vendorId ?? undefined;
    if (a.repeat !== undefined) p.repeat = a.repeat ?? undefined;
    if (a.checklist) { if (a.checklist.length > 100) throw new ConvexError("A checklist holds up to 100 items."); p.checklist = a.checklist.map((c) => ({ id: c.id.slice(0, 40), text: c.text.slice(0, 300), done: c.done })); }
    await ctx.db.patch(t._id, p);
    if (a.status && a.status !== t.status) await setStatus(ctx, (await ctx.db.get(t._id))!, a.status, who(me));
    await checkAudience(ctx, (await ctx.db.get(t._id))!);
    return null;
  },
});

/** Status changes go through here: Done stamps who and when, and a repeating task makes its next one (D200). */
async function setStatus(ctx: MutationCtx, t: Doc<"tasks">, status: Doc<"tasks">["status"], by: string) {
  const now = Date.now();
  if (status !== "done") { await ctx.db.patch(t._id, { status, doneAt: undefined, doneBy: undefined, updatedAt: now }); return null; }
  await ctx.db.patch(t._id, { status, doneAt: now, doneBy: by, updatedAt: now });
  if (!t.repeat || t.status === "done") return null;
  const from = t.repeat.after || !t.due ? todayCentral(now) : t.due;
  const next = addDays(from, t.repeat.every);
  const { _id, _creationTime, doneAt, doneBy, status: _s, ...rest } = t; void _id; void _creationTime; void doneAt; void doneBy; void _s;
  return await ctx.db.insert("tasks", { ...rest, status: "todo", due: next, checklist: (t.checklist ?? []).map((c) => ({ ...c, done: false })), order: await nextOrder(ctx), createdAt: now, updatedAt: now });
}
export function addDays(day: string, every: "day" | "week" | "month") {
  const d = new Date(`${day}T12:00:00Z`);
  if (every === "day") d.setUTCDate(d.getUTCDate() + 1);
  else if (every === "week") d.setUTCDate(d.getUTCDate() + 7);
  else { const m = d.getUTCMonth(); d.setUTCMonth(m + 1); if (d.getUTCMonth() !== (m + 1) % 12) d.setUTCDate(0); }
  return d.toISOString().slice(0, 10);
}

export const done = mutation({
  args: { taskId: v.string(), done: v.boolean() },
  handler: async (ctx, a) => {
    const t = await taskOf(ctx, a.taskId);
    let me;
    try { me = await requireAll(ctx, "projects"); } catch { me = await anyTeam(ctx); if (t.assigneeEmail !== me.email.toLowerCase()) throw new ConvexError("Not allowed."); }
    const next = await setStatus(ctx, t, a.done ? "done" : "todo", who(me));
    return { next };
  },
});

/** Drag on the board (status) or the calendar (due date), or reorder. A card can't move between project stages
 *  (Heston, Nov 16: "Stage belongs to the project. Change it on the project."). */
export const place = mutation({
  args: { taskId: v.string(), status: v.optional(statusArg), due: v.optional(v.string()), before: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    const me = await requireAll(ctx, "projects");
    const t = await taskOf(ctx, a.taskId);
    if (a.due !== undefined) { if (!DAY.test(a.due)) throw new ConvexError("Pick a day."); await ctx.db.patch(t._id, { due: a.due, updatedAt: Date.now() }); }
    if (a.before !== undefined) {
      const b = a.before ? await taskOf(ctx, a.before) : null;
      const prev = b ? (await ctx.db.query("tasks").withIndex("by_order", (q) => q.lt("order", b.order)).order("desc").first()) : null;
      await ctx.db.patch(t._id, { order: b ? ((prev?.order ?? b.order - 1) + b.order) / 2 : await nextOrder(ctx) });
    }
    if (a.status && a.status !== t.status) await setStatus(ctx, (await ctx.db.get(t._id))!, a.status, who(me));
    return null;
  },
});

export const remove = mutation({
  args: { taskId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const t = await taskOf(ctx, a.taskId);
    for (const s of await ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentId", t._id)).collect()) await ctx.db.delete(s._id);
    await ctx.db.delete(t._id);
    return null;
  },
});

// ---------- the client's and a vendor's portal (D199): their tasks, with Done ----------

/** May this signed-in client see this task? It's for the client, and they can open its project (or are its client's). */
async function clientSees(ctx: Ctx, email: string, t: Doc<"tasks">) {
  if (t.audience !== "client" || t.parentId) return false;
  const p = await projectOfTask(ctx, t);
  const w = await placeOf(ctx, { projectId: p?._id, clientId: p ? undefined : t.clientId });
  return w ? await clientMayOpen(ctx, email, w) : false;
}

export const forClient = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") return [];
    const email = me.email.toLowerCase();
    const projects = await myProjects(ctx, email);
    const out = [];
    for (const t of await ctx.db.query("tasks").withIndex("by_audience", (q) => q.eq("audience", "client")).collect()) {
      if (t.parentId) continue; // review L4: subtasks stay with the team
      if (t.status === "done" && (t.doneAt ?? 0) < Date.now() - 3 * 86_400_000) continue;
      const p = await projectOfTask(ctx, t);
      if (p ? !projects.has(p._id) : !(await clientSees(ctx, email, t))) continue;
      const biz = t.businessId ? await ctx.db.get(t.businessId) : null;
      out.push({ _id: t._id, title: t.title, due: t.due ?? null, status: t.status, project: p ? label(p) : null, from: biz?.ownerName?.trim() || biz?.name || null, doneAt: t.doneAt ?? null });
    }
    return out.sort((a, b) => (a.due ?? "9") .localeCompare(b.due ?? "9"));
  },
});

export const clientDone = mutation({
  args: { taskId: v.id("tasks"), done: v.boolean() },
  handler: async (ctx, a) => {
    const me = await requireSignedIn(ctx);
    if (me.kind !== "client") throw new ConvexError("Not allowed.");
    const t = await ctx.db.get(a.taskId);
    if (!t || !(await clientSees(ctx, me.email.toLowerCase(), t))) throw new ConvexError("That task isn't one of yours.");
    await setStatus(ctx, t, a.done ? "done" : "todo", me.name?.trim() || me.email);
    return null;
  },
});

export const forVendor = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, a) => {
    const me = await asVendor(ctx, a.businessId);
    const out = [];
    for (const t of await ctx.db.query("tasks").withIndex("by_vendor", (q) => q.eq("vendorId", me.vendor._id)).collect()) {
      if (t.audience !== "vendor" || t.parentId || (t.status === "done" && (t.doneAt ?? 0) < Date.now() - 3 * 86_400_000)) continue;
      const p = await projectOfTask(ctx, t);
      out.push({ _id: t._id, title: t.title, due: t.due ?? null, status: t.status, project: p ? label(p) : null, doneAt: t.doneAt ?? null });
    }
    return out.sort((x, y) => (x.due ?? "9").localeCompare(y.due ?? "9"));
  },
});

export const vendorDone = mutation({
  args: { businessId: v.optional(v.id("businesses")), taskId: v.id("tasks"), done: v.boolean() },
  handler: async (ctx, a) => {
    const me = await asVendor(ctx, a.businessId);
    const t = await ctx.db.get(a.taskId);
    if (!t || t.audience !== "vendor" || t.vendorId !== me.vendor._id) throw new ConvexError("That task isn't one of yours.");
    await setStatus(ctx, t, a.done ? "done" : "todo", me.vendor.name);
    return null;
  },
});

// ---------- To-do lists (round 2) ----------

export const lists = query({
  args: {},
  handler: async (ctx) => {
    await requireAll(ctx, "projects");
    const out = [];
    for (const l of await ctx.db.query("todoLists").collect()) out.push({ _id: l._id, name: l.name, items: l.items, home: await homeChip(ctx, l), updatedAt: l.updatedAt });
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});
const itemsArg = v.array(v.object({ id: v.string(), text: v.string(), done: v.boolean() }));
const cleanList = (items: Array<{ id: string; text: string; done: boolean }>) => { if (items.length > 300) throw new ConvexError("A list holds up to 300 items."); return items.map((i) => ({ id: i.id.slice(0, 40), text: i.text.slice(0, 300), done: i.done })); };

export const createList = mutation({
  args: { name: v.string(), home: homeArg },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const now = Date.now();
    return await ctx.db.insert("todoLists", { name: tidy(a.name, 80) || "To-do list", items: [], ...(await homeFields(ctx, a.home)), createdAt: now, updatedAt: now });
  },
});
async function listOf(ctx: Ctx, listId: string) { const id = ctx.db.normalizeId("todoLists", listId); const l = id ? await ctx.db.get(id) : null; if (!l) throw new ConvexError("That list isn't here any more."); return l; }
export const saveList = mutation({
  args: { listId: v.string(), name: v.optional(v.string()), items: v.optional(itemsArg) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const l = await listOf(ctx, a.listId);
    await ctx.db.patch(l._id, { ...(a.name !== undefined ? { name: tidy(a.name, 80) || l.name } : {}), ...(a.items ? { items: cleanList(a.items) } : {}), updatedAt: Date.now() });
    return null;
  },
});
export const duplicateList = mutation({
  args: { listId: v.string() },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const l = await listOf(ctx, a.listId);
    const now = Date.now();
    const { _id, _creationTime, ...rest } = l; void _id; void _creationTime;
    return await ctx.db.insert("todoLists", { ...rest, name: `${l.name} (copy)`, items: l.items.map((i) => ({ ...i, done: false })), createdAt: now, updatedAt: now });
  },
});
export const removeList = mutation({
  args: { listId: v.string() },
  handler: async (ctx, a) => { await requireAll(ctx, "projects"); const l = await listOf(ctx, a.listId); await ctx.db.delete(l._id); return null; },
});
/** "Turn into a task": the item becomes a task (on the list's home) and leaves the list (Q145). */
export const itemToTask = mutation({
  args: { listId: v.string(), itemId: v.string() },
  handler: async (ctx, a) => {
    const me = await requireAll(ctx, "projects");
    const l = await listOf(ctx, a.listId);
    const it = l.items.find((i) => i.id === a.itemId);
    if (!it) throw new ConvexError("That item isn't on the list any more.");
    const now = Date.now();
    const id = await ctx.db.insert("tasks", {
      title: it.text.slice(0, 300) || "Task", status: it.done ? "done" : "todo", priority: "normal", audience: "team", ...(l.clientId ? { clientId: l.clientId } : {}), ...(l.projectId ? { projectId: l.projectId } : {}), ...(l.shootId ? { shootId: l.shootId } : {}), ...(l.dealId ? { dealId: l.dealId } : {}),
      order: await nextOrder(ctx), createdBy: who(me), createdAt: now, updatedAt: now, ...(it.done ? { doneAt: now, doneBy: who(me) } : {}),
    });
    await ctx.db.patch(l._id, { items: l.items.filter((i) => i.id !== a.itemId), updatedAt: now });
    return id;
  },
});

// ---------- Task templates (round 2) ----------

const tplItemArg = v.object({ id: v.string(), title: v.string(), from: v.union(v.literal("shoot"), v.literal("delivery")), days: v.number(), role: v.string(), audience: audArg, priority: prioArg });
export const templates = query({
  args: {},
  handler: async (ctx) => { await requireAll(ctx, "projects"); return (await ctx.db.query("taskTemplates").collect()).sort((a, b) => a.name.localeCompare(b.name)); },
});
export const saveTemplate = mutation({
  args: { templateId: v.optional(v.string()), name: v.string(), items: v.array(tplItemArg) },
  handler: async (ctx, a) => {
    await requireAll(ctx, "projects");
    const name = tidy(a.name, 80);
    if (!name) throw new ConvexError("Name the template.");
    if (a.items.length > 100) throw new ConvexError("A template holds up to 100 tasks.");
    const items = a.items.map((i) => ({ id: i.id.slice(0, 40), title: tidy(i.title, 300) || "Task", from: i.from, days: Math.round(Math.max(-365, Math.min(365, i.days))), role: tidy(i.role, 40) || "Owner", audience: i.audience, priority: i.priority }));
    const now = Date.now();
    if (a.templateId) { const id = ctx.db.normalizeId("taskTemplates", a.templateId); const t = id ? await ctx.db.get(id) : null; if (!t) throw new ConvexError("That template isn't here."); await ctx.db.patch(t._id, { name, items, updatedAt: now }); return t._id; }
    return await ctx.db.insert("taskTemplates", { name, items, createdAt: now, updatedAt: now });
  },
});
export const removeTemplate = mutation({
  args: { templateId: v.string() },
  handler: async (ctx, a) => { await requireAll(ctx, "projects"); const id = ctx.db.normalizeId("taskTemplates", a.templateId); if (id && (await ctx.db.get(id))) await ctx.db.delete(id); return null; },
});

/** Use a template on a project: each task's due date counts from the shoot day or the delivery day; each role gets the
 *  person picked; the client's and a vendor's tasks go to their portal (D199). */
export const useTemplate = mutation({
  args: {
    templateId: v.id("taskTemplates"), projectId: v.id("projects"), shootDay: v.optional(v.string()), deliveryDay: v.optional(v.string()),
    roles: v.array(v.object({ role: v.string(), email: v.optional(v.string()), name: v.optional(v.string()), vendorId: v.optional(v.id("vendors")) })),
  },
  handler: async (ctx, a) => {
    const me = await requireAll(ctx, "projects");
    const tpl = await ctx.db.get(a.templateId);
    const p = await ctx.db.get(a.projectId);
    if (!tpl || !p) throw new ConvexError("That template or project isn't here any more.");
    for (const d of [a.shootDay, a.deliveryDay]) if (d && !DAY.test(d)) throw new ConvexError("Pick the days.");
    const now = Date.now();
    let added = 0;
    for (const it of tpl.items) {
      const base = it.from === "shoot" ? a.shootDay : a.deliveryDay;
      const r = a.roles.find((x) => x.role === it.role);
      const due = base ? shift(base, it.days) : undefined;
      const assignee = r?.email ? { email: r.email.toLowerCase().slice(0, 200), ...(r.name ? { name: r.name.slice(0, 80) } : {}) } : undefined;
      if (it.audience === "vendor" && !r?.vendorId) continue; // no vendor picked for that role: left out (the summary says so)
      if (it.audience === "vendor" && r?.vendorId) await liveVendor(ctx, r.vendorId);
      await ctx.db.insert("tasks", {
        title: it.title, status: "todo", priority: it.priority, ...(due ? { due } : {}), projectId: p._id, audience: it.audience, ...(assignee ? { assignee, assigneeEmail: assignee.email } : {}),
        ...(it.audience === "vendor" && r?.vendorId ? { vendorId: r.vendorId } : {}), order: await nextOrder(ctx), createdBy: who(me), fromTemplate: tpl.name, createdAt: now, updatedAt: now,
      });
      added++;
    }
    return { added };
  },
});
const shift = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---------- Import from Todoist (D198): once, read only, assigned to whoever imports ----------

type TdProject = { id: string; name: string };
type TdTask = { id: string; content: string; description?: string; priority?: number; due?: { date?: string } | null; parent_id?: string | null; project_id: string; is_completed?: boolean };
async function td<T>(token: string, path: string): Promise<T> {
  if (!/^[A-Za-z0-9]{20,64}$/.test(token.trim())) throw new ConvexError("That isn't a Todoist API token.");
  const r = await fetch(`https://api.todoist.com/rest/v2/${path}`, { headers: { Authorization: `Bearer ${token.trim()}` } });
  if (r.status === 401 || r.status === 403) throw new ConvexError("Todoist didn't accept that token.");
  if (!r.ok) throw new ConvexError(`Todoist didn't answer (${r.status}). Try again.`);
  return (await r.json()) as T;
}

/** The token is used for this call only and never kept. */
export const todoistProjects = action({
  args: { token: v.string() },
  handler: async (ctx, a): Promise<TdProject[]> => {
    await ctx.runQuery(internal.users.assertAllowed, { perm: ["projects"] });
    return (await td<TdProject[]>(a.token, "projects")).map((p) => ({ id: String(p.id), name: String(p.name).slice(0, 120) }));
  },
});

export const todoistImport = action({
  args: { token: v.string(), picks: v.array(v.object({ id: v.string(), name: v.string(), home: homeArg })) },
  handler: async (ctx, a): Promise<{ added: number }> => {
    await ctx.runQuery(internal.users.assertAllowed, { perm: ["projects"] });
    if (a.picks.length > 50) throw new ConvexError("Pick up to 50 projects at a time.");
    let added = 0;
    for (const pk of a.picks) {
      const tasks = await td<TdTask[]>(a.token, `tasks?project_id=${encodeURIComponent(pk.id)}`);
      const rows = tasks.slice(0, 1000).map((t) => ({ id: String(t.id), parent: t.parent_id ? String(t.parent_id) : null, title: String(t.content ?? "").slice(0, 300), notes: String(t.description ?? "").slice(0, 10_000), due: t.due?.date && DAY.test(t.due.date.slice(0, 10)) ? t.due.date.slice(0, 10) : null, priority: t.priority === 4 ? "high" as const : t.priority === 1 ? "low" as const : "normal" as const }));
      added += await ctx.runMutation(internal.work.importRows, { home: pk.home ?? null, rows, from: pk.name.slice(0, 120) });
    }
    return { added };
  },
});

export const importRows = internalMutation({
  args: { home: homeArg, from: v.string(), rows: v.array(v.object({ id: v.string(), parent: v.union(v.string(), v.null()), title: v.string(), notes: v.string(), due: v.union(v.string(), v.null()), priority: prioArg })) },
  handler: async (ctx, a) => {
    const me = await requireAll(ctx, "projects");
    const home = await homeFields(ctx, a.home);
    const now = Date.now();
    const made = new Map<string, Id<"tasks">>();
    const assignee = { email: me.email.toLowerCase(), name: who(me) };
    // Parents first, so subtasks find them.
    const sorted = [...a.rows.filter((r) => !r.parent), ...a.rows.filter((r) => r.parent)];
    for (const r of sorted) {
      const parentId = r.parent ? made.get(r.parent) : undefined;
      const id = await ctx.db.insert("tasks", {
        title: r.title || "Task", ...(r.notes ? { notes: r.notes } : {}), status: "todo", priority: r.priority, ...(r.due ? { due: r.due } : {}), ...home, audience: "team",
        assignee, assigneeEmail: assignee.email, ...(parentId ? { parentId } : {}), order: await nextOrder(ctx), createdBy: who(me), fromTemplate: `Todoist: ${a.from}`, createdAt: now, updatedAt: now,
      });
      made.set(r.id, id);
    }
    return made.size;
  },
});
