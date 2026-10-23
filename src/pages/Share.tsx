// Share (client side C2, Oct 23): the Share button on a client, a project or a video. Makes a link that lets
// someone outside see it (anyone with the link, or invited emails who sign in), with View or Comment access
// and the settings from the plan. Settings › Shares lists every share (SharesSettings, below).
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, Link2, Mail, Pencil, Plus, Power, Trash2, UserPlus, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { PublicShare } from "../../convex/shares";
import { Modal, useToast } from "../ui/kit";
import { ago } from "../lib/format";

export type ShareTarget = { kind: "client"; client: string } | { kind: "project"; projectId: Id<"projects"> } | { kind: "video"; videoId: Id<"videos"> };

const err = (e: unknown) => (e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0];
export async function copyLink(text: string, show: (m: string) => void) {
  try { await navigator.clipboard.writeText(text); show("Link copied"); } catch { show("Couldn't copy. Select the link and copy it yourself."); }
}

const KINDS = { client: "client", project: "project", video: "video" } as const;
const dateInput = (t: number | null) => (t ? new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString().slice(0, 10) : "");
// A date picked in the box means "through the end of that day", local time.
const endOfDay = (s: string) => { if (!s) return null; const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 23, 59, 59, 999).getTime(); };

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="check sharecheck">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="box">{on && <Check size={13} />}</span>
      <span>{label}{hint && <span className="secondary"> · {hint}</span>}</span>
    </label>
  );
}

function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ v: T; label: string; hint?: string }>; label: string }) {
  return (
    <span className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => <button key={o.v} type="button" role="radio" aria-checked={value === o.v} className={`segbtn${value === o.v ? " on" : ""}`} title={o.hint} onClick={() => onChange(o.v)}>{o.label}</button>)}
    </span>
  );
}

export function ShareDialog({ target, label, onClose, show }: { target: ShareTarget; label: string; onClose: () => void; show: (m: string) => void }) {
  const existing = useQuery(api.shares.forTarget, { target });
  const create = useMutation(api.shares.create);
  const [mode, setMode] = useState<"list" | "new">("new");
  const [made, setMade] = useState<{ url: string; who: "link" | "invited"; added: string[] } | null>(null);
  const [access, setAccess] = useState<"view" | "comment">("comment");
  const [who, setWho] = useState<"link" | "invited">("link");
  const [emails, setEmails] = useState("");
  const [allVersions, setAllVersions] = useState(true);
  const [downloads, setDownloads] = useState(false);
  const [emailNew, setEmailNew] = useState(true);
  const [expires, setExpires] = useState("");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PublicShare | null>(null);
  const kindWord = KINDS[target.kind];
  const list = existing ?? [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const list = emails.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (who === "invited" && !list.length) { setError("Add at least one email, or choose Anyone with the link."); return; }
    setBusy(true); setError(null);
    try {
      const r = await create({ target, access, who, allVersions, downloads, emailNewVersions: emailNew, expiresAt: endOfDay(expires) ?? undefined, passcode: who === "link" && passcode.trim() ? passcode.trim() : undefined, emails: who === "invited" ? list : undefined });
      setMade({ url: r.url, who, added: r.added });
      if (who === "link") void copyLink(r.url, show);
    } catch (ex) { setError(err(ex)); }
    finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} label={`Share ${label}`} width={560}>
      <div style={{ display: "grid", gap: 16 }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">Share {kindWord}</span>
            <h2 className="headline">{made ? "Your link is ready." : `Share ${label}.`} <span className="rest">{made ? (made.who === "link" ? "Anyone with it can open it." : "Each person gets an email with it.") : target.kind === "video" ? "One video and its versions." : target.kind === "project" ? "Every video in the project, including ones added later." : "Every project and video for this client, including ones added later."}</span></h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {made ? (
          <div style={{ display: "grid", gap: 14 }}>
            <div className="prow linkrow"><Link2 size={15} /><code className="addr">{made.url}</code><span className="pr"><button className="btn primary sm" onClick={() => void copyLink(made.url, show)}><Copy size={14} />Copy</button></span></div>
            {made.who === "invited" && <p className="caption" style={{ margin: 0 }}>Sent to {made.added.join(", ")}. First-timers make an account with that email; the link then opens for them. You can add or remove people under Settings › Shares.</p>}
            <div className="dfoot"><button className="btn" onClick={() => { setMade(null); setMode("list"); }}>All links for this {kindWord}</button><button className="btn primary" onClick={onClose}>Done</button></div>
          </div>
        ) : mode === "list" ? (
          <div style={{ display: "grid", gap: 12 }}>
            {list.length === 0 ? <p className="caption" style={{ margin: 0 }}>No links yet for this {kindWord}.</p> : <div className="panel">{list.map((s) => <ShareRow key={s._id} s={s} show={show} onEdit={() => setEditing(s)} compact />)}</div>}
            <div className="dfoot"><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => setMode("new")}><Plus size={15} />New link</button></div>
          </div>
        ) : (
          <form style={{ display: "grid", gap: 16 }} onSubmit={submit}>
            <div className="sharegrid">
              <span className="label">They can</span>
              <Seg label="Access" value={access} onChange={setAccess} options={[{ v: "view", label: "View only", hint: "Watch, and read the notes they're allowed to see" }, { v: "comment", label: "Comment", hint: "Leave notes and replies too" }]} />
              <span className="label">Who</span>
              <Seg label="Who" value={who} onChange={setWho} options={[{ v: "link", label: "Anyone with the link" }, { v: "invited", label: "Invited emails" }]} />
            </div>
            {who === "invited" ? (
              <label className="field">
                <span className="label">Emails <span className="secondary" style={{ textTransform: "none", letterSpacing: 0 }}>(each gets an email with the link; they sign in to open it)</span></span>
                <textarea className="input" rows={2} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="maya@harborcoffee.com, dan@example.com" autoFocus />
              </label>
            ) : (
              <label className="field">
                <span className="label">Passcode <span className="secondary" style={{ textTransform: "none", letterSpacing: 0 }}>(optional; they type it before the link opens)</span></span>
                <input className="input" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="None" autoComplete="off" maxLength={60} />
              </label>
            )}
            <div className="sharechecks">
              <Toggle on={allVersions} onChange={setAllVersions} label="Show all versions" hint="off shows only the latest" />
              <Toggle on={downloads} onChange={setDownloads} label="Allow downloads" hint="the 1080p file" />
              <Toggle on={emailNew} onChange={setEmailNew} label="Email them when a new version lands" hint={who === "link" ? "invited shares only" : undefined} />
              <label className="expires">
                <span>Expires</span>
                <input className="input sm" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} min={dateInput(Date.now() + 86_400_000)} aria-label="Expires on" />
                <span className="secondary">{expires ? <>at the end of that day · <button type="button" className="linkbtn" onClick={() => setExpires("")}>never</button></> : "· never"}</span>
              </label>
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="dfoot">
              {list.length > 0 && <button type="button" className="btn ghost" style={{ marginRight: "auto" }} onClick={() => setMode("list")}>{list.length} existing {list.length === 1 ? "link" : "links"}</button>}
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" type="submit" disabled={busy}>{who === "link" ? <Link2 size={15} /> : <Mail size={15} />}{busy ? "Making…" : who === "link" ? "Make link and copy" : "Make link and email"}</button>
            </div>
          </form>
        )}
      </div>
      {editing && <EditShare s={editing} onClose={() => setEditing(null)} show={show} />}
    </Modal>
  );
}

function stateChip(s: PublicShare) {
  if (s.state === "off") return <span className="chip fail">Off</span>;
  if (s.state === "expired") return <span className="chip fail">Expired</span>;
  if (s.gone) return <span className="chip fail">Deleted {s.kind}</span>;
  return null;
}

export function ShareRow({ s, show, onEdit, compact }: { s: PublicShare; show: (m: string) => void; onEdit: () => void; compact?: boolean }) {
  const setOff = useMutation(api.shares.setOff);
  const remove = useMutation(api.shares.remove);
  const [confirm, setConfirm] = useState(false);
  const people = s.people.map((p) => p.name || p.email);
  return (
    <div className="prow sharerow">
      <span className="pl" style={{ minWidth: 0 }}>
        <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {!compact && <b>{s.label}</b>}
          {!compact && s.sub && <span className="secondary">· {s.sub}</span>}
          <span className="chip fill">{s.access === "comment" ? "Comment" : "View only"}</span>
          <span className="chip fill">{s.who === "link" ? (s.hasPasscode ? "Link + passcode" : "Anyone with the link") : `Invited · ${s.people.length}`}</span>
          {stateChip(s)}
        </span>
        <span className="secondary" style={{ display: "block", fontSize: 12.5, marginTop: 3 }}>
          {s.who === "invited" && people.length > 0 && <>{people.join(", ")} · </>}
          {s.lastOpenedAt ? `Opened ${ago(s.lastOpenedAt)}${s.openCount > 1 ? ` · ${s.openCount} opens` : ""}` : "Not opened yet"}
          {s.expiresAt && s.state !== "expired" && <> · expires {new Date(s.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</>}
          {!s.allVersions && <> · latest version only</>}
          {s.downloads && <> · downloads on</>}
          {` · made ${ago(s.createdAt)}`}
        </span>
      </span>
      <span className="pr" style={{ gap: 6 }}>
        <button className="icon-btn" title="Copy link" aria-label="Copy link" onClick={() => void copyLink(s.url, show)}><Copy size={15} /></button>
        <button className="icon-btn" title="Edit" aria-label="Edit share" onClick={onEdit}><Pencil size={15} /></button>
        <button className={`icon-btn${s.state === "off" ? "" : " on"}`} title={s.state === "off" ? "Switch on" : "Switch off"} aria-label={s.state === "off" ? "Switch on" : "Switch off"} onClick={async () => { await setOff({ shareId: s._id, off: s.state !== "off" }); show(s.state === "off" ? "Link on" : "Link off"); }}><Power size={15} /></button>
        {confirm
          ? <><button className="btn sm primary" onClick={async () => { await remove({ shareId: s._id }); show("Link deleted"); }}>Delete</button><button className="btn sm" onClick={() => setConfirm(false)}>Keep</button></>
          : <button className="icon-btn" title="Delete" aria-label="Delete share" onClick={() => setConfirm(true)}><Trash2 size={15} /></button>}
      </span>
    </div>
  );
}

export function EditShare({ s, onClose, show }: { s: PublicShare; onClose: () => void; show: (m: string) => void }) {
  const update = useMutation(api.shares.update);
  const addMember = useMutation(api.shares.addMember);
  const removeMember = useMutation(api.shares.removeMember);
  const [access, setAccess] = useState(s.access);
  const [allVersions, setAllVersions] = useState(s.allVersions);
  const [downloads, setDownloads] = useState(s.downloads);
  const [emailNew, setEmailNew] = useState(s.emailNewVersions);
  const [expires, setExpires] = useState(dateInput(s.expiresAt));
  const [passcode, setPasscode] = useState<string | null>(null); // null = unchanged
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await update({ shareId: s._id, access, allVersions, downloads, emailNewVersions: emailNew, expiresAt: endOfDay(expires), ...(passcode !== null ? { passcode: passcode.trim() || null } : {}) });
      show("Share saved"); onClose();
    } catch (ex) { setError(err(ex)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Edit share" width={540}>
      <form style={{ display: "grid", gap: 16 }} onSubmit={save}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">{s.who === "link" ? "Anyone with the link" : "Invited emails"}</span>
            <h2 className="headline">{s.label} <span className="rest">{s.sub ? `· ${s.sub}` : ""}</span></h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="prow linkrow" style={{ padding: "8px 0" }}><Link2 size={15} /><code className="addr">{s.url}</code><span className="pr"><button type="button" className="btn sm" onClick={() => void copyLink(s.url, show)}><Copy size={14} />Copy</button></span></div>
        <div className="sharegrid">
          <span className="label">They can</span>
          <Seg label="Access" value={access} onChange={setAccess} options={[{ v: "view", label: "View only" }, { v: "comment", label: "Comment" }]} />
        </div>
        {s.who === "invited" ? (
          <div className="field">
            <span className="label">People</span>
            <div className="panel">
              {s.people.length === 0 && <div className="prow"><span className="pl secondary">No one yet.</span></div>}
              {s.people.map((p) => (
                <div className="prow" key={p.email}>
                  <span className="pl">{p.name ? <>{p.name} <span className="secondary">· {p.email}</span></> : p.email}<span className="secondary" style={{ display: "block", fontSize: 12.5 }}>{!p.invited ? "Invite removed in Settings › Clients; can't open this" : p.hasAccount ? "Has an account" : "No account yet"}{p.emailedAt ? ` · emailed ${ago(p.emailedAt)}` : ""}</span></span>
                  <span className="pr"><button type="button" className="btn sm" onClick={async () => { await removeMember({ shareId: s._id, email: p.email }); show("Removed"); }}><X size={14} />Remove</button></span>
                </div>
              ))}
              <div className="prow">
                <span className="pr" style={{ marginLeft: 0, width: "100%" }}>
                  <input className="input sm" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Add an email" aria-label="Add an email" style={{ flex: 1 }}
                    onKeyDown={async (e) => { if (e.key === "Enter") { e.preventDefault(); if (newEmail.trim()) { try { await addMember({ shareId: s._id, email: newEmail }); setNewEmail(""); show("Added and emailed"); } catch (ex) { setError(err(ex)); } } } }} />
                  <button type="button" className="btn sm" disabled={!newEmail.trim()} onClick={async () => { try { await addMember({ shareId: s._id, email: newEmail }); setNewEmail(""); show("Added and emailed"); } catch (ex) { setError(err(ex)); } }}><UserPlus size={14} />Add</button>
                </span>
              </div>
            </div>
          </div>
        ) : (
          <label className="field">
            <span className="label">Passcode <span className="secondary" style={{ textTransform: "none", letterSpacing: 0 }}>{s.hasPasscode ? "(set; type a new one to change it, or clear it)" : "(none)"}</span></span>
            <span style={{ display: "flex", gap: 8 }}>
              <input className="input" value={passcode ?? ""} onChange={(e) => setPasscode(e.target.value)} placeholder={s.hasPasscode ? "••••••" : "None"} autoComplete="off" maxLength={60} />
              {s.hasPasscode && <button type="button" className="btn" onClick={() => setPasscode("")}>Clear</button>}
            </span>
          </label>
        )}
        <div className="sharechecks">
          <Toggle on={allVersions} onChange={setAllVersions} label="Show all versions" hint="off shows only the latest" />
          <Toggle on={downloads} onChange={setDownloads} label="Allow downloads" hint="the 1080p file" />
          <Toggle on={emailNew} onChange={setEmailNew} label="Email them when a new version lands" hint={s.who === "link" ? "invited shares only" : undefined} />
          <label className="expires">
            <span>Expires</span>
            <input className="input sm" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} aria-label="Expires on" />
            <span className="secondary">{expires ? <>at the end of that day · <button type="button" className="linkbtn" onClick={() => setExpires("")}>never</button></> : "· never"}</span>
          </label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
      </form>
    </Modal>
  );
}

// Settings › Shares: every link, what it covers, who's on it, when it was last opened, with copy / edit / off / delete.
export function SharesSettings({ show }: { show: (m: string) => void }) {
  const shares = useQuery(api.shares.list, {});
  const [editing, setEditing] = useState<PublicShare | null>(null);
  const [activityFor, setActivityFor] = useState<PublicShare | null>(null);
  useEffect(() => { if (location.hash === "#shares") document.getElementById("shares")?.scrollIntoView({ block: "start" }); }, []);
  return (
    <>
      <div style={{ display: "grid", gap: 8 }} id="shares">
        <span className="eyebrow">Shares</span>
        <h1 className="headline">Every link you've made. <span className="rest">Switch one off and it stops working at once, even for someone mid-review. Share from a client, a project or a video.</span></h1>
      </div>
      <div className="panel">
        {shares === undefined ? null : shares.length === 0 ? <div className="prow"><span className="pl secondary">No links yet. Use Share on a client, a project or a video.</span></div>
          : shares.map((s) => (
            <div key={s._id} style={{ display: "contents" }}>
              <ShareRow s={s} show={show} onEdit={() => setEditing(s)} />
              <div className="prow" style={{ paddingTop: 0, minHeight: 0, borderTop: 0 }}>
                <button className="linkbtn secondary" style={{ fontSize: 12.5 }} onClick={() => setActivityFor(activityFor?._id === s._id ? null : s)}>{activityFor?._id === s._id ? "Hide activity" : "Show activity"}</button>
              </div>
              {activityFor?._id === s._id && <ShareActivity shareId={s._id} />}
            </div>
          ))}
      </div>
      {editing && <EditShare s={editing} onClose={() => setEditing(null)} show={show} />}
    </>
  );
}

function ShareActivity({ shareId }: { shareId: Id<"shares"> }) {
  const rows = useQuery(api.shares.activity, { shareId, limit: 30 });
  if (rows === undefined) return null;
  return (
    <div className="prow" style={{ paddingTop: 0, borderTop: 0, display: "block" }}>
      {rows.length === 0 ? <span className="caption">Nothing yet.</span> : (
        <ul className="sharelog">
          {rows.map((r) => <li key={r._id}><span className="secondary">{ago(r.at)}</span> {r.who} {r.kind === "opened" ? "opened the link" : r.kind === "viewed" ? <>watched <b>{r.videoTitle ?? "a video"}</b></> : <>left a note on <b>{r.videoTitle ?? "a video"}</b></>}</li>)}
        </ul>
      )}
    </div>
  );
}

// A Share button that opens the dialog; the toast lives with the page.
export function ShareButton({ target, label, className = "btn sm", children }: { target: ShareTarget; label: string; className?: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [toast, show] = useToast();
  return (
    <>
      <button className={className} onClick={() => setOpen(true)} title={`Share ${label}`}>{children}</button>
      {open && <ShareDialog target={target} label={label} onClose={() => setOpen(false)} show={show} />}
      {toast}
    </>
  );
}
