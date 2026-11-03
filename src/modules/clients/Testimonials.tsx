// Phase 5 (Nov 3): testimonials (S5 · Phase 5). The client's form (742:3479) and Thanks (742:3833), reached only from
// the request note's link (/words/<note>, D139); and the owner's Clients › Testimonials (743:1991). D141: nothing is
// published; each answer is saved as a Markdown note in Dropbox (Apps › Wrangler Review › Testimonials) for the vault,
// so the frame's Publish button and Published tab are replaced by where it was saved.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, Button, ButtonLink, Card, Checkbox, EmptyState, PillTabs, SkeletonRows, StatusChip, TextArea } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { errText } from "../docs/pages/common";

const first = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0] || "";
const monthDay = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// ---------- the client ----------

export function ClientTestimonialPage({ noteId }: { noteId: string }) {
  const d = useQuery(api.testimonials.ask, { noteId });
  const send = useMutation(api.testimonials.send);
  const [working, setWorking] = useState(""), [film, setFilm] = useState("");
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const [toast, show] = useToast();
  const crumbs = <><a {...linkProps("/review")}>Review</a>{d && <><Sep /><a {...linkProps(`/projects/${d.project._id}`)}>{d.project.label}</a></>}<Sep /><span className="here">A few words</span></>;
  if (d === undefined) return <><TopBar>{crumbs}</TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (d === null) return <><TopBar>{crumbs}</TopBar><div className="wp-page"><EmptyState icon="note" title="This isn't here." body="It may not be shared with you any more." actions={<ButtonLink to="/inbox">Back to your Inbox</ButtonLink>} /></div></>;
  const shownAs = [d.name, d.company].filter(Boolean).join(", ") || "your name";
  const why = <aside className="col right"><section className="qz-side glass"><span className="wp-eyebrow">Why we ask</span>
    <p className="wp-small">It helps the next business decide. Nothing is posted without your OK.</p></section></aside>;

  if (d.sent) {
    return (
      <>
        <TopBar>{crumbs}</TopBar>
        <div className="wp-page qz tm-page">
          <header className="wp-pagehead"><div className="txt">
            <span className="wp-eyebrow">{d.business}</span>
            <h1 className="wp-h2">{first(d.name) ? `Thank you, ${first(d.name)}.` : "Thank you."}</h1>
            <p className="wp-body">{first(d.owner) || d.business} will read it today.</p>
          </div></header>
          <div className="qz-cols">
            <div className="col">
              <section className="qz-card glass tm-wrote" aria-label="What you wrote">
                <span className="wp-eyebrow">What you wrote</span>
                {d.sent.working && <p className="tm-quote">“{d.sent.working}”</p>}
                {d.sent.film && <p className="tm-quote">“{d.sent.film}”</p>}
                <p className="wp-small secondary">{d.sent.permission ? "You said we can use your words and name." : "You asked us to keep it private."} Want to change that? Reply to the email.</p>
              </section>
            </div>
            {why}
          </div>
        </div>
      </>
    );
  }
  const submit = async () => {
    setErr(null);
    if (!working.trim() && !film.trim()) { setErr("Answer at least one of the questions."); return; }
    setBusy(true);
    try { await send({ noteId, working, film, permission }); window.scrollTo({ top: 0 }); } catch (e) { setErr(errText(e)); show(errText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <TopBar>{crumbs}</TopBar>
      <div className="wp-page qz tm-page">
        <header className="wp-pagehead"><div className="txt">
          <span className="wp-eyebrow">{d.business}</span>
          <h1 className="wp-h2">How did it go?</h1>
          <p className="wp-body">Two quick questions about {d.project.label}. It takes a minute.</p>
        </div></header>
        <div className="qz-cols">
          <div className="col">
            <form className="qz-card glass tm-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <span className="wp-eyebrow">A few words</span>
              <TextArea label={d.questions.working} value={working} onChange={(e) => setWorking(e.target.value)} rows={4} maxLength={2000} />
              <TextArea label={d.questions.film} value={film} onChange={(e) => setFilm(e.target.value)} rows={4} maxLength={2000} />
              <Checkbox checked={permission} onChange={setPermission} label="You can use my words and name on your website." hint={`Shown as "${shownAs}". You can say no and still send it.`} />
              {err && <p className="error" role="alert">{err}</p>}
              <div><Button variant="primary" type="submit" loading={busy}>Send</Button></div>
            </form>
          </div>
          {why}
        </div>
      </div>
      {toast}
    </>
  );
}

// ---------- the owner: Clients › Testimonials ----------

type Tab = "all" | "new" | "can" | "private";

export default function TestimonialsPage() {
  const rows = useQuery(api.testimonials.list, {});
  const markRead = useMutation(api.testimonials.markRead);
  const saveAgain = useMutation(api.testimonials.saveAgain);
  const [tab, setTab] = useState<Tab>("all");
  const [toast, show] = useToast();
  const counts = useMemo(() => ({
    all: rows?.length ?? 0, new: rows?.filter((r) => !r.read).length ?? 0,
    can: rows?.filter((r) => r.permission).length ?? 0, private: rows?.filter((r) => !r.permission).length ?? 0,
  }), [rows]);
  const shown = (rows ?? []).filter((r) => tab === "all" || (tab === "new" ? !r.read : tab === "can" ? r.permission : !r.permission));
  return (
    <>
      <TopBar><a {...linkProps("/clients")}>Clients</a><Sep /><span className="here">Testimonials</span></TopBar>
      <div className="wp-page tm-list">
        <header className="wp-pagehead"><div className="txt">
          <span className="wp-eyebrow">Clients</span>
          <h1 className="wp-h2">Testimonials.</h1>
          <p className="wp-body">What clients said at the end of a project. Each one is saved for your vault in Dropbox › Apps › Wrangler Review › Testimonials. Use one publicly only when they said you can.</p>
        </div></header>
        <PillTabs<Tab> label="Show" value={tab} onChange={setTab} items={[
          { key: "all", label: "All", count: counts.all }, { key: "new", label: "New", count: counts.new },
          { key: "can", label: "Can use", count: counts.can }, { key: "private", label: "Private", count: counts.private },
        ]} />
        {rows === undefined ? <Card label="Loading"><SkeletonRows n={3} /></Card>
          : !shown.length ? <EmptyState icon="note" title={rows.length ? "Nothing here." : "No testimonials yet."} body={rows.length ? undefined : "Ask for one from Post a note: “Ask for a testimonial” picks the project and sends two quick questions."} actions={rows.length ? undefined : <ButtonLink to="/sent/new">Post a note</ButtonLink>} />
          : shown.map((r) => (
            <section key={r._id} className="tm-card glass" aria-label={`${r.name} · ${r.project}`}>
              <div className="tm-head">
                <Avatar name={r.name} size={36} />
                <div className="who"><b>{r.name}{r.company ? ` · ${r.company}` : ""}</b><span className="secondary">{r.project} · {monthDay(r.createdAt)}</span></div>
                {!r.read ? <StatusChip tone="accent">New</StatusChip> : !r.permission ? <StatusChip tone="neutral">Private</StatusChip> : null}
              </div>
              {r.working && <p className="tm-quote">“{r.working}”</p>}
              {r.film && <p className="tm-quote">“{r.film}”</p>}
              <div className="tm-foot">
                {r.permission ? <span className="tm-ok"><Icon name="check" size={14} plain />Can use words and name</span> : <span className="secondary">Private: no permission to use it publicly</span>}
                <span className="sp" />
                {r.saved ? <span className="secondary tm-saved" title={r.saved.path ?? undefined}><Icon name="folder" size={14} plain />Saved for your vault</span>
                  : r.saveError ? <><span className="tm-err">{r.saveError}</span><Button size="sm" onClick={() => void saveAgain({ testimonialId: r._id as Id<"testimonials"> }).then(() => show("Saving it again."), (e) => show(errText(e)))}>Save again</Button></>
                  : <span className="secondary">Saving to Dropbox…</span>}
                {!r.read && <Button size="sm" variant="ghost" onClick={() => void markRead({ testimonialId: r._id as Id<"testimonials"> })}>Mark read</Button>}
              </div>
            </section>
          ))}
      </div>
      {toast}
    </>
  );
}
