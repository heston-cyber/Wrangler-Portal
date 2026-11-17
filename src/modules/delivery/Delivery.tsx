// 5n Delivery (D195, D196; Design Log "Handoff ready: Delivery" rounds 1 and 2). The owner's Post › Delivery (grouped by
// client, project or shoot), one delivery (Video folder, Photo albums, Kept until, Publish changes, Renewal), and the
// client's Delivery (play, view photos, download one, share a link) and the shared-link page.
import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { Modal, useConfirm, useToast } from "../../ui/kit";
import { Button, Card, DialogHeader, Divider, EmptyState, ListRow, PageHeader, PillTabs, SectionHead, SkeletonRows, StatusChip, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { errLine } from "../../ui/hold";

const longDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const gb = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const shareUrl = (t: string) => `${window.location.origin}/dl/${t}`;
async function copy(t: string) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }

// ---------- Post › Delivery (1096-42132) ----------

export function DeliveryList() {
  const d = useQuery(api.delivery.list);
  const board = useQuery(api.homes.projectsBoard);
  const ensure = useMutation(api.delivery.ensure);
  const [toast, show] = useToast();
  const [by, setBy] = useState<"client" | "project" | "shoot">("client");
  const [f, setF] = useState<"all" | "draft" | "ending">("all");
  const [picking, setPicking] = useState(() => new URLSearchParams(location.search).has("new")); // Nov 17: Production › Create
  const rows = (d?.deliveries ?? []).filter((x) => f === "all" || (f === "draft" ? x.state === "draft" || x.changed : x.endingSoon));
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; rows: typeof rows; sub?: string }>();
    const put = (k: string, name: string, r: (typeof rows)[number], sub?: string) => { const g = m.get(k) ?? { name, rows: [], sub }; g.rows.push(r); m.set(k, g); };
    for (const r of rows) {
      if (by === "client") put(r.client?._id ?? "none", r.client?.name ?? "On their own", r);
      else if (by === "project") put(r.projectId, r.project, r);
      else { for (const s of r.shoots) put(s.id, `${r.project} · ${longDay(s.date)}`, r, `${s.n} tagged`); if (r.untagged || !r.shoots.length) put(`u:${r.projectId}`, `${r.project} · not tagged with a shoot day`, r); }
    }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [rows, by]);
  const without = (board?.projects ?? []).filter((p) => !(d?.deliveries ?? []).some((x) => x.projectId === p._id));
  return (
    <>
      <TopBar><a {...linkProps("/production")}>Production</a><Sep /><span className="here">Delivery</span></TopBar>
      <div className="wp-page">
        <PageHeader eyebrow="Post" title="Delivery" sub="Final files kept for your clients, separate from Review. Videos and photo albums, published when you’re ready." actions={<Button variant="primary" icon="plus" onClick={() => setPicking(true)}>New delivery</Button>} />
        <div className="wk-bar">
          <PillTabs label="Group by" value={by} onChange={setBy} items={[{ key: "client", label: "By client" }, { key: "project", label: "By project" }, { key: "shoot", label: "By shoot" }]} />
          <select className="input sm" value={f} onChange={(e) => setF(e.target.value as typeof f)} aria-label="Filter"><option value="all">All</option><option value="draft">Drafts and unpublished changes</option><option value="ending">Ending soon</option></select>
        </div>
        {by === "shoot" && <p className="secondary wp-small">Grouped by shoot, only the videos and albums tagged with that shoot day show under it. A delivery still belongs to its project.</p>}
        {d === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card> : groups.length === 0 ? <div className="wp-tablecard glass"><EmptyState icon="package" title={d.deliveries.length ? "Nothing here." : "No deliveries yet."} body={d.deliveries.length ? undefined : "Make one for a project: its final videos and photo albums, kept for the client."} actions={<Button variant="primary" onClick={() => setPicking(true)}>New delivery</Button>} /></div>
          : groups.map(([k, g]) => (
            <Card key={k} label={g.name} head={<SectionHead label={g.name} count={g.sub ?? g.rows.length} />}>
              {g.rows.map((r, i) => (
                <div key={r._id + k} className="wp-rowwrap">{i > 0 && <Divider />}
                  <ListRow lead={{ icon: "package" }} title={by === "client" ? r.project : r.client?.name ?? r.project} to={`/delivery/${r.projectId}`}
                    meta={`${r.videos} video${r.videos === 1 ? "" : "s"} · ${r.albums} album${r.albums === 1 ? "" : "s"} (${r.photos} photos)${r.keptUntil ? ` · kept until ${longDay(r.keptUntil)}` : ""}`}
                    chip={r.state === "draft" ? <StatusChip tone="neutral">Draft</StatusChip> : r.state === "ended" ? <StatusChip tone="neutral">Ended</StatusChip> : r.endingSoon ? <StatusChip tone="warning">Ending soon</StatusChip> : r.changed ? <StatusChip tone="accent">Unpublished changes</StatusChip> : <StatusChip tone="success">Published</StatusChip>}
                    action={r.endingSoon ? <ButtonLinkSm to={`/delivery/${r.projectId}?renew=1`}>Renewal…</ButtonLinkSm> : undefined} chevron />
                </div>
              ))}
            </Card>
          ))}
      </div>
      {picking && <Modal onClose={() => setPicking(false)} label="New delivery" width={520}><div className="crm-dialog hm-pick">
        <DialogHeader eyebrow="New delivery" title="Which project?" body="One delivery per project. Its files come from the project's Dropbox folder and its finished cuts." onClose={() => setPicking(false)} />
        <div className="hm-list">{without.length === 0 ? <p className="secondary">Every project has one.</p> : without.map((p) => <button key={p._id} className="hm-row" onClick={() => void ensure({ projectId: p._id }).then(() => navigate(`/delivery/${p._id}`), (e) => show(errLine(e)))}><Icon name="folder" size={18} /><span className="t"><b>{p.label}</b><span className="secondary">{p.client ?? "On its own"}</span></span></button>)}</div>
      </div></Modal>}
      {toast}
    </>
  );
}
const ButtonLinkSm = ({ to, children }: { to: string; children: React.ReactNode }) => <a className="btn sm" {...linkProps(to)}>{children}</a>;

// ---------- one delivery (1096-42670) ----------

type Data = NonNullable<ReturnType<typeof useDeliveryGet>>;
const useDeliveryGet = (projectId: string) => useQuery(api.delivery.get, { projectId });

export function DeliveryPage({ projectId }: { projectId: string }) {
  const g = useDeliveryGet(projectId);
  const ensure = useMutation(api.delivery.ensure);
  const addAlbum = useMutation(api.delivery.addAlbum);
  const editItem = useMutation(api.delivery.editItem);
  const removeItem = useMutation(api.delivery.removeItem);
  const editAsset = useMutation(api.delivery.editAsset);
  const removeAsset = useMutation(api.delivery.removeAsset);
  const [toast, show] = useToast();
  const [ask, confirmNode] = useConfirm();
  const [dialog, setDialog] = useState<null | { k: "add"; itemId: string; kind: "videos" | "album" } | { k: "publish" } | { k: "renew" } | { k: "term" } | { k: "album" } | { k: "preview" }>(() => (new URLSearchParams(location.search).has("renew") ? { k: "renew" } : null));
  const [drag, setDrag] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  if (g === undefined) return <><TopBar><a {...linkProps("/delivery")}>Delivery</a></TopBar><div className="wp-page"><SkeletonRows n={4} /></div></>;
  if (g === null) return <><TopBar><a {...linkProps("/delivery")}>Delivery</a></TopBar><div className="wp-page"><EmptyState icon="package" title="That project isn't here." /></div></>;
  const d = g.delivery;
  const shootName = (id: string | null) => (id ? (g.shoots.find((s) => s._id === id) ? longDay(g.shoots.find((s) => s._id === id)!.date) : "a shoot day") : null);
  const dropOn = (assetId: string, beforeId: string | null) => void editAsset({ assetId: assetId as Id<"deliveryAssets">, before: beforeId as Id<"deliveryAssets"> | null }).catch((e) => show(errLine(e)));
  const shootSelect = (value: string | null, on: (v: string | null) => void, label: string) => g.shoots.length ? <select className="input sm" value={value ?? ""} onChange={(e) => on(e.target.value || null)} aria-label={label}><option value="">No shoot day</option>{g.shoots.map((s) => <option key={s._id} value={s._id}>{longDay(s.date)}</option>)}</select> : null;
  const top = (
    <TopBar right={d ? <>
      <span className={`ws-save hide-sm ${d.changed ? "" : "saved"}`}>{d.state === "draft" ? "Draft" : d.state === "ended" ? "Ended" : d.changed ? "Unpublished changes" : "Published"}</span>
      <Button size="sm" variant="ghost" className="hide-sm" onClick={() => setDialog({ k: "preview" })}>Preview as client</Button>
      <Button size="sm" variant="primary" disabled={d.state !== "draft" && !d.changed} onClick={() => setDialog({ k: "publish" })}>{d.state === "draft" ? "Publish" : "Publish changes"}</Button>
    </> : undefined}><a {...linkProps("/production")}>Production</a><Sep /><a {...linkProps("/delivery")}>Delivery</a><Sep /><span className="here">{g.project.label}</span></TopBar>
  );
  if (!d) return <>{top}<div className="wp-page"><PageHeader eyebrow="Delivery" title={g.project.label} /><div className="wp-tablecard glass"><EmptyState icon="package" title="No delivery yet." body="A long-term home for this project's final videos and photo albums, separate from Review." actions={<Button variant="primary" onClick={() => void ensure({ projectId }).catch((e) => show(errLine(e)))}>Make the delivery</Button>} /></div></div>{toast}</>;
  const left = d.keptUntil ? Math.round((Date.parse(`${d.keptUntil}T12:00:00Z`) - Date.now()) / 86_400_000) : null;
  const videos = d.items.find((i) => i.kind === "videos");
  const albums = d.items.filter((i) => i.kind === "album");
  const fresh = d.items.flatMap((i) => i.assets).filter((x) => !x.published).length;
  return (
    <>
      {top}
      <div className="wp-page dl-page">
        <PageHeader eyebrow="Delivery" title={g.project.label} sub={<span className="hm-chip-row">{g.project.client ? <a className="hm-chip" {...linkProps(`/clients/${g.project.client._id}`)}><Icon name="building" size={14} />{g.project.client.name}</a> : <span className="hm-chip own">On its own</span>}<a className="hm-chip" {...linkProps(`/projects/${projectId}`)}><Icon name="folder" size={14} />Project</a></span>} />
        {d.state === "published" && d.changed && <div className="wp-notice glass"><Icon name="info" size={18} /><span className="txt">{fresh ? `${fresh} new file${fresh === 1 ? "" : "s"} the client can't see yet. Press Publish changes when it's ready.` : "Names, order, covers and removals reach the client as you make them; Publish changes is for new files."}</span></div>}
        {d.state === "ended" && <div className="wp-notice glass"><Icon name="alert" size={18} /><span className="txt">This delivery ended {d.keptUntil ? longDay(d.keptUntil) : ""}: the client can't see it. Nothing was deleted. Change the date to bring it back.</span></div>}
        <div className="dl-cols">
          <div className="dl-main">
            {videos && <Card label="Video" head={<SectionHead label="Video" count={videos.assets.length} action={<Button size="sm" onClick={() => setDialog({ k: "add", itemId: videos._id, kind: "videos" })}>Add videos</Button>} />}>
              {videos.assets.length === 0 ? <p className="secondary cr-pad">Add the final videos: from the project's Dropbox folder or its finished cuts.</p> : <div className="dl-list">
                {videos.assets.map((x) => (
                  <div key={x._id} className={`dl-row${drag === x._id ? " dragging" : ""}`} draggable onDragStart={() => setDrag(x._id)} onDragEnd={() => setDrag(null)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag && drag !== x._id) dropOn(drag, x._id); setDrag(null); }}>
                    <span className="grip" aria-hidden><Icon name="menu" size={14} /></span><Icon name="video" size={18} />
                    <span className="t"><b>{x.name}</b><span className="secondary wp-small">{x.size ? gb(x.size) : ""}{x.source === "version" ? " · from the cuts" : " · Dropbox"}</span></span>
                    {!x.published && <StatusChip tone="accent">New</StatusChip>}
                    {shootSelect(x.shootId, (v) => void editAsset({ assetId: x._id, shootId: v as Id<"shoots"> | null }), `Shoot day for ${x.name}`)}
                    <button className="icon-btn sm" aria-label={`Remove ${x.name}`} onClick={() => void removeAsset({ assetId: x._id })}><Icon name="close" size={14} /></button>
                  </div>
                ))}</div>}
              <p className="secondary wp-small cr-pad">Drag to arrange. The client plays and downloads the file itself (from Dropbox or the cut); there's no separate playback copy yet.</p>
            </Card>}
            <Card label="Photo albums" head={<SectionHead label="Photo albums" count={albums.length} action={<Button size="sm" onClick={() => setDialog({ k: "album" })}>New album</Button>} />}>
              {albums.length === 0 ? <p className="secondary cr-pad">No albums yet.</p> : albums.map((a) => (
                <div key={a._id} className="dl-album">
                  <div className="dl-albumhead"><b>{a.title}</b><span className="secondary wp-small">{a.assets.length} photo{a.assets.length === 1 ? "" : "s"}{a.shootId ? ` · ${shootName(a.shootId)}` : ""}</span><span className="sp" />
                    {shootSelect(a.shootId, (v) => void editItem({ itemId: a._id, shootId: v as Id<"shoots"> | null }), `Shoot day for ${a.title}`)}
                    <Button size="sm" onClick={() => setDialog({ k: "add", itemId: a._id, kind: "album" })}>Add photos</Button>
                    <button className="icon-btn sm" aria-label="Remove album" onClick={async () => { if (await ask({ title: `Remove ${a.title}?`, body: "Its photos leave Delivery. Nothing is deleted from Dropbox.", yes: "Remove", danger: true })) void removeItem({ itemId: a._id }); }}><Icon name="close" size={14} /></button>
                  </div>
                  <div className="dl-grid">{a.assets.map((x) => (
                    <div key={x._id} className={`dl-tile${a.coverId === x._id ? " cover" : ""}${drag === x._id ? " dragging" : ""}`} draggable onDragStart={() => setDrag(x._id)} onDragEnd={() => setDrag(null)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag && drag !== x._id) dropOn(drag, x._id); setDrag(null); }}>
                      <Thumb assetId={x._id} name={x.name} />
                      {a.coverId === x._id && <span className="dl-cover">Cover</span>}
                      {!x.published && <span className="dl-new">New</span>}
                      <button className="dl-more" aria-label="Photo options" onClick={() => setMenu(menu === x._id ? null : x._id)}><Icon name="more" size={14} /></button>
                      {menu === x._id && <div className="cv-menu glass dl-menu" role="menu" onMouseLeave={() => setMenu(null)}>
                        <button role="menuitem" onClick={() => { setMenu(null); void editItem({ itemId: a._id, coverId: x._id }); }}>Make it the cover</button>
                        <DownloadItem assetId={x._id} label="Download original" />
                        <button role="menuitem" className="danger" onClick={() => { setMenu(null); void removeAsset({ assetId: x._id }); }}>Remove from album</button>
                      </div>}
                    </div>
                  ))}</div>
                </div>
              ))}
              <p className="secondary wp-small cr-pad">Drag to arrange. Uploads go in at the end; press Publish changes when it’s ready for the client.</p>
            </Card>
          </div>
          <div className="dl-side">
            <Card label="Kept until" head={<SectionHead label="Kept until" action={<Button size="sm" variant="ghost" onClick={() => setDialog({ k: "term" })}>Change</Button>} />}>
              <div className="cr-pad">
                <b className="dl-big">{d.keptUntil ? longDay(d.keptUntil) : `${d.termYears} year${d.termYears === 1 ? "" : "s"} from publishing`}</b>
                <p className="secondary wp-small">{d.termYears} year{d.termYears === 1 ? "" : "s"} included, then {usd(d.priceCents)} a year to keep it. You set the term and price in Settings.</p>
                {left !== null && left <= 30 && d.state !== "ended" && <Button size="sm" onClick={() => setDialog({ k: "renew" })}>Renewal…</Button>}
                {d.renewal && <p className="wp-small">{d.renewal.status === "kept" ? (d.renewalInvoiceId ? <>{d.renewal.by ?? "The client"} chose Keep it. Their invoice is drafted: <a {...linkProps(`/payments/invoices/${d.renewalInvoiceId}`)}>open it and send it</a>. Paid, it adds the year.</> : `${d.renewal.by ?? "The client"} chose Keep it. Send them the invoice, then mark it renewed.`) : d.renewal.status === "declined" ? `${d.renewal.by ?? "The client"} said No thanks.` : d.renewal.status === "offered" ? "Renewal offered in their Delivery." : d.renewal.status === "free" ? "Kept another year, free." : d.renewal.status === "ending" ? "Letting it end." : "Renewed."}</p>}
              </div>
            </Card>
            <Card label="Who sees it" head={<SectionHead label="Who sees it" count={d.people.length} />}>
              <div className="cr-pad"><p className="secondary wp-small">The people who can open this project, as in Review.</p>{d.people.map((e) => <div key={e} className="wp-small">{e}</div>)}{d.people.length === 0 && <p className="wp-small">Nobody yet: share the project with the client first.</p>}</div>
            </Card>
          </div>
        </div>
      </div>
      {dialog?.k === "add" && <AddFiles projectId={projectId} itemId={dialog.itemId} kind={dialog.kind} hasDropbox={g.project.dropbox} onClose={() => setDialog(null)} show={show} />}
      {dialog?.k === "album" && <NewAlbum deliveryId={d._id} shoots={g.shoots} onClose={() => setDialog(null)} create={addAlbum} show={show} />}
      {dialog?.k === "publish" && <Publish d={d} fresh={fresh} onClose={() => setDialog(null)} show={show} />}
      {dialog?.k === "renew" && <Renewal d={d} onClose={() => setDialog(null)} show={show} />}
      {dialog?.k === "term" && <Term d={d} onClose={() => setDialog(null)} show={show} />}
      {dialog?.k === "preview" && <Modal onClose={() => setDialog(null)} label="Preview as client" width={980}><div className="crm-dialog"><DialogHeader eyebrow="Preview as client" title={g.project.label} body="What the client sees now: only what's published." onClose={() => setDialog(null)} /><ClientView items={d.items.map((i) => ({ _id: i._id, kind: i.kind, title: i.title, coverId: i.coverId, assets: i.assets.filter((x) => x.published) })).filter((i) => i.assets.length)} downloads /></div></Modal>}
      {confirmNode}{toast}
    </>
  );
}

function AddFiles({ projectId, itemId, kind, hasDropbox, onClose, show }: { projectId: string; itemId: string; kind: "videos" | "album"; hasDropbox: boolean; onClose: () => void; show: (t: string) => void }) {
  const list = useAction(api.projects.dropboxFiles);
  const page = useQuery(api.projects.page, kind === "videos" ? { projectId: projectId as Id<"projects"> } : "skip");
  const add = useMutation(api.delivery.addFiles);
  const [files, setFiles] = useState<Array<{ path: string; name: string; size: number }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (hasDropbox) list({ projectId: projectId as Id<"projects"> }).then(setFiles, (e) => setErr(errLine(e))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const want = (n: string) => (kind === "videos" ? /\.(mp4|mov|m4v|webm)$/i : /\.(jpe?g|png|webp|heic|heif|gif|tiff?)$/i).test(n);
  const shown = (files ?? []).filter((f) => want(f.name));
  const cuts = (page?.videos ?? []).filter((x: { latest?: { status: string } | null }) => x.latest && x.latest.status === "ready") as Array<{ _id: string; title: string; latest: { number: number; versionId: Id<"versions"> } }>;
  const go = async (sel: Parameters<typeof add>[0]["files"]) => {
    setBusy(true);
    try { const r = await add({ itemId: itemId as Id<"deliveryItems">, files: sel }); show(`Added ${r.added}.`); onClose(); } catch (e) { show(errLine(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Add files" width={640}>
      <div className="crm-dialog">
        <DialogHeader eyebrow={kind === "videos" ? "Video" : "Photo album"} title={kind === "videos" ? "Add videos" : "Add photos"} body="From the project's Dropbox folder (the originals stay there)." onClose={onClose} />
        {!hasDropbox ? <p className="secondary">This project has no Dropbox folder yet. Files in its folder under Apps/Wrangler Review show here.</p>
          : err ? <p className="rl-err">{err}</p> : files === null ? <SkeletonRows n={3} />
          : shown.length === 0 ? <p className="secondary">No {kind === "videos" ? "videos" : "photos"} in the project's folder.</p>
          : <div className="pj-picklist">{shown.map((f) => <label key={f.path} className="pj-pick"><input type="checkbox" checked={pick.has(f.path)} onChange={(e) => { const s = new Set(pick); if (e.target.checked) s.add(f.path); else s.delete(f.path); setPick(s); }} /><span className="txt"><b>{f.name}</b><span>{gb(f.size)}</span></span></label>)}</div>}
        {kind === "videos" && cuts.length > 0 && <><span className="wp-eyebrow">From this project's cuts</span><div className="pj-picklist">{cuts.map((c) => <div key={c._id} className="pj-pick"><span className="txt"><b>{c.title} · v{c.latest.number}</b></span><Button size="sm" disabled={busy} onClick={() => void go([{ kind: "version", versionId: c.latest.versionId }])}>Add</Button></div>)}</div></>}
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" loading={busy} disabled={!pick.size} onClick={() => void go(shown.filter((f) => pick.has(f.path)).map((f) => ({ kind: "dropbox" as const, path: f.path, name: f.name, size: f.size })))}>Add {pick.size || ""}</Button></div>
      </div>
    </Modal>
  );
}

function NewAlbum({ deliveryId, shoots, onClose, create, show }: { deliveryId: string; shoots: Data["shoots"]; onClose: () => void; create: ReturnType<typeof useMutation<typeof api.delivery.addAlbum>>; show: (t: string) => void }) {
  const [title, setTitle] = useState(""), [shoot, setShoot] = useState("");
  return (
    <Modal onClose={onClose} label="New album" width={460}>
      <form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void create({ deliveryId, title, ...(shoot ? { shootId: shoot as Id<"shoots"> } : {}) }).then(onClose, (er) => show(errLine(er))); }}>
        <DialogHeader title="New photo album" onClose={onClose} />
        <TextField label="Name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Day 1 stills" autoFocus />
        {shoots.length > 0 && <label className="wp-field"><span className="wp-field-label">Shoot day (optional)</span><select className="input" value={shoot} onChange={(e) => setShoot(e.target.value)}><option value="">None</option>{shoots.map((s) => <option key={s._id} value={s._id}>{longDay(s.date)} · {s.location}</option>)}</select></label>}
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" type="submit">Make it</Button></div>
      </form>
    </Modal>
  );
}

function Publish({ d, fresh, onClose, show }: { d: NonNullable<Data["delivery"]>; fresh: number; onClose: () => void; show: (t: string) => void }) {
  const publish = useMutation(api.delivery.publish);
  const [tell, setTell] = useState(d.state === "draft");
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} label="Publish" width={480}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Delivery" title={d.state === "draft" ? "Publish the delivery?" : "Publish changes?"} body={fresh ? `${fresh} new file${fresh === 1 ? "" : "s"} become visible to the client.` : "The client sees it as it is now."} onClose={onClose} />
        <label className="cr-switch"><input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} disabled={!d.people.length} /> Tell the client in their Inbox: “New files are ready in your Delivery.”</label>
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" loading={busy} onClick={async () => { setBusy(true); try { const r = await publish({ deliveryId: d._id, tell }); show(r.told ? `Published. ${r.told} told.` : "Published."); onClose(); } catch (e) { show(errLine(e)); setBusy(false); } }}>Publish</Button></div>
      </div>
    </Modal>
  );
}

function Renewal({ d, onClose, show }: { d: NonNullable<Data["delivery"]>; onClose: () => void; show: (t: string) => void }) {
  const renew = useMutation(api.delivery.renewal);
  const renewed = useMutation(api.delivery.renewed);
  const go = (choice: "offer" | "free" | "end") => void renew({ deliveryId: d._id, choice }).then(() => { show(choice === "offer" ? "Offered in their Delivery." : choice === "free" ? "Kept another year." : "It ends on the day."); onClose(); }, (e) => show(errLine(e)));
  return (
    <Modal onClose={onClose} label="Renewal" width={520}>
      <div className="crm-dialog hm-pick">
        <DialogHeader eyebrow="Renewal" title={d.keptUntil ? `Ends ${longDay(d.keptUntil)}` : "Renewal"} body={d.keptUntil ? `On ${longDay(d.keptUntil)} the files leave Delivery. The client is reminded 7 days before to download them.` : undefined} onClose={onClose} />
        <div className="hm-list">
          <button className="hm-row" onClick={() => go("offer")}><Icon name="invoice" size={18} /><span className="t"><b>Offer a renewal</b><span className="secondary">A Keep it button in their Delivery, {usd(d.priceCents)} a year. If they choose it, their invoice is drafted for you to send.</span></span></button>
          <button className="hm-row" onClick={() => go("free")}><Icon name="star" size={18} /><span className="t"><b>Keep it another year, free</b></span></button>
          <button className="hm-row" onClick={() => go("end")}><Icon name="clock" size={18} /><span className="t"><b>Let it end</b><span className="secondary">Nothing is deleted from Dropbox.</span></span></button>
          {d.renewal?.status === "kept" && <button className="hm-row" onClick={() => void renewed({ deliveryId: d._id }).then(() => { show("Renewed for a year."); onClose(); }, (e) => show(errLine(e)))}><Icon name="check-circle" size={18} /><span className="t"><b>Mark it renewed</b><span className="secondary">Paid another way, or no invoice: another year now. A paid invoice adds it by itself.</span></span></button>}
        </div>
      </div>
    </Modal>
  );
}

function Term({ d, onClose, show }: { d: NonNullable<Data["delivery"]>; onClose: () => void; show: (t: string) => void }) {
  const set = useMutation(api.delivery.setTerm);
  const [until, setUntil] = useState(d.keptUntil ?? ""), [years, setYears] = useState(d.termYears), [price, setPrice] = useState((d.priceCents / 100).toFixed(2));
  return (
    <Modal onClose={onClose} label="Kept until" width={460}>
      <form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void set({ deliveryId: d._id, ...(until ? { keptUntil: until } : {}), termYears: years, priceCents: Math.round(Number(price) * 100) }).then(() => { show("Saved."); onClose(); }, (er) => show(errLine(er))); }}>
        <DialogHeader title="Change for this delivery" onClose={onClose} />
        {d.keptUntil ? <label className="wp-field"><span className="wp-field-label">Kept until</span><input className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
          : <label className="wp-field"><span className="wp-field-label">Included term</span><select className="input" value={years} onChange={(e) => setYears(Number(e.target.value))}>{[1, 2, 3, 4, 5, 10].map((n) => <option key={n} value={n}>{n} year{n === 1 ? "" : "s"}</option>)}</select></label>}
        <TextField label="Then, per year ($)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" type="submit">Save</Button></div>
      </form>
    </Modal>
  );
}

// ---------- files: a thumbnail, a player, a download ----------

const urlCache = new Map<string, Promise<{ url: string; name: string; download: boolean }>>();
function useAssetUrl(assetId: string, token?: string, on = true) {
  const get = useAction(api.delivery.assetUrl);
  const [u, setU] = useState<{ url: string; name: string; download: boolean } | null>(null);
  useEffect(() => {
    if (!on) return;
    const k = `${assetId}:${token ?? ""}`;
    if (!urlCache.has(k)) { urlCache.set(k, get({ assetId: assetId as Id<"deliveryAssets">, ...(token ? { token } : {}) })); setTimeout(() => urlCache.delete(k), 3 * 3_600_000); }
    let live = true;
    urlCache.get(k)!.then((x) => { if (live) setU(x); }, () => urlCache.delete(k));
    return () => { live = false; };
  }, [assetId, token, on]); // eslint-disable-line react-hooks/exhaustive-deps
  return u;
}
function Thumb({ assetId, name, token }: { assetId: string; name: string; token?: string }) {
  const [seen, setSeen] = useState(false);
  const u = useAssetUrl(assetId, token, seen);
  return <span className="dl-thumb" ref={(el) => { if (el && !seen) { const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }); io.observe(el); } }}>{u ? <img src={u.url} alt={name} loading="lazy" /> : <Icon name="eye" size={18} />}</span>;
}
function DownloadItem({ assetId, label, token }: { assetId: string; label: string; token?: string }) {
  const get = useAction(api.delivery.assetUrl);
  return <button role="menuitem" onClick={() => void get({ assetId: assetId as Id<"deliveryAssets">, ...(token ? { token } : {}) }).then((r) => { const a = document.createElement("a"); a.href = r.url; a.download = r.name; a.rel = "noopener"; a.click(); })}>{label}</button>;
}

type ViewItem = { _id: string; kind: "videos" | "album"; title: string; coverId: string | null; assets: Array<{ _id: string; name: string; size: number | null; media: "video" | "photo" | "file" }> };

/** What the client sees (also the owner's Preview and the shared-link page): videos to play, albums to open. */
export function ClientView({ items, downloads, token }: { items: ViewItem[]; downloads: boolean; token?: string }) {
  const [playing, setPlaying] = useState<{ item: ViewItem; i: number } | null>(null);
  if (!items.length) return <EmptyState icon="package" title="Nothing here yet." />;
  return (
    <div className="dl-client">
      {items.map((it) => (
        <section key={it._id} className="dl-sec">
          <h2 className="title-sm">{it.kind === "videos" ? "Video" : it.title}<span className="secondary wp-small"> · {it.assets.length} {it.kind === "videos" ? "video" : "photo"}{it.assets.length === 1 ? "" : "s"}</span></h2>
          {it.kind === "videos" ? <div className="dl-vids">{it.assets.map((x, i) => <button key={x._id} className="dl-vid glass" onClick={() => setPlaying({ item: it, i })}><Icon name="play" size={22} /><span className="t"><b>{x.name.replace(/\.[^.]+$/, "")}</b><span className="secondary wp-small">{x.size ? gb(x.size) : ""}</span></span></button>)}</div>
            : <div className="dl-grid">{it.assets.map((x, i) => <button key={x._id} className="dl-tile" onClick={() => setPlaying({ item: it, i })}><Thumb assetId={x._id} name={x.name} token={token} /></button>)}</div>}
        </section>
      ))}
      {playing && <Viewer item={playing.item} start={playing.i} downloads={downloads} token={token} onClose={() => setPlaying(null)} />}
    </div>
  );
}

/** A video playing (1103-44238) or a photo open (1103-44452): arrows, Download. */
function Viewer({ item, start, downloads, token, onClose }: { item: ViewItem; start: number; downloads: boolean; token?: string; onClose: () => void }) {
  const [i, setI] = useState(start);
  const x = item.assets[i];
  const u = useAssetUrl(x._id, token);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "ArrowRight") setI((n) => Math.min(item.assets.length - 1, n + 1)); if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1)); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [item.assets.length]);
  let sx = 0;
  return (
    <Modal onClose={onClose} label={x.name} width={1100}>
      <div className="dl-viewer" onTouchStart={(e) => { sx = e.touches[0].clientX; }} onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - sx; if (dx < -50) setI((n) => Math.min(item.assets.length - 1, n + 1)); if (dx > 50) setI((n) => Math.max(0, n - 1)); }}>
        <div className="dl-stage">{!u ? <SkeletonRows n={1} /> : x.media === "video" ? <video key={u.url} src={u.url} controls autoPlay playsInline /> : <img key={u.url} src={u.url} alt={x.name} />}</div>
        <div className="dl-vbar">
          <button className="icon-btn" aria-label="Previous" disabled={i === 0} onClick={() => setI(i - 1)}><Icon name="arrow-left" size={18} /></button>
          <span className="t"><b>{x.name}</b><span className="secondary wp-small">{i + 1} of {item.assets.length}</span></span>
          <button className="icon-btn" aria-label="Next" disabled={i === item.assets.length - 1} onClick={() => setI(i + 1)}><Icon name="arrow-right" size={18} /></button>
          <span className="sp" />
          {downloads && u && <a className="btn sm" href={u.url} download={u.name} rel="noopener"><Icon name="download" size={14} />Download {x.media === "photo" ? "this photo" : "original"}</a>}
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        {item.kind === "album" && <div className="dl-film">{item.assets.map((a, k) => <button key={a._id} className={k === i ? "on" : ""} onClick={() => setI(k)}><Thumb assetId={a._id} name={a.name} token={token} /></button>)}</div>}
      </div>
    </Modal>
  );
}

// ---------- the client's Delivery (1102-43850) ----------

export function ClientDelivery() {
  const ds = useQuery(api.delivery.forClient);
  const answer = useMutation(api.delivery.clientAnswer);
  const [toast, show] = useToast();
  const [pid, setPid] = useState<string | null>(() => new URLSearchParams(location.search).get("project"));
  const [sharing, setSharing] = useState(false);
  const d = (ds ?? []).find((x) => x.projectId === pid) ?? (ds ?? [])[0];
  return (
    <>
      <TopBar><span className="here">Delivery</span></TopBar>
      <div className="wp-page">
        <PageHeader title="Delivery" sub={d ? `${d.business ? `${d.business} keeps these files` : "Kept"}${d.keptUntil ? ` until ${longDay(d.keptUntil)}` : ""}.` : "Your final videos and photos, once they're ready."}
          actions={d ? <><Button onClick={() => setSharing(true)}>Share a link</Button></> : undefined} />
        {ds === undefined ? <SkeletonRows n={3} /> : !d ? <div className="wp-tablecard glass"><EmptyState icon="package" title="Nothing delivered yet." body="When your files are ready they show up here." /></div> : <>
          {ds.length > 1 && <select className="input dl-switch" value={d.projectId} onChange={(e) => setPid(e.target.value)} aria-label="Project">{ds.map((x) => <option key={x._id} value={x.projectId}>{x.project}</option>)}</select>}
          {d.offer && !d.answered && <div className="wp-notice glass dl-offer"><Icon name="clock" size={20} /><span className="txt"><b>Keep them another year for {usd(d.offer.priceCents)}?</b> Your files leave Delivery on {longDay(d.offer.until)}. Download anything you want first, or keep it all here for another year. You’d get an invoice; nothing happens unless you choose.</span>
            <span className="wk-acts"><Button variant="primary" size="sm" onClick={() => void answer({ deliveryId: d._id, keep: true }).then(() => show("Thanks. You'll get an invoice."), (e) => show(errLine(e)))}>Keep it</Button><Button size="sm" onClick={() => void answer({ deliveryId: d._id, keep: false }).then(() => show("Okay. Download what you want before then."), (e) => show(errLine(e)))}>No thanks</Button></span></div>}
          <ClientView items={d.items} downloads />
        </>}
      </div>
      {sharing && d && <ShareLink d={d} onClose={() => setSharing(false)} show={show} />}
      {toast}
    </>
  );
}

/** Share a link (1102-44505): everything or one folder or album; downloads on or off; turn it off any time. */
function ShareLink({ d, onClose, show }: { d: NonNullable<ReturnType<typeof useQuery<typeof api.delivery.forClient>>>[number]; onClose: () => void; show: (t: string) => void }) {
  const make = useMutation(api.delivery.makeLink);
  const setL = useMutation(api.delivery.setLink);
  const [what, setWhat] = useState(""), [dl, setDl] = useState(true);
  return (
    <Modal onClose={onClose} label="Share a link" width={540}>
      <div className="crm-dialog">
        <DialogHeader title="Share a link" body="Anyone with the link can see what you shared, without signing in. Nothing else in your portal. Turn the link off any time." onClose={onClose} />
        <label className="wp-field"><span className="wp-field-label">Share</span><select className="input" value={what} onChange={(e) => setWhat(e.target.value)}><option value="">Everything</option>{d.items.map((i) => <option key={i._id} value={i._id}>{i.kind === "videos" ? "The videos" : i.title}</option>)}</select></label>
        <label className="cr-switch"><input type="checkbox" checked={dl} onChange={(e) => setDl(e.target.checked)} /> Show a Download button</label>
        <p className="secondary wp-small">Without it there's no button, but people watching can still save what they see.</p>
        <div className="dfoot"><span className="sp" /><Button variant="primary" onClick={() => void make({ deliveryId: d._id, ...(what ? { itemId: what as Id<"deliveryItems"> } : {}), downloads: dl }).then(async (r) => show((await copy(shareUrl(r.token))) ? "Link copied." : shareUrl(r.token)), (e) => show(errLine(e)))}>Copy a new link</Button></div>
        {d.links.length > 0 && <div className="cv-people"><span className="wp-field-label">Your links</span>{d.links.map((l) => (
          <div key={l._id} className="cv-person"><Icon name="globe" size={18} /><span className="t"><b>{l.itemId ? d.items.find((i) => i._id === l.itemId)?.title ?? "One album" : "Everything"}</b><span className="secondary">{l.on ? (l.downloads ? "On · with Download" : "On · no Download button") : "Off"}</span></span>
            {l.on && <button className="btn ghost sm" onClick={() => void copy(shareUrl(l.token)).then(() => show("Copied."))}>Copy</button>}
            <button className="btn ghost sm" onClick={() => void setL({ linkId: l._id, on: !l.on })}>{l.on ? "Turn off" : "Turn on"}</button></div>
        ))}</div>}
      </div>
    </Modal>
  );
}

/** The shared-link page (1103-44666): no portal, no sign-in. */
export function SharedDelivery({ token }: { token: string }) {
  const s = useQuery(api.delivery.shared, { token });
  if (s === undefined) return <div className="cr-public"><SkeletonRows n={3} /></div>;
  if (s === null) return <div className="cr-public"><EmptyState icon="package" title="This link isn't working." body="It may have been turned off. Ask whoever sent it." /></div>;
  return (
    <div className="cr-public dl-public">
      <header className="cr-pubhead"><span className="wp-eyebrow">{s.by ? `Shared by ${s.by}` : "Shared files"}</span><h1 className="headline">Delivery</h1>
        <p className="secondary">{s.business ? `${s.business} keeps these files` : "Kept"}{s.keptUntil ? ` until ${longDay(s.keptUntil)}` : ""}.</p></header>
      <ClientView items={s.items} downloads={s.downloads} token={token} />
    </div>
  );
}
