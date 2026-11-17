// 5l: the pieces Creative planning's pages and the builder's creative mode share (kept apart from Creative.tsx, which
// imports the builder).
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { linkProps, navigate } from "../../lib/router";
import { Modal } from "../../ui/kit";
import { Button, DialogHeader } from "../../ui/wp";
import { Icon, type IconName } from "../../ui/Icon";
import { errLine } from "../../ui/hold";

export type HomeInfo = { type: string; id: string; name: string } | null;
export const HOME_ICON: Record<string, IconName> = { client: "building", project: "folder", shoot: "clapper", lead: "funnel" };
export const homeLink = (h: NonNullable<HomeInfo>) => (h.type === "client" ? `/clients/${h.id}` : h.type === "project" ? `/projects/${h.id}` : h.type === "shoot" ? `/production/shoots/${h.id}` : `/clients/deals/${h.id}`);
export const shareUrl = (path: string, token: string) => `${window.location.origin}/${path}/${token}`;
export async function copyText(t: string) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }

/** The home chip: where it lives (a link), or a dashed "Not attached"; Move to… beside it. */
export function HomeTag({ home, onMove }: { home: HomeInfo; onMove?: () => void }) {
  return (
    <span className="hm-chip-row">
      {home ? <a className="hm-chip" {...linkProps(homeLink(home))}><Icon name={HOME_ICON[home.type] ?? "folder"} size={14} />{home.name}</a>
        : <span className="hm-chip own dashed"><Icon name="attach" size={14} />Not attached</span>}
      {onMove && <button type="button" className="hm-move" onClick={onMove}>{home ? "Move to…" : "Attach to…"}</button>}
    </span>
  );
}

/** Share link (D191, 1069-33427): view-only, Copy, on/off; Update the link makes a new PDF from the page now. */
export function ShareCreativeDoc({ info, makePdf, onClose, show }: { info: { _id: string; share: { token: string; on: boolean; at: number } | null }; makePdf: () => Promise<Id<"_storage">>; onClose: () => void; show: (t: string) => void }) {
  const share = useMutation(api.creative.share);
  const toggle = useMutation(api.creative.shareOn);
  const [busy, setBusy] = useState(false);
  const url = info.share ? shareUrl("cd", info.share.token) : null;
  const publish = async () => {
    setBusy(true);
    try { const r = await share({ docId: info._id, storageId: await makePdf() }); const ok = await copyText(shareUrl("cd", r.token)); show(info.share ? "The link shows the page as it is now." : ok ? "Link copied. Anyone with it can read the doc." : "The link is ready."); }
    catch (e) { show(errLine(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Share link" width={520}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Share link" title="A view-only link" body="Anyone with the link can read this doc. They can't edit it or see anything else in your portal. Notes for the team stay hidden on the shared page." onClose={onClose} />
        {url ? <>
          <div className="cr-link"><input className="input" readOnly value={url} aria-label="Link" onFocus={(e) => e.target.select()} /><Button onClick={() => void copyText(url).then((ok) => show(ok ? "Link copied." : "Copy it from the box."))}>Copy</Button></div>
          <label className="cr-switch"><input type="checkbox" checked={info.share!.on} onChange={(e) => void toggle({ docId: info._id, on: e.target.checked }).then(() => show(e.target.checked ? "The link works again." : "The link is off."), (er) => show(errLine(er)))} /> The link works</label>
          <p className="secondary wp-small">It shows the page as it was on {new Date(info.share!.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Changes since then reach it when you update the link.</p>
          <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Done</button><Button variant="primary" loading={busy} onClick={() => void publish()}>Update the link</Button></div>
        </> : <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" loading={busy} onClick={() => void publish()}>Make the link</Button></div>}
      </div>
    </Modal>
  );
}

/** Start a briefing from this (D189, 1069-33578): Shoot brief or Edit brief, on the same project. */
export function StartBriefing({ docId, onClose, show }: { docId: string; onClose: () => void; show: (t: string) => void }) {
  const start = useMutation(api.creative.startBriefing);
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (starter: "shoot" | "edit") => {
    setBusy(starter);
    try { const id = await start({ docId, starter }); navigate(`/vendors/briefings/${id}`); } catch (e) { show(errLine(e)); setBusy(null); }
  };
  return (
    <Modal onClose={onClose} label="Start a briefing" width={520}>
      <div className="crm-dialog hm-pick">
        <DialogHeader eyebrow="Start a briefing from this" title="Which briefing?" body="It starts with this doc under the briefing's sections, on the same project. The doc itself doesn't change." onClose={onClose} />
        <div className="hm-list">
          {([["shoot", "Shoot brief", "Call sheet, schedule, shot list, gear, contacts"], ["edit", "Edit brief", "Footage, the cut, music, deliverables, deadline"]] as const).map(([k, t, s]) => (
            <button key={k} type="button" className="hm-row" disabled={!!busy} onClick={() => void go(k)}><Icon name="briefing" size={18} /><span className="t"><b>{t}</b><span className="secondary">{s}</span></span>{busy === k && <span className="secondary">Making…</span>}</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

