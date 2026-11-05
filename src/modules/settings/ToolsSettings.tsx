// Nov 2 (Heston): Settings › Tools. Drag the side menu's tools into the order you want, take tools off it or put them
// back, and pick the Dashboard's widgets (and their order). Only your own menu changes: clients and vendors see what
// they always see, and a tool off the menu still opens from its links. Saves on every change. Built without a frame.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { DEFAULT_TOOLS, REQUIRED_TOOLS, TOOL_LABEL, WIDGET_LABEL, toolsOf, type ToolKey, type Tools, type WidgetKey } from "../../../convex/lib/tools";
import { SkeletonRows, Toggle } from "../../ui/wp";
import { Icon, type IconName } from "../../ui/Icon";
import { errText } from "../docs/pages/common";
import { SetHead } from "./Frame";

const TOOL_ICON: Record<ToolKey, IconName> = { dashboard: "home", people: "users", messages: "mail", docs: "document", payments: "invoice", production: "video", sent: "send" };
const TOOL_SUB: Record<ToolKey, string> = {
  dashboard: "Today, clients and activity", people: "Clients and vendors", messages: "Conversations with clients and leads", docs: "Proposals and contracts",
  payments: "Shows once Stripe is connected", production: "Pre-pro, shoots, Review and delivery", sent: "Notes and items you sent",
};

/** A list you can drag to reorder (mouse), or move with the arrow buttons (keyboard, phones). */
function Reorder<K extends string>({ ids, label, row, onMove }: { ids: K[]; label: string; row: (id: K, i: number) => React.ReactNode; onMove: (from: number, to: number) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return (
    <ol className="tl-list" aria-label={label}>
      {ids.map((id, i) => (
        <li key={id} className={`tl-row${drag === i ? " dragging" : ""}${over === i && drag !== null && drag !== i ? (drag < i ? " over-after" : " over-before") : ""}`}
          draggable onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); }}
          onDragOver={(e) => { if (drag === null) return; e.preventDefault(); setOver(i); }} onDragLeave={() => setOver((o) => (o === i ? null : o))}
          onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) onMove(drag, i); setDrag(null); setOver(null); }}
          onDragEnd={() => { setDrag(null); setOver(null); }}>
          <span className="tl-grip" aria-hidden><i /><i /><i /></span>
          {row(id, i)}
          <span className="tl-moves">
            <button type="button" className="icon-btn sm" aria-label="Move up" disabled={i === 0} onClick={() => onMove(i, i - 1)}><Icon name="arrow-up" size={16} /></button>
            <button type="button" className="icon-btn sm" aria-label="Move down" disabled={i === ids.length - 1} onClick={() => onMove(i, i + 1)}><Icon name="arrow-down" size={16} /></button>
          </span>
        </li>
      ))}
    </ol>
  );
}
const moved = <T,>(list: T[], from: number, to: number) => { const l = [...list]; const [x] = l.splice(from, 1); l.splice(to, 0, x); return l; };

export function ToolsSettings({ show }: { show: (m: string) => void }) {
  const me = useQuery(api.users.me);
  const save = useMutation(api.users.setTools);
  const [t, setT] = useState<Tools | null>(null);
  const saving = useRef(0);
  useEffect(() => { if (me?.tools && !t) setT(toolsOf(me.tools)); }, [me, t]);
  const head = <SetHead eyebrow="Tools" title="Your menu and Dashboard." sub="Drag tools into the order you want, take them off the menu or put them back, and pick what your Dashboard shows. Only your menu changes." />;
  if (!t) return <>{head}<div className="panel"><SkeletonRows n={6} /></div></>;
  const put = (next: Tools) => {
    setT(next);
    const n = ++saving.current;
    save({ tools: next }).then(() => { if (n === saving.current) show("Saved."); }, (e) => { show(errText(e)); if (me?.tools) setT(toolsOf(me.tools)); });
  };
  const visible = t.order.filter((k) => !t.hidden.includes(k));
  return (
    <>
      {head}
      <div className="panel pay-card tl-card">
        <span className="wp-eyebrow">Side menu</span>
        <Reorder ids={t.order} label="Tools on your side menu" onMove={(a, b) => put({ ...t, order: moved(t.order, a, b) })} row={(k) => {
          const on = !t.hidden.includes(k);
          const tab = visible.indexOf(k);
          return <>
            <Icon name={TOOL_ICON[k]} size={20} />
            <span className="tl-txt"><b>{TOOL_LABEL[k]}</b><span className="secondary">{TOOL_SUB[k]}{on && tab >= 0 && tab < 4 ? " · on the phone tab bar" : ""}</span></span>
            <Toggle label={`${TOOL_LABEL[k]} on the menu`} checked={on} disabled={REQUIRED_TOOLS.includes(k)}
              onChange={(v) => put({ ...t, hidden: v ? t.hidden.filter((x) => x !== k) : [...t.hidden, k] })} />
          </>;
        }} />
        <p className="wp-small secondary tl-note">The Dashboard always stays on. A tool off the menu still opens from links and search. On phones the first four go in the tab bar; the rest are under More.</p>
      </div>
      <div className="panel pay-card tl-card">
        <span className="wp-eyebrow">Dashboard widgets</span>
        <Reorder ids={t.widgets.map((w) => w.id)} label="Dashboard widgets" onMove={(a, b) => put({ ...t, widgets: moved(t.widgets, a, b) })} row={(id: WidgetKey) => {
          const w = t.widgets.find((x) => x.id === id)!;
          return <>
            <span className="tl-txt"><b>{WIDGET_LABEL[id].label}</b><span className="secondary">{WIDGET_LABEL[id].sub}</span></span>
            <Toggle label={`${WIDGET_LABEL[id].label} on the Dashboard`} checked={w.on} onChange={(v) => put({ ...t, widgets: t.widgets.map((x) => (x.id === id ? { ...x, on: v } : x)) })} />
          </>;
        }} />
        <p className="wp-small secondary tl-note">On a wide screen, lists stay on the left and Live edits, Money this month, Recent activity and Recurring revenue on the right, each in this order.</p>
        <button type="button" className="btn ghost sm" onClick={() => put(DEFAULT_TOOLS)}>Reset menu and Dashboard</button>
      </div>
    </>
  );
}
