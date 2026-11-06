// Phase 5e step 6 (Nov 6): Settings › Your data (frames 820:16562 default · 820:17090 being made · 820:17596 ready ·
// 820:18136 failed · 820:18677 deletion scheduled · 820:19218 loading · 821:18776 phone) and its dialogs (820:19659
// Export everything · 820:19717 Delete the business · 820:19807 Cancel the deletion). The owner's only.
// Decisions (Heston, Nov 6): the export holds the records and links to the files (no keys, tokens or secret link
// parts); its link works 7 days, for the owner signed in. Deleting waits 60 days (a reminder a week before), then signs
// everyone out and deletes the records and the files the portal itself keeps; Dropbox is never touched. The portal's own
// business can't be deleted. The portal's admins keep the safety-net export of a deleted business for 30 days.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, Card, DialogHeader, ListRow, SectionHead, SkeletonRows } from "../../ui/wp";
import { Modal, useIsNarrow } from "../../ui/kit";
import { Icon, type IconName } from "../../ui/Icon";
import { errText } from "../docs/pages/common";
import { SetHead } from "./Frame";

const TZ = "America/Chicago";
const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const dayYear = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
const size = (n: number | null) => (n === null ? "" : n >= 1_000_000 ? `${Math.round(n / 100_000) / 10} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);
const daysLeft = (ms: number) => Math.max(0, Math.ceil((ms - Date.now()) / 86_400_000));

type Tone = "neutral" | "success" | "danger";
function Notice({ tone, icon, title, text, action }: { tone: Tone; icon: IconName; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className={`yd-notice ${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={icon} size={20} />
      <span className="t"><b>{title}</b><small>{text}</small></span>
      {action}
    </div>
  );
}

/** Download: a fresh link from the server each time (it checks it's the owner and the 7 days aren't up). */
function useDownload(show: (m: string) => void) {
  const link = useMutation(api.yourData.exportLink);
  const final = useMutation(api.yourData.finalExportLink);
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (key: string, get: () => Promise<string | null>) => {
    setBusy(key);
    try { const url = await get(); if (!url) throw new Error("That file isn't there any more."); window.location.assign(url); } catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  return {
    busy,
    mine: (exportId: Id<"dataExports">) => go(exportId, () => link({ exportId })),
    safety: (deletionId: Id<"businessDeletions">) => go(deletionId, () => final({ deletionId })),
  };
}

export function YourDataSection({ me, show }: { me: { email: string }; show: (m: string) => void }) {
  const st = useQuery(api.yourData.state);
  const request = useMutation(api.yourData.requestExport);
  const cancel = useMutation(api.yourData.cancelExport);
  const dl = useDownload(show);
  const narrow = useIsNarrow();
  const [dialog, setDialog] = useState<null | "export" | "delete" | "undelete">(null);
  const [busy, setBusy] = useState(false);
  const head = <SetHead title="Your data." sub="Take your records with you, or close the business." />;
  if (st === undefined) return <>{head}<Card label="Loading"><SkeletonRows n={3} label="Loading" /></Card></>;

  const again = async () => {
    setBusy(true);
    try { await request({}); show("Getting your export ready. We'll email you."); } catch (e) { show(errText(e)); } finally { setBusy(false); }
  };
  const stop = async (exportId: Id<"dataExports">) => {
    try { await cancel({ exportId }); show("Export cancelled."); } catch (e) { show(errText(e)); }
  };
  const { latest, lastReady, deletion, business } = st;
  const making = latest?.status === "making";
  const freshReady = latest?.status === "ready" && latest.readyAt !== null && Date.now() - latest.readyAt < 86_400_000;

  return (
    <>
      {head}
      {deletion && (
        <Notice tone="danger" icon="alert" title="Deletion scheduled"
          text={`${business.name} will be deleted on ${dayYear(deletion.deleteAt)} (${daysLeft(deletion.deleteAt)} days). Until then everything works as usual.`}
          action={<Button size="sm" onClick={() => setDialog("undelete")}>Cancel deletion</Button>} />
      )}
      {making && latest && (
        <Notice tone="neutral" icon="clock" title="Getting your export ready" text="We will email you when it is ready. You can leave this page."
          action={<Button size="sm" onClick={() => void stop(latest._id)}>Cancel</Button>} />
      )}
      {latest?.status === "failed" && (
        <Notice tone="danger" icon="alert" title="The export did not finish" text="Nothing was lost. Try again in a few minutes."
          action={<Button size="sm" loading={busy} onClick={() => void again()}>Try again</Button>} />
      )}
      {freshReady && latest && (
        <Notice tone="success" icon="check-circle" title="Your export is ready" text={`${size(latest.bytes)} · works until ${day(latest.expiresAt!)}.`}
          action={<Button size="sm" loading={dl.busy === latest._id} onClick={() => void dl.mine(latest._id)}>Download</Button>} />
      )}

      <Card label="Export everything" head={<SectionHead label="Export everything" />}>
        <ListRow lead={{ icon: "download" }} title="Export everything"
          meta={narrow ? "Zip of your records" : "A zip of your records and links to your files. The files stay in Dropbox."}
          action={<Button size="sm" disabled={making} onClick={() => setDialog("export")}>{narrow ? "Request" : "Request export"}</Button>} />
        {lastReady && !freshReady && (
          <ListRow lead={{ icon: "clock" }} title="Last export"
            meta={`${day(lastReady.readyAt ?? lastReady.requestedAt)} · ${size(lastReady.bytes)} · ${lastReady.status === "expired" ? "link expired" : `${narrow ? "until" : "link works until"} ${day(lastReady.expiresAt!)}`}`}
            action={lastReady.status === "expired" ? undefined : <Button size="sm" loading={dl.busy === lastReady._id} onClick={() => void dl.mine(lastReady._id)}>Download</Button>} />
        )}
      </Card>

      <Card label="Delete the business" head={<SectionHead label="Delete the business" />}>
        {business.isDefault
          ? <ListRow lead={{ icon: "lock" }} title={`${business.name} can't be deleted`} meta={narrow ? "It's the portal's own business" : "It's the portal's own business. You can still export everything."} />
          : <ListRow lead={{ icon: "alert" }} title={narrow ? "Delete the business" : `Delete ${business.name}`}
              meta={deletion ? `Scheduled for ${dayYear(deletion.deleteAt)}.` : narrow ? "A 60-day wait starts first" : "Type the name to confirm. A 60-day wait starts first."}
              action={<Button size="sm" disabled={!!deletion} onClick={() => setDialog("delete")}>Delete</Button>} />}
      </Card>

      {st.safety.length > 0 && (
        <Card label="Deleted businesses" head={<SectionHead label="Deleted businesses" count={st.safety.length} />}>
          {st.safety.map((s) => (
            <ListRow key={s._id} lead={{ icon: "folder" }} title={s.name}
              meta={`Deleted ${s.doneAt ? dayYear(s.doneAt) : ""} · ${size(s.bytes)} · kept until ${dayYear(s.purgeAt)}`}
              action={<Button size="sm" loading={dl.busy === s._id} onClick={() => void dl.safety(s._id)}>Download</Button>} />
          ))}
          <p className="wp-small secondary yd-pad">The last export of each deleted business, for the portal's admins. It's deleted after 30 days.</p>
        </Card>
      )}

      {dialog === "export" && <ExportDialog email={me.email} onClose={() => setDialog(null)} show={show} />}
      {dialog === "delete" && <DeleteDialog name={business.name} onClose={() => setDialog(null)} show={show} />}
      {dialog === "undelete" && <UndeleteDialog name={business.name} onClose={() => setDialog(null)} show={show} />}
    </>
  );
}

function ExportDialog({ email, onClose, show }: { email: string; onClose: () => void; show: (m: string) => void }) {
  const request = useMutation(api.yourData.requestExport);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await request({}); show("Getting your export ready. We'll email you."); onClose(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Export everything" width={680}>
      <form className="crm-dialog team-dialog" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <DialogHeader eyebrow="Your data" title="Export everything" body={`We will email ${email} when the zip is ready.`} onClose={onClose} />
        <ul className="yd-list in">
          <li><Icon name="check" size={16} /><span><b>Records: clients, projects, proposals, invoices, notes</b><small>As spreadsheets and data files</small></span></li>
          <li><Icon name="check" size={16} /><span><b>Links to my files</b><small>The files stay in Dropbox</small></span></li>
        </ul>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" type="submit" loading={busy}>Request export</Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ name, onClose, show }: { name: string; onClose: () => void; show: (m: string) => void }) {
  const schedule = useMutation(api.yourData.scheduleDeletion);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const ok = typed.trim() === name.trim();
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await schedule({ typedName: typed }); show(`${name} will be deleted on ${dayYear(r.deleteAt)}.`); onClose(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label={`Delete ${name}?`} width={680}>
      <form className="crm-dialog team-dialog" onSubmit={(e) => { e.preventDefault(); if (ok) void go(); }}>
        <DialogHeader eyebrow="Your data" title={`Delete ${name}?`} body="This starts a 60-day wait. Until it ends you can cancel and nothing changes." onClose={onClose} />
        <ul className="yd-list warn">
          <li><Icon name="alert" size={16} /><span>Everyone is signed out when the 60 days end.</span></li>
          <li><Icon name="alert" size={16} /><span>Clients and vendors can no longer open their links.</span></li>
          <li><Icon name="alert" size={16} /><span>Nothing is deleted from Dropbox. Files kept only in the portal, such as W-9s, are deleted.</span></li>
          <li><Icon name="alert" size={16} /><span>We suggest you export everything first.</span></li>
        </ul>
        <label className="wp-field"><span className="wp-field-label">Type the business name to confirm</span>
          <input className="input" autoFocus autoComplete="off" spellCheck={false} placeholder={name} value={typed} onChange={(e) => setTyped(e.target.value)} />
        </label>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Keep my business</button>
          <Button variant="primary" type="submit" loading={busy} disabled={!ok}>Delete the business</Button>
        </div>
      </form>
    </Modal>
  );
}

function UndeleteDialog({ name, onClose, show }: { name: string; onClose: () => void; show: (m: string) => void }) {
  const cancel = useMutation(api.yourData.cancelDeletion);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await cancel({}); show("Deletion cancelled."); onClose(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Cancel the deletion?" width={640}>
      <form className="crm-dialog team-dialog" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <DialogHeader eyebrow="Your data" title="Cancel the deletion?" body={`${name} stays as it is and nothing is deleted.`} onClose={onClose} />
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Keep the deletion</button>
          <Button variant="primary" type="submit" loading={busy}>Cancel the deletion</Button>
        </div>
      </form>
    </Modal>
  );
}
