// 5l (D187–D191; Design Log "Handoff ready: Creative planning" rounds 1 and 3): Creative planning's Overview, Docs
// (treatments, two-column scripts, interview questions, creative briefs: builder pages that are never signed) and
// Brand kits (kits as creative work: any number, on their own or attached to a client, lead or project). Each thing
// has a home chip (dashed "Not attached") with Move to… (homes.move), and a view-only Share link (D191).
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { Modal, useConfirm, useToast } from "../../ui/kit";
import { Button, ButtonLink, Card, DialogHeader, EmptyState, ListRow, PageHeader, PillTabs, SkeletonRows, TextField } from "../../ui/wp";
import { Icon, type IconName } from "../../ui/Icon";
import { errLine } from "../../ui/hold";
import { AttachDialog, type HomeKind } from "../projects/Homes";
import { BrandKitEditor } from "../settings/BrandKit";
import Builder from "../docs/builder/Builder";
import { HOME_ICON, HomeSelect, HomeTag, copyText, homeLink, shareUrl } from "./parts";
export { HomeSelect };

type HomeIn = { type: "client" | "project" | "shoot" | "lead"; id: string } | null;
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const crumbs = (here?: React.ReactNode, mid?: { to: string; label: string }) => (
  <TopBar><a {...linkProps("/production")}>Production</a><Sep /><a {...linkProps("/creative")}>Creative planning</a>{mid && <><Sep /><a {...linkProps(mid.to)}>{mid.label}</a></>}{here && <><Sep /><span className="here">{here}</span></>}</TopBar>
);

// ---------- Overview ----------

const MAKE: Array<{ icon: IconName; title: string; sub: string; to: string }> = [
  { icon: "document", title: "A creative doc", sub: "Treatment, script, interview questions or a brief", to: "/creative/docs?new=1" },
  { icon: "creative", title: "A canvas or mood board", sub: "Photos, notes, sketches, PDFs and links", to: "/creative/canvas?new=1" },
  { icon: "map-pin", title: "A place", sub: "Photos, sun times, access and contacts", to: "/creative/locations?new=1" },
  { icon: "layers", title: "A brand kit", sub: "Logo, colours, fonts, files and tone words", to: "/creative/kits?new=1" },
];
const KIND_ICON: Record<string, IconName> = { doc: "document", canvas: "creative", kit: "layers", place: "map-pin" };

export function CreativeOverview() {
  const o = useQuery(api.creative.overview);
  const [loose, setLoose] = useState(false);
  const rows = (o?.recent ?? []).filter((r) => !loose || (!r.home && r.kind !== "place"));
  return (
    <>
      {crumbs()}
      <div className="wp-page">
        <PageHeader eyebrow="Creative planning" title="Overview" sub="Treatments, scripts, boards, places and brand kits: the thinking before the shoot." />
        <div className="cr-make">
          {MAKE.map((m) => (
            <a key={m.title} className="cr-makecard glass" {...linkProps(m.to)}>
              <span className="ic"><Icon name={m.icon} size={20} /></span>
              <span className="t"><b>{m.title}</b><span className="secondary">{m.sub}</span></span>
              <Icon name="plus" size={16} />
            </a>
          ))}
        </div>
        <div className="cr-two">
          <Card label="Recent work" head={<div className="cr-head"><b>Recent work</b><span className="sp" />{o && o.counts.loose > 0 && <button type="button" className={`pill${loose ? " on" : ""}`} aria-pressed={loose} onClick={() => setLoose(!loose)}>Not attached · {o.counts.loose}</button>}</div>}>
            {o === undefined ? <SkeletonRows n={4} /> : rows.length === 0 ? <EmptyState icon="creative" title={loose ? "Everything has a home." : "Nothing here yet."} body={loose ? undefined : "Make a doc, a board, a place or a brand kit to start."} />
              : rows.map((r) => <ListRow key={`${r.kind}:${r.id}`} lead={{ icon: KIND_ICON[r.kind] }} title={r.name} meta={<>{r.sub} · {ago(r.at)}</>} trailing={r.kind === "place" ? undefined : <HomeTag home={r.home} />} to={r.to} />)}
          </Card>
          <Card label="Attached where" head={<div className="cr-head"><b>Attached where</b></div>}>
            {o === undefined ? <SkeletonRows n={3} /> : o.homes.length === 0 ? <p className="secondary cr-pad">Attach work to a client, lead, project or shoot day and it shows here.</p>
              : o.homes.map((h) => <ListRow key={`${h.type}:${h.id}`} lead={{ icon: HOME_ICON[h.type] ?? "folder" }} title={h.name} meta={`${h.n} thing${h.n === 1 ? "" : "s"}`} to={homeLink(h)} />)}
            {o && <p className="secondary cr-pad">{o.counts.docs} doc{o.counts.docs === 1 ? "" : "s"} · {o.counts.canvases} board{o.counts.canvases === 1 ? "" : "s"} · {o.counts.places} place{o.counts.places === 1 ? "" : "s"} · {o.counts.kits} kit{o.counts.kits === 1 ? "" : "s"}</p>}
          </Card>
        </div>
      </div>
    </>
  );
}

// ---------- Docs ----------

type DocKind = "treatment" | "script" | "interview" | "brief" | "blank";
const DOC_KINDS: Array<{ k: DocKind; name: string; many: string; sub: string }> = [
  { k: "treatment", name: "Treatment", many: "Treatments", sub: "Logline, story, look and feel, music, references" },
  { k: "script", name: "Two-column script", many: "Two-column scripts", sub: "Time · Picture · Sound rows" },
  { k: "interview", name: "Interview questions", many: "Interview questions", sub: "Warm-up, the story, wrap-up" },
  { k: "brief", name: "Creative brief", many: "Creative briefs", sub: "Objective, audience, message, deliverables, tone" },
  { k: "blank", name: "Blank", many: "Blank", sub: "A title and an empty page" },
];

export function CreativeDocs() {
  const list = useQuery(api.creative.docs);
  const [f, setF] = useState<"all" | DocKind | "loose">("all");
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).has("new"));
  const [toast, show] = useToast();
  const rows = (list ?? []).filter((d) => f === "all" || (f === "loose" ? !d.home : d.kind === f));
  const n = (k: string) => (list ?? []).filter((d) => (k === "loose" ? !d.home : d.kind === k)).length;
  return (
    <>
      {crumbs(undefined, { to: "/creative/docs", label: "Docs" })}
      <div className="wp-page">
        <PageHeader eyebrow="Creative planning" title="Docs" sub="Creative docs are never signed. Share one as a view-only link, or start a briefing from it." actions={<Button variant="primary" icon="plus" onClick={() => setOpen(true)}>New creative doc</Button>} />
        <PillTabs label="Filter" value={f} onChange={setF} items={[{ key: "all", label: "All", count: list?.length }, ...DOC_KINDS.filter((x) => x.k !== "blank").map((x) => ({ key: x.k, label: x.many, count: n(x.k) })), ...(n("loose") ? [{ key: "loose" as const, label: "Not attached", count: n("loose") }] : [])]} />
        <div className="wp-tablecard glass">
          {list === undefined ? <SkeletonRows n={4} /> : rows.length === 0 ? <EmptyState icon="document" title={list.length ? "Nothing here." : "No creative docs yet."} body={list.length ? undefined : "Start a treatment, a two-column script, interview questions or a creative brief."} actions={list.length ? undefined : <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>New creative doc</Button>} />
            : rows.map((d) => <ListRow key={d._id} lead={{ icon: "document" }} title={d.title} titleChip={d.shared ? <span className="pill sm">Shared</span> : undefined} meta={<>{d.kindName} · {ago(d.at)}</>} trailing={<HomeTag home={d.home} />} to={`/creative/docs/${d._id}`} />)}
        </div>
      </div>
      {open && <NewCreativeDoc onClose={() => setOpen(false)} show={show} />}
      {toast}
    </>
  );
}

function NewCreativeDoc({ onClose, show }: { onClose: () => void; show: (t: string) => void }) {
  const make = useMutation(api.creative.newDoc);
  const [kind, setKind] = useState<DocKind>("treatment");
  const [title, setTitle] = useState("");
  const [home, setHome] = useState<HomeIn>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const r = await make({ kind, ...(title.trim() ? { title } : {}), home }); navigate(`/creative/docs/${r.docId}`); }
    catch (e) { show(errLine(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="New creative doc" width={560}>
      <form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <DialogHeader eyebrow="Creative planning" title="New creative doc" onClose={onClose} />
        <div className="hm-list" role="radiogroup" aria-label="Template">
          {DOC_KINDS.map((x) => (
            <button key={x.k} type="button" role="radio" aria-checked={kind === x.k} className={`hm-row${kind === x.k ? " on" : ""}`} onClick={() => setKind(x.k)}>
              <Icon name={kind === x.k ? "check-circle" : "document"} size={18} /><span className="t"><b>{x.name}</b><span className="secondary">{x.sub}</span></span>
            </button>
          ))}
        </div>
        <TextField label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={DOC_KINDS.find((x) => x.k === kind)!.name} />
        <HomeSelect kind="creativeDoc" value={home} onChange={setHome} />
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" type="submit" loading={busy}>Make it</Button></div>
      </form>
    </Modal>
  );
}

/** The creative doc in the builder: Builder's creative mode (home chip, Move to…, Share link, Start a briefing). */
export function CreativeDocPage({ docId }: { docId: string }) {
  const d = useQuery(api.creative.doc, { docId });
  if (d === undefined) return <>{crumbs(undefined, { to: "/creative/docs", label: "Docs" })}<div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (d === null) return <>{crumbs(undefined, { to: "/creative/docs", label: "Docs" })}<div className="wp-page"><EmptyState icon="document" title="This creative doc isn't here." actions={<ButtonLink to="/creative/docs">All docs</ButtonLink>} /></div></>;
  return <Builder key={d.buildId} mode={{ kind: "build", buildId: d.buildId, creative: d }} />;
}

// ---------- Brand kits (round 3) ----------

export function BrandKits() {
  const d = useQuery(api.creative.kits);
  const [f, setF] = useState<"all" | "client" | "lead" | "project" | "loose">("all");
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).has("new"));
  const [toast, show] = useToast();
  const kits = d?.kits ?? [];
  const rows = kits.filter((k) => f === "all" || (f === "loose" ? !k.home : k.home?.type === f));
  const n = (t: string) => kits.filter((k) => (t === "loose" ? !k.home : k.home?.type === t)).length;
  return (
    <>
      {crumbs(undefined, { to: "/creative/kits", label: "Brand kits" })}
      <div className="wp-page">
        <PageHeader eyebrow="Creative planning" title="Brand kits" sub="Logos, colours, fonts, files and tone words for clients and potential clients. Make one on its own or attach it to a client, lead or project. Your own business’s kit stays in Settings › Brand kit." actions={<Button variant="primary" icon="plus" onClick={() => setOpen(true)}>New brand kit</Button>} />
        <PillTabs label="Filter" value={f} onChange={setF} items={[{ key: "all", label: "All", count: kits.length }, { key: "client", label: "Clients", count: n("client") }, { key: "lead", label: "Leads", count: n("lead") }, { key: "project", label: "Projects", count: n("project") }, { key: "loose", label: "Not attached", count: n("loose") }]} />
        {d === undefined ? <Card label="Loading"><SkeletonRows n={3} /></Card> : rows.length === 0 ? <div className="wp-tablecard glass"><EmptyState icon="layers" title={kits.length ? "Nothing here." : "No brand kits yet."} body={kits.length ? undefined : "Start blank, or from a copy of a client's kit."} actions={kits.length ? undefined : <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>New brand kit</Button>} /></div>
          : <div className="cr-kits">
            {rows.map((k) => {
              const dark = [...k.colors].sort((a, b) => lum(a) - lum(b))[0] ?? "#1d1d1f";
              return (
                <a key={k._id} className="cr-kit glass" {...linkProps(`/creative/kits/${k._id}`)}>
                  <span className="logo" style={{ background: dark }}>{k.logo ? <img src={k.logo} alt="" /> : <span>{k.name.slice(0, 1)}</span>}</span>
                  <span className="body">
                    <b>{k.name}</b>
                    <span className="strip">{k.colors.slice(0, 8).map((c, i) => <i key={i} style={{ background: c }} />)}{!k.colors.length && <span className="secondary wp-small">No colours yet</span>}</span>
                    <span className="secondary wp-small">{k.colors.length} colour{k.colors.length === 1 ? "" : "s"} · {k.fonts} font{k.fonts === 1 ? "" : "s"} · {k.files} file{k.files === 1 ? "" : "s"}{k.shared ? " · Shared" : ""}</span>
                    <HomeTag home={k.home} />
                  </span>
                </a>
              );
            })}
          </div>}
      </div>
      {open && d && <NewKit kits={d.kits} companies={d.companies} onClose={() => setOpen(false)} show={show} />}
      {toast}
    </>
  );
}
function lum(hex: string) { const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return 1; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }

function NewKit({ kits, companies, onClose, show }: { kits: Array<{ _id: string; name: string }>; companies: Array<{ _id: string; name: string }>; onClose: () => void; show: (t: string) => void }) {
  const make = useMutation(api.creative.newKit);
  const [name, setName] = useState("");
  const [from, setFrom] = useState<"blank" | "copy">("blank");
  const [src, setSrc] = useState("");
  const [home, setHome] = useState<HomeIn>(null);
  const [busy, setBusy] = useState(false);
  const srcName = useMemo(() => [...kits, ...companies].find((x) => x._id === src.split(":")[1])?.name, [src, kits, companies]);
  const go = async () => {
    setBusy(true);
    try {
      const [t, id] = src.split(":");
      const kitId = await make({ name, home, ...(from === "copy" && t === "kit" ? { fromKitId: id } : {}), ...(from === "copy" && t === "client" ? { fromClientId: id as Id<"clients"> } : {}) });
      navigate(`/creative/kits/${kitId}`);
    } catch (e) { show(errLine(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="New brand kit" width={540}>
      <form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <DialogHeader eyebrow="Creative planning" title="New brand kit" onClose={onClose} />
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Northwind Outfitters brand" autoFocus />
        <div className="hm-list" role="radiogroup" aria-label="Start from">
          <button type="button" role="radio" aria-checked={from === "blank"} className={`hm-row${from === "blank" ? " on" : ""}`} onClick={() => setFrom("blank")}><Icon name={from === "blank" ? "check-circle" : "plus"} size={18} /><span className="t"><b>Blank</b><span className="secondary">Start empty</span></span></button>
          <button type="button" role="radio" aria-checked={from === "copy"} className={`hm-row${from === "copy" ? " on" : ""}`} onClick={() => setFrom("copy")} disabled={!kits.length && !companies.length}><Icon name={from === "copy" ? "check-circle" : "layers"} size={18} /><span className="t"><b>A copy of a kit</b><span className="secondary">Its colours, fonts, links and tone words (files and the logo aren't copied)</span></span></button>
        </div>
        {from === "copy" && <label className="wp-field"><span className="wp-field-label">Copy</span>
          <select className="input" value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="">Pick a kit</option>
            {companies.map((c) => <option key={c._id} value={`client:${c._id}`}>{c.name}</option>)}
            {kits.map((k) => <option key={k._id} value={`kit:${k._id}`}>{k.name}</option>)}
          </select>
          {srcName && <span className="wp-hint">A copy: changes to the new kit don’t change {srcName}.</span>}
        </label>}
        <HomeSelect kind="kit" value={home} onChange={setHome} />
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" type="submit" loading={busy} disabled={!name.trim() || (from === "copy" && !src)}>Make the kit</Button></div>
      </form>
    </Modal>
  );
}

export function KitPage({ kitId }: { kitId: string }) {
  const k = useQuery(api.creative.kit, { kitId });
  const rename = useMutation(api.creative.renameKit);
  const shareKit = useMutation(api.creative.shareKit);
  const remove = useMutation(api.creative.removeKit);
  const [toast, show] = useToast();
  const [ask, confirmNode] = useConfirm();
  const [moving, setMoving] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  if (k === undefined) return <>{crumbs(undefined, { to: "/creative/kits", label: "Brand kits" })}<div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (k === null) return <>{crumbs(undefined, { to: "/creative/kits", label: "Brand kits" })}<div className="wp-page"><EmptyState icon="layers" title="This brand kit isn't here." actions={<ButtonLink to="/creative/kits">All brand kits</ButtonLink>} /></div></>;
  const url = k.share ? shareUrl("kit", k.share.token) : null;
  const onShare = async () => {
    try {
      if (!k.share?.on) { await shareKit({ kitId, on: true }); show("Link on. Copy it from Share link."); }
      else if (url) show((await copyText(url)) ? "Link copied. Anyone with it can see this kit, not edit it." : url);
    } catch (e) { show(errLine(e)); }
  };
  return (
    <>
      {crumbs(k.name, { to: "/creative/kits", label: "Brand kits" })}
      <div className="wp-page">
        <PageHeader eyebrow="Brand kit" title={k.name} sub={<HomeTag home={k.home} onMove={() => setMoving(true)} />} actions={<>
          <Button size="sm" onClick={() => setNaming(k.name)}>Rename</Button>
          {k.share?.on && <Button size="sm" variant="ghost" onClick={() => void shareKit({ kitId, on: false }).then(() => show("The link is off."), (e) => show(errLine(e)))}>Turn the link off</Button>}
          <Button size="sm" variant="primary" icon="external" onClick={() => void onShare()}>{k.share?.on ? "Copy share link" : "Share link"}</Button>
        </>} />
        {k.copiedFrom && <div className="wp-notice glass"><Icon name="info" size={18} /><span className="txt">Copied from {k.copiedFrom.name} on {new Date(k.copiedFrom.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Changes here don’t change that kit.</span></div>}
        <BrandKitEditor kitId={kitId} show={show} />
        <div className="cr-foot"><button type="button" className="btn ghost danger" onClick={async () => { if (await ask({ title: `Delete ${k.name}?`, body: "Its files go too. A share link to it stops working.", yes: "Delete", danger: true })) { try { await remove({ kitId }); navigate("/creative/kits"); } catch (e) { show(errLine(e)); } } }}>Delete this kit</button></div>
      </div>
      {moving && <AttachDialog kind="kit" id={kitId} name={k.name} hasHome={!!k.home} onClose={() => setMoving(false)} show={show} />}
      {naming !== null && <Modal onClose={() => setNaming(null)} label="Rename" width={440}><form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void rename({ kitId, name: naming }).then(() => setNaming(null), (er) => show(errLine(er))); }}>
        <DialogHeader title="Rename the kit" onClose={() => setNaming(null)} /><TextField label="Name" value={naming} onChange={(e) => setNaming(e.target.value)} autoFocus />
        <div className="dfoot"><button type="button" className="btn ghost" onClick={() => setNaming(null)}>Cancel</button><Button variant="primary" type="submit" disabled={!naming.trim()}>Save</Button></div></form></Modal>}
      {confirmNode}{toast}
    </>
  );
}

// ---------- the no-account pages (/cd/<token>, /kit/<token>) ----------

export function SharedCreativeDoc({ token }: { token: string }) {
  const d = useQuery(api.creative.sharedDoc, { token });
  if (d === undefined) return <div className="cr-public"><SkeletonRows n={3} /></div>;
  if (d === null) return <div className="cr-public"><EmptyState icon="document" title="This link isn't working." body="It may have been turned off. Ask whoever sent it." /></div>;
  return (
    <div className="cr-public">
      <header className="cr-pubhead"><span className="wp-eyebrow">{d.from ?? ""}{d.from ? " · " : ""}{d.kind}</span><h1 className="headline">{d.title}</h1>
        {d.pdf && <a className="btn sm" href={d.pdf} target="_blank" rel="noreferrer">Download PDF</a>}</header>
      {d.pdf ? <iframe className="cr-pdf glass" src={d.pdf} title={d.title} /> : <p className="secondary">The page isn't available.</p>}
    </div>
  );
}

export function SharedKit({ token }: { token: string }) {
  const k = useQuery(api.creative.sharedKit, { token });
  const [toast, show] = useToast();
  if (k === undefined) return <div className="cr-public"><SkeletonRows n={3} /></div>;
  if (k === null) return <div className="cr-public"><EmptyState icon="layers" title="This link isn't working." body="It may have been turned off. Ask whoever sent it." /></div>;
  return (
    <div className="cr-public">
      <header className="cr-pubhead"><span className="wp-eyebrow">{k.from ? `${k.from} · ` : ""}Brand kit</span><h1 className="headline">{k.name}</h1></header>
      {k.logo && <Card label="Logo"><div className="cr-pad"><div className="bk-logo dark"><img src={k.logo} alt={`${k.name} logo`} /></div></div></Card>}
      {k.colors.length > 0 && <Card label="Colours" head={<div className="cr-head"><b>Colours</b><span className="secondary wp-small">Tap a colour to copy its code.</span></div>}><div className="cr-pad bk-swatches">{k.colors.map((c, i) => <button key={i} type="button" className="bk-swatch" onClick={() => void copyText(c.hex).then(() => show(`Copied ${c.hex}`))}><i style={{ background: c.hex }} />{c.hex}{c.name ? ` · ${c.name}` : ""}</button>)}</div></Card>}
      {(k.fonts.heading || k.fonts.body) && <Card label="Fonts" head={<div className="cr-head"><b>Fonts</b></div>}><div className="cr-pad">{k.fonts.heading && <p>Headings: <b>{k.fonts.heading}</b></p>}{k.fonts.body && <p>Body: <b>{k.fonts.body}</b></p>}</div></Card>}
      {k.files.length > 0 && <Card label="Files" head={<div className="cr-head"><b>Files</b></div>}>{k.files.map((f, i) => <ListRow key={i} lead={{ icon: "document" }} title={f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.name}</a> : f.name} meta={`${(f.size / 1024 / 1024).toFixed(1)} MB`} />)}</Card>}
      {k.links.length > 0 && <Card label="Links" head={<div className="cr-head"><b>Links</b></div>}>{k.links.map((l, i) => <ListRow key={i} lead={{ icon: "globe" }} title={<a href={/^https?:/i.test(l.url) ? l.url : `https://${l.url}`} target="_blank" rel="noreferrer">{l.url.replace(/^https?:\/\//, "")}</a>} meta={l.label} />)}</Card>}
      {k.tone.length > 0 && <Card label="Tone words" head={<div className="cr-head"><b>Tone words</b></div>}><div className="cr-pad bk-tones">{k.tone.map((t) => <span key={t} className="bk-tone on">{t}</span>)}</div></Card>}
      {toast}
    </div>
  );
}
