// C9 (Oct 26): who watched a video, and how far (owner only). A chip in the video page's bar ("7 views") opens it.
import { useQuery } from "convex/react";
import { Eye, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Modal } from "../../ui/kit";
import { ago } from "../../lib/format";

export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export function watchText(w: { watchedSec: number; maxSec: number; lengthSec: number; completed: boolean }) {
  if (w.completed) return `to the end${w.lengthSec ? ` · ${clock(w.lengthSec)}` : ""}`;
  if (w.maxSec <= 0 && w.watchedSec <= 0) return "opened, didn't play";
  return `to ${clock(w.maxSec)}${w.lengthSec ? ` of ${clock(w.lengthSec)}` : ""}`;
}

export function ViewsChip({ videoId, onOpen }: { videoId: Id<"videos">; onOpen: () => void }) {
  const d = useQuery(api.views.forVideo, { videoId });
  if (!d) return null;
  const title = d.views ? `${d.views} ${d.views === 1 ? "view" : "views"} · ${d.people} ${d.people === 1 ? "person" : "people"}${d.last ? ` · last ${d.last.who}, ${ago(d.last.at)}` : ""}` : "No views yet";
  return (
    <button className="btn sm" onClick={onOpen} title={title} aria-label={title}><Eye size={15} /><span className="hide-sm">{d.views}</span></button>
  );
}

export function ViewsDialog({ videoId, title, onClose }: { videoId: Id<"videos">; title: string; onClose: () => void }) {
  const d = useQuery(api.views.forVideo, { videoId });
  const versions = d ? Object.entries(d.byVersion).map(([n, x]) => ({ n: Number(n), ...x })).filter((x) => x.views).sort((a, b) => b.n - a.n) : [];
  return (
    <Modal onClose={onClose} label="Views" width={640}>
      <div style={{ display: "grid", gap: 16 }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">Views</span>
            <h2 className="headline">{title}. <span className="rest">{d ? (d.views ? `${d.views} ${d.views === 1 ? "view" : "views"} by ${d.people} ${d.people === 1 ? "person" : "people"}, ${d.completed} to the end.` : "Nobody has watched it yet.") : "…"}</span></h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {versions.length > 1 && (
          <p className="caption secondary" style={{ margin: 0 }}>{versions.map((v) => `v${v.n}: ${v.views} ${v.views === 1 ? "view" : "views"} (${v.people})`).join(" · ")}</p>
        )}
        {d && d.rows.length > 0 && (
          <ul className="activity" style={{ maxHeight: 420, overflow: "auto" }}>
            {d.rows.map((r, i) => (
              <li key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center" }}>
                <span>
                  <b>{r.who}</b> watched <b>v{r.version}</b> {watchText(r)}
                  {r.watchedSec > 0 && !r.completed ? <span className="secondary"> · {clock(r.watchedSec)} in total</span> : null}
                  <span className="secondary"> · {ago(r.lastAt)}</span>
                </span>
                <span className="viewbar" aria-hidden><span style={{ width: `${r.lengthSec ? Math.min(100, Math.round((r.maxSec / r.lengthSec) * 100)) : 0}%` }} /></span>
              </li>
            ))}
          </ul>
        )}
        <p className="caption secondary" style={{ margin: 0 }}>A view is a sitting: one person opening a version and pressing play. Your own don't count. "To the end" means the playhead got within a few seconds of the end.</p>
      </div>
    </Modal>
  );
}
