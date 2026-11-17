// 5m Work (D197–D200; Design Log "Handoff ready: Work" rounds 1 and 2): My tasks, All tasks (Table · List · Board by
// status · Board by project stage · Calendar), a task open in the side panel, To-do lists, Templates (and Use a template
// on a project), Import from Todoist, the project page's Tasks tab, and the client's and a vendor's tasks with Done.
import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { Modal, useConfirm, useToast } from "../../ui/kit";
import { Button, Card, DialogHeader, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows, StatusChip, TextField, TextArea } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { errLine } from "../../ui/hold";
import { AttachDialog } from "../projects/Homes";
import { HomeSelect, HomeTag } from "../creative/parts";

import { usePerms } from "../../lib/teamAccess";

type Task = NonNullable<ReturnType<typeof useAllTasks>>["tasks"][number];
type Status = "todo" | "doing" | "waiting" | "done";
type Prio = "high" | "normal" | "low";
const useAllTasks = () => useQuery(api.work.all);
const STATUS: Record<Status, { label: string; tone: "neutral" | "accent" | "warning" | "success" }> = { todo: { label: "To do", tone: "neutral" }, doing: { label: "In progress", tone: "accent" }, waiting: { label: "Waiting", tone: "warning" }, done: { label: "Done", tone: "success" } };
const PRIO: Record<Prio, string> = { high: "High", normal: "Normal", low: "Low" };
const STAGES = [["pre", "Pre-pro"], ["prin", "Prin-pro"], ["post", "Post-pro"], ["delivery", "Delivery"]] as const;
const REPEAT_LABEL = (r: Task["repeat"]) => (!r ? "Doesn’t repeat" : r.after ? `Again ${r.every === "day" ? "a day" : r.every === "week" ? "a week" : "a month"} after it’s done` : `Every ${r.every}`);
const dayText = (d: string, today?: string) => {
  if (today && d === today) return "Today";
  const dt = new Date(`${d}T12:00:00Z`);
  return dt.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "numeric", day: "numeric" });
};
const plusDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const crumbs = (here: string) => <TopBar><a {...linkProps("/work")}>Work</a><Sep /><span className="here">{here}</span></TopBar>;

function Flag({ p }: { p: Prio }) { return p === "normal" ? null : <span className={`wk-flag ${p}`} title={`${PRIO[p]} priority`}><Icon name="flag" size={14} /></span>; }
function Tick({ done, onToggle, label }: { done: boolean; onToggle: () => void; label: string }) {
  return <button type="button" className={`wk-tick${done ? " on" : ""}`} aria-pressed={done} aria-label={label} onClick={(e) => { e.stopPropagation(); onToggle(); }}>{done && <Icon name="check" size={14} plain />}</button>;
}
function Who({ t }: { t: Task }) {
  return <span className="wk-who">{t.audience === "client" ? <StatusChip tone="accent">For the client</StatusChip> : t.audience === "vendor" ? <StatusChip tone="accent">For {t.vendor?.name ?? "the vendor"}</StatusChip> : null}</span>;
}
function Meta({ t, today }: { t: Task; today: string }) {
  const late = t.due && t.due < today && t.status !== "done";
  return (
    <span className="wk-meta">
      {t.due && <span className={late ? "late" : ""}>{dayText(t.due, today)}</span>}
      {t.assignee && <span>{t.assignee.name ?? t.assignee.email}</span>}
      {t.subtasks.total > 0 && <span>{t.subtasks.done}/{t.subtasks.total} subtasks</span>}
      {t.checklist.total > 0 && <span>{t.checklist.done}/{t.checklist.total}</span>}
      {t.repeat && <span title={REPEAT_LABEL(t.repeat)}><Icon name="repeat" size={12} /></span>}
    </span>
  );
}

// ---------- My tasks (1086-38218) ----------

export function MyTasks() {
  const d = useQuery(api.work.mine);
  const create = useMutation(api.work.create);
  const done = useMutation(api.work.done);
  const [toast, show] = useToast();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const today = d?.today ?? "";
  const groups = useMemo(() => {
    const ts = (d?.tasks ?? []).filter((t) => t.status !== "done").sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
    const end = plusDays(today, 7 - new Date(`${today}T12:00:00Z`).getUTCDay());
    return [
      { k: "Overdue", ts: ts.filter((t) => t.due && t.due < today) },
      { k: "Today", ts: ts.filter((t) => t.due === today) },
      { k: "This week", ts: ts.filter((t) => t.due && t.due > today && t.due < end) },
      { k: "Later", ts: ts.filter((t) => !t.due || t.due >= end) },
      { k: "Done lately", ts: (d?.tasks ?? []).filter((t) => t.status === "done") },
    ].filter((g) => g.ts.length);
  }, [d, today]);
  const add = async () => { if (!q.trim()) return; try { await create({ title: q, mine: true }); setQ(""); } catch (e) { show(errLine(e)); } };
  return (
    <>
      {crumbs("My tasks")}
      <div className="wp-page">
        <PageHeader eyebrow="Work" title="My tasks" sub="Everything given to you, from every project, shoot and client. Tasks for clients and vendors are in All tasks." />
        <form className="wk-quick glass" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <Icon name="plus" size={18} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a task for yourself, then press Enter" aria-label="Quick add" />
        </form>
        {d === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card> : groups.length === 0 ? <div className="wp-tablecard glass"><EmptyState icon="work" title="Nothing on your list." body="Tasks given to you show up here." /></div>
          : groups.map((g) => (
            <Card key={g.k} label={g.k} head={<SectionHead label={g.k} count={g.ts.length} />}>
              {g.ts.map((t, i) => (
                <div key={t._id} className="wp-rowwrap">{i > 0 && <Divider />}
                  <SwipeRow onDone={() => void done({ taskId: t._id, done: t.status !== "done" }).catch((e) => show(errLine(e)))}>
                    <div className={`wk-row${t.status === "done" ? " done" : ""}`} role="button" tabIndex={0} onClick={() => setOpen(t._id)} onKeyDown={(e) => { if (e.key === "Enter") setOpen(t._id); }}>
                      <Tick done={t.status === "done"} label={`Done: ${t.title}`} onToggle={() => void done({ taskId: t._id, done: t.status !== "done" }).catch((e) => show(errLine(e)))} />
                      <span className="t"><span className="ttl">{t.title}<Flag p={t.priority} /></span><Meta t={t} today={today} /></span>
                      <span className="hide-sm"><HomeTag home={t.home} /></span>
                      {t.status !== "todo" && t.status !== "done" && <StatusChip tone={STATUS[t.status].tone}>{STATUS[t.status].label}</StatusChip>}
                    </div>
                  </SwipeRow>
                </div>
              ))}
            </Card>
          ))}
        <p className="secondary wp-small ph-only">Swipe a task to finish it. Tap to open it.</p>
      </div>
      {open && <TaskPanel taskId={open} onClose={() => setOpen(null)} show={show} />}
      {toast}
    </>
  );
}

/** Phone: swipe a task left to reveal Done (1089-39828). */
function SwipeRow({ children, onDone }: { children: React.ReactNode; onDone: () => void }) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  return (
    <div className="wk-swipe" onTouchStart={(e) => { start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchMove={(e) => { if (!start.current) return; const x = e.touches[0].clientX - start.current.x, y = e.touches[0].clientY - start.current.y; if (Math.abs(y) > Math.abs(x)) return; setDx(Math.max(-96, Math.min(0, x))); }}
      onTouchEnd={() => { if (dx < -72) onDone(); setDx(0); start.current = null; }}>
      <span className="wk-swipedone" style={{ opacity: Math.min(1, -dx / 72) }}><Icon name="check" size={18} plain />Done</span>
      <div style={{ transform: `translateX(${dx}px)`, transition: dx === 0 ? "transform 140ms ease-out" : "none" }}>{children}</div>
    </div>
  );
}

// ---------- All tasks (Table · List · Board · Calendar) ----------

type View = "table" | "list" | "status" | "stage" | "calendar";
export function AllTasks() {
  const d = useAllTasks();
  const done = useMutation(api.work.done);
  const placeM = useMutation(api.work.place);
  const create = useMutation(api.work.create);
  const [toast, show] = useToast();
  const params = new URLSearchParams(location.search);
  const [view, setViewRaw] = useState<View>(() => { try { return (localStorage.getItem("wk-view") as View) || "table"; } catch { return "table"; } });
  const setView = (v: View) => { setViewRaw(v); try { localStorage.setItem("wk-view", v); } catch { /* fine */ } };
  const [open, setOpen] = useState<string | null>(params.get("task"));
  const [f, setF] = useState<"all" | "open" | "client" | "vendor" | "loose">("open");
  const [importing, setImporting] = useState(false);
  const today = d?.today ?? "";
  const ts = (d?.tasks ?? []).filter((t) => f === "all" || (f === "open" ? t.status !== "done" : f === "client" ? t.audience === "client" : f === "vendor" ? t.audience === "vendor" : !t.home));
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; name: string; home: { type: "client" | "project" | "shoot" | "lead"; id: string } | null; ts: Task[] }>();
    for (const t of ts) {
      const key = t.project ? `p:${t.project._id}` : t.home ? `${t.home.type}:${t.home.id}` : "none";
      const g = m.get(key) ?? { key, name: t.project?.label ?? t.home?.name ?? "Not attached", home: t.project ? { type: "project" as const, id: t.project._id } : t.home ? { type: t.home.type as "client", id: t.home.id } : null, ts: [] };
      g.ts.push(t); m.set(key, g);
    }
    return [...m.values()].sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : a.name.localeCompare(b.name)));
  }, [ts]);
  const toggle = (t: Task) => void done({ taskId: t._id, done: t.status !== "done" }).catch((e) => show(errLine(e)));
  const addTo = async (home: { type: "client" | "project" | "shoot" | "lead"; id: string } | null, title: string) => { try { await create({ title, home }); } catch (e) { show(errLine(e)); } };
  return (
    <>
      {crumbs("All tasks")}
      <div className="wp-page wk-page">
        <PageHeader eyebrow="Work" title="All tasks" sub="Every task in the business. Group, sort and filter; click a row to open it." actions={<><Button onClick={() => setImporting(true)}>Import from Todoist</Button><Button variant="primary" icon="plus" onClick={() => void create({ title: "New task" }).then((id) => setOpen(id), (e) => show(errLine(e)))}>New task</Button></>} />
        <div className="wk-bar">
          <PillTabs label="View" value={view} onChange={setView} items={[{ key: "table", label: "Table" }, { key: "list", label: "List" }, { key: "status", label: "Board" }, { key: "stage", label: "By stage" }, { key: "calendar", label: "Calendar" }]} />
          <select className="input sm" value={f} onChange={(e) => setF(e.target.value as typeof f)} aria-label="Filter">
            <option value="open">Open</option><option value="all">All (and done in the last 30 days)</option><option value="client">For the client</option><option value="vendor">For a vendor</option><option value="loose">Not attached</option>
          </select>
        </div>
        {d === undefined ? <Card label="Loading"><SkeletonRows n={5} /></Card>
          : view === "table" ? <TableView groups={groups} today={today} onOpen={setOpen} onToggle={toggle} onAdd={addTo} />
          : view === "list" ? <ListView groups={groups} today={today} onOpen={setOpen} onToggle={toggle} onAdd={addTo} />
          : view === "status" ? <StatusBoard ts={ts} today={today} onOpen={setOpen} onMove={(id, status) => void placeM({ taskId: id, status }).catch((e) => show(errLine(e)))} />
          : view === "stage" ? <StageBoard ts={ts} today={today} onOpen={setOpen} show={show} />
          : <CalendarView ts={ts} today={today} onOpen={setOpen} onMove={(id, due) => void placeM({ taskId: id, due }).catch((e) => show(errLine(e)))} />}
      </div>
      {open && <TaskPanel taskId={open} onClose={() => setOpen(null)} show={show} />}
      {importing && <TodoistImport onClose={() => setImporting(false)} show={show} />}
      {toast}
    </>
  );
}
type Group = { key: string; name: string; home: { type: "client" | "project" | "shoot" | "lead"; id: string } | null; ts: Task[] };

function AddRow({ onAdd, label = "Add a task" }: { onAdd: (title: string) => void | Promise<void>; label?: string }) {
  const [on, setOn] = useState(false), [t, setT] = useState("");
  return on ? <form className="wk-addrow" onSubmit={(e) => { e.preventDefault(); if (t.trim()) { void onAdd(t); setT(""); } }}><input className="input" autoFocus value={t} onChange={(e) => setT(e.target.value)} onBlur={() => { if (!t.trim()) setOn(false); }} placeholder="Task name, then Enter" aria-label={label} /></form>
    : <button type="button" className="rt-add wk-add" onClick={() => setOn(true)}><Icon name="plus" size={14} />{label}</button>;
}

function TableView({ groups, today, onOpen, onToggle, onAdd }: { groups: Group[]; today: string; onOpen: (id: string) => void; onToggle: (t: Task) => void; onAdd: (h: Group["home"], title: string) => void }) {
  if (!groups.length) return <div className="wp-tablecard glass"><EmptyState icon="work" title="No tasks here." /></div>;
  return (
    <div className="wk-groups">
      {groups.map((g) => (
        <div key={g.key} className="wp-tablecard glass wk-table">
          <div className="wk-ghead"><b>{g.name}</b><span className="secondary">{g.ts.length}</span></div>
          <table>
            <thead><tr><th>Task</th><th className="hide-sm">Assignee</th><th>Due</th><th className="hide-sm">Status</th><th className="hide-sm">Priority</th><th className="hide-sm">Repeat</th></tr></thead>
            <tbody>{g.ts.map((t) => (
              <tr key={t._id} className={t.status === "done" ? "done" : ""} onClick={() => onOpen(t._id)}>
                <td><span className="wk-cell"><Tick done={t.status === "done"} label={`Done: ${t.title}`} onToggle={() => onToggle(t)} /><span className="ttl">{t.title}</span><Who t={t} />{t.subtasks.total > 0 && <span className="secondary wp-small">{t.subtasks.done}/{t.subtasks.total}</span>}</span></td>
                <td className="hide-sm">{t.assignee?.name ?? t.assignee?.email ?? <span className="secondary">—</span>}</td>
                <td className={t.due && t.due < today && t.status !== "done" ? "late" : ""}>{t.due ? dayText(t.due, today) : <span className="secondary">—</span>}</td>
                <td className="hide-sm"><StatusChip tone={STATUS[t.status].tone}>{STATUS[t.status].label}</StatusChip></td>
                <td className="hide-sm">{PRIO[t.priority]}</td>
                <td className="hide-sm">{t.repeat ? <Icon name="repeat" size={14} /> : ""}</td>
              </tr>
            ))}</tbody>
          </table>
          <AddRow onAdd={(title) => onAdd(g.home, title)} />
        </div>
      ))}
    </div>
  );
}

function ListView({ groups, today, onOpen, onToggle, onAdd }: { groups: Group[]; today: string; onOpen: (id: string) => void; onToggle: (t: Task) => void; onAdd: (h: Group["home"], title: string) => void }) {
  if (!groups.length) return <div className="wp-tablecard glass"><EmptyState icon="work" title="No tasks here." /></div>;
  return (
    <div className="wk-lists">
      {groups.map((g) => (
        <Card key={g.key} label={g.name} head={<SectionHead label={g.name} count={g.ts.length} />}>
          {g.ts.map((t) => <div key={t._id} className={`wk-row slim${t.status === "done" ? " done" : ""}`} role="button" tabIndex={0} onClick={() => onOpen(t._id)}><Tick done={t.status === "done"} label={`Done: ${t.title}`} onToggle={() => onToggle(t)} /><span className="t"><span className="ttl">{t.title}<Flag p={t.priority} /></span></span>{t.due && <span className={`wp-small ${t.due < today && t.status !== "done" ? "late" : "secondary"}`}>{dayText(t.due, today)}</span>}</div>)}
          <AddRow onAdd={(title) => onAdd(g.home, title)} />
        </Card>
      ))}
    </div>
  );
}

function Card2({ t, today, onOpen, drag }: { t: Task; today: string; onOpen: (id: string) => void; drag?: boolean }) {
  return (
    <div className={`wk-card glass${t.status === "done" ? " done" : ""}`} draggable={drag} onDragStart={(e) => { e.dataTransfer.setData("text/task", t._id); e.dataTransfer.effectAllowed = "move"; }} onClick={() => onOpen(t._id)} role="button" tabIndex={0}>
      <span className="ttl">{t.title}<Flag p={t.priority} /></span>
      {t.home && <HomeTag home={t.home} />}
      <Meta t={t} today={today} />
      <Who t={t} />
    </div>
  );
}

function StatusBoard({ ts, today, onOpen, onMove }: { ts: Task[]; today: string; onOpen: (id: string) => void; onMove: (id: string, s: Status) => void }) {
  const [over, setOver] = useState<Status | null>(null);
  const weekAgo = Date.now() - 7 * 86_400_000;
  return (
    <div className="wk-board">
      {(["todo", "doing", "waiting", "done"] as Status[]).map((s) => {
        const col = ts.filter((t) => t.status === s && (s !== "done" || (t.doneAt ?? 0) > weekAgo));
        return (
          <div key={s} className={`wk-col${over === s ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/task"); if (id) onMove(id, s); }}>
            <div className="wk-colhead"><b>{STATUS[s].label}{s === "done" ? " (last 7 days)" : ""}</b><span className="secondary">{col.length}</span></div>
            {col.map((t) => <Card2 key={t._id} t={t} today={today} onOpen={onOpen} drag />)}
            {over === s && <div className="wk-drop" />}
          </div>
        );
      })}
    </div>
  );
}

/** Board by project stage: a card can't move between stages (the stage belongs to the project). */
function StageBoard({ ts, today, onOpen, show }: { ts: Task[]; today: string; onOpen: (id: string) => void; show: (t: string) => void }) {
  return (
    <>
      <p className="secondary wp-small">Tasks with no project don’t show here.</p>
      <div className="wk-board">
        {STAGES.map(([k, name]) => {
          const col = ts.filter((t) => t.project?.stage === k);
          return (
            <div key={k} className="wk-col" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); show("Stage belongs to the project. Change it on the project."); }}>
              <div className="wk-colhead"><b>{name}</b><span className="secondary">{col.length}</span></div>
              {col.map((t) => <div key={t._id}><Card2 t={t} today={today} onOpen={onOpen} drag /><span className="wk-cardstatus"><StatusChip tone={STATUS[t.status].tone}>{STATUS[t.status].label}</StatusChip></span></div>)}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Calendar (1092-39823): a month, week starting Sunday; drag a task to another day to change its due date. */
function CalendarView({ ts, today, onOpen, onMove }: { ts: Task[]; today: string; onOpen: (id: string) => void; onMove: (id: string, due: string) => void }) {
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [over, setOver] = useState<string | null>(null);
  const first = new Date(`${month}-01T12:00:00Z`);
  const start = plusDays(`${month}-01`, -first.getUTCDay());
  const days = Array.from({ length: 42 }, (_, i) => plusDays(start, i));
  const shift = (n: number) => { const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  // A repeating task's next time, faded.
  const nextOf = (t: Task) => (t.repeat && t.due && !t.repeat.after && t.status !== "done" ? plusDays(t.due, t.repeat.every === "day" ? 1 : t.repeat.every === "week" ? 7 : 30) : null);
  return (
    <div className="wk-cal glass">
      <div className="wk-calhead"><button className="icon-btn sm" aria-label="Previous month" onClick={() => shift(-1)}><Icon name="arrow-left" size={16} /></button><b>{first.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" })}</b><button className="icon-btn sm" aria-label="Next month" onClick={() => shift(1)}><Icon name="arrow-right" size={16} /></button><span className="sp" /><span className="secondary wp-small hide-sm">Drag a task to another day to change its due date. A repeating task shows its next time faded.</span></div>
      <div className="wk-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <span key={d} className="wk-dow">{d}</span>)}
        {days.map((d) => {
          const here = ts.filter((t) => t.due === d), ghosts = ts.filter((t) => nextOf(t) === d);
          return (
            <div key={d} className={`wk-day${d === today ? " today" : ""}${d.slice(0, 7) !== month ? " out" : ""}${over === d ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(d); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/task"); if (id) onMove(id, d); }}>
              <span className="n">{Number(d.slice(8))}</span>
              {here.map((t) => <button key={t._id} draggable onDragStart={(e) => e.dataTransfer.setData("text/task", t._id)} className={`wk-chip${t.status === "done" ? " done" : t.due! < today ? " late" : ""}`} onClick={() => onOpen(t._id)}>{t.title}</button>)}
              {ghosts.map((t) => <span key={`g${t._id}`} className="wk-chip ghost">{t.title}</span>)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- a task open (1088-39904) ----------

export function TaskPanel({ taskId, onClose, show }: { taskId: string; onClose: () => void; show: (t: string) => void }) {
  const t = useQuery(api.work.get, { taskId });
  const { perms } = usePerms();
  const people = useQuery(api.work.people, perms.projects ? { taskId } : "skip");
  const update = useMutation(api.work.update);
  const done = useMutation(api.work.done);
  const create = useMutation(api.work.create);
  const remove = useMutation(api.work.remove);
  const [ask, confirmNode] = useConfirm();
  const [moving, setMoving] = useState(false);
  const [title, setTitle] = useState(""), [notes, setNotes] = useState("");
  const [sub, setSub] = useState(""), [check, setCheck] = useState("");
  const loaded = useRef<string | null>(null);
  useEffect(() => { if (t && loaded.current !== t._id) { loaded.current = t._id; setTitle(t.title); setNotes(t.notes); } }, [t]);
  // Saves as you type (a short pause).
  useEffect(() => { if (!t || loaded.current !== t._id || (title === t.title && notes === t.notes) || !title.trim()) return; const h = window.setTimeout(() => void update({ taskId, ...(title !== t.title ? { title } : {}), ...(notes !== t.notes ? { notes } : {}) }).catch((e) => show(errLine(e))), 600); return () => clearTimeout(h); }, [title, notes]); // eslint-disable-line react-hooks/exhaustive-deps
  const up = (p: Parameters<typeof update>[0] extends infer A ? Omit<A & object, "taskId"> : never) => void update({ taskId, ...p }).catch((e) => show(errLine(e)));
  const canEdit = perms.projects;
  return (
    <Modal onClose={onClose} label="Task" width={560} slideOut>
      {t === undefined ? <SkeletonRows n={5} /> : t === null ? <EmptyState icon="work" title="This task isn't here any more." /> : (
        <div className="wk-panel">
          <div className="wk-panelhead">
            <Button variant={t.status === "done" ? "secondary" : "primary"} size="sm" icon="check" onClick={() => void done({ taskId, done: t.status !== "done" }).then((r) => { if (r.next) show("Done. The next one is on the list."); }, (e) => show(errLine(e)))}>{t.status === "done" ? "Done ✓" : "Mark done"}</Button>
            <span className="sp" />
            {canEdit && <button className="icon-btn sm" aria-label="Delete task" onClick={async () => { if (await ask({ title: "Delete this task?", body: t.subs.length ? "Its subtasks go too." : undefined, yes: "Delete", danger: true })) { try { await remove({ taskId }); onClose(); } catch (e) { show(errLine(e)); } } }}><Icon name="close" size={16} /></button>}
            <button className="icon-btn sm" aria-label="Close" onClick={onClose}><Icon name="arrow-right" size={16} /></button>
          </div>
          <textarea className="wk-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} rows={1} aria-label="Title" />
          <dl className="wk-fields">
            <dt>Home</dt><dd>{t.parentId ? <span className="secondary">With its task</span> : <HomeTag home={t.home} onMove={canEdit ? () => setMoving(true) : undefined} />}</dd>
            <dt>Assignee</dt><dd>{canEdit && people ? <select className="input sm" value={t.assignee?.email ?? ""} onChange={(e) => { const v = e.target.value; const p = [...people.team, ...people.client.map((c) => ({ email: c.email, name: c.email }))].find((x) => x.email === v); up({ assignee: v ? { email: v, ...(p?.name && p.name !== v ? { name: p.name } : {}) } : null }); }}>
              <option value="">No one</option>
              <optgroup label="Team">{people.team.map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}</optgroup>
              {people.client.length > 0 && <optgroup label="Client">{people.client.map((p) => <option key={p.email} value={p.email}>{p.email}</option>)}</optgroup>}
            </select> : t.assignee?.name ?? t.assignee?.email ?? "No one"}</dd>
            <dt>Due</dt><dd><input type="date" className="input sm" value={t.due ?? ""} disabled={!canEdit} onChange={(e) => up({ due: e.target.value || null })} /></dd>
            <dt>Status</dt><dd><select className="input sm" value={t.status} onChange={(e) => up({ status: e.target.value as Status })}>{(Object.keys(STATUS) as Status[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}</select></dd>
            <dt>Priority</dt><dd><select className="input sm" value={t.priority} disabled={!canEdit} onChange={(e) => up({ priority: e.target.value as Prio })}>{(Object.keys(PRIO) as Prio[]).map((p) => <option key={p} value={p}>{PRIO[p]}</option>)}</select></dd>
            <dt>Repeat</dt><dd><select className="input sm" disabled={!canEdit} value={t.repeat ? `${t.repeat.every}:${t.repeat.after ? 1 : 0}` : ""} onChange={(e) => { const [every, after] = e.target.value.split(":"); up({ repeat: e.target.value ? { every: every as "day", after: after === "1" } : null }); }}>
              <option value="">Doesn’t repeat</option><option value="day:0">Every day</option><option value="week:0">Every week</option><option value="month:0">Every month</option>
              <option value="day:1">Again a day after it’s done</option><option value="week:1">Again a week after it’s done</option><option value="month:1">Again a month after it’s done</option>
            </select></dd>
            {!t.parentId && <><dt>Who sees it</dt><dd className="wk-aud">
              <select className="input sm" disabled={!canEdit} value={t.audience} onChange={(e) => { const v = e.target.value as "team" | "client" | "vendor"; if (v === "vendor" && !t.vendor) { const first = people?.vendors[0]; if (!first) { show("Add a vendor first."); return; } up({ audience: v, vendorId: first._id as Id<"vendors"> }); } else up({ audience: v }); }}>
                <option value="team">Only the team</option><option value="client">For the client</option><option value="vendor">For a vendor</option>
              </select>
              {t.audience === "vendor" && people && <select className="input sm" value={t.vendor?._id ?? ""} onChange={(e) => up({ vendorId: e.target.value as Id<"vendors"> })}>{people.vendors.map((x) => <option key={x._id} value={x._id}>{x.name}{x.booked ? " (booked)" : ""}</option>)}</select>}
            </dd></>}
          </dl>
          {!t.parentId && <p className="secondary wp-small">“For the client” or “For a vendor” shows the task in their portal with a Done button. Notes stay with the team.</p>}
          <TextArea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} compact />
          {!t.parentId && <div className="wk-sec"><span className="wp-field-label">Subtasks</span>
            {t.subs.map((s) => <div key={s._id} className={`wk-row slim${s.status === "done" ? " done" : ""}`}><Tick done={s.status === "done"} label={`Done: ${s.title}`} onToggle={() => void done({ taskId: s._id, done: s.status !== "done" })} /><span className="t"><span className="ttl">{s.title}</span></span>{s.assignee && <span className="secondary wp-small">{s.assignee.name ?? s.assignee.email}</span>}</div>)}
            {canEdit && <form className="wk-addrow" onSubmit={(e) => { e.preventDefault(); if (sub.trim()) void create({ title: sub, parentId: t._id as Id<"tasks"> }).then(() => setSub(""), (er) => show(errLine(er))); }}><input className="input" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Add a subtask" aria-label="Add a subtask" /></form>}
          </div>}
          <div className="wk-sec"><span className="wp-field-label">Checklist</span>
            {t.checklist.map((c) => <div key={c.id} className={`wk-row slim${c.done ? " done" : ""}`}><Tick done={c.done} label={c.text} onToggle={() => up({ checklist: t.checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)) })} /><span className="t"><span className="ttl">{c.text}</span></span>{canEdit && <button className="icon-btn sm" aria-label="Remove" onClick={() => up({ checklist: t.checklist.filter((x) => x.id !== c.id) })}><Icon name="close" size={12} /></button>}</div>)}
            <form className="wk-addrow" onSubmit={(e) => { e.preventDefault(); if (check.trim()) { up({ checklist: [...t.checklist, { id: uid(), text: check.trim(), done: false }] }); setCheck(""); } }}><input className="input" value={check} onChange={(e) => setCheck(e.target.value)} placeholder="Add an item" aria-label="Add a checklist item" /></form>
          </div>
          {t.doneAt && <p className="secondary wp-small">Done {new Date(t.doneAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{t.doneBy ? ` by ${t.doneBy}` : ""}.</p>}
        </div>
      )}
      {moving && t && <AttachDialog kind="task" id={t._id} name={t.title} hasHome={!!t.home} onClose={() => setMoving(false)} show={show} />}
      {confirmNode}
    </Modal>
  );
}

// ---------- To-do lists (1092-40433) ----------

export function TodoLists() {
  const lists = useQuery(api.work.lists);
  const createL = useMutation(api.work.createList);
  const save = useMutation(api.work.saveList);
  const dup = useMutation(api.work.duplicateList);
  const removeL = useMutation(api.work.removeList);
  const toTask = useMutation(api.work.itemToTask);
  const [toast, show] = useToast();
  const [ask, confirmNode] = useConfirm();
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(location.search).get("list"));
  const [making, setMaking] = useState(false);
  const [moving, setMoving] = useState(false);
  const [menu, setMenu] = useState(false);
  const [text, setText] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const open = (lists ?? []).find((l) => l._id === openId) ?? (lists ?? [])[0];
  const setItems = (items: Array<{ id: string; text: string; done: boolean }>) => open && void save({ listId: open._id, items }).catch((e) => show(errLine(e)));
  return (
    <>
      {crumbs("To-do lists")}
      <div className="wp-page">
        <PageHeader eyebrow="Work" title="To-do lists" sub="Quick lists of things to tick off. No dates or owners; turn an item into a task when it needs them." actions={<Button variant="primary" icon="plus" onClick={() => setMaking(true)}>New list</Button>} />
        {lists === undefined ? <Card label="Loading"><SkeletonRows n={3} /></Card> : lists.length === 0 ? <div className="wp-tablecard glass"><EmptyState icon="check-circle" title="No lists yet." actions={<Button variant="primary" onClick={() => setMaking(true)}>New list</Button>} /></div> : (
          <div className="wk-two">
            <div className="wp-tablecard glass">{lists.map((l) => <ListRow key={l._id} lead={{ icon: "check-circle" }} title={l.name} meta={`${l.items.filter((i) => !i.done).length} to do · ${l.items.filter((i) => i.done).length} done`} trailing={<HomeTag home={l.home} />} selected={open?._id === l._id} onClick={() => setOpenId(l._id)} />)}</div>
            {open && <Card label={open.name} head={<div className="cr-head"><b>{open.name}</b><span className="sp" /><HomeTag home={open.home} /><button className="icon-btn sm" aria-label="List options" onClick={() => setMenu(!menu)}><Icon name="more" size={16} /></button></div>}>
              {menu && <div className="wk-menu glass" role="menu">
                <button role="menuitem" onClick={() => { setMenu(false); setRenaming(open.name); }}>Rename</button>
                <button role="menuitem" onClick={() => { setMenu(false); setMoving(true); }}>Move to…</button>
                <button role="menuitem" onClick={() => { setMenu(false); void dup({ listId: open._id }).then((id) => setOpenId(id)); }}>Duplicate</button>
                <button role="menuitem" onClick={() => { setMenu(false); setItems(open.items.filter((i) => !i.done)); }}>Clear done</button>
                <button role="menuitem" className="danger" onClick={async () => { setMenu(false); if (await ask({ title: `Delete ${open.name}?`, yes: "Delete", danger: true })) void removeL({ listId: open._id }).then(() => setOpenId(null)); }}>Delete</button>
              </div>}
              <div className="cr-pad">
                {open.items.map((i) => (
                  <div key={i.id} className={`wk-row slim todo${i.done ? " done" : ""}`}>
                    <Tick done={i.done} label={i.text} onToggle={() => setItems(open.items.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)))} />
                    <span className="t"><span className="ttl">{i.text}</span></span>
                    <button className="btn ghost sm wk-totask" onClick={() => void toTask({ listId: open._id, itemId: i.id }).then(() => show("Turned into a task. It's in All tasks."), (e) => show(errLine(e)))}>Turn into a task</button>
                    <button className="icon-btn sm" aria-label="Remove" onClick={() => setItems(open.items.filter((x) => x.id !== i.id))}><Icon name="close" size={12} /></button>
                  </div>
                ))}
                <form className="wk-addrow" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { setItems([...open.items, { id: uid(), text: text.trim(), done: false }]); setText(""); } }}><input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an item, then Enter" aria-label="Add an item" /></form>
              </div>
            </Card>}
          </div>
        )}
      </div>
      {making && <NewList onClose={() => setMaking(false)} onMade={(id) => { setMaking(false); setOpenId(id); }} create={createL} show={show} />}
      {renaming !== null && open && <Modal onClose={() => setRenaming(null)} label="Rename" width={440}><form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void save({ listId: open._id, name: renaming }).then(() => setRenaming(null), (er) => show(errLine(er))); }}>
        <DialogHeader title="Rename the list" onClose={() => setRenaming(null)} /><TextField label="Name" value={renaming} onChange={(e) => setRenaming(e.target.value)} autoFocus />
        <div className="dfoot"><button type="button" className="btn ghost" onClick={() => setRenaming(null)}>Cancel</button><Button variant="primary" type="submit" disabled={!renaming.trim()}>Save</Button></div></form></Modal>}
      {moving && open && <AttachDialog kind="todoList" id={open._id} name={open.name} hasHome={!!open.home} onClose={() => setMoving(false)} show={show} />}
      {confirmNode}{toast}
    </>
  );
}
function NewList({ onClose, onMade, create, show }: { onClose: () => void; onMade: (id: string) => void; create: ReturnType<typeof useMutation<typeof api.work.createList>>; show: (t: string) => void }) {
  const [name, setName] = useState(""), [home, setHome] = useState<{ type: "client" | "project" | "shoot" | "lead"; id: string } | null>(null);
  return (
    <Modal onClose={onClose} label="New list" width={480}>
      <form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void create({ name, home }).then(onMade, (er) => show(errLine(er))); }}>
        <DialogHeader title="New to-do list" onClose={onClose} />
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shoot day packing" autoFocus />
        <HomeSelect kind="todoList" value={home} onChange={setHome} />
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" type="submit">Make it</Button></div>
      </form>
    </Modal>
  );
}

// ---------- Templates (1093-40299) and Use a template (1093-40898) ----------

type TplItem = { id: string; title: string; from: "shoot" | "delivery"; days: number; role: string; audience: "team" | "client" | "vendor"; priority: Prio };
const SECTIONS: Array<{ k: string; label: string; test: (i: TplItem) => boolean }> = [
  { k: "before", label: "Before the shoot", test: (i) => i.from === "shoot" && i.days < 0 },
  { k: "day", label: "Shoot day", test: (i) => i.from === "shoot" && i.days >= 0 },
  { k: "after", label: "After the shoot", test: (i) => i.from === "delivery" },
];
const whenText = (i: TplItem) => (i.days === 0 ? `On the ${i.from} day` : `${Math.abs(i.days)} day${Math.abs(i.days) === 1 ? "" : "s"} ${i.days < 0 ? "before" : "after"} the ${i.from} day`);

export function Templates() {
  const list = useQuery(api.work.templates);
  const save = useMutation(api.work.saveTemplate);
  const removeT = useMutation(api.work.removeTemplate);
  const [toast, show] = useToast();
  const [edit, setEdit] = useState<{ _id?: string; name: string; items: TplItem[] } | null>(null);
  const [using, setUsing] = useState<string | null>(null);
  return (
    <>
      {crumbs("Templates")}
      <div className="wp-page">
        <PageHeader eyebrow="Work" title="Templates" sub="“When” counts from the project’s shoot day or delivery day. “Who” is a role; you pick the person when you use the template." actions={<Button variant="primary" icon="plus" onClick={() => setEdit({ name: "", items: [] })}>New template</Button>} />
        {edit ? <TemplateEditor tpl={edit} onCancel={() => setEdit(null)} onSave={async (t) => { try { await save({ ...(t._id ? { templateId: t._id } : {}), name: t.name, items: t.items }); setEdit(null); show("Template saved."); } catch (e) { show(errLine(e)); } }} />
          : list === undefined ? <Card label="Loading"><SkeletonRows n={3} /></Card> : list.length === 0 ? <div className="wp-tablecard glass"><EmptyState icon="template" title="No templates yet." body="A template is a kind of job's usual tasks, dated from the shoot or delivery day." actions={<Button variant="primary" onClick={() => setEdit({ name: "", items: [] })}>New template</Button>} /></div>
          : <div className="wp-tablecard glass">{list.map((t) => <ListRow key={t._id} lead={{ icon: "template" }} title={t.name} meta={`${t.items.length} task${t.items.length === 1 ? "" : "s"} · ${[...new Set(t.items.map((i) => i.role))].join(", ") || "no roles"}`}
            action={<span className="wk-acts"><Button size="sm" onClick={() => setUsing(t._id)}>Use on a project</Button><Button size="sm" variant="ghost" onClick={() => setEdit({ _id: t._id, name: t.name, items: t.items as TplItem[] })}>Edit</Button><Button size="sm" variant="ghost" onClick={() => void removeT({ templateId: t._id })}>Delete</Button></span>} />)}</div>}
      </div>
      {using && list && <UseTemplate tpl={list.find((t) => t._id === using)!} onClose={() => setUsing(null)} show={show} />}
      {toast}
    </>
  );
}

function TemplateEditor({ tpl, onCancel, onSave }: { tpl: { _id?: string; name: string; items: TplItem[] }; onCancel: () => void; onSave: (t: { _id?: string; name: string; items: TplItem[] }) => void }) {
  const [name, setName] = useState(tpl.name);
  const [items, setItems] = useState<TplItem[]>(tpl.items);
  const up = (id: string, p: Partial<TplItem>) => setItems(items.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const addIn = (k: string) => setItems([...items, { id: uid(), title: "", from: k === "after" ? "delivery" : "shoot", days: k === "before" ? -7 : k === "after" ? 0 : 0, role: "Owner", audience: "team", priority: "normal" }]);
  return (
    <Card label="Template">
      <div className="cr-pad wk-tpl">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Social package" />
        {SECTIONS.map((s) => (
          <div key={s.k} className="wk-sec"><span className="wp-field-label">{s.label}</span>
            {items.filter(s.test).map((i) => (
              <div key={i.id} className="wk-tplrow">
                <input className="input" value={i.title} onChange={(e) => up(i.id, { title: e.target.value })} placeholder="Task" aria-label="Task" />
                <span className="wk-when"><input className="input sm" type="number" value={Math.abs(i.days)} onChange={(e) => up(i.id, { days: (i.days < 0 || s.k === "before" ? -1 : 1) * Math.abs(Number(e.target.value) || 0) })} aria-label="Days" />
                  <select className="input sm" value={`${i.days < 0 ? "before" : "after"}:${i.from}`} onChange={(e) => { const [ba, from] = e.target.value.split(":"); up(i.id, { from: from as "shoot", days: (ba === "before" ? -1 : 1) * Math.abs(i.days) }); }} aria-label="When">
                    <option value="before:shoot">days before the shoot</option><option value="after:shoot">days after the shoot</option><option value="before:delivery">days before delivery</option><option value="after:delivery">days after delivery</option>
                  </select></span>
                <input className="input sm" value={i.role} onChange={(e) => up(i.id, { role: e.target.value })} placeholder="Role" aria-label="Who (a role)" list="wk-roles" />
                <select className="input sm" value={i.audience} onChange={(e) => up(i.id, { audience: e.target.value as "team" })} aria-label="Who sees it"><option value="team">Only the team</option><option value="client">For the client</option><option value="vendor">For a vendor</option></select>
                <button className="icon-btn sm" aria-label="Remove" onClick={() => setItems(items.filter((x) => x.id !== i.id))}><Icon name="close" size={12} /></button>
              </div>
            ))}
            <button type="button" className="rt-add" onClick={() => addIn(s.k)}><Icon name="plus" size={14} />Add a task</button>
          </div>
        ))}
        <datalist id="wk-roles"><option value="Owner" /><option value="Producer" /><option value="Editor" /><option value="Client" /><option value="Shooter" /></datalist>
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onCancel}>Cancel</button><Button variant="primary" disabled={!name.trim()} onClick={() => onSave({ _id: tpl._id, name, items: items.filter((i) => i.title.trim()).map((i) => (SECTIONS[2].test(i) || i.from === "delivery" ? i : i)) })}>Save template</Button></div>
      </div>
    </Card>
  );
}

function UseTemplate({ tpl, onClose, show, projectId: fixed }: { tpl: { _id: string; name: string; items: TplItem[] }; onClose: () => void; show: (t: string) => void; projectId?: string }) {
  const board = useQuery(api.homes.projectsBoard);
  const [projectId, setProjectId] = useState(fixed ?? "");
  const people = useQuery(api.work.people, projectId ? { projectId } : {});
  const use = useMutation(api.work.useTemplate);
  const [shootDay, setShootDay] = useState(""), [deliveryDay, setDeliveryDay] = useState("");
  const roles = [...new Set(tpl.items.map((i) => i.role))];
  const [pick, setPick] = useState<Record<string, string>>({});
  const p = board?.projects.find((x) => x._id === projectId);
  useEffect(() => { if (p?.next && !shootDay) setShootDay(p.next); }, [p]); // eslint-disable-line react-hooks/exhaustive-deps
  const vendorRoles = new Set(tpl.items.filter((i) => i.audience === "vendor").map((i) => i.role));
  const dates = tpl.items.map((i) => { const base = i.from === "shoot" ? shootDay : deliveryDay; return base ? plusDays(base, i.days) : null; }).filter(Boolean).sort() as string[];
  const toClient = tpl.items.filter((i) => i.audience === "client").length, toVendor = tpl.items.filter((i) => i.audience === "vendor" && pick[i.role]).length;
  const count = tpl.items.filter((i) => i.audience !== "vendor" || pick[i.role]).length;
  const go = async () => {
    try {
      const r = await use({ templateId: tpl._id as Id<"taskTemplates">, projectId: projectId as Id<"projects">, ...(shootDay ? { shootDay } : {}), ...(deliveryDay ? { deliveryDay } : {}),
        roles: roles.map((role) => { const v = pick[role]; if (!v) return { role }; if (vendorRoles.has(role)) { const x = people?.vendors.find((y) => y._id === v); return { role, vendorId: v as Id<"vendors">, ...(x ? { email: x.email, name: x.name } : {}) }; } const t = people?.team.find((y) => y.email === v); return { role, email: v, ...(t ? { name: t.name } : {}) }; }) });
      show(`Added ${r.added} tasks.`); onClose();
    } catch (e) { show(errLine(e)); }
  };
  return (
    <Modal onClose={onClose} label="Use a template" width={560}>
      <div className="crm-dialog">
        <DialogHeader eyebrow={tpl.name} title="Use this template on a project" onClose={onClose} />
        {!fixed && <label className="wp-field"><span className="wp-field-label">Project</span><select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">Pick a project</option>{(board?.projects ?? []).map((x) => <option key={x._id} value={x._id}>{x.label}{x.client ? ` · ${x.client}` : ""}</option>)}</select></label>}
        <div className="cv-two"><label className="wp-field"><span className="wp-field-label">Shoot day</span><input className="input" type="date" value={shootDay} onChange={(e) => setShootDay(e.target.value)} /></label><label className="wp-field"><span className="wp-field-label">Delivery day</span><input className="input" type="date" value={deliveryDay} onChange={(e) => setDeliveryDay(e.target.value)} /></label></div>
        {roles.map((role) => (
          <label key={role} className="wp-field"><span className="wp-field-label">{role}</span>
            <select className="input" value={pick[role] ?? ""} onChange={(e) => setPick({ ...pick, [role]: e.target.value })}>
              <option value="">{vendorRoles.has(role) ? "Pick a vendor (or leave their tasks out)" : "No one yet"}</option>
              {vendorRoles.has(role) ? (people?.vendors ?? []).map((v) => <option key={v._id} value={v._id}>{v.name}{v.booked ? " (booked)" : ""}</option>) : (people?.team ?? []).map((t) => <option key={t.email} value={t.email}>{t.name}</option>)}
            </select></label>
        ))}
        <p className="secondary">{count} task{count === 1 ? "" : "s"} will be added{p ? ` to ${p.label}` : ""}{dates.length ? `, from ${dayText(dates[0])} to ${dayText(dates[dates.length - 1])}` : ""}.{toClient ? ` ${toClient} go${toClient === 1 ? "es" : ""} to the client’s portal.` : ""}{toVendor ? ` ${toVendor} to the vendor’s.` : ""}</p>
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" disabled={!projectId || !count} onClick={() => void go()}>Add {count} task{count === 1 ? "" : "s"}</Button></div>
      </div>
    </Modal>
  );
}

// ---------- Import from Todoist (1095-41415, D198) ----------

function TodoistImport({ onClose, show }: { onClose: () => void; show: (t: string) => void }) {
  const list = useAction(api.work.todoistProjects);
  const run = useAction(api.work.todoistImport);
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }> | null>(null);
  const [picks, setPicks] = useState<Record<string, { on: boolean; home: { type: "client" | "project" | "shoot" | "lead"; id: string } | null }>>({});
  const [busy, setBusy] = useState(false);
  const board = useQuery(api.homes.projectsBoard);
  return (
    <Modal onClose={onClose} label="Import from Todoist" width={580}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Import from Todoist" title={projects ? "Pick what comes over" : "Connect for this import"} body="This copies once. Your Todoist isn’t changed, and nothing syncs back. After this, tasks live here, given to you." onClose={onClose} />
        {!projects ? <>
          <TextField label="Todoist API token" type="password" value={token} onChange={(e) => setToken(e.target.value)} hint="In Todoist: Settings › Integrations › Developer. It's used for this import only and never kept." autoComplete="off" />
          <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" loading={busy} disabled={!token.trim()} onClick={async () => { setBusy(true); try { setProjects(await list({ token })); } catch (e) { show(errLine(e)); } finally { setBusy(false); } }}>Read my projects</Button></div>
        </> : <>
          <div className="hm-list">{projects.map((p) => (
            <div key={p.id} className="wk-tdrow">
              <label className="cr-switch"><input type="checkbox" checked={!!picks[p.id]?.on} onChange={(e) => setPicks({ ...picks, [p.id]: { on: e.target.checked, home: picks[p.id]?.home ?? null } })} /> {p.name}</label>
              {picks[p.id]?.on && <select className="input sm" value={picks[p.id]?.home?.id ?? ""} onChange={(e) => setPicks({ ...picks, [p.id]: { on: true, home: e.target.value ? { type: "project", id: e.target.value } : null } })} aria-label={`Where ${p.name} goes`}>
                <option value="">Not attached</option>{(board?.projects ?? []).map((x) => <option key={x._id} value={x._id}>{x.label}</option>)}
              </select>}
            </div>
          ))}</div>
          <p className="secondary wp-small">Open tasks come over with their notes, due dates, priorities and subtasks. Comments, labels and sections stay in Todoist.</p>
          <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" loading={busy} disabled={!Object.values(picks).some((x) => x.on)} onClick={async () => {
            setBusy(true);
            try { const r = await run({ token, picks: projects.filter((p) => picks[p.id]?.on).map((p) => ({ id: p.id, name: p.name, home: picks[p.id].home })) }); show(`Imported ${r.added} tasks. They're in My tasks.`); onClose(); }
            catch (e) { show(errLine(e)); setBusy(false); }
          }}>Import</Button></div>
        </>}
      </div>
    </Modal>
  );
}

// ---------- the project page's Tasks tab (1094-40815) ----------

export function ProjectTasks({ projectId, show }: { projectId: string; show: (t: string) => void }) {
  const ts = useQuery(api.work.forProject, { projectId });
  const done = useMutation(api.work.done);
  const create = useMutation(api.work.create);
  const tpls = useQuery(api.work.templates);
  const [open, setOpen] = useState<string | null>(null);
  const [using, setUsing] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  if (ts === undefined || ts === null) return <Card label="Loading"><SkeletonRows n={3} /></Card>;
  const openTs = ts.filter((t) => t.status !== "done"), doneTs = ts.filter((t) => t.status === "done");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  return (
    <>
      <Card label="Tasks" head={<SectionHead label="Tasks" count={openTs.length} action={<span className="wk-acts">{tpls && tpls.length > 0 && <select className="input sm" value="" onChange={(e) => setUsing(e.target.value)} aria-label="Use a template"><option value="">Use a template…</option>{tpls.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</select>}<Button size="sm" variant="ghost" onClick={() => navigate("/work/all")}>Open in All tasks</Button></span>} />}>
        <p className="secondary wp-small cr-pad">These are the project’s tasks from Work. Add one here and it’s attached to this project.</p>
        {openTs.map((t) => <div key={t._id} className="wk-row" role="button" tabIndex={0} onClick={() => setOpen(t._id)}><Tick done={false} label={`Done: ${t.title}`} onToggle={() => void done({ taskId: t._id, done: true }).catch((e) => show(errLine(e)))} /><span className="t"><span className="ttl">{t.title}<Flag p={t.priority} /></span><Meta t={t} today={today} /></span><Who t={t} /></div>)}
        <div className="cr-pad"><AddRow onAdd={(title) => void create({ title, home: { type: "project", id: projectId } }).catch((e) => show(errLine(e)))} /></div>
        {doneTs.length > 0 && <button type="button" className="rt-add" onClick={() => setShowDone(!showDone)}><Icon name={showDone ? "chevron-down" : "chevron-right"} size={14} />{doneTs.length} done</button>}
        {showDone && doneTs.map((t) => <div key={t._id} className="wk-row done" role="button" tabIndex={0} onClick={() => setOpen(t._id)}><Tick done label={`Not done: ${t.title}`} onToggle={() => void done({ taskId: t._id, done: false })} /><span className="t"><span className="ttl">{t.title}</span></span></div>)}
      </Card>
      {open && <TaskPanel taskId={open} onClose={() => setOpen(null)} show={show} />}
      {using && tpls && <UseTemplate tpl={tpls.find((t) => t._id === using) as unknown as { _id: string; name: string; items: TplItem[] }} projectId={projectId} onClose={() => setUsing(null)} show={show} />}
    </>
  );
}

