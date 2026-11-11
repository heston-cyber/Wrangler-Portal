// Phase 5b step 5 (Nov 3, D143): Production › Calendar, two-way with Google Calendar. Approved frames: Month 772:7557,
// Google disconnected 772:8371, Week 772:9181, Agenda 775:8285, Event open 773:7781, New event 773:8161; phone Month
// 773:8316, Agenda 775:9108, New event 773:8774; expanded Week 778:8745 (dragging 778:8996, resizing 778:9253), Month
// 779:8778 (dragging 779:9097); Move event with guests 779:9427; Event moved toast 779:9462.
// Dragging (expanded view only, pointer events): move to another time or day, drag the bottom edge to resize, 15-minute
// snap; click an empty slot to add. The keyboard way to do the same is Edit (every event is a button). Phones use Edit.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, DialogHeader, PageHeader, PillTabs, SkeletonRows, Toggle } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useConfirm, useIsNarrow, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { ShootDialog } from "../projects/Shoots";
import {
  addDays, addMonths, clock, dayHead, dayNum, dayShort, daysBetween, firstOfMonth, layoutDay, monthGrid, monthOf, monthTitle, moveNeedsAsk, nowLocal,
  onDay, snap15, sortItems, startOfWeek, tiny, toHHMM, toMin, weekTitle, weekday, type Item,
} from "./calendarModel";

type Data = NonNullable<ReturnType<typeof useQuery<typeof api.calendarSync.range>>>;
type View = "month" | "week" | "agenda";
type Span = { date: string; endDate: string; start?: string; end?: string };
type Layers = { shoots: boolean; dates: boolean };

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } },
};
const plusTwo = (call: string) => { const h = Number(call.slice(0, 2)); return h >= 22 ? "23:59" : `${String(h + 2).padStart(2, "0")}${call.slice(2)}`; };
function ago(t: number | null | undefined) {
  if (!t) return "not yet";
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
const at = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const spanText = (s: { date: string; endDate: string; start?: string | null; end?: string | null }) =>
  `${dayShort(s.date)}${s.endDate !== s.date ? ` – ${dayShort(s.endDate)}` : ""}${s.start ? ` · ${clock(s.start)}${s.end ? ` – ${clock(s.end)}` : ""}` : ""}`;
const timeText = (x: Item) => (x.start ? `${clock(x.start)}${x.end && x.end !== x.start ? ` – ${clock(x.end)}` : ""}` : "All day");
const colorVar = (c: Item["color"]) => (c === "shoot" ? "var(--cal-shoot)" : c === "date" ? "var(--cal-date)" : `var(--cal-${Number(c) % 8})`);

/** Everything on the calendar, as one list. */
function toItems(d: Data, layers: Layers): Item[] {
  const names = new Map(d.conn.calendars.map((c) => [c.id, c] as const));
  const out: Item[] = [];
  if (layers.shoots) for (const s of d.shoots) {
    out.push({ key: `s:${s._id}`, kind: "shoot", title: `${s.client ?? s.project} shoot`, date: s.date, endDate: s.date, start: s.call, end: s.wrap ?? plusTwo(s.call), color: "shoot",
      where: s.location, source: "Portal", guests: s.guests, people: s.people, canDrag: true, hasEnd: !!s.wrap, ref: { shootId: s._id, projectId: s.projectId } });
  }
  if (layers.dates) for (const x of d.dates) {
    out.push({ key: `d:${x.projectId}:${x.label}:${x.date}`, kind: "date", title: `Edit dates · ${x.project}`, date: x.date, endDate: x.date, start: null, end: null, color: "date",
      where: null, source: "Portal", guests: [], canDrag: true, ref: { projectId: x.projectId, label: x.label } });
  }
  for (const e of d.events) {
    const cal = names.get(e.calendarId);
    out.push({ key: `e:${e._id}`, kind: "event", title: e.title, date: e.date, endDate: e.endDate, start: e.start, end: e.end, color: cal?.color ?? 0, where: e.location,
      source: cal?.name ?? "Google", guests: e.guests, canDrag: !e.readOnly, ref: { eventId: e._id, projectId: e.projectId ?? undefined } });
  }
  return out.sort(sortItems);
}

// ---------- the page ----------

export default function CalendarPage() {
  const narrow = useIsNarrow();
  const [view, setViewRaw] = useState<View>(() => store.get<View>("wp.cal.view", "month"));
  const setView = (v: View) => { setViewRaw(v); store.set("wp.cal.view", v); };
  const [anchor, setAnchor] = useState(() => nowLocal().date);
  const [layers, setLayersRaw] = useState<Layers>(() => store.get("wp.cal.layers", { shoots: true, dates: true }));
  const setLayers = (l: Layers) => { setLayersRaw(l); store.set("wp.cal.layers", l); };
  const [expanded, setExpanded] = useState(false);
  const [picked, setPicked] = useState(() => nowLocal().date); // the phone month's selected day
  const { from, to } = useMemo(() => {
    if (view === "month") { const g = monthGrid(anchor); return { from: g[0], to: g[41] }; }
    if (view === "week") { const s = startOfWeek(anchor); return { from: s, to: addDays(s, 6) }; }
    return { from: anchor, to: addDays(anchor, 6) };
  }, [view, anchor]);
  const d = useQuery(api.calendarSync.range, { from, to });
  const items = useMemo(() => (d ? toItems(d, layers) : []), [d, layers]);
  const [open, setOpen] = useState<{ item: Item; rect: DOMRect | null } | null>(null);
  const [form, setForm] = useState<{ edit?: Item; init?: Partial<Span> } | null>(null);
  const [editShoot, setEditShoot] = useState<Item | null>(null);
  const moves = useMover(d);
  const step = (n: number) => setAnchor(view === "month" ? addMonths(anchor, n) : addDays(view === "week" ? startOfWeek(anchor) : anchor, 7 * n));
  const title = view === "month" ? monthTitle(anchor) : view === "week" ? weekTitle(startOfWeek(anchor)) : `${dayShort(anchor).replace(/^\w+ /, "")} – ${dayShort(addDays(anchor, 6)).replace(/^\w+ /, "")}`;
  const today = d?.today ?? nowLocal().date;
  const state = d?.conn.state;
  const canAdd = state === "ok";

  useEffect(() => {
    if (!expanded) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !open && !form && !moves.asking) setExpanded(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [expanded, open, form, moves.asking]);

  const views = <PillTabs label="Calendar view" value={view} onChange={setView} items={[{ key: "month", label: "Month" }, { key: "week", label: "Week" }, { key: "agenda", label: "Agenda" }]} />;
  const nav = (
    <div className="cal-nav">
      <button className="btn ghost sm cal-arrow" type="button" aria-label="Back" onClick={() => step(-1)}><Icon name="arrow-left" size={16} /></button>
      <button className="btn sm" type="button" onClick={() => { setAnchor(today); setPicked(today); }}>Today</button>
      <button className="btn ghost sm cal-arrow" type="button" aria-label="Next" onClick={() => step(1)}><Icon name="arrow-right" size={16} /></button>
    </div>
  );
  const newEvent = <Button variant="primary" disabled={d !== undefined && !canAdd} onClick={() => setForm({ init: {} })}>New event</Button>;
  const openItem = (item: Item, el: HTMLElement | null) => setOpen({ item, rect: el?.getBoundingClientRect() ?? null });
  const add = (date: string, start?: string) => { if (canAdd) setForm({ init: { date, endDate: date, ...(start ? { start, end: toHHMM(Math.min(toMin(start) + 60, 23 * 60 + 59)) } : {}) } }); };

  const body = (dragOn: boolean) => d === undefined ? <Card label="Loading"><SkeletonRows n={6} /></Card>
    : view === "month" ? <MonthGrid anchor={anchor} today={today} items={items} drag={dragOn} onOpen={openItem} onAdd={add} onDrop={moves.drop} />
    : view === "week" ? <WeekGrid start={startOfWeek(anchor)} today={today} items={items} drag={dragOn} onOpen={openItem} onAdd={add} onDrop={moves.drop} tall={dragOn} />
    : <Agenda from={anchor} today={today} items={items} onOpen={openItem} />;

  if (narrow && form) return <EventForm data={d} edit={form.edit} init={form.init} onClose={() => setForm(null)} page />;

  return (
    <>
      <TopBar><span className="secondary">Production</span><Sep /><a {...linkProps("/production/prin-pro")}>Prin-pro</a><Sep /><span className="here">Calendar</span></TopBar>
      <div className="wp-page cal">
        <PageHeader title="Calendar." sub={narrow ? (view === "agenda" ? "Next 7 days" : view === "week" ? weekTitle(startOfWeek(anchor)) : monthTitle(anchor)) : "Your shoots and edit dates, and your Google Calendars, in one place."} actions={newEvent} />
        {d && d.conn.state === "disconnected" && <Disconnected />}
        {narrow ? <>
          <div className="cal-phone-bar">{views}</div>
          {d === undefined ? <Card label="Loading"><SkeletonRows n={5} /></Card>
            : view === "month" ? <>
              <div className="cal-phone-nav"><button className="btn ghost sm cal-arrow" type="button" aria-label="Previous month" onClick={() => step(-1)}><Icon name="arrow-left" size={16} /></button><b>{monthTitle(anchor)}</b><button className="btn ghost sm cal-arrow" type="button" aria-label="Next month" onClick={() => step(1)}><Icon name="arrow-right" size={16} /></button></div>
              <PhoneMonth anchor={anchor} today={today} items={items} picked={picked} onPick={setPicked} />
              <Card label={dayHead(picked)} className="cal-dayc">
                <div className="cal-ahead">{dayHead(picked)}{picked === today ? " · TODAY" : ""}</div>
                <AgendaRows items={items.filter((x) => onDay(x, picked))} onOpen={openItem} empty="Nothing on this day." />
              </Card>
            </>
            : <Agenda from={view === "week" ? startOfWeek(anchor) : anchor} today={today} items={items} onOpen={openItem} />}
          {d && <SyncCard d={d} />}
        </> : (
          <div className="cal-cols">
            <aside className="cal-rail">
              <MiniMonth anchor={anchor} today={today} onPick={(x) => setAnchor(x)} onMonth={(x) => setAnchor(x)} />
              {d && <LayersCard d={d} layers={layers} setLayers={setLayers} />}
              {d && <SyncCard d={d} />}
            </aside>
            <section className="cal-main" aria-label="Calendar">
              <div className="cal-bar">{views}<span className="sp" /><button className="btn ghost sm cal-expand" type="button" onClick={() => setExpanded(true)}>Expand</button>{nav}<h2 className="cal-title">{title}</h2></div>
              {body(false)}
            </section>
          </div>
        )}
      </div>
      {expanded && !narrow && createPortal(
        <div className="cal-x" role="dialog" aria-modal="true" aria-label="Calendar, expanded">
          <div className="cal-xbar">
            <button className="btn sm" type="button" onClick={() => setExpanded(false)}>Collapse</button>
            <h2 className="cal-title">{title}</h2>{views}<span className="sp" />{nav}{newEvent}
          </div>
          {body(true)}
          {moves.node}
        </div>, document.body)}
      {open && <Popover item={open.item} rect={open.rect} d={d} narrow={narrow} onClose={() => setOpen(null)}
        onEdit={() => { const it = open.item; setOpen(null); if (it.kind === "shoot") setEditShoot(it); else if (it.kind === "event") setForm({ edit: it }); }} />}
      {form && <EventForm data={d} edit={form.edit} init={form.init} onClose={() => setForm(null)} />}
      {editShoot && <EditShoot item={editShoot} onClose={() => setEditShoot(null)} />}
      {!expanded && moves.node}
    </>
  );
}

// ---------- moving (drag and drop, Undo) ----------

// Review fix M2: the toast follows the change to Google: "Saving…" until Google has it, then "Saved to Google", or
// Google's error. Undo stays for about 8 seconds (a shoot's only while its email 30 is still held).
type Watch = { kind: "event"; id: string } | { kind: "shoot"; id: string } | { kind: "date"; projectId: string; label: string; date: string };
type MoveToast = { text: string; undo?: () => Promise<unknown>; undoUntil?: number; watch?: Watch; error?: boolean };
type SaveState = "saving" | "saved" | "local" | "later" | { error: string } | null;
const UNDO_FOR = 8000;
function saveState(d: Data | undefined, w: Watch | undefined): SaveState {
  if (!d || !w) return null;
  if (w.kind === "event") {
    const e = d.events.find((x) => x._id === w.id);
    if (!e) return null;
    return e.pushError ? { error: e.pushError } : e.pending ? "saving" : "saved";
  }
  if (w.kind === "shoot") {
    const x = d.shoots.find((y) => y._id === w.id);
    if (!x) return null;
    return x.calError ? { error: x.calError } : x.saving ? "saving" : x.onGoogle ? "saved" : "local";
  }
  if (d.conn.state !== "ok") return "later";
  const x = d.dates.find((y) => y.projectId === w.projectId && y.label === w.label && y.date === w.date);
  if (!x) return null;
  if (x.saving && d.conn.lastError?.startsWith("An edit date")) return { error: d.conn.lastError.replace(/^An edit date didn't reach your calendar: /, "") };
  return x.saving ? "saving" : "saved";
}
const saveText = (st: SaveState) => st === "saving" ? "Saving…" : st === "saved" ? "Saved to Google." : st === "later" ? "Google gets it when you reconnect." : st && typeof st === "object" ? `Not saved to Google: ${st.error}` : "";

function useMover(d: Data | undefined) {
  const move = useMutation(api.calendarSync.move);
  const undoMove = useMutation(api.calendarSync.undoMove);
  const moveShoot = useMutation(api.calendarSync.moveShoot);
  const undoShoot = useMutation(api.calendarSync.undoShoot);
  const moveDate = useMutation(api.calendarSync.moveDate);
  const [ask, setAsk] = useState<{ item: Item; span: Span } | null>(null);
  const [toast, setToast] = useState<MoveToast | null>(null);
  const [, tick] = useState(0);
  const st = toast ? saveState(d, toast.watch) : null;
  const failed = !!toast?.error || (!!st && typeof st === "object");
  const stKey = st && typeof st === "object" ? "error" : st;
  useEffect(() => {
    if (!toast) return;
    const left = (toast.undoUntil ?? 0) - Date.now();
    const t = setTimeout(() => setToast(null), stKey === "saving" ? 60_000 : failed ? 10_000 : Math.max(4000, left));
    const u = left > 0 ? setTimeout(() => tick((n) => n + 1), left) : null; // the Undo button goes when its time is up
    return () => { clearTimeout(t); if (u) clearTimeout(u); };
  }, [toast, stKey, failed]);
  const offer = (text: string, watch: Watch, undo: () => Promise<unknown>) => setToast({ text, watch, undo, undoUntil: Date.now() + UNDO_FOR });

  const commit = useCallback(async (item: Item, span: Span, notify: boolean) => {
    const where = spanText(span);
    try {
      if (item.kind === "event") {
        await move({ eventId: item.ref.eventId!, ...span, notify });
        offer(`Moved to ${where}.`, { kind: "event", id: item.ref.eventId! }, () => undoMove({ eventId: item.ref.eventId! }));
      } else if (item.kind === "shoot") {
        const wrapWas = item.hasEnd; // a shoot with no wrap keeps none when only moved
        const resized = span.end !== undefined && toMin(span.end) - toMin(span.start!) !== toMin(item.end!) - toMin(item.start!);
        const r = await moveShoot({ shootId: item.ref.shootId!, date: span.date, call: span.start!, ...(wrapWas || resized ? { wrap: span.end } : {}), notify });
        // Review fix L2: whenever the client's people are asked to confirm again, the toast says so (guests or not).
        offer(`Moved to ${where}.${r.told ? " The client is asked to confirm again." : ""}`, { kind: "shoot", id: item.ref.shootId! }, () => undoShoot({ shootId: item.ref.shootId! }));
      } else {
        await moveDate({ projectId: item.ref.projectId!, label: item.ref.label!, from: item.date, to: span.date });
        offer(`Moved to ${dayShort(span.date)}.`, { kind: "date", projectId: item.ref.projectId!, label: item.ref.label!, date: span.date },
          () => moveDate({ projectId: item.ref.projectId!, label: item.ref.label!, from: span.date, to: item.date }));
      }
    } catch (e) { setToast({ text: errText(e), error: true }); }
  }, [move, undoMove, moveShoot, undoShoot, moveDate]);

  const drop = useCallback((item: Item, span: Span) => {
    if (span.date === item.date && span.endDate === item.endDate && (span.start ?? null) === item.start && (span.end ?? null) === item.end) return;
    if (moveNeedsAsk(item)) setAsk({ item, span }); else void commit(item, span, false);
  }, [commit]);

  const canUndo = !!toast?.undo && !failed && Date.now() < (toast.undoUntil ?? 0);
  const node = <>
    {ask && <MoveDialog item={ask.item} span={ask.span} onCancel={() => setAsk(null)} onMove={(notify) => { const a = ask; setAsk(null); void commit(a.item, a.span, notify); }} />}
    {toast && createPortal(
      <div className={`toast cal-toast${failed ? " error" : ""}`} role="status">
        {!failed && stKey !== "saving" && <span className="cal-ok" aria-hidden />}<span>{toast.error ? toast.text : `${toast.text} ${saveText(st)}`.trim()}</span>
        {canUndo && <button className="cal-undo" type="button" onClick={async () => { const u = toast.undo!; const w = toast.watch; setToast(null); try { await u(); setToast({ text: "Moved back.", watch: w }); } catch (e) { setToast({ text: errText(e), error: true }); } }}>Undo</button>}
      </div>, document.body)}
  </>;
  return { drop, node, asking: !!ask };
}

function MoveDialog({ item, span, onCancel, onMove }: { item: Item; span: Span; onCancel: () => void; onMove: (notify: boolean) => void }) {
  const n = item.guests.length;
  const fromText = dayShort(item.date), toText = spanText(span);
  return (
    <Modal onClose={onCancel} label={`Move “${item.title}”?`} width={520}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Calendar" title={`Move “${item.title}”?`} body={`${fromText} → ${toText}`} onClose={onCancel} />
        <p className="secondary cal-dtext">This event has {n} guest{n === 1 ? "" : "s"}: {item.guests.join(", ")}. Google can email them the new time.
          {item.kind === "shoot" ? " The client is asked to confirm again, as when you edit the shoot." : ""}</p>
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
          <Button onClick={() => onMove(false)}>Move only</Button>
          <Button variant="primary" onClick={() => onMove(true)}>Move and notify</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Review fix L6: an edit that Google could email guests about says who, and asks first. */
function NotifyDialog({ title, added, removed, kept, timeChanged, onCancel, onSave }: { title: string; added: string[]; removed: string[]; kept: string[]; timeChanged: boolean; onCancel: () => void; onSave: (notify: boolean) => void }) {
  const list = (xs: string[]) => xs.join(", ");
  const who = [
    added.length ? `${list(added)} get${added.length === 1 ? "s" : ""} an invite` : null,
    removed.length ? `${list(removed)} hear${removed.length === 1 ? "s" : ""} it's cancelled for them` : null,
    kept.length && timeChanged ? `${list(kept)} get${kept.length === 1 ? "s" : ""} the new time` : kept.length ? `${list(kept)} get${kept.length === 1 ? "s" : ""} the update` : null,
  ].filter(Boolean).join("; ");
  return (
    <Modal onClose={onCancel} label={`Email the guests about “${title}”?`} width={520}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Calendar" title="Email the guests?" body={title} onClose={onCancel} />
        <p className="secondary cal-dtext">Save and email: Google emails them. {who}.</p>
        <p className="secondary cal-dtext">Save only: nobody is emailed{added.length ? `, and ${list(added)} won't get an invite` : ""}.</p>
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
          <Button onClick={() => onSave(false)}>Save only</Button>
          <Button variant="primary" onClick={() => onSave(true)}>Save and email</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- month ----------

function Chip({ x, onOpen, drag, ghost, onPointerDown }: { x: Item; onOpen: (x: Item, el: HTMLElement) => void; drag?: boolean; ghost?: boolean; onPointerDown?: (e: React.PointerEvent) => void }) {
  return (
    <button type="button" className={`cal-chip${ghost ? " ghosted" : ""}${drag && x.canDrag ? " grab" : ""}`} style={{ "--c": colorVar(x.color) } as React.CSSProperties}
      onClick={(e) => { if (!drag) onOpen(x, e.currentTarget); }} onPointerDown={onPointerDown} title={`${x.title}${x.start ? ` · ${clock(x.start)}` : ""}`}
      onKeyDown={(e) => { if (drag && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(x, e.currentTarget); } }}>
      {x.kind === "event" && x.start ? `${tiny(x.start)} ` : ""}{x.title}
    </button>
  );
}

function MonthGrid({ anchor, today, items, drag, onOpen, onAdd, onDrop }: { anchor: string; today: string; items: Item[]; drag: boolean; onOpen: (x: Item, el: HTMLElement) => void; onAdd: (date: string) => void; onDrop: (x: Item, s: Span) => void }) {
  const days = monthGrid(anchor);
  const grid = useRef<HTMLDivElement>(null);
  const [dr, setDr] = useState<{ item: Item; x0: number; y0: number; over: string | null; moved: boolean; el: HTMLElement } | null>(null);
  const cellAt = (x: number, y: number) => {
    const r = grid.current!.getBoundingClientRect();
    const col = Math.max(0, Math.min(6, Math.floor(((x - r.left) / r.width) * 7)));
    const row = Math.max(0, Math.min(5, Math.floor(((y - r.top) / r.height) * 6)));
    return days[row * 7 + col];
  };
  const down = (x: Item) => (e: React.PointerEvent) => {
    if (!drag || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDr({ item: x, x0: e.clientX, y0: e.clientY, over: null, moved: false, el: e.currentTarget as HTMLElement });
  };
  const moveP = (e: React.PointerEvent) => {
    if (!dr) return;
    const moved = dr.moved || Math.hypot(e.clientX - dr.x0, e.clientY - dr.y0) > 4;
    if (moved) setDr({ ...dr, moved, over: cellAt(e.clientX, e.clientY) });
  };
  const up = () => {
    if (!dr) return;
    const { item, over, moved, el } = dr;
    setDr(null);
    if (!moved) { onOpen(item, el); return; }
    if (!over || !item.canDrag) return;
    const shift = daysBetween(item.date, over);
    onDrop(item, { date: over, endDate: addDays(item.endDate, shift), ...(item.start ? { start: item.start, end: item.end ?? undefined } : {}) });
  };
  return (
    <div className={`cal-month${drag ? " dragging-on" : ""}`} onPointerMove={moveP} onPointerUp={up} onPointerCancel={() => setDr(null)}>
      <div className="cal-wk">{["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((w) => <span key={w}>{w}</span>)}</div>
      <div className="cal-mgrid" ref={grid}>
        {days.map((day) => {
          const here = items.filter((x) => onDay(x, day));
          const out = monthOf(day) !== monthOf(anchor);
          const target = dr?.moved && dr.over === day;
          return (
            <div key={day} className={`cal-cell${out ? " out" : ""}${target ? " target" : ""}`} onClick={(e) => { if (e.target === e.currentTarget && !out) onAdd(day); }}>
              <span className={`cal-dn${day === today ? " today" : ""}`}>{dayNum(day)}</span>
              <div className="cal-chips">
                {here.slice(0, 3).map((x) => <Chip key={x.key} x={x} onOpen={onOpen} drag={drag} ghost={dr?.moved && dr.item.key === x.key} onPointerDown={down(x)} />)}
                {here.length > 3 && <span className="cal-more">+{here.length - 3} more</span>}
                {target && dr && <span className="cal-chip preview" style={{ "--c": colorVar(dr.item.color) } as React.CSSProperties}>{dr.item.title}</span>}
              </div>
              {target && <span className="cal-tip">{dayShort(day)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- week ----------

function WeekGrid({ start, today, items, drag, onOpen, onAdd, onDrop, tall }: { start: string; today: string; items: Item[]; drag: boolean; onOpen: (x: Item, el: HTMLElement) => void; onAdd: (date: string, start?: string) => void; onDrop: (x: Item, s: Span) => void; tall?: boolean }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const H = tall ? 56 : 52; // px per hour
  const scroller = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);
  const allday = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(nowLocal());
  useEffect(() => { const t = setInterval(() => setNow(nowLocal()), 60_000); return () => clearInterval(t); }, []);
  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = 7 * H - 8; }, [H, start]);
  type Drag = { item: Item; mode: "move" | "resize" | "allday"; x0: number; y0: number; moved: boolean; el: HTMLElement; col0: number; span: Span };
  const [dr, setDr] = useState<Drag | null>(null);
  const colAt = (x: number, el: HTMLDivElement | null) => { const r = el!.getBoundingClientRect(); return Math.max(0, Math.min(6, Math.floor(((x - r.left) / r.width) * 7))); };
  const down = (x: Item, mode: Drag["mode"]) => (e: React.PointerEvent) => {
    if (!drag || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const col0 = Math.max(0, days.indexOf(x.date));
    setDr({ item: x, mode, x0: e.clientX, y0: e.clientY, moved: false, el: (mode === "resize" ? (e.currentTarget as HTMLElement).parentElement : e.currentTarget) as HTMLElement, col0, span: { date: x.date, endDate: x.endDate, ...(x.start ? { start: x.start, end: x.end ?? x.start } : {}) } });
  };
  const moveP = (e: React.PointerEvent) => {
    if (!dr) return;
    const moved = dr.moved || Math.hypot(e.clientX - dr.x0, e.clientY - dr.y0) > 4;
    if (!moved) return;
    const it = dr.item;
    if (!it.canDrag) { setDr({ ...dr, moved }); return; }
    const col = colAt(e.clientX, dr.mode === "allday" ? allday.current : cols.current);
    const shift = col - dr.col0;
    let span: Span;
    if (dr.mode === "allday" || !it.start) span = { date: addDays(it.date, shift), endDate: addDays(it.endDate, shift) };
    else {
      const delta = snap15(((e.clientY - dr.y0) / H) * 60);
      const s0 = toMin(it.start), e0 = toMin(it.end ?? it.start);
      if (dr.mode === "resize") span = { date: it.date, endDate: it.endDate, start: it.start, end: toHHMM(Math.max(s0 + 15, Math.min(24 * 60 - 1, snap15(e0 + delta)))) };
      else if (it.endDate !== it.date) span = { date: addDays(it.date, shift), endDate: addDays(it.endDate, shift), start: it.start, end: it.end ?? undefined };
      else { const dur = e0 - s0; const s = Math.max(0, Math.min(24 * 60 - 15 - Math.max(0, dur - 15), s0 + delta)); span = { date: addDays(it.date, shift), endDate: addDays(it.date, shift), start: toHHMM(s), end: toHHMM(Math.min(24 * 60 - 1, s + dur)) }; }
    }
    setDr({ ...dr, moved, span });
  };
  const up = () => {
    if (!dr) return;
    const d0 = dr;
    setDr(null);
    if (!d0.moved) { onOpen(d0.item, d0.el); return; }
    if (d0.item.canDrag) onDrop(d0.item, d0.span);
  };
  const ghostOf = (x: Item) => dr?.moved && dr.item.key === x.key;
  const preview = dr?.moved && dr.item.canDrag ? { ...dr.item, date: dr.span.date, endDate: dr.span.endDate, start: dr.span.start ?? null, end: dr.span.end ?? null, key: "preview" } : null;
  return (
    <div className={`cal-week${tall ? " tall" : ""}`} onPointerMove={moveP} onPointerUp={up} onPointerCancel={() => setDr(null)}>
      <div className="cal-whead">
        <span />
        {days.map((day) => <span key={day} className={day === today ? "today" : ""}><small>{weekday(day)}</small> <b className={day === today ? "cal-dn today" : ""}>{dayNum(day)}</b></span>)}
      </div>
      <div className="cal-allday">
        <span className="lbl">All day</span>
        <div className="cal-adcols" ref={allday}>
          {days.map((day) => (
            <div key={day} className="cal-adcol">
              {items.filter((x) => !x.start && onDay(x, day)).map((x) => <Chip key={x.key} x={x} onOpen={onOpen} drag={drag} ghost={ghostOf(x)} onPointerDown={down(x, "allday")} />)}
              {preview && !preview.start && onDay(preview, day) && <span className="cal-chip preview" style={{ "--c": colorVar(preview.color) } as React.CSSProperties}>{preview.title}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="cal-wscroll" ref={scroller}>
        <div className="cal-wbody" style={{ height: 24 * H }}>
          <div className="cal-hours">{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ top: h * H }}>{h === 0 ? "" : clock(`${String(h).padStart(2, "0")}:00`, true)}</span>)}</div>
          <div className="cal-wcols" ref={cols}>
            {days.map((day) => {
              const laid = layoutDay(items, day);
              const pv = preview && preview.start && onDay(preview, day) ? layoutDay([preview], day)[0] : null;
              return (
                <div key={day} className={`cal-wcol${dr?.moved && dr.span.date === day ? " target" : ""}`}
                  onClick={(e) => { if (e.target !== e.currentTarget || dr) return; const r = e.currentTarget.getBoundingClientRect(); onAdd(day, toHHMM(Math.min(23 * 60, Math.floor(((e.clientY - r.top) / H) * 4) * 15))); }}>
                  {Array.from({ length: 24 }, (_, h) => <i key={h} className="hl" style={{ top: h * H }} />)}
                  {laid.map(({ item: x, top, bottom, col, cols: n }) => (
                    <button key={x.key} type="button" className={`cal-ev${ghostOf(x) ? " ghosted" : ""}${drag && x.canDrag ? " grab" : ""}${((bottom - top) / 60) * H < 40 ? " short" : ""}`}
                      style={{ "--c": colorVar(x.color), top: (top / 60) * H, height: Math.max(22, ((bottom - top) / 60) * H - 2), left: `calc(${(col / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)` } as React.CSSProperties}
                      onPointerDown={down(x, "move")} onClick={(e) => { if (!drag) onOpen(x, e.currentTarget); }}
                      onKeyDown={(e) => { if (drag && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(x, e.currentTarget); } }}>
                      <b>{x.title}</b>
                      <span>{x.kind === "shoot" ? `${tall ? timeText(x) : `Call ${clock(x.start!)}`}${x.where && !tall ? ` · ${x.where}` : ""}` : `${clock(x.start!)}${x.kind === "event" && tall ? ` · ${x.source}` : ""}`}</span>
                      {drag && x.canDrag && x.endDate === x.date && <i className="cal-grip" onPointerDown={down(x, "resize")} aria-hidden />}
                    </button>
                  ))}
                  {pv && <div className="cal-ev preview" style={{ "--c": colorVar(pv.item.color), top: (pv.top / 60) * H, height: Math.max(22, ((pv.bottom - pv.top) / 60) * H - 2), left: 2, right: 2 } as React.CSSProperties}>
                    <b>{pv.item.title}</b><span>{clock(pv.item.start!)}{pv.item.kind === "event" ? ` · ${pv.item.source}` : ""}</span>
                    <em className="cal-tip">{dr!.mode === "resize" ? `${clock(dr!.span.start!)} – ${clock(dr!.span.end!)}` : `${dayShort(dr!.span.date)} · ${clock(dr!.span.start!).replace(/ [AP]M$/, "")} – ${clock(dr!.span.end!)}`}</em>
                  </div>}
                  {day === today && <i className="cal-now" style={{ top: (now.min / 60) * H }} aria-hidden />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- agenda ----------

function AgendaRows({ items, onOpen, empty }: { items: Item[]; onOpen: (x: Item, el: HTMLElement) => void; empty?: string }) {
  if (!items.length) return <p className="secondary cal-empty">{empty ?? "Nothing on."}</p>;
  return <>{items.map((x) => (
    <button key={x.key} type="button" className="cal-arow" onClick={(e) => onOpen(x, e.currentTarget)}>
      <Icon name={x.kind === "shoot" ? "video" : "calendar"} size={20} />
      <span className="t"><b>{x.title}</b>
        <small>{[x.kind === "date" ? x.ref.label : null, x.kind === "shoot" && !x.hasEnd ? `Call ${clock(x.start!)}` : timeText(x), x.where, x.kind === "event" ? x.source : null, x.kind === "event" ? "Google" : "Portal"].filter(Boolean).join(" · ")}</small></span>
      <Icon name="chevron-right" size={16} />
    </button>
  ))}</>;
}

function Agenda({ from, today, items, onOpen }: { from: string; today: string; items: Item[]; onOpen: (x: Item, el: HTMLElement) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i)).filter((day) => items.some((x) => onDay(x, day)));
  if (!days.length) return <Card label="Agenda"><p className="secondary cal-empty">Nothing in the next 7 days.</p></Card>;
  return (
    <div className="cal-agenda">
      {days.map((day) => (
        <section key={day} aria-label={dayShort(day)}>
          <h3 className={`cal-ahead${day === today ? " today" : ""}`}>{dayHead(day)}{day === today ? " · TODAY" : ""}</h3>
          <AgendaRows items={items.filter((x) => onDay(x, day))} onOpen={onOpen} />
        </section>
      ))}
    </div>
  );
}

// ---------- the rail ----------

function MiniMonth({ anchor, today, onPick, onMonth }: { anchor: string; today: string; onPick: (d: string) => void; onMonth: (d: string) => void }) {
  const days = monthGrid(anchor).slice(0, 35);
  const months = Array.from({ length: 25 }, (_, i) => addMonths(today, i - 12));
  return (
    <Card className="cal-mini" label="Month">
      <label className="cal-minihead">
        <span>{monthTitle(anchor)}</span><Icon name="chevron-down" size={16} />
        <select aria-label="Month" value={firstOfMonth(anchor)} onChange={(e) => onMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthTitle(m)}</option>)}</select>
      </label>
      <div className="cal-minigrid">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => <span key={i} className="wd">{w}</span>)}
        {days.map((day) => <button key={day} type="button" className={`${day === today ? "today" : ""}${monthOf(day) !== monthOf(anchor) ? " out" : ""}`} onClick={() => onPick(day)} aria-label={dayShort(day)}>{dayNum(day)}</button>)}
      </div>
    </Card>
  );
}

function Eye({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean }) {
  return <button type="button" className={`cal-eye${on ? " on" : ""}`} aria-pressed={on} aria-label={`${on ? "Hide" : "Show"} ${label}`} disabled={disabled} onClick={() => onChange(!on)}><Icon name="eye" size={16} /></button>;
}

function LayersCard({ d, layers, setLayers }: { d: Data; layers: Layers; setLayers: (l: Layers) => void }) {
  const setShown = useMutation(api.calendarSync.setShown);
  const [toast, show] = useToast();
  const cals = d.conn.calendars;
  const off = d.conn.state !== "ok";
  return (
    <Card className="cal-layers" label="Calendars">
      <div className="cal-eyebrow">In the portal</div>
      <div className="cal-layer"><i style={{ background: "var(--cal-shoot)" }} />Shoots<Eye on={layers.shoots} label="shoots" onChange={(on) => setLayers({ ...layers, shoots: on })} /></div>
      <div className="cal-layer"><i style={{ background: "var(--cal-date)" }} />Edit dates<Eye on={layers.dates} label="edit dates" onChange={(on) => setLayers({ ...layers, dates: on })} /></div>
      {cals.length > 0 && <>
        <div className="cal-eyebrow">Google Calendar</div>
        {cals.map((c) => (
          <div key={c.id} className={`cal-layer${off ? " off" : ""}`}><i style={{ background: colorVar(c.color) }} /><span className="nm">{c.name}</span>
            <Eye on={c.on} label={c.name} disabled={off} onChange={async (on) => { try { await setShown({ calendarId: c.id, on }); } catch (e) { show(errText(e)); } }} /></div>
        ))}
      </>}
      {toast}
    </Card>
  );
}

function useReconnect() {
  const authUrl = useAction(api.calendar.authUrl);
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  const go = async () => { setBusy(true); try { location.href = await authUrl({}); } catch (e) { show(errText(e)); setBusy(false); } };
  return { go, busy, toast };
}

function SyncCard({ d }: { d: Data }) {
  const sync = useAction(api.calendarSync.syncNow);
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();
  const re = useReconnect();
  const c = d.conn;
  if (c.state === "none") return (
    <Card className="cal-sync" label="Google Calendar">
      <div className="cal-synch"><span className="calx-dot warn" />Google Calendar isn't connected</div>
      <p className="secondary">Connect it to see your own events next to your shoots, and to add events from here.</p>
      <div><ButtonLink size="sm" to="/settings/calendar" iconEnd={false}>Connect Google</ButtonLink></div>
    </Card>
  );
  if (c.state === "disconnected") return (
    <Card className="cal-sync" label="Google Calendar">
      <div className="cal-synch"><span className="calx-dot warn" />Google disconnected</div>
      <p className="secondary">Events here stopped syncing {c.disconnectedAt ? at(c.disconnectedAt) : "a while ago"}. Nothing was lost.</p>
      <div><Button size="sm" variant="primary" loading={re.busy} onClick={re.go}>Reconnect Google</Button></div>{re.toast}
    </Card>
  );
  return (
    <Card className="cal-sync" label="Google Calendar">
      <div className="cal-synch"><span className="calx-dot" />Synced with Google</div>
      <p className="secondary">{c.email} · {ago(c.lastSyncedAt)}. Changes here and in Google stay in step.{!c.picked ? " Pick the calendar for new events in Settings › Calendar." : ""}</p>
      <div><Button size="sm" loading={busy} onClick={async () => { setBusy(true); try { const r = await sync({}); show(r.state === "ok" ? "Synced." : r.state === "partial" ? "Synced part of your calendar. The rest comes in with the next sync." : r.state === "busy" ? "Already syncing." : r.state === "disconnected" ? "Google disconnected. Reconnect Google." : "Google didn't answer. Try again in a minute."); } catch (e) { show(errText(e)); } finally { setBusy(false); } }}>Sync now</Button></div>
      {toast}
    </Card>
  );
}

function Disconnected() {
  const re = useReconnect();
  return (
    <div className="cal-banner" role="status">
      <Icon name="alert" size={20} />
      <div className="t"><b>Google Calendar is disconnected</b><span>Your Google events are hidden until you reconnect. Shoots and edit dates are still here. Nothing in Google was changed.</span></div>
      <Button size="sm" loading={re.busy} onClick={re.go}>Reconnect Google</Button>{re.toast}
    </div>
  );
}

// ---------- the phone month ----------

function PhoneMonth({ anchor, today, items, picked, onPick }: { anchor: string; today: string; items: Item[]; picked: string; onPick: (d: string) => void }) {
  const days = monthGrid(anchor).slice(0, 35);
  return (
    <Card className="cal-pmonth" label={monthTitle(anchor)}>
      <div className="cal-pgrid">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => <span key={i} className="wd">{w}</span>)}
        {days.map((day) => {
          const here = items.filter((x) => onDay(x, day));
          return (
            <button key={day} type="button" className={`${day === today ? "today" : ""}${day === picked ? " picked" : ""}${monthOf(day) !== monthOf(anchor) ? " out" : ""}`} onClick={() => onPick(day)} aria-label={`${dayShort(day)}${here.length ? `, ${here.length} on` : ""}`}>
              <span>{dayNum(day)}</span>
              <span className="dots">{here.slice(0, 3).map((x) => <i key={x.key} style={{ background: colorVar(x.color) }} />)}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ---------- the event, opened ----------

function Popover({ item, rect, d, narrow, onClose, onEdit }: { item: Item; rect: DOMRect | null; d: Data | undefined; narrow: boolean; onClose: () => void; onEdit: () => void }) {
  const remove = useMutation(api.calendarSync.remove);
  const cancelShoot = useMutation(api.shoots.cancel);
  const [ask, confirmNode] = useConfirm();
  const [toast, show] = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const ev = item.kind === "event" ? d?.events.find((e) => e._id === item.ref.eventId) : null;
  const shoot = item.kind === "shoot" ? d?.shoots.find((s) => s._id === item.ref.shootId) : null;
  const picked = d?.conn.calendars.find((c) => c.picked)?.name ?? null;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const click = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".dialog")) onClose(); };
    window.addEventListener("keydown", k, true);
    const t = setTimeout(() => window.addEventListener("pointerdown", click), 0);
    ref.current?.querySelector<HTMLElement>("button, a")?.focus();
    return () => { window.removeEventListener("keydown", k, true); clearTimeout(t); window.removeEventListener("pointerdown", click); };
  }, [onClose]);
  const synced = item.kind === "date" ? null : item.kind === "shoot" ? (shoot?.calError ? `Not saved to Google: ${shoot.calError}` : shoot?.saving ? "Saving to Google…" : shoot?.onGoogle ? `Synced to Google ${ago(shoot.syncedAt)}` : null)
    : ev?.pushError ? `Not saved to Google: ${ev.pushError}` : ev?.pending ? "Saving to Google…" : `Synced to Google ${ago(ev?.syncedAt)}`;
  const people = item.kind === "shoot" ? shoot?.crew ?? [] : item.guests;
  const W = 340;
  const style: React.CSSProperties = narrow || !rect ? {} : (() => {
    const left = rect.right + 12 + W < window.innerWidth ? rect.right + 12 : Math.max(12, rect.left - 12 - W);
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - 340));
    return { left, top, width: W };
  })();
  const del = async () => {
    if (item.kind === "shoot") {
      if (!(await ask({ title: "Cancel this shoot?", body: "It comes off the calendar and Google Calendar, and the client's people see it's cancelled in their Inbox.", yes: "Cancel shoot", no: "Keep it" }))) return;
      try { await cancelShoot({ shootId: item.ref.shootId as Id<"shoots"> }); onClose(); } catch (e) { show(errText(e)); }
      return;
    }
    const n = item.guests.length;
    if (!(await ask({ title: `Delete “${item.title}”?`, body: `It's deleted from Google Calendar too.${n ? ` Google emails its ${n} guest${n === 1 ? "" : "s"} that it's cancelled.` : ""}${ev?.recurring ? " Only this occurrence goes." : ""}`, yes: "Delete" }))) return;
    try { await remove({ eventId: item.ref.eventId! }); onClose(); } catch (e) { show(errText(e)); }
  };
  const inner = (
    <div className="cal-pop-in">
      <div className="cal-pophead"><i style={{ background: colorVar(item.color) }} /><b>{item.title}</b><button type="button" className="x" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button></div>
      <ul className="cal-facts">
        {item.kind === "date" && <li><Icon name="stage" size={16} />{item.ref.label}</li>}
        <li><Icon name="clock" size={16} />{dayShort(item.date)}{item.endDate !== item.date ? ` – ${dayShort(item.endDate)}` : ""} · {timeText(item)}</li>
        {item.where && <li><Icon name="map-pin" size={16} />{item.where}</li>}
        <li><Icon name="calendar" size={16} />{item.kind === "event" ? `${item.source} · on Google Calendar` : item.kind === "shoot" ? (shoot?.onGoogle && picked ? `${picked} · on Google Calendar` : "Portal only") : `Edit dates · ${picked ? `on ${picked}` : "portal"}`}</li>
        {people.length > 0 && <li><Icon name="users" size={16} />{people.join(", ")}</li>}
        {ev?.recurring && <li><Icon name="info" size={16} />Repeats in Google. Changes here are for this occurrence only.</li>}
        {ev?.readOnly && <li><Icon name="lock" size={16} />Read only here: someone else's invite, or a calendar you can only read.</li>}
        {item.kind === "date" && <li><Icon name="info" size={16} />Written to Google from the portal. Change it here: a change made in Google is put back.</li>}
      </ul>
      {synced && <div className={`cal-synced${ev?.pushError || shoot?.calError ? " bad" : ""}`}><i />{synced}</div>}
      <div className="cal-popacts">
        {item.kind === "shoot" && (shoot?.sheetId ? <ButtonLink size="sm" variant="primary" to={`/production/call-sheets/${shoot.sheetId}`} iconEnd={false}>Open call sheet</ButtonLink>
          : <ButtonLink size="sm" variant="primary" to={`/projects/${item.ref.projectId}`} iconEnd={false}>Open project</ButtonLink>)}
        {item.kind === "date" && <ButtonLink size="sm" variant="primary" to={`/projects/${item.ref.projectId}`} iconEnd={false}>Open project</ButtonLink>}
        {(item.kind === "shoot" || (item.kind === "event" && !ev?.readOnly)) && <Button size="sm" onClick={onEdit}>Edit</Button>}
      </div>
      {item.kind !== "date" && (
        <div className="cal-popfoot">
          {ev?.htmlLink ? <a href={ev.htmlLink} target="_blank" rel="noreferrer">Open in Google</a> : <span />}
          {(item.kind === "shoot" || !ev?.readOnly) && <button type="button" onClick={del}>Delete</button>}
        </div>
      )}
      {confirmNode}{toast}
    </div>
  );
  if (narrow) return <Modal onClose={onClose} label={item.title}><div ref={ref}>{inner}</div></Modal>;
  return createPortal(<div ref={ref} className="cal-pop" role="dialog" aria-label={item.title} style={style}>{inner}</div>, document.body);
}

function EditShoot({ item, onClose }: { item: Item; onClose: () => void }) {
  const data = useQuery(api.shoots.forProject, { projectId: item.ref.projectId! });
  const [toast, show] = useToast();
  const shoot = data?.shoots.find((s) => s._id === item.ref.shootId) ?? null;
  if (!data || !shoot) return null;
  return <>{<ShootDialog projectId={item.ref.projectId as Id<"projects">} label={item.title} data={data} shoot={shoot} client={null} people={data.people} onClose={onClose} show={show} />}{toast}</>;
}

// ---------- New event / Edit ----------

function EventForm({ data, edit, init, onClose, page }: { data: Data | undefined; edit?: Item; init?: Partial<Span>; onClose: () => void; page?: boolean }) {
  const create = useMutation(api.calendarSync.create);
  const update = useMutation(api.calendarSync.update);
  const links = useQuery(api.calendarSync.linkOptions, {});
  const ev = edit ? data?.events.find((e) => e._id === edit.ref.eventId) : null;
  const now = nowLocal();
  const nextHour = toHHMM(Math.min(22 * 60, Math.ceil((now.min + 1) / 60) * 60));
  const [title, setTitle] = useState(edit?.title ?? "");
  const [date, setDate] = useState(edit?.date ?? init?.date ?? now.date);
  const [endDate, setEndDate] = useState(edit?.endDate ?? init?.endDate ?? init?.date ?? now.date);
  const [allDay, setAllDay] = useState(edit ? !edit.start : false);
  const [start, setStart] = useState(edit?.start ?? init?.start ?? nextHour);
  const [end, setEnd] = useState(edit?.end ?? init?.end ?? toHHMM(toMin(nextHour) + 60));
  const cals = data ? data.conn.calendars.filter((c) => c.writable) : [];
  const [calendarId, setCalendarId] = useState(ev?.calendarId ?? (data?.conn.picked ?? ""));
  const [where, setWhere] = useState(edit?.where ?? "");
  const [guests, setGuests] = useState((ev?.guestEmails ?? []).join(", "));
  const [link, setLink] = useState(ev?.shootId ? `s:${ev.shootId}` : ev?.projectId ? `p:${ev.projectId}` : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<Span | null>(null);
  const emails = guests.split(/[,;\s]+/).map((g) => g.trim()).filter(Boolean);
  const before = (ev?.guestEmails ?? []).map((g) => g.toLowerCase());
  const now_ = [...new Set(emails.map((g) => g.toLowerCase()))];
  const added = now_.filter((g) => !before.includes(g)), removed = before.filter((g) => !now_.includes(g)), kept = now_.filter((g) => before.includes(g));
  const span = (): Span => ({ date, endDate: endDate < date ? date : endDate, ...(allDay ? {} : { start, end }) });
  const save = async (notify?: boolean) => {
    setBusy(true); setErr(null);
    const s = span();
    const base = { title, ...s, location: where, guests: emails, ...(link.startsWith("s:") ? { shootId: link.slice(2) } : {}), ...(link.startsWith("p:") ? { projectId: link.slice(2) } : {}) };
    try {
      if (edit) {
        const timeChanged = s.date !== edit.date || s.endDate !== edit.endDate || (s.start ?? null) !== edit.start || (s.end ?? null) !== edit.end;
        if (notify === undefined && ((timeChanged && emails.length) || added.length || removed.length)) { setAsk(s); setBusy(false); return; }
        await update({ eventId: edit.ref.eventId!, ...base, notify: !!notify });
      } else await create({ ...base, ...(calendarId ? { calendarId } : {}) });
      onClose();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  const fields = (
    <>
      <label className="wp-field"><span className="wp-field-label">Title</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Location scout · Floor Trader" autoFocus maxLength={200} /></label>
      <div className="cal-frow">
        <label className="wp-field grow"><span className="wp-field-label">Date</span><input className="input" type="date" value={date} onChange={(e) => { setDate(e.target.value); if (endDate < e.target.value || endDate === date) setEndDate(e.target.value); }} /></label>
        {!allDay && <>
          <label className="wp-field"><span className="wp-field-label">Start</span><input className="input" type="time" step={900} value={start} onChange={(e) => { const v = e.target.value; const dur = toMin(end) - toMin(start); setStart(v); if (v && dur > 0) setEnd(toHHMM(Math.min(24 * 60 - 1, toMin(v) + dur))); }} /></label>
          <label className="wp-field"><span className="wp-field-label">End</span><input className="input" type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </>}
        {allDay && <label className="wp-field grow"><span className="wp-field-label">Last day</span><input className="input" type="date" min={date} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>}
      </div>
      <div className="cal-allrow"><span>All day</span><Toggle checked={allDay} onChange={setAllDay} label="All day" /></div>
      {!edit && <label className="wp-field"><span className="wp-field-label">Calendar</span>
        <select className="input" value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>{cals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <span className="wp-field-hint">One of your connected Google Calendars.</span></label>}
      <label className="wp-field"><span className="wp-field-label">Where</span><input className="input" value={where} onChange={(e) => setWhere(e.target.value)} maxLength={300} /></label>
      <label className="wp-field"><span className="wp-field-label">Guests</span><input className="input" value={guests} onChange={(e) => setGuests(e.target.value)} inputMode="email" placeholder="" />
        <span className="wp-field-hint">{page ? "Google sends the invites." : "Email addresses. Google sends the invites."}</span></label>
      {!page && <label className="wp-field"><span className="wp-field-label">Link to a shoot or project (optional)</span>
        <select className="input" value={link} onChange={(e) => setLink(e.target.value)}>
          <option value="">None</option>
          {(links?.shoots ?? []).length > 0 && <optgroup label="Shoots">{links!.shoots.map((s) => <option key={s._id} value={`s:${s._id}`}>{s.label}</option>)}</optgroup>}
          {(links?.projects ?? []).length > 0 && <optgroup label="Projects">{links!.projects.map((p) => <option key={p._id} value={`p:${p._id}`}>{p.label}</option>)}</optgroup>}
        </select></label>}
      {err && <p className="calx-err" role="alert">{err}</p>}
    </>
  );
  const timeMoved = !!ask && !!edit && (ask.date !== edit.date || ask.endDate !== edit.endDate || (ask.start ?? null) !== edit.start || (ask.end ?? null) !== edit.end);
  const askNode = ask && edit && (added.length || removed.length
    ? <NotifyDialog title={title || edit.title} added={added} removed={removed} kept={kept} timeChanged={timeMoved} onCancel={() => setAsk(null)} onSave={(n) => { setAsk(null); void save(n); }} />
    : <MoveDialog item={{ ...edit, guests: emails }} span={ask} onCancel={() => setAsk(null)} onMove={(n) => { setAsk(null); void save(n); }} />);
  if (page) return (
    <>
      <div className="wp-page cal cal-newpage">
        <button type="button" className="cal-back" onClick={onClose}><Icon name="arrow-left" size={20} />Calendar</button>
        <PageHeader title={edit ? "Edit event" : "New event"} sub="Saved to Google Calendar." />
        <Card label="Event" className="cal-formcard"><div className="cal-form">{fields}</div></Card>
        <div className="cal-pagefoot"><button className="btn ghost" type="button" onClick={onClose}>Cancel</button><Button variant="primary" loading={busy} onClick={() => save()}>Save event</Button></div>
      </div>
      {askNode}
    </>
  );
  return (
    <Modal onClose={onClose} label={edit ? "Edit event" : "New event"} width={600}>
      <div className="crm-dialog cal-form">
        <DialogHeader eyebrow="Calendar" title={edit ? "Edit event" : "New event"} body="Saved to Google Calendar. Changes here and in Google stay in step." onClose={onClose} />
        {fields}
        <div className="dfoot"><button className="btn ghost" type="button" onClick={onClose}>Cancel</button><Button variant="primary" loading={busy} onClick={() => save()}>Save event</Button></div>
      </div>
      {askNode}
    </Modal>
  );
}
