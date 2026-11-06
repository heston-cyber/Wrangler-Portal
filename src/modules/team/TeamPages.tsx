// Phase 5e step 1 (Nov 5): a team member's own pages (Design Log › Role views, frames 815:11173 … 816:13259).
// The Dashboard is built from what their switches open: shoots for a Producer, notes and projects from Review, money for
// a Bookkeeper. A direct link to a page their role can't use shows the no-access page; Settings › Account is theirs.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { TopBar } from "../../shell/Shell";
import { useSignOutAsk } from "../../shell/SignOut";
import { Button, ButtonLink, Card, EmptyState, ListRow, PageHeader, SectionHead, SkeletonRows } from "../../ui/wp";
import { Tile } from "../overviews/Tile";
import { usePerms } from "../../lib/teamAccess";
import { errText } from "../docs/pages/common";
import { DevicesCard, SignInRows } from "../security/Security";

const ROLE: Record<string, string> = { producer: "Producer", editor: "Editor", bookkeeper: "Bookkeeper" };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const first = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] || "";
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayText = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const inWeek = (d: string) => { const t = new Date(); const end = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 7).toISOString().slice(0, 10); return d <= end; };

/** "/" for a team member. */
export function TeamHome({ name }: { name: string | null }) {
  const { perms, role } = usePerms();
  const reviewOn = perms.review;
  const shootsOn = perms.shoots && role !== "editor";
  const payOn = perms.payments;
  const ov = useQuery(api.library.overview, reviewOn ? {} : "skip");
  const shoots = useQuery(api.production.shoots, shootsOn ? {} : "skip");
  const invoices = useQuery(api.invoices.list, payOn ? {} : "skip");
  const notes = (ov?.videos ?? []).filter((v) => v.openNotes > 0).sort((a, b) => b.updatedAt - a.updatedAt);
  const noteCount = notes.reduce((n, v) => n + v.openNotes, 0);
  const week = (shoots?.upcoming ?? []).filter((s) => inWeek(s.date));
  const open = (invoices ?? []).filter((i) => ["open", "overdue", "sent", "viewed", "partly_paid"].includes(String(i.status)));
  const overdue = open.filter((i) => String(i.status) === "overdue");
  const owed = open.reduce((n, i) => n + (i.amountRemainingCents ?? 0), 0);
  const sub = role === "bookkeeper" ? "What's paid and what's owed." : role === "editor" ? "Your projects and the notes on them." : "Your shoots and notes this week.";
  const loading = (reviewOn && ov === undefined) || (shootsOn && shoots === undefined) || (payOn && invoices === undefined);
  return (
    <>
      <TopBar><span className="here">Dashboard</span></TopBar>
      <div className="wp-page wp-home pov">
        <PageHeader title={`${greeting()}${first(name) ? `, ${first(name)}` : ""}.`} sub={sub} />
        <div className="pov-stats ov-tiles">
          {shootsOn && <Tile label="Shoots this week" n={shoots ? week.length : "–"} sub={week[0] ? `Next: ${dayText(week[0].date)}` : "None this week"} to="/production/shoots" link="See shoots" />}
          {reviewOn && <Tile label="Notes waiting" n={ov ? noteCount : "–"} sub={notes.length ? `Across ${notes.length === 1 ? "1 video" : `${notes.length} videos`}` : "All caught up"} to="/review" link="Open Review" />}
          {reviewOn && <Tile label={role === "editor" ? "Your projects" : "Projects in progress"} n={ov ? ov.projects.length : "–"} sub={`${ov?.videos.length ?? 0} videos`} to="/review" link="See projects" />}
          {payOn && <Tile label="Owed to you" n={invoices ? money(owed) : "–"} sub={`${open.length} open ${open.length === 1 ? "invoice" : "invoices"}`} to="/payments/invoices" link="See invoices" />}
          {payOn && <Tile label="Overdue" n={invoices ? overdue.length : "–"} sub="invoices past due" to="/payments/invoices" link="See them" />}
        </div>
        {loading ? <Card label="This week"><SkeletonRows n={3} label="Loading" /></Card>
          : (week.length || notes.length || overdue.length) ? (
            <Card label="This week" head={<SectionHead label="This week" count={week.length + notes.length + overdue.length} />}>
              {week.map((s) => <ListRow key={s._id} lead={{ icon: "video" }} title={`${s.project}${s.client ? ` · ${s.client}` : ""}`} meta={`${dayText(s.date)} · ${s.call}`} to={`/projects/${s.projectId}`} chevron />)}
              {notes.slice(0, 6).map((v) => <ListRow key={v._id} lead={{ icon: "review" }} title={`Notes on ${v.title}${v.latest ? ` v${v.latest.number}` : ""}`} meta={`${v.openNotes} open ${v.openNotes === 1 ? "note" : "notes"}`} to={`/v/${v._id}`} chevron />)}
              {overdue.slice(0, 6).map((i) => <ListRow key={i._id} lead={{ icon: "invoice" }} title={`${i.title}${i.client ? ` · ${i.client.name}` : ""}`} meta={`Overdue · ${money(i.amountRemainingCents ?? 0)}`} to={`/payments/invoices/${i._id}`} chevron />)}
            </Card>
          ) : <EmptyState title="Nothing waiting on you." body={role === "editor" ? "When you're assigned to a project, its cuts and notes show here." : "Shoots, notes and money that need you show here."} />}
      </div>
    </>
  );
}

/** A page this role can't use (Design Log › Role views, "no access"). */
export function NoAccess() {
  return (
    <>
      <TopBar><span className="here">No access</span></TopBar>
      <div className="wp-page">
        <EmptyState icon="lock" title="You do not have access to this page." body="Your role doesn't include it. Ask the owner if you need it." actions={<ButtonLink variant="secondary" to="/" iconEnd={false}>Go to your Dashboard</ButtonLink>} />
      </div>
    </>
  );
}

/** Settings › Account for a team member: their name, their email and role, and Sign out. Password and email come with Security. */
export function TeamAccount({ me }: { me: { name: string | null; email: string } }) {
  const { role } = usePerms();
  const setName = useMutation(api.users.setName);
  const [name, setNameText] = useState(me.name ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [signOut, signOutDialog] = useSignOutAsk();
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await setName({ name }); setMsg("Saved."); } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <TopBar><span className="here">Account</span></TopBar>
      <div className="wp-page">
        <PageHeader title="Account." sub={`You work here as ${role ? ROLE[role] ?? role : "a team member"}.`} />
        <Card label="Your details" head={<SectionHead label="Your details" />}>
          <div className="team-form">
            <label className="wp-field"><span className="wp-field-label">Your name</span><input className="input" value={name} maxLength={60} onChange={(e) => setNameText(e.target.value)} /></label>
            <label className="wp-field"><span className="wp-field-label">Email</span><input className="input" value={me.email} readOnly /></label>
            <div className="team-acts"><Button variant="primary" loading={busy} disabled={!name.trim() || name.trim() === (me.name ?? "")} onClick={() => void save()}>Save</Button>{msg && <span className="wp-small secondary">{msg}</span>}</div>
          </div>
        </Card>
        <Card label="Sign-in" head={<SectionHead label="Sign-in" />}><SignInRows show={(m) => setMsg(m)} /></Card>
        <DevicesCard show={(m) => setMsg(m)} />
        <div className="team-acts"><Button variant="secondary" onClick={signOut}>Sign out</Button></div>
        {signOutDialog}
      </div>
    </>
  );
}
