// Phase 5e step 4 (Nov 5): the bell beside Search (824:21452: nothing new, a count, 9+) and its panel (822:18106 …
// 822:22370: All, Quotes, Contracts, Money, Messages; Mark all read; See all). Kept apart from the pages so the shell
// can import it.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { BELL_NAMES, PANEL_GROUPS } from "../../../convex/lib/bell";
import { IconButton, ListRow, SkeletonRows } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { linkProps, navigate } from "../../lib/router";
import { ICON, NEW, ago, useOpenRow, type Row } from "./common";

// ---------- the bell ----------

/** The bell beside Search. On a computer it opens the panel; on a phone it opens the See all page. */
export function BellButton({ phone }: { phone?: boolean }) {
  const n = useQuery(api.bell.unread) ?? 0;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const label = n ? `Notifications, ${n} unread` : "Notifications";
  return (
    <span className="bell-wrap" ref={wrap}>
      <IconButton icon="bell" label={label} iconSize={phone ? 22 : 20} on={open || undefined} onClick={() => (phone ? navigate("/notifications") : setOpen((o) => !o))} />
      {n > 0 && <span className="bell-badge" aria-hidden>{n > 9 ? "9+" : n}</span>}
      {open && !phone && createPortal(<BellPanel anchor={wrap} onClose={() => setOpen(false)} />, document.body)}
    </span>
  );
}

const GROUPS: Array<{ key: "all" | keyof typeof PANEL_GROUPS; label: string }> = [
  { key: "all", label: "All" }, { key: "quotes", label: "Quotes" }, { key: "contracts", label: "Contracts" }, { key: "money", label: "Money" }, { key: "messages", label: "Messages" },
];

// In a portal: the sidebar's glass would otherwise hold the panel inside it. It sits beside the sidebar, as drawn.
function BellPanel({ anchor, onClose }: { anchor: React.RefObject<HTMLSpanElement>; onClose: () => void }) {
  const [group, setGroup] = useState<(typeof GROUPS)[number]["key"]>("all");
  const d = useQuery(api.bell.feed, { ...(group === "all" ? {} : { kinds: PANEL_GROUPS[group] }), limit: 30 });
  const markAll = useMutation(api.bell.markAllRead);
  const openRow = useOpenRow();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown); window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [onClose, anchor]);
  const side = anchor.current?.closest(".wp-side")?.getBoundingClientRect();
  const rows = (d?.rows ?? []) as Row[];
  return (
    <div ref={ref} className="bell-panel glass" role="dialog" aria-label="Notifications" style={side ? { left: side.right - 6, top: side.top + 4 } : undefined}>
      <div className="bell-head">
        <h2 className="headline">Notifications</h2>
        {!!d?.unread && <button type="button" className="bell-link" onClick={() => void markAll({})}>Mark all read</button>}
      </div>
      <div className="qz-chips bell-pills" role="group" aria-label="Show">
        {GROUPS.map((g) => <button key={g.key} type="button" className={`qz-chip${group === g.key ? " on" : ""}`} aria-pressed={group === g.key} onClick={() => setGroup(g.key)}>{g.label}</button>)}
      </div>
      <div className="bell-list">
        {d === undefined ? <SkeletonRows n={4} label="Loading notifications" />
          : !rows.length ? (
            <div className="bell-empty"><span className="ring"><Icon name="bell" size={22} /></span><b className="wp-h4">{group === "all" ? "You are all caught up" : "Nothing here yet"}</b><span className="wp-body secondary">New activity shows up here.</span></div>
          ) : rows.map((r) => (
            <ListRow key={r._id} lead={{ icon: ICON[r.kind] }} title={r.title} meta={`${BELL_NAMES[r.kind].label} · ${ago(r.at)}`} chip={r.unread ? NEW : undefined} onClick={() => openRow(r, onClose)} />
          ))}
      </div>
      {!!rows.length && <a className="btn sm bell-all" {...linkProps("/notifications")} onClick={onClose}>See all notifications</a>}
    </div>
  );
}

