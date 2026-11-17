// 5j (D194; frames 5j / Packing lists 1050-25637, editor 1050-26324, a shoot's Gear tab 1051-26214, on-set load-in and
// wrap 1051-26587 · 1051-27081): saved packing lists, their editor, and a shoot's own copy ticked at load-in and wrap.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, Card, DialogHeader, EmptyState, PageHeader, SkeletonRows, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useConfirm, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errLine } from "../../ui/hold";

type List = NonNullable<ReturnType<typeof useQuery<typeof api.packing.get>>>;
type Line = List["lines"][number];

const Crumbs = ({ here }: { here?: string }) => (
  <TopBar><a {...linkProps("/production")}>Production</a><Sep /><a {...linkProps("/production/gear")}>Gear</a><Sep />
    {here ? <><a {...linkProps("/production/gear/packing")}>Packing lists</a><Sep /><span className="here">{here}</span></> : <span className="here">Packing lists</span>}</TopBar>
);

/** Gear's two tabs: Items (the existing Gear page) and Packing lists. */
export function GearTabs({ on }: { on: "items" | "packing" }) {
  return (
    <div className="sp-tabs gr-tabs" role="tablist" aria-label="Gear">
      <a role="tab" aria-selected={on === "items"} className={`sp-tab${on === "items" ? " on" : ""}`} {...linkProps("/production/gear")}>Items</a>
      <a role="tab" aria-selected={on === "packing"} className={`sp-tab${on === "packing" ? " on" : ""}`} {...linkProps("/production/gear/packing")}>Packing lists</a>
    </div>
  );
}

export default function PackingListsPage() {
  const lists = useQuery(api.packing.lists, {});
  const create = useMutation(api.packing.create);
  const duplicate = useMutation(api.packing.duplicate);
  const [toast, show] = useToast();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const make = async () => { try { const id = await create({ name }); navigate(`/production/gear/packing/${id}`); } catch (e) { show(errLine(e)); } };
  return (
    <>
      <Crumbs />
      <div className="wp-page prod">
        <PageHeader eyebrow="Production" title="Gear." sub="Everything you own for shoots, and the kits you pack." actions={<Button variant="primary" onClick={() => setNaming(true)}>New list</Button>} />
        <GearTabs on="packing" />
        {lists === undefined ? <Card label="Loading"><SkeletonRows n={3} /></Card>
          : lists.length === 0 ? <EmptyState icon="case" title="No packing lists yet" body="Save the kits you pack (an interview kit, a run-and-gun bag) and put a copy on each shoot." actions={<Button variant="primary" onClick={() => setNaming(true)}>New list</Button>} />
          : <div className="pk-cards">
              {lists.map((l) => (
                <section key={l._id} className="pk-card glass" aria-label={l.name}>
                  <header><b>{l.name}</b><span className="secondary">{l.lines} {l.lines === 1 ? "line" : "lines"} · {l.fromGear} from Gear · {l.loose} loose{l.used ? ` · used on ${l.used} ${l.used === 1 ? "shoot" : "shoots"}` : ""}</span></header>
                  <div className="pk-chips">{l.items.map((t, i) => <span key={i} className="pk-chip">{t}</span>)}{l.lines > l.items.length && <span className="pk-chip more">+{l.lines - l.items.length}</span>}</div>
                  <footer>
                    <Button size="sm" onClick={() => navigate(`/production/gear/packing/${l._id}`)}>Edit</Button>
                    <Button size="sm" onClick={() => void duplicate({ listId: l._id }).then((id) => navigate(`/production/gear/packing/${id}`), (e) => show(errLine(e)))}>Duplicate</Button>
                  </footer>
                </section>
              ))}
            </div>}
      </div>
      {naming && (
        <Modal onClose={() => setNaming(false)} label="New packing list" width={460}>
          <form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void make(); }}>
            <DialogHeader eyebrow="Packing lists" title="New list." onClose={() => setNaming(false)} />
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Interview kit" />
            <div className="dfoot"><button type="button" className="btn ghost" onClick={() => setNaming(false)}>Cancel</button><Button variant="primary" type="submit" disabled={!name.trim()}>Make list</Button></div>
          </form>
        </Modal>
      )}
      {toast}
    </>
  );
}

// ---------- the editor (saved lists and a shoot's copy) ----------

function ListLines({ l, show, editable }: { l: List; show: (t: string) => void; editable: boolean }) {
  const edit = useMutation(api.packing.editLine);
  const remove = useMutation(api.packing.removeLine);
  const move = useMutation(api.packing.moveLine);
  const [drag, setDrag] = useState<string | null>(null);
  return (
    <div className="pk-lines">
      {l.lines.map((x, i) => (
        <div key={x._id} className={`pk-line${drag === x._id ? " drag" : ""}`} draggable={editable}
          onDragStart={() => setDrag(x._id)} onDragEnd={() => setDrag(null)} onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (drag && drag !== x._id) void move({ lineId: drag, index: i }).catch((e) => show(errLine(e))); setDrag(null); }}>
          {editable && <Icon name="menu" size={14} className="handle" />}
          <span className="t">{x.text}{x.serial4 && <span className="secondary"> · ···{x.serial4}</span>}{x.repair && <span className="warn"> · In repair</span>}{x.clash && <span className="warn"> · also on {x.clash}</span>}{!x.gearId && <span className="secondary"> · loose</span>}</span>
          {editable ? <input className="input pk-qty" type="number" min={1} max={999} defaultValue={x.qty} aria-label={`How many ${x.text}`} onBlur={(e) => { const n = Number(e.target.value); if (n && n !== x.qty) void edit({ lineId: x._id, qty: n }).catch((er) => show(errLine(er))); }} />
            : <span className="pk-q">×{x.qty}</span>}
          {editable && <button type="button" className="pk-x" aria-label={`Remove ${x.text}`} onClick={() => void remove({ lineId: x._id }).catch((e) => show(errLine(e)))}><Icon name="close" size={14} /></button>}
        </div>
      ))}
    </div>
  );
}

function AddFromGear({ listId, onClose, show }: { listId: string; onClose: () => void; show: (t: string) => void }) {
  const items = useQuery(api.packing.gearChoices, { listId });
  const add = useMutation(api.packing.addGear);
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<string[]>([]);
  const shown = (items ?? []).filter((g) => !q.trim() || g.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal onClose={onClose} label="Add from Gear" width={520}>
      <div className="crm-dialog hm-pick">
        <DialogHeader eyebrow="Packing list" title="Add from Gear." body="Lines from Gear keep their serial and flag clashes with other shoots that day. Loose lines are just text." onClose={onClose} />
        <TextField placeholder="Search gear" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search gear" />
        <div className="hm-list">
          {items === undefined ? <SkeletonRows n={4} /> : shown.length === 0 ? <p className="secondary hm-none">No gear matches.</p> : shown.map((g) => {
            const on = g.on || pick.includes(g._id);
            return (
              <button key={g._id} type="button" className="hm-row" disabled={g.on} aria-pressed={on} onClick={() => setPick(on ? pick.filter((x) => x !== g._id) : [...pick, g._id])}>
                <Icon name={on ? "check-circle" : "case"} size={18} />
                <span className="t"><b>{g.name}</b><span className="secondary">{[g.serial4 ? `···${g.serial4}` : null, g.repair ? "In repair" : null, g.on ? "On the list" : null].filter(Boolean).join(" · ") || g.kind}</span></span>
              </button>
            );
          })}
        </div>
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <Button variant="primary" disabled={!pick.length} onClick={() => void add({ listId, gearIds: pick as Id<"gear">[] }).then(() => onClose(), (e) => show(errLine(e)))}>Add {pick.length || ""}</Button></div>
      </div>
    </Modal>
  );
}

function AddLine({ listId, show }: { listId: string; show: (t: string) => void }) {
  const add = useMutation(api.packing.addLine);
  const [t, setT] = useState("");
  return (
    <form className="pk-add" onSubmit={(e) => { e.preventDefault(); if (t.trim()) void add({ listId, text: t }).then(() => setT(""), (er) => show(errLine(er))); }}>
      <input className="input" value={t} onChange={(e) => setT(e.target.value)} placeholder="Add a line (gaffer tape, snacks…)" aria-label="Add a line" />
      <Button type="submit" disabled={!t.trim()}>Add</Button>
    </form>
  );
}

export function PackingListEditor({ listId }: { listId: string }) {
  const l = useQuery(api.packing.get, { listId });
  const rename = useMutation(api.packing.rename);
  const duplicate = useMutation(api.packing.duplicate);
  const remove = useMutation(api.packing.remove);
  const [toast, show] = useToast();
  const [adding, setAdding] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [ask, asking] = useConfirm();
  if (l === undefined) return <><Crumbs here="…" /><div className="wp-page prod"><Card label="Loading"><SkeletonRows n={5} /></Card></div></>;
  if (l === null) return <><Crumbs /><div className="wp-page prod"><EmptyState icon="case" title="This packing list isn't here any more" /></div></>;
  return (
    <>
      <Crumbs here={l.name} />
      <div className="wp-page prod">
        <PageHeader eyebrow={l.shootId ? "A shoot's packing list" : "Packing list"} title={`${l.name}.`} sub={`${l.lines.length} ${l.lines.length === 1 ? "line" : "lines"}`} actions={<>
          <Button onClick={() => setNaming(l.name)}>Rename</Button>
          {!l.shootId && <Button onClick={() => void duplicate({ listId: l._id }).then((id) => navigate(`/production/gear/packing/${id}`), (e) => show(errLine(e)))}>Duplicate</Button>}
          <Button variant="primary" onClick={() => setAdding(true)}>Add from Gear</Button>
        </>} />
        <Card className="sp-card" label="Lines">
          {l.lines.length === 0 ? <p className="secondary">Nothing on it yet. Add items from Gear, or type a loose line.</p> : <ListLines l={l} show={show} editable />}
          <AddLine listId={l._id} show={show} />
        </Card>
        {l.shootId ? <a className="sp-link" {...linkProps(`/production/shoots/${l.shootId}?tab=gear`)}>Back to the shoot</a>
          : <button type="button" className="sp-link danger" onClick={() => void ask({ title: `Delete ${l.name}?`, body: "Copies already on shoots stay as they are." }).then((ok) => { if (ok) void remove({ listId: l._id }).then(() => navigate("/production/gear/packing"), (e) => show(errLine(e))); })}>Delete list</button>}
      </div>
      {adding && <AddFromGear listId={l._id} onClose={() => setAdding(false)} show={show} />}
      {naming !== null && (
        <Modal onClose={() => setNaming(null)} label="Rename" width={440}>
          <form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void rename({ listId: l._id, name: naming }).then(() => setNaming(null), (er) => show(errLine(er))); }}>
            <DialogHeader eyebrow="Packing list" title="Rename." onClose={() => setNaming(null)} />
            <TextField label="Name" value={naming} onChange={(e) => setNaming(e.target.value)} autoFocus />
            <div className="dfoot"><button type="button" className="btn ghost" onClick={() => setNaming(null)}>Cancel</button><Button variant="primary" type="submit" disabled={!naming.trim()}>Save</Button></div>
          </form>
        </Modal>
      )}
      {asking}
      {toast}
    </>
  );
}

// ---------- a shoot's Gear tab, with the load-in and wrap passes ----------

export function GearTab({ shootId, show }: { shootId: string; show: (t: string) => void }) {
  const d = useQuery(api.packing.forShoot, { shootId });
  const saved = useQuery(api.packing.lists, {});
  const use = useMutation(api.packing.useOnShoot);
  const tick = useMutation(api.packing.tick);
  const flag = useMutation(api.packing.flag);
  const [choosing, setChoosing] = useState(false);
  const [pass, setPass] = useState<"loaded" | "back">("loaded");
  const [adding, setAdding] = useState(false);
  const counts = useMemo(() => {
    const ls = d?.list?.lines ?? [];
    const total = ls.reduce((n, x) => n + x.qty, 0);
    return { total, loaded: ls.reduce((n, x) => n + (x.loaded ? x.qty : 0), 0), back: ls.reduce((n, x) => n + (x.back ? x.qty : 0), 0) };
  }, [d]);
  if (d === undefined) return <Card label="Loading"><SkeletonRows n={4} /></Card>;
  if (d === null) return null;
  if (!d.list) return (
    <>
      <EmptyState icon="case" title="No packing list yet" body="Put a copy of a saved list on this shoot, or start an empty one." actions={<Button variant="primary" onClick={() => setChoosing(true)}>Add a packing list</Button>} />
      {choosing && (
        <Modal onClose={() => setChoosing(false)} label="Packing list for this shoot" width={520}>
          <div className="crm-dialog hm-pick">
            <DialogHeader eyebrow="Gear" title="Which list?" body="A copy goes on this shoot. Your saved list stays as it is." onClose={() => setChoosing(false)} />
            <div className="hm-list">
              {(saved ?? []).map((l) => (
                <button key={l._id} type="button" className="hm-row" onClick={() => void use({ shootId, listId: l._id }).then(() => setChoosing(false), (e) => show(errLine(e)))}>
                  <Icon name="case" size={18} /><span className="t"><b>{l.name}</b><span className="secondary">{l.lines} lines</span></span>
                </button>
              ))}
              <button type="button" className="hm-row" onClick={() => void use({ shootId }).then(() => setChoosing(false), (e) => show(errLine(e)))}>
                <Icon name="plus" size={18} /><span className="t"><b>Start an empty list</b></span>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
  const l = d.list;
  const notBack = l.lines.filter((x) => !x.back);
  const now = () => Date.now();
  return (
    <>
      <Card className="sp-card pk-onset" label="Packing list">
        <div className="sp-relhead"><Icon name="case" size={16} /><span className="wp-label">{l.name}</span><span className="sp" />
          <div className="pk-switch" role="tablist" aria-label="Pass">
            <button type="button" role="tab" aria-selected={pass === "loaded"} className={pass === "loaded" ? "on" : ""} onClick={() => setPass("loaded")}>Load-in · {counts.loaded} / {counts.total}</button>
            <button type="button" role="tab" aria-selected={pass === "back"} className={pass === "back" ? "on" : ""} onClick={() => setPass("back")}>Wrap · {counts.back} / {counts.total}</button>
          </div>
        </div>
        {pass === "back" && counts.back < counts.total && notBack.length > 0 && <p className="pk-notback"><Icon name="alert" size={16} />{notBack.length} {notBack.length === 1 ? "item" : "items"} not back: {notBack.map((x) => x.text).join(", ")}</p>}
        {l.lines.length === 0 && <p className="secondary">Nothing on it yet.</p>}
        {l.lines.map((x: Line) => {
          const done = !!x[pass];
          return (
            <div key={x._id} className={`pk-tick${done ? " done" : ""}`}>
              <button type="button" className="pk-box" aria-pressed={done} aria-label={`${done ? "Untick" : "Tick"} ${x.text}`} onClick={() => void tick({ lineId: x._id, pass, done: !done, at: now(), sent: now() }).catch((e) => show(errLine(e)))}>
                {done && <Icon name="check" size={14} />}
              </button>
              <span className="q">{x.qty}</span>
              <span className="t">{x.text}{x.serial4 && <span className="secondary"> · ···{x.serial4}</span>}{x.clash && <span className="warn"> · also on {x.clash}</span>}{x.flag && <span className="warn"> · {x.flag === "lost" ? "Lost" : "In repair"}</span>}</span>
              {pass === "back" && !done && (
                <span className="pk-flags">
                  <button type="button" className={`pill${x.flag === "lost" ? " on" : ""}`} onClick={() => void flag({ lineId: x._id, flag: x.flag === "lost" ? null : "lost" }).catch((e) => show(errLine(e)))}>Mark as lost</button>
                  <button type="button" className={`pill${x.flag === "repair" ? " on" : ""}`} onClick={() => void flag({ lineId: x._id, flag: x.flag === "repair" ? null : "repair" }).catch((e) => show(errLine(e)))}>In repair</button>
                </span>
              )}
            </div>
          );
        })}
        <div className="sp-actions"><Button size="sm" onClick={() => setAdding(true)}>Add from Gear</Button><Button size="sm" onClick={() => navigate(`/production/gear/packing/${l._id}`)}>Edit the list</Button></div>
      </Card>
      {adding && <AddFromGear listId={l._id} onClose={() => setAdding(false)} show={show} />}
    </>
  );
}
