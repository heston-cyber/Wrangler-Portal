// Shot lists (Nov 16; D179–D182; Design Log "Handoff ready: Shot lists"): Pre-pro › Shot lists (1033-18757, empty
// 1033-19386) and the editor (desktop 1034-19371 · 1034-20542 · 1034-21705; phone 1035-21337 · 1035-21789).
// D179 (decided after the frames): one list per shoot day, so the editor shows one day's list; the Shoot days card
// switches between the project's lists and links this one to a day. Setups don't carry their own day chip.
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, EmptyState, Field, PageHeader, SkeletonRows, TextArea, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errLine, useHold, type ItemSpec } from "../../ui/hold";
import { parsePasteRows } from "../../../convex/lib/shotList";
import { clock, shortDay, windowOf } from "./shotTime";
export { clock, shortDay, windowOf };

type View = NonNullable<ReturnType<typeof useQuery<typeof api.shotLists.get>>>;
type Setup = View["setups"][number];
type Shot = Setup["shots"][number];

// ---------- small helpers (shared with the checklist and the blocks) ----------

export const dayLabel = (d: { day: number; date: string } | null | undefined) => (d ? `Day ${d.day} · ${shortDay(d.date)}` : "No shoot day yet");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const Crumbs = ({ children }: { children?: React.ReactNode }) => (
  <TopBar><a {...linkProps("/production")}>Production</a><Sep /><a {...linkProps("/production/pre-pro")}>Pre-pro</a><Sep />
    {children ? <><a {...linkProps("/production/shot-lists")}>Shot lists</a><Sep />{children}</> : <span className="here">Shot lists</span>}</TopBar>
);

// ---------- Pre-pro › Shot lists (1033-18757 · 1033-19386) ----------

export default function ShotListsPage() {
  const all = useQuery(api.shotLists.all, {});
  const [making, setMaking] = useState(false);
  // One row per project (its lists are its shoot days), in the order of its most recent change.
  const rows = useMemo(() => {
    const by = new Map<string, NonNullable<typeof all>>();
    for (const l of all ?? []) by.set(l.project._id, [...(by.get(l.project._id) ?? []), l]);
    return [...by.values()].map((ls) => {
      const days = [...ls].sort((a, b) => (a.shoot?.day ?? 99) - (b.shoot?.day ?? 99));
      const total = ls.reduce((n, l) => n + l.total, 0), done = ls.reduce((n, l) => n + l.done, 0);
      const empty = days.filter((l) => l.setups === 0);
      return {
        key: ls[0].project._id, open: days[0]._id, title: ls[0].project.client || ls[0].project.label,
        sub: [ls[0].project.client ? ls[0].project.label : null, ...empty.map((l) => `${l.shoot ? `Day ${l.shoot.day}` : "A list"} has no setups yet`)].filter(Boolean).join(" · "),
        days: days.map((l) => (l.shoot ? `Day ${l.shoot.day} · ${shortDay(l.shoot.date)}` : "Not linked to a day")).join(", "), total, done,
      };
    });
  }, [all]);
  return (
    <>
      <Crumbs />
      <div className="wp-page prod">
        <PageHeader eyebrow="Pre-pro" title="Shot lists." sub="Setups and shots for each project, ticked off on set." actions={<Button variant="primary" onClick={() => setMaking(true)}>New shot list</Button>} />
        {all === undefined ? <Card label="Loading"><SkeletonRows n={3} /></Card>
          : rows.length === 0 ? <EmptyState icon="shot-list" title="No shot lists yet"
              body="Make one for a project in pre-pro, link it to a shoot day when the day is scheduled, and tick shots off on set."
              actions={<Button variant="primary" onClick={() => setMaking(true)}>New shot list</Button>} />
          : <Card className="sl-table" label="Shot lists">
              <div className="sl-thead" aria-hidden="true"><span>Project</span><span>Shoot days</span><span>Shots</span><span>Done</span></div>
              {rows.map((r) => (
                <a key={r.key} {...linkProps(`/production/shot-lists/${r.open}`)} className="sl-trow">
                  <span className="p"><span className="t">{r.title}</span>{r.sub && <span className="s">{r.sub}</span>}</span>
                  <span className="d">{r.days}</span>
                  <span className="n">{r.total}</span>
                  <span className="g"><span className={r.total && r.done === r.total ? "ok" : ""}>{r.total && r.done === r.total ? "All done" : `${r.done} of ${r.total}`}</span>
                    <span className="bar" aria-hidden="true"><i style={{ width: `${r.total ? (100 * r.done) / r.total : 0}%` }} /></span></span>
                </a>
              ))}
            </Card>}
      </div>
      {making && <NewList onClose={() => setMaking(false)} />}
    </>
  );
}

/** New shot list: a project, and (when it's scheduled) the shoot day it's for. */
export function NewList({ onClose, projectId }: { onClose: () => void; projectId?: string }) {
  const opts = useQuery(api.shotLists.newOptions, {});
  const create = useMutation(api.shotLists.create);
  const [p, setP] = useState(projectId ?? "");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const proj = opts?.find((x) => x._id === (p || opts?.[0]?._id));
  const go = async () => {
    if (!proj) return;
    setBusy(true); setErr(null);
    try { const id = await create({ projectId: proj._id, ...(day ? { shootId: day } : {}) }); onClose(); navigate(`/production/shot-lists/${id}`); }
    catch (e) { setErr(errLine(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="New shot list" width={480}>
      <div className="sl-dialog">
        <h2 className="wp-h4">New shot list</h2>
        <p className="wp-small secondary">One list per shoot day. Link it to a day now, or once the day is scheduled.</p>
        {opts === undefined ? <SkeletonRows n={2} /> : opts.length === 0 ? <p className="wp-small">Make a project first.</p> : <>
          <Field label="Project">{(id) => <select id={id} className="input" value={proj?._id ?? ""} onChange={(e) => { setP(e.target.value); setDay(""); }}>
            {opts.map((o) => <option key={o._id} value={o._id}>{o.client && o.client !== o.label ? `${o.client} · ${o.label}` : o.label}</option>)}</select>}</Field>
          <Field label="Shoot day">{(id) => <select id={id} className="input" value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="">No day yet</option>
            {proj?.days.map((d) => <option key={d._id} value={d._id} disabled={d.taken}>{dayLabel(d)}{d.taken ? " (has a list)" : ""}</option>)}</select>}</Field>
        </>}
        {err && <p className="wp-small danger" role="alert">{err}</p>}
        <div className="sl-dialog-acts"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!proj} onClick={go}>Make shot list</Button></div>
      </div>
    </Modal>
  );
}

// ---------- the editor (1034-19371, phone 1035-21337) ----------

type Drag = { kind: "shot" | "setup"; id: string } | null;

export function ShotListEditor({ listId }: { listId: string }) {
  const l = useQuery(api.shotLists.get, { listId });
  const [toast, say] = useToast();
  const [dialog, setDialog] = useState<null | { kind: "setup"; setup?: Setup; gap?: boolean } | { kind: "paste"; setupId?: string } | { kind: "shot"; shot: Shot } | { kind: "moveShot"; shot: Shot } | { kind: "moveSetup"; setup: Setup } | { kind: "remove" }>(null);
  const drag = useRef<Drag>(null);
  const [over, setOver] = useState<string | null>(null);
  const moveShot = useMutation(api.shotLists.moveShot);
  const moveSetup = useMutation(api.shotLists.moveSetup);
  const run = (p: Promise<unknown>, ok?: string) => p.then(() => ok && say(ok)).catch((e) => say(errLine(e)));

  if (l === undefined) return <><Crumbs><span className="here">…</span></Crumbs><div className="wp-page prod"><Card label="Loading"><SkeletonRows n={6} /></Card></div></>;
  if (l === null) return <><Crumbs /><div className="wp-page prod"><EmptyState icon="shot-list" title="This shot list isn't here any more" actions={<Button onClick={() => navigate("/production/shot-lists")}>All shot lists</Button>} /></div></>;

  const name = l.project?.client || l.project?.label || "Shot list";
  const setups = l.setups.filter((x) => !x.gap);
  const sub = [l.project?.client ? l.project.label : null, dayLabel(l.shoot), plural(setups.length, "setup"), plural(l.total, "shot"), `${l.done} done`].filter(Boolean).join(" · ");
  const dropOn = (target: { setupId: string; index: number } | { setupIndex: number }) => {
    const d = drag.current; drag.current = null; setOver(null);
    if (!d) return;
    if (d.kind === "shot" && "setupId" in target) void run(moveShot({ shotId: d.id, setupId: target.setupId, index: target.index }));
    if (d.kind === "setup" && "setupIndex" in target) void run(moveSetup({ setupId: d.id, index: target.setupIndex }));
  };

  return (
    <>
      <Crumbs><span className="here">{name}</span></Crumbs>
      <div className="wp-page prod sl-page">
        <PageHeader eyebrow="Shot list" title={`${name}.`} sub={sub}
          actions={<>{l.shoot && <ButtonLink to={`/production/shoots/${l.shoot._id}/shot-list`} iconEnd={false}>On-set checklist</ButtonLink>}<Button icon="plus" onClick={() => setDialog({ kind: "paste" })} disabled={!setups.length}>Paste shots</Button><Button variant="primary" onClick={() => setDialog({ kind: "setup" })}>Add setup</Button></>} />
        <div className="sl-cols">
          <Card className="sl-main" label="Setups and shots">
            {l.setups.length === 0 ? <div className="sl-empty">
                <p className="wp-body">No setups yet. A setup is a place and time (M-01 · 7:30–8:30 AM · DePaul lobby); its shots sit under it.</p>
                <div className="acts"><Button variant="primary" onClick={() => setDialog({ kind: "setup" })}>Add setup</Button><Button onClick={() => setDialog({ kind: "setup", gap: true })}>Add a gap line</Button></div>
              </div>
              : l.setups.map((x, i) => x.gap
                ? <GapLine key={x._id} x={x} onEdit={() => setDialog({ kind: "setup", setup: x })} drag={drag} over={over === x._id} setOver={setOver} onDrop={() => dropOn({ setupIndex: i })} />
                : <SetupBlock key={x._id} x={x} index={i} l={l} drag={drag} over={over} setOver={setOver} dropOn={dropOn} say={say}
                    onEdit={() => setDialog({ kind: "setup", setup: x })} onMove={() => setDialog({ kind: "moveSetup", setup: x })}
                    onPaste={() => setDialog({ kind: "paste", setupId: x._id })} onEditShot={(s) => setDialog({ kind: "shot", shot: s })} onMoveShot={(s) => setDialog({ kind: "moveShot", shot: s })} />)}
            {l.setups.length > 0 && <div className="sl-addrow"><button type="button" className="sl-link" onClick={() => setDialog({ kind: "setup" })}><Icon name="plus" size={14} />Add setup</button>
              <button type="button" className="sl-link" onClick={() => setDialog({ kind: "setup", gap: true })}><Icon name="plus" size={14} />Add a gap line</button></div>}
          </Card>
          <div className="sl-side">
            <DaysCard l={l} say={say} />
            <Card className="sl-tip" label="Tip"><p className="wp-small secondary">Drag a shot or a setup to move it. Numbers are yours: type over one to change it. On a phone, hold a row for its options.</p></Card>
            <button type="button" className="sl-link danger" onClick={() => setDialog({ kind: "remove" })}>Delete this shot list</button>
          </div>
        </div>
      </div>
      {dialog?.kind === "setup" && <SetupDialog listId={l._id} setup={dialog.setup} gap={dialog.gap ?? dialog.setup?.gap ?? false} onClose={() => setDialog(null)} say={say} />}
      {dialog?.kind === "paste" && <PasteDialog l={l} setupId={dialog.setupId} onClose={() => setDialog(null)} say={say} />}
      {dialog?.kind === "shot" && <ShotDialog shot={dialog.shot} onClose={() => setDialog(null)} say={say} />}
      {dialog?.kind === "moveShot" && <MoveShot l={l} shot={dialog.shot} onClose={() => setDialog(null)} say={say} />}
      {dialog?.kind === "moveSetup" && <MoveSetup l={l} setup={dialog.setup} onClose={() => setDialog(null)} say={say} />}
      {dialog?.kind === "remove" && <RemoveList l={l} onClose={() => setDialog(null)} />}
      {toast}
    </>
  );
}

type Say = (m: string) => void;
type DragProps = { drag: React.MutableRefObject<Drag>; setOver: (id: string | null) => void };

function GapLine({ x, onEdit, drag, over, setOver, onDrop }: { x: Setup; onEdit: () => void; over: boolean; onDrop: () => void } & DragProps) {
  const remove = useMutation(api.shotLists.removeSetup);
  const spec: ItemSpec = { id: x._id, title: x.title, actions: [{ key: "edit", label: "Edit", run: onEdit }, { key: "delete", label: "Delete", danger: true, run: () => remove({ setupId: x._id }) }] };
  const hold = useHold(spec);
  return (
    <div {...hold} className={`sl-gap${over ? " over" : ""}`} draggable onDragStart={(e) => { drag.current = { kind: "setup", id: x._id }; e.dataTransfer.effectAllowed = "move"; }}
      onDragOver={(e) => { if (drag.current?.kind === "setup") { e.preventDefault(); setOver(x._id); } }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); onDrop(); }}>
      <span className="rule" aria-hidden="true" />
      <button type="button" className="sl-plain" onClick={onEdit}>{[windowOf(x.start, x.end), x.title].filter(Boolean).join(" · ")}</button>
    </div>
  );
}

function SetupBlock({ x, index, l, drag, over, setOver, dropOn, say, onEdit, onMove, onPaste, onEditShot, onMoveShot }: {
  x: Setup; index: number; l: View; over: string | null; dropOn: (t: { setupId: string; index: number } | { setupIndex: number }) => void; say: Say;
  onEdit: () => void; onMove: () => void; onPaste: () => void; onEditShot: (s: Shot) => void; onMoveShot: (s: Shot) => void;
} & DragProps) {
  const remove = useMutation(api.shotLists.removeSetup);
  const moveSetup = useMutation(api.shotLists.moveSetup);
  const add = useMutation(api.shotLists.addShots);
  const [typing, setTyping] = useState("");
  const done = x.shots.filter((s) => s.done).length;
  const spec: ItemSpec = { id: x._id, title: `${x.code ? `${x.code} · ` : ""}${x.title}`, actions: [
    { key: "edit", label: "Edit", run: onEdit },
    { key: "up", label: "Move up", run: () => moveSetup({ setupId: x._id, index: Math.max(0, index - 1) }) },
    { key: "down", label: "Move down", run: () => moveSetup({ setupId: x._id, index: index + 1 }) },
    ...(l.others.length ? [{ key: "day", label: "Move to another day's list", run: onMove }] : []),
    { key: "delete", label: "Delete", danger: true, confirm: { title: `Delete ${x.code ?? "this setup"}?`, body: x.shots.length ? `Its ${plural(x.shots.length, "shot")} go too.` : undefined, yes: "Delete" }, run: () => remove({ setupId: x._id }) },
  ] };
  const hold = useHold(spec);
  const addOne = async () => {
    const t = typing.trim();
    if (!t) return;
    try { await add({ setupId: x._id, text: t }); setTyping(""); } catch (e) { say(errLine(e)); }
  };
  return (
    <section className="sl-setup" aria-label={x.title}>
      <div {...hold} className={`sl-sethead${over === x._id ? " over" : ""}`} draggable onDragStart={(e) => { drag.current = { kind: "setup", id: x._id }; e.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(e) => { if (drag.current) { e.preventDefault(); setOver(x._id); } }} onDragLeave={() => setOver(null)}
        onDrop={(e) => { e.preventDefault(); dropOn(drag.current?.kind === "shot" ? { setupId: x._id, index: 0 } : { setupIndex: index }); }}>
        <div className="top">{x.code && <span className="sl-code">{x.code}</span>}<span className="win">{windowOf(x.start, x.end)}</span><span className="cnt">{done}/{x.shots.length}</span></div>
        <button type="button" className="sl-plain ttl" onClick={onEdit}>{x.title}</button>
        {x.note && <p className="sl-note">{x.note}</p>}
      </div>
      {x.shots.map((s, i) => <ShotRow key={s._id} s={s} setupId={x._id} index={i} drag={drag} over={over === s._id} setOver={setOver} dropOn={dropOn} say={say} onEdit={() => onEditShot(s)} onMove={() => onMoveShot(s)} />)}
      <div className="sl-add">
        <Icon name="plus" size={14} />
        <input className="sl-addin" placeholder="Add shot" aria-label={`Add a shot to ${x.title}`} value={typing} onChange={(e) => setTyping(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addOne(); } }}
          onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t.includes("\n")) { e.preventDefault(); onPaste(); } }} />
        <button type="button" className="sl-link quiet" onClick={onPaste}>or paste many lines</button>
      </div>
    </section>
  );
}

function ShotRow({ s, setupId, index, drag, over, setOver, dropOn, say, onEdit, onMove }: {
  s: Shot; setupId: string; index: number; over: boolean; dropOn: (t: { setupId: string; index: number }) => void; say: Say; onEdit: () => void; onMove: () => void;
} & DragProps) {
  const tick = useMutation(api.shotLists.tick);
  const edit = useMutation(api.shotLists.editShot);
  const remove = useMutation(api.shotLists.removeShot);
  const [num, setNum] = useState<string | null>(null);
  const spec: ItemSpec = { id: s._id, title: `#${s.number} ${s.text}`, actions: [
    { key: "edit", label: "Edit", run: onEdit }, { key: "move", label: "Move to setup", run: onMove },
    { key: "delete", label: "Delete", danger: true, run: () => remove({ shotId: s._id }) },
  ] };
  const hold = useHold(spec);
  const saveNum = async () => {
    const n = Number(num);
    setNum(null);
    if (!num || n === s.number) return;
    try { await edit({ shotId: s._id, number: n }); } catch (e) { say(errLine(e)); }
  };
  return (
    <div {...hold} className={`sl-shot${s.done ? " done" : ""}${over ? " over" : ""}`}
      onDragOver={(e) => { if (drag.current?.kind === "shot") { e.preventDefault(); setOver(s._id); } }} onDragLeave={() => setOver(null)}
      onDrop={(e) => { e.preventDefault(); dropOn({ setupId, index }); }}>
      <span className="grip" draggable aria-hidden="true" onDragStart={(e) => { drag.current = { kind: "shot", id: s._id }; e.dataTransfer.effectAllowed = "move"; }}>⠿</span>
      <ShotTick done={!!s.done} label={`#${s.number} ${s.text}`} onToggle={() => void tick({ shotId: s._id, done: !s.done, at: Date.now() }).catch((e) => say(errLine(e)))} />
      {num === null
        ? <button type="button" className="num" onClick={() => setNum(String(s.number))} aria-label={`Shot number ${s.number}, change it`}>#{s.number}</button>
        : <input className="num edit" autoFocus inputMode="numeric" value={num} aria-label="Shot number" onChange={(e) => setNum(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onBlur={() => void saveNum()} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setNum(null); }} />}
      <button type="button" className="sl-plain txt" onClick={onEdit}><span className="t">{s.text}</span>{s.note && <span className="n">{s.note}</span>}</button>
      {s.done && <span className="who" title={`Ticked by ${s.done.name}`}>{s.done.initials}</span>}
    </div>
  );
}

/** The tick box: 26 px box in a 44 px target on touch rows (Shot row · Touch). */
export function ShotTick({ done, label, onToggle, disabled }: { done: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={done} aria-label={label} className={`sl-tick${done ? " on" : ""}`} onClick={onToggle} disabled={disabled}>
      <span className="box">{done && <Icon name="check" size={16} />}</span>
    </button>
  );
}

function DaysCard({ l, say }: { l: View; say: Say }) {
  const update = useMutation(api.shotLists.update);
  const [linking, setLinking] = useState(false);
  const free = l.days.filter((d) => !d.taken && d._id !== l.shoot?._id);
  const lists = [{ _id: l._id, day: l.shoot?.day ?? null, date: l.shoot?.date ?? null, here: true }, ...l.others.map((o) => ({ ...o, here: false }))]
    .sort((a, b) => (a.day ?? 99) - (b.day ?? 99));
  return (
    <Card className="sl-days" label="Shoot days">
      <span className="sl-eyebrow">Shoot days</span>
      {lists.map((x) => {
        const head = x.day && x.date ? `Day ${x.day} · ${shortDay(x.date)}` : "Not linked to a shoot day yet";
        const meta = x.here ? `This list · ${plural(l.total, "shot")}` : "Open its list";
        return x.here ? <div key={x._id} className="sl-day here"><span className="t">{head}</span><span className="m">{meta}</span></div>
          : <a key={x._id} {...linkProps(`/production/shot-lists/${x._id}`)} className="sl-day"><span className="t">{head}</span><span className="m">{meta}</span></a>;
      })}
      {l.days.filter((d) => !d.taken && d._id !== l.shoot?._id && !lists.some((x) => x.day === d.day)).map((d) => <div key={d._id} className="sl-day off"><span className="t">{dayLabel(d)}</span><span className="m">No list yet</span></div>)}
      <div className="acts">
        {linking ? <select className="input" autoFocus aria-label="Link this list to a shoot day" defaultValue="" onChange={async (e) => {
            const v = e.target.value; setLinking(false);
            if (v === "new") { navigate(`/projects/${l.project?._id}?schedule=1`); return; }
            try { await update({ listId: l._id, shootId: v === "none" ? null : v }); say(v === "none" ? "Unlinked from its shoot day." : "Linked."); } catch (err) { say(errLine(err)); }
          }} onBlur={() => setLinking(false)}>
            <option value="" disabled>Pick a shoot day</option>
            {free.map((d) => <option key={d._id} value={d._id}>{dayLabel(d)}</option>)}
            {l.shoot && <option value="none">No day yet</option>}
            <option value="new">Add a shoot day…</option>
          </select>
          : <Button size="sm" onClick={() => setLinking(true)}>{l.shoot ? "Change shoot day" : "Link to a shoot day"}</Button>}
      </div>
    </Card>
  );
}

// ---------- dialogs ----------

function Dialog({ title, sub, onClose, children, acts }: { title: string; sub?: string; onClose: () => void; children?: React.ReactNode; acts: React.ReactNode }) {
  return (
    <Modal onClose={onClose} label={title} width={520} slideOut>
      <div className="sl-dialog">
        <h2 className="wp-h4">{title}</h2>
        {sub && <p className="wp-small secondary">{sub}</p>}
        {children}
        <div className="sl-dialog-acts">{acts}</div>
      </div>
    </Modal>
  );
}

function SetupDialog({ listId, setup, gap, onClose, say }: { listId: Id<"shotLists">; setup?: Setup; gap: boolean; onClose: () => void; say: Say }) {
  const add = useMutation(api.shotLists.addSetup);
  const edit = useMutation(api.shotLists.editSetup);
  const [f, setF] = useState({ code: setup?.code ?? "", start: setup?.start ?? "", end: setup?.end ?? "", title: setup?.title ?? "", note: setup?.note ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (setup) await edit({ setupId: setup._id, ...f });
      else await add({ listId, gap, ...f, code: f.code || undefined });
      say(setup ? "Saved." : gap ? "Gap line added." : "Setup added.");
      onClose();
    } catch (e) { setErr(errLine(e)); setBusy(false); }
  };
  return (
    <Dialog title={setup ? (gap ? "Edit gap line" : `Edit ${setup.code ?? "setup"}`) : gap ? "Add a gap line" : "Add setup"} onClose={onClose}
      sub={gap ? "Time between setups: travel, lunch, a reset." : "A place and time on the day. Leave the code empty for the next one (M-02 after M-01)."}
      acts={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.title.trim()} onClick={save}>{setup ? "Save" : "Add"}</Button></>}>
      <div className="sl-fields">
        {!gap && <TextField label="Code" value={f.code} onChange={set("code")} placeholder="M-01" maxLength={12} />}
        <TextField label="Starts" type="time" value={f.start} onChange={set("start")} />
        <TextField label="Ends" type="time" value={f.end} onChange={set("end")} />
      </div>
      <TextField label={gap ? "What happens" : "Title"} value={f.title} onChange={set("title")} placeholder={gap ? "Call at the hotel lobby, travel to the hospital" : "DePaul lobby: exteriors"} maxLength={120} autoFocus />
      {!gap && <TextArea label="Note" value={f.note} onChange={set("note")} placeholder="Nurses free 8:30–9:30 only." rows={2} maxLength={400} />}
      {err && <p className="wp-small danger" role="alert">{err}</p>}
    </Dialog>
  );
}

/** Paste shots (1034-20542): one per line, a number at the start kept, the rest numbered on from the highest. */
function PasteDialog({ l, setupId, onClose, say }: { l: View; setupId?: string; onClose: () => void; say: Say }) {
  const add = useMutation(api.shotLists.addShots);
  const setups = l.setups.filter((x) => !x.gap);
  const [to, setTo] = useState(setupId ?? setups.at(-1)?._id ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const used = l.setups.flatMap((x) => x.shots.map((s) => s.number));
  const rows = parsePasteRows(text, used);
  const typed = rows.filter((r) => r.typed).map((r) => r.number), rest = rows.filter((r) => !r.typed).map((r) => r.number);
  const join = (ns: number[]) => ns.map((n) => `#${n}`).join(", ").replace(/, ([^,]*)$/, " and $1");
  const words = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const summary = !rows.length ? "" : `${plural(rows.length, "shot")}: ${[typed.length ? `${join(typed)} as typed` : null,
    rest.length ? `${typed.length ? `the other ${words[rest.length] ?? rest.length} ${rest.length === 1 ? "gets" : "get"}` : rest.length === 1 ? "it gets" : "they get"} ${join(rest)}` : null].filter(Boolean).join("; ")}.`;
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await add({ setupId: to, text }); say(`Added ${plural(r.added, "shot")}.`); onClose(); }
    catch (e) { setErr(errLine(e)); setBusy(false); }
  };
  return (
    <Dialog title="Paste shots" sub="One shot per line. A number at the start of a line is kept." onClose={onClose}
      acts={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!rows.length || !to} onClick={go}>{rows.length ? `Add ${plural(rows.length, "shot")}` : "Add shots"}</Button></>}>
      <Field label="Add to">{(id) => <select id={id} className="input" value={to} onChange={(e) => setTo(e.target.value)}>
        {setups.map((x) => <option key={x._id} value={x._id}>{[x.code, x.title].filter(Boolean).join(" · ")}</option>)}</select>}</Field>
      <TextArea label="Shots" value={text} onChange={(e) => setText(e.target.value)} rows={7} autoFocus placeholder={"12 Med cart rolling past, low angle\nShift huddle at the board, wide"} />
      {summary && <p className="wp-small secondary">{summary}</p>}
      {err && <p className="wp-small danger" role="alert">{err}</p>}
    </Dialog>
  );
}

function ShotDialog({ shot, onClose, say }: { shot: Shot; onClose: () => void; say: Say }) {
  const edit = useMutation(api.shotLists.editShot);
  const [f, setF] = useState({ number: String(shot.number), text: shot.text, note: shot.note ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await edit({ shotId: shot._id, text: f.text, note: f.note, number: Number(f.number) }); say("Saved."); onClose(); }
    catch (e) { setErr(errLine(e)); setBusy(false); }
  };
  return (
    <Dialog title={`Edit #${shot.number}`} onClose={onClose} acts={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!f.text.trim() || !f.number} onClick={save}>Save</Button></>}>
      <div className="sl-fields"><TextField label="Number" inputMode="numeric" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></div>
      <TextField label="Shot" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} maxLength={200} autoFocus />
      <TextArea label="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={2} maxLength={400} placeholder="Ask before filming faces" />
      {err && <p className="wp-small danger" role="alert">{err}</p>}
    </Dialog>
  );
}

function MoveShot({ l, shot, onClose, say }: { l: View; shot: Shot; onClose: () => void; say: Say }) {
  const move = useMutation(api.shotLists.moveShot);
  const here = l.setups.find((x) => x.shots.some((s) => s._id === shot._id));
  return (
    <Dialog title={`Move #${shot.number} to setup`} onClose={onClose} acts={<Button onClick={onClose}>Cancel</Button>}>
      <div className="sl-picks">
        {l.setups.filter((x) => !x.gap).map((x) => (
          <button key={x._id} type="button" className="sl-pick" disabled={x._id === here?._id}
            onClick={() => { onClose(); void move({ shotId: shot._id, setupId: x._id, index: x.shots.length }).then(() => say(`Moved to ${x.code ?? x.title}.`)).catch((e) => say(errLine(e))); }}>
            {[x.code, x.title].filter(Boolean).join(" · ")}{x._id === here?._id ? " (here now)" : ""}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

function MoveSetup({ l, setup, onClose, say }: { l: View; setup: Setup; onClose: () => void; say: Say }) {
  const move = useMutation(api.shotLists.moveSetup);
  return (
    <Dialog title={`Move ${setup.code ?? "this setup"} to another day`} sub="Its shots go with it. A number already used on that list gets the next free one there." onClose={onClose} acts={<Button onClick={onClose}>Cancel</Button>}>
      <div className="sl-picks">
        {l.others.map((o) => (
          <button key={o._id} type="button" className="sl-pick"
            onClick={() => { onClose(); void move({ setupId: setup._id, listId: o._id, index: 9999 }).then(() => say(`Moved to ${o.day ? `Day ${o.day}` : "the other list"}.`)).catch((e) => say(errLine(e))); }}>
            {o.day && o.date ? `Day ${o.day} · ${shortDay(o.date)}` : "The list with no shoot day yet"}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

function RemoveList({ l, onClose }: { l: View; onClose: () => void }) {
  const remove = useMutation(api.shotLists.remove);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Delete this shot list?" sub={`${plural(l.total, "shot")} and their ticks go. Call sheets showing it show nothing in its place.`} onClose={onClose}
      acts={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={async () => { setBusy(true); await remove({ listId: l._id }); onClose(); navigate("/production/shot-lists"); }}>Delete</Button></>} />
  );
}

// ---------- the project Overview card (1038-39812) ----------

/** "Shot list · 18 of 24 done", a line per shoot day ("Day 1 · Tue 11/3 · H-01 and H-02 · 6 left"), and Open. */
export function ShotListCard({ projectId }: { projectId: string }) {
  const d = useQuery(api.shotLists.forProject, { projectId });
  const [making, setMaking] = useState(false);
  if (!d) return null;
  const total = d.lists.reduce((n, l) => n + l.total, 0), done = d.lists.reduce((n, l) => n + l.done, 0);
  const lists = [...d.lists].sort((a, b) => (a.shoot?.day ?? 99) - (b.shoot?.day ?? 99));
  const and = (xs: string[]) => xs.join(", ").replace(/, ([^,]*)$/, " and $1");
  return (
    <>
      <Card className="pj-shots" label="Shot list">
        <div className="sl-card">
          <div className="top"><span className="sl-eyebrow">Shot list</span>
            {lists.length > 0 ? <ButtonLink size="sm" to={`/production/shot-lists/${lists[0]._id}`} iconEnd={false}>Open</ButtonLink> : <Button size="sm" variant="ghost" onClick={() => setMaking(true)}>New shot list</Button>}</div>
          {lists.length === 0 ? <p className="wp-small secondary">No shot list yet. Make one per shoot day, and tick shots off on set.</p> : <>
            <p className="big">{total && done === total ? "All done" : `${done} of ${total} done`}</p>
            <div className="sl-progress"><span className="bar" aria-hidden="true"><i style={{ width: `${total ? (100 * done) / total : 0}%` }} /></span></div>
            {lists.map((l) => {
              const codes = l.setups.filter((x) => !x.gap && x.code).map((x) => x.code as string);
              return <a key={l._id} {...linkProps(`/production/shot-lists/${l._id}`)} className="sl-cardline">
                {[dayLabel(l.shoot), codes.length ? and(codes) : "No setups yet", l.total ? (l.done === l.total ? "all done" : `${l.total - l.done} left`) : null].filter(Boolean).join(" · ")}</a>;
            })}
          </>}
        </div>
      </Card>
      {making && <NewList projectId={projectId} onClose={() => setMaking(false)} />}
    </>
  );
}
