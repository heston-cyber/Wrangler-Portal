// Phase 4 (Nov 2): file requests. The owner's Requests card and Ask for files dialog (741:1424, 741:2666); the client's
// Coming up rows (738:8722) and File request page (740:551 Open, 740:897 Uploading, 740:1276 Uploaded; phone 742:2365).
// Files go straight into the business's Dropbox: up to 150 MB through Dropbox's one-time link, bigger ones in 8 MB
// pieces through the portal (/upload/chunk).
import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, Checkbox, DialogHeader, Divider, EmptyState, ListRow, SectionHead, SkeletonRows, StatusChip } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useConfirm, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { CONVEX_SITE } from "../docs/lib/client";
import { bytes } from "./common";
import { shootDay } from "./Shoots";

const todayLocal = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const monthDay = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
/** "Upload your logo and brand guide" → "Logo and brand guide" (as the server names the folder). */
const forName = (title: string) => { const t = title.replace(/^(please\s+)?(upload|send|share)\s+(us\s+)?(your|the)\s+/i, "").trim() || title; return t[0].toUpperCase() + t.slice(1); };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Owner = NonNullable<ReturnType<typeof useQuery<typeof api.fileRequests.forProject>>>;
type Req = Owner["requests"][number];
const ownerChip = (r: Req, today: string) => r.status === "closed" ? <StatusChip tone="neutral">Closed</StatusChip>
  : r.files.length ? <StatusChip tone="success">Uploaded</StatusChip> : r.due < today ? <StatusChip tone="danger">Overdue</StatusChip> : <StatusChip tone="warning">Waiting</StatusChip>;

// ---------- the owner ----------

/** The rows of the Requests and brief card, and its Make a request action. */
export function useRequests(projectId: Id<"projects">) { return useQuery(api.fileRequests.forProject, { projectId }); }

export function RequestRows({ d, onOpen }: { d: Owner; onOpen: (r: Req) => void }) {
  return <>{d.requests.map((r, i) => {
    const last = r.files.length ? r.files[r.files.length - 1].at : null;
    return (
      <div key={r._id} className="wp-rowwrap">{i > 0 && <Divider />}
        <ListRow className="ilead" lead={{ icon: "upload" }} onClick={() => onOpen(r)} chevron title={forName(r.title)}
          meta={[`Due ${shortDay(r.due)}`, r.files.length ? `${plural(r.files.length, "file", "files")} uploaded${last ? ` ${monthDay(last)}` : ""}` : null, `in Dropbox › ${r.folder.split("/").slice(1).join(" › ")}`].filter(Boolean).join(" · ")}
          chip={ownerChip(r, d.today)} />
      </div>
    );
  })}</>;
}

export function AskForFiles({ projectId, label, d, client, onClose, show }: { projectId: Id<"projects">; label: string; d: Owner; client: string | null; onClose: () => void; show: (t: string) => void }) {
  const create = useMutation(api.fileRequests.create);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [due, setDue] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [remind, setRemind] = useState(true);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const who = client ?? "The client";
  const name = folder ?? (title.trim() ? forName(title.trim()) : "");
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await create({ projectId, title, ...(details.trim() ? { details } : {}), due, ...(name.trim() ? { folderName: name } : {}), remind });
      show(r.told ? `Asked. ${who} gets it in their Inbox and by email.` : "Saved. Nobody at the client can open this project in the portal yet, so nobody was told.");
      onClose();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Ask for files" width={560}>
      <div className="crm-dialog">
        <DialogHeader eyebrow={label} title="Ask for files." body={d.dropbox ? `${who} uploads them straight to the project's Dropbox folder.` : "Connect Dropbox first (Settings › Dropbox drop folder): the files go to your Dropbox."} onClose={onClose} />
        <div className="qz-grid">
          <label className="wp-field qz-q wide"><span className="wp-field-label">What you need</span><input className="input" value={title} placeholder="Upload your logo and brand guide" onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="wp-field qz-q wide"><span className="wp-field-label">Details (optional)</span><textarea className="input" rows={3} value={details} placeholder="Your logo (SVG or PNG), the brand guide, and any photos of the new menu boards." onChange={(e) => setDetails(e.target.value)} /></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Due</span><input className="input" type="date" min={todayLocal()} value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <label className="wp-field qz-q"><span className="wp-field-label">Folder</span><span className="rq-folder"><Icon name="folder" size={16} /><input className="input" value={name} placeholder="Logo and brand guide" onChange={(e) => setFolder(e.target.value)} /></span></label>
          <p className="wp-small secondary qz-q wide rq-path">Dropbox › Apps › Wrangler Review{d.base.replace(/\//g, " › ")} › {name || "…"}</p>
          <div className="qz-q wide"><Checkbox checked={remind} onChange={setRemind} label={`Remind ${client ? "them" : "the client"} the day before if nothing's uploaded`} /></div>
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy} disabled={!title.trim() || !due || !d.dropbox} onClick={() => void send()}>{d.people ? "Send request" : "Save request"}</Button>
        </div>
      </div>
    </Modal>
  );
}

export function RequestDialog({ r, today, onClose, show }: { r: Req; today: string; onClose: () => void; show: (t: string) => void }) {
  const setStatus = useMutation(api.fileRequests.setStatus);
  const [ask, confirmDialog] = useConfirm();
  const go = async (status: "open" | "closed" | "cancelled") => {
    if (status === "cancelled" && !(await ask({ title: "Cancel this request?", body: "It comes off the client's pages. Files already uploaded stay in your Dropbox.", yes: "Cancel request", no: "Keep it" }))) return;
    try { await setStatus({ requestId: r._id as Id<"fileRequests">, status }); show(status === "open" ? "Reopened." : status === "closed" ? "Closed. No more uploads." : "Cancelled."); onClose(); } catch (e) { show(errText(e)); }
  };
  return (
    <>
      <Modal onClose={onClose} label={forName(r.title)} width={560}>
        <div className="crm-dialog">
          <DialogHeader eyebrow={`File request · due ${shootDay(r.due)}`} title={`${forName(r.title)}.`} body={r.details ?? undefined} onClose={onClose} />
          <div className="rq-files">
            {r.files.length === 0 ? <p className="secondary">Nothing uploaded yet.{r.remind ? " They get a reminder the day before it's due." : ""}</p>
              : r.files.map((f, i) => <div key={i} className="vd-row"><span className="rq-name"><Icon name="document" size={16} />{f.name}</span><span className="secondary">{bytes(f.size)} · {monthDay(f.at)}</span></div>)}
          </div>
          <p className="wp-small secondary">In your Dropbox: Apps › Wrangler Review{r.folder.replace(/\//g, " › ")}</p>
          <div className="dfoot">
            {r.status !== "cancelled" && <button className="btn ghost sh-cancel" type="button" onClick={() => void go("cancelled")}>Cancel request</button>}
            {r.status === "open" ? <Button onClick={() => void go("closed")}>Close it</Button> : <Button onClick={() => void go("open")}>Reopen</Button>}
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
          {r.status === "open" && r.due < today && !r.files.length && <p className="wp-small secondary">It's past due. They can still upload until you close it.</p>}
        </div>
      </Modal>
      {confirmDialog}
    </>
  );
}

// ---------- the client ----------

export function ComingUpRequests({ projectId }: { projectId: string }) {
  const list = useQuery(api.fileRequests.forClientProject, { projectId });
  if (!list?.length) return null;
  return <>{list.map((r, i) => (
    <div key={r._id} className="wp-rowwrap">{i > 0 && <Divider />}
      <ListRow className="ilead" lead={{ icon: "upload" }} to={`/requests/${r._id}`} title={r.title}
        meta={`Due ${shortDay(r.due)}${r.files ? ` · ${plural(r.files, "file", "files")} uploaded` : ""}`}
        action={<ButtonLink size="sm" to={`/requests/${r._id}`}>{r.files ? "Add more" : "Upload"}</ButtonLink>} />
    </div>
  ))}</>;
}
export const useRequestCount = (projectId: string) => useQuery(api.fileRequests.forClientProject, { projectId })?.length ?? 0;

/** POSTs a blob with progress. */
function post(url: string, body: Blob, onProgress: (sent: number) => void, signal: { xhr?: XMLHttpRequest }) {
  return new Promise<{ status: number; json: Record<string, unknown> | null }>((resolve, reject) => {
    const x = new XMLHttpRequest();
    signal.xhr = x;
    x.open("POST", url);
    x.setRequestHeader("Content-Type", "application/octet-stream");
    x.upload.onprogress = (e) => onProgress(e.loaded);
    x.onload = () => { let json = null; try { json = JSON.parse(x.responseText); } catch { /* not JSON */ } resolve({ status: x.status, json }); };
    x.onerror = () => reject(new Error("The connection dropped."));
    x.onabort = () => reject(new Error("Stopped."));
    x.send(body);
  });
}

type Row = { key: string; name: string; size: number; sent: number; state: "uploading" | "done" | "failed" | "stopped"; error?: string; stop?: () => void };

export function ClientRequestPage({ requestId }: { requestId: string }) {
  const d = useQuery(api.fileRequests.page, { requestId });
  const start = useAction(api.fileRequests.start);
  const finishDirect = useAction(api.fileRequests.finishDirect);
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const one = async (file: File) => {
    const key = `${file.name}:${file.size}:${Date.now()}:${Math.random()}`;
    const signal: { xhr?: XMLHttpRequest; stopped?: boolean } = {};
    setRows((rs) => [...rs, { key, name: file.name, size: file.size, sent: 0, state: "uploading", stop: () => { signal.stopped = true; signal.xhr?.abort(); } }]);
    try {
      if (d && file.size > d.maxBytes) throw new Error("It's over 2 GB. Send it another way, or ask for a link.");
      const s = await start({ requestId: requestId as Id<"fileRequests">, name: file.name, size: file.size });
      if (s.mode === "direct") {
        const r = await post(s.url, file, (n) => patch(key, { sent: n }), signal);
        if (r.status !== 200) throw new Error("Dropbox didn't take the file. Try again.");
        await finishDirect({ uploadId: s.uploadId }); // the portal checks Dropbox has all of it
      } else {
        // Every piece in order; then, once every byte is in, an empty post at the end until the portal says it's saved.
        let offset = 0, tries = 0;
        for (;;) {
          if (signal.stopped) throw new Error("Stopped.");
          const piece = file.slice(offset, Math.min(offset + s.chunk, file.size));
          const base = offset;
          let r: { status: number; json: Record<string, unknown> | null };
          try { r = await post(`${CONVEX_SITE}/upload/chunk?t=${s.token}&o=${offset}`, piece, (n) => patch(key, { sent: base + n }), signal); }
          catch (e) { if (signal.stopped || ++tries > 4) throw e; await new Promise((ok) => setTimeout(ok, 1500 * tries)); continue; }
          if (r.status === 200 && r.json?.done) break;
          if ((r.status === 200 || r.status === 409) && typeof r.json?.offset === "number") { offset = r.json.offset; tries = 0; continue; }
          if (r.status === 502 && ++tries <= 4) { await new Promise((ok) => setTimeout(ok, 1500 * tries)); continue; }
          throw new Error(typeof r.json?.error === "string" ? r.json.error : "The upload stopped. Try the file again.");
        }
      }
      patch(key, { state: "done", sent: file.size, stop: undefined });
    } catch (e) {
      patch(key, signal.stopped ? { state: "stopped", stop: undefined } : { state: "failed", error: errText(e), stop: undefined });
    }
  };
  const add = (files: FileList | null) => { if (files) for (const f of Array.from(files)) void one(f); if (input.current) input.current.value = ""; };

  const top = <TopBar><a {...linkProps("/review")}>Review</a>{d && <><Sep /><a {...linkProps(`/projects/${d.project._id}`)}>{d.project.label}</a></>}<Sep /><span className="here">Files for {d?.business.split(" ")[0] ?? "the studio"}</span></TopBar>;
  if (d === undefined) return <>{top}<div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (d === null) return <>{top}<div className="wp-page"><EmptyState icon="upload" title="This request isn't here." body="It may have been cancelled." actions={<ButtonLink to="/inbox">Back to your Inbox</ButtonLink>} /></div></>;
  const ownerFirst = d.owner.split(" ")[0];
  const uploading = rows.filter((r) => r.state === "uploading");
  const shown = rows.filter((r) => r.state !== "done");
  const total = d.files.length;
  const past = d.due < d.today;
  const reminder = (() => { const t = new Date(`${d.due}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return shortDay(t.toISOString().slice(0, 10)); })();
  return (
    <>
      {top}
      <div className="wp-page rq-page">
        <header className="pj-head sh-head">
          <span className="wp-eyebrow">File request · {d.project.label}</span>
          <h1 className="wp-h2">{d.title.replace(/\.$/, "")}.</h1>
          <span className="sh-sub"><span className="secondary">Requested by {d.owner} · due {shootDay(d.due)}</span>
            {total ? <StatusChip tone="success">Uploaded</StatusChip> : past ? <StatusChip tone="danger">Past due</StatusChip> : <StatusChip tone="warning">Due {shortDay(d.due)}</StatusChip>}</span>
        </header>
        <div className="wp-homecols">
          <div className="col">
            <Card className="rq-card" label="Your files" head={<SectionHead label="Your files" count={total + uploading.length || undefined} />}>
              <div className="rq-body">
                {d.open && (total === 0 || shown.length > 0) && (
                  <label className={`rq-drop${over ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
                    <input ref={input} type="file" multiple hidden onChange={(e) => add(e.target.files)} />
                    <Icon name="upload" size={18} /><span>Drag files here, or <span className="lnk">browse</span></span>
                  </label>
                )}
                {d.open && (total === 0 || shown.length > 0) && <p className="wp-small secondary">Up to 2 GB a file: images, video, audio, PDFs, fonts and zips. They go straight to the project folder at {d.business}.</p>}
                {d.files.map((f, i) => (
                  <div key={`f${i}`} className="rq-file"><Icon name="document" size={16} /><span className="nm">{f.name}</span><span className="st ok">Done <Icon name="check" size={16} /></span></div>
                ))}
                {shown.map((r) => (
                  <div key={r.key} className={`rq-file ${r.state}`}>
                    <Icon name="document" size={16} /><span className="nm">{r.name}</span>
                    {r.state === "uploading" && <><span className="st secondary">{Math.min(99, Math.floor((r.sent / Math.max(1, r.size)) * 100))}%</span>
                      <button type="button" className="icon-btn" aria-label={`Stop ${r.name}`} onClick={() => r.stop?.()}><Icon name="close" size={16} /></button>
                      <span className="bar" style={{ width: `${Math.min(100, (r.sent / Math.max(1, r.size)) * 100)}%` }} /></>}
                    {r.state === "failed" && <span className="st err">{r.error}</span>}
                    {r.state === "stopped" && <span className="st secondary">Stopped</span>}
                  </div>
                ))}
                {total > 0 && shown.length === 0 && (
                  <div className="sh-done rq-done"><Icon name="check-circle" size={20} /><span className="txt"><b>Uploaded · {plural(total, "file", "files")}</b><br /><span className="secondary">{d.business} has them.{d.open ? (past ? " You can still add more." : ` You can add more until ${shortDay(d.due)}.`) : ""}</span></span>
                    {d.open && <><input ref={input} type="file" multiple hidden onChange={(e) => add(e.target.files)} /><Button size="sm" onClick={() => input.current?.click()}>Add more</Button></>}</div>
                )}
                {!d.open && <p className="secondary">{ownerFirst} closed this request. Reply to their email if you have more.</p>}
              </div>
            </Card>
          </div>
          <div className="col right">
            <Card className="rq-asked" label={`What ${ownerFirst} asked for`} head={<SectionHead label={`What ${ownerFirst} asked for`} />}>
              {d.details && <p className="rq-details">{d.details}</p>}
              <dl className="cp-see"><dt>Due</dt><dd>{shootDay(d.due)}</dd>{d.remind && !total && !past && <><dt>Reminder</dt><dd>{reminder}, if it's still open</dd></>}</dl>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

/** The owner's "Requests and brief" card (741:1424): file requests now; the kickoff brief joins it. */
export function RequestsCard({ projectId, label, client }: { projectId: Id<"projects">; label: string; client: string | null }) {
  const d = useRequests(projectId);
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState<Req | null>(null);
  const [toast, show] = useToast();
  if (d === undefined) return <Card className="pj-requests" label="Requests and brief" head={<SectionHead label="Requests and brief" />}><SkeletonRows n={1} /></Card>;
  if (d === null) return null;
  return (
    <>
      <Card className="pj-requests" label="Requests and brief" head={<SectionHead label="Requests and brief" count={d.requests.length || undefined} action={<Button size="sm" variant="ghost" onClick={() => setAsking(true)}>Make a request</Button>} />}>
        {d.requests.length === 0 ? <ListRow className="ilead quiet" lead={{ icon: "upload" }} title="No file requests." meta={`Ask ${client ?? "the client"} for logos, brand guides, music and more. They upload straight to your Dropbox.`} />
          : <RequestRows d={d} onOpen={setOpen} />}
      </Card>
      {asking && <AskForFiles projectId={projectId} label={label} d={d} client={client} onClose={() => setAsking(false)} show={show} />}
      {open && <RequestDialog r={open} today={d.today} onClose={() => setOpen(null)} show={show} />}
      {toast}
    </>
  );
}
