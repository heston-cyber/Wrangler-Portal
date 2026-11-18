// 5k (D192; frames 5k / Locations Archive 1053-26785 · Map 1053-27368 · By shoot 1053-27944, a place 1054-27461 and
// phone 1057-28697, Use for a shoot 1054-27927, Add a place 1057-29019, a shoot's Locations tab 1055-28348).
// Creative planning › Locations. The map is a plot of the places' points (no map service); "Open in Maps" hands the
// address to the phone's own maps. Sun times are worked out here (lib/sun.ts).
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, Card, DialogHeader, EmptyState, PageHeader, PillTabs, SkeletonRows, TextArea, TextField } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal, useConfirm, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errLine } from "../../ui/hold";
import { sunClock, sunTimes } from "../../lib/sun";
import { uploadToStorage } from "../docs/pages/common";

type Places = NonNullable<ReturnType<typeof useQuery<typeof api.places.list>>>;
type View = "archive" | "map" | "shoot";
const dayText = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "numeric", day: "numeric" });
const mapsUrl = (q: string) => `https://maps.apple.com/?q=${encodeURIComponent(q)}`;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

const Crumbs = ({ here }: { here?: string }) => (
  <TopBar><a {...linkProps("/production")}>Production</a><Sep /><a {...linkProps("/creative")}>Creative planning</a><Sep />{here ? <><a {...linkProps("/creative/locations")}>Locations</a><Sep /><span className="here">{here}</span></> : <span className="here">Locations</span>}</TopBar>
);

// ---------- Add / edit a place ----------

type Draft = { name: string; address: string; lat?: number; lng?: number; parking: string; power: string; permits: string; contacts: string; notes: string; tags: string };
const blank: Draft = { name: "", address: "", parking: "", power: "", permits: "", contacts: "", notes: "", tags: "" };

export function PlaceDialog({ place, onClose, show, onMade }: { place?: { _id: string } & Partial<Omit<Draft, "tags">> & { tags?: string[] }; onClose: () => void; show: (t: string) => void; onMade?: (id: string) => void }) {
  const create = useMutation(api.places.create);
  const update = useMutation(api.places.update);
  const uploadUrl = useMutation(api.places.uploadUrl);
  const addPhoto = useMutation(api.places.addPhoto);
  const [d, setD] = useState<Draft>(() => place ? { ...blank, ...Object.fromEntries(Object.entries(place).filter(([, v]) => v !== null)), tags: (place.tags ?? []).join(", ") } as Draft : blank);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value });
  const here = () => {
    if (!navigator.geolocation) { show("This device can't share where it is."); return; }
    navigator.geolocation.getCurrentPosition((p) => { setD((x) => ({ ...x, lat: p.coords.latitude, lng: p.coords.longitude })); show("Got where you are."); }, () => show("Couldn't get where you are."), { enableHighAccuracy: true, timeout: 15000 });
  };
  const go = async () => {
    setBusy(true);
    const body = { name: d.name, address: d.address, ...(d.lat !== undefined && d.lng !== undefined ? { lat: d.lat, lng: d.lng } : {}), parking: d.parking, power: d.power, permits: d.permits, contacts: d.contacts, notes: d.notes, tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean) };
    try {
      const id = place ? (await update({ placeId: place._id, ...body }), place._id) : await create(body);
      for (const f of files) await addPhoto({ placeId: id, storageId: await uploadToStorage(await uploadUrl({}), f), name: f.name });
      if (onMade) onMade(id); else onClose();
    } catch (e) { show(errLine(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label={place ? "Edit place" : "Add a place"} width={600}>
      <form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <DialogHeader eyebrow="Locations" title={place ? "Edit place." : "Add a place."} onClose={onClose} />
        <TextField label="Name" value={d.name} onChange={set("name")} autoFocus placeholder="DePaul Hospital, east lobby" />
        <TextField label="Address" value={d.address} onChange={set("address")} placeholder="12303 DePaul Dr, Bridgeton, MO" />
        <div className="pl-here"><Button size="sm" icon="map-pin" type="button" onClick={here}>Use where I am</Button>{d.lat !== undefined && <span className="secondary">{d.lat.toFixed(4)}, {d.lng!.toFixed(4)}</span>}</div>
        {!place && <label className="field"><span className="flabel">Photos</span><input className="input" type="file" accept="image/*" multiple capture="environment" onChange={(e) => setFiles([...(e.target.files ?? [])])} /></label>}
        {place && <>
          <TextArea label="Parking and load-in" value={d.parking} onChange={set("parking")} rows={2} />
          <TextArea label="Power" value={d.power} onChange={set("power")} rows={2} />
          <TextArea label="Permits" value={d.permits} onChange={set("permits")} rows={2} />
          <TextArea label="Contacts" value={d.contacts} onChange={set("contacts")} rows={2} />
          <TextArea label="Notes" value={d.notes} onChange={set("notes")} rows={3} />
        </>}
        <TextField label="Tags (commas between)" value={d.tags} onChange={set("tags")} placeholder="interior, hospital, quiet" />
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button variant="primary" type="submit" loading={busy} disabled={!d.name.trim()}>{place ? "Save" : "Add place"}</Button></div>
      </form>
    </Modal>
  );
}

// ---------- Locations ----------

function PlaceCard({ p }: { p: Places[number] }) {
  return (
    <a className="pl-card glass" {...linkProps(`/creative/locations/${p._id}`)}>
      <span className="pl-photo">{p.photo ? <img src={p.photo} alt="" loading="lazy" /> : <Icon name="map-pin" size={28} />}</span>
      <span className="pl-body"><b>{p.name}</b><span className="secondary">{p.address || "No address yet"}</span>
        <span className="pl-tags">{p.tags.map((t) => <span key={t} className="pk-chip">{t}</span>)}{p.shoots.length > 0 && <span className="pk-chip on">{p.shoots.length} {p.shoots.length === 1 ? "shoot" : "shoots"}</span>}</span></span>
    </a>
  );
}

function MapPlot({ places, onPick }: { places: Places; onPick: (id: string) => void }) {
  const pts = places.filter((p) => p.lat !== null && p.lng !== null);
  if (!pts.length) return <p className="secondary">No place has a point yet: add an address, or use where you are.</p>;
  const lats = pts.map((p) => p.lat!), lngs = pts.map((p) => p.lng!);
  const [a, b, c, d] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const pad = 0.12, h = Math.max(b - a, 0.01), w = Math.max(d - c, 0.01);
  return (
    <div className="pl-map" role="img" aria-label={`${pts.length} places`}>
      {pts.map((p) => (
        <button key={p._id} type="button" className="pl-pin" title={p.name} style={{ left: `${(pad + (1 - 2 * pad) * ((p.lng! - c) / w)) * 100}%`, top: `${(pad + (1 - 2 * pad) * (1 - (p.lat! - a) / h)) * 100}%` }} onClick={() => onPick(p._id)}>
          <Icon name="map-pin" size={22} /><span>{p.name}</span>
        </button>
      ))}
    </div>
  );
}

export default function LocationsPage() {
  const places = useQuery(api.places.list, {});
  const [view, setView] = useState<View>("archive");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [adding, setAdding] = useState(() => new URLSearchParams(location.search).has("new")); // Nov 17: Production › Create › Location
  const [toast, show] = useToast();
  const tags = useMemo(() => [...new Set((places ?? []).flatMap((p) => p.tags))].sort(), [places]);
  const shown = (places ?? []).filter((p) => (!tag || p.tags.includes(tag)) && (!q.trim() || `${p.name} ${p.address} ${p.tags.join(" ")}`.toLowerCase().includes(q.trim().toLowerCase())));
  const byShoot = useMemo(() => {
    const m = new Map<string, { label: string; date: string; places: Places }>();
    const none: Places = [];
    for (const p of shown) { if (!p.shoots.length) none.push(p); for (const s of p.shoots) { const g = m.get(s.shootId) ?? { label: s.label, date: s.date, places: [] }; g.places.push(p); m.set(s.shootId, g); } }
    return { groups: [...m.entries()].sort((x, y) => x[1].date.localeCompare(y[1].date)), none };
  }, [shown]);
  return (
    <>
      <Crumbs />
      <div className="wp-page prod">
        <PageHeader eyebrow="Creative planning" title="Locations." sub="Places you have shot or might: photos, access, power, permits and the light." actions={<Button variant="primary" onClick={() => setAdding(true)}>Add a place</Button>} />
        <div className="hm-toolbar">
          <PillTabs label="View" value={view} onChange={setView} items={[{ key: "archive", label: "Archive" }, { key: "map", label: "Map" }, { key: "shoot", label: "By shoot" }]} />
          <input className="input pl-search" placeholder="Search places" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search places" />
        </div>
        {tags.length > 0 && <div className="pl-tagbar">{tags.map((t) => <button key={t} type="button" className={`pill${tag === t ? " on" : ""}`} onClick={() => setTag(tag === t ? null : t)}>{t}</button>)}</div>}
        {places === undefined ? <Card label="Loading"><SkeletonRows n={4} /></Card>
          : places.length === 0 ? <EmptyState icon="map-pin" title="No places yet" body="Save places you scout: photos, how to get in, power, permits and the light." actions={<Button variant="primary" onClick={() => setAdding(true)}>Add a place</Button>} />
          : view === "archive" ? <div className="pl-grid">{shown.map((p) => <PlaceCard key={p._id} p={p} />)}</div>
          : view === "map" ? <div className="pl-mapwrap"><MapPlot places={shown} onPick={(id) => navigate(`/creative/locations/${id}`)} /><div className="pl-list">{shown.map((p) => <PlaceCard key={p._id} p={p} />)}</div></div>
          : <>
              {byShoot.groups.map(([id, g]) => (
                <section key={id} className="pl-group"><h2 className="wp-label"><a {...linkProps(`/production/shoots/${id}?tab=locations`)}>{g.label} · {dayText(g.date)}</a></h2><div className="pl-grid">{g.places.map((p) => <PlaceCard key={p._id} p={p} />)}</div></section>
              ))}
              {byShoot.none.length > 0 && <section className="pl-group"><h2 className="wp-label">Not on a shoot yet</h2><div className="pl-grid">{byShoot.none.map((p) => <PlaceCard key={p._id} p={p} />)}</div></section>}
            </>}
      </div>
      {adding && <PlaceDialog onClose={() => setAdding(false)} show={show} onMade={(id) => navigate(`/creative/locations/${id}`)} />}
      {toast}
    </>
  );
}

// ---------- A place ----------

function UseForShoot({ placeId, name, onClose, show }: { placeId: string; name: string; onClose: () => void; show: (t: string) => void }) {
  const shoots = useQuery(api.production.shoots, {});
  const use = useMutation(api.places.useForShoot);
  const rows = (shoots?.upcoming ?? []) as Array<{ _id: string; label: string; date: string; location: string }>;
  return (
    <Modal onClose={onClose} label="Use for a shoot" width={520}>
      <div className="crm-dialog hm-pick">
        <DialogHeader eyebrow={name} title="Use for a shoot." body={`${name} becomes the shoot's place, and fills its call sheet's Location block.`} onClose={onClose} />
        <div className="hm-list">
          {shoots === undefined ? <SkeletonRows n={3} /> : rows.length === 0 ? <p className="secondary hm-none">No upcoming shoots.</p> : rows.map((s) => (
            <button key={s._id} type="button" className="hm-row" onClick={() => void use({ placeId, shootId: s._id as Id<"shoots">, asPlace: true }).then(() => { show("Set as the shoot's place."); onClose(); }, (e) => show(errLine(e)))}>
              <Icon name="clapper" size={18} /><span className="t"><b>{s.label} · {dayText(s.date)}</b><span className="secondary">Now: {s.location}</span></span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function PlacePage({ placeId }: { placeId: string }) {
  const p = useQuery(api.places.get, { placeId });
  const remove = useMutation(api.places.remove);
  const removePhoto = useMutation(api.places.removePhoto);
  const cover = useMutation(api.places.coverPhoto);
  const uploadUrl = useMutation(api.places.uploadUrl);
  const addPhoto = useMutation(api.places.addPhoto);
  const [toast, show] = useToast();
  const [ask, asking] = useConfirm();
  const [editing, setEditing] = useState(false);
  const [using, setUsing] = useState(false);
  const [date, setDate] = useState(today());
  if (p === undefined) return <><Crumbs here="…" /><div className="wp-page prod"><Card label="Loading"><SkeletonRows n={5} /></Card></div></>;
  if (p === null) return <><Crumbs /><div className="wp-page prod"><EmptyState icon="map-pin" title="This place isn't here any more" /></div></>;
  const sun = p.lat !== null && p.lng !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) ? sunTimes(p.lat, p.lng, date) : null;
  const upload = async (fs: FileList | null) => { for (const f of [...(fs ?? [])]) { try { await addPhoto({ placeId: p._id, storageId: await uploadToStorage(await uploadUrl({}), f), name: f.name }); } catch (e) { show(errLine(e)); } } };
  const info: Array<[string, string | null]> = [["Parking and load-in", p.parking], ["Power", p.power], ["Permits", p.permits], ["Contacts", p.contacts], ["Notes", p.notes]];
  return (
    <>
      <Crumbs here={p.name} />
      <div className="wp-page prod">
        <PageHeader eyebrow="Location" title={`${p.name}.`} sub={p.address || "No address yet"} actions={<>
          <Button onClick={() => setEditing(true)}>Edit</Button>
          <Button variant="primary" onClick={() => setUsing(true)}>Use for a shoot</Button>
        </>} />
        <div className="sp-grid">
          <div className="sp-col">
            <Card className="sp-card" label="Photos">
              <div className="pl-photos">
                {p.photos.map((ph, i) => (
                  <figure key={ph.fileId} className="pl-ph">
                    {ph.url && <img src={ph.url} alt={ph.name} loading="lazy" />}
                    <figcaption>{i === 0 ? <span className="pk-chip on">Cover</span> : <button type="button" className="sp-link" onClick={() => void cover({ placeId: p._id, fileId: ph.fileId })}>Make cover</button>}
                      <button type="button" className="sp-link" onClick={() => void ask({ title: "Remove this photo?" }).then((ok) => { if (ok) void removePhoto({ placeId: p._id, fileId: ph.fileId }); })}>Remove</button></figcaption>
                  </figure>
                ))}
                <label className="pl-addph"><Icon name="plus" size={20} /><span>Add photos</span><input type="file" accept="image/*" multiple onChange={(e) => void upload(e.target.files)} /></label>
              </div>
            </Card>
            <Card className="sp-card" label="Details">
              {info.map(([k, v]) => v ? <div key={k} className="sp-row block"><span className="k">{k}</span><span className="v">{v}</span></div> : null)}
              {info.every(([, v]) => !v) && <p className="secondary">No access notes yet. Edit to add parking, power, permits and contacts.</p>}
              {p.tags.length > 0 && <div className="pl-tags">{p.tags.map((t) => <span key={t} className="pk-chip">{t}</span>)}</div>}
            </Card>
          </div>
          <div className="sp-col">
            <Card className="sp-card" label="The light">
              <span className="wp-label">The light</span>
              <label className="field"><span className="flabel">Date</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
              {!sun ? <p className="secondary">Sun times show once the place has a point (its address, or Use where I am).</p> : <>
                <div className="sp-row"><span className="k">Sunrise</span><span className="v">{sunClock(sun.sunrise)}</span></div>
                <div className="sp-row"><span className="k">Golden hour</span><span className="v">{sun.morningGolden ? `${sunClock(sun.morningGolden[0])}–${sunClock(sun.morningGolden[1])}` : "—"}</span></div>
                <div className="sp-row"><span className="k">Golden hour</span><span className="v">{sun.eveningGolden ? `${sunClock(sun.eveningGolden[0])}–${sunClock(sun.eveningGolden[1])}` : "—"}</span></div>
                <div className="sp-row"><span className="k">Sunset</span><span className="v">{sunClock(sun.sunset)}</span></div>
              </>}
              {(p.address || p.lat !== null) && <a className="sp-link" href={mapsUrl(p.address || `${p.lat},${p.lng}`)} target="_blank" rel="noreferrer">Open in Maps</a>}
            </Card>
            <Card className="sp-card" label="Shoots here">
              <span className="wp-label">Shoots here</span>
              {p.shoots.length === 0 ? <p className="secondary">Not used for a shoot yet.</p> : p.shoots.map((s) => <a key={s.shootId} className="sp-gl" {...linkProps(`/production/shoots/${s.shootId}`)}><Icon name="clapper" size={16} /><b>{s.label}</b><span className="v">{dayText(s.date)}</span><Icon name="chevron-right" size={14} /></a>)}
            </Card>
            <button type="button" className="sp-link danger" onClick={() => void ask({ title: `Delete ${p.name}?`, body: "Its photos go too. Shoots keep their address." }).then((ok) => { if (ok) void remove({ placeId: p._id }).then(() => navigate("/creative/locations"), (e) => show(errLine(e))); })}>Delete place</button>
          </div>
        </div>
      </div>
      {editing && <PlaceDialog place={{ ...p, lat: p.lat ?? undefined, lng: p.lng ?? undefined, parking: p.parking ?? "", power: p.power ?? "", permits: p.permits ?? "", contacts: p.contacts ?? "", notes: p.notes ?? "" }} onClose={() => setEditing(false)} show={show} />}
      {using && <UseForShoot placeId={p._id} name={p.name} onClose={() => setUsing(false)} show={show} />}
      {asking}{toast}
    </>
  );
}

// ---------- a shoot's Locations tab ----------

export function LocationsTab({ shootId, show }: { shootId: string; show: (t: string) => void }) {
  const d = useQuery(api.places.forShoot, { shootId });
  const all = useQuery(api.places.list, {});
  const use = useMutation(api.places.useForShoot);
  const unlink = useMutation(api.places.unlink);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  if (d === undefined) return <Card label="Loading"><SkeletonRows n={3} /></Card>;
  if (d === null) return null;
  return (
    <>
      <Card className="sp-card" label="Locations">
        <div className="sp-relhead"><Icon name="map-pin" size={16} /><span className="wp-label">Places for this shoot</span><span className="sp" />
          <Button size="sm" onClick={() => setPicking(true)}>Add from Locations</Button><Button size="sm" onClick={() => setAdding(true)}>New place</Button></div>
        {d.places.length === 0 ? <p className="secondary">The shoot's place is {d.location}. Link places from Locations to keep their photos, access notes and the light here.</p>
          : d.places.map((p) => {
            const sun = p.lat !== null && p.lng !== null ? sunTimes(p.lat, p.lng, d.date) : null;
            return (
              <div key={p._id} className="sp-relrow">
                <span className="t"><a {...linkProps(`/creative/locations/${p._id}`)}><b>{p.name}</b></a>
                  <span className="secondary">{p.main ? "The shoot's place · " : ""}{p.address}{sun?.sunset ? ` · sunset ${sunClock(sun.sunset)}` : ""}</span></span>
                {!p.main && <button type="button" className="sp-link" onClick={() => void use({ placeId: p._id, shootId: shootId as Id<"shoots">, asPlace: true }).then(() => show("Set as the shoot's place."), (e) => show(errLine(e)))}>Make it the place</button>}
                <button type="button" className="sp-link" onClick={() => void unlink({ placeId: p._id, shootId: shootId as Id<"shoots"> })}>Remove</button>
              </div>
            );
          })}
      </Card>
      {picking && (
        <Modal onClose={() => setPicking(false)} label="Add from Locations" width={520}>
          <div className="crm-dialog hm-pick">
            <DialogHeader eyebrow="Locations" title="Add a place to this shoot." onClose={() => setPicking(false)} />
            <div className="hm-list">
              {(all ?? []).filter((p) => !d.places.some((x) => x._id === p._id)).map((p) => (
                <button key={p._id} type="button" className="hm-row" onClick={() => void use({ placeId: p._id, shootId: shootId as Id<"shoots">, asPlace: false }).then(() => setPicking(false), (e) => show(errLine(e)))}>
                  <Icon name="map-pin" size={18} /><span className="t"><b>{p.name}</b><span className="secondary">{p.address}</span></span>
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}
      {adding && <PlaceDialog onClose={() => setAdding(false)} show={show} onMade={(id) => void use({ placeId: id, shootId: shootId as Id<"shoots">, asPlace: false }).then(() => setAdding(false))} />}
    </>
  );
}
