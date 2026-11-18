// Phase 7 step 1 (D110; frames 751:1808 "Businesses" and 854:10912 "Invite a business"): the platform admin page, Heston
// only. Names, owners, status and counts; never a business's clients or work. The Requests tab (people asking for an
// invite on the product site) comes with Phase P (Heston, Nov 18), so only Businesses shows here for now.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button, EmptyState, ListRow, SkeletonRows, StatusChip, TextArea, TextField } from "../../ui/wp";
import { Modal, useToast } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { errLine } from "../../ui/hold";
import { navigate } from "../../lib/router";
import { Frame } from "../payments/ClientInvoice";

const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const month = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function PlatformAdmin({ me }: { me: { name: string | null; email: string } }) {
  const admin = useQuery(api.platform.me, {});
  const o = useQuery(api.platform.overview, admin?.admin ? {} : "skip");
  const resend = useMutation(api.platform.resend);
  const revoke = useMutation(api.platform.revoke);
  const [inviting, setInviting] = useState(false);
  const [toast, show] = useToast();
  if (admin && !admin.admin) return (
    <Frame inShell={false} bar={null}><EmptyState icon="lock" title="Not available." body="This page is for the platform's admin." actions={<Button onClick={() => navigate("/")}>Back to the portal</Button>} /></Frame>
  );
  const t = o?.totals;
  return (
    <Frame inShell={false} bar={null}>
      <div className="pa-top"><span className="pa-brand"><b>WranglerPortal</b><StatusChip tone="accent">Admin</StatusChip></span><span className="wp-small secondary">{me.name || me.email} · only you see this page</span></div>
      <header className="wp-pagehead">
        <div className="txt"><span className="wp-eyebrow">Platform</span><h1 className="wp-h2">Businesses.</h1>
          <p className="wp-body">Every business on WranglerPortal. You see names, owners, status and usage; never their clients or their work.</p></div>
        <div className="actions"><Button variant="ghost" onClick={() => navigate("/")}>Back to the portal</Button><Button variant="primary" onClick={() => setInviting(true)}>Invite a business</Button></div>
      </header>
      <div className="pov-stats prod-tiles pa-stats">
        <div className="pov-stat prod-tile"><span className="lbl">Businesses</span><b>{t ? t.businesses : "…"}</b><span className="sub">{t ? `${t.active} active${t.settingUp ? ` · ${t.settingUp} setting up` : ""}${t.invited ? ` · ${t.invited} invited` : ""}` : ""}</span></div>
        <div className="pov-stat prod-tile"><span className="lbl">Clients (total)</span><b>{t ? t.clients : "…"}</b><span className="sub">counts only</span></div>
        <div className="pov-stat prod-tile"><span className="lbl">Vendors (total)</span><b>{t ? t.vendors : "…"}</b><span className="sub">counts only</span></div>
      </div>
      <section className="wp-card glass pa-list" aria-label="Businesses">
        {!o ? <SkeletonRows n={3} /> : o.rows.map((r) => (
          <ListRow key={r._id} lead={{ icon: "users" }} title={r.name}
            meta={r.kind === "invite"
              ? <span className="pa-meta">{`${r.email} · invited ${day(r.since)} · ${r.status === "expired" ? `expired ${day(r.expiresAt!)}` : `works until ${day(r.expiresAt!)}`}`}
                <span className="pa-acts">
                  <button type="button" className="linkbtn" onClick={() => void resend({ inviteId: r._id }).then(() => show(`Sent again to ${r.email}. It works for 14 days.`), (e) => show(errLine(e)))}>Send again</button>
                  <button type="button" className="linkbtn" onClick={() => void revoke({ inviteId: r._id }).then(() => show("Invite cancelled. The link no longer works."), (e) => show(errLine(e)))}>Cancel</button>
                </span></span>
              : [r.owner, r.yours ? `since ${month(r.since)}` : `joined ${day(r.since)}`, plural(r.clients, "client"), plural(r.vendors, "vendor"), r.team ? plural(r.team, "team member") : null, r.lastActive ? `last in ${day(r.lastActive)}` : null].filter(Boolean).join(" · ")}
            trailing={<span className="pa-kind wp-small secondary">{r.yours ? "Owner" : "Beta"}</span>}
            chip={<StatusChip tone={r.status === "active" ? "success" : r.status === "setting_up" ? "warning" : "neutral"}>{r.status === "active" ? "Active" : r.status === "setting_up" ? "Setting up" : r.status === "invited" ? "Invited" : "Expired"}</StatusChip>} />
        ))}
      </section>
      {inviting && <InviteBusiness onClose={() => setInviting(false)} show={show} />}
      {toast}
    </Frame>
  );
}

/** 854:10912: Business name, Owner's email, a note. Nothing is sent until Send invite. */
function InviteBusiness({ onClose, show }: { onClose: () => void; show: (m: string) => void }) {
  const invite = useMutation(api.platform.invite);
  const [business, setBusiness] = useState(""), [email, setEmail] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  // Q4: another business may already have invited this email as a client, vendor or team member. Counts only.
  const typed = email.trim().toLowerCase();
  const other = useQuery(api.platform.otherInvites, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(typed) ? { email: typed } : "skip");
  const go = async () => {
    setBusy(true); setErr(null);
    try { await invite({ business, email, ...(note.trim() ? { note } : {}) }); show(`Invite sent to ${email.trim().toLowerCase()}. It works for 14 days.`); onClose(); }
    catch (e) { setErr(errLine(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Invite a business" width={560}>
      <form className="crm-dialog" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <div className="dhead"><div><span className="wp-eyebrow">Platform</span><h2 className="headline">Invite a business.</h2>
          <p className="caption">They get an email to set up their own portal. Free while in beta.</p></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button></div>
        <TextField label="Business name" value={business} onChange={(e) => setBusiness(e.target.value)} maxLength={80} autoFocus required />
        <TextField label="Owner's email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        {other?.inUse && <p className="wp-small secondary" role="status">That email is already in use on WranglerPortal, so it can’t own a new business. Use another address.</p>}
        {other && !other.inUse && other.open && <p className="wp-small" role="status">This email already has an open invite to WranglerPortal from a business. Your invite wins: they’ll become the owner of this new business, and the other invite stays unused until it runs out.</p>}
        <TextArea label="Note in the email (optional)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} placeholder="e.g. Here's the portal I told you about." />
        <p className="wp-small secondary">The email says: “Free while WranglerPortal is in beta. Before paid plans start, you choose a plan or export your data.” The link works for 14 days.</p>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot"><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><Button type="submit" variant="primary" loading={busy} disabled={!business.trim() || !email.trim()}>Send invite</Button></div>
      </form>
    </Modal>
  );
}
