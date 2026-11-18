// The Shoot page (D203; frames 5i / Overview desktop 1056-28129, phone 1055-27995, Releases desktop 1056-28847, phone
// 1041-22663) with its tabs Overview · Call sheet · Shot list · Gear · Releases · Locations, and releases on set
// (D193): New release (1041-23004 …), Hand over (1042-23136), the signer's own steps (Sign's, unchanged: rule 9) and
// Hand back (1042-23898).
import { useEffect, useState } from "react";
import { usePerms } from "../../lib/teamAccess";
import { useConvex, useMutation, useQuery, useAction } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, ButtonLink, Card, DialogHeader, EmptyState, PageHeader, SkeletonRows, TextField } from "../../ui/wp";
import { Icon, type IconName } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errLine } from "../../ui/hold";
import { clock } from "./shotTime";
import { AttachDialog } from "../projects/Homes";
import { GearTab } from "./Packing";
import { LocationsTab } from "./Places";
import { uploadToStorage } from "../docs/pages/common";
import { setSession } from "../docs/lib/client";
import SignerApp from "../docs/signer/SignerApp";
import { UnlockSetup, canPasskey, deviceName } from "./HandBackSetup";

export type ShootTab = "overview" | "callsheet" | "shotlist" | "gear" | "releases" | "locations";
type Page = NonNullable<ReturnType<typeof useQuery<typeof api.shootPage.get>>>;
const dayText = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "numeric", day: "numeric" });
const when = (t: number) => new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Crumbs({ title }: { title?: string }) {
  return <TopBar><a {...linkProps("/production")}>Production</a><Sep /><a {...linkProps("/production/shoots")}>Shoots</a>{title && <><Sep /><span className="here">{title}</span></>}</TopBar>;
}

export default function ShootPage({ shootId, tab }: { shootId: string; tab: ShootTab }) {
  const d = useQuery(api.shootPage.get, { shootId });
  const [toast, show] = useToast();
  const [moving, setMoving] = useState(false);
  const askConfirm = useMutation(api.shoots.askClientConfirm);
  if (d === undefined) return <><Crumbs /><div className="wp-page prod"><Card label="Loading"><SkeletonRows n={5} /></Card></div></>;
  if (d === null) return <><Crumbs /><div className="wp-page prod"><EmptyState icon="clapper" title="This shoot isn't here any more" actions={<ButtonLink to="/production/shoots">All shoots</ButtonLink>} /></div></>;
  const title = `${d.project ? d.project.name : "Shoot"}${d.day && d.days > 1 ? ` · Day ${d.day}` : ""}`;
  const sub = [d.project && d.client ? d.client.name : null, dayText(d.date), `Call ${clock(d.call)}`, d.wrap ? `Wrap ${clock(d.wrap)}` : null].filter(Boolean).join(" · ");
  const go = (t: ShootTab) => navigate(`/production/shoots/${shootId}${t === "overview" ? "" : `?tab=${t}`}`);
  const tabs: Array<{ key: ShootTab; label: string; count?: string; warn?: boolean }> = [
    { key: "overview", label: "Overview" },
    { key: "callsheet", label: "Call sheet" },
    { key: "shotlist", label: "Shot list", count: d.shotList ? `${d.shotList.done}/${d.shotList.total}` : undefined },
    ...(d.canGear ? [{ key: "gear" as ShootTab, label: "Gear", count: d.gear ? `${d.gear.back || d.gear.loaded}/${d.gear.total}${d.gear.back ? " back" : d.gear.loaded ? " loaded" : ""}` : undefined }] : []),
    ...(d.releases ? [{ key: "releases" as ShootTab, label: "Releases", count: d.releases.missing ? `${d.releases.missing} missing` : d.releases.signed ? `${d.releases.signed} signed` : undefined, warn: !!d.releases.missing }] : []),
    { key: "locations", label: "Locations", count: d.places ? String(d.places) : undefined },
  ];
  return (
    <>
      <Crumbs title={title} />
      <div className="wp-page prod sp">
        <div className="sp-home">
          {d.project ? <a className="hm-chip" {...linkProps(`/projects/${d.project._id}`)}><Icon name="folder" size={14} />{d.client ? `${d.client.name} · ` : ""}{d.project.label}</a>
            : <span className="hm-chip own"><Icon name="folder" size={14} />On its own</span>}
          <button type="button" className="hm-move" onClick={() => setMoving(true)}>{d.project ? "Move to…" : "Attach to…"}</button>
        </div>
        <PageHeader eyebrow="Shoot" title={title} sub={sub} actions={<>
          {d.sheet ? <ButtonLink to={`/production/call-sheets/${d.sheet._id}`} variant={d.sheet.state === "sent" ? undefined : "primary"}>{d.sheet.state === "sent" ? "Call sheet" : "Send call sheet"}</ButtonLink>
            : d.project ? <ButtonLink to={`/production/call-sheets/new?shoot=${d._id}`} variant="primary">Make call sheet</ButtonLink> : null}
        </>} />
        <div className="sp-tabs" role="tablist" aria-label="Shoot">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`sp-tab${tab === t.key ? " on" : ""}`} onClick={() => go(t.key)}>
              {t.label}{t.count && <span className={`c${t.warn ? " warn" : ""}`}>{t.count}</span>}
            </button>
          ))}
        </div>
        {d.askConfirm && d.client && (
          <div className="sp-flag">
            <Icon name="info" size={18} />
            <span className="t"><b>Moved to {d.client.name}{d.askConfirm.from ? ` from ${d.askConfirm.from}` : ""}.</b> Their people don't know about this shoot yet.</span>
            <Button onClick={() => void askConfirm({ shootId: d._id }).then((r) => show(r.told ? `Asked ${d.client!.name} to confirm.` : "Nobody at the client has the portal yet."), (e) => show(errLine(e)))}>Ask {d.client.name} to confirm</Button>
          </div>
        )}
        {tab === "overview" && <Overview d={d} go={go} />}
        {tab === "callsheet" && <CallSheetTab d={d} />}
        {tab === "shotlist" && <ShotListTab d={d} />}
        {tab === "gear" && d.canGear && <GearTab shootId={d._id} show={show} />}
        {tab === "releases" && d.releases && <ReleasesTab shootId={d._id} show={show} />}
        {tab === "locations" && <LocationsTab shootId={d._id} show={show} />}
      </div>
      {moving && <AttachDialog kind="shoot" id={d._id} name={title} hasHome={!!d.project} onClose={() => setMoving(false)} show={show} />}
      {toast}
    </>
  );
}

// ---------- Overview ----------

function Row({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "ok" | "warn" }) {
  return <div className="sp-row"><span className="k">{k}</span><span className={`v${tone ? ` ${tone}` : ""}`}>{v}</span></div>;
}
function Overview({ d, go }: { d: Page; go: (t: ShootTab) => void }) {
  const glance: Array<{ t: ShootTab; icon: IconName; label: string; v: string; warn?: boolean }> = [
    { t: "callsheet", icon: "call-sheet", label: "Call sheet", v: !d.sheet ? "Not made yet" : d.sheet.state === "sent" ? `Sent${d.sheet.sentAt ? ` ${dayText(new Date(d.sheet.sentAt).toISOString().slice(0, 10))}` : ""} · ${d.sheet.opened} of ${d.sheet.of} opened` : "Draft" },
    { t: "shotlist", icon: "shot-list", label: "Shot list", v: d.shotList ? `${d.shotList.done} of ${d.shotList.total} done` : "None yet" },
    ...(d.releases ? [{ t: "releases" as ShootTab, icon: "sign" as IconName, label: "Releases", v: [d.releases.signed ? `${d.releases.signed} signed` : null, d.releases.missing ? `${d.releases.missing} missing` : null].filter(Boolean).join(" · ") || "None", warn: !!d.releases.missing }] : []),
    ...(d.canGear ? [{ t: "gear" as ShootTab, icon: "case" as IconName, label: "Gear", v: d.gear ? `${d.gear.loaded} packed · ${d.gear.back} back` : "No packing list" }] : []),
    { t: "locations", icon: "map-pin", label: "Locations", v: d.places ? `${d.places} ${d.places === 1 ? "place" : "places"}` : "None linked" },
  ];
  return (
    <div className="sp-grid">
      <div className="sp-col">
        <Card className="sp-card" label="When and where">
          <span className="wp-label">When and where</span>
          <Row k={dayText(d.date)} v={`Call ${clock(d.call)}${d.wrap ? ` · Wrap ${clock(d.wrap)}` : ""}`} />
          <Row k="Place" v={d.location} />
          {d.parking && <Row k="Parking" v={d.parking} />}
          <Row k="Project" v={d.project ? <a {...linkProps(`/projects/${d.project._id}`)}>{d.project.label}</a> : "On its own"} />
        </Card>
        <Card className="sp-card" label="Crew and client">
          <span className="wp-label">Crew and client</span>
          {d.crew.length === 0 && <p className="secondary">Nobody's on the crew yet.</p>}
          {d.crew.map((c, i) => <Row key={i} k={`${c.name} · ${c.role}`} v={c.state === "confirmed" ? "Confirmed" : c.state === "waiting" ? "Waiting" : c.state === "you" ? "You" : c.state === "listed" ? "" : c.state} tone={c.state === "confirmed" ? "ok" : c.state === "waiting" ? "warn" : undefined} />)}
          {d.client && <Row k={`${d.client.name} (client)`} v={d.askConfirm ? "Not asked yet" : d.confirmed ? `Confirmed ${dayText(new Date(d.confirmed.at).toISOString().slice(0, 10))}` : "Not confirmed"} tone={d.confirmed && !d.askConfirm ? "ok" : "warn"} />}
        </Card>
        {d.prepare.length > 0 && (
          <Card className="sp-card" label="To prepare">
            <span className="wp-label">To prepare</span>
            <ul className="sp-prep">{d.prepare.map((p, i) => <li key={i}><Icon name="check" size={14} />{p}</li>)}</ul>
          </Card>
        )}
      </div>
      <Card className="sp-card sp-glance" label="At a glance">
        <span className="wp-label">At a glance</span>
        {glance.map((g) => (
          <button key={g.t} type="button" className="sp-gl" onClick={() => go(g.t)}>
            <Icon name={g.icon} size={18} /><b>{g.label}</b><span className={`v${g.warn ? " warn" : ""}`}>{g.v}</span><Icon name="chevron-right" size={14} />
          </button>
        ))}
      </Card>
    </div>
  );
}

function CallSheetTab({ d }: { d: Page }) {
  if (!d.project) return <EmptyState icon="call-sheet" title="Attach this shoot to a project first" body="A call sheet goes out to the project's crew and client." />;
  if (!d.sheet) return <EmptyState icon="call-sheet" title="No call sheet yet" body="Make one from your template, then send it to the crew and the client." actions={<ButtonLink variant="primary" to={`/production/call-sheets/new?shoot=${d._id}`}>Make call sheet</ButtonLink>} />;
  return (
    <Card className="sp-card" label="Call sheet">
      <span className="wp-label">Call sheet</span>
      <Row k="State" v={d.sheet.state === "sent" ? `Sent · ${d.sheet.opened} of ${d.sheet.of} opened` : "Draft"} tone={d.sheet.state === "sent" ? "ok" : undefined} />
      <div className="sp-actions"><ButtonLink variant="primary" to={`/production/call-sheets/${d.sheet._id}`}>Open call sheet</ButtonLink></div>
    </Card>
  );
}

function ShotListTab({ d }: { d: Page }) {
  if (!d.shotList) return <EmptyState icon="shot-list" title="No shot list for this day" body="Make one in Shot lists and link it to this shoot day, or attach a list you already have." actions={<ButtonLink variant="primary" to="/production/shot-lists">Shot lists</ButtonLink>} />;
  return (
    <Card className="sp-card" label="Shot list">
      <span className="wp-label">Shot list</span>
      <Row k="Done" v={`${d.shotList.done} of ${d.shotList.total}`} tone={d.shotList.total && d.shotList.done === d.shotList.total ? "ok" : undefined} />
      <div className="sp-actions">
        <ButtonLink variant="primary" to={`/production/shoots/${d._id}/shot-list`}>On-set checklist</ButtonLink>
        <ButtonLink to={`/production/shot-lists/${d.shotList._id}`}>Edit the list</ButtonLink>
      </div>
    </Card>
  );
}

// ---------- Releases (D193) ----------

type RelData = NonNullable<ReturnType<typeof useQuery<typeof api.releases.forShoot>>>;
const RELEASE_STATE: Record<string, string> = { draft: "Not ready", ready: "Ready to sign", signing: "Out for signing", signed: "Signed", cancelled: "Cancelled" };

function ReleasesTab({ shootId, show }: { shootId: string; show: (t: string) => void }) {
  const d = useQuery(api.releases.forShoot, { shootId });
  const mark = useMutation(api.releases.markShot);
  const remove = useMutation(api.releases.remove);
  const [making, setMaking] = useState<{ shotIds: string[] } | null>(null);
  const [marking, setMarking] = useState(false);
  const { team } = usePerms();
  if (d === undefined) return <Card label="Loading"><SkeletonRows n={3} /></Card>;
  if (d === null) return null;
  const signed = d.releases.filter((r) => r.state === "signed").length;
  const num = new Map(d.shots.map((s) => [s._id as string, s.number]));
  return (
    <>
      <Card className="sp-card sp-rel" label="Releases">
        <div className="sp-relhead"><Icon name="sign" size={16} /><span className="wp-label">Releases · {signed} signed</span><span className="sp" />
          {d.shots.length > 0 && <Button size="sm" onClick={() => setMarking(true)}>Which shots need one</Button>}
          <Button size="sm" onClick={() => setMaking({ shotIds: [] })}>New release</Button></div>
        {d.releases.length === 0 && <p className="secondary">No releases yet. Start one for anyone on camera, a minor (signed by a parent or guardian) or a place.</p>}
        {d.releases.map((r) => (
          <div key={r._id} className="sp-relrow">
            <span className="t"><b>{r.kind === "minor" ? r.minorName : r.name}</b>
              <span className="secondary">{r.kindName} release · {r.state === "signed" && r.signedAt ? `Signed in person · ${when(r.signedAt)}` : RELEASE_STATE[r.state]}{r.kind === "minor" ? ` · signed by ${r.name}` : ""} · {r.shotIds.length ? `covers ${r.shotIds.map((x) => `#${num.get(x) ?? "?"}`).join(", ")}` : "the whole shoot"}</span></span>
            {r.state === "signed" && r.documentId ? <a className="sp-link" {...linkProps(`/sign/d/${r.documentId}`)}>Open PDF</a>
              : r.state === "ready" || r.state === "draft" ? <>
                  {!team && <ButtonLink size="sm" variant="primary" to={`/releases/${r._id}/sign`}>{r.state === "draft" ? "Finish and sign" : "Hand over"}</ButtonLink>}
                  {r.state === "draft" && <button type="button" className="sp-link" onClick={() => void remove({ releaseId: r._id }).catch((e) => show(errLine(e)))}>Remove</button>}
                </>
              : r.documentId ? <a className="sp-link" {...linkProps(`/sign/d/${r.documentId}`)}>Open</a> : null}
          </div>
        ))}
        {d.missing.length > 0 && (
          <div className="sp-missing">
            <span className="dot" aria-hidden />
            <span className="t"><b>{d.missing.length === 1 ? "1 shot needs a release" : `${d.missing.length} shots need a release`}</b><span className="secondary">{d.missing.map((m) => `#${m.number} ${m.text}`).join(" · ")}</span></span>
            <Button size="sm" onClick={() => setMaking({ shotIds: d.missing.map((m) => m._id) })}>Start one</Button>
          </div>
        )}
      </Card>
      {making && <NewRelease shootId={shootId} data={d} shotIds={making.shotIds} onClose={() => setMaking(null)} show={show} />}
      {marking && (
        <Modal onClose={() => setMarking(false)} label="Which shots need a release" width={560}>
          <div className="crm-dialog">
            <DialogHeader eyebrow="Releases" title="Which shots need a release?" body="Marked shots show “Release needed” until a signed release covers them." onClose={() => setMarking(false)} />
            <div className="sp-marks">
              {d.shots.map((s) => (
                <div key={s._id} className="sp-mark">
                  <span className="t">#{s.number} {s.text}</span>
                  {s.released ? <span className="ok">Release signed</span> : <>
                    <button type="button" className={`pill${s.releaseNeeded === true ? " on" : ""}`} onClick={() => void mark({ shotId: s._id, needed: s.releaseNeeded === true ? null : true })}>Needs one</button>
                    <button type="button" className={`pill${s.releaseNeeded === false ? " on" : ""}`} onClick={() => void mark({ shotId: s._id, needed: s.releaseNeeded === false ? null : false })}>Doesn't</button>
                  </>}
                </div>
              ))}
            </div>
            <div className="dfoot"><Button variant="primary" onClick={() => setMarking(false)}>Done</Button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** New release: template (Talent, Location, Minor), then who signs and what it covers; the PDF is made here. */
function NewRelease({ shootId, data, shotIds, onClose, show }: { shootId: string; data: RelData; shotIds: string[]; onClose: () => void; show: (t: string) => void }) {
  const ensure = useMutation(api.releases.templates);
  const create = useMutation(api.releases.create);
  const [templates, setTemplates] = useState(data.templates);
  const [pick, setPick] = useState<(typeof data.templates)[number] | null>(null);
  const [f, setF] = useState({ name: "", email: "", phone: "", minor: "" });
  const [shots, setShots] = useState<string[]>(shotIds);
  const [busy, setBusy] = useState(false);
  const make = useMakeRelease();
  const { team } = usePerms();
  useEffect(() => { if (!templates.length) void ensure({}).then(setTemplates, (e) => show(errLine(e))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    if (!pick) return;
    setBusy(true);
    try {
      const r = await create({ shootId, templateId: pick._id, name: f.name, email: f.email, phone: f.phone || undefined, minorName: pick.kind === "minor" ? f.minor : undefined, shotIds: shots as Id<"shots">[] });
      // 541ac10 review H1: the team fill it in; the owner makes it and hands it over.
      if (team) { show(`Saved. ${f.name} signs when the owner hands it over.`); onClose(); return; }
      await make(r.releaseId, r.buildId);
      navigate(`/releases/${r.releaseId}/sign`);
    } catch (e) { show(errLine(e)); setBusy(false); }
  };
  if (!pick) return (
    <Modal onClose={onClose} label="New release" width={520}>
      <div className="crm-dialog hm-pick">
        <DialogHeader eyebrow="New release" title="Which release?" body="A copy of the signed release goes here." onClose={onClose} />
        <div className="hm-list">
          {templates.length === 0 ? <SkeletonRows n={3} /> : templates.map((t) => (
            <button key={t._id} type="button" className="hm-row" onClick={() => setPick(t)}>
              <Icon name={t.kind === "location" ? "map-pin" : t.kind === "minor" ? "users" : "user"} size={18} />
              <span className="t"><b>{t.name}</b><span className="secondary">{t.description.replace(/^Release · /, "")}</span></span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
  const minor = pick.kind === "minor";
  return (
    <Modal onClose={onClose} label={pick.name} width={560}>
      <form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <DialogHeader eyebrow="New release" title={`${pick.name}.`} body={minor ? "A parent or guardian signs for someone under 18." : pick.kind === "location" ? "Whoever can say yes for the place signs." : "Whoever is on camera signs."} onClose={onClose} />
        {minor && <TextField label="Minor's name" value={f.minor} onChange={(e) => setF({ ...f, minor: e.target.value })} autoFocus />}
        <TextField label={minor ? "Parent or guardian" : pick.kind === "location" ? "Who signs for the place" : "Name"} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus={!minor} />
        <TextField label="Email (their signed copy goes here)" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <TextField label="Phone (optional)" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        {data.shots.length > 0 && (
          <div className="sp-chips" role="group" aria-label="Shots it covers">
            <span className="flabel">Shots it covers (none: the whole shoot)</span>
            {data.shots.map((s) => {
              const on = shots.includes(s._id);
              return <button key={s._id} type="button" className={`pill${on ? " on" : ""}`} onClick={() => setShots(on ? shots.filter((x) => x !== s._id) : [...shots, s._id])}>#{s.number}</button>;
            })}
          </div>
        )}
        <div className="dfoot"><button type="button" className="btn ghost" onClick={() => setPick(null)}>Back</button><Button variant="primary" type="submit" loading={busy} disabled={!f.name.trim() || !f.email.trim() || (minor && !f.minor.trim())}>{team ? "Save for the owner" : "Make and sign"}</Button></div>
      </form>
    </Modal>
  );
}

/** Renders the release's PDF here (as the builder does), uploads it, and has the server make and approve its document. */
function useMakeRelease() {
  const convex = useConvex();
  const uploadUrl = useMutation(api.builder.uploadUrl);
  const prepare = useAction(api.releases.prepare);
  return async (releaseId: Id<"releases">, buildId: Id<"wsBuilds">) => {
    const b = await convex.query(api.builder.getBuild, { buildId });
    if (!b) throw new Error("The release's draft isn't here.");
    const fonts = await convex.query(api.builder.listFonts, {});
    const st = b.style as { logo?: { fileId: string } | null; cover?: { fileId: string } | null; backdropImage?: { fileId: string } | null };
    const ids = [st.logo?.fileId, st.cover?.fileId, st.backdropImage?.fileId].filter(Boolean) as Id<"_storage">[];
    const files = ids.length ? await convex.query(api.builder.fileUrls, { ids }) : {};
    const { renderPdf } = await import("../docs/builder/pdf");
    const blob = await renderPdf({ title: b.title, page: b.blocks, fields: b.fields, signers: b.signers ?? [], style: b.style } as never, { fonts: (fonts ?? []) as never, files: files as Record<string, string | null> });
    const storageId = await uploadToStorage(await uploadUrl({}), new File([blob], `${b.title}.pdf`, { type: "application/pdf" }));
    await prepare({ releaseId, storageId });
  };
}

// ---------- Hand over · sign · hand back (full screen, nothing of the owner's reachable) ----------


export function ReleaseSigning({ releaseId }: { releaseId: string }) {
  const r = useQuery(api.releases.get, { releaseId });
  const me = useQuery(api.users.me);
  const locked = !!me?.locked;
  const setup = useQuery(api.handBack.mine, me && !locked && me.allowed ? {} : "skip"); // review L8: the owner's own
  const handOver = useMutation(api.releases.handOver);
  const make = useMakeRelease();
  // Review L9: the signer's place survives a reload while the phone is handed over (this tab only).
  const tokenKey = `wp-release-token:${releaseId}`;
  const [token, setTokenRaw] = useState<string | null>(() => { try { return sessionStorage.getItem(tokenKey); } catch { return null; } });
  const setToken = (x: string | null) => { setTokenRaw(x); try { if (x) sessionStorage.setItem(tokenKey, x); else sessionStorage.removeItem(tokenKey); } catch { /* private mode */ } };
  const [handing, setHanding] = useState(false); // Q2: the owner's unlock, over the signing
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  // 541ac10 review M4: while the signer holds the phone, Back stays on the signing (it can't reach the owner's pages).
  useEffect(() => {
    if (!locked) return;
    const hold = () => window.history.pushState(null, "", window.location.href);
    hold();
    window.addEventListener("popstate", hold);
    return () => window.removeEventListener("popstate", hold);
  }, [locked]);
  const shootUrl = r?.shootId ? `/production/shoots/${r.shootId}?tab=releases` : "/production/shoots";
  if (r === undefined || me === undefined) return <div className="rl-full"><p className="rl-wait">Opening…</p></div>;
  if (r === null) return <div className="rl-full"><div className="rl-card glass"><h1 className="headline">This release isn't here any more.</h1>{!locked && <Button onClick={() => navigate("/production/shoots")}>Back to shoots</Button>}{locked && <HandBack name={me?.name ?? null} onDone={() => navigate("/production/shoots")} />}</div></div>;
  // Hand back (1042-23898; Q2, Nov 17): the owner unlocks with Face ID, the phone's passcode or their PIN.
  if (locked && (handing || r.state === "signed" || !token)) return (
    <div className="rl-full"><div className="rl-card glass">
      {r.state === "signed" ? <><span className="rl-ok"><Icon name="check-circle" size={28} /></span><h1 className="headline">Signed.</h1><p className="secondary">A copy is on its way to {r.email}. Hand the phone back.</p></>
        : <><span className="wp-eyebrow">Signing in person</span><h1 className="headline">{token ? "Hand back" : `Handed to ${r.name}`}</h1><p className="secondary">{token ? `${r.name} hasn't finished signing. Unlock to take the phone back.` : "This phone is with the signer. Unlock to take it back."}</p></>}
      <HandBack name={me?.name ?? null} onDone={() => { setToken(null); navigate(shootUrl); }} />
      {handing && token && <button type="button" className="btn ghost" onClick={() => setHanding(false)}>Back to signing</button>}
    </div></div>
  );
  if (token && locked) return <div className="rl-signer"><div className="rl-bar"><span className="wp-eyebrow">Signing in person</span><button type="button" className="rl-handback" onClick={() => setHanding(true)}>Hand back</button></div><SignerApp token={token} /></div>;
  if (r.state === "signed") return <div className="rl-full"><div className="rl-card glass"><span className="rl-ok"><Icon name="check-circle" size={28} /></span><h1 className="headline">Signed.</h1><Button variant="primary" onClick={() => navigate(shootUrl)}>Back to the shoot</Button></div></div>;
  const start = async () => {
    setBusy(true); setErr(null);
    try {
      if (r.state === "draft") await make(r._id, r.buildId);
      const out = await handOver({ releaseId: r._id, device: deviceName(), checked: true });
      setSession(out.token, out.session);
      setToken(out.token);
    } catch (e) { setErr(errLine(e)); }
    finally { setBusy(false); }
  };
  // Hand over (1042-23136).
  return (
    <div className="rl-full"><div className="rl-card glass">
      <span className="wp-eyebrow">{r.kind === "minor" ? "Minor release" : r.kind === "location" ? "Location release" : "Talent release"}</span>
      <h1 className="headline">Hand the phone to {r.name}.</h1>
      <p className="secondary">They read the release and sign it here. A signed copy goes to {r.email}. The phone stays locked until you unlock it.</p>
      {err && <p className="rl-err" role="alert">{err}</p>}
      {setup && <UnlockSetup pin={setup.pin} passkeys={setup.passkeys.length} />}
      {/* Review H2: the owner's own check, recorded on the certificate in place of the email code. */}
      <label className="rl-check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I've checked in person that this is {r.name}</label>
      <Button variant="primary" loading={busy} disabled={r.state === "signing" || !checked || !setup?.pin} onClick={() => void start()}>I'm {r.name} · Start</Button>
      {r.state === "signing" && <p className="secondary">It's already out for signing. Cancel it from Contracts to start again.</p>}
      <button type="button" className="btn ghost" onClick={() => navigate(shootUrl)}>Cancel</button>
    </div></div>
  );
}

/** Q2: the owner takes the phone back: Face ID or the passcode (a passkey), or the PIN (5 tries, then signed out). */
function HandBack({ name, onDone }: { name: string | null; onDone: () => void }) {
  const { signOut } = useAuthActions();
  const unlockPin = useMutation(api.handBack.unlockWithPin);
  const options = useAction(api.passkeys.unlockOptions);
  const unlock = useAction(api.passkeys.unlock);
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const withKey = async () => {
    setBusy(true); setMsg(null);
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const opts = await options({ origin: location.origin });
      const res = await startAuthentication(opts);
      const out = await unlock({ origin: location.origin, response: res });
      if (out.ok) onDone(); else setMsg("That didn't unlock it. Use your PIN.");
    } catch (e) { setMsg((e as Error).name === "NotAllowedError" ? "Cancelled. Use your PIN." : errLine(e)); }
    finally { setBusy(false); }
  };
  const signOutHere = useMutation(api.handBack.signOutHere);
  // Signed out (too many PINs, or by choice): the browser signs out too, and the signer's place is forgotten.
  const leave = async () => {
    try { for (const k of Object.keys(sessionStorage)) if (k.startsWith("wp-release-token:")) sessionStorage.removeItem(k); } catch { /* private mode */ }
    await signOut(); location.assign("/");
  };
  const withPin = async () => {
    setBusy(true); setMsg(null);
    try {
      const out = await unlockPin({ pin });
      if (out.ok) { onDone(); return; }
      setPin("");
      if ("signedOut" in out) { setMsg("Too many wrong PINs: this phone is signed out."); await leave(); return; }
      if ("reset" in out) { setMsg("Your PIN can't be checked on this phone any more. Use Face ID, or sign this phone out and sign in again."); return; }
      setMsg(`That isn't the PIN. ${out.left} ${out.left === 1 ? "try" : "tries"} left.`);
    } catch (e) { setMsg(errLine(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="rl-unlock">
      <span className="wp-small secondary">{name ? `${name.split(" ")[0]}, unlock` : "Unlock"} to take the phone back.</span>
      {canPasskey() && <Button variant="primary" loading={busy} onClick={() => void withKey()}>Face ID or passcode</Button>}
      <form className="rl-pinrow" onSubmit={(e) => { e.preventDefault(); if (pin.length === 4) void withPin(); }}>
        <input className="input" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="PIN" aria-label="Your PIN" />
        <Button type="submit" disabled={pin.length !== 4 || busy}>Unlock</Button>
      </form>
      {msg && <p className="rl-err" role="alert">{msg}</p>}
      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setBusy(true); void signOutHere({}).then(leave, (e) => { setMsg(errLine(e)); setBusy(false); }); }}>Sign this phone out instead</button>
    </div>
  );
}
