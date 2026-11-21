// A tile on a tool's overview or the Dashboard: a label, a number, a line under it and a link to the deeper page.
import { Icon } from "../../ui/Icon";
import { linkProps } from "../../lib/router";
import { useHold } from "../../ui/hold";

export function Tile({ label, n, sub, to, link }: { label: string; n: React.ReactNode; sub: string; to: string; link: string }) {
  // Nov 21 (Heston): right-click a tile for Open (and Share, Copy link) like any row.
  const hold = useHold(to.startsWith("#") ? null : { id: to, title: label, href: to });
  return (
    <div className="pov-stat prod-tile" {...hold}>
      <span className="lbl">{label}</span>
      <b>{n}</b>
      <span className="sub">{sub}</span>
      {to.startsWith("#") ? <a href={to} className="go">{link}<Icon name="arrow-right" size={14} /></a>
        : <a {...linkProps(to)} className="go">{link}<Icon name="arrow-right" size={14} /></a>}
    </div>
  );
}
