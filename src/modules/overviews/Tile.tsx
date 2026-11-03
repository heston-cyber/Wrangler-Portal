// A tile on a tool's overview or the Dashboard: a label, a number, a line under it and a link to the deeper page.
import { Icon } from "../../ui/Icon";
import { linkProps } from "../../lib/router";

export function Tile({ label, n, sub, to, link }: { label: string; n: React.ReactNode; sub: string; to: string; link: string }) {
  return (
    <div className="pov-stat prod-tile">
      <span className="lbl">{label}</span>
      <b>{n}</b>
      <span className="sub">{sub}</span>
      {to.startsWith("#") ? <a href={to} className="go">{link}<Icon name="arrow-right" size={14} /></a>
        : <a {...linkProps(to)} className="go">{link}<Icon name="arrow-right" size={14} /></a>}
    </div>
  );
}
