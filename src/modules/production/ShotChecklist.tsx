// Shot lists, step 3 (Nov 16): the on-set checklist (phone first; frames 1036-21625 main, 1036-22041 Hide finished with
// no signal, 1036-22419 Reset asks first). The shoot has no page of its own yet, so the checklist is its own page
// (/production/shoots/<id>/shot-list), opened from the shot list, the Shoots list and the project's Shoots card.
// The setups part is shared with the Shot list block on a call sheet (crew tick there, D180).
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, ButtonLink, Card, EmptyState, SkeletonRows, Toggle } from "../../ui/wp";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { errLine } from "../../ui/hold";
import { ShotTick, clock, shortDay, windowOf } from "./ShotLists";
import { shownDone, useTickQueue } from "./tickQueue";

export type ChecklistSetup = {
  _id: string; gap: boolean; code: string | null; start: string | null; end: string | null; title: string; note: string | null;
  shots: Array<{ _id: string; number: number; text: string; note: string | null; done: { name: string; initials: string } | null }>;
};

/** The setups and their shots, as ticked. `onTick` missing = read only (clients and guests, D180). */
export function ChecklistSetups({ setups, isDone, onTick, hideFinished, paper }: {
  setups: ChecklistSetup[]; isDone: (shotId: string, server: boolean) => boolean; onTick?: (shotId: string, done: boolean) => void; hideFinished?: boolean; paper?: boolean;
}) {
  return (
    <div className={`sl-check${paper ? " paper" : ""}`}>
      {setups.map((x) => {
        if (x.gap) return <div key={x._id} className="sl-gap"><span className="rule" aria-hidden="true" /><span>{[windowOf(x.start, x.end), x.title].filter(Boolean).join(" · ")}</span></div>;
        const shots = x.shots.map((s) => ({ ...s, on: isDone(s._id, !!s.done) }));
        const done = shots.filter((s) => s.on).length;
        if (hideFinished && shots.length && done === shots.length) return null;
        return (
          <section key={x._id} className="sl-setup" aria-label={x.title}>
            <div className="sl-sethead static">
              <div className="top">{x.code && <span className="sl-code">{x.code}</span>}<span className="win">{windowOf(x.start, x.end)}</span><span className="cnt">{done}/{shots.length}</span></div>
              <span className="ttl">{x.title}</span>
              {x.note && <p className="sl-note">{x.note}</p>}
            </div>
            {shots.filter((s) => !(hideFinished && s.on)).map((s) => (
              <div key={s._id} className={`sl-shot touch${s.on ? " done" : ""}`}>
                {onTick ? <ShotTick done={s.on} label={`#${s.number} ${s.text}`} onToggle={() => onTick(s._id, !s.on)} />
                  : <span className={`sl-tick ro${s.on ? " on" : ""}`} aria-hidden={!s.on}><span className="box">{s.on && "✓"}</span></span>}
                <span className="num">#{s.number}</span>
                <span className="txt"><span className="t">{s.text}</span>{s.note && <span className="n">{s.note}</span>}</span>
                {s.on && s.done && <span className="who" title={`Ticked by ${s.done.name}`}>{s.done.initials}</span>}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

const HIDE = "wp.shots.hide";
const readHide = () => { try { return localStorage.getItem(HIDE) === "1"; } catch { return false; } };

export default function ShotChecklistPage({ shootId }: { shootId: string }) {
  const l = useQuery(api.shotLists.forShoot, { shootId });
  const tickM = useMutation(api.shotLists.tick);
  const reset = useMutation(api.shotLists.reset);
  const [toast, say] = useToast();
  const [hide, setHide] = useState(readHide);
  const [asking, setAsking] = useState(false);
  const q = useTickQueue(`wp.ticks.${shootId}`, (t) => tickM(t));
  const crumbs = (here: string) => <TopBar><a {...linkProps("/production/prin-pro")}>Prin-pro</a><Sep /><a {...linkProps("/production/shoots")}>Shoots</a><Sep /><span className="here">{here}</span></TopBar>;
  if (l === undefined) return <>{crumbs("Shot list")}<div className="wp-page prod"><Card label="Loading"><SkeletonRows n={6} /></Card></div></>;
  if (l === null) return <>{crumbs("Shot list")}<div className="wp-page prod"><EmptyState icon="shot-list" title="No shot list for this shoot yet"
    body="Make one in Pre-pro › Shot lists and link it to this shoot day." actions={<ButtonLink variant="primary" to="/production/shot-lists" iconEnd={false}>Shot lists</ButtonLink>} /></div></>;

  const name = l.project?.client || l.project?.label || "Shoot";
  const isDone = (id: string, server: boolean) => shownDone(server, id, q.queue);
  const all = l.setups.flatMap((x) => x.shots);
  const done = all.filter((s) => isDone(s._id, !!s.done)).length;
  const head = `${name}${l.shoot ? ` · Day ${l.shoot.day} · ${shortDay(l.shoot.date)}` : ""}`;
  return (
    <>
      {crumbs(head)}
      <div className="wp-page prod sl-page sl-onset">
        <Card className="sl-onhead" label="This shoot day">
          <h1 className="wp-h4">{head}</h1>
          {l.shoot && <p className="wp-small secondary">{[l.shoot.location, `Call ${clock(l.shoot.call)}`, l.shoot.wrap ? `Wrap ${clock(l.shoot.wrap)}` : null].filter(Boolean).join(" · ")}</p>}
          <div className="sl-progress"><span className="bar" aria-hidden="true"><i style={{ width: `${all.length ? (100 * done) / all.length : 0}%` }} /></span><span className="c">{done} / {all.length} shots</span></div>
          <div className="sl-onacts">
            <label className="sl-switch"><Toggle checked={hide} onChange={(on) => { setHide(on); try { localStorage.setItem(HIDE, on ? "1" : "0"); } catch { /* fine */ } }} label="Hide finished" /><span aria-hidden="true">Hide finished</span></label>
            <Button variant="ghost" onClick={() => setAsking(true)} disabled={!done}>Reset</Button>
          </div>
        </Card>
        {(q.line || q.synced) && <div className={`sl-signal${q.online ? "" : " off"}`} role="status"><span className="dot" aria-hidden="true" />{q.line ?? "Synced"}</div>}
        <Card className="sl-main" label="Shots">
          {l.setups.length === 0 ? <p className="wp-body sl-empty">This list has no setups yet. <a {...linkProps(`/production/shot-lists/${l._id}`)}>Open the shot list</a></p>
            : <ChecklistSetups setups={l.setups} isDone={isDone} onTick={q.tick} hideFinished={hide} />}
          {hide && all.length > 0 && done === all.length && <p className="wp-body sl-empty">Every shot is done.</p>}
        </Card>
        <p className="wp-small secondary sl-foot"><a {...linkProps(`/production/shot-lists/${l._id}`)}>Edit the shot list</a></p>
      </div>
      {asking && (
        <Modal onClose={() => setAsking(false)} label="Reset" width={420} slideOut>
          <div className="sl-dialog">
            <h2 className="wp-h4">Clear all {done} {done === 1 ? "tick" : "ticks"}?</h2>
            <p className="wp-small secondary">Every shot goes back to not done, for everyone on the shoot.</p>
            <div className="sl-dialog-acts"><Button onClick={() => setAsking(false)}>Cancel</Button>
              <Button variant="danger" onClick={async () => { setAsking(false); try { const r = await reset({ listId: l._id }); say(`Cleared ${r.cleared} ${r.cleared === 1 ? "tick" : "ticks"}.`); } catch (e) { say(errLine(e)); } }}>Clear ticks</Button></div>
          </div>
        </Modal>
      )}
      {toast}
    </>
  );
}
