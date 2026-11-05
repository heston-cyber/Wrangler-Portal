// Phase 5e step 1 (Nov 5): Settings › Team (Design Log › Phase 5e: Settings › Team 813:8996, Member page and Roles
// 814:10394 / 814:11079, Team dialogs 814:11702 …). Owner only (the server refuses everyone else).
// /settings/team: members, pending invites, the Roles card. /settings/team/roles: the Roles matrix.
// /settings/team/<membership>: one member: role pills, their switches, project value, last signed in, Remove.
// D156 (Nov 5): a Producer sees budgets. D157: an Editor works in Review on assigned projects only (other switches locked).
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, Card, DialogHeader, ListRow, SectionHead, SkeletonRows, StatusChip, Toggle } from "../../ui/wp";
import { Modal, useConfirm } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { linkProps, navigate } from "../../lib/router";
import { ago } from "../../lib/format";
import { errText } from "../docs/pages/common";
import { SetHead } from "../settings/Frame";
import { PERMS, PERM_NAMES, ROLE_NAMES, TEAM_ROLES, type Perm, type TeamRole } from "../../../convex/lib/perms";

export const ROLE_TEXT: Record<TeamRole, string> = {
  producer: "Producer: projects, shoots, Production, clients, Review, Docs and budgets. No payments, reports or Settings.",
  editor: "Editor: Review on the projects they're assigned to, nothing else.",
  bookkeeper: "Bookkeeper: payments, reports and vendor payments, and what each project is worth.",
};
const dateText = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const signedIn = (ms: number | null) => (ms ? `Signed in ${ago(ms)}` : "Hasn't signed in yet");

export function TeamSection({ path, show }: { path: string; show: (m: string) => void }) {
  const rest = path.replace(/^\/settings\/team\/?/, "").replace(/\/$/, "");
  if (rest === "roles") return <RolesPage show={show} />;
  if (rest) return <MemberPage membershipId={rest as Id<"memberships">} show={show} />;
  return <TeamList show={show} />;
}

function RolePills({ value, onChange, disabled }: { value: TeamRole; onChange: (r: TeamRole) => void; disabled?: boolean }) {
  return (
    <div className="qz-chips team-roles" role="radiogroup" aria-label="Role">
      {TEAM_ROLES.map((r) => <button key={r} type="button" role="radio" aria-checked={value === r} disabled={disabled} className={`qz-chip${value === r ? " on" : ""}`} onClick={() => onChange(r)}>{ROLE_NAMES[r]}</button>)}
    </div>
  );
}

// ---------- the list ----------

function TeamList({ show }: { show: (m: string) => void }) {
  const page = useQuery(api.team.page);
  const me = useQuery(api.users.me);
  const resend = useMutation(api.team.resendInvite);
  const cancel = useMutation(api.team.cancelInvite);
  const [ask, confirmNode] = useConfirm();
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const doResend = async (inviteId: Id<"teamInvites">) => {
    setBusy(inviteId);
    try { await resend({ inviteId }); show("Invite sent again. The new link works for 14 days."); } catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  const doCancel = async (inviteId: Id<"teamInvites">, email: string) => {
    if (!(await ask({ title: `Cancel the invite to ${email}?`, body: "The link in their email stops working. You can invite them again later.", yes: "Cancel invite", no: "Keep it", danger: true }))) return;
    try { await cancel({ inviteId }); show("Invite cancelled."); } catch (e) { show(errText(e)); }
  };
  return (
    <>
      <SetHead eyebrow="Settings" title="Team." sub="Invite people to work in the portal. They see only what their role allows." />
      {page === undefined ? <Card label="Members"><SkeletonRows n={3} label="Loading the team" /></Card> : <>
        <Card label="Members" head={<SectionHead label="Members" count={page.members.length + 1} action={<Button size="sm" variant="ghost" onClick={() => setInviting(true)}>Invite a team member</Button>} />}>
          <ListRow lead={{ icon: "user" }} title={me?.name ?? "You"} meta={me?.email} chip={<StatusChip tone="accent">Owner</StatusChip>} />
          {page.members.map((m) => (
            <ListRow key={m.membershipId} lead={{ icon: "user" }} title={m.name} meta={`${m.email} · ${signedIn(m.lastSignedIn)}`} chip={<StatusChip tone="neutral">{ROLE_NAMES[m.role as TeamRole]}</StatusChip>} to={`/settings/team/${m.membershipId}`} chevron />
          ))}
          {!page.members.length && <p className="wp-small secondary team-pad">Nobody else yet. Invite a Producer, an Editor or a Bookkeeper.</p>}
        </Card>
        {!!page.invites.length && (
          <Card label="Pending invites" head={<SectionHead label="Pending invites" count={page.invites.length} />}>
            {page.invites.map((i) => (
              <ListRow key={i.inviteId} lead={{ icon: "mail" }} title={i.email} meta={`${ROLE_NAMES[i.role as TeamRole]} · Sent ${dateText(i.sentAt)} · ${i.expired ? "Expired" : `Expires ${dateText(i.expiresAt)}`}`}
                chip={<StatusChip tone="warning">Pending</StatusChip>}
                action={<span className="team-acts"><Button size="sm" variant="ghost" onClick={() => void doCancel(i.inviteId, i.email)}>Cancel</Button><Button size="sm" loading={busy === i.inviteId} onClick={() => void doResend(i.inviteId)}>Resend</Button></span>} />
            ))}
          </Card>
        )}
        <Card label="Roles" head={<SectionHead label="Roles" />}>
          <ListRow lead={{ icon: "lock" }} title="Roles and what each can see" meta="Owner, Producer, Editor, Bookkeeper" to="/settings/team/roles" chevron />
        </Card>
      </>}
      {inviting && <InviteDialog onClose={() => setInviting(false)} show={show} />}
      {confirmNode}
    </>
  );
}

function InviteDialog({ onClose, show }: { onClose: () => void; show: (m: string) => void }) {
  const invite = useMutation(api.team.invite);
  const resend = useMutation(api.team.resendInvite);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("producer");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<Id<"teamInvites"> | null>(null);
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await invite({ email, role });
      if ("ok" in r) { show(`Invite sent to ${email.trim().toLowerCase()}.`); onClose(); return; }
      if (r.error === "already") setErr("They're already on your team.");
      else if (r.error === "owner") setErr("That's an owner's email.");
      else if (r.error === "otherLogin") setErr("This email already has a client or vendor login, or is on another team. Use a different email for their team login.");
      else if (r.error === "pending") { setErr("They already have an invite waiting. Send it again?"); setPending(r.inviteId); }
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const again = async () => {
    if (!pending) return;
    setBusy(true);
    try { await resend({ inviteId: pending }); show("Invite sent again."); onClose(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Invite a team member" width={640}>
      <div className="crm-dialog team-dialog">
        <DialogHeader eyebrow="Team" title="Invite a team member" body="They get an email with a link. They log in the way you do." onClose={onClose} />
        <label className="wp-field"><span className="wp-field-label">Email</span>
          <input className="input" type="email" autoFocus placeholder="name@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setPending(null); setErr(null); }} /></label>
        <div className="wp-field"><span className="wp-field-label">Role</span><RolePills value={role} onChange={setRole} /></div>
        <p className="wp-small secondary">{ROLE_TEXT[role]}</p>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          {pending ? <Button variant="primary" loading={busy} onClick={() => void again()}>Send it again</Button>
            : <Button variant="primary" loading={busy} disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} onClick={() => void send()}>Send invite</Button>}
        </div>
      </div>
    </Modal>
  );
}

// ---------- one member ----------

function MemberPage({ membershipId, show }: { membershipId: Id<"memberships">; show: (m: string) => void }) {
  const m = useQuery(api.team.member, { membershipId });
  const setRole = useMutation(api.team.setRole);
  const setPerm = useMutation(api.team.setPerm);
  const reset = useMutation(api.team.resetToRole);
  const remove = useMutation(api.team.remove);
  const [ask, confirmNode] = useConfirm();
  if (m === undefined) return <Card label="Member"><SkeletonRows n={4} label="Loading" /></Card>;
  const role = m.role as TeamRole;
  const locked = new Set(m.locked as Perm[]);
  const run = async (f: () => Promise<unknown>, done?: string) => { try { await f(); if (done) show(done); } catch (e) { show(errText(e)); } };
  const doRemove = async () => {
    if (!(await ask({ title: `Remove ${m.name}?`, body: "Their sign-in stops working at once and they're signed out everywhere. What they made stays in the portal.", yes: "Remove", danger: true }))) return;
    await run(() => remove({ membershipId }), `${m.name} is off the team.`);
    navigate("/settings/team");
  };
  return (
    <>
      <SetHead eyebrow="Settings" title={`${m.name}.`} sub={`${ROLE_NAMES[role]} · ${m.email}`} />
      <Card label="Role" head={<SectionHead label="Role" />}>
        <div className="team-form">
          <label className="wp-field"><span className="wp-field-label">Name</span><input className="input" value={m.name} readOnly /></label>
          <label className="wp-field"><span className="wp-field-label">Email</span><input className="input" value={m.email} readOnly /></label>
          <div className="wp-field"><span className="wp-field-label">Role</span><RolePills value={role} onChange={(r) => void run(() => setRole({ membershipId, role: r }), `${m.name} is a ${ROLE_NAMES[r]} now.`)} /></div>
          <p className="wp-small secondary">{ROLE_TEXT[role]}</p>
        </div>
      </Card>
      <Card label="What they can use" head={<SectionHead label="What they can use" action={!m.matchesRole ? <Button size="sm" variant="ghost" onClick={() => void run(() => reset({ membershipId }), "Back to the role's switches.")}>Reset to the role</Button> : undefined} />}>
        {role === "editor" && <p className="wp-small secondary team-pad">Editors work in Review on the projects they're assigned to. For more, make them a Producer.</p>}
        {PERMS.filter((p) => p !== "value").map((p) => (
          <div key={p} className="bc-row team-row">
            <span className="l"><b>{p === "clients" ? "Clients" : PERM_NAMES[p]}</b>{p === "projects" && <small>{role === "editor" ? "Assigned only" : "All projects"}</small>}</span>
            <span className="v">{locked.has(p) ? <Icon name="lock" size={16} /> : <Toggle checked={!!m.perms[p]} label={PERM_NAMES[p]} onChange={(on) => void run(() => setPerm({ membershipId, perm: p, on }))} />}</span>
          </div>
        ))}
      </Card>
      <Card label="Project value" head={<SectionHead label="Project value" />}>
        <div className="bc-row team-row">
          <span className="l"><b>Can see what a project is worth</b><small>{locked.has("value") ? "Not available to Editors." : "Budgets, the pipeline's amounts, estimates and the job ledger."}</small></span>
          <span className="v">{locked.has("value") ? <StatusChip tone="neutral">Off</StatusChip> : <Toggle checked={!!m.perms.value} label="Can see what a project is worth" onChange={(on) => void run(() => setPerm({ membershipId, perm: "value", on }))} />}</span>
        </div>
      </Card>
      {!!m.projects.length && (
        <Card label="Assigned projects" head={<SectionHead label="Assigned projects" count={m.projects.length} />}>
          {m.projects.map((p) => <ListRow key={p.projectId} lead={{ icon: "folder" }} title={p.name} to={`/projects/${p.projectId}`} chevron />)}
        </Card>
      )}
      <Card label="Sign-in" head={<SectionHead label="Sign-in" />}>
        <ListRow lead={{ icon: "clock" }} title="Last signed in" meta={m.lastSignedIn ? new Date(m.lastSignedIn).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not yet"} />
      </Card>
      <Card label="Remove" head={<SectionHead label="Remove" />}>
        <ListRow lead={{ icon: "sign-out" }} title="Remove from the team" meta="Their sign-in stops working. What they made stays in the portal." action={<Button size="sm" onClick={() => void doRemove()}>Remove</Button>} />
      </Card>
      {confirmNode}
    </>
  );
}

// ---------- the Roles matrix ----------

function RolesPage({ show }: { show: (m: string) => void }) {
  const page = useQuery(api.team.page);
  const setRolePerm = useMutation(api.team.setRolePerm);
  const resetRoles = useMutation(api.team.resetRoles);
  const [ask, confirmNode] = useConfirm();
  const run = async (f: () => Promise<unknown>, done?: string) => { try { await f(); if (done) show(done); } catch (e) { show(errText(e)); } };
  const doReset = async () => {
    if (!(await ask({ title: "Reset every role to the suggested switches?", body: "Everyone in each role gets the suggested switches, including people you changed one by one.", yes: "Reset all" }))) return;
    await run(() => resetRoles({}), "Every role is back to the suggested switches.");
  };
  return (
    <>
      <SetHead eyebrow="Settings" title="Team." sub="Choose what each role can use. Changes apply to everyone in that role." />
      <p className="wp-small"><a {...linkProps("/settings/team")}>← Back to the team</a></p>
      {page === undefined ? <Card label="Roles"><SkeletonRows n={6} label="Loading" /></Card> : (
        <Card className="team-matrix" label="Roles and what they can use" head={<SectionHead label="Roles and what they can use" action={<Button size="sm" variant="ghost" onClick={() => void doReset()}>Reset all to suggested</Button>} />}>
          <div className="team-mrow head" role="row"><span className="wp-label">Permission</span><span className="wp-label">Owner</span>{TEAM_ROLES.map((r) => <span key={r} className="wp-label">{ROLE_NAMES[r]}</span>)}</div>
          {PERMS.map((p) => (
            <div key={p} className="team-mrow" role="row">
              <span className="pn">{PERM_NAMES[p]}</span>
              <span className="ok"><Icon name="check" size={16} /></span>
              {TEAM_ROLES.map((r) => {
                const lockedOff = (page.locked[r] as Perm[]).includes(p);
                if (r === "editor" && p === "projects") return <span key={r} className="wp-small secondary">Assigned only</span>;
                return <span key={r}>{lockedOff ? <Icon name="lock" size={16} className="secondary" /> : <Toggle checked={!!page.roles[r][p]} label={`${ROLE_NAMES[r]}: ${PERM_NAMES[p]}`} onChange={(on) => void run(() => setRolePerm({ role: r, perm: p, on }))} />}</span>;
              })}
            </div>
          ))}
          <p className="wp-small secondary team-pad">Editors work in Review on the projects they're assigned to, so their other switches are locked.</p>
        </Card>
      )}
      {confirmNode}
    </>
  );
}
