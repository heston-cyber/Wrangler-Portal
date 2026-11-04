// Phase 5b step 3 (Nov 3): the call sheet's shared pieces, used by Production › Call sheets and by the Docs builder
// when it edits a call sheet: who gets it (the People step 766:4212 and the builder's Details), Send call sheet
// (766:6190), Send an update (no frame: Send's layout), Add a guest (766:6270), and the sheet as readers see it.
import { Fragment, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Modal } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { Button, Checkbox, DialogHeader, IconButton, TextArea, TextField } from "../../ui/wp";
import { errText } from "../docs/pages/common";
import { fill, type PNode, type Page } from "../../../convex/lib/wsBuilder";
import { clockOf, locationOf, rowsOf, sheetDay, type ContactRow, type CrewRow, type ScheduleRow } from "../../../convex/lib/callSheet";

export type CallSheetInfo = NonNullable<FunctionReturnType<typeof api.callSheets.get>>;
export type Person = CallSheetInfo["people"][number];
export const first = (n: string) => n.trim().split(/\s+/)[0] || n;
const names = (ps: Person[]) => ps.map((p) => p.name).join(", ");
/** Q88 (Nov 4): plain words for how a guest gets in (no "light login"). */
const guestHint = (gs: Person[]) => `${names(gs)} · ${gs.length === 1 ? "signs" : "sign"} in with their email and a 6-digit code`;
/** Who it actually goes to now: ticked, and able to read it (crew and client people in the portal, guests by their link). */
export const reachable = (ps: Person[]) => ps.filter((p) => p.on && p.access);
export const groupsOf = (cs: CallSheetInfo) => ({
  crew: cs.people.filter((p) => p.kind === "crew"), client: cs.people.filter((p) => p.kind === "client"), guests: cs.people.filter((p) => p.kind === "guest"),
});
export const opened = (t: number) => {
  const d = new Date(t), now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// ---------- who gets it ----------

/** The People step (766:4212), also the builder's Details for a call sheet. */
export function PeoplePicker({ cs, show, compact }: { cs: CallSheetInfo; show: (m: string) => void; compact?: boolean }) {
  const toggle = useMutation(api.callSheets.toggle);
  const removeGuest = useMutation(api.callSheets.removeGuest);
  const [adding, setAdding] = useState(false);
  const g = groupsOf(cs);
  const set = async (p: Person, on: boolean) => { try { await toggle({ callSheetId: cs._id, id: p.id, on }); } catch (e) { show(errText(e)); } };
  const row = (p: Person) => (
    <div key={p.id} className="cs-person">
      <Checkbox checked={p.on} disabled={!p.access && p.kind !== "guest" && !p.on} onChange={(on) => void set(p, on)}
        label={<>{p.name}{p.role ? ` · ${p.role}` : ""}</>} hint={p.kind === "guest" ? `Guest · ${p.access ? p.email : p.note ?? p.email}` : p.note ?? (p.kind === "client" ? p.email : undefined)} />
      {p.kind === "guest" && <IconButton icon="close" label={`Remove ${p.name}`} bare iconSize={14} onClick={() => void removeGuest({ callSheetId: cs._id, id: p.id }).catch((e) => show(errText(e)))} />}
    </div>
  );
  return (
    <div className={`cs-people${compact ? " compact" : ""}`}>
      <span className="cs-group">Crew · booked vendors</span>
      {g.crew.length ? g.crew.map(row) : <p className="wp-small secondary">No vendors are booked on this project for {sheetDay(cs.shoot.date)}.</p>}
      <span className="cs-group">Client’s people{cs.client ? ` · ${cs.client}` : ""}</span>
      {g.client.length ? g.client.map(row) : <p className="wp-small secondary">No people on this client yet.</p>}
      <span className="cs-group">Guests · talent and others</span>
      {g.guests.map(row)}
      <button type="button" className="cs-addguest" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add a guest</button>
      {!compact && <div className="cs-info"><Icon name="info" size={18} /><span><b>Guests are one-off people for this shoot</b><br />
        They sign in with their email and a 6-digit code, and see only this call sheet. They can read it until the day after its shoot. They can be added to any number of shoots, and everyone on the sheet sees the whole sheet.</span></div>}
      {adding && <AddGuest callSheetId={cs._id} onClose={() => setAdding(false)} show={show} />}
    </div>
  );
}

/** Add a guest (766:6270). They get email 41 with their own link when the sheet is sent (step 4). */
export function AddGuest({ callSheetId, onClose, show }: { callSheetId: Id<"callSheets">; onClose: () => void; show: (m: string) => void }) {
  const add = useMutation(api.callSheets.addGuest);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<"Talent" | "Other">("Talent");
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await add({ callSheetId, name, email, role: kind === "Talent" ? "Talent" : other.trim() || "Guest" }); show(`${first(name)} is on the call sheet`); onClose(); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Add a guest" width={560}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Call sheet" title="Add a guest" body="Guests are talent or other one-off people. They see only this call sheet." onClose={onClose} />
        <div className="cs-two">
          <TextField label="Name" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Riley Quinn" />
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="riley@example.com" />
        </div>
        <div className="wp-field"><span className="wp-field-label">Role</span>
          <div className="qz-chips">{(["Talent", "Other"] as const).map((k) => <button key={k} type="button" className={`qz-chip${kind === k ? " on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{k}</button>)}</div>
          {kind === "Other" && <input className="input" value={other} placeholder="Their role, e.g. Stylist" aria-label="Their role" onChange={(e) => setOther(e.target.value)} style={{ marginTop: 8 }} />}
        </div>
        <div className="cs-info"><Icon name="info" size={18} /><span><b>They can read it until the day after its shoot</b><br />They sign in with their email and a 6-digit code. You can also add them to other shoots, and end their access by hand from the call sheet.</span></div>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot"><button type="button" className="btn outline" onClick={onClose}>Cancel</button><Button variant="primary" loading={busy} disabled={!name.trim() || !email.trim()} onClick={() => void go()}>Add guest</Button></div>
      </div>
    </Modal>
  );
}

/** Send call sheet (766:6190). Saving the editor first is the caller's job (`before`). */
export function SendSheet({ cs, onClose, show, before, onSent }: { cs: CallSheetInfo; onClose: () => void; show: (m: string) => void; before?: () => Promise<void>; onSent?: () => void }) {
  const send = useMutation(api.callSheets.send);
  const g = groupsOf(cs);
  const crew = reachable(g.crew), client = reachable(g.client), guests = reachable(g.guests);
  const [on, setOn] = useState({ crew: crew.length > 0, client: client.length > 0, guests: guests.length > 0 });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const n = (on.crew ? crew.length : 0) + (on.client ? client.length : 0) + (on.guests ? guests.length : 0);
  const go = async () => {
    setBusy(true);
    try {
      await before?.();
      const r = await send({ callSheetId: cs._id, crew: on.crew, client: on.client, guests: on.guests, message: message.trim() || undefined });
      show(`Sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}${r.skipped.length ? `. Not sent to ${r.skipped.join(", ")} (can’t open it)` : ""}`);
      onSent?.(); onClose();
    } catch (e) { show(errText(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Send call sheet" width={560}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Call sheet" title={`Send to ${n} ${n === 1 ? "person" : "people"}?`} body="Each person gets an email with a link to read the call sheet in the portal. You’ll see who has opened it." onClose={onClose} />
        <div className="cs-groups">
          {crew.length > 0 && <Checkbox checked={on.crew} onChange={(v) => setOn({ ...on, crew: v })} label={`Crew · ${crew.length}`} hint={names(crew)} />}
          {client.length > 0 && <Checkbox checked={on.client} onChange={(v) => setOn({ ...on, client: v })} label={`${cs.client ?? "Client"} · ${client.length}`} hint={names(client)} />}
          {guests.length > 0 && <Checkbox checked={on.guests} onChange={(v) => setOn({ ...on, guests: v })} label={`Guests · ${guests.length}`} hint={guestHint(guests)} />}
          {!crew.length && !client.length && !guests.length && <p className="wp-small secondary">Nobody ticked can open it yet. Tick people in Details first.</p>}
        </div>
        <TextArea label="Message (optional)" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Looking forward to it. Questions, reply to this email." />
        <div className="dfoot"><button type="button" className="btn outline" onClick={onClose}>Cancel</button><Button variant="primary" loading={busy} disabled={!n} onClick={() => void go()}>Send call sheet</Button></div>
      </div>
    </Modal>
  );
}

/** The groups a dialog sends to (Send an update 856:92031, Remind 856:92097): crew, the client's people, guests. */
function GroupTicks({ cs, crew, client, guests, on, setOn }: { cs: CallSheetInfo; crew: Person[]; client: Person[]; guests: Person[]; on: { crew: boolean; client: boolean; guests: boolean }; setOn: (v: { crew: boolean; client: boolean; guests: boolean }) => void }) {
  return (
    <div className="cs-groups">
      {crew.length > 0 && <Checkbox checked={on.crew} onChange={(v) => setOn({ ...on, crew: v })} label={`Crew · ${crew.length}`} hint={names(crew)} />}
      {client.length > 0 && <Checkbox checked={on.client} onChange={(v) => setOn({ ...on, client: v })} label={`${cs.client ?? "Client"} · ${client.length}`} hint={names(client)} />}
      {guests.length > 0 && <Checkbox checked={on.guests} onChange={(v) => setOn({ ...on, guests: v })} label={`Guests · ${guests.length}`} hint={guestHint(guests)} />}
    </div>
  );
}

/** Send an update (856:92031). Email 42 to the ticked groups it went to, 40 to anyone new; everyone reads the new copy. */
export function SendUpdate({ cs, onClose, show, before }: { cs: CallSheetInfo; onClose: () => void; show: (m: string) => void; before?: () => Promise<void> }) {
  const update = useMutation(api.callSheets.sendUpdate);
  const g = groupsOf(cs);
  const crew = reachable(g.crew), client = reachable(g.client), guests = reachable(g.guests);
  const [on, setOn] = useState({ crew: true, client: true, guests: true });
  const n = (on.crew ? crew.length : 0) + (on.client ? client.length : 0) + (on.guests ? guests.length : 0);
  const [changed, setChanged] = useState(cs.changes[0] ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await before?.(); const r = await update({ callSheetId: cs._id, changed, message: message.trim() || undefined, crew: on.crew, client: on.client, guests: on.guests }); show(`Update sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}`); onClose(); }
    catch (e) { show(errText(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Send an update" width={560}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Call sheet" title={`Send an update to ${n} ${n === 1 ? "person" : "people"}?`} body="Each person gets an email saying the call sheet changed, with a link to read it. They always see the sheet as you last sent it. You’ll see who has opened it." onClose={onClose} />
        <GroupTicks cs={cs} crew={crew} client={client} guests={guests} on={on} setOn={setOn} />
        {cs.changes.length > 1 && <p className="wp-small secondary">Changed since it was sent: {cs.changes.join(" · ")}.</p>}
        <TextField label="What changed (shown at the top of the sheet)" value={changed} onChange={(e) => setChanged(e.target.value)} placeholder="The talent call moved to 9:00 AM." maxLength={120} />
        <TextArea label="Message (optional)" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
        <div className="dfoot"><button type="button" className="btn outline" onClick={onClose}>Cancel</button><Button variant="primary" loading={busy} disabled={!changed.trim() || !n} onClick={() => void go()}>Send update</Button></div>
      </div>
    </Modal>
  );
}

/** Remind (856:92097): the people it went to who haven't opened it, by group; the same email and link again. */
export function RemindSheet({ cs, onClose, show }: { cs: CallSheetInfo; onClose: () => void; show: (m: string) => void }) {
  const remind = useMutation(api.callSheets.remind);
  const waiting = cs.people.filter((p) => p.on && p.access && ((p.sentAt && !p.openedAt) || (p.kind === "guest" && !p.sentAt)));
  const crew = waiting.filter((p) => p.kind === "crew"), client = waiting.filter((p) => p.kind === "client"), guests = waiting.filter((p) => p.kind === "guest");
  const [on, setOn] = useState({ crew: true, client: true, guests: true });
  const n = (on.crew ? crew.length : 0) + (on.client ? client.length : 0) + (on.guests ? guests.length : 0);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const r = await remind({ callSheetId: cs._id, crew: on.crew, client: on.client, guests: on.guests }); show(r.sent ? `Reminder sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}` : "Everyone it went to has opened it, or was just reminded."); onClose(); }
    catch (e) { show(errText(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Remind" width={560}>
      <div className="crm-dialog">
        <DialogHeader eyebrow="Call sheet" title={`Remind ${n} ${n === 1 ? "person" : "people"}?`} body="These people have not opened the call sheet yet. Each one gets the email again, with the same link. People who have opened it are left out." onClose={onClose} />
        <GroupTicks cs={cs} crew={crew} client={client} guests={guests} on={on} setOn={setOn} />
        <div className="dfoot"><button type="button" className="btn outline" onClick={onClose}>Cancel</button><Button variant="primary" loading={busy} disabled={!n} onClick={() => void go()}>Send reminder</Button></div>
      </div>
    </Modal>
  );
}

// ---------- the sheet as readers see it ----------

type Marks = Array<{ type: string }>;
function Inline({ n, values }: { n: PNode; values: Record<string, string> }) {
  if (n.type === "hardBreak") return <br />;
  if (n.type !== "text") return <>{(n.content ?? []).map((c, i) => <Inline key={i} n={c} values={values} />)}</>;
  let el: React.ReactNode = fill(n.text ?? "", values, "");
  for (const m of (n.marks as Marks | undefined) ?? []) el = m.type === "bold" ? <b>{el}</b> : m.type === "italic" ? <i>{el}</i> : m.type === "underline" ? <u>{el}</u> : m.type === "strike" ? <s>{el}</s> : el;
  return <>{el}</>;
}
const maps = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;

function Block({ n, values }: { n: PNode; values: Record<string, string> }) {
  const a = (n.attrs ?? {}) as Record<string, unknown>;
  const t = (s: string) => fill(s ?? "", values, "");
  switch (n.type) {
    case "paragraph": {
      const size = String(a.size ?? "body");
      const style: React.CSSProperties = { ...(a.align ? { textAlign: a.align as React.CSSProperties["textAlign"] } : {}), ...(a.color ? { color: a.color === "accent" ? "var(--cs-accent)" : String(a.color) } : {}) };
      const inner = n.content?.length ? n.content.map((c, i) => <Inline key={i} n={c} values={values} />) : <br />;
      if (size === "title") return <h1 className="cs-l title" style={style}>{inner}</h1>;
      if (size === "subtitle") return <h2 className="cs-l subtitle" style={style}>{inner}</h2>;
      if (size === "heading") return <h3 className="cs-l heading" style={style}>{inner}</h3>;
      return <p className={`cs-l ${size}${a.deco ? ` deco-${String(a.deco)}` : ""}`} style={style}>{inner}</p>;
    }
    case "bulletList": case "orderedList": {
      const L = n.type === "bulletList" ? "ul" : "ol";
      return <L className="cs-list">{(n.content ?? []).map((li, i) => <li key={i}>{(li.content ?? []).map((c, j) => <Block key={j} n={c} values={values} />)}</li>)}</L>;
    }
    case "section": return <section className={a.look === "card" ? "cs-card" : "cs-sec"}>{(n.content ?? []).map((c, i) => <Block key={i} n={c} values={values} />)}</section>;
    case "divider": case "pagebreak": return <hr className="cs-hr" />;
    case "spacer": return <div style={{ height: Math.min(80, Number(a.size) || 18) }} />;
    case "location": {
      const l = locationOf(n);
      const times = ([["Crew", l.crewCall], ["Talent", l.talentCall], ["Wrap", l.wrap]] as const).filter(([, v]) => v);
      const where = [t(l.name), t(l.address)].filter(Boolean).join(" · ");
      return (
        <div className="cs-loc">
          {times.length > 0 && <div><span className="cs-cap">Call times</span>{times.map(([k, v]) => <span key={k}>{k} · <b>{clockOf(v)}</b></span>)}</div>}
          <div><span className="cs-cap">Location</span>{where && <span>{where}</span>}{l.parking && <span>Parking · {t(l.parking)}</span>}
            {(l.address || l.name) && <a className="cs-maps" href={maps(l.address || l.name)} target="_blank" rel="noopener noreferrer"><Icon name="map-pin" size={14} />Open in Maps</a>}</div>
        </div>
      );
    }
    case "schedule": {
      const rows = rowsOf<ScheduleRow>(n);
      return rows.length ? <div className="cs-rows">{rows.map((r) => <div key={r.id} className="cs-row sched"><span className="time">{clockOf(r.time)}</span><span className="what"><b>{t(r.what)}</b>{(r.who || r.notes) && <span className="sub">{[t(r.who), t(r.notes)].filter(Boolean).join(" · ")}</span>}</span></div>)}</div> : null;
    }
    case "crew": {
      const rows = rowsOf<CrewRow>(n);
      return rows.length ? <div className="cs-rows">{rows.map((r) => <div key={r.id} className="cs-row"><span className="what"><b>{t(r.name)}</b><span className="sub">{t(r.role)}</span></span><span className="time">{clockOf(r.call)}</span>{r.phone && <a className="cs-tel" href={tel(r.phone)}>{r.phone}</a>}</div>)}</div> : null;
    }
    case "contacts": {
      const rows = rowsOf<ContactRow>(n);
      return rows.length ? <div className="cs-rows">{rows.map((r) => <div key={r.id} className="cs-row"><span className="what"><span className="sub">{t(r.label)}</span><b>{t(r.name)}</b></span>{r.phone ? <a className="cs-tel" href={tel(t(r.phone))}>{t(r.phone)}</a> : null}</div>)}</div> : null;
    }
    default: return null; // a contract's blocks never appear on a call sheet
  }
}

/** The whole sheet, read-only: on a phone it keeps the screen's width and a readable size. */
export function SheetView({ page, values, accent }: { page: Page; values: Record<string, string>; accent?: string | null }) {
  return (
    <article className="cs-sheet" style={accent ? { ["--cs-accent" as string]: accent } : undefined}>
      {(page.content ?? []).map((n, i) => <Fragment key={i}><Block n={n} values={values} /></Fragment>)}
    </article>
  );
}
