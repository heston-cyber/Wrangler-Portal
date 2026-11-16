// Shot lists, step 4 (Nov 16; D180, D181): the Shot list block as it sits on a page (call sheets, briefings,
// proposals). Frames: builder 1037-22115, the crew's call sheet page (live, tickable) 1037-22495, the PDF 1037-22772.
// Document-style (paper and ink). Always live where it's read; a PDF prints the list as it stood (pdf.tsx, `snap`).
import { createContext, useContext } from "react";
import { windowOf } from "./shotTime";
import type { ShotSnap } from "../../../convex/lib/shotList";
import { blockList } from "../../../convex/lib/shotList";

export type LiveList = { _id: string; pick: string; setups: Array<ShotSnap["setups"][number] & { _id?: string; shots: Array<ShotSnap["setups"][number]["shots"][number] & { _id?: string; done?: { name: string; initials: string } | null }> }> };

/** What a page's Shot list blocks read: the lists, the call sheet's own one, and (crew only) ticking. */
export type ShotsSource = {
  lists: LiveList[];
  defaultId: string | null;
  tick?: { isDone: (shotId: string, server: boolean) => boolean; onTick: (shotId: string, done: boolean) => void; line?: string | null } | null;
};
export const ShotsCtx = createContext<ShotsSource | null>(null);

/** One block: "LIVE FROM THE SHOT LIST · DAY 1 · TUE 11/3", then each setup and its shots. */
export function ShotBlockDoc({ list, snap, boxes, tick, printed }: { list?: LiveList | null; snap?: ShotSnap | null; boxes: boolean; tick?: ShotsSource["tick"]; printed?: boolean }) {
  const src = list ?? snap;
  if (!src) return <div className="cs-shots empty"><span className="cs-cap">Shot list</span><span>No shot list for this day yet.</span></div>;
  return (
    <div className="cs-shots">
      <span className="cs-cap">{printed ? "Printed from the shot list" : "Live from the shot list"}{src.pick ? ` · ${src.pick}` : ""}</span>
      {src.setups.map((x, i) => x.gap
        ? <p key={i} className="cs-shots-gap">{[windowOf(x.start, x.end), x.title].filter(Boolean).join(" · ")}</p>
        : <div key={i} className="cs-shots-set">
            <p className="cs-shots-head">{[x.code, windowOf(x.start, x.end), x.title].filter(Boolean).join(" · ")}</p>
            {x.note && <p className="cs-shots-note">{x.note}</p>}
            {x.shots.map((s, j) => {
              const id = (s as { _id?: string })._id;
              const server = !!(s as { done?: unknown }).done;
              const on = id && tick ? tick.isDone(id, server) : server;
              return (
                <div key={j} className={`cs-shot${on ? " done" : ""}`}>
                  {boxes && (tick && id
                    ? <button type="button" role="checkbox" aria-checked={on} aria-label={`#${s.number} ${s.text}`} className="cs-box tick" onClick={() => tick.onTick(id, !on)}>{on ? "✓" : ""}</button>
                    : <span className="cs-box" aria-hidden="true">{on ? "✓" : ""}</span>)}
                  <span className="n">#{s.number}</span>
                  <span className="t">{s.text}{s.note && <span className="sub">{s.note}</span>}</span>
                </div>
              );
            })}
          </div>)}
    </div>
  );
}

/** A Shot list block on a sent page (call sheet readers): live from the page's source. */
export function ShotBlockLive({ attrs }: { attrs: Record<string, unknown> }) {
  const src = useContext(ShotsCtx);
  const list = src ? blockList(attrs.listId, src.lists, src.defaultId) : null;
  // D180: crew tick here when the block allows it; clients and guests read it without boxes to tick.
  const tick = src?.tick && attrs.crewTick !== false ? src.tick : null;
  return <ShotBlockDoc list={list} snap={list ? null : (attrs.snap as ShotSnap | null)} boxes={!!tick} tick={tick} />;
}
